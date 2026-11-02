/**
 * Live connection diagnostics for one charger. They are held in the gateway's memory only, so they
 * never reach the evidence ledger, exports, delegate projections or AI troubleshooting context, and
 * they disappear on restart. They contain closed reason codes, times and, only when the charger
 * proved this charger's own password, the name it connected with. Never a password or card value.
 */
export type RefusedConnectionReason =
  /** The charger name is right but no password arrived (or the user name was not the name). */
  | "password-missing"
  /** The charger name is right but the password is not this charger's password. */
  | "password-wrong"
  /** This charger's own password arrived with a different charger name. */
  | "identity-mismatch"
  /** A connection with this name is already open or still being set up. */
  | "already-connected"
  /** Name and password are right, but the charger did not offer OCPP 1.6 JSON. */
  | "protocol-not-offered";

export const REFUSED_CONNECTION_REASONS: readonly RefusedConnectionReason[] = [
  "password-missing",
  "password-wrong",
  "identity-mismatch",
  "already-connected",
  "protocol-not-offered",
];

export interface RefusedConnectionAttempt {
  readonly at: string;
  readonly reason: RefusedConnectionReason;
  /**
   * For `identity-mismatch` only: the name the charger used. It is shown because the charger proved
   * this charger's password; it is `null` when that name is not printable ASCII.
   */
  readonly presentedIdentity: string | null;
  /** For `protocol-not-offered` only: recognised OCPP protocol names the charger offered. */
  readonly offeredProtocols: readonly string[];
}

export interface StationConnectionDiagnostics {
  /**
   * The charger address to type into the charger tool, ending in a slash, when the deployment
   * declared it. The charger name follows the slash.
   */
  readonly endpointBase: string | null;
  /** The most recent refusal since this charger last connected, or since the server started. */
  readonly lastRefused: RefusedConnectionAttempt | null;
  /** Refusals attributed to this charger since the server started. */
  readonly refusedSinceStart: number;
  /**
   * Attempts with an unknown charger name and a password matching no charger, since the server
   * started. They cannot be attributed to a charger and may be unrelated internet traffic.
   */
  readonly unmatchedSinceStart: number;
  readonly lastUnmatchedAt: string | null;
}

/** OCPP-JSON subprotocol names worth showing back to an owner; anything else is dropped. */
export const DISPLAYABLE_OCPP_PROTOCOL = /^ocpp\d\.\d(?:\.\d)?$/u;
