import type { GatewayConfig } from "../../server/config.js";
import { buildDeviceIdentity } from "../../server/device.js";
import type { EvidenceEvent } from "../../server/events.js";
import {
  createMigrationTargetManifest,
  serializeMigrationTargetManifest,
  type MigrationTargetTransport,
} from "../../server/migration-manifest.js";
import { buildMigrationProjection } from "../../server/migration.js";
import type { MigrationStepId } from "../../shared/migration.js";

export function migrationTargetForEvidence(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  transport: MigrationTargetTransport,
  now: Date,
): string {
  const device = buildDeviceIdentity(events, null);
  if (!device) throw new Error("Test migration target requires a device inventory");
  const projection = buildMigrationProjection(events, now);
  const digest = (stepId: MigrationStepId): string => {
    const value = projection.steps.find((step) => step.id === stepId)?.externalEvidenceSha256;
    if (!value) throw new Error(`Test migration target requires ${stepId}`);
    return value;
  };
  return serializeMigrationTargetManifest(
    createMigrationTargetManifest({
      configurationBackupSha256: digest("configuration-backup"),
      configurationPath: device.configurationPath,
      configurationPathEvidenceSha256: digest("local-admin-custody"),
      continuityRestoreEvidenceSha256: digest("continuity-restore-drill"),
      createdAt: now.toISOString(),
      credentialCustodyEvidenceSha256: digest("station-secret-preprovisioned"),
      deviceInventoryEvidenceSha256: device.inventoryEvidenceSha256,
      endpoint:
        transport === "internet-wss"
          ? `wss://ocpp.example.test/ocpp/${encodeURIComponent(config.stationId)}`
          : `ws://192.168.50.4:9000/${encodeURIComponent(config.stationId)}`,
      expectedFirmwareVersion: device.inventoryFirmwareVersion,
      expectedModel: device.inventoryModel,
      expectedVendor: device.inventoryVendor,
      standaloneRollbackEvidenceSha256: digest("standalone-rollback"),
      stationId: config.stationId,
      transactionExportSha256: digest("transaction-export"),
      transport,
      transportValidationEvidenceSha256: digest("secure-transport-plan"),
    }),
  );
}
