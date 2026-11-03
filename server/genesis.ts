import {
  FREEDOM_TEST_STEPS,
  type FreedomTestProjection,
  type FreedomTestStepDefinition,
} from "../shared/freedom-test.js";
import {
  GENESIS_PLAN_SCHEMA_VERSION,
  type GenesisAction,
  type GenesisPlan,
} from "../shared/genesis.js";
import { type MigrationProjection, type MigrationStepDefinition } from "../shared/migration.js";

const DISCLAIMER =
  "This plan orders evidence and software actions; it is not permission for electrical, enclosure, SIM, or unsupported charger work. Physical work requires the documented exact-device procedure, power isolation where applicable, and a competent installer.";

const WITNESSED_ORDER = [
  "owner-charge-with-wan-and-backend-down",
  "unknown-tag-rejected-offline",
  "owner-charge-with-edge-down",
  "owner-charge-after-isolated-restart",
  "buffered-events-reconciled-once",
  "rollback-or-independent-restore",
  "owner-continuity-recovery-drilled",
] as const;

export function buildGenesisPlan(
  migration: MigrationProjection,
  freedomTest: FreedomTestProjection,
): GenesisPlan {
  const migrationFailures = migration.steps.filter((step) => step.state === "fail");
  if (migrationFailures.length) {
    return plan(
      "pre-switch-evidence",
      "stop",
      migrationFailures.map((step) => ({
        actor: "owner",
        evidence: "external-sha256",
        execution: "external-manual",
        id: "resolve-stop-condition",
        instruction: `Stop the migration and resolve the failed checkpoint: ${step.label}. Preserve the failed evidence; never overwrite it with an assumed pass.`,
        migrationStepId: step.id,
        safety: migrationSafety(step.id),
      })),
    );
  }

  const pendingPreSwitch = migration.steps.filter(
    (step) => step.gate === "pre-switch" && step.state === "pending",
  );
  if (pendingPreSwitch.length) {
    return plan("pre-switch-evidence", "action-required", pendingPreSwitch.map(preSwitchAction));
  }

  if (!migration.authorization) {
    return ownerAuthorizationPlan(false);
  }

  const authorizedBoot = migration.steps.find((step) => step.id === "authorized-boot-observed");
  if (authorizedBoot?.state === "pending") {
    if (!migration.authorization.validForChange) return ownerAuthorizationPlan(true);
    return plan("endpoint-change", "action-required", [
      {
        actor: "installer",
        evidence: "protocol-derived",
        execution: "external-manual",
        id: "verify-and-change-endpoint",
        instruction:
          "Verify the separately held migration target against the authorized SHA-256, then use the supported exact-device configuration path during the active window. Do not place credentials in the ledger. Any enclosure or SIM work requires power isolation and a competent installer.",
        migrationStepId: "authorized-boot-observed",
        safety: "power-isolated-competent-installer",
      },
    ]);
  }

  const pendingOnline = migration.steps.find(
    (step) => step.gate === "post-switch" && step.state === "pending",
  );
  if (pendingOnline) {
    return plan(
      "online-proof",
      onlineAction(pendingOnline).actor === "station" ? "waiting-for-station" : "action-required",
      [onlineAction(pendingOnline)],
    );
  }

  const pendingAutomatic = freedomTest.steps.find(
    (step) => step.source === "automatic" && step.state === "pending",
  );
  if (pendingAutomatic) {
    const action = automaticFreedomAction(pendingAutomatic.id);
    return plan(
      "online-proof",
      action.actor === "station" ? "waiting-for-station" : "action-required",
      [action],
    );
  }

  if (freedomTest.run?.state === "stale") {
    return plan("physical-freedom-test", "stop", [
      {
        actor: "owner",
        evidence: "external-sha256",
        execution: "owner-console",
        id: "resolve-stop-condition",
        instruction:
          "Stop using the prior field outcomes. The exact device or migration baseline changed; evidence and authorize the new baseline, observe its online path, then start a fresh field run.",
        safety: "ordinary",
      },
    ]);
  }

  if (!freedomTest.run) {
    return plan("physical-freedom-test", "action-required", [
      {
        actor: "owner",
        evidence: "none",
        execution: "owner-console",
        id: "start-bound-field-run",
        instruction:
          "Type the displayed confirmation phrase to bind a new witnessed field run to this exact inventory, migration authorization, and authorized Boot.",
        safety: "ordinary",
      },
    ]);
  }

  const failedWitnessed = freedomTest.steps.find(
    (step) => step.source === "witnessed" && step.state === "fail",
  );
  if (failedWitnessed) {
    return plan("physical-freedom-test", "stop", [
      {
        actor: "witness",
        evidence: "external-sha256",
        execution: "external-manual",
        freedomTestStepId: failedWitnessed.id,
        id: "resolve-stop-condition",
        instruction: `Stop and investigate the failed witnessed step: ${failedWitnessed.label}. Preserve the failed evidence and restore the documented safe standalone path if continuity is uncertain.`,
        safety: witnessedSafety(failedWitnessed.id),
      },
    ]);
  }

  const pendingWitnessedId = WITNESSED_ORDER.find(
    (id) => freedomTest.steps.find((step) => step.id === id)?.state === "pending",
  );
  if (pendingWitnessedId) {
    const definition = FREEDOM_TEST_STEPS.find((step) => step.id === pendingWitnessedId)!;
    return plan("physical-freedom-test", "action-required", [witnessedAction(definition)]);
  }

  return plan("independent-review", "ready-for-review", [
    {
      actor: "owner",
      evidence: "review-pack",
      execution: "owner-console",
      id: "export-field-review-pack",
      instruction:
        "Export the redacted field review pack and verify its canonical artifact hashes before handoff. Keep the encrypted continuity bundle separate.",
      safety: "ordinary",
    },
    {
      actor: "reviewer",
      evidence: "review-pack",
      execution: "review",
      id: "independent-evidence-review",
      instruction:
        "Review the exact device, firmware, environment, external artifacts, outage observations, rollback, and recovery. Recorder completeness alone is not a Freedom grade.",
      safety: "ordinary",
    },
  ]);
}

function plan(
  phase: GenesisPlan["phase"],
  state: GenesisPlan["state"],
  nextActions: readonly GenesisAction[],
): GenesisPlan {
  return {
    disclaimer: DISCLAIMER,
    nextActions,
    phase,
    schemaVersion: GENESIS_PLAN_SCHEMA_VERSION,
    state,
  };
}

function preSwitchAction(step: MigrationStepDefinition): GenesisAction {
  if (step.id === "exact-device-identity") {
    return {
      actor: "owner",
      evidence: "external-sha256",
      execution: "owner-console",
      id: "record-device-inventory",
      instruction:
        "Record the exact label, hardware revision, expected OCPP vendor/model/firmware, configuration path, connectivity, country, prior operator, and separately held inventory-evidence SHA-256.",
      migrationStepId: step.id,
      safety: "ordinary",
    };
  }
  return {
    actor: migrationActor(step.id),
    evidence: "external-sha256",
    execution: "external-manual",
    id: "complete-migration-prerequisite",
    instruction: `Complete and independently evidence this prerequisite before recording its digest: ${step.label}. Record blocked rather than guessing if it cannot be proven.`,
    migrationStepId: step.id,
    safety: migrationSafety(step.id),
  };
}

function ownerAuthorizationPlan(expired: boolean): GenesisPlan {
  return plan("owner-authorization", "action-required", [
    {
      actor: "owner",
      evidence: "external-sha256",
      execution: "local-cli",
      id: "create-migration-target",
      instruction:
        "Create and verify a non-overwriting canonical migration-target file whose exact inventory, evidence hashes, supported configuration path, and transport match the dossier. Keep endpoint credentials out of it.",
      safety: "ordinary",
    },
    {
      actor: "owner",
      evidence: "external-sha256",
      execution: "owner-console",
      id: "authorize-migration-target",
      instruction: expired
        ? "The prior endpoint-change window expired before an authorized Boot. Select the verified target again and record a fresh time-bounded owner authorization."
        : "Select the verified target and type the exact owner phrase to record a time-bounded endpoint-change authorization.",
      safety: "ordinary",
    },
  ]);
}

function onlineAction(step: MigrationStepDefinition): GenesisAction {
  if (step.id === "authorized-boot-observed") {
    return {
      actor: "station",
      evidence: "protocol-derived",
      execution: "observe",
      id: "observe-authorized-boot",
      instruction:
        "Wait for the first authenticated BootNotification the charger sends on its own inside the owner-authorized window. A Boot chargeOS requested after a plain reconnect reports identity but does not count; restart the charger inside the window with its supported procedure. Any vendor, model, or firmware mismatch is a stop condition.",
      migrationStepId: step.id,
      safety: "ordinary",
    };
  }
  if (step.id === "authorized-status-observed") {
    return {
      actor: "station",
      evidence: "protocol-derived",
      execution: "observe",
      id: "observe-connector-status",
      instruction: "Wait for connector StatusNotification evidence after the authorized Boot.",
      migrationStepId: step.id,
      safety: "ordinary",
    };
  }
  if (step.id === "authorized-capabilities-ready") {
    return {
      actor: "owner",
      evidence: "protocol-derived",
      execution: "owner-console",
      id: "inspect-owner-continuity",
      instruction:
        "Inspect the charger-reported local authorization prerequisites. Use the separately confirmed one-way preparation only for explicitly writable unsafe keys; never weaken unknown-tag rejection.",
      migrationStepId: step.id,
      safety: "ordinary",
    };
  }
  if (step.id === "authorized-owner-list-accepted") {
    return {
      actor: "owner",
      evidence: "protocol-derived",
      execution: "owner-console",
      id: "synchronize-owner-tags",
      instruction:
        "After readiness passes, send the complete owner authorization list and wait for its exact revision to be accepted.",
      migrationStepId: step.id,
      safety: "ordinary",
    };
  }
  return {
    actor: "owner",
    evidence: "protocol-derived",
    execution: "external-manual",
    id: "complete-online-charge",
    instruction:
      "Complete a real owner-authorized online charge with positive delivered energy so start, meter, and stop evidence are recorded.",
    migrationStepId: step.id,
    safety: "witnessed-real-energy",
  };
}

function automaticFreedomAction(id: FreedomTestStepDefinition["id"]): GenesisAction {
  if (id === "unknown-tag-rejected-online") {
    return {
      actor: "witness",
      evidence: "protocol-derived",
      execution: "external-manual",
      freedomTestStepId: id,
      id: "reject-unknown-tag-online",
      instruction:
        "While chargeOS is online, present a known-unknown test RFID and confirm the charger and protocol evidence reject it. Never use another person's credential.",
      safety: "witnessed-real-energy",
    };
  }
  if (id === "authorization-synchronized") {
    return {
      actor: "owner",
      evidence: "protocol-derived",
      execution: "owner-console",
      freedomTestStepId: id,
      id: "synchronize-owner-tags",
      instruction: "Synchronize the complete owner authorization list and wait for acceptance.",
      safety: "ordinary",
    };
  }
  return {
    actor: "owner",
    evidence: "protocol-derived",
    execution: "external-manual",
    freedomTestStepId: id,
    id: "complete-online-charge",
    instruction:
      "Complete a real owner-authorized online charge with positive delivered energy so start, meter, and stop evidence are recorded.",
    safety: "witnessed-real-energy",
  };
}

function witnessedAction(step: FreedomTestStepDefinition): GenesisAction {
  return {
    actor: "witness",
    evidence: "external-sha256",
    execution: "external-manual",
    freedomTestStepId: step.id,
    id: "complete-witnessed-step",
    instruction: witnessedInstruction(step.id, step.label),
    safety: witnessedSafety(step.id),
  };
}

function witnessedInstruction(id: FreedomTestStepDefinition["id"], label: string): string {
  if (id === "owner-charge-with-wan-and-backend-down") {
    return "Disconnect WAN/backend without cutting charger mains, then witness a complete real owner-RFID charge. Hash the separately held evidence before recording the outcome.";
  }
  if (id === "unknown-tag-rejected-offline") {
    return "While WAN/backend remain unavailable, present a known-unknown test RFID and witness rejection. Hash the separately held evidence before recording the outcome.";
  }
  if (id === "owner-charge-with-edge-down") {
    return "Power off only the optional chargeOS edge while leaving charger mains intact, then witness a complete real owner-RFID charge. Hash the separately held evidence.";
  }
  if (id === "owner-charge-after-isolated-restart") {
    return "Using the documented exact-device procedure, restart the charge point while isolated and then witness a second complete owner-RFID charge. Any physical power work requires a competent installer.";
  }
  if (id === "buffered-events-reconciled-once") {
    return "Restore connectivity and verify buffered events reconcile exactly once without duplicate or conflicting projected sessions. Hash the separately held evidence.";
  }
  if (id === "rollback-or-independent-restore") {
    return "Execute the documented standalone rollback or independent endpoint restore and witness owner charging plus unknown-tag rejection. Hash the separately held evidence.";
  }
  if (id === "owner-continuity-recovery-drilled") {
    return "Have a competent independent operator restore the owner continuity bundle onto a fresh edge path and verify startup. Hash the separately held drill evidence.";
  }
  return `Complete and witness this exact physical step: ${label}. Hash the separately held evidence before recording the outcome.`;
}

function migrationActor(id: MigrationStepDefinition["id"]): GenesisAction["actor"] {
  return [
    "local-admin-custody",
    "network-sim-custody",
    "installer-safety-plan",
    "configuration-backup",
    "standalone-rollback",
    "owner-standalone-charge",
  ].includes(id)
    ? "installer"
    : "owner";
}

function migrationSafety(id: MigrationStepDefinition["id"]): GenesisAction["safety"] {
  return id === "network-sim-custody" || id === "installer-safety-plan"
    ? "power-isolated-competent-installer"
    : id === "owner-standalone-charge"
      ? "witnessed-real-energy"
      : id === "local-admin-custody" ||
          id === "configuration-backup" ||
          id === "standalone-rollback"
        ? "supported-installer-procedure"
        : "ordinary";
}

function witnessedSafety(id: FreedomTestStepDefinition["id"]): GenesisAction["safety"] {
  return id === "owner-charge-after-isolated-restart"
    ? "power-isolated-competent-installer"
    : id.startsWith("owner-charge") || id === "unknown-tag-rejected-offline"
      ? "witnessed-real-energy"
      : id === "rollback-or-independent-restore"
        ? "supported-installer-procedure"
        : "ordinary";
}
