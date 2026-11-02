import { createHmac, randomUUID } from "node:crypto";

import {
  FREEDOM_TEST_RUN_CONFIRMATION_PHRASE,
  FREEDOM_TEST_SCHEMA_VERSION,
  FREEDOM_TEST_STEPS,
  type FreedomTestDeviceIdentity,
  type FreedomTestDeviceInput,
  type FreedomTestEvidenceReference,
  type FreedomTestProjection,
  type FreedomTestReport,
  type FreedomTestObservationInput,
  type FreedomTestRun,
  type FreedomTestRunInput,
  type FreedomTestStepId,
  type FreedomTestStepResult,
} from "../shared/freedom-test.js";
import type { GatewayConfig } from "./config.js";
import {
  buildDeviceIdentity,
  latestDeviceInventoryEvent,
  type StoredDeviceInventory,
} from "./device.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";
import { buildMigrationProjection } from "./migration.js";

const DISCLAIMER =
  "Evidence completeness is not certification. Review the exact device, environment, external artifacts, and physical test before publishing a Freedom grade.";

interface StoredObservation {
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly outcome: "pass" | "fail";
  readonly runId: string;
  readonly stepId: FreedomTestStepId;
}

interface StoredRun {
  readonly authorizedBoot: FreedomTestEvidenceReference;
  readonly confirmation: typeof FREEDOM_TEST_RUN_CONFIRMATION_PHRASE;
  readonly deviceInventory: FreedomTestEvidenceReference;
  readonly migrationAuthorization: FreedomTestEvidenceReference;
  readonly runId: string;
  readonly runSchemaVersion: typeof FREEDOM_TEST_SCHEMA_VERSION;
  readonly startedAt: string;
}

export function buildFreedomTestProjection(
  events: readonly EvidenceEvent[],
): FreedomTestProjection {
  const migration = buildMigrationProjection(events);
  const authorizedBootStep = migration.steps.find((step) => step.id === "authorized-boot-observed");
  const authorizedBootId = authorizedBootStep?.evidence.at(-1)?.eventId;
  const bootIndex = authorizedBootId
    ? events.findIndex((event) => event.eventId === authorizedBootId)
    : -1;
  const authorizedBoot = bootIndex >= 0 ? events[bootIndex]! : null;
  const protocolEvents = bootIndex >= 0 ? events.slice(bootIndex) : [];
  const device = buildDeviceIdentity(events, authorizedBoot);
  const currentBaseline = freedomTestBaseline(events);
  const runEvent = events.findLast((event) => event.message === "FreedomTestRunStarted");
  const runIndex = runEvent ? events.indexOf(runEvent) : -1;
  const storedRun = parseRun(runEvent?.payload);
  const runState = storedRun && baselineMatches(storedRun, currentBaseline) ? "active" : "stale";
  const run: FreedomTestRun | null = storedRun
    ? {
        authorizedBoot: storedRun.authorizedBoot,
        deviceInventory: storedRun.deviceInventory,
        migrationAuthorization: storedRun.migrationAuthorization,
        runId: storedRun.runId,
        startedAt: storedRun.startedAt,
        state: runState,
      }
    : null;
  const steps = FREEDOM_TEST_STEPS.map((definition) =>
    definition.source === "automatic"
      ? automaticStep(definition.id, definition.label, protocolEvents)
      : witnessedStep(
          definition.id,
          definition.label,
          runIndex >= 0 ? events.slice(runIndex + 1) : [],
          storedRun?.runId ?? null,
        ),
  );
  const hasEvidence = Boolean(device || run || steps.some((step) => step.state !== "pending"));
  const deviceComplete = Boolean(
    device?.articleNumber && device.hardwareRevision && device.identityMatch === "match",
  );
  const status =
    run?.state === "stale"
      ? "baseline-stale"
      : steps.some((step) => step.state === "fail")
        ? "failed"
        : run?.state === "active" && deviceComplete && steps.every((step) => step.state === "pass")
          ? "evidence-complete-unreviewed"
          : hasEvidence
            ? "in-progress"
            : "not-started";
  return {
    device,
    disclaimer: DISCLAIMER,
    run,
    schemaVersion: FREEDOM_TEST_SCHEMA_VERSION,
    status,
    steps,
  };
}

export function buildFreedomTestReport(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  now = new Date(),
): FreedomTestReport {
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  return {
    evidenceChainHead: events.at(-1)?.recordHash ?? null,
    evidenceRecordCount: events.length,
    generatedAt: now.toISOString(),
    reportVersion: FREEDOM_TEST_SCHEMA_VERSION,
    reviewState: "unreviewed",
    stationId: config.stationId,
    test: buildFreedomTestProjection(stationEvents),
  };
}

export async function startFreedomTestRun(
  config: GatewayConfig,
  evidence: EvidenceStore,
  input: FreedomTestRunInput,
  now = new Date(),
): Promise<void> {
  if (input.confirmation !== FREEDOM_TEST_RUN_CONFIRMATION_PHRASE) {
    throw new FreedomTestInputError(
      "confirmation must exactly name the witnessed Freedom Test baseline",
    );
  }
  const events = (await evidence.readEvents()).filter(
    (event) => event.stationId === config.stationId,
  );
  const projection = buildFreedomTestProjection(events);
  const baseline = freedomTestBaseline(events);
  if (
    !baseline ||
    projection.device?.identityMatch !== "match" ||
    projection.steps
      .filter((step) => step.source === "automatic")
      .some((step) => step.state !== "pass")
  ) {
    throw new FreedomTestInputError(
      "A matching authorized boot and every automatic online proof are required before starting a field run",
    );
  }
  const payload: StoredRun = {
    ...baseline,
    confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE,
    runId: randomUUID(),
    runSchemaVersion: FREEDOM_TEST_SCHEMA_VERSION,
    startedAt: now.toISOString(),
  };
  await appendOwnerEvidence(config, evidence, "FreedomTestRunStarted", payload);
}

export async function recordFreedomTestDevice(
  config: GatewayConfig,
  evidence: EvidenceStore,
  input: FreedomTestDeviceInput,
): Promise<void> {
  const payload: StoredDeviceInventory = {
    articleNumber: requiredText(input.articleNumber, "articleNumber", 100),
    configurationPath: requiredText(input.configurationPath, "configurationPath", 240),
    connectivity: connectivity(input.connectivity),
    countryCode: countryCode(input.countryCode),
    evidenceSha256: sha256(input.evidenceSha256),
    hardwareRevision: requiredText(input.hardwareRevision, "hardwareRevision", 100),
    inventoryFirmwareVersion: requiredText(
      input.inventoryFirmwareVersion,
      "inventoryFirmwareVersion",
      50,
    ),
    inventoryModel: requiredText(input.inventoryModel, "inventoryModel", 20),
    inventorySchemaVersion: 2,
    inventoryVendor: requiredText(input.inventoryVendor, "inventoryVendor", 20),
    priorOperator: requiredText(input.priorOperator, "priorOperator", 120),
    recordedAt: new Date().toISOString(),
  };
  await appendOwnerEvidence(config, evidence, "FreedomTestDeviceRecorded", payload);
}

export async function recordFreedomTestObservation(
  config: GatewayConfig,
  evidence: EvidenceStore,
  stepId: string,
  input: FreedomTestObservationInput,
): Promise<void> {
  const definition = FREEDOM_TEST_STEPS.find((step) => step.id === stepId);
  if (!definition || definition.source !== "witnessed") {
    throw new FreedomTestInputError("Unknown or automatically derived Freedom Test step");
  }
  const runId = uuid(input.runId, "runId");
  const events = (await evidence.readEvents()).filter(
    (event) => event.stationId === config.stationId,
  );
  const run = buildFreedomTestProjection(events).run;
  if (!run || run.state !== "active" || run.runId !== runId) {
    throw new FreedomTestInputError(
      "runId must name the active Freedom Test run for the current device and migration baseline",
    );
  }
  const observedAt = timestamp(input.observedAt);
  const payload: StoredObservation = {
    evidenceSha256: sha256(input.evidenceSha256),
    observedAt,
    outcome: outcome(input.outcome),
    runId,
    stepId: definition.id,
  };
  await appendOwnerEvidence(config, evidence, "FreedomTestObservation", payload);
}

export class FreedomTestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreedomTestInputError";
  }
}

function automaticStep(
  id: FreedomTestStepId,
  label: string,
  events: readonly EvidenceEvent[],
): FreedomTestStepResult {
  let matching: readonly EvidenceEvent[] = [];
  if (id === "authorization-synchronized") matching = authorizationEvidence(events);
  if (id === "online-energy-delivered") matching = onlineEnergyEvidence(events);
  if (id === "unknown-tag-rejected-online") matching = unknownTagEvidence(events);
  return {
    evidence: matching.map(evidenceReference),
    externalEvidenceSha256: null,
    id,
    label,
    observedAt: matching.at(-1)?.at ?? null,
    source: "automatic",
    state: matching.length ? "pass" : "pending",
  };
}

function witnessedStep(
  id: FreedomTestStepId,
  label: string,
  events: readonly EvidenceEvent[],
  runId: string | null,
): FreedomTestStepResult {
  const event = events.findLast(
    (candidate) =>
      candidate.message === "FreedomTestObservation" &&
      payloadRecord(candidate).stepId === id &&
      payloadRecord(candidate).runId === runId,
  );
  const observation = payloadRecord(event);
  const state =
    observation.outcome === "pass" || observation.outcome === "fail"
      ? observation.outcome
      : "pending";
  return {
    evidence: event ? [evidenceReference(event)] : [],
    externalEvidenceSha256:
      typeof observation.evidenceSha256 === "string" ? observation.evidenceSha256 : null,
    id,
    label,
    observedAt: typeof observation.observedAt === "string" ? observation.observedAt : null,
    source: "witnessed",
    state,
  };
}

function freedomTestBaseline(
  events: readonly EvidenceEvent[],
): Pick<StoredRun, "authorizedBoot" | "deviceInventory" | "migrationAuthorization"> | null {
  const migration = buildMigrationProjection(events);
  if (migration.status !== "online-path-observed-unreviewed" || !migration.authorization) {
    return null;
  }
  const bootId = migration.steps
    .find((step) => step.id === "authorized-boot-observed")
    ?.evidence.at(-1)?.eventId;
  const inventory = latestDeviceInventoryEvent(events);
  const authorization = events.find((event) => event.eventId === migration.authorization?.eventId);
  const boot = events.find((event) => event.eventId === bootId);
  if (!inventory || !authorization || !boot) return null;
  return {
    authorizedBoot: evidenceReference(boot),
    deviceInventory: evidenceReference(inventory),
    migrationAuthorization: evidenceReference(authorization),
  };
}

function parseRun(value: unknown): StoredRun | null {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const authorizedBoot = parseEvidenceReference(payload.authorizedBoot);
  const deviceInventory = parseEvidenceReference(payload.deviceInventory);
  const migrationAuthorization = parseEvidenceReference(payload.migrationAuthorization);
  if (
    payload.runSchemaVersion !== FREEDOM_TEST_SCHEMA_VERSION ||
    payload.confirmation !== FREEDOM_TEST_RUN_CONFIRMATION_PHRASE ||
    typeof payload.runId !== "string" ||
    !isUuid(payload.runId) ||
    typeof payload.startedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.startedAt)) ||
    !authorizedBoot ||
    !deviceInventory ||
    !migrationAuthorization
  ) {
    return null;
  }
  return {
    authorizedBoot,
    confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE,
    deviceInventory,
    migrationAuthorization,
    runId: payload.runId,
    runSchemaVersion: FREEDOM_TEST_SCHEMA_VERSION,
    startedAt: payload.startedAt,
  };
}

function parseEvidenceReference(value: unknown): FreedomTestEvidenceReference | null {
  const reference = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (
    typeof reference.eventId !== "string" ||
    (reference.recordHash !== null && typeof reference.recordHash !== "string")
  ) {
    return null;
  }
  return { eventId: reference.eventId, recordHash: reference.recordHash as string | null };
}

function baselineMatches(
  run: StoredRun,
  baseline: ReturnType<typeof freedomTestBaseline>,
): boolean {
  return Boolean(
    baseline &&
    run.authorizedBoot.eventId === baseline.authorizedBoot.eventId &&
    run.deviceInventory.eventId === baseline.deviceInventory.eventId &&
    run.migrationAuthorization.eventId === baseline.migrationAuthorization.eventId,
  );
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
    if (meter && stop) {
      const meterStop = payloadRecord(stop).meterStop;
      if (typeof meterStop === "number" && meterStop > meterStart) return [start, meter, stop];
    }
  }
  return [];
}

function unknownTagEvidence(events: readonly EvidenceEvent[]): readonly EvidenceEvent[] {
  const event = events.findLast(
    (candidate) =>
      candidate.message === "AuthorizationDecision" &&
      payloadRecord(candidate).status === "Invalid",
  );
  return event ? [event] : [];
}

function evidenceReference(event: EvidenceEvent): FreedomTestEvidenceReference {
  return { eventId: event.eventId, recordHash: event.recordHash ?? null };
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

function requiredText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximumLength) {
    throw new FreedomTestInputError(`${field} must be 1-${maximumLength} characters`);
  }
  return value.trim();
}

function countryCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim())) {
    throw new FreedomTestInputError("countryCode must be a two-letter country code");
  }
  return value.trim().toUpperCase();
}

function connectivity(value: unknown): FreedomTestDeviceIdentity["connectivity"] {
  if (!["ethernet", "wifi", "cellular", "mixed", "other"].includes(String(value))) {
    throw new FreedomTestInputError("connectivity is not supported");
  }
  return value as FreedomTestDeviceIdentity["connectivity"];
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new FreedomTestInputError("observedAt must be an ISO timestamp");
  }
  const date = new Date(value);
  if (date.getTime() > Date.now() + 5 * 60_000) {
    throw new FreedomTestInputError("observedAt must not be in the future");
  }
  return date.toISOString();
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new FreedomTestInputError("evidenceSha256 must be a 64-character SHA-256 digest");
  }
  return value.toLowerCase();
}

function outcome(value: unknown): "pass" | "fail" {
  if (value !== "pass" && value !== "fail") {
    throw new FreedomTestInputError("outcome must be pass or fail");
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new FreedomTestInputError(`${field} must be a UUID`);
  }
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
