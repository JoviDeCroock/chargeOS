import { createHash, createHmac } from "node:crypto";

import {
  MIGRATION_AUTHORIZATION_PHRASE,
  MIGRATION_SCHEMA_VERSION,
  MIGRATION_STEPS,
  type MigrationAuthorization,
  type MigrationAuthorizationInput,
  type MigrationEvidenceReference,
  type MigrationObservationInput,
  type MigrationProjection,
  type MigrationReport,
  type MigrationStepDefinition,
  type MigrationStepId,
  type MigrationStepResult,
} from "../shared/migration.js";
import type { GatewayConfig } from "./config.js";
import { buildDeviceIdentity, latestDeviceInventoryEvent } from "./device.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";
import {
  inspectMigrationTargetManifest,
  MigrationTargetManifestError,
  type MigrationTargetManifest,
} from "./migration-manifest.js";

const DISCLAIMER =
  "A ready dossier is not permission for electrical work and is not a compatibility or liberation claim. The owner must explicitly authorize the documented target, and a competent installer must perform any physical work with power isolated.";
const MINIMUM_WINDOW_MS = 15 * 60 * 1000;
const MAXIMUM_WINDOW_MS = 24 * 60 * 60 * 1000;

interface StoredCheckpoint {
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly outcome: "blocked" | "confirmed";
  readonly stepId: MigrationStepId;
}

interface StoredAuthorization {
  readonly authorizedAt: string;
  readonly confirmation: typeof MIGRATION_AUTHORIZATION_PHRASE;
  readonly expiresAt: string;
  readonly prerequisiteFingerprint: string;
  readonly targetManifestSha256: string;
  readonly transport: MigrationAuthorizationInput["transport"];
}

export class MigrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationInputError";
  }
}

export class MigrationGateBlockedError extends Error {
  constructor() {
    super("Every pre-switch migration checkpoint must pass before owner authorization");
    this.name = "MigrationGateBlockedError";
  }
}

export function buildMigrationProjection(
  events: readonly EvidenceEvent[],
  now = new Date(),
): MigrationProjection {
  const preSwitchSteps = MIGRATION_STEPS.filter((step) => step.gate === "pre-switch").map(
    (definition) => preSwitchStep(definition, events),
  );
  const prerequisiteFingerprint = fingerprintPreSwitch(preSwitchSteps, events);
  const authorizationEvent = events.findLast(
    (event) => event.message === "MigrationEndpointChangeAuthorized",
  );
  const storedAuthorization = parseAuthorization(authorizationEvent?.payload);
  const matchingAuthorization =
    storedAuthorization?.prerequisiteFingerprint === prerequisiteFingerprint
      ? storedAuthorization
      : null;
  const authorization =
    authorizationEvent && matchingAuthorization
      ? authorizationProjection(authorizationEvent, matchingAuthorization, now)
      : null;
  const postSwitchSteps = MIGRATION_STEPS.filter((step) => step.gate === "post-switch").map(
    (definition) => postSwitchStep(definition, events, authorizationEvent, matchingAuthorization),
  );
  const steps = [...preSwitchSteps, ...postSwitchSteps];
  const preSwitchReady = preSwitchSteps.every((step) => step.state === "pass");
  const blocked = steps.some((step) => step.state === "fail");
  const postStarted = postSwitchSteps.some((step) => step.state !== "pending");
  const postComplete = postSwitchSteps.every((step) => step.state === "pass");
  const hasEvidence = steps.some((step) => step.state !== "pending") || authorization !== null;
  const status = blocked
    ? "blocked"
    : postComplete
      ? "online-path-observed-unreviewed"
      : postStarted
        ? "online-proof-in-progress"
        : authorization?.validForChange
          ? "owner-authorized-window"
          : preSwitchReady
            ? "ready-for-owner-confirmation"
            : hasEvidence
              ? "collecting"
              : "not-started";
  return {
    authorization,
    disclaimer: DISCLAIMER,
    preSwitchReady,
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    status,
    steps,
  };
}

export function buildMigrationReport(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  now = new Date(),
): MigrationReport {
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  return {
    evidenceChainHead: events.at(-1)?.recordHash ?? null,
    evidenceRecordCount: events.length,
    exportedAt: now.toISOString(),
    migration: buildMigrationProjection(stationEvents, now),
    reviewState: "unreviewed",
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    stationId: config.stationId,
  };
}

export async function recordMigrationCheckpoint(
  config: GatewayConfig,
  evidence: EvidenceStore,
  stepId: string,
  input: MigrationObservationInput,
): Promise<void> {
  const definition = MIGRATION_STEPS.find((step) => step.id === stepId);
  if (!definition || definition.source !== "owner-recorded") {
    throw new MigrationInputError("Unknown or automatically derived migration checkpoint");
  }
  const payload: StoredCheckpoint = {
    evidenceSha256: sha256(input.evidenceSha256, "evidenceSha256"),
    observedAt: observedTimestamp(input.observedAt),
    outcome: checkpointOutcome(input.outcome),
    stepId: definition.id,
  };
  await appendOwnerEvidence(config, evidence, "MigrationCheckpointRecorded", payload);
}

export async function authorizeMigrationWindow(
  config: GatewayConfig,
  evidence: EvidenceStore,
  input: MigrationAuthorizationInput,
  now = new Date(),
): Promise<MigrationAuthorization> {
  const events = await evidence.readEvents();
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  const projection = buildMigrationProjection(stationEvents, now);
  if (!projection.preSwitchReady || projection.steps.some((step) => step.state === "fail")) {
    throw new MigrationGateBlockedError();
  }
  if (input.confirmation !== MIGRATION_AUTHORIZATION_PHRASE) {
    throw new MigrationInputError("confirmation must exactly name the documented endpoint change");
  }
  const expiresAt = authorizationExpiry(input.expiresAt, now);
  const transport = migrationTransport(input.transport);
  let targetManifest: ReturnType<typeof inspectMigrationTargetManifest>;
  try {
    targetManifest = inspectMigrationTargetManifest(input.targetManifest);
  } catch (error) {
    if (error instanceof MigrationTargetManifestError) {
      throw new MigrationInputError(error.message);
    }
    throw error;
  }
  assertTargetManifestMatchesDossier(
    config,
    targetManifest.manifest,
    projection,
    stationEvents,
    transport,
    now,
  );
  const prerequisiteFingerprint = fingerprintPreSwitch(
    projection.steps.filter((step) => step.gate === "pre-switch"),
    stationEvents,
  );
  const authorizedAt = now.toISOString();
  const payload: StoredAuthorization = {
    authorizedAt,
    confirmation: MIGRATION_AUTHORIZATION_PHRASE,
    expiresAt,
    prerequisiteFingerprint,
    targetManifestSha256: targetManifest.sha256,
    transport,
  };
  await appendOwnerEvidence(config, evidence, "MigrationEndpointChangeAuthorized", payload);
  const event = (await evidence.readEvents()).findLast(
    (candidate) =>
      candidate.stationId === config.stationId &&
      candidate.message === "MigrationEndpointChangeAuthorized",
  );
  if (!event) throw new Error("Migration authorization was not persisted");
  return authorizationProjection(event, payload, now);
}

function assertTargetManifestMatchesDossier(
  config: GatewayConfig,
  manifest: MigrationTargetManifest,
  projection: MigrationProjection,
  events: readonly EvidenceEvent[],
  transport: MigrationAuthorizationInput["transport"],
  now: Date,
): void {
  const device = buildDeviceIdentity(events, null);
  if (!device) throw new MigrationInputError("Migration target requires exact device inventory");
  if (
    manifest.station.id !== config.stationId ||
    manifest.station.expectedVendor !== device.inventoryVendor ||
    manifest.station.expectedModel !== device.inventoryModel ||
    manifest.station.expectedFirmwareVersion !== device.inventoryFirmwareVersion ||
    manifest.procedure.configurationPath !== device.configurationPath ||
    manifest.evidence.deviceInventoryEvidenceSha256 !== device.inventoryEvidenceSha256
  ) {
    throw new MigrationInputError("Migration target does not match the evidenced device inventory");
  }
  if (manifest.target.transport !== transport) {
    throw new MigrationInputError("Migration target transport does not match owner authorization");
  }
  if (Date.parse(manifest.createdAt) > now.getTime()) {
    throw new MigrationInputError("Migration target manifest must not be created in the future");
  }
  const expectedEvidence: readonly [keyof MigrationTargetManifest["evidence"], MigrationStepId][] =
    [
      ["configurationBackupSha256", "configuration-backup"],
      ["configurationPathEvidenceSha256", "local-admin-custody"],
      ["continuityRestoreEvidenceSha256", "continuity-restore-drill"],
      ["credentialCustodyEvidenceSha256", "station-secret-preprovisioned"],
      ["standaloneRollbackEvidenceSha256", "standalone-rollback"],
      ["transactionExportSha256", "transaction-export"],
      ["transportValidationEvidenceSha256", "secure-transport-plan"],
    ];
  for (const [field, stepId] of expectedEvidence) {
    const step = projection.steps.find((candidate) => candidate.id === stepId);
    if (step?.externalEvidenceSha256 !== manifest.evidence[field]) {
      throw new MigrationInputError(`Migration target evidence does not match ${stepId}`);
    }
  }
}

function preSwitchStep(
  definition: MigrationStepDefinition,
  events: readonly EvidenceEvent[],
): MigrationStepResult {
  if (definition.id === "exact-device-identity") {
    const device = buildDeviceIdentity(events, null);
    const complete = Boolean(
      device?.articleNumber &&
      device.hardwareRevision &&
      device.inventoryVendor &&
      device.inventoryModel &&
      device.inventoryFirmwareVersion &&
      /^[a-f0-9]{64}$/.test(device.inventoryEvidenceSha256),
    );
    const inventory = latestDeviceInventoryEvent(events);
    const evidence = inventory ? [inventory] : [];
    return result(definition, complete ? "pass" : "pending", evidence, null);
  }
  const event = events.findLast(
    (candidate) =>
      candidate.message === "MigrationCheckpointRecorded" &&
      payloadRecord(candidate).stepId === definition.id,
  );
  const payload = payloadRecord(event);
  const state =
    payload.outcome === "confirmed" ? "pass" : payload.outcome === "blocked" ? "fail" : "pending";
  return result(
    definition,
    state,
    event ? [event] : [],
    typeof payload.evidenceSha256 === "string" ? payload.evidenceSha256 : null,
    typeof payload.observedAt === "string" ? payload.observedAt : null,
  );
}

function postSwitchStep(
  definition: MigrationStepDefinition,
  events: readonly EvidenceEvent[],
  authorizationEvent: EvidenceEvent | undefined,
  authorization: StoredAuthorization | null,
): MigrationStepResult {
  if (!authorizationEvent || !authorization) return result(definition, "pending", [], null);
  const authorizationIndex = events.indexOf(authorizationEvent);
  const expiry = Date.parse(authorization.expiresAt);
  const bootIndex = events.findIndex(
    (event, index) =>
      index > authorizationIndex &&
      event.message === "BootNotification" &&
      Date.parse(event.at) <= expiry,
  );
  if (bootIndex < 0) return result(definition, "pending", [], null);
  const boot = events[bootIndex]!;
  if (definition.id === "authorized-boot-observed") {
    const inventory = events.findLast(
      (event, index) => index < authorizationIndex && event.message === "FreedomTestDeviceRecorded",
    );
    const device = buildDeviceIdentity(events.slice(0, bootIndex + 1), boot);
    return result(
      definition,
      device?.identityMatch === "match" ? "pass" : "fail",
      inventory ? [inventory, boot] : [boot],
      null,
    );
  }
  if (definition.id === "authorized-status-observed") {
    const status = events.find(
      (event, index) => index > bootIndex && event.message === "StatusNotification",
    );
    return result(definition, status ? "pass" : "pending", status ? [status] : [], null);
  }
  if (definition.id === "authorized-capabilities-ready") {
    const inspection = events.findLast(
      (event, index) => index > bootIndex && event.message === "CapabilityInspection",
    );
    const inspectionState = payloadRecord(inspection).state;
    return result(
      definition,
      inspectionState === "ready" ? "pass" : inspection ? "fail" : "pending",
      inspection ? [inspection] : [],
      null,
    );
  }
  if (definition.id === "authorized-owner-list-accepted") {
    const accepted = authorizationEvidence(events.slice(bootIndex + 1));
    return result(definition, accepted.length ? "pass" : "pending", accepted, null);
  }
  const online = onlineEnergyEvidence(events.slice(bootIndex + 1));
  return result(definition, online.length ? "pass" : "pending", online, null);
}

function result(
  definition: MigrationStepDefinition,
  state: MigrationStepResult["state"],
  events: readonly EvidenceEvent[],
  externalEvidenceSha256: string | null,
  observedAt = events.at(-1)?.at ?? null,
): MigrationStepResult {
  return {
    ...definition,
    evidence: events.map(evidenceReference),
    externalEvidenceSha256,
    observedAt,
    state,
  };
}

function authorizationProjection(
  event: EvidenceEvent,
  authorization: StoredAuthorization,
  now: Date,
): MigrationAuthorization {
  return {
    authorizedAt: authorization.authorizedAt,
    eventId: event.eventId,
    expiresAt: authorization.expiresAt,
    prerequisiteFingerprint: authorization.prerequisiteFingerprint,
    targetManifestSha256: authorization.targetManifestSha256,
    transport: authorization.transport,
    validForChange: Date.parse(authorization.expiresAt) > now.getTime(),
  };
}

function fingerprintPreSwitch(
  steps: readonly MigrationStepResult[],
  events: readonly EvidenceEvent[],
): string {
  const device = buildDeviceIdentity(events, null);
  return createHash("sha256")
    .update(
      JSON.stringify(
        steps.map((step) =>
          step.id === "exact-device-identity"
            ? {
                device: device
                  ? {
                      articleNumber: device.articleNumber,
                      configurationPath: device.configurationPath,
                      connectivity: device.connectivity,
                      countryCode: device.countryCode,
                      hardwareRevision: device.hardwareRevision,
                      inventoryEvidenceSha256: device.inventoryEvidenceSha256,
                      inventoryFirmwareVersion: device.inventoryFirmwareVersion,
                      inventoryModel: device.inventoryModel,
                      inventoryVendor: device.inventoryVendor,
                      priorOperator: device.priorOperator,
                      recordedAt: device.recordedAt,
                    }
                  : null,
                id: step.id,
                state: step.state,
              }
            : {
                evidence: step.evidence,
                externalEvidenceSha256: step.externalEvidenceSha256,
                id: step.id,
                observedAt: step.observedAt,
                state: step.state,
              },
        ),
      ),
      "utf8",
    )
    .digest("hex");
}

function parseAuthorization(value: unknown): StoredAuthorization | null {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (
    typeof payload.authorizedAt !== "string" ||
    !normalizedIso(payload.authorizedAt) ||
    payload.confirmation !== MIGRATION_AUTHORIZATION_PHRASE ||
    typeof payload.expiresAt !== "string" ||
    !normalizedIso(payload.expiresAt) ||
    Date.parse(payload.expiresAt) <= Date.parse(payload.authorizedAt) ||
    Date.parse(payload.expiresAt) - Date.parse(payload.authorizedAt) > MAXIMUM_WINDOW_MS ||
    typeof payload.prerequisiteFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.prerequisiteFingerprint) ||
    typeof payload.targetManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.targetManifestSha256) ||
    !["internet-wss", "isolated-lan-ws"].includes(String(payload.transport))
  ) {
    return null;
  }
  return payload as unknown as StoredAuthorization;
}

function authorizationEvidence(events: readonly EvidenceEvent[]): readonly EvidenceEvent[] {
  const resultIndex = events.findLastIndex(
    (event) =>
      event.message === "SendLocalListResult" &&
      event.direction === "station-to-csms" &&
      payloadRecord(event).status === "Accepted",
  );
  if (resultIndex < 0) return [];
  const commandIndex = events.findLastIndex(
    (event, index) =>
      index < resultIndex &&
      event.message === "SendLocalList" &&
      event.direction === "csms-to-station",
  );
  return commandIndex < 0 ? [] : [events[commandIndex]!, events[resultIndex]!];
}

function onlineEnergyEvidence(events: readonly EvidenceEvent[]): readonly EvidenceEvent[] {
  for (let startIndex = events.length - 1; startIndex >= 0; startIndex -= 1) {
    const start = events[startIndex];
    if (!start || start.message !== "StartTransaction") continue;
    const startPayload = payloadRecord(start);
    const transactionId = startPayload.transactionId;
    const meterStart = startPayload.meterStart;
    if (
      startPayload.authorizationStatus !== "Accepted" ||
      typeof transactionId !== "number" ||
      typeof meterStart !== "number"
    ) {
      continue;
    }
    const meter = events.find(
      (event, index) =>
        index > startIndex &&
        event.message === "MeterValues" &&
        payloadRecord(event).transactionId === transactionId,
    );
    const stop = events.find(
      (event, index) =>
        index > startIndex &&
        event.message === "StopTransaction" &&
        payloadRecord(event).transactionId === transactionId,
    );
    const meterStop = payloadRecord(stop).meterStop;
    if (meter && stop && typeof meterStop === "number" && meterStop > meterStart) {
      return [start, meter, stop];
    }
  }
  return [];
}

function evidenceReference(event: EvidenceEvent): MigrationEvidenceReference {
  return { at: event.at, eventId: event.eventId, recordHash: event.recordHash ?? null };
}

function payloadRecord(event: EvidenceEvent | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

async function appendOwnerEvidence(
  config: GatewayConfig,
  evidence: EvidenceStore,
  message: string,
  payload: unknown,
): Promise<void> {
  const sourcePayloadHmac = createHmac("sha256", config.stationSecret)
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
  await evidence.append(
    evidenceEvent(config.stationId, "system", message, payload, sourcePayloadHmac),
  );
}

function observedTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new MigrationInputError("observedAt must be an ISO timestamp");
  }
  const timestamp = new Date(value);
  if (timestamp.getTime() > Date.now() + 5 * 60_000) {
    throw new MigrationInputError("observedAt must not be in the future");
  }
  return timestamp.toISOString();
}

function authorizationExpiry(value: unknown, now: Date): string {
  if (typeof value !== "string" || !normalizedIso(value)) {
    throw new MigrationInputError("expiresAt must be a normalized ISO timestamp");
  }
  const lifetime = Date.parse(value) - now.getTime();
  if (lifetime < MINIMUM_WINDOW_MS || lifetime > MAXIMUM_WINDOW_MS) {
    throw new MigrationInputError("authorization must expire between 15 minutes and 24 hours");
  }
  return value;
}

function normalizedIso(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new MigrationInputError(`${field} must be a 64-character SHA-256 digest`);
  }
  return value.toLowerCase();
}

function checkpointOutcome(value: unknown): StoredCheckpoint["outcome"] {
  if (value !== "confirmed" && value !== "blocked") {
    throw new MigrationInputError("outcome must be confirmed or blocked");
  }
  return value;
}

function migrationTransport(value: unknown): MigrationAuthorizationInput["transport"] {
  if (value !== "internet-wss" && value !== "isolated-lan-ws") {
    throw new MigrationInputError("transport must be internet-wss or isolated-lan-ws");
  }
  return value;
}
