import type { FreedomTestStepId } from "./freedom-test.js";
import type { MigrationStepId } from "./migration.js";

export const GENESIS_PLAN_SCHEMA_VERSION = 1 as const;

export type GenesisPhase =
  | "pre-switch-evidence"
  | "owner-authorization"
  | "endpoint-change"
  | "online-proof"
  | "physical-freedom-test"
  | "independent-review";

export type GenesisActionId =
  | "resolve-stop-condition"
  | "record-device-inventory"
  | "complete-migration-prerequisite"
  | "create-migration-target"
  | "authorize-migration-target"
  | "verify-and-change-endpoint"
  | "observe-authorized-boot"
  | "observe-connector-status"
  | "inspect-owner-continuity"
  | "synchronize-owner-tags"
  | "complete-online-charge"
  | "reject-unknown-tag-online"
  | "start-bound-field-run"
  | "complete-witnessed-step"
  | "export-field-review-pack"
  | "independent-evidence-review";

export interface GenesisAction {
  readonly actor: "owner" | "installer" | "witness" | "reviewer" | "station";
  readonly evidence: "none" | "external-sha256" | "protocol-derived" | "review-pack";
  readonly execution: "owner-console" | "local-cli" | "external-manual" | "observe" | "review";
  readonly id: GenesisActionId;
  readonly instruction: string;
  readonly migrationStepId?: MigrationStepId;
  readonly safety:
    | "ordinary"
    | "witnessed-real-energy"
    | "supported-installer-procedure"
    | "power-isolated-competent-installer";
  readonly freedomTestStepId?: FreedomTestStepId;
}

export interface GenesisPlan {
  readonly disclaimer: string;
  readonly nextActions: readonly GenesisAction[];
  readonly phase: GenesisPhase;
  readonly schemaVersion: typeof GENESIS_PLAN_SCHEMA_VERSION;
  readonly state: "action-required" | "waiting-for-station" | "stop" | "ready-for-review";
}
