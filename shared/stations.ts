/**
 * Chargers added, retired and classified from the owner console.
 *
 * A charger added here is provisioned exactly like one in the stations file: it has its own
 * identity and password, it must authenticate on every connection, and unknown chargers are still
 * refused. Ownership only describes who owns the hardware; it never grants or removes authority.
 */

export const STATION_OWNERSHIPS = ["company", "employee"] as const;
export type StationOwnership = (typeof STATION_OWNERSHIPS)[number];

export const STATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
export const EXPECTED_IDENTITY_MAX_LENGTH = 50;
export const STATION_RETIREMENT_PREFIX = "RETIRE";

export interface ExpectedChargerIdentity {
  readonly firmwareVersion: string | null;
  readonly model: string;
  readonly vendor: string;
}

export interface AddStationInput {
  readonly driverPersonId: string | null;
  readonly expected: ExpectedChargerIdentity | null;
  /** Leave empty to let chargeOS choose a charger name. */
  readonly id: string | null;
  readonly label: string;
  readonly ownership: StationOwnership;
  readonly site: string;
}

/** Everything an installer types into the charger. Shown once; the password is never stored in the browser. */
export interface ChargerSetupSheet {
  /** `null` when the deployment did not declare its public charger address. */
  readonly endpoint: string | null;
  readonly password: string;
  readonly protocol: "OCPP 1.6J";
  readonly stationId: string;
}

export interface AddStationResult {
  readonly setupSheet: ChargerSetupSheet;
  readonly stationId: string;
}

export interface RetireStationInput {
  /** Must be exactly `RETIRE <station id>`. */
  readonly confirmation: string;
}

export interface StationOwnershipInput {
  readonly ownership: StationOwnership;
}

export interface ManagedStationSummary {
  readonly addedAt: string | null;
  readonly expected: ExpectedChargerIdentity | null;
  readonly id: string;
  /** `true` for chargers added from the console; stations-file chargers are `false`. */
  readonly managed: boolean;
  readonly ownership: StationOwnership | null;
}

export interface RetiredStationSummary {
  readonly id: string;
  readonly retiredAt: string;
}

export interface StationRegistryProjection {
  /** OCPP connection ceiling of this server; adding beyond it needs CHARGEOS_OCPP_MAX_CONNECTIONS. */
  readonly connectionLimit: number;
  readonly retired: readonly RetiredStationSummary[];
  readonly stations: readonly ManagedStationSummary[];
}

export function retirementPhrase(stationId: string): string {
  return `${STATION_RETIREMENT_PREFIX} ${stationId}`;
}

export function isStationOwnership(value: unknown): value is StationOwnership {
  return typeof value === "string" && (STATION_OWNERSHIPS as readonly string[]).includes(value);
}
