import { localConfiguration, publicServiceOrigin } from "../configuration.js";
/** Metadata validation only. This cannot create a public runtime capability. */
export function recoverySourceOrigin(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (!!publicServiceOrigin(value) ||
      !!localConfiguration({
        SERVICE_MODE: "local",
        SERVICE_ORIGIN: value,
        SERVICE_AUTH_SECRET: "recovery-origin-validation-only-secret",
      }))
  );
}
