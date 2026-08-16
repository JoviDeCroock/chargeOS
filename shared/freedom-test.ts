export type FreedomTestStepId =
  | "authorization-synchronized"
  | "online-energy-delivered"
  | "owner-charge-with-wan-and-backend-down"
  | "owner-charge-with-edge-down"
  | "owner-charge-after-isolated-restart"
  | "unknown-tag-rejected-online"
  | "unknown-tag-rejected-offline"
  | "buffered-events-reconciled-once"
  | "rollback-or-independent-restore"
  | "owner-continuity-recovery-drilled";

export const FREEDOM_TEST_SCHEMA_VERSION = 3 as const;
export const FREEDOM_TEST_RUN_CONFIRMATION_PHRASE =
  "I am starting a witnessed Freedom Test for this exact device and migration baseline" as const;

export type FreedomTestStepSource = "automatic" | "witnessed";
export type FreedomTestStepState = "pending" | "pass" | "fail";

export interface FreedomTestStepDefinition {
  readonly id: FreedomTestStepId;
  readonly label: string;
  readonly source: FreedomTestStepSource;
}

export const FREEDOM_TEST_STEPS: readonly FreedomTestStepDefinition[] = [
  {
    id: "authorization-synchronized",
    label: "Owner authorization list acknowledged",
    source: "automatic",
  },
  {
    id: "online-energy-delivered",
    label: "Online session recorded start, meter, stop, and delivered energy",
    source: "automatic",
  },
  {
    id: "owner-charge-with-wan-and-backend-down",
    label: "Owner delivered energy with WAN and backend unavailable",
    source: "witnessed",
  },
  {
    id: "owner-charge-with-edge-down",
    label: "Owner delivered energy with the local edge powered off",
    source: "witnessed",
  },
  {
    id: "owner-charge-after-isolated-restart",
    label: "Owner delivered energy after an isolated charge-point restart",
    source: "witnessed",
  },
  {
    id: "unknown-tag-rejected-online",
    label: "Unknown tag rejected while online",
    source: "automatic",
  },
  {
    id: "unknown-tag-rejected-offline",
    label: "Unknown tag rejected while backend and WAN were unavailable",
    source: "witnessed",
  },
  {
    id: "buffered-events-reconciled-once",
    label: "Buffered events reconciled exactly once after reconnection",
    source: "witnessed",
  },
  {
    id: "rollback-or-independent-restore",
    label: "Documented standalone rollback or independent endpoint restore succeeded",
    source: "witnessed",
  },
  {
    id: "owner-continuity-recovery-drilled",
    label: "Owner continuity bundle restored and replacement edge started",
    source: "witnessed",
  },
];

export interface FreedomTestDeviceIdentity {
  readonly articleNumber: string;
  readonly bootObservedAt: string | null;
  readonly configurationPath: string;
  readonly connectivity: "ethernet" | "wifi" | "cellular" | "mixed" | "other";
  readonly countryCode: string;
  readonly firmwareVersion: string | null;
  readonly hardwareRevision: string;
  readonly identityMatch: "match" | "mismatch" | "pending";
  readonly inventoryEvidenceSha256: string;
  readonly inventoryFirmwareVersion: string;
  readonly inventoryModel: string;
  readonly inventoryVendor: string;
  readonly model: string | null;
  readonly priorOperator: string;
  readonly recordedAt: string;
  readonly vendor: string | null;
}

export interface FreedomTestDeviceInput {
  readonly articleNumber: string;
  readonly configurationPath: string;
  readonly connectivity: string;
  readonly countryCode: string;
  readonly evidenceSha256: string;
  readonly hardwareRevision: string;
  readonly inventoryFirmwareVersion: string;
  readonly inventoryModel: string;
  readonly inventoryVendor: string;
  readonly priorOperator: string;
}

export interface FreedomTestObservationInput {
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly outcome: "pass" | "fail";
  readonly runId: string;
}

export interface FreedomTestRunInput {
  readonly confirmation: typeof FREEDOM_TEST_RUN_CONFIRMATION_PHRASE;
}

export interface FreedomTestEvidenceReference {
  readonly eventId: string;
  readonly recordHash: string | null;
}

export interface FreedomTestRun {
  readonly authorizedBoot: FreedomTestEvidenceReference;
  readonly deviceInventory: FreedomTestEvidenceReference;
  readonly migrationAuthorization: FreedomTestEvidenceReference;
  readonly runId: string;
  readonly startedAt: string;
  readonly state: "active" | "stale";
}

export interface FreedomTestStepResult extends FreedomTestStepDefinition {
  readonly evidence: readonly FreedomTestEvidenceReference[];
  readonly externalEvidenceSha256: string | null;
  readonly observedAt: string | null;
  readonly state: FreedomTestStepState;
}

export interface FreedomTestProjection {
  readonly device: FreedomTestDeviceIdentity | null;
  readonly disclaimer: string;
  readonly run: FreedomTestRun | null;
  readonly schemaVersion: typeof FREEDOM_TEST_SCHEMA_VERSION;
  readonly status:
    | "not-started"
    | "in-progress"
    | "baseline-stale"
    | "failed"
    | "evidence-complete-unreviewed";
  readonly steps: readonly FreedomTestStepResult[];
}

export interface FreedomTestReport {
  readonly evidenceChainHead: string | null;
  readonly evidenceRecordCount: number;
  readonly generatedAt: string;
  readonly reportVersion: typeof FREEDOM_TEST_SCHEMA_VERSION;
  readonly reviewState: "unreviewed";
  readonly stationId: string;
  readonly test: FreedomTestProjection;
}
