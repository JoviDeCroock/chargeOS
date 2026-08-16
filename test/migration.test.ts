import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "../server/events.js";
import {
  authorizeMigrationWindow,
  buildMigrationProjection,
  buildMigrationReport,
  MigrationGateBlockedError,
  MigrationInputError,
  recordMigrationCheckpoint,
} from "../server/migration.js";
import { MIGRATION_AUTHORIZATION_PHRASE, MIGRATION_STEPS } from "../shared/migration.js";
import { migrationTargetForEvidence } from "./helpers/migration-target.js";

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
  ownerTags: new Set(["raw-owner-tag"]),
  port: 9000,
  stationId: "STATION_1",
  stationSecret: "station-secret-at-least-sixteen",
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
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

describe("migration dossier", () => {
  it("gates owner authorization and derives online proof only from the authorized window", async () => {
    const evidence = new MemoryEvidenceStore();
    evidence.events.push(
      at(
        evidenceEvent("STATION_1", "system", "FreedomTestDeviceRecorded", {
          articleNumber: "904460023",
          configurationPath: "ACE > Connectivity > Backoffice",
          connectivity: "ethernet",
          countryCode: "BE",
          evidenceSha256: "d".repeat(64),
          hardwareRevision: "NG910",
          inventoryFirmwareVersion: "7.1.0",
          inventoryModel: "Eve Single S-line",
          inventorySchemaVersion: 2,
          inventoryVendor: "Alfen",
          priorOperator: "Prior operator",
          recordedAt: "2026-08-14T10:00:00.000Z",
        }),
        "2026-08-14T10:00:00.000Z",
      ),
    );
    for (const [index, step] of MIGRATION_STEPS.filter(
      (candidate) => candidate.gate === "pre-switch" && candidate.source === "owner-recorded",
    ).entries()) {
      await recordMigrationCheckpoint(config, evidence, step.id, {
        evidenceSha256: (index + 1).toString(16).padStart(64, "0"),
        observedAt: "2026-08-14T11:00:00.000Z",
        outcome: "confirmed",
      });
    }

    expect(buildMigrationProjection(evidence.events).status).toBe("ready-for-owner-confirmation");
    expect(buildMigrationProjection(evidence.events).schemaVersion).toBe(2);
    const authorizationTime = new Date("2026-08-14T12:00:00.000Z");
    const validTarget = migrationTargetForEvidence(
      config,
      evidence.events,
      "isolated-lan-ws",
      authorizationTime,
    );
    const mismatchedEvidence = JSON.parse(validTarget) as Record<string, Record<string, unknown>>;
    mismatchedEvidence.evidence!.configurationBackupSha256 = "e".repeat(64);
    await expect(
      authorizeMigrationWindow(
        config,
        evidence,
        {
          confirmation: MIGRATION_AUTHORIZATION_PHRASE,
          expiresAt: "2026-08-14T13:00:00.000Z",
          targetManifest: JSON.stringify(mismatchedEvidence),
          transport: "isolated-lan-ws",
        },
        authorizationTime,
      ),
    ).rejects.toThrow("configuration-backup");
    const mismatchedDevice = JSON.parse(validTarget) as Record<string, Record<string, unknown>>;
    mismatchedDevice.station!.expectedModel = "Different evidenced model";
    await expect(
      authorizeMigrationWindow(
        config,
        evidence,
        {
          confirmation: MIGRATION_AUTHORIZATION_PHRASE,
          expiresAt: "2026-08-14T13:00:00.000Z",
          targetManifest: JSON.stringify(mismatchedDevice),
          transport: "isolated-lan-ws",
        },
        authorizationTime,
      ),
    ).rejects.toThrow("does not match the evidenced device inventory");
    await expect(
      authorizeMigrationWindow(
        config,
        evidence,
        {
          confirmation: MIGRATION_AUTHORIZATION_PHRASE,
          expiresAt: "2026-08-14T13:00:00.000Z",
          targetManifest: migrationTargetForEvidence(
            config,
            evidence.events,
            "internet-wss",
            authorizationTime,
          ),
          transport: "isolated-lan-ws",
        },
        authorizationTime,
      ),
    ).rejects.toThrow("transport does not match owner authorization");
    const authorization = await authorizeMigrationWindow(
      config,
      evidence,
      {
        confirmation: MIGRATION_AUTHORIZATION_PHRASE,
        expiresAt: "2026-08-14T13:00:00.000Z",
        targetManifest: validTarget,
        transport: "isolated-lan-ws",
      },
      authorizationTime,
    );
    expect(authorization.validForChange).toBe(true);
    expect(
      buildMigrationProjection(evidence.events, new Date("2026-08-14T12:05:00.000Z")).status,
    ).toBe("owner-authorized-window");

    const afterWindowBoot = [
      ...evidence.events,
      at(
        evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
          chargePointModel: "Eve Single S-line",
          chargePointVendor: "Alfen",
          firmwareVersion: "7.1.0",
        }),
        "2026-08-14T13:01:00.000Z",
      ),
    ];
    const expired = buildMigrationProjection(afterWindowBoot, new Date("2026-08-14T14:00:00.000Z"));
    expect(expired.status).toBe("ready-for-owner-confirmation");
    expect(expired.authorization?.validForChange).toBe(false);
    expect(expired.steps.find((step) => step.id === "authorized-boot-observed")?.state).toBe(
      "pending",
    );

    evidence.events.push(
      at(
        evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
          chargePointModel: "Eve Single S-line",
          chargePointVendor: "Alfen",
          firmwareVersion: "7.1.0",
        }),
        "2026-08-14T12:10:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "station-to-csms", "StatusNotification", {
          connectorId: 1,
          errorCode: "NoError",
          status: "Available",
        }),
        "2026-08-14T12:11:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "system", "CapabilityInspection", { state: "ready" }),
        "2026-08-14T12:12:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", { listVersion: 2 }),
        "2026-08-14T12:13:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "station-to-csms", "SendLocalListResult", {
          status: "Accepted",
        }),
        "2026-08-14T12:14:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
          authorizationStatus: "Accepted",
          connectorId: 1,
          meterStart: 100,
          transactionId: 4,
        }),
        "2026-08-14T12:15:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "station-to-csms", "MeterValues", { transactionId: 4 }),
        "2026-08-14T12:16:00.000Z",
      ),
      at(
        evidenceEvent("STATION_1", "station-to-csms", "StopTransaction", {
          meterStop: 900,
          transactionId: 4,
        }),
        "2026-08-14T12:30:00.000Z",
      ),
    );

    const completed = buildMigrationProjection(
      evidence.events,
      new Date("2026-08-14T14:00:00.000Z"),
    );
    expect(completed.status).toBe("online-path-observed-unreviewed");
    expect(
      completed.steps
        .filter((step) => step.gate === "post-switch")
        .every((step) => step.state === "pass"),
    ).toBe(true);
    expect(buildMigrationReport(config, evidence.events).reviewState).toBe("unreviewed");

    const invalidTransaction = evidence.events.map((event) =>
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
      buildMigrationProjection(invalidTransaction).steps.find(
        (step) => step.id === "authorized-online-energy-session",
      )?.state,
    ).toBe("pending");

    await recordMigrationCheckpoint(config, evidence, "network-sim-custody", {
      evidenceSha256: "e".repeat(64),
      observedAt: "2026-08-14T14:01:00.000Z",
      outcome: "confirmed",
    });
    const stale = buildMigrationProjection(evidence.events);
    expect(stale.authorization).toBeNull();
    expect(stale.steps.find((step) => step.id === "authorized-boot-observed")?.state).toBe(
      "pending",
    );
  });

  it("fails closed for missing, blocked, automatic, and malformed evidence", async () => {
    const evidence = new MemoryEvidenceStore();
    await expect(
      authorizeMigrationWindow(
        config,
        evidence,
        {
          confirmation: MIGRATION_AUTHORIZATION_PHRASE,
          expiresAt: "2026-08-14T13:00:00.000Z",
          targetManifest: "{}",
          transport: "internet-wss",
        },
        new Date("2026-08-14T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(MigrationGateBlockedError);
    await expect(
      recordMigrationCheckpoint(config, evidence, "authorized-boot-observed", {
        evidenceSha256: "a".repeat(64),
        observedAt: "2026-08-14T11:00:00.000Z",
        outcome: "confirmed",
      }),
    ).rejects.toBeInstanceOf(MigrationInputError);
    await recordMigrationCheckpoint(config, evidence, "ownership-authority", {
      evidenceSha256: "b".repeat(64),
      observedAt: "2026-08-14T11:00:00.000Z",
      outcome: "blocked",
    });
    expect(buildMigrationProjection(evidence.events).status).toBe("blocked");
  });

  it("stops when the first authorized Boot does not match the evidenced inventory", async () => {
    const evidence = new MemoryEvidenceStore();
    evidence.events.push(
      at(
        evidenceEvent("STATION_1", "system", "FreedomTestDeviceRecorded", {
          articleNumber: "904460023",
          configurationPath: "ACE > Connectivity > Backoffice",
          connectivity: "ethernet",
          countryCode: "BE",
          evidenceSha256: "d".repeat(64),
          hardwareRevision: "NG910",
          inventoryFirmwareVersion: "7.1.0",
          inventoryModel: "Eve Single S-line",
          inventorySchemaVersion: 2,
          inventoryVendor: "Alfen",
          priorOperator: "Prior operator",
          recordedAt: "2026-08-14T10:00:00.000Z",
        }),
        "2026-08-14T10:00:00.000Z",
      ),
    );
    for (const [index, step] of MIGRATION_STEPS.filter(
      (candidate) => candidate.gate === "pre-switch" && candidate.source === "owner-recorded",
    ).entries()) {
      await recordMigrationCheckpoint(config, evidence, step.id, {
        evidenceSha256: (index + 1).toString(16).padStart(64, "0"),
        observedAt: "2026-08-14T11:00:00.000Z",
        outcome: "confirmed",
      });
    }
    const authorizationTime = new Date("2026-08-14T12:00:00.000Z");
    await authorizeMigrationWindow(
      config,
      evidence,
      {
        confirmation: MIGRATION_AUTHORIZATION_PHRASE,
        expiresAt: "2026-08-14T13:00:00.000Z",
        targetManifest: migrationTargetForEvidence(
          config,
          evidence.events,
          "isolated-lan-ws",
          authorizationTime,
        ),
        transport: "isolated-lan-ws",
      },
      authorizationTime,
    );
    evidence.events.push(
      at(
        evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
          chargePointModel: "Different model",
          chargePointVendor: "Alfen",
          firmwareVersion: "7.1.0",
        }),
        "2026-08-14T12:10:00.000Z",
      ),
    );

    const projection = buildMigrationProjection(
      evidence.events,
      new Date("2026-08-14T12:11:00.000Z"),
    );
    expect(projection.status).toBe("blocked");
    expect(projection.steps.find((step) => step.id === "authorized-boot-observed")?.state).toBe(
      "fail",
    );

    evidence.events.push(
      at(
        evidenceEvent("STATION_1", "system", "FreedomTestDeviceRecorded", {
          articleNumber: "904460023",
          configurationPath: "ACE > Connectivity > Backoffice",
          connectivity: "ethernet",
          countryCode: "BE",
          evidenceSha256: "e".repeat(64),
          hardwareRevision: "NG910",
          inventoryFirmwareVersion: "7.1.0",
          inventoryModel: "Different model",
          inventorySchemaVersion: 2,
          inventoryVendor: "Alfen",
          priorOperator: "Prior operator",
          recordedAt: "2026-08-14T12:12:00.000Z",
        }),
        "2026-08-14T12:12:00.000Z",
      ),
    );
    const amended = buildMigrationProjection(evidence.events, new Date("2026-08-14T12:13:00.000Z"));
    expect(amended.authorization).toBeNull();
    expect(amended.steps.find((step) => step.id === "authorized-boot-observed")?.state).toBe(
      "pending",
    );
  });
});

function at(event: EvidenceEvent, timestamp: string): EvidenceEvent {
  return { ...event, at: timestamp };
}
