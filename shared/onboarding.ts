/**
 * Charger setup progress: a read-only projection of recorded evidence. Each step passes only on
 * observed facts (a connection, a matching Boot, a ready inspection, an accepted full list, an
 * accepted charge). It never performs a step and never treats an instruction as evidence.
 */

export const SETUP_STEPS = [
  "connected",
  "identity",
  "cards",
  "offline-ready",
  "cards-on-charger",
  "test-charge",
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

export type SetupStepState = "done" | "current" | "waiting" | "stopped";

export interface SetupStep {
  readonly id: SetupStepId;
  readonly state: SetupStepState;
  /** Closed code explaining a stop or what is awaited; the console translates it. */
  readonly detail:
    | "identity-mismatch"
    | "identity-unchecked"
    | "readiness-blocked"
    | "restart-required"
    | "sync-rejected"
    | null;
}

export interface StationSetup {
  readonly state: "waiting-for-charger" | "in-progress" | "stopped" | "active";
  readonly steps: readonly SetupStep[];
  readonly completedAt: string | null;
}
