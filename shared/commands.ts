// Owner-only remote charger commands (feature register P08/P09).
//
// `ChangeAvailability` is limited to `Operative`: OCPP persists `Inoperative` across reboots, so a
// charger disabled through chargeOS could strand the owner if chargeOS later disappears.

export const STATION_RESET_PHRASE = "I understand this restarts the charger and may end a session";
export const STATION_UNLOCK_PHRASE = "I am at the charger and the cable is safe to release";

export type StationCommandInput =
  | {
      readonly connectorId: number;
      readonly tagPseudonym: string;
      readonly type: "RemoteStartTransaction";
    }
  | { readonly transactionId: number; readonly type: "RemoteStopTransaction" }
  | {
      readonly confirmation: string;
      readonly resetType: "Hard" | "Soft";
      readonly type: "Reset";
    }
  | {
      readonly confirmation: string;
      readonly connectorId: number;
      readonly type: "UnlockConnector";
    }
  | {
      readonly availability: "Operative";
      readonly connectorId: number;
      readonly type: "ChangeAvailability";
    };

export type StationCommandType = StationCommandInput["type"];

/**
 * - `pending`: sent, no answer yet.
 * - `accepted` / `rejected`: the charger's explicit answer.
 * - `uncertain`: timeout, disconnect or a crash before the answer; the charger may or may not have
 *   acted, so the owner must check the observed state instead of retrying blindly.
 * - `failed`: chargeOS did not send the command or the charger answered with a protocol error.
 */
export type StationCommandState = "accepted" | "failed" | "pending" | "rejected" | "uncertain";

export interface StationCommandRecord {
  readonly commandId: string;
  readonly connectorId: number | null;
  /** What later charger messages show actually happened, if anything yet. */
  readonly observed: string | null;
  readonly requestedAt: string;
  readonly resetType: "Hard" | "Soft" | null;
  readonly resolvedAt: string | null;
  readonly state: StationCommandState;
  /** The charger's literal status (for example `Accepted`, `Unlocked`, `Scheduled`) or a failure reason. */
  readonly status: string | null;
  readonly tagPseudonym: string | null;
  readonly transactionId: number | null;
  readonly type: StationCommandType;
}

export interface StationCommandResult {
  readonly command: StationCommandRecord;
}
