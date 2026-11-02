/**
 * "Tap your card": the owner asks chargeOS to listen, taps the card at the charger, and adds the
 * card it saw. The charger still refuses the tap (unknown cards are always refused); chargeOS only
 * remembers the card value in memory, for a few minutes, so the owner can add it without typing it.
 * Projections carry the card's pseudonym, never its value.
 */
export type CardCaptureState =
  /** Not listening. */
  | "idle"
  /** Waiting for a card to be tapped at the charger. */
  | "listening"
  /** One unknown card was tapped and can be added. */
  | "captured"
  /** The tapped card is already one of this charger's cards. */
  | "known"
  /** More than one different card was tapped, so none is offered; listen again. */
  | "several"
  /** Listening ended without a card. */
  | "expired";

export interface CardCaptureProjection {
  readonly state: CardCaptureState;
  /** When listening stops (`listening`) or when the tapped card is forgotten (`captured`). */
  readonly until: string | null;
  readonly tappedAt: string | null;
  readonly tagPseudonym: string | null;
}

export interface CardCaptureConfirmInput {
  readonly tagPseudonym: string;
}

/** How long chargeOS listens for a tap after the owner asks it to. */
export const CARD_CAPTURE_LISTEN_MS = 2 * 60_000;
/** How long a tapped card stays available to add before chargeOS forgets it. */
export const CARD_CAPTURE_HOLD_MS = 5 * 60_000;

export const IDLE_CARD_CAPTURE: CardCaptureProjection = {
  state: "idle",
  tagPseudonym: null,
  tappedAt: null,
  until: null,
};
