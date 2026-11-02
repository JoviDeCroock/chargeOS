import type { OwnerSnapshot } from "../shared/contracts.js";
import type { SetupStep, SetupStepId, StationSetup } from "../shared/onboarding.js";
import type { ExpectedChargerIdentity } from "../shared/stations.js";

/**
 * Derives a charger's setup checklist from its owner snapshot. Every "done" is an observed fact
 * from the ledger; an expected identity that does not match the charger's Boot is a stop condition.
 */
export function buildStationSetup(
  snapshot: Pick<OwnerSnapshot, "authorization" | "readiness" | "sessions" | "station">,
  expected: ExpectedChargerIdentity | null,
  hasConnected: boolean,
): StationSetup {
  const boot = snapshot.station.boot;
  const identityMatches =
    boot !== null &&
    (expected === null ||
      (same(boot.vendor, expected.vendor) &&
        same(boot.model, expected.model) &&
        (expected.firmwareVersion === null ||
          same(boot.firmwareVersion, expected.firmwareVersion))));
  const authorization = snapshot.authorization;
  // A check that fails only on "no owner card yet" is not a charger problem: the card step comes
  // first, and once a card exists that result is stale, so the step asks for a new check.
  const readiness =
    snapshot.readiness &&
    snapshot.readiness.checks.some(({ id, state }) => id === "owner-card" && state === "fail") &&
    snapshot.readiness.checks.every(({ id, state }) => id === "owner-card" || state === "pass")
      ? null
      : snapshot.readiness;
  const synced = authorization.tagCount > 0 && authorization.syncState === "current";
  const testCharge =
    synced && authorization.lastSyncAt
      ? (snapshot.sessions.find(
          (session) =>
            session.authorizationStatus === "Accepted" &&
            session.startedAt >= authorization.lastSyncAt! &&
            authorization.tagPseudonyms.includes(session.tagPseudonym),
        ) ?? null)
      : null;

  const facts: Record<
    SetupStepId,
    { done: boolean; stopped?: SetupStep["detail"]; detail?: SetupStep["detail"] }
  > = {
    connected: { done: hasConnected || snapshot.station.connected },
    identity: boot
      ? identityMatches
        ? { done: true, ...(expected === null ? { detail: "identity-unchecked" as const } : {}) }
        : { done: false, stopped: "identity-mismatch" }
      : { done: false },
    cards: { done: authorization.tagCount > 0 },
    "offline-ready":
      readiness?.state === "ready"
        ? { done: true }
        : readiness?.restartRequired
          ? { done: false, detail: "restart-required" }
          : readiness?.state === "blocked"
            ? { done: false, stopped: "readiness-blocked" }
            : { done: false },
    "cards-on-charger": synced
      ? { done: true }
      : authorization.lastAttemptStatus && authorization.lastAttemptStatus !== "Accepted"
        ? { done: false, detail: "sync-rejected" }
        : { done: false },
    "test-charge": { done: testCharge !== null },
  };

  let reachedCurrent = false;
  let stopped = false;
  const steps = (Object.keys(facts) as SetupStepId[]).map((id): SetupStep => {
    const fact = facts[id];
    if (fact.done) return { detail: fact.detail ?? null, id, state: "done" };
    if (fact.stopped) {
      stopped = true;
      reachedCurrent = true;
      return { detail: fact.stopped, id, state: "stopped" };
    }
    if (!reachedCurrent) {
      reachedCurrent = true;
      return { detail: fact.detail ?? null, id, state: "current" };
    }
    return { detail: fact.detail ?? null, id, state: "waiting" };
  });
  const allDone = steps.every(({ state }) => state === "done");
  return {
    completedAt: allDone ? (testCharge?.startedAt ?? null) : null,
    state: stopped
      ? "stopped"
      : allDone
        ? "active"
        : facts.connected.done
          ? "in-progress"
          : "waiting-for-charger",
    steps,
  };
}

function same(actual: string | null, expected: string): boolean {
  return (actual ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
}
