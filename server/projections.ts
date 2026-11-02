import type {
  CapabilityAssessment,
  ChargeSession,
  ConnectorStatus,
  EvidenceSummary,
  FleetSnapshot,
  FleetStationSummary,
  OwnerSnapshot,
  RedactedContinuityExport,
} from "../shared/contracts.js";
import type {
  DelegateDiagnostics,
  DelegateSessionExport,
  DelegateStationStatus,
} from "../shared/delegation.js";
import { buildStationCommands } from "./commands.js";
import { configForStation, configuredStations, type GatewayConfig } from "./config.js";
import { projectDelegateGrants } from "./delegation.js";
import type { EvidenceEvent } from "./events.js";
import { buildFreedomTestProjection } from "./freedom-test.js";
import { buildGenesisPlan } from "./genesis.js";
import { buildMigrationProjection } from "./migration.js";
import type { StationNameLookup } from "./directory.js";
import type { ChargeGateway } from "./gateway.js";
import { pseudonymizeTag } from "./tag.js";
import { IDLE_CARD_CAPTURE } from "../shared/card-capture.js";
import { buildUsageReport, type UsageReport } from "../shared/usage.js";

/**
 * `names` overlays owner-chosen display names. Pass it only for owner responses: delegate,
 * export and AI troubleshooting projections must keep personal names out.
 */
export function buildOwnerSnapshot(
  config: GatewayConfig,
  gateway: Pick<ChargeGateway, "getRuntime">,
  events: readonly EvidenceEvent[],
  names?: StationNameLookup,
): OwnerSnapshot {
  const stationMetadata = configuredStations(config).find(({ id }) => id === config.stationId);
  const named = names?.(config.stationId);
  const runtime = gateway.getRuntime(config.stationId);
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  const freedomTest = buildFreedomTestProjection(stationEvents);
  const migration = buildMigrationProjection(stationEvents);
  return {
    authorization: authorizationProjection(stationEvents, config),
    cardCapture: runtime.cardCapture ?? IDLE_CARD_CAPTURE,
    commands: buildStationCommands(stationEvents),
    delegations: projectDelegateGrants(stationEvents),
    evidence: evidenceProjection(stationEvents, 50),
    evidenceHistory: evidenceHistoryProjection(stationEvents),
    freedomTest,
    genesisPlan: buildGenesisPlan(migration, freedomTest),
    migration,
    generatedAt: new Date().toISOString(),
    readiness: latestPayload<CapabilityAssessment>(stationEvents, "CapabilityInspection"),
    sessions: sessionProjection(stationEvents),
    station: {
      boot: bootProjection(stationEvents),
      connected: runtime.connected,
      connectedAt: runtime.connectedAt,
      connection: runtime.connection ?? {
        acceptedAlias: null,
        aliasCandidate: null,
        endpointBase: config.ocppPublicUrl ?? null,
        lastRefused: null,
        lastUnmatchedAt: null,
        refusedSinceStart: 0,
        unmatchedSinceStart: 0,
      },
      connectors: connectorProjection(stationEvents),
      driver: named ? named.driver : (stationMetadata?.driver ?? null),
      id: config.stationId,
      label: named?.label ?? stationMetadata?.label ?? config.stationId,
      site: named?.site ?? stationMetadata?.site ?? "Primary site",
    },
  };
}

export function buildFleetSnapshot(
  config: GatewayConfig,
  gateway: Pick<ChargeGateway, "getRuntime">,
  events: readonly EvidenceEvent[],
  names?: StationNameLookup,
): FleetSnapshot {
  const byStation = new Map<string, EvidenceEvent[]>();
  for (const event of events) {
    const stationEvents = byStation.get(event.stationId);
    if (stationEvents) stationEvents.push(event);
    else byStation.set(event.stationId, [event]);
  }
  const stations = configuredStations(config).map((station): FleetStationSummary => {
    const scoped = configForStation(config, station.id);
    const snapshot = buildOwnerSnapshot(scoped, gateway, byStation.get(station.id) ?? [], names);
    const attention = new Set<FleetStationSummary["attention"][number]>();
    if (!snapshot.station.connected) attention.add("offline");
    if (snapshot.authorization.syncState !== "current") attention.add("authorization-pending");
    if (snapshot.readiness?.state !== "ready") attention.add("continuity-unproven");
    if (snapshot.genesisPlan.state === "action-required") attention.add("migration-action");
    if (snapshot.sessions.some(({ integrity }) => integrity === "conflict")) {
      attention.add("evidence-conflict");
    }
    return {
      activeSessionCount: snapshot.sessions.filter(({ status }) => status === "active").length,
      attention: [...attention],
      authorizationState: snapshot.authorization.syncState,
      boot: snapshot.station.boot,
      connected: snapshot.station.connected,
      connectedAt: snapshot.station.connectedAt,
      connectorCount: snapshot.station.connectors.length,
      driver: snapshot.station.driver,
      energyWh: snapshot.sessions.reduce((total, session) => total + (session.energyWh ?? 0), 0),
      id: station.id,
      label: snapshot.station.label,
      lastSessionAt: snapshot.sessions[0]?.startedAt ?? null,
      readiness: snapshot.readiness?.state ?? "not-inspected",
      site: snapshot.station.site,
    };
  });
  return {
    console: { profile: config.profile ?? "personal" },
    generatedAt: new Date().toISOString(),
    stations,
    totals: {
      activeSessions: stations.reduce((total, station) => total + station.activeSessionCount, 0),
      attentionRequired: stations.filter(({ attention }) => attention.length > 0).length,
      connected: stations.filter(({ connected }) => connected).length,
      energyWh: stations.reduce((total, station) => total + station.energyWh, 0),
      stations: stations.length,
    },
  };
}

export function buildDelegateStationStatus(
  config: GatewayConfig,
  gateway: Pick<ChargeGateway, "getRuntime">,
  events: readonly EvidenceEvent[],
): DelegateStationStatus {
  const runtime = gateway.getRuntime(config.stationId);
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  return {
    generatedAt: new Date().toISOString(),
    station: {
      boot: bootProjection(stationEvents),
      connected: runtime.connected,
      connectedAt: runtime.connectedAt,
      connectors: connectorProjection(stationEvents),
      id: config.stationId,
    },
  };
}

export function buildDelegateDiagnostics(
  config: GatewayConfig,
  gateway: Pick<ChargeGateway, "getRuntime">,
  events: readonly EvidenceEvent[],
): DelegateDiagnostics {
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  const status = buildDelegateStationStatus(config, gateway, stationEvents);
  const authorization = authorizationProjection(stationEvents, config);
  return {
    ...status,
    authorization: {
      lastSyncAt: authorization.lastSyncAt,
      lastSyncRevision: authorization.lastSyncRevision,
      lastSyncStatus: authorization.lastSyncStatus,
    },
    readiness: latestPayload<CapabilityAssessment>(stationEvents, "CapabilityInspection"),
    recentEvents: stationEvents
      .slice(Math.max(0, stationEvents.length - 25))
      .reverse()
      .map(({ at, direction, eventId, message }) => ({ at, direction, eventId, message })),
  };
}

/** Owner-only monthly usage across every provisioned charger, grouped by assigned driver. */
export function buildUsageReportProjection(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  month: string,
  timeZone: string,
  now = new Date(),
  names?: StationNameLookup,
): UsageReport {
  const byStation = new Map<string, EvidenceEvent[]>();
  for (const event of events) {
    const stationEvents = byStation.get(event.stationId);
    if (stationEvents) stationEvents.push(event);
    else byStation.set(event.stationId, [event]);
  }
  return buildUsageReport({
    generatedAt: now.toISOString(),
    month,
    profile: config.profile ?? "personal",
    stations: configuredStations(config).map((station) => {
      const named = names?.(station.id);
      return {
        driver: named ? named.driver : (station.driver ?? null),
        id: station.id,
        label: named?.label ?? station.label,
        sessions: sessionProjection(byStation.get(station.id) ?? []),
        site: named?.site ?? station.site,
      };
    }),
    timeZone,
  });
}

export function buildDelegateSessionExport(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
): DelegateSessionExport {
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    sessions: sessionProjection(events.filter((event) => event.stationId === config.stationId)).map(
      ({ tagPseudonym: _tagPseudonym, ...session }) => session,
    ),
    stationId: config.stationId,
  };
}

export function buildRedactedContinuityExport(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  now = new Date(),
): RedactedContinuityExport {
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  return {
    evidence: evidenceProjection(stationEvents, Number.POSITIVE_INFINITY),
    exportedAt: now.toISOString(),
    history: evidenceHistoryProjection(stationEvents),
    ownerTagPseudonyms: [...config.ownerTags].map(
      (tag) => `tag_${pseudonymizeTag(tag, config.stationSecret)}`,
    ),
    schemaVersion: 2,
    stationId: config.stationId,
  };
}

function authorizationProjection(events: readonly EvidenceEvent[], config: GatewayConfig) {
  interface AuthorizationAttempt {
    readonly commandAt: string;
    readonly listVersion: number;
    readonly tagPseudonyms: readonly string[];
    resultAt: string | null;
    status: string | null;
  }

  const attempts: AuthorizationAttempt[] = [];
  const unresolved: AuthorizationAttempt[] = [];
  for (const event of events) {
    const payload = recordPayload(event);
    if (event.message === "SendLocalList") {
      if (typeof payload.listVersion !== "number" || !Number.isInteger(payload.listVersion)) {
        continue;
      }
      const attempt: AuthorizationAttempt = {
        commandAt: event.at,
        listVersion: payload.listVersion,
        resultAt: null,
        status: null,
        tagPseudonyms: authorizationTags(payload.localAuthorizationList),
      };
      attempts.push(attempt);
      unresolved.push(attempt);
      continue;
    }
    if (event.message !== "SendLocalListResult") continue;
    const status = typeof payload.status === "string" ? payload.status : "MalformedResponse";
    const explicitVersion =
      typeof payload.listVersion === "number" && Number.isInteger(payload.listVersion)
        ? payload.listVersion
        : null;
    const attemptIndex =
      explicitVersion === null
        ? unresolved.length - 1
        : unresolved.findLastIndex((candidate) => candidate.listVersion === explicitVersion);
    if (attemptIndex < 0) continue;
    const [attempt] = unresolved.splice(attemptIndex, 1);
    if (!attempt) continue;
    attempt.resultAt = event.at;
    attempt.status = status;
  }

  const desiredTagPseudonyms = [...config.ownerTags]
    .map((tag) => `tag_${pseudonymizeTag(tag, config.stationSecret)}`)
    .sort();
  const acknowledged = attempts.findLast((attempt) => attempt.status === "Accepted") ?? null;
  const acknowledgedTagPseudonyms = [...(acknowledged?.tagPseudonyms ?? [])].sort();
  const acknowledgedSet = new Set(acknowledgedTagPseudonyms);
  const desiredSet = new Set(desiredTagPseudonyms);
  const pendingAdditions = desiredTagPseudonyms.filter((tag) => !acknowledgedSet.has(tag));
  const pendingRevocations = acknowledgedTagPseudonyms.filter((tag) => !desiredSet.has(tag));
  const lastCompleted = attempts.findLast((attempt) => attempt.status !== null) ?? null;
  const latestUnresolved = unresolved.at(-1) ?? null;
  const syncState: OwnerSnapshot["authorization"]["syncState"] = !acknowledged
    ? "never-synced"
    : pendingAdditions.length || pendingRevocations.length
      ? "pending"
      : "current";
  return {
    acknowledgedTagPseudonyms,
    lastAttemptAt: lastCompleted?.resultAt ?? null,
    lastAttemptRevision: lastCompleted?.listVersion ?? null,
    lastAttemptStatus: lastCompleted?.status ?? null,
    lastSyncAt: acknowledged?.resultAt ?? null,
    lastSyncRevision: acknowledged?.listVersion ?? null,
    lastSyncStatus: acknowledged?.status ?? null,
    pendingAdditions,
    pendingRevocations,
    pendingRevision: latestUnresolved?.listVersion ?? null,
    syncState,
    tagCount: config.ownerTags.size,
    tagPseudonyms: desiredTagPseudonyms,
  };
}

function authorizationTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const idTag = recordPayloadValue(entry).idTag;
      return typeof idTag === "string" && idTag.startsWith("tag_") ? [idTag] : [];
    })
    .sort();
}

function bootProjection(events: readonly EvidenceEvent[]): OwnerSnapshot["station"]["boot"] {
  const event = latestEvent(events, "BootNotification");
  if (!event) return null;
  const payload = recordPayload(event);
  if (
    typeof payload.chargePointVendor !== "string" ||
    typeof payload.chargePointModel !== "string"
  ) {
    return null;
  }
  return {
    firmwareVersion: typeof payload.firmwareVersion === "string" ? payload.firmwareVersion : null,
    model: payload.chargePointModel,
    vendor: payload.chargePointVendor,
  };
}

function connectorProjection(events: readonly EvidenceEvent[]): readonly ConnectorStatus[] {
  const connectors = new Map<number, ConnectorStatus>();
  for (const event of events) {
    if (event.message !== "StatusNotification") continue;
    const payload = recordPayload(event);
    if (
      typeof payload.connectorId !== "number" ||
      typeof payload.status !== "string" ||
      typeof payload.errorCode !== "string"
    ) {
      continue;
    }
    connectors.set(payload.connectorId, {
      connectorId: payload.connectorId,
      errorCode: payload.errorCode,
      status: payload.status,
      updatedAt: event.at,
    });
  }
  return [...connectors.values()].sort((left, right) => left.connectorId - right.connectorId);
}

function evidenceProjection(
  events: readonly EvidenceEvent[],
  limit: number,
): readonly EvidenceSummary[] {
  return events
    .slice(Math.max(0, events.length - limit))
    .reverse()
    .map(
      ({
        at,
        carriedFromRecordHash,
        direction,
        eventId,
        message,
        payload,
        previousRecordHash,
        recordHash,
        sourcePayloadHmac,
      }) => ({
        at,
        ...(carriedFromRecordHash !== undefined ? { carriedFromRecordHash } : {}),
        direction,
        eventId,
        message,
        payload: redactEvidencePayload(message, payload),
        ...(previousRecordHash !== undefined ? { previousRecordHash } : {}),
        ...(recordHash !== undefined ? { recordHash } : {}),
        ...(sourcePayloadHmac !== undefined ? { sourcePayloadHmac } : {}),
      }),
    );
}

// Ledgers written before record-time digests may hold raw SIM identifiers or status free text.
const LEGACY_RAW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  BootNotification: ["iccid", "imsi"],
  StatusNotification: ["info", "vendorErrorCode"],
};

function redactEvidencePayload(message: string, payload: unknown): unknown {
  if (message === "DelegateCapabilityGranted") {
    const { tokenHash: _tokenHash, ...redacted } = recordPayloadValue(payload);
    return redacted;
  }
  const legacy = LEGACY_RAW_FIELDS[message];
  if (!legacy) return payload;
  const record = recordPayloadValue(payload);
  if (!legacy.some((field) => Object.hasOwn(record, field))) return payload;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) =>
      legacy.includes(key) ? [key, "[redacted]"] : [key, value],
    ),
  );
}

function sessionProjection(events: readonly EvidenceEvent[]): readonly ChargeSession[] {
  interface WorkingSession {
    session: ChargeSession;
    readonly meterFingerprints: Set<string>;
    readonly stopFingerprints: Set<string>;
  }

  const sessions = new Map<number, WorkingSession>();
  for (const event of events) {
    const payload = recordPayload(event);
    if (event.message === "StartTransaction") {
      if (
        typeof payload.transactionId !== "number" ||
        typeof payload.connectorId !== "number" ||
        typeof payload.meterStart !== "number" ||
        typeof payload.timestamp !== "string" ||
        typeof payload.idTag !== "string"
      ) {
        continue;
      }
      if (sessions.has(payload.transactionId)) continue;
      sessions.set(payload.transactionId, {
        meterFingerprints: new Set(),
        session: {
          authorizationStatus:
            payload.authorizationStatus === "Accepted" || payload.authorizationStatus === "Invalid"
              ? payload.authorizationStatus
              : "Unknown",
          connectorId: payload.connectorId,
          energyWh: null,
          integrity: "consistent",
          meterStart: payload.meterStart,
          meterStop: null,
          replayedMessageCount: 0,
          startedAt: payload.timestamp,
          status: "active",
          stoppedAt: null,
          tagPseudonym: payload.idTag,
          transactionId: payload.transactionId,
        },
        stopFingerprints: new Set(),
      });
      const compactedReplayCount = payload.compactedReplayCount;
      if (
        typeof compactedReplayCount === "number" &&
        Number.isSafeInteger(compactedReplayCount) &&
        compactedReplayCount >= 0
      ) {
        const working = sessions.get(payload.transactionId);
        if (working) {
          working.session = { ...working.session, replayedMessageCount: compactedReplayCount };
        }
      }
    }
    if (event.message === "StartTransactionReplay" && typeof payload.transactionId === "number") {
      incrementReplay(sessions.get(payload.transactionId));
    }
    if (event.message === "MeterValues" && typeof payload.transactionId === "number") {
      const working = sessions.get(payload.transactionId);
      if (!working) continue;
      const fingerprint = evidenceFingerprint(event, payload);
      if (working.meterFingerprints.has(fingerprint)) incrementReplay(working);
      else working.meterFingerprints.add(fingerprint);
    }
    if (event.message === "StopTransaction" && typeof payload.transactionId === "number") {
      const working = sessions.get(payload.transactionId);
      if (
        !working ||
        typeof payload.meterStop !== "number" ||
        typeof payload.timestamp !== "string"
      ) {
        continue;
      }
      const fingerprint = evidenceFingerprint(event, payload);
      if (working.stopFingerprints.has(fingerprint)) {
        incrementReplay(working);
        continue;
      }
      working.stopFingerprints.add(fingerprint);
      if (working.session.status === "complete") {
        working.session = { ...working.session, integrity: "conflict" };
        continue;
      }
      working.session = {
        ...working.session,
        energyWh: Math.max(0, payload.meterStop - working.session.meterStart),
        meterStop: payload.meterStop,
        status: "complete",
        stoppedAt: payload.timestamp,
      };
    }
  }
  return [...sessions.values()]
    .map(({ session }) => session)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function evidenceHistoryProjection(events: readonly EvidenceEvent[]): {
  readonly custodyBundleCount: number;
  readonly custodiedEventCount: number;
  readonly mode: "complete" | "compacted-operational";
} {
  const checkpoint = events.findLast(
    (event) => event.message === "EvidenceHistoryCompacted" && event.direction === "system",
  );
  const payload = recordPayload(checkpoint);
  const custodyBundleCount = payload.custodyBundleCount;
  const custodiedEventCount = payload.custodiedEventCount;
  if (
    typeof custodyBundleCount === "number" &&
    Number.isSafeInteger(custodyBundleCount) &&
    custodyBundleCount > 0 &&
    typeof custodiedEventCount === "number" &&
    Number.isSafeInteger(custodiedEventCount) &&
    custodiedEventCount >= 0
  ) {
    return { custodyBundleCount, custodiedEventCount, mode: "compacted-operational" };
  }
  return { custodyBundleCount: 0, custodiedEventCount: 0, mode: "complete" };
}

function incrementReplay(working: { session: ChargeSession } | undefined): void {
  if (!working) return;
  working.session = {
    ...working.session,
    replayedMessageCount: working.session.replayedMessageCount + 1,
  };
}

function evidenceFingerprint(event: EvidenceEvent, payload: Record<string, unknown>): string {
  return event.sourcePayloadHmac ?? JSON.stringify(payload);
}

function latestPayload<T>(events: readonly EvidenceEvent[], message: string): T | null {
  return (latestEvent(events, message)?.payload as T | undefined) ?? null;
}

function latestEvent(events: readonly EvidenceEvent[], message: string): EvidenceEvent | undefined {
  return events.findLast((event) => event.message === message);
}

function recordPayload(event: EvidenceEvent | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function recordPayloadValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
