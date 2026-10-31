import type { OwnerSnapshot } from "./contracts.js";

export type AiProvider = "openai" | "anthropic";
export interface TroubleshootingContext {
  readonly schemaVersion: 1;
  readonly connected: boolean;
  readonly readiness: "ready" | "blocked" | "unknown" | "not-inspected";
  readonly inspectedAt: string | null;
  readonly restartRequired: boolean;
  readonly checks: readonly {
    readonly id: string;
    readonly state: "pass" | "fail" | "unknown";
    readonly observed: string;
  }[];
  readonly authorization: {
    readonly state: OwnerSnapshot["authorization"]["syncState"];
    readonly pendingAdditions: number;
    readonly pendingRevocations: number;
  };
  readonly sessionConflicts: number;
}
export interface TroubleshootingInput {
  readonly provider: AiProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly question: string;
  readonly contextSha256: string;
  readonly consent: true;
  readonly webSearch: boolean;
}
export interface TroubleshootingPreview {
  readonly context: TroubleshootingContext;
  readonly sha256: string;
}
export interface TroubleshootingResult {
  readonly provider: AiProvider;
  readonly model: string;
  readonly advice: string;
  readonly contextSha256: string;
  readonly sources: readonly { readonly url: string; readonly title: string }[];
}
