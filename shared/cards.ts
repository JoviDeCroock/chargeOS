/**
 * Card coupling, classification and fleet-wide card actions.
 *
 * A card is addressed by its charger-scoped pseudonym. The raw card number never appears in these
 * contracts: chargeOS captures it from the charger (or the owner types it once) and keeps it only in
 * the owner-tag registry. Ownership and use describe the card for permissions and reimbursement;
 * they never change what a charger accepts.
 */

/** Who owns the physical card. Employees may manage only `personal` cards on their own charger. */
export const CARD_OWNERSHIPS = ["company", "personal"] as const;
export type CardOwnership = (typeof CARD_OWNERSHIPS)[number];

/** Whether sessions with this card count for reimbursement. `private` sessions never do. */
export const CARD_USES = ["business", "private"] as const;
export type CardUse = (typeof CARD_USES)[number];

export interface CardPolicy {
  readonly ownership: CardOwnership;
  readonly use: CardUse;
}

export interface FleetCardMember {
  /** `true` once the charger accepted a full list containing this card. */
  readonly onCharger: boolean;
  readonly stationId: string;
  readonly tagPseudonym: string;
}

/** One physical card, recognised on every charger whose desired list contains it. */
export interface FleetCard {
  readonly members: readonly FleetCardMember[];
  /** `null` until the owner classifies the card. */
  readonly policy: CardPolicy | null;
}

export interface FleetCardsProjection {
  readonly cards: readonly FleetCard[];
}

export interface CardReference {
  readonly stationId: string;
  readonly tagPseudonym: string;
}

export interface FleetCardCopyInput {
  readonly card: CardReference;
  readonly toStationIds: readonly string[];
}

export interface FleetCardRemoveInput {
  readonly card: CardReference;
  /** The fixed revocation confirmation from `shared/owner-tags.ts`. */
  readonly confirmation: string;
}

export interface FleetCardPolicyInput {
  readonly card: CardReference;
  readonly ownership: CardOwnership;
  readonly use: CardUse;
}

export type FleetCardStationOutcome =
  | "added"
  | "already-present"
  | "removed"
  | "kept-last-card"
  | "not-present";

export interface FleetCardActionResult {
  readonly stations: readonly {
    readonly outcome: FleetCardStationOutcome;
    readonly stationId: string;
  }[];
}

export type SyncReadyOutcome =
  | "synced"
  | "already-current"
  | "offline"
  | "not-ready"
  | "no-cards"
  | "failed";

export interface SyncReadyResult {
  readonly stations: readonly {
    readonly listVersion: number | null;
    readonly outcome: SyncReadyOutcome;
    readonly stationId: string;
  }[];
}

export function isCardOwnership(value: unknown): value is CardOwnership {
  return typeof value === "string" && (CARD_OWNERSHIPS as readonly string[]).includes(value);
}

export function isCardUse(value: unknown): value is CardUse {
  return typeof value === "string" && (CARD_USES as readonly string[]).includes(value);
}
