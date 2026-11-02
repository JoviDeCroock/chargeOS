import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createTroubleshooter,
  troubleshootingInput,
  troubleshootingPreview,
  TroubleshootingError,
} from "./troubleshooting.js";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, relative, resolve } from "node:path";

import type { StationCommandResult } from "../shared/commands.js";
import type { ApiErrorResponse } from "../shared/contracts.js";
import type { ContinuityPreparationInput } from "../shared/continuity.js";
import type { DelegateGrantInput, DelegateScope } from "../shared/delegation.js";
import {
  SETUP_SIGN_IN_CHALLENGE,
  SETUP_SIGN_IN_PROOF_CONTEXT,
  SETUP_SIGN_IN_PROOF_PATH,
} from "../shared/setup-sign-in.js";
import {
  OWNER_TAG_REVOCATION_CONFIRMATION,
  type OwnerTagAddInput,
  type OwnerTagRevokeInput,
} from "../shared/owner-tags.js";
import type {
  MigrationAuthorizationInput,
  MigrationObservationInput,
} from "../shared/migration.js";
import {
  parseStationCommandInput,
  StationCommandConflictError,
  StationCommandInputError,
} from "./commands.js";
import { configForStation, type GatewayConfig, UnknownStationError } from "./config.js";
import {
  DirectoryInputError,
  PERSON_ID_PATTERN,
  type CardProfileInput,
  type PersonInput,
  type StationProfileInput,
} from "../shared/directory.js";
import {
  DirectoryNotFoundError,
  DirectoryUnavailableError,
  OwnerDirectoryStore,
} from "./directory.js";
import {
  authenticateDelegate,
  delegateGrantIdFromToken,
  createDelegateGrant,
  DelegationConflictError,
  DelegationInputError,
  DelegationNotFoundError,
  hasDelegateScope,
  projectDelegateGrants,
  recordDelegateUse,
  revokeDelegateGrant,
  type DelegatePrincipal,
} from "./delegation.js";
import type { EvidenceStore } from "./events.js";
import { createFieldEvidencePack } from "./field-pack.js";
import {
  IdentityAliasError,
  OwnerContinuityBlockedError,
  OwnerContinuityPreparationBlockedError,
  OwnerContinuityPreparationInputError,
  OwnerContinuityRestartRequiredError,
  type AuthorizationSyncResult,
  type ChargeGateway,
} from "./gateway.js";
import {
  buildFreedomTestProjection,
  buildFreedomTestReport,
  FreedomTestInputError,
  recordFreedomTestDevice,
  recordFreedomTestObservation,
  startFreedomTestRun,
} from "./freedom-test.js";
import { buildGenesisPlan } from "./genesis.js";
import {
  authorizeMigrationWindow,
  buildMigrationProjection,
  buildMigrationReport,
  MigrationGateBlockedError,
  MigrationInputError,
  recordMigrationCheckpoint,
} from "./migration.js";
import {
  OwnerTagConflictError,
  OwnerTagInputError,
  ownerTagRegistryFor,
  type OwnerTagRegistries,
  type OwnerTagRegistry,
} from "./owner-tags.js";
import type {
  FreedomTestDeviceInput,
  FreedomTestObservationInput,
  FreedomTestRunInput,
} from "../shared/freedom-test.js";
import {
  buildDelegateDiagnostics,
  buildDelegateSessionExport,
  buildDelegateStationStatus,
  buildFleetSnapshot,
  buildOwnerSnapshot,
  buildRedactedContinuityExport,
  buildUsageReportProjection,
} from "./projections.js";
import { parseTimeZone, parseUsageMonth, UsageInputError } from "../shared/usage.js";

interface FailedAuthorization {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_AUTH_PEERS = 4_096;
const DELEGATE_REQUESTS_PER_MINUTE = 60;

export interface OwnerApi {
  close(): Promise<void>;
  listen(port?: number, host?: string): Promise<number>;
}

export function createOwnerApi(
  config: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  ownerTags: OwnerTagRegistry | OwnerTagRegistries,
  aiFetch: typeof fetch = fetch,
  directory: OwnerDirectoryStore = OwnerDirectoryStore.memory(config),
): OwnerApi {
  const troubleshoot = createTroubleshooter(config.aiRelayOrigin, aiFetch);
  const failedAuthorizations = new Map<string, FailedAuthorization>();
  // Every delegate request reads the ledger and appends a use audit; bound each grant so the
  // lowest-privilege read token cannot starve the shared event loop or exhaust evidence capacity.
  const delegateRequests = new Map<string, FailedAuthorization>();
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const location = error instanceof Error ? error.stack?.split("\n").at(1)?.trim() : undefined;
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "code-unavailable";
      console.error(
        "Owner API request failed",
        error instanceof Error ? error.name : "unknown",
        code,
        location ?? "location-unavailable",
      );
      sendError(response, 500, "internal_error", "Internal server error");
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://chargeos.local");

    if (url.pathname === "/api/v1/health" && request.method === "GET") {
      const capacity = await evidence.getCapacity?.();
      const degraded = Boolean(
        capacity && capacity.remainingBytes < config.ocppMaxPayloadBytes + 4_096,
      );
      sendJson(response, degraded ? 503 : 200, {
        service: "chargeos",
        status: degraded ? "degraded" : "ok",
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const remoteAddress = clientAddress(request, config.trustProxyHeaders);
      if (isRateLimited(failedAuthorizations, remoteAddress)) {
        sendError(response, 429, "rate_limited", "Too many failed authorization attempts");
        return;
      }
      if (url.pathname === SETUP_SIGN_IN_PROOF_PATH && request.method === "POST") {
        // Unauthenticated by design: the console asks for it before it holds a token. It costs the
        // caller the same budget as a failed sign-in, and an HMAC reveals nothing about its key.
        recordFailedAuthorization(failedAuthorizations, remoteAddress);
        await handleSetupSignInProof(request, response, config.ownerApiToken);
        return;
      }
      const token = bearerToken(request);
      if (token && tokenMatches(token, config.ownerApiToken)) {
        failedAuthorizations.delete(remoteAddress);
        if (url.pathname === "/api/v1/fleet" && request.method === "GET") {
          sendJson(
            response,
            200,
            buildFleetSnapshot(
              config,
              gateway,
              await evidence.readEvents(),
              directory.stationNames(config),
            ),
          );
          return;
        }
        if (await handleDirectoryApi(request, response, url, config, directory)) return;
        if (url.pathname === "/api/v1/usage" && request.method === "GET") {
          try {
            const month = parseUsageMonth(url.searchParams.get("month"));
            const timeZone = parseTimeZone(url.searchParams.get("timeZone"));
            sendJson(
              response,
              200,
              buildUsageReportProjection(
                config,
                await evidence.readEvents(),
                month,
                timeZone,
                new Date(),
                directory.stationNames(config),
              ),
            );
          } catch (error) {
            if (error instanceof UsageInputError) {
              sendError(response, 400, "invalid_request", error.message);
              return;
            }
            throw error;
          }
          return;
        }
        const scoped = resolveStationRequest(config, url);
        if (!scoped) {
          sendError(response, 404, "station_not_found", "Charge point not found");
          return;
        }
        if (
          scoped.url.pathname === "/api/v1/troubleshooting" ||
          scoped.url.pathname === "/api/v1/troubleshooting/preview"
        ) {
          try {
            const preview = troubleshootingPreview(
              buildOwnerSnapshot(scoped.config, gateway, await evidence.readEvents()),
            );
            if (request.method === "GET" && scoped.url.pathname.endsWith("/preview")) {
              sendJson(response, 200, preview);
            } else if (
              request.method === "POST" &&
              scoped.url.pathname === "/api/v1/troubleshooting"
            ) {
              const input = troubleshootingInput(await readJsonBody(request));
              sendJson(response, 200, await troubleshoot(input, preview));
            } else
              sendError(
                response,
                405,
                "method_not_allowed",
                "Use GET for the preview or POST for advice",
              );
          } catch (error) {
            if (error instanceof TroubleshootingError)
              sendError(response, error.status, "troubleshooting_failed", error.message);
            else if (error instanceof FreedomTestInputError)
              sendError(response, 400, "invalid_request", error.message);
            else throw error;
          }
          return;
        }
        await handleOwnerApi(
          request,
          response,
          scoped.url,
          scoped.config,
          gateway,
          evidence,
          ownerTagRegistryFor(ownerTags, scoped.config.stationId),
          directory,
        );
        return;
      }
      const scoped = resolveStationRequest(config, url);
      const delegateGrantId = token ? delegateGrantIdFromToken(token) : null;
      if (
        delegateGrantId &&
        isRateLimited(delegateRequests, delegateGrantId, DELEGATE_REQUESTS_PER_MINUTE)
      ) {
        // Refuse before reading the ledger; only authenticated calls consume a grant's budget.
        sendError(response, 429, "rate_limited", "Too many delegate requests");
        return;
      }
      const principal =
        token && delegateGrantId
          ? authenticateDelegate(
              await evidence.readEvents(),
              scoped?.config.stationId ?? config.stationId,
              token,
            )
          : null;
      if (principal && scoped) {
        // A valid delegate token deliberately does not clear owner-token guess failures.
        recordFailedAuthorization(delegateRequests, principal.grantId);
        await handleDelegateApi(
          request,
          response,
          scoped.url,
          scoped.config,
          gateway,
          evidence,
          principal,
        );
        return;
      }
      {
        recordFailedAuthorization(failedAuthorizations, remoteAddress);
        response.setHeader("WWW-Authenticate", "Bearer");
        sendError(response, 401, "unauthorized", "Valid owner or delegate token required");
        return;
      }
    }

    await serveUi(response, url.pathname, config.uiDirectory, request.method);
  }

  return {
    close() {
      return new Promise((resolveClose, rejectClose) => {
        if (!server.listening) {
          resolveClose();
          return;
        }
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
    listen(port = config.apiPort, host = config.apiHost) {
      return new Promise((resolveListen, rejectListen) => {
        const onError = (error: Error) => rejectListen(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") {
            rejectListen(new Error("Owner API did not bind a TCP port"));
            return;
          }
          resolveListen(address.port);
        });
      });
    },
  };
}

function resolveStationRequest(
  config: GatewayConfig,
  requestUrl: URL,
): { readonly config: GatewayConfig; readonly url: URL } | null {
  const match = requestUrl.pathname.match(/^\/api\/v1\/stations\/([^/]+)(\/.*)?$/u);
  if (!match) return { config, url: requestUrl };
  let stationId: string;
  try {
    stationId = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  let scopedConfig: GatewayConfig;
  try {
    scopedConfig = configForStation(config, stationId);
  } catch (error) {
    if (error instanceof UnknownStationError) return null;
    throw error;
  }
  const suffix = match[2] ?? "";
  const directStationActions = new Set([
    "/commands",
    "/inspect",
    "/prepare-owner-continuity",
    "/sync-authorizations",
  ]);
  const url = new URL(requestUrl);
  url.pathname = directStationActions.has(suffix)
    ? `/api/v1/stations/${encodeURIComponent(stationId)}${suffix}`
    : `/api/v1${suffix}`;
  return { config: scopedConfig, url };
}

async function handleOwnerApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  ownerTags: OwnerTagRegistry,
  directory: OwnerDirectoryStore,
): Promise<void> {
  if (url.pathname === "/api/v1/profile" && request.method === "POST") {
    try {
      await directory.updateStation(
        config.stationId,
        stationProfileInput(await readJsonBody(request)),
      );
      sendJson(response, 200, directory.project(config));
    } catch (error) {
      if (!sendDirectoryError(response, error)) throw error;
    }
    return;
  }
  const cardProfileMatch = url.pathname.match(/^\/api\/v1\/cards\/(tag_[a-f0-9]{24})$/u);
  if (cardProfileMatch && request.method === "POST") {
    try {
      await directory.updateCard(
        config,
        cardProfileMatch[1] ?? "",
        cardProfileInput(await readJsonBody(request)),
      );
      sendJson(response, 200, directory.project(config));
    } catch (error) {
      if (!sendDirectoryError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/delegations" && request.method === "GET") {
    sendJson(
      response,
      200,
      projectDelegateGrants(
        (await evidence.readEvents()).filter((event) => event.stationId === config.stationId),
      ),
    );
    return;
  }
  if (url.pathname === "/api/v1/delegations" && request.method === "POST") {
    try {
      const input = (await readJsonBody(request)) as unknown as DelegateGrantInput;
      sendJson(response, 201, await createDelegateGrant(config.stationId, evidence, input));
    } catch (error) {
      if (!sendDelegationError(response, error)) throw error;
    }
    return;
  }
  const revocationMatch = url.pathname.match(/^\/api\/v1\/delegations\/([^/]+)\/revoke$/);
  if (revocationMatch && request.method === "POST") {
    try {
      sendJson(
        response,
        200,
        await revokeDelegateGrant(
          config.stationId,
          evidence,
          decodeURIComponent(revocationMatch[1] ?? ""),
        ),
      );
    } catch (error) {
      if (!sendDelegationError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/snapshot" && request.method === "GET") {
    sendJson(
      response,
      200,
      buildOwnerSnapshot(
        config,
        gateway,
        await evidence.readEvents(),
        directory.stationNames(config),
      ),
    );
    return;
  }
  if (url.pathname === "/api/v1/owner-tags" && request.method === "POST") {
    try {
      const input = ownerTagAddInput(await readJsonBody(request));
      const result = await ownerTags.add(config, evidence, input.tag);
      // A re-added card never inherits the name it had before it was revoked.
      await directory.forgetAddedCard(config, result.tagPseudonym).catch(() => {
        console.warn("Owner directory could not clear a stale card name");
      });
      sendJson(response, 201, result);
    } catch (error) {
      if (!sendOwnerTagError(response, error)) throw error;
    }
    return;
  }
  const ownerTagRevocationMatch = url.pathname.match(
    /^\/api\/v1\/owner-tags\/(tag_[a-f0-9]{24})\/revoke$/,
  );
  if (ownerTagRevocationMatch && request.method === "POST") {
    try {
      const input = ownerTagRevokeInput(await readJsonBody(request));
      const tagPseudonym = ownerTagRevocationMatch[1] ?? "";
      const result = await ownerTags.revoke(config, evidence, tagPseudonym, input);
      // Forgetting names is data minimization only; a failure never undoes the revoke.
      await directory.forgetRevokedCards(config).catch(() => {
        console.warn("Owner directory could not forget a revoked card name");
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (!sendOwnerTagError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/card-capture" && request.method === "POST") {
    try {
      if (!objectWithExactKeys(await readJsonBody(request), [])) {
        throw new FreedomTestInputError("request must be an empty JSON object");
      }
      sendJson(response, 200, gateway.armCardCapture(config.stationId));
    } catch (error) {
      if (error instanceof FreedomTestInputError) {
        sendError(response, 400, "invalid_request", error.message);
      } else sendGatewayError(response, error);
    }
    return;
  }
  if (url.pathname === "/api/v1/card-capture/cancel" && request.method === "POST") {
    sendJson(response, 200, gateway.cancelCardCapture(config.stationId));
    return;
  }
  if (url.pathname === "/api/v1/card-capture/confirm" && request.method === "POST") {
    try {
      const input = objectWithExactKeys(await readJsonBody(request), ["tagPseudonym"]);
      if (!input || typeof input.tagPseudonym !== "string") {
        throw new OwnerTagInputError("request must contain only tagPseudonym");
      }
      // The raw value moves from gateway memory straight into the registry; it is never sent
      // back, and an unknown or expired pseudonym adds nothing.
      const tag = gateway.takeCapturedCard(config.stationId, input.tagPseudonym);
      if (!tag) {
        sendError(
          response,
          409,
          "card_capture_unavailable",
          "That card is no longer waiting to be added; tap it again",
        );
        return;
      }
      const result = await ownerTags.add(config, evidence, tag);
      await directory.forgetAddedCard(config, result.tagPseudonym).catch(() => {
        console.warn("Owner directory could not clear a stale card name");
      });
      sendJson(response, 201, result);
    } catch (error) {
      if (!sendOwnerTagError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/identity-alias" && request.method === "POST") {
    try {
      const input = objectWithExactKeys(await readJsonBody(request), ["presentedIdentity"]);
      if (!input) throw new IdentityAliasError(400, "request must contain only presentedIdentity");
      sendJson(
        response,
        200,
        await gateway.acceptIdentityAlias(config.stationId, input.presentedIdentity),
      );
    } catch (error) {
      if (error instanceof IdentityAliasError) {
        sendError(response, error.status, "identity_alias_refused", error.message);
      } else if (error instanceof FreedomTestInputError) {
        sendError(response, 400, "invalid_request", error.message);
      } else throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/genesis-plan" && request.method === "GET") {
    const events = (await evidence.readEvents()).filter(
      (event) => event.stationId === config.stationId,
    );
    const migration = buildMigrationProjection(events);
    sendJson(response, 200, buildGenesisPlan(migration, buildFreedomTestProjection(events)));
    return;
  }
  if (url.pathname === "/api/v1/continuity-export" && request.method === "GET") {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="chargeos-${safeFilename(config.stationId)}-continuity.json"`,
    );
    sendJson(response, 200, buildRedactedContinuityExport(config, await evidence.readEvents()));
    return;
  }
  if (url.pathname === "/api/v1/field-pack" && request.method === "GET") {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="chargeos-${safeFilename(config.stationId)}-field-pack.json"`,
    );
    sendJson(response, 200, createFieldEvidencePack(config, await evidence.readEvents()));
    return;
  }
  if (url.pathname === "/api/v1/freedom-test/report" && request.method === "GET") {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="chargeos-${safeFilename(config.stationId)}-freedom-test.json"`,
    );
    sendJson(response, 200, buildFreedomTestReport(config, await evidence.readEvents()));
    return;
  }
  if (url.pathname === "/api/v1/migration/report" && request.method === "GET") {
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="chargeos-${safeFilename(config.stationId)}-migration.json"`,
    );
    sendJson(response, 200, buildMigrationReport(config, await evidence.readEvents()));
    return;
  }
  const checkpointMatch = url.pathname.match(/^\/api\/v1\/migration\/checkpoints\/([^/]+)$/);
  if (checkpointMatch && request.method === "POST") {
    try {
      const stepId = decodeURIComponent(checkpointMatch[1] ?? "");
      const input = (await readJsonBody(request)) as unknown as MigrationObservationInput;
      await recordMigrationCheckpoint(config, evidence, stepId, input);
      sendJson(
        response,
        200,
        buildMigrationProjection(
          (await evidence.readEvents()).filter((event) => event.stationId === config.stationId),
        ),
      );
    } catch (error) {
      if (!sendMigrationError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/migration/authorize" && request.method === "POST") {
    try {
      const input = (await readJsonBody(request)) as unknown as MigrationAuthorizationInput;
      await authorizeMigrationWindow(config, evidence, input);
      sendJson(
        response,
        200,
        buildMigrationProjection(
          (await evidence.readEvents()).filter((event) => event.stationId === config.stationId),
        ),
      );
    } catch (error) {
      if (!sendMigrationError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/freedom-test/device" && request.method === "POST") {
    try {
      const input = (await readJsonBody(request)) as unknown as FreedomTestDeviceInput;
      await recordFreedomTestDevice(config, evidence, input);
      sendJson(response, 200, buildFreedomTestProjection(await stationEvents(config, evidence)));
    } catch (error) {
      if (!sendFreedomTestError(response, error)) throw error;
    }
    return;
  }
  if (url.pathname === "/api/v1/freedom-test/runs" && request.method === "POST") {
    try {
      const input = (await readJsonBody(request)) as unknown as FreedomTestRunInput;
      await startFreedomTestRun(config, evidence, input);
      sendJson(response, 201, buildFreedomTestProjection(await stationEvents(config, evidence)));
    } catch (error) {
      if (!sendFreedomTestError(response, error)) throw error;
    }
    return;
  }
  const observationMatch = url.pathname.match(/^\/api\/v1\/freedom-test\/observations\/([^/]+)$/);
  if (observationMatch && request.method === "POST") {
    try {
      const stepId = decodeURIComponent(observationMatch[1] ?? "");
      const input = (await readJsonBody(request)) as unknown as FreedomTestObservationInput;
      await recordFreedomTestObservation(config, evidence, stepId, input);
      sendJson(response, 200, buildFreedomTestProjection(await stationEvents(config, evidence)));
    } catch (error) {
      if (!sendFreedomTestError(response, error)) throw error;
    }
    return;
  }

  const inspectionPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}/inspect`;
  if (url.pathname === inspectionPath && request.method === "POST") {
    try {
      sendJson(response, 200, await gateway.inspectLocalAuthorization(config.stationId));
    } catch (error) {
      sendGatewayError(response, error);
    }
    return;
  }

  const preparationPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}/prepare-owner-continuity`;
  if (url.pathname === preparationPath && request.method === "POST") {
    try {
      const input = (await readJsonBody(request)) as unknown as ContinuityPreparationInput;
      sendJson(response, 200, await gateway.prepareOwnerContinuity(config.stationId, input));
    } catch (error) {
      sendGatewayError(response, error);
    }
    return;
  }

  const commandPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}/commands`;
  if (url.pathname === commandPath && request.method === "POST") {
    try {
      const input = parseStationCommandInput(await readJsonBody(request));
      const command = await gateway.sendStationCommand(config.stationId, input);
      const result: StationCommandResult = { command };
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof StationCommandInputError) {
        sendError(response, 400, "invalid_station_command", error.message);
      } else if (error instanceof StationCommandConflictError) {
        sendError(response, 409, "station_command_conflict", error.message);
      } else {
        sendGatewayError(response, error);
      }
    }
    return;
  }

  const syncPath = `/api/v1/stations/${encodeURIComponent(config.stationId)}/sync-authorizations`;
  if (url.pathname === syncPath && request.method === "POST") {
    try {
      const result: AuthorizationSyncResult = await gateway.syncOwnerList(config.stationId);
      sendJson(response, 200, result);
    } catch (error) {
      sendGatewayError(response, error);
    }
    return;
  }

  sendError(response, 404, "not_found", "API route not found");
}

async function stationEvents(
  config: GatewayConfig,
  evidence: EvidenceStore,
): Promise<Awaited<ReturnType<EvidenceStore["readEvents"]>>> {
  return (await evidence.readEvents()).filter((event) => event.stationId === config.stationId);
}

async function handleDelegateApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: GatewayConfig,
  gateway: ChargeGateway,
  evidence: EvidenceStore,
  principal: DelegatePrincipal,
): Promise<void> {
  const routes: Readonly<
    Record<
      string,
      {
        readonly build: (events: Awaited<ReturnType<EvidenceStore["readEvents"]>>) => unknown;
        readonly scope: DelegateScope;
      }
    >
  > = {
    "/api/v1/delegate/diagnostics": {
      build: (events) => buildDelegateDiagnostics(config, gateway, events),
      scope: "diagnostics:read",
    },
    "/api/v1/delegate/freedom-test": {
      build: (events) => buildFreedomTestReport(config, events),
      scope: "freedom-test:read",
    },
    "/api/v1/delegate/migration": {
      build: (events) => buildMigrationReport(config, events),
      scope: "migration:read",
    },
    "/api/v1/delegate/sessions": {
      build: (events) => buildDelegateSessionExport(config, events),
      scope: "sessions:read",
    },
    "/api/v1/delegate/station-status": {
      build: (events) => buildDelegateStationStatus(config, gateway, events),
      scope: "station-status:read",
    },
  };
  const route = routes[url.pathname];
  if (!route || request.method !== "GET") {
    sendError(response, 404, "not_found", "Delegate API route not found");
    return;
  }
  if (!hasDelegateScope(principal, route.scope)) {
    sendError(response, 403, "insufficient_scope", `Delegate token lacks ${route.scope}`);
    return;
  }
  await recordDelegateUse(config.stationId, evidence, principal, route.scope, url.pathname);
  const events = await evidence.readEvents();
  sendJson(response, 200, route.build(events));
}

function sendGatewayError(response: ServerResponse, error: unknown): void {
  if (error instanceof OwnerContinuityPreparationInputError) {
    sendError(response, 400, "invalid_confirmation", error.message);
    return;
  }
  if (error instanceof OwnerContinuityRestartRequiredError) {
    sendError(response, 409, "station_restart_required", error.message);
    return;
  }
  if (error instanceof OwnerContinuityPreparationBlockedError) {
    sendError(response, 409, "continuity_preparation_blocked", error.message);
    return;
  }
  if (error instanceof OwnerContinuityBlockedError) {
    sendError(response, 409, "continuity_not_ready", error.message);
    return;
  }
  if (error instanceof Error && error.message.includes("is not connected")) {
    sendError(response, 409, "station_offline", "Charge point is not connected");
    return;
  }
  throw error;
}

/** Owner-wide people and the directory read model. Station-scoped names use handleOwnerApi. */
async function handleDirectoryApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: GatewayConfig,
  directory: OwnerDirectoryStore,
): Promise<boolean> {
  if (url.pathname === "/api/v1/directory" && request.method === "GET") {
    sendJson(response, 200, directory.project(config));
    return true;
  }
  const personMatch = url.pathname.match(/^\/api\/v1\/people(?:\/([^/]+)(\/remove)?)?$/u);
  if (!personMatch || request.method !== "POST") return false;
  const [, personId, remove] = personMatch;
  try {
    if (personId === undefined) {
      const person = await directory.addPerson(personInput(await readJsonBody(request)));
      sendJson(response, 201, { directory: directory.project(config), person });
      return true;
    }
    if (!PERSON_ID_PATTERN.test(personId)) throw new DirectoryNotFoundError("Person not found");
    if (remove) await directory.removePerson(personId);
    else await directory.renamePerson(personId, personInput(await readJsonBody(request)));
    sendJson(response, 200, { directory: directory.project(config) });
  } catch (error) {
    if (!sendDirectoryError(response, error)) throw error;
  }
  return true;
}

function sendDirectoryError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof DirectoryInputError || error instanceof FreedomTestInputError) {
    sendError(response, 400, "invalid_directory_input", error.message);
    return true;
  }
  if (error instanceof DirectoryNotFoundError) {
    sendError(response, 404, "directory_not_found", error.message);
    return true;
  }
  if (error instanceof DirectoryUnavailableError) {
    sendError(response, 503, "directory_unavailable", error.message);
    return true;
  }
  return false;
}

function personInput(value: unknown): PersonInput {
  const input = objectWithExactKeys(value, ["name"]);
  if (!input) throw new DirectoryInputError("request must contain only name");
  return { name: input.name as string };
}

function stationProfileInput(value: unknown): StationProfileInput {
  const input = objectWithExactKeys(value, ["driverPersonId", "label", "site"]);
  if (!input)
    throw new DirectoryInputError("request must contain only label, site and driverPersonId");
  return {
    driverPersonId: input.driverPersonId as string | null,
    label: input.label as string,
    site: input.site as string,
  };
}

function cardProfileInput(value: unknown): CardProfileInput {
  const input = objectWithExactKeys(value, ["holderPersonId", "name"]);
  if (!input) throw new DirectoryInputError("request must contain only name and holderPersonId");
  return {
    holderPersonId: input.holderPersonId as string | null,
    name: input.name as string | null,
  };
}

function sendFreedomTestError(response: ServerResponse, error: unknown): boolean {
  if (!(error instanceof FreedomTestInputError)) return false;
  sendError(response, 400, "invalid_freedom_test_evidence", error.message);
  return true;
}

function sendOwnerTagError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof OwnerTagConflictError) {
    sendError(response, 409, "owner_tag_conflict", error.message);
    return true;
  }
  if (error instanceof OwnerTagInputError || error instanceof FreedomTestInputError) {
    sendError(response, 400, "invalid_owner_tag", error.message);
    return true;
  }
  return false;
}

function ownerTagAddInput(value: unknown): OwnerTagAddInput {
  const input = objectWithExactKeys(value, ["tag"]);
  if (!input) throw new OwnerTagInputError("request must contain only tag");
  return { tag: input.tag as string };
}

function ownerTagRevokeInput(value: unknown): OwnerTagRevokeInput {
  const input = objectWithExactKeys(value, ["confirmation"]);
  if (!input || input.confirmation !== OWNER_TAG_REVOCATION_CONFIRMATION) {
    throw new OwnerTagInputError("request must contain only the exact confirmation phrase");
  }
  return { confirmation: input.confirmation };
}

function objectWithExactKeys(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === [...keys].sort().join(",") ? record : null;
}

function sendDelegationError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof DelegationInputError || error instanceof FreedomTestInputError) {
    sendError(response, 400, "invalid_delegation", error.message);
    return true;
  }
  if (error instanceof DelegationNotFoundError) {
    sendError(response, 404, "delegation_not_found", error.message);
    return true;
  }
  if (error instanceof DelegationConflictError) {
    sendError(response, 409, "delegation_conflict", error.message);
    return true;
  }
  return false;
}

function sendMigrationError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof MigrationInputError || error instanceof FreedomTestInputError) {
    sendError(response, 400, "invalid_migration_evidence", error.message);
    return true;
  }
  if (error instanceof MigrationGateBlockedError) {
    sendError(response, 409, "migration_gate_blocked", error.message);
    return true;
  }
  return false;
}

async function handleSetupSignInProof(
  request: IncomingMessage,
  response: ServerResponse,
  ownerApiToken: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof FreedomTestInputError) {
      sendError(response, 400, "invalid_request", error.message);
      return;
    }
    throw error;
  }
  const { challenge } = body;
  if (
    Object.keys(body).length !== 1 ||
    typeof challenge !== "string" ||
    !SETUP_SIGN_IN_CHALLENGE.test(challenge)
  ) {
    sendError(response, 400, "invalid_request", "challenge must be 64 lowercase hex digits");
    return;
  }
  const proof = createHmac("sha256", ownerApiToken)
    .update(`${SETUP_SIGN_IN_PROOF_CONTEXT}${challenge}`)
    .digest("hex");
  sendJson(response, 200, { proof });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new FreedomTestInputError("Content-Type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 8 * 1024) throw new FreedomTestInputError("Request body exceeds 8 KiB");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FreedomTestInputError("Request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FreedomTestInputError("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

async function serveUi(
  response: ServerResponse,
  pathname: string,
  uiDirectory: string,
  method: string | undefined,
): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    sendError(response, 405, "method_not_allowed", "Only GET and HEAD are supported");
    return;
  }

  const root = resolve(uiDirectory);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = resolve(root, requested);
  if (relative(root, filePath).startsWith("..")) {
    sendError(response, 404, "not_found", "File not found");
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("not a file");
  } catch {
    if (extname(requested)) {
      sendError(response, 404, "not_found", "File not found");
      return;
    }
    filePath = resolve(root, "index.html");
  }

  try {
    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(filePath));
    response.setHeader(
      "Cache-Control",
      filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    );
    response.end(method === "HEAD" ? undefined : body);
  } catch {
    sendError(
      response,
      503,
      "ui_not_built",
      "Owner UI is not built; run pnpm build:web or use the API",
    );
  }
}

function bearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
}

function clientAddress(request: IncomingMessage, trustProxyHeaders: boolean): string {
  const socketAddress = request.socket.remoteAddress ?? "unknown";
  if (!trustProxyHeaders) return socketAddress;

  const forwarded = request.headers["x-forwarded-for"];
  const values = Array.isArray(forwarded) ? forwarded : (forwarded?.split(",") ?? []);
  const candidate = values.at(-1)?.trim();
  return candidate && isIP(candidate) ? candidate : socketAddress;
}

function tokenMatches(token: string, expected: string): boolean {
  const actual = Buffer.from(token, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function recordFailedAuthorization(
  failures: Map<string, FailedAuthorization>,
  remoteAddress: string,
): void {
  const now = Date.now();
  if (failures.size >= MAX_TRACKED_AUTH_PEERS && !failures.has(remoteAddress)) {
    for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key);
    // Still full of live windows: evict the oldest so rotating source addresses cannot grow
    // the table without bound.
    if (failures.size >= MAX_TRACKED_AUTH_PEERS) {
      const oldest = failures.keys().next().value;
      if (oldest !== undefined) failures.delete(oldest);
    }
  }
  const current = failures.get(remoteAddress);
  failures.set(remoteAddress, {
    count: current && current.resetAt > now ? current.count + 1 : 1,
    resetAt: current && current.resetAt > now ? current.resetAt : now + 60_000,
  });
}

function isRateLimited(
  failures: ReadonlyMap<string, FailedAuthorization>,
  remoteAddress: string,
  limit = 10,
): boolean {
  const current = failures.get(remoteAddress);
  return Boolean(current && current.resetAt > Date.now() && current.count >= limit);
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiErrorResponse = { error: { code, message } };
  sendJson(response, status, body);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function contentType(path: string): string {
  const types: Readonly<Record<string, string>> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  return types[extname(path)] ?? "application/octet-stream";
}
