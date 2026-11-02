import { signal } from "@preact/signals";

import type { ConsoleProfile } from "../shared/usage.js";

/**
 * Optional console modules. Hiding a module only changes what this browser shows: every API,
 * safety check, owner card and offline authorization keeps working exactly as before.
 */
export const OPTIONAL_MODULES = ["liberation", "sharing", "evidence", "assist"] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export const MODULE_INFO: Readonly<
  Record<OptionalModule, { readonly description: string; readonly label: string }>
> = {
  assist: {
    description: "Ask your own AI provider for read-only troubleshooting advice.",
    label: "AI troubleshooting",
  },
  evidence: {
    description: "Inspect the tamper-evident event history and download exports.",
    label: "Evidence",
  },
  liberation: {
    description:
      "Move a charger away from its previous provider and run the witnessed Freedom Test.",
    label: "Switching and Freedom Test",
  },
  sharing: {
    description: "Give an installer, employer or energy provider expiring read-only access.",
    label: "Delegated access",
  },
};

export const PROFILE_DEFAULT_MODULES: Readonly<Record<ConsoleProfile, readonly OptionalModule[]>> =
  {
    company: ["sharing", "evidence"],
    personal: [],
  };

const STORAGE_KEY = "chargeos.consoleModules";

function readStoredModules(): readonly OptionalModule[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return OPTIONAL_MODULES.filter((module) => value.includes(module));
  } catch {
    return null;
  }
}

/** `null` means "follow the operator's profile defaults". */
export const chosenModules = signal<readonly OptionalModule[] | null>(readStoredModules());

export function enabledModules(profile: ConsoleProfile): ReadonlySet<OptionalModule> {
  return new Set(chosenModules.value ?? PROFILE_DEFAULT_MODULES[profile]);
}

export function setModuleEnabled(
  profile: ConsoleProfile,
  module: OptionalModule,
  enabled: boolean,
): void {
  const next = new Set(enabledModules(profile));
  if (enabled) next.add(module);
  else next.delete(module);
  const ordered = OPTIONAL_MODULES.filter((candidate) => next.has(candidate));
  chosenModules.value = ordered;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
  } catch {
    // Private browsing can refuse storage; the choice still applies until reload.
  }
}

export function resetModules(): void {
  chosenModules.value = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
