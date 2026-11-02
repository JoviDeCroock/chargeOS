import type { CapabilityAssessment, CapabilityCheck } from "../shared/contracts.js";
import type { ContinuitySettingKey } from "../shared/continuity.js";

export type { CapabilityAssessment } from "../shared/contracts.js";

export function assessOwnerContinuity(
  configurationResponse: unknown,
  localListResponse: unknown,
  ownerTagCount: number,
): CapabilityAssessment {
  const configuration = configurationMap(configurationResponse);
  const unsupported = unknownKeys(configurationResponse);
  const unknownOfflineNotOffered = reportsUnknownOfflineNotOffered(configurationResponse);
  const localListVersion = readNumber(localListResponse, "listVersion");
  const checks: CapabilityCheck[] = [
    booleanCheck(
      "local-list-enabled",
      "Local authorization list enabled",
      "LocalAuthListEnabled",
      configuration,
      unsupported,
      true,
    ),
    booleanCheck(
      "known-tags-offline",
      "Known owner tags authorize offline",
      "LocalAuthorizeOffline",
      configuration,
      unsupported,
      true,
    ),
    booleanCheck(
      "unknown-tags-rejected",
      "Unknown tags remain rejected offline",
      "AllowOfflineTxForUnknownId",
      configuration,
      unsupported,
      false,
      unknownOfflineNotOffered ? UNKNOWN_OFFLINE_AUTHORIZATION_NOT_OFFERED : undefined,
    ),
    capacityCheck(
      "local-list-capacity",
      "One full list update can carry every owner tag",
      "SendLocalListMaxLength",
      configuration,
      unsupported,
      ownerTagCount,
    ),
    capacityCheck(
      "local-list-storage",
      "Local list storage can hold every owner tag",
      "LocalAuthListMaxLength",
      configuration,
      unsupported,
      ownerTagCount,
    ),
    ...(ownerTagCount === 0
      ? [
          {
            id: "owner-card",
            label: "At least one owner card is set up",
            observed: "no owner card yet",
            state: "fail",
          } satisfies CapabilityCheck,
        ]
      : []),
    {
      id: "local-list-version",
      label: "Local list version can be read",
      observed: localListVersion === null ? "not reported" : String(localListVersion),
      state: localListVersion === null || localListVersion < 0 ? "unknown" : "pass",
    },
  ];
  return {
    checkedAt: new Date().toISOString(),
    checks,
    localListVersion,
    restartRequired: false,
    state: checks.some((check) => check.state === "fail")
      ? "blocked"
      : checks.every((check) => check.state === "pass")
        ? "ready"
        : "unknown",
  };
}

export interface ContinuitySettingPlan {
  readonly currentValue: string | null;
  readonly desiredValue: "false" | "true";
  readonly key: ContinuitySettingKey;
  readonly state: "already-safe" | "blocked" | "change-required";
}

const CONTINUITY_SETTINGS: readonly {
  readonly desiredValue: "false" | "true";
  readonly key: ContinuitySettingKey;
}[] = [
  { desiredValue: "true", key: "LocalAuthListEnabled" },
  { desiredValue: "true", key: "LocalAuthorizeOffline" },
  { desiredValue: "false", key: "AllowOfflineTxForUnknownId" },
];

export function planOwnerContinuityPreparation(
  configurationResponse: unknown,
): readonly ContinuitySettingPlan[] {
  const entries = configurationEntries(configurationResponse);
  const unknownOfflineNotOffered = reportsUnknownOfflineNotOffered(configurationResponse);
  return CONTINUITY_SETTINGS.map(({ desiredValue, key }) => {
    const entry = entries.get(key);
    if (key === "AllowOfflineTxForUnknownId" && unknownOfflineNotOffered) {
      // OCPP 1.6 section 9.1.1: the key exists only when Unknown Offline Authorization is supported.
      return { currentValue: null, desiredValue, key, state: "already-safe" };
    }
    if (!entry) return { currentValue: null, desiredValue, key, state: "blocked" };
    if (entry.value.toLowerCase() === desiredValue) {
      return { currentValue: entry.value, desiredValue, key, state: "already-safe" };
    }
    return {
      currentValue: entry.value,
      desiredValue,
      key,
      state: entry.readonly === false ? "change-required" : "blocked",
    };
  });
}

function configurationMap(response: unknown): Map<string, string> {
  const values = new Map<string, string>();
  if (!response || typeof response !== "object") return values;
  const configurationKey = (response as { configurationKey?: unknown }).configurationKey;
  if (!Array.isArray(configurationKey)) return values;
  for (const entry of configurationKey) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: unknown }).key;
    const value = (entry as { value?: unknown }).value;
    if (typeof key === "string" && typeof value === "string") {
      values.set(key, value);
    }
  }
  return values;
}

function configurationEntries(
  response: unknown,
): Map<string, { readonly: boolean | null; value: string }> {
  const values = new Map<string, { readonly: boolean | null; value: string }>();
  if (!response || typeof response !== "object") return values;
  const configurationKey = (response as { configurationKey?: unknown }).configurationKey;
  if (!Array.isArray(configurationKey)) return values;
  for (const entry of configurationKey) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: unknown }).key;
    const readonly = (entry as { readonly?: unknown }).readonly;
    const value = (entry as { value?: unknown }).value;
    if (typeof key === "string" && typeof value === "string") {
      values.set(key, {
        readonly: typeof readonly === "boolean" ? readonly : null,
        value,
      });
    }
  }
  return values;
}

const UNSUPPORTED_OBSERVATION = "not supported by this charger";

/**
 * OCPP 1.6 edition 2, section 9.1.1: "If this key exists, the Charge Point supports Unknown Offline
 * Authorization." A charger that explicitly reports `AllowOfflineTxForUnknownId` as an unknown key,
 * and reports no configuration entry for it in any letter case (with or without a value), reports
 * that it does not offer the capability, which is the safe state. A key that is merely missing from
 * the answer, or a contradictory answer, never passes.
 */
const UNKNOWN_OFFLINE_AUTHORIZATION_NOT_OFFERED = {
  observed: "not offered by this charger, so unknown cards are never authorized offline",
  value: false,
} as const;

/** Fixed, data-free observation texts that may be shared in troubleshooting context. */
export const FIXED_CAPABILITY_OBSERVATIONS: ReadonlySet<string> = new Set([
  UNSUPPORTED_OBSERVATION,
  UNKNOWN_OFFLINE_AUTHORIZATION_NOT_OFFERED.observed,
]);

function booleanCheck(
  id: string,
  label: string,
  key: string,
  configuration: ReadonlyMap<string, string>,
  unsupported: ReadonlySet<string>,
  expected: boolean,
  whenUnsupported?: { readonly observed: string; readonly value: boolean },
): CapabilityCheck {
  const observed = configuration.get(key);
  if (observed === undefined && unsupported.has(key)) {
    if (whenUnsupported) {
      return {
        id,
        label,
        observed: whenUnsupported.observed,
        state: whenUnsupported.value === expected ? "pass" : "fail",
      };
    }
    return { id, label, observed: UNSUPPORTED_OBSERVATION, state: "fail" };
  }
  // Letter case varies between firmwares; padding does not. A padded value may not be read as
  // enabled by firmware that compares exactly, so it stays unknown and is not trimmed into a pass.
  const value = observed?.toLowerCase();
  const parsed = value === "true" ? true : value === "false" ? false : null;
  return {
    id,
    label,
    observed: observed ?? "not reported",
    state: parsed === null ? "unknown" : parsed === expected ? "pass" : "fail",
  };
}

function capacityCheck(
  id: string,
  label: string,
  key: string,
  configuration: ReadonlyMap<string, string>,
  unsupported: ReadonlySet<string>,
  ownerTagCount: number,
): CapabilityCheck {
  const maxLength = numberValue(configuration.get(key));
  if (maxLength === null && unsupported.has(key)) {
    return { id, label, observed: UNSUPPORTED_OBSERVATION, state: "fail" };
  }
  return {
    id,
    label,
    observed: maxLength === null ? "not reported" : `${maxLength} entries`,
    state: maxLength === null ? "unknown" : maxLength >= ownerTagCount ? "pass" : "fail",
  };
}

function numberValue(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function reportsUnknownOfflineNotOffered(response: unknown): boolean {
  const key = "AllowOfflineTxForUnknownId";
  if (!unknownKeys(response).has(key)) return false;
  const configurationKey = record(response).configurationKey;
  if (!Array.isArray(configurationKey)) return true;
  // Configuration keys are case-insensitive CiString50 values; any entry at all means the key exists.
  return !configurationKey.some((entry) => {
    const name = record(entry).key;
    return typeof name === "string" && name.toLowerCase() === key.toLowerCase();
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unknownKeys(response: unknown): ReadonlySet<string> {
  if (!response || typeof response !== "object") return new Set();
  const unknownKey = (response as { unknownKey?: unknown }).unknownKey;
  return new Set(
    Array.isArray(unknownKey) ? unknownKey.filter((key) => typeof key === "string") : [],
  );
}

function readNumber(value: unknown, field: string): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : null;
}
