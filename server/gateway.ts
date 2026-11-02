import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { RPCServer, createRPCError, type IHandlersOption } from "ocpp-rpc";

import type { StationCommandInput, StationCommandRecord } from "../shared/commands.js";
import {
  DISPLAYABLE_OCPP_PROTOCOL,
  type RefusedConnectionAttempt,
  type RefusedConnectionReason,
  type StationConnectionDiagnostics,
} from "../shared/connection.js";
import type {
  ContinuityPreparationInput,
  ContinuityPreparationResult,
} from "../shared/continuity.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";
import {
  assessOwnerContinuity,
  planOwnerContinuityPreparation,
  type CapabilityAssessment,
} from "./capabilities.js";
import {
  activeTransactions,
  buildStationCommands,
  occupiedConnectors,
  STATION_COMMAND_TIMEOUT_MS,
  StationCommandConflictError,
} from "./commands.js";
import { configForStation, configuredStations, type GatewayConfig } from "./config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";
import { foldIdTag, pseudonymizeTag } from "./tag.js";

interface OcppPeer {
  readonly identity?: string;
  call(method: string, params?: unknown, options?: { callTimeoutMs?: number }): Promise<unknown>;
  close(options?: { code?: number; force?: boolean; reason?: string }): Promise<void>;
  readonly handshake: { readonly request: { readonly socket: Socket } };
  handle(
    method: string | ((request: IHandlersOption) => Promise<Record<string, unknown>>),
    handler?: (request: IHandlersOption) => Promise<Record<string, unknown>>,
  ): void;
  on(event: string, listener: (payload: unknown) => void): this;
  once(event: string, listener: () => void): this;
}

interface AuthorizeRequest {
  readonly idTag: string;
}

interface StartTransactionRequest extends AuthorizeRequest {
  readonly connectorId: number;
  readonly meterStart: number;
  readonly timestamp: string;
}

interface StopTransactionRequest {
  readonly idTag?: string;
  readonly meterStop: number;
  readonly timestamp: string;
  readonly transactionId: number;
}

export interface ChargeGateway {
  close(): Promise<void>;
  getRuntime(stationId: string): StationRuntime;
  inspectLocalAuthorization(stationId: string): Promise<CapabilityAssessment>;
  listen(port?: number, host?: string): ReturnType<RPCServer["listen"]>;
  prepareOwnerContinuity(
    stationId: string,
    input: ContinuityPreparationInput,
  ): Promise<ContinuityPreparationResult>;
  sendStationCommand(stationId: string, input: StationCommandInput): Promise<StationCommandRecord>;
  syncOwnerList(stationId: string): Promise<AuthorizationSyncResult>;
}

export interface StationRuntime {
  readonly connected: boolean;
  readonly connectedAt: string | null;
  /** In-memory refusal diagnostics; absent from test doubles and older gateways. */
  readonly connection?: StationConnectionDiagnostics;
}

export interface AuthorizationSyncResult {
  readonly listVersion: number;
  readonly status: string;
}

export interface ChargeGatewayOptions {
  /** Override the charger answer timeout for owner commands (tests only). */
  readonly commandTimeoutMs?: number;
}

export function createChargeGateway(
  config: GatewayConfig,
  evidence: EvidenceStore,
  options: ChargeGatewayOptions = {},
): ChargeGateway {
  const commandTimeoutMs = options.commandTimeoutMs ?? STATION_COMMAND_TIMEOUT_MS;
  const stationConfigs = new Map(
    configuredStations(config).map((station) => [station.id, configForStation(config, station.id)]),
  );
  const peers = new Map<string, OcppPeer>();
  const connectedAt = new Map<string, string>();
  const pendingConnections = new Map<string, Socket>();
  const stationOperations = new Map<string, Promise<unknown>>();

  const server = new RPCServer({
    maxBadMessages: 3,
    protocols: ["ocpp1.6"],
    respondWithDetailedErrors: false,
    strictMode: true,
    wssOptions: { maxPayload: config.ocppMaxPayloadBytes },
  });

  // Refusal diagnostics live in memory only: they never reach evidence, exports or logs.
  const lastRefused = new Map<string, RefusedConnectionAttempt>();
  const refusedCount = new Map<string, number>();
  const unmatched = { count: 0, lastAt: null as string | null };

  const noteRefusal = (
    stationId: string,
    reason: RefusedConnectionReason,
    detail: Partial<Pick<RefusedConnectionAttempt, "offeredProtocols" | "presentedIdentity">> = {},
  ) => {
    lastRefused.set(stationId, {
      at: new Date().toISOString(),
      offeredProtocols: detail.offeredProtocols ?? [],
      presentedIdentity: detail.presentedIdentity ?? null,
      reason,
    });
    refusedCount.set(
      stationId,
      Math.min(Number.MAX_SAFE_INTEGER, (refusedCount.get(stationId) ?? 0) + 1),
    );
  };

  /** The configured charger whose own secret this password is; secrets are unique per charger. */
  const stationForPassword = (password: Buffer | undefined): string | null => {
    if (!password) return null;
    let match: string | null = null;
    // Compare against every charger so the time taken does not reveal which one matched.
    for (const [stationId, stationConfig] of stationConfigs) {
      if (securelyEqual(password, stationConfig.stationSecret)) match = stationId;
    }
    return match;
  };

  server.auth((accept, reject, handshake) => {
    const stationConfig = stationConfigs.get(handshake.identity);
    if (!stationConfig) {
      // The password, not the name, decides whose charger this is. A name alone never proves
      // ownership, so the connection is refused either way; only the diagnostic differs.
      const passwordOwner = stationForPassword(handshake.password);
      if (passwordOwner) {
        noteRefusal(passwordOwner, "identity-mismatch", {
          presentedIdentity: displayableIdentity(handshake.identity),
        });
      } else {
        unmatched.count = Math.min(Number.MAX_SAFE_INTEGER, unmatched.count + 1);
        unmatched.lastAt = new Date().toISOString();
      }
      reject(401, "Unknown charge point");
      return;
    }
    if (!securelyEqual(handshake.password, stationConfig.stationSecret)) {
      noteRefusal(
        stationConfig.stationId,
        handshake.password ? "password-wrong" : "password-missing",
      );
      reject(401, "Unknown charge point");
      return;
    }

    if (peers.has(stationConfig.stationId) || pendingConnections.has(stationConfig.stationId)) {
      noteRefusal(stationConfig.stationId, "already-connected");
      reject(409, "Charge point is already connected");
      return;
    }

    if (!handshake.protocols.has("ocpp1.6")) {
      noteRefusal(stationConfig.stationId, "protocol-not-offered", {
        offeredProtocols: [...handshake.protocols]
          .filter((protocol) => DISPLAYABLE_OCPP_PROTOCOL.test(protocol))
          .slice(0, 4),
      });
      reject(400, "Client doesn't support expected subprotocol");
      return;
    }

    const socket = handshake.request.socket;
    pendingConnections.set(stationConfig.stationId, socket);
    // The WebSocket library can refuse an authenticated handshake (bad key/version) after
    // accept() without emitting upgradeAborted or client; release the reservation on close
    // so one malformed handshake cannot lock the provisioned charger out until restart.
    socket.once("close", () => {
      if (pendingConnections.get(stationConfig.stationId) === socket) {
        pendingConnections.delete(stationConfig.stationId);
      }
    });
    accept({ provisionedStationId: stationConfig.stationId }, "ocpp1.6");
  });

  server.on("upgradeAborted", ({ identity, socket }: { identity: string; socket: Socket }) => {
    if (pendingConnections.get(identity) === socket) pendingConnections.delete(identity);
  });

  server.on("client", (untypedPeer: unknown) => {
    const peer = untypedPeer as OcppPeer;
    const stationId = peer.identity;
    const stationConfig = stationId ? stationConfigs.get(stationId) : undefined;
    if (!stationId || !stationConfig) return;

    if (pendingConnections.get(stationId) === peer.handshake.request.socket) {
      pendingConnections.delete(stationId);
    }

    peers.set(stationId, peer);
    connectedAt.set(stationId, new Date().toISOString());
    lastRefused.delete(stationId);
    void record(evidence, stationConfig, stationId, "system", "Connected", {}).catch(
      () => undefined,
    );
    peer.once("disconnect", () => {
      if (peers.get(stationId) === peer) {
        peers.delete(stationId);
        connectedAt.delete(stationId);
      }
      void record(evidence, stationConfig, stationId, "system", "Disconnected", {}).catch(
        () => undefined,
      );
    });

    const limiter = new TokenBucket(config.ocppMessagesPerMinute, config.ocppMessageBurst);
    let rateLimitRecorded = false;
    const enforceRateLimit = async () => {
      if (limiter.consume()) return;
      if (!rateLimitRecorded) {
        rateLimitRecorded = true;
        await record(evidence, stationConfig, stationId, "system", "ProtocolRateLimitExceeded", {
          burst: config.ocppMessageBurst,
          messagesPerMinute: config.ocppMessagesPerMinute,
        });
      }
      await peer.close({ code: 1008, force: true, reason: "Message rate exceeded" });
      throw createRPCError("InternalError");
    };
    let rejectionsRecorded = 0;
    peer.on("strictValidationFailure", (failure: unknown) => {
      const rejection = describeProtocolRejection(failure);
      void (async () => {
        if (rejection.origin === "station" && rejection.phase === "request") {
          try {
            await enforceRateLimit();
          } catch {
            return;
          }
        }
        if (rejectionsRecorded >= MAX_RECORDED_REJECTIONS_PER_CONNECTION) return;
        rejectionsRecorded += 1;
        await record(
          evidence,
          stationConfig,
          stationId,
          "system",
          "ProtocolMessageRejected",
          rejection,
        );
      })().catch(() => undefined);
    });
    const handle = (
      method: string,
      handler: (request: IHandlersOption) => Promise<Record<string, unknown>>,
    ) => {
      peer.handle(method, async (request) => {
        await enforceRateLimit();
        return handler(request);
      });
    };

    handle("BootNotification", async ({ params }) => {
      await record(
        evidence,
        stationConfig,
        stationId,
        "station-to-csms",
        "BootNotification",
        digestFields(stationConfig, params, SUBSCRIBER_IDENTITY_FIELDS),
      );
      return {
        currentTime: new Date().toISOString(),
        interval: config.heartbeatSeconds,
        status: "Accepted",
      };
    });

    handle("Heartbeat", async ({ params }) => {
      await record(evidence, stationConfig, stationId, "station-to-csms", "Heartbeat", params);
      return { currentTime: new Date().toISOString() };
    });

    handle("StatusNotification", async ({ params }) => {
      await record(
        evidence,
        stationConfig,
        stationId,
        "station-to-csms",
        "StatusNotification",
        digestFields(stationConfig, params, STATUS_FREE_TEXT_FIELDS),
      );
      return {};
    });

    handle("Authorize", async ({ params }) => {
      const request = params as unknown as AuthorizeRequest;
      await record(evidence, stationConfig, stationId, "station-to-csms", "Authorize", request);
      const status = authorizationStatus(stationConfig, request.idTag);
      await record(evidence, stationConfig, stationId, "system", "AuthorizationDecision", {
        idTag: request.idTag,
        status,
      });
      return { idTagInfo: { status } };
    });

    handle("StartTransaction", async ({ params }) => {
      const request = params as unknown as StartTransactionRequest;
      const status = authorizationStatus(stationConfig, request.idTag);
      const transactionFingerprint = fingerprintTransaction(stationConfig, request);
      const allocation = await evidence.recordTransactionStart(
        stationId,
        transactionFingerprint,
        (transactionId) =>
          recordedEvent(stationConfig, stationId, "station-to-csms", "StartTransaction", {
            ...request,
            authorizationStatus: status,
            transactionFingerprint,
            transactionId,
          }),
      );
      if (allocation.replayed) {
        await record(evidence, stationConfig, stationId, "system", "StartTransactionReplay", {
          transactionFingerprint,
          transactionId: allocation.transactionId,
        });
        return { idTagInfo: { status }, transactionId: allocation.transactionId };
      }
      return { idTagInfo: { status }, transactionId: allocation.transactionId };
    });

    handle("MeterValues", async ({ params }) => {
      await record(evidence, stationConfig, stationId, "station-to-csms", "MeterValues", params);
      return {};
    });

    handle("StopTransaction", async ({ params }) => {
      const request = params as unknown as StopTransactionRequest;
      await record(
        evidence,
        stationConfig,
        stationId,
        "station-to-csms",
        "StopTransaction",
        request,
      );
      if (request.idTag) {
        return { idTagInfo: { status: authorizationStatus(stationConfig, request.idTag) } };
      }
      return {};
    });

    handle("DataTransfer", async ({ params }) => {
      const request = recordValue(params);
      await record(evidence, stationConfig, stationId, "station-to-csms", "DataTransfer", {
        dataDiscarded: request.data !== undefined,
        messageIdHmac: keyedDigest(stationConfig, request.messageId),
        vendorIdHmac: keyedDigest(stationConfig, request.vendorId),
      });
      return { status: "UnknownVendorId" };
    });

    for (const method of ["DiagnosticsStatusNotification", "FirmwareStatusNotification"]) {
      handle(method, async ({ params }) => {
        await record(evidence, stationConfig, stationId, "station-to-csms", method, {
          status: boundedText(recordValue(params).status, 32),
        });
        return {};
      });
    }

    for (const method of ["LogStatusNotification", "SignedFirmwareStatusNotification"]) {
      handle(method, async ({ params }) => {
        const request = recordValue(params);
        await record(evidence, stationConfig, stationId, "station-to-csms", method, {
          requestId: Number.isSafeInteger(request.requestId) ? request.requestId : null,
          status: boundedText(request.status, 32),
        });
        return {};
      });
    }

    handle("SecurityEventNotification", async ({ params }) => {
      const request = recordValue(params);
      await record(
        evidence,
        stationConfig,
        stationId,
        "station-to-csms",
        "SecurityEventNotification",
        {
          techInfoDiscarded: request.techInfo !== undefined,
          timestamp: boundedText(request.timestamp, 64),
          type: securityEventType(request.type),
        },
      );
      return {};
    });

    peer.handle(async ({ method }) => {
      await enforceRateLimit();
      // Only standard action names become evidence message names; anything else (including
      // `prefix:Action` names that the patched validator resolves) is charger-chosen text.
      const message = method && OCPP_16_ACTIONS.has(method) ? method : "Unrecognized";
      await record(evidence, stationConfig, stationId, "station-to-csms", message, {
        payloadDiscarded: true,
      });
      throw createRPCError("NotImplemented");
    });
  });

  async function inspectState(stationId: string): Promise<{
    readonly assessment: CapabilityAssessment;
    readonly configuration: unknown;
  }> {
    const stationConfig = configForStation(config, stationId);
    const peer = requirePeer(peers, stationId);
    const keys = [
      "LocalAuthListEnabled",
      "LocalAuthorizeOffline",
      "AllowOfflineTxForUnknownId",
      "AuthorizationCacheEnabled",
      "SendLocalListMaxLength",
      "LocalAuthListMaxLength",
      "TransactionMessageAttempts",
      "TransactionMessageRetryInterval",
    ];
    await record(evidence, stationConfig, stationId, "csms-to-station", "GetConfiguration", {
      key: keys,
    });
    const configuration = await peer.call("GetConfiguration", { key: keys });
    await record(
      evidence,
      stationConfig,
      stationId,
      "station-to-csms",
      "GetConfigurationResult",
      configuration,
    );
    await record(evidence, stationConfig, stationId, "csms-to-station", "GetLocalListVersion", {});
    const localList = await peer.call("GetLocalListVersion", {});
    await record(
      evidence,
      stationConfig,
      stationId,
      "station-to-csms",
      "GetLocalListVersionResult",
      localList,
    );
    const assessment = applyPendingRestart(
      assessOwnerContinuity(configuration, localList, stationConfig.ownerTags.size),
      await evidence.readEvents(),
      stationId,
    );
    await record(evidence, stationConfig, stationId, "system", "CapabilityInspection", assessment);
    return { assessment, configuration };
  }

  async function sendCommand(
    stationId: string,
    input: StationCommandInput,
  ): Promise<StationCommandRecord> {
    const stationConfig = configForStation(config, stationId);
    const peer = requirePeer(peers, stationId);
    const stationEvents = (await evidence.readEvents()).filter(
      (event) => event.stationId === stationId,
    );
    const active = activeTransactions(stationEvents);
    let method: string = input.type;
    let params: Record<string, unknown>;
    let requested: Record<string, unknown>;
    switch (input.type) {
      case "RemoteStartTransaction": {
        const idTag = [...stationConfig.ownerTags].find(
          (tag) =>
            `tag_${pseudonymizeTag(tag, stationConfig.stationSecret)}` === input.tagPseudonym,
        );
        if (!idTag) {
          throw new StationCommandConflictError("Remote start needs a current desired owner card");
        }
        if (occupiedConnectors(stationEvents).has(input.connectorId)) {
          throw new StationCommandConflictError("A session is already active on that connector");
        }
        params = { connectorId: input.connectorId, idTag };
        requested = { connectorId: input.connectorId, tagPseudonym: input.tagPseudonym };
        break;
      }
      case "RemoteStopTransaction":
        if (!active.has(input.transactionId)) {
          throw new StationCommandConflictError(
            "That session is not active on this charger; refresh and choose a current session",
          );
        }
        params = { transactionId: input.transactionId };
        requested = {
          connectorId: active.get(input.transactionId)!.connectorId,
          transactionId: input.transactionId,
        };
        break;
      case "Reset":
        params = { type: input.resetType };
        requested = { resetType: input.resetType };
        break;
      case "UnlockConnector":
        params = { connectorId: input.connectorId };
        requested = { connectorId: input.connectorId };
        break;
      case "ChangeAvailability":
        method = "ChangeAvailability";
        params = { connectorId: input.connectorId, type: "Operative" };
        requested = { availability: "Operative", connectorId: input.connectorId };
        break;
    }

    const commandId = randomUUID();
    // Durable intent first: if this append fails nothing is sent.
    await record(evidence, stationConfig, stationId, "system", "StationCommandRequested", {
      commandId,
      type: input.type,
      ...requested,
    });
    const notSent = async () => {
      await record(evidence, stationConfig, stationId, "system", "StationCommandFailed", {
        commandId,
        reason: "not-sent",
      });
    };
    try {
      await record(evidence, stationConfig, stationId, "csms-to-station", method, {
        commandId,
        ...params,
      });
    } catch (error) {
      await notSent().catch(() => undefined);
      throw error;
    }
    // The socket may have closed while evidence was being written.
    const currentPeer = peers.get(stationId);
    let outcome: { readonly reason: string } | { readonly status: string };
    if (currentPeer !== peer) {
      outcome = { reason: "not-sent" };
    } else {
      try {
        const response = await peer.call(method, params, { callTimeoutMs: commandTimeoutMs });
        outcome = { status: readStatus(response) };
      } catch (error) {
        outcome = { reason: commandFailureReason(error) };
      }
    }
    // A failed write here propagates: the ledger then shows no answer (uncertain), never a
    // fabricated failure reason.
    if ("status" in outcome) {
      await record(evidence, stationConfig, stationId, "station-to-csms", "StationCommandResult", {
        commandId,
        status: outcome.status,
      });
    } else {
      await record(evidence, stationConfig, stationId, "system", "StationCommandFailed", {
        commandId,
        reason: outcome.reason,
      });
    }
    const command = buildStationCommands(
      (await evidence.readEvents()).filter((event) => event.stationId === stationId),
    ).find((candidate) => candidate.commandId === commandId);
    if (!command) throw new Error("Station command evidence could not be projected");
    return command;
  }

  async function inspect(stationId: string): Promise<CapabilityAssessment> {
    return (await inspectState(stationId)).assessment;
  }

  const gateway: ChargeGateway = {
    async close() {
      await server.close({ awaitPending: true });
    },
    getRuntime(stationId) {
      return {
        connected: peers.has(stationId),
        connectedAt: connectedAt.get(stationId) ?? null,
        connection: {
          endpointBase: config.ocppPublicUrl ?? null,
          lastRefused: lastRefused.get(stationId) ?? null,
          lastUnmatchedAt: unmatched.lastAt,
          refusedSinceStart: refusedCount.get(stationId) ?? 0,
          unmatchedSinceStart: unmatched.count,
        },
      };
    },
    inspectLocalAuthorization: inspect,
    async listen(port = config.port, host = config.ocppHost) {
      const httpServer = await server.listen(port, host);
      guardUpgradeHandler(httpServer, server.handleUpgrade);
      httpServer.headersTimeout = 10_000;
      httpServer.keepAliveTimeout = 5_000;
      httpServer.maxConnections = config.ocppMaxConnections;
      httpServer.requestTimeout = 10_000;
      return httpServer;
    },
    async prepareOwnerContinuity(stationId, input) {
      const stationConfig = configForStation(config, stationId);
      if (!input || input.confirmation !== CONTINUITY_PREPARATION_PHRASE) {
        throw new OwnerContinuityPreparationInputError();
      }
      const before = await inspectState(stationId);
      if (before.assessment.restartRequired) {
        throw new OwnerContinuityRestartRequiredError(before.assessment);
      }
      const plan = planOwnerContinuityPreparation(before.configuration);
      if (plan.some((setting) => setting.state === "blocked")) {
        await record(evidence, stationConfig, stationId, "system", "ContinuityPreparationBlocked", {
          settings: plan,
        });
        throw new OwnerContinuityPreparationBlockedError(before.assessment);
      }

      const requested = plan.filter((setting) => setting.state === "change-required");
      await record(
        evidence,
        stationConfig,
        stationId,
        "system",
        "ContinuityPreparationAuthorized",
        {
          confirmationVersion: 1,
          requested: requested.map(({ desiredValue, key }) => ({ key, value: desiredValue })),
        },
      );
      const peer = requirePeer(peers, stationId);
      const changes: ContinuityPreparationResult["changes"][number][] = [];
      for (const setting of requested) {
        const params = { key: setting.key, value: setting.desiredValue };
        await record(
          evidence,
          stationConfig,
          stationId,
          "csms-to-station",
          "ChangeConfiguration",
          params,
        );
        const response = await peer.call("ChangeConfiguration", params);
        const status = readStatus(response);
        await record(
          evidence,
          stationConfig,
          stationId,
          "station-to-csms",
          "ChangeConfigurationResult",
          {
            key: setting.key,
            status,
          },
        );
        if (status === "RebootRequired") {
          throw new OwnerContinuityRestartRequiredError((await inspectState(stationId)).assessment);
        }
        if (status !== "Accepted") {
          throw new OwnerContinuityPreparationBlockedError(
            (await inspectState(stationId)).assessment,
          );
        }
        changes.push({
          from: setting.currentValue!,
          key: setting.key,
          status,
          to: setting.desiredValue,
        });
      }

      const assessment = requested.length
        ? (await inspectState(stationId)).assessment
        : before.assessment;
      if (assessment.state !== "ready") {
        throw new OwnerContinuityPreparationBlockedError(assessment);
      }
      await record(evidence, stationConfig, stationId, "system", "ContinuityPreparationVerified", {
        changedKeys: changes.map(({ key }) => key),
        state: assessment.state,
      });
      return { assessment, changes, state: "ready" };
    },
    sendStationCommand: sendCommand,
    async syncOwnerList(stationId) {
      const stationConfig = configForStation(config, stationId);
      const assessment = await inspect(stationId);
      if (assessment.state !== "ready" || assessment.localListVersion === null) {
        await record(
          evidence,
          stationConfig,
          stationId,
          "system",
          "AuthorizationSyncBlocked",
          assessment,
        );
        throw new OwnerContinuityBlockedError(assessment);
      }
      const peer = requirePeer(peers, stationId);
      const listVersion = await evidence.allocateAuthorizationRevision(
        stationId,
        assessment.localListVersion + 1,
      );
      const params = {
        listVersion,
        localAuthorizationList: uniqueCaseInsensitive(stationConfig.ownerTags).map((idTag) => ({
          idTag,
          idTagInfo: { status: "Accepted" },
        })),
        updateType: "Full",
      };
      await record(evidence, stationConfig, stationId, "csms-to-station", "SendLocalList", params);
      const response = await peer.call("SendLocalList", params);
      const status = readStatus(response);
      await record(evidence, stationConfig, stationId, "station-to-csms", "SendLocalListResult", {
        listVersion,
        status,
      });
      if (status !== "Accepted") {
        throw new Error(`Charge point rejected local authorization list: ${status}`);
      }
      return { listVersion, status };
    },
  };

  // Every chargeOS-initiated exchange with one charger runs one at a time, so a command's
  // csms-to-station record is written only when it is actually about to be sent, never while it
  // waits behind an inspection or synchronization in the OCPP library's call queue.
  function serialized<T>(stationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = stationOperations.get(stationId) ?? Promise.resolve();
    const run = previous.then(operation);
    stationOperations.set(
      stationId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return {
    ...gateway,
    inspectLocalAuthorization: (stationId) =>
      serialized(stationId, () => gateway.inspectLocalAuthorization(stationId)),
    prepareOwnerContinuity: (stationId, input) =>
      serialized(stationId, () => gateway.prepareOwnerContinuity(stationId, input)),
    sendStationCommand: (stationId, input) =>
      serialized(stationId, () => gateway.sendStationCommand(stationId, input)),
    syncOwnerList: (stationId) => serialized(stationId, () => gateway.syncOwnerList(stationId)),
  };
}

class TokenBucket {
  readonly #burst: number;
  readonly #tokensPerMillisecond: number;
  #lastRefill = performance.now();
  #tokens: number;

  constructor(messagesPerMinute: number, burst: number) {
    this.#burst = burst;
    this.#tokens = burst;
    this.#tokensPerMillisecond = messagesPerMinute / 60_000;
  }

  consume(): boolean {
    const now = performance.now();
    this.#tokens = Math.min(
      this.#burst,
      this.#tokens + Math.max(0, now - this.#lastRefill) * this.#tokensPerMillisecond,
    );
    this.#lastRefill = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

export class OwnerContinuityBlockedError extends Error {
  readonly assessment: CapabilityAssessment;

  constructor(assessment: CapabilityAssessment) {
    super("Owner authorization sync blocked until every required offline capability passes");
    this.name = "OwnerContinuityBlockedError";
    this.assessment = assessment;
  }
}

export class OwnerContinuityPreparationInputError extends Error {
  constructor() {
    super("Exact owner continuity preparation confirmation is required");
    this.name = "OwnerContinuityPreparationInputError";
  }
}

export class OwnerContinuityPreparationBlockedError extends Error {
  readonly assessment: CapabilityAssessment;

  constructor(assessment: CapabilityAssessment) {
    super(
      "Owner continuity preparation stopped because a required setting could not be proven safe and writable",
    );
    this.name = "OwnerContinuityPreparationBlockedError";
    this.assessment = assessment;
  }
}

export class OwnerContinuityRestartRequiredError extends Error {
  readonly assessment: CapabilityAssessment;

  constructor(assessment: CapabilityAssessment) {
    super("Charge point restart and a new BootNotification are required before continuing");
    this.name = "OwnerContinuityRestartRequiredError";
    this.assessment = assessment;
  }
}

function applyPendingRestart(
  assessment: CapabilityAssessment,
  events: readonly EvidenceEvent[],
  stationId: string,
): CapabilityAssessment {
  const lastBootIndex = events.findLastIndex(
    (event) => event.stationId === stationId && event.message === "BootNotification",
  );
  const lastRestartRequiredIndex = events.findLastIndex(
    (event) =>
      event.stationId === stationId &&
      event.message === "ChangeConfigurationResult" &&
      readStatus(event.payload) === "RebootRequired",
  );
  if (lastRestartRequiredIndex <= lastBootIndex) return assessment;
  return {
    ...assessment,
    checks: [
      ...assessment.checks,
      {
        id: "continuity-restart",
        label: "Required configuration restart observed",
        observed: "awaiting a new BootNotification",
        state: "fail",
      },
    ],
    restartRequired: true,
    state: "blocked",
  };
}

// A schema-type error may mean the charger acted but sent a reply chargeOS could not accept, so
// those outcomes are uncertain rather than failed.
const UNCERTAIN_RPC_ERRORS = new Set([
  "FormatViolation",
  "FormationViolation",
  "OccurenceConstraintViolation",
  "PropertyConstraintViolation",
  "ProtocolError",
  "TypeConstraintViolation",
]);

function commandFailureReason(error: unknown): string {
  if (error instanceof Error && error.constructor.name === "TimeoutError") return "timeout";
  if (error instanceof Error && /socket not open/i.test(error.message)) return "not-sent";
  const code = recordValue(error).rpcErrorCode;
  if (typeof code === "string" && /^[A-Za-z]{1,40}$/.test(code)) {
    return UNCERTAIN_RPC_ERRORS.has(code) ? `unreadable-reply:${code}` : `call-error:${code}`;
  }
  return "connection-lost";
}

function requirePeer(peers: ReadonlyMap<string, OcppPeer>, stationId: string): OcppPeer {
  const peer = peers.get(stationId);
  if (!peer) {
    throw new Error(`Charge point ${stationId} is not connected`);
  }
  return peer;
}

function authorizationStatus(config: GatewayConfig, tag: string): "Accepted" | "Invalid" {
  if (config.ownerTags.has(tag)) return "Accepted";
  const folded = foldIdTag(tag);
  for (const ownerTag of config.ownerTags) {
    if (foldIdTag(ownerTag) === folded) return "Accepted";
  }
  return "Invalid";
}

const MAX_RECORDED_REJECTIONS_PER_CONNECTION = 16;

interface ProtocolRejection {
  readonly errorCode: string;
  readonly keyword: string | null;
  readonly method: string;
  readonly origin: "csms" | "station";
  readonly path: string | null;
  readonly phase: "request" | "response";
}

/**
 * Summarize a strict OCPP schema rejection without copying any payload value: the rejected
 * message may contain a raw RFID identifier or other device data.
 */
function describeProtocolRejection(failure: unknown): ProtocolRejection {
  const value = recordValue(failure);
  const error = recordValue(value.error);
  const details = recordValue(error.details);
  const first = Array.isArray(details.errors) ? recordValue(details.errors[0]) : {};
  const method =
    typeof value.method === "string" && OCPP_16_ACTIONS.has(value.method)
      ? value.method
      : "Unrecognized";
  const keyword =
    typeof first.keyword === "string" && /^[A-Za-z]{1,32}$/.test(first.keyword)
      ? first.keyword
      : null;
  const path =
    typeof first.instancePath === "string" && /^[A-Za-z0-9/_-]{0,128}$/.test(first.instancePath)
      ? first.instancePath || "/"
      : null;
  const errorCode =
    typeof error.rpcErrorCode === "string" && /^[A-Za-z]{1,40}$/.test(error.rpcErrorCode)
      ? error.rpcErrorCode
      : "FormationViolation";
  return {
    errorCode,
    keyword,
    method,
    origin: value.outbound === true ? "csms" : "station",
    path,
    phase: value.isCall === true ? "request" : "response",
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Every OCPP 1.6J action (core, profiles and the 1.6 security extension). Any other method name is
// charger-chosen text and is recorded only as "Unrecognized".
const OCPP_16_ACTIONS = new Set([
  "Authorize",
  "BootNotification",
  "CancelReservation",
  "CertificateSigned",
  "ChangeAvailability",
  "ChangeConfiguration",
  "ClearCache",
  "ClearChargingProfile",
  "DataTransfer",
  "DeleteCertificate",
  "DiagnosticsStatusNotification",
  "ExtendedTriggerMessage",
  "FirmwareStatusNotification",
  "GetCompositeSchedule",
  "GetConfiguration",
  "GetDiagnostics",
  "GetInstalledCertificateIds",
  "GetLocalListVersion",
  "GetLog",
  "Heartbeat",
  "InstallCertificate",
  "LogStatusNotification",
  "MeterValues",
  "RemoteStartTransaction",
  "RemoteStopTransaction",
  "ReserveNow",
  "Reset",
  "SecurityEventNotification",
  "SendLocalList",
  "SetChargingProfile",
  "SignCertificate",
  "SignedFirmwareStatusNotification",
  "SignedUpdateFirmware",
  "StartTransaction",
  "StatusNotification",
  "StopTransaction",
  "TriggerMessage",
  "UnlockConnector",
  "UpdateFirmware",
]);

// Security event types defined by the OCPP 1.6 security whitepaper. Vendor-defined types are
// free text and are recorded only as "VendorDefined".
const SECURITY_EVENT_TYPES = new Set([
  "AttemptedReplayAttacks",
  "FailedToAuthenticateAtCentralSystem",
  "FirmwareUpdated",
  "InvalidCentralSystemCertificate",
  "InvalidChargePointCertificate",
  "InvalidFirmwareSignature",
  "InvalidFirmwareSigningCertificate",
  "InvalidMessages",
  "InvalidTLSCipherSuite",
  "InvalidTLSVersion",
  "MemoryExhaustion",
  "ReconfigurationOfSecurityParameters",
  "ResetOrReboot",
  "SecurityLogWasCleared",
  "SettingSystemTime",
  "StartupOfTheDevice",
  "TamperDetectionActivated",
]);

function securityEventType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SECURITY_EVENT_TYPES.has(value) ? value : "VendorDefined";
}

// SIM subscriber identifiers (ICCID/IMSI) and charger-chosen status free text can identify a
// person or carry a raw card UID, and evidence payloads reach shareable exports. Keep only a
// station-keyed digest so repeated values stay correlatable without being disclosed.
const SUBSCRIBER_IDENTITY_FIELDS = ["iccid", "imsi"] as const;
const STATUS_FREE_TEXT_FIELDS = ["info", "vendorErrorCode"] as const;

function digestFields(
  config: GatewayConfig,
  params: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const source = recordValue(params);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (fields.includes(key)) result[`${key}Digest`] = keyedDigest(config, value);
    else result[key] = value;
  }
  return result;
}

function keyedDigest(config: GatewayConfig, value: unknown): string | null {
  if (typeof value !== "string") return null;
  return createHmac("sha256", config.stationSecret)
    .update(`ocpp-text:${value}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function uniqueCaseInsensitive(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of [...tags].sort()) {
    const folded = foldIdTag(tag);
    if (seen.has(folded)) continue;
    seen.add(folded);
    unique.push(tag);
  }
  return unique;
}

function boundedText(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length <= maximumLength ? value : null;
}

/** A charger-chosen name is shown back to the owner only when it is short printable ASCII. */
function displayableIdentity(identity: string): string | null {
  return /^[\x21-\x2e\x30-\x7e]{1,128}$/u.test(identity) ? identity : null;
}

function securelyEqual(actual: Buffer | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function readStatus(response: unknown): string {
  if (!response || typeof response !== "object") return "MalformedResponse";
  const status = (response as { status?: unknown }).status;
  return typeof status === "string" ? status : "MalformedResponse";
}

function fingerprintTransaction(config: GatewayConfig, request: StartTransactionRequest): string {
  return createHmac("sha256", config.stationSecret)
    .update(
      JSON.stringify({
        connectorId: request.connectorId,
        idTag: request.idTag,
        meterStart: request.meterStart,
        timestamp: request.timestamp,
      }),
    )
    .digest("hex");
}

async function record(
  evidence: EvidenceStore,
  config: GatewayConfig,
  stationId: string,
  direction: "station-to-csms" | "csms-to-station" | "system",
  message: string,
  payload: unknown,
): Promise<void> {
  await evidence.append(recordedEvent(config, stationId, direction, message, payload));
}

function recordedEvent(
  config: GatewayConfig,
  stationId: string,
  direction: "station-to-csms" | "csms-to-station" | "system",
  message: string,
  payload: unknown,
) {
  const sourcePayloadHmac = createHmac("sha256", config.stationSecret)
    .update(JSON.stringify(payload) ?? "null", "utf8")
    .digest("hex");
  return evidenceEvent(
    stationId,
    direction,
    message,
    redactTags(payload, config.stationSecret),
    sourcePayloadHmac,
  );
}

function redactTags(value: unknown, secret: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactTags(item, secret));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key.toLowerCase().includes("idtag") && typeof child === "string"
          ? `tag_${pseudonymizeTag(child, secret)}`
          : redactTags(child, secret),
      ]),
    );
  }
  return value;
}

/**
 * ocpp-rpc decodes the identity path segment before its own error handling and registers an
 * un-awaited async upgrade listener, so one unauthenticated malformed percent-escape would reject
 * outside any handler and terminate the edge. Replace that listener (synchronously, before any
 * socket I/O can be processed) with one that refuses undecodable targets and contains failures.
 */
function guardUpgradeHandler(
  httpServer: HttpServer,
  handleUpgrade: (request: IncomingMessage, socket: Socket, head: Buffer) => Promise<void>,
): void {
  httpServer.removeAllListeners("upgrade");
  httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    // Node attaches no error listener to an upgraded socket; a peer reset during the refusal
    // write would otherwise surface as an unhandled 'error' and terminate the edge.
    socket.on("error", () => socket.destroy());
    if (!hasDecodableUpgradeTarget(request.url)) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n", () =>
        socket.destroy(),
      );
      return;
    }
    handleUpgrade(request, socket, head).catch(() => {
      socket.destroy();
    });
  });
}

export function hasDecodableUpgradeTarget(target: string | undefined): boolean {
  try {
    const url = new URL(`http://localhost${target ?? "/"}`);
    decodeURIComponent(url.pathname.split("/").pop() ?? "");
    return true;
  } catch {
    return false;
  }
}
