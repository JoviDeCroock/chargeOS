import type { CapabilityAssessment } from "./contracts.js";

export const CONTINUITY_PREPARATION_PHRASE =
  "I authorize only the documented owner-continuity settings";

export type ContinuitySettingKey =
  | "AllowOfflineTxForUnknownId"
  | "LocalAuthListEnabled"
  | "LocalAuthorizeOffline";

export interface ContinuityPreparationInput {
  readonly confirmation: string;
}

export interface ContinuityPreparationChange {
  readonly from: string;
  readonly key: ContinuitySettingKey;
  readonly status: "Accepted";
  readonly to: "false" | "true";
}

export interface ContinuityPreparationResult {
  readonly assessment: CapabilityAssessment;
  readonly changes: readonly ContinuityPreparationChange[];
  readonly state: "ready";
}
