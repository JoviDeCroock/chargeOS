import { describe, expect, it } from "vitest";

import { buildGenesisPlan } from "../server/genesis.js";
import {
  FREEDOM_TEST_SCHEMA_VERSION,
  FREEDOM_TEST_STEPS,
  type FreedomTestProjection,
  type FreedomTestRun,
  type FreedomTestStepId,
} from "../shared/freedom-test.js";
import {
  MIGRATION_SCHEMA_VERSION,
  MIGRATION_STEPS,
  type MigrationAuthorization,
  type MigrationProjection,
  type MigrationStepId,
} from "../shared/migration.js";

describe("Genesis next-safe-action plan", () => {
  it("lists incomplete pre-switch evidence without implying that recording is proof", () => {
    const migration = migrationProjection({
      "exact-device-identity": "pending",
      "installer-safety-plan": "pending",
    });

    const plan = buildGenesisPlan(migration, freedomProjection());
    expect(plan).toMatchObject({ phase: "pre-switch-evidence", state: "action-required" });
    expect(plan.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "record-device-inventory",
          migrationStepId: "exact-device-identity",
        }),
        expect.objectContaining({
          id: "complete-migration-prerequisite",
          migrationStepId: "installer-safety-plan",
          safety: "power-isolated-competent-installer",
        }),
      ]),
    );
    expect(plan.nextActions.map((action) => action.instruction).join(" ")).toContain(
      "Record blocked rather than guessing",
    );
  });

  it("stops on failed migration evidence instead of advancing to endpoint work", () => {
    const plan = buildGenesisPlan(
      migrationProjection({ "standalone-rollback": "fail" }),
      freedomProjection(),
    );

    expect(plan.state).toBe("stop");
    expect(plan.nextActions).toEqual([
      expect.objectContaining({
        id: "resolve-stop-condition",
        migrationStepId: "standalone-rollback",
      }),
    ]);
  });

  it("permits the supported endpoint procedure only inside an active authorization window", () => {
    const active = buildGenesisPlan(
      migrationProjection({}, authorization(true)),
      freedomProjection(),
    );
    expect(active).toMatchObject({ phase: "endpoint-change", state: "action-required" });
    expect(active.nextActions[0]).toMatchObject({
      actor: "installer",
      id: "verify-and-change-endpoint",
      safety: "power-isolated-competent-installer",
    });

    const expired = buildGenesisPlan(
      migrationProjection({}, authorization(false)),
      freedomProjection(),
    );
    expect(expired.phase).toBe("owner-authorization");
    expect(expired.nextActions.map((action) => action.id)).toEqual([
      "create-migration-target",
      "authorize-migration-target",
    ]);
  });

  it("orders online proof and then starts one baseline-bound witnessed run", () => {
    const online = migrationProjection(
      {
        "authorized-boot-observed": "pass",
        "authorized-status-observed": "pass",
        "authorized-capabilities-ready": "pending",
      },
      authorization(false),
    );
    expect(buildGenesisPlan(online, freedomProjection()).nextActions[0]).toMatchObject({
      id: "inspect-owner-continuity",
      migrationStepId: "authorized-capabilities-ready",
    });

    const completeMigration = migrationProjection(
      Object.fromEntries(
        MIGRATION_STEPS.filter((step) => step.gate === "post-switch").map((step) => [
          step.id,
          "pass",
        ]),
      ) as Partial<Record<MigrationStepId, "pass">>,
      authorization(false),
    );
    const automaticPasses = Object.fromEntries(
      FREEDOM_TEST_STEPS.filter((step) => step.source === "automatic").map((step) => [
        step.id,
        "pass",
      ]),
    ) as Partial<Record<FreedomTestStepId, "pass">>;
    expect(buildGenesisPlan(completeMigration, freedomProjection(automaticPasses))).toMatchObject({
      phase: "physical-freedom-test",
      nextActions: [expect.objectContaining({ id: "start-bound-field-run" })],
    });
  });

  it("presents only the next witnessed outage step and fails closed on stale runs", () => {
    const completeMigration = fullyObservedMigration();
    const automaticPasses = Object.fromEntries(
      FREEDOM_TEST_STEPS.filter((step) => step.source === "automatic").map((step) => [
        step.id,
        "pass",
      ]),
    ) as Partial<Record<FreedomTestStepId, "pass">>;
    const active = buildGenesisPlan(
      completeMigration,
      freedomProjection(automaticPasses, run("active")),
    );
    expect(active.nextActions).toEqual([
      expect.objectContaining({
        freedomTestStepId: "owner-charge-with-wan-and-backend-down",
        id: "complete-witnessed-step",
        safety: "witnessed-real-energy",
      }),
    ]);

    const stale = buildGenesisPlan(
      completeMigration,
      freedomProjection(automaticPasses, run("stale")),
    );
    expect(stale).toMatchObject({ phase: "physical-freedom-test", state: "stop" });
    expect(stale.nextActions[0]?.instruction).toContain("prior field outcomes");
  });

  it("ends at independent review rather than an automatic liberation claim", () => {
    const allPass = Object.fromEntries(
      FREEDOM_TEST_STEPS.map((step) => [step.id, "pass"]),
    ) as Record<FreedomTestStepId, "pass">;
    const plan = buildGenesisPlan(
      fullyObservedMigration(),
      freedomProjection(allPass, run("active")),
    );
    expect(plan).toMatchObject({ phase: "independent-review", state: "ready-for-review" });
    expect(plan.nextActions.map((action) => action.id)).toEqual([
      "export-field-review-pack",
      "independent-evidence-review",
    ]);
    expect(JSON.stringify(plan)).not.toContain("certified");
    expect(JSON.stringify(plan)).not.toContain("liberated");
  });
});

function migrationProjection(
  states: Partial<Record<MigrationStepId, "pending" | "pass" | "fail">> = {},
  migrationAuthorization: MigrationAuthorization | null = null,
): MigrationProjection {
  const steps = MIGRATION_STEPS.map((step) => ({
    ...step,
    evidence: [],
    externalEvidenceSha256: null,
    observedAt: null,
    state: states[step.id] ?? (step.gate === "pre-switch" ? "pass" : "pending"),
  }));
  return {
    authorization: migrationAuthorization,
    disclaimer: "unreviewed migration evidence",
    preSwitchReady: steps
      .filter((step) => step.gate === "pre-switch")
      .every((step) => step.state === "pass"),
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    status: steps.some((step) => step.state === "fail")
      ? "blocked"
      : steps.filter((step) => step.gate === "post-switch").every((step) => step.state === "pass")
        ? "online-path-observed-unreviewed"
        : migrationAuthorization?.validForChange
          ? "owner-authorized-window"
          : "collecting",
    steps,
  };
}

function freedomProjection(
  states: Partial<Record<FreedomTestStepId, "pending" | "pass" | "fail">> = {},
  fieldRun: FreedomTestRun | null = null,
): FreedomTestProjection {
  const steps = FREEDOM_TEST_STEPS.map((step) => ({
    ...step,
    evidence: [],
    externalEvidenceSha256: null,
    observedAt: null,
    state: states[step.id] ?? "pending",
  }));
  return {
    device: null,
    disclaimer: "unreviewed field evidence",
    run: fieldRun,
    schemaVersion: FREEDOM_TEST_SCHEMA_VERSION,
    status: "in-progress",
    steps,
  };
}

function authorization(validForChange: boolean): MigrationAuthorization {
  return {
    authorizedAt: "2026-08-15T10:00:00.000Z",
    eventId: "authorization-event",
    expiresAt: "2026-08-15T11:00:00.000Z",
    prerequisiteFingerprint: "a".repeat(64),
    targetManifestSha256: "b".repeat(64),
    transport: "isolated-lan-ws",
    validForChange,
  };
}

function fullyObservedMigration(): MigrationProjection {
  return migrationProjection(
    Object.fromEntries(MIGRATION_STEPS.map((step) => [step.id, "pass"])) as Record<
      MigrationStepId,
      "pass"
    >,
    authorization(false),
  );
}

function run(state: FreedomTestRun["state"]): FreedomTestRun {
  return {
    authorizedBoot: { eventId: "boot-event", recordHash: null },
    deviceInventory: { eventId: "inventory-event", recordHash: null },
    migrationAuthorization: { eventId: "authorization-event", recordHash: null },
    runId: "12345678-1234-4123-8123-123456789abc",
    startedAt: "2026-08-15T10:30:00.000Z",
    state,
  };
}
