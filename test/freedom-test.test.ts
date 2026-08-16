import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "../server/events.js";
import {
  buildFreedomTestProjection,
  buildFreedomTestReport,
  FreedomTestInputError,
  recordFreedomTestDevice,
  recordFreedomTestObservation,
  startFreedomTestRun,
} from "../server/freedom-test.js";
import {
  FREEDOM_TEST_RUN_CONFIRMATION_PHRASE,
  FREEDOM_TEST_STEPS,
} from "../shared/freedom-test.js";
import { authorizeMigrationWindow, recordMigrationCheckpoint } from "../server/migration.js";
import { MIGRATION_AUTHORIZATION_PHRASE, MIGRATION_STEPS } from "../shared/migration.js";
import { migrationTargetForEvidence } from "./helpers/migration-target.js";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[];

  constructor(events: EvidenceEvent[]) {
    this.events = events;
  }

  async allocateAuthorizationRevision(): Promise<number> {
    return 1;
  }

  async recordTransactionStart(): Promise<{ replayed: boolean; transactionId: number }> {
    return { replayed: false, transactionId: 1 };
  }

  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }

  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

describe("Freedom Test evidence", () => {
  it("combines protocol evidence with witnessed hashes without claiming certification", async () => {
    const store = await automaticEvidence();
    const events = store.events;
    const runId = await startRun(store);
    for (const step of FREEDOM_TEST_STEPS.filter((candidate) => candidate.source === "witnessed")) {
      await recordFreedomTestObservation(config, store, step.id, {
        evidenceSha256: "a".repeat(64),
        observedAt: new Date().toISOString(),
        outcome: "pass",
        runId,
      });
    }

    const projection = buildFreedomTestProjection(events);
    expect(projection.status).toBe("evidence-complete-unreviewed");
    expect(projection.device).toMatchObject({
      articleNumber: "904460023",
      countryCode: "BE",
      firmwareVersion: "7.1.0",
      identityMatch: "match",
      inventoryEvidenceSha256: "c".repeat(64),
      model: "Eve Single S-line",
      vendor: "Alfen",
    });
    expect(projection.steps).toHaveLength(10);
    expect(projection.steps.every((step) => step.state === "pass")).toBe(true);

    const report = buildFreedomTestReport(config, events);
    expect(report.reviewState).toBe("unreviewed");
    expect(report.reportVersion).toBe(3);
    expect(report.test.disclaimer).toContain("not certification");
  });

  it("keeps a locally evidenced inventory incomplete when the observed Boot identity differs", async () => {
    const store = await automaticEvidence("7.2.0");

    const projection = buildFreedomTestProjection(store.events);
    expect(projection.device?.identityMatch).toBe("mismatch");
    expect(projection.status).toBe("in-progress");
  });

  it("does not treat protocol traffic from before owner authorization as field-test proof", async () => {
    const store = new MemoryEvidenceStore(protocolEvidence());
    await recordFreedomTestDevice(config, store, {
      articleNumber: "904460023",
      configurationPath: "ACE Service Installer > Connectivity > Backoffice",
      connectivity: "ethernet",
      countryCode: "BE",
      evidenceSha256: "c".repeat(64),
      hardwareRevision: "NG910",
      inventoryFirmwareVersion: "7.1.0",
      inventoryModel: "Eve Single S-line",
      inventoryVendor: "Alfen",
      priorOperator: "Prior operator",
    });

    const projection = buildFreedomTestProjection(store.events);
    expect(projection.device?.identityMatch).toBe("pending");
    expect(
      projection.steps
        .filter((step) => step.source === "automatic")
        .every((step) => step.state === "pending"),
    ).toBe(true);
  });

  it("does not count an invalid-tag transaction as owner energy delivery", async () => {
    const store = await automaticEvidence();
    const events = store.events.map((event) =>
      event.message === "StartTransaction"
        ? {
            ...event,
            payload: {
              ...(event.payload as Record<string, unknown>),
              authorizationStatus: "Invalid",
            },
          }
        : event,
    );

    expect(
      buildFreedomTestProjection(events).steps.find((step) => step.id === "online-energy-delivered")
        ?.state,
    ).toBe("pending");
  });

  it("fails closed for invalid or automatic observations and preserves the latest failure", async () => {
    const store = await automaticEvidence();
    const runId = await startRun(store);
    await expect(
      recordFreedomTestObservation(config, store, "authorization-synchronized", {
        evidenceSha256: "b".repeat(64),
        observedAt: new Date().toISOString(),
        outcome: "pass",
        runId,
      }),
    ).rejects.toBeInstanceOf(FreedomTestInputError);
    await expect(
      recordFreedomTestObservation(config, store, "unknown-tag-rejected-offline", {
        evidenceSha256: "not-a-digest",
        observedAt: new Date().toISOString(),
        outcome: "pass",
        runId,
      }),
    ).rejects.toBeInstanceOf(FreedomTestInputError);

    await recordFreedomTestObservation(config, store, "unknown-tag-rejected-offline", {
      evidenceSha256: "b".repeat(64),
      observedAt: new Date().toISOString(),
      outcome: "fail",
      runId,
    });
    expect(buildFreedomTestProjection(store.events).status).toBe("failed");
  });

  it("does not carry witnessed outcomes onto a changed device baseline", async () => {
    const store = await automaticEvidence();
    const runId = await startRun(store);
    await recordFreedomTestObservation(config, store, "unknown-tag-rejected-offline", {
      evidenceSha256: "b".repeat(64),
      observedAt: new Date().toISOString(),
      outcome: "pass",
      runId,
    });

    await recordFreedomTestDevice(config, store, {
      articleNumber: "904460024",
      configurationPath: "ACE Service Installer > Connectivity > Backoffice",
      connectivity: "ethernet",
      countryCode: "BE",
      evidenceSha256: "d".repeat(64),
      hardwareRevision: "NG920",
      inventoryFirmwareVersion: "7.2.0",
      inventoryModel: "Eve Single Pro-line",
      inventoryVendor: "Alfen",
      priorOperator: "Prior operator",
    });

    const projection = buildFreedomTestProjection(store.events);
    expect(projection.status).toBe("baseline-stale");
    expect(projection.run).toMatchObject({ runId, state: "stale" });
    await expect(
      recordFreedomTestObservation(config, store, "unknown-tag-rejected-offline", {
        evidenceSha256: "e".repeat(64),
        observedAt: new Date().toISOString(),
        outcome: "pass",
        runId,
      }),
    ).rejects.toThrow(/active Freedom Test run/);
  });

  it("ignores legacy observations that are not bound to a field run", async () => {
    const store = await automaticEvidence();
    store.events.push(
      evidenceEvent("ALFEN_TEST", "system", "FreedomTestObservation", {
        evidenceSha256: "a".repeat(64),
        observedAt: new Date().toISOString(),
        outcome: "pass",
        stepId: "unknown-tag-rejected-offline",
      }),
    );

    expect(
      buildFreedomTestProjection(store.events).steps.find(
        (step) => step.id === "unknown-tag-rejected-offline",
      )?.state,
    ).toBe("pending");
  });
});

const config: GatewayConfig = {
  apiHost: "127.0.0.1",
  apiPort: 9080,
  eventLogPath: "unused.ndjson",
  eventLogMaxBytes: 268_435_456,
  heartbeatSeconds: 60,
  ocppHost: "127.0.0.1",
  ocppMaxConnections: 8,
  ocppMaxPayloadBytes: 1_048_576,
  ocppMessageBurst: 60,
  ocppMessagesPerMinute: 600,
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set(["owner-tag"]),
  port: 9000,
  stationId: "ALFEN_TEST",
  stationSecret: "station-secret-at-least-sixteen",
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

async function automaticEvidence(inventoryFirmwareVersion = "7.1.0"): Promise<MemoryEvidenceStore> {
  const store = new MemoryEvidenceStore([]);
  await recordFreedomTestDevice(config, store, {
    articleNumber: "904460023",
    configurationPath: "ACE Service Installer > Connectivity > Backoffice",
    connectivity: "ethernet",
    countryCode: "be",
    evidenceSha256: "c".repeat(64),
    hardwareRevision: "NG910",
    inventoryFirmwareVersion,
    inventoryModel: "Eve Single S-line",
    inventoryVendor: "Alfen",
    priorOperator: "Prior operator",
  });
  const now = new Date();
  for (const [index, step] of MIGRATION_STEPS.filter(
    (candidate) => candidate.gate === "pre-switch" && candidate.source === "owner-recorded",
  ).entries()) {
    await recordMigrationCheckpoint(config, store, step.id, {
      evidenceSha256: (index + 1).toString(16).padStart(64, "0"),
      observedAt: now.toISOString(),
      outcome: "confirmed",
    });
  }
  await authorizeMigrationWindow(
    config,
    store,
    {
      confirmation: MIGRATION_AUTHORIZATION_PHRASE,
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      targetManifest: migrationTargetForEvidence(config, store.events, "isolated-lan-ws", now),
      transport: "isolated-lan-ws",
    },
    now,
  );
  store.events.push(...protocolEvidence());
  return store;
}

function protocolEvidence(): EvidenceEvent[] {
  return [
    evidenceEvent("ALFEN_TEST", "station-to-csms", "BootNotification", {
      chargePointModel: "Eve Single S-line",
      chargePointVendor: "Alfen",
      firmwareVersion: "7.1.0",
    }),
    evidenceEvent("ALFEN_TEST", "station-to-csms", "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Available",
    }),
    evidenceEvent("ALFEN_TEST", "system", "CapabilityInspection", { state: "ready" }),
    evidenceEvent("ALFEN_TEST", "csms-to-station", "SendLocalList", { listVersion: 1 }),
    evidenceEvent("ALFEN_TEST", "station-to-csms", "SendLocalListResult", {
      status: "Accepted",
    }),
    evidenceEvent("ALFEN_TEST", "station-to-csms", "StartTransaction", {
      authorizationStatus: "Accepted",
      connectorId: 1,
      idTag: "tag_pseudonym",
      meterStart: 10_000,
      timestamp: "2026-08-14T10:00:00.000Z",
      transactionId: 1,
    }),
    evidenceEvent("ALFEN_TEST", "station-to-csms", "MeterValues", { transactionId: 1 }),
    evidenceEvent("ALFEN_TEST", "station-to-csms", "StopTransaction", {
      meterStop: 11_000,
      timestamp: "2026-08-14T10:30:00.000Z",
      transactionId: 1,
    }),
    evidenceEvent("ALFEN_TEST", "system", "AuthorizationDecision", {
      idTag: "tag_unknown_pseudonym",
      status: "Invalid",
    }),
  ];
}

async function startRun(store: MemoryEvidenceStore): Promise<string> {
  await startFreedomTestRun(config, store, {
    confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE,
  });
  const runId = buildFreedomTestProjection(store.events).run?.runId;
  if (!runId) throw new Error("Freedom Test run was not created");
  return runId;
}
