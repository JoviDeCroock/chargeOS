/**
 * Employee self-service and the reimbursement feed: two delegate projections.
 *
 * Like every delegate projection they carry no owner-chosen names (charger, person or card names
 * stay in the owner directory) and no raw card numbers. Cards appear by charger-scoped pseudonym.
 */
import type { CardCaptureProjection } from "./card-capture.js";
import type { CardOwnership, CardUse } from "./cards.js";
import type { ConnectorStatus } from "./contracts.js";

export interface DriverCard {
  /** `true` when this employee may remove it: a personal card on their own charger. */
  readonly manageable: boolean;
  readonly onCharger: boolean;
  /** `null` until the owner classifies the card. */
  readonly ownership: CardOwnership | null;
  readonly tagPseudonym: string;
  readonly use: CardUse | null;
}

export interface DriverSession {
  readonly energyWh: number | null;
  readonly startedAt: string;
  readonly status: "active" | "complete";
  readonly stoppedAt: string | null;
  readonly tagPseudonym: string;
  readonly transactionId: number;
}

export interface DriverView {
  /** Tap-to-add state, only while the employee's own page started listening. */
  readonly cardCapture: CardCaptureProjection | null;
  readonly cards: readonly DriverCard[];
  readonly generatedAt: string;
  readonly grant: { readonly expiresAt: string };
  /** `true` when the charger passed its offline-readiness inspection. */
  readonly offlineReady: boolean;
  readonly sessions: readonly DriverSession[];
  readonly station: {
    readonly connected: boolean;
    readonly connectors: readonly ConnectorStatus[];
    readonly id: string;
  };
  readonly syncState: "current" | "never-synced" | "pending";
}

export interface DriverCardRemoveInput {
  /** The fixed revocation confirmation from `shared/owner-tags.ts`. */
  readonly confirmation: string;
}

export interface DriverCaptureConfirmInput {
  /** The pseudonym the employee page was shown for the tapped card. */
  readonly tagPseudonym: string;
}

export interface ReimbursementFeedSession {
  /** `unclassified` sessions are included for review; `private` cards are never included. */
  readonly cardUse: "business" | "unclassified";
  readonly cardOwnership: CardOwnership | null;
  readonly energyWh: number | null;
  readonly integrity: "consistent" | "conflict";
  readonly startedAt: string;
  readonly status: "active" | "complete";
  readonly stoppedAt: string | null;
  readonly tagPseudonym: string;
  readonly transactionId: number;
}

/** Monthly business charging per charger, for the commercial service's alias mapping. */
export interface ReimbursementFeed {
  readonly generatedAt: string;
  readonly month: string;
  readonly schemaVersion: 1;
  readonly stations: readonly {
    readonly sessions: readonly ReimbursementFeedSession[];
    readonly stationId: string;
  }[];
  readonly timeZone: string;
  /** Sessions left out because their card is marked private. Counted, never listed. */
  readonly excludedPrivateSessions: number;
}
