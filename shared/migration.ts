export const MIGRATION_SCHEMA_VERSION = 2 as const;
export const MIGRATION_AUTHORIZATION_PHRASE =
  "I authorize the documented reversible endpoint change" as const;

export type MigrationPhase = "inventory" | "preservation" | "endpoint-readiness" | "online-proof";
export type MigrationStepSource = "device-inventory" | "owner-recorded" | "protocol-derived";
export type MigrationStepState = "pass" | "fail" | "pending";

export type MigrationStepId =
  | "ownership-authority"
  | "contractual-constraints"
  | "exact-device-identity"
  | "local-admin-custody"
  | "network-sim-custody"
  | "installer-safety-plan"
  | "configuration-backup"
  | "transaction-export"
  | "standalone-rollback"
  | "owner-standalone-charge"
  | "station-secret-preprovisioned"
  | "continuity-restore-drill"
  | "secure-transport-plan"
  | "authorized-boot-observed"
  | "authorized-status-observed"
  | "authorized-capabilities-ready"
  | "authorized-owner-list-accepted"
  | "authorized-online-energy-session";

export interface MigrationStepDefinition {
  readonly gate: "pre-switch" | "post-switch";
  readonly id: MigrationStepId;
  readonly label: string;
  readonly phase: MigrationPhase;
  readonly source: MigrationStepSource;
}

export const MIGRATION_STEPS: readonly MigrationStepDefinition[] = [
  {
    gate: "pre-switch",
    id: "ownership-authority",
    label: "Owner authority over the exact charger is evidenced",
    phase: "inventory",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "contractual-constraints",
    label: "Employer, lease, reimbursement, warranty, and meter constraints were reviewed",
    phase: "inventory",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "exact-device-identity",
    label: "Exact label, local firmware, and expected OCPP identity are evidenced",
    phase: "inventory",
    source: "device-inventory",
  },
  {
    gate: "pre-switch",
    id: "local-admin-custody",
    label: "Supported local admin credentials and tooling are available",
    phase: "inventory",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "network-sim-custody",
    label: "Network path and any SIM ownership are documented",
    phase: "inventory",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "installer-safety-plan",
    label: "A competent installer and de-energized physical-work plan are confirmed",
    phase: "inventory",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "configuration-backup",
    label: "Complete configuration backup is held with a verified checksum",
    phase: "preservation",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "transaction-export",
    label: "Required transaction and meter history is exported with provenance",
    phase: "preservation",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "standalone-rollback",
    label: "Independent standalone rollback is documented and tested",
    phase: "preservation",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "owner-standalone-charge",
    label: "Owner delivered energy and unknown RFID was rejected in standalone mode",
    phase: "preservation",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "station-secret-preprovisioned",
    label: "Exact station identity and a unique independent secret are pre-provisioned",
    phase: "endpoint-readiness",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "continuity-restore-drill",
    label: "Encrypted continuity bundle was restored on a separate path",
    phase: "endpoint-readiness",
    source: "owner-recorded",
  },
  {
    gate: "pre-switch",
    id: "secure-transport-plan",
    label: "Target transport is isolated LAN WS or certificate-validated WSS",
    phase: "endpoint-readiness",
    source: "owner-recorded",
  },
  {
    gate: "post-switch",
    id: "authorized-boot-observed",
    label: "Authorized BootNotification matched the pre-switch device inventory",
    phase: "online-proof",
    source: "protocol-derived",
  },
  {
    gate: "post-switch",
    id: "authorized-status-observed",
    label: "Connector status was observed after the authorized boot",
    phase: "online-proof",
    source: "protocol-derived",
  },
  {
    gate: "post-switch",
    id: "authorized-capabilities-ready",
    label: "Offline authorization prerequisites passed after the authorized boot",
    phase: "online-proof",
    source: "protocol-derived",
  },
  {
    gate: "post-switch",
    id: "authorized-owner-list-accepted",
    label: "The owner authorization list was accepted after the authorized boot",
    phase: "online-proof",
    source: "protocol-derived",
  },
  {
    gate: "post-switch",
    id: "authorized-online-energy-session",
    label: "A positive-energy online start, meter, and stop sequence was recorded",
    phase: "online-proof",
    source: "protocol-derived",
  },
] as const;

export interface MigrationObservationInput {
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly outcome: "blocked" | "confirmed";
}

export interface MigrationAuthorizationInput {
  readonly confirmation: typeof MIGRATION_AUTHORIZATION_PHRASE;
  readonly expiresAt: string;
  readonly targetManifest: string;
  readonly transport: "internet-wss" | "isolated-lan-ws";
}

export interface MigrationEvidenceReference {
  readonly at: string;
  readonly eventId: string;
  readonly recordHash: string | null;
}

export interface MigrationStepResult extends MigrationStepDefinition {
  readonly evidence: readonly MigrationEvidenceReference[];
  readonly externalEvidenceSha256: string | null;
  readonly observedAt: string | null;
  readonly state: MigrationStepState;
}

export interface MigrationAuthorization {
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly eventId: string;
  readonly prerequisiteFingerprint: string;
  readonly targetManifestSha256: string;
  readonly transport: MigrationAuthorizationInput["transport"];
  readonly validForChange: boolean;
}

export interface MigrationProjection {
  readonly authorization: MigrationAuthorization | null;
  readonly disclaimer: string;
  readonly preSwitchReady: boolean;
  readonly schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  readonly status:
    | "not-started"
    | "collecting"
    | "blocked"
    | "ready-for-owner-confirmation"
    | "owner-authorized-window"
    | "online-proof-in-progress"
    | "online-path-observed-unreviewed";
  readonly steps: readonly MigrationStepResult[];
}

export interface MigrationReport {
  readonly evidenceChainHead: string | null;
  readonly evidenceRecordCount: number;
  readonly exportedAt: string;
  readonly migration: MigrationProjection;
  readonly reviewState: "unreviewed";
  readonly schemaVersion: typeof MIGRATION_SCHEMA_VERSION;
  readonly stationId: string;
}
