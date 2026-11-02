import { describe, expect, it } from "vitest";

import { buildStationSetup } from "../server/onboarding.js";
import type { CapabilityAssessment, OwnerSnapshot } from "../shared/contracts.js";
import { SETUP_STEPS } from "../shared/onboarding.js";

type SetupInput = Parameters<typeof buildStationSetup>[0];

const BOOT = { firmwareVersion: "6.4.0", model: "Eve Single S-line", vendor: "Alfen BV" };
const TAG = `tag_${"a".repeat(24)}`;

function check(id: string, state: "pass" | "fail" | "unknown") {
  return { id, label: id, observed: "", state };
}

function readiness(
  state: CapabilityAssessment["state"],
  checks: CapabilityAssessment["checks"],
  restartRequired = false,
): CapabilityAssessment {
  return {
    checkedAt: "2026-11-02T10:00:00.000Z",
    checks,
    localListVersion: 1,
    restartRequired,
    state,
  };
}

function snapshot(overrides: {
  boot?: typeof BOOT | null;
  connected?: boolean;
  readiness?: CapabilityAssessment | null;
  tagCount?: number;
  syncState?: OwnerSnapshot["authorization"]["syncState"];
  lastSyncAt?: string | null;
  lastAttemptStatus?: string | null;
  sessions?: readonly Partial<OwnerSnapshot["sessions"][number]>[];
}): SetupInput {
  const tagCount = overrides.tagCount ?? 0;
  return {
    authorization: {
      lastAttemptStatus: overrides.lastAttemptStatus ?? null,
      lastSyncAt: overrides.lastSyncAt ?? null,
      syncState: overrides.syncState ?? "pending",
      tagCount,
      tagPseudonyms: tagCount ? [TAG] : [],
    },
    readiness: overrides.readiness ?? null,
    sessions: overrides.sessions ?? [],
    station: {
      boot: overrides.boot === undefined ? BOOT : overrides.boot,
      connected: overrides.connected ?? true,
    },
  } as unknown as SetupInput;
}

const states = (setup: ReturnType<typeof buildStationSetup>) =>
  Object.fromEntries(setup.steps.map(({ id, state }) => [id, state]));

describe("charger setup checklist", () => {
  it("adds the first card before checking offline readiness", () => {
    expect(SETUP_STEPS).toEqual([
      "connected",
      "identity",
      "cards",
      "offline-ready",
      "cards-on-charger",
      "test-charge",
    ]);
    const setup = buildStationSetup(snapshot({}), null, true);
    expect(setup.steps.map(({ id }) => id)).toEqual([...SETUP_STEPS]);
    expect(states(setup)).toMatchObject({ cards: "current", "offline-ready": "waiting" });
    expect(setup.state).toBe("in-progress");
  });

  it("waits for the charger before anything else", () => {
    const setup = buildStationSetup(snapshot({ boot: null, connected: false }), null, false);
    expect(setup.state).toBe("waiting-for-charger");
    expect(states(setup)).toMatchObject({ connected: "current", identity: "waiting" });
  });

  it("does not stop on a readiness check that failed only for lack of an owner card", () => {
    const ownerCardOnly = readiness("blocked", [
      check("local-list", "pass"),
      check("offline-authorize", "pass"),
      check("owner-card", "fail"),
    ]);
    const setup = buildStationSetup(
      snapshot({ readiness: ownerCardOnly, tagCount: 1 }),
      null,
      true,
    );
    expect(setup.state).toBe("in-progress");
    // The stale result is treated as not checked: the step asks for a new check.
    expect(setup.steps.find(({ id }) => id === "offline-ready")).toMatchObject({
      detail: null,
      state: "current",
    });
  });

  it("still stops on a real charger problem next to a missing owner card", () => {
    const blocked = readiness("blocked", [
      check("local-list", "fail"),
      check("owner-card", "fail"),
    ]);
    const setup = buildStationSetup(snapshot({ readiness: blocked, tagCount: 1 }), null, true);
    expect(setup.state).toBe("stopped");
    expect(setup.steps.find(({ id }) => id === "offline-ready")).toMatchObject({
      detail: "readiness-blocked",
      state: "stopped",
    });
  });

  it("stops when the charger is not the expected make and model", () => {
    const setup = buildStationSetup(
      snapshot({}),
      { firmwareVersion: null, model: "Other model", vendor: "Alfen BV" },
      true,
    );
    expect(setup.state).toBe("stopped");
    expect(setup.steps.find(({ id }) => id === "identity")).toMatchObject({
      detail: "identity-mismatch",
      state: "stopped",
    });
  });

  it("completes only after an accepted owner-card charge that started after the list was sent", () => {
    const ready = readiness("ready", [check("local-list", "pass"), check("owner-card", "pass")]);
    const synced = {
      lastSyncAt: "2026-11-02T10:00:00.000Z",
      readiness: ready,
      syncState: "current" as const,
      tagCount: 1,
    };
    const before = buildStationSetup(
      snapshot({
        ...synced,
        sessions: [
          {
            authorizationStatus: "Accepted",
            startedAt: "2026-11-02T09:00:00.000Z",
            tagPseudonym: TAG,
          },
        ],
      }),
      BOOT,
      true,
    );
    expect(states(before)["test-charge"]).toBe("current");
    expect(before.completedAt).toBeNull();

    const after = buildStationSetup(
      snapshot({
        ...synced,
        sessions: [
          {
            authorizationStatus: "Accepted",
            startedAt: "2026-11-02T11:00:00.000Z",
            tagPseudonym: TAG,
          },
        ],
      }),
      BOOT,
      true,
    );
    expect(after.state).toBe("active");
    expect(after.completedAt).toBe("2026-11-02T11:00:00.000Z");
  });
});
