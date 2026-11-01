import {
  STATION_RESET_PHRASE,
  STATION_UNLOCK_PHRASE,
  type StationCommandInput,
  type StationCommandRecord,
  type StationCommandState,
  type StationCommandType,
} from "../shared/commands.js";
import type { EvidenceEvent } from "./events.js";

/** How long chargeOS waits for a charger answer before the outcome becomes uncertain. */
export const STATION_COMMAND_TIMEOUT_MS = 30_000;
const UNANSWERED_AFTER_MS = STATION_COMMAND_TIMEOUT_MS + 30_000;
const MAX_PROJECTED_COMMANDS = 20;
/** Only charger messages received this soon after the answer count as the command's outcome. */
export const OBSERVATION_WINDOW_MS = 5 * 60_000;

export class StationCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationCommandInputError";
  }
}

export class StationCommandConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationCommandConflictError";
  }
}

const COMMAND_KEYS: Readonly<Record<StationCommandType, readonly string[]>> = {
  ChangeAvailability: ["availability", "connectorId", "type"],
  RemoteStartTransaction: ["connectorId", "tagPseudonym", "type"],
  RemoteStopTransaction: ["transactionId", "type"],
  Reset: ["confirmation", "resetType", "type"],
  UnlockConnector: ["confirmation", "connectorId", "type"],
};

export function parseStationCommandInput(value: unknown): StationCommandInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StationCommandInputError("command must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const type = input.type;
  if (typeof type !== "string" || !Object.hasOwn(COMMAND_KEYS, type)) {
    throw new StationCommandInputError(
      "type must be RemoteStartTransaction, RemoteStopTransaction, Reset, UnlockConnector or ChangeAvailability",
    );
  }
  const allowed = COMMAND_KEYS[type as StationCommandType];
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) throw new StationCommandInputError(`unexpected field ${extra[0]}`);

  switch (type as StationCommandType) {
    case "RemoteStartTransaction": {
      if (
        typeof input.tagPseudonym !== "string" ||
        !/^tag_[a-f0-9]{24}$/u.test(input.tagPseudonym)
      ) {
        throw new StationCommandInputError("tagPseudonym must identify a desired owner card");
      }
      return {
        connectorId: connectorId(input.connectorId),
        tagPseudonym: input.tagPseudonym,
        type: "RemoteStartTransaction",
      };
    }
    case "RemoteStopTransaction": {
      const transactionId = input.transactionId;
      if (
        typeof transactionId !== "number" ||
        !Number.isSafeInteger(transactionId) ||
        transactionId < 1
      ) {
        throw new StationCommandInputError("transactionId must be a positive whole number");
      }
      return { transactionId, type: "RemoteStopTransaction" };
    }
    case "Reset": {
      if (input.resetType !== "Soft" && input.resetType !== "Hard") {
        throw new StationCommandInputError("resetType must be Soft or Hard");
      }
      if (input.confirmation !== STATION_RESET_PHRASE) {
        throw new StationCommandInputError("confirmation must exactly match the reset phrase");
      }
      return { confirmation: STATION_RESET_PHRASE, resetType: input.resetType, type: "Reset" };
    }
    case "UnlockConnector": {
      if (input.confirmation !== STATION_UNLOCK_PHRASE) {
        throw new StationCommandInputError("confirmation must exactly match the unlock phrase");
      }
      return {
        confirmation: STATION_UNLOCK_PHRASE,
        connectorId: connectorId(input.connectorId),
        type: "UnlockConnector",
      };
    }
    case "ChangeAvailability": {
      if (input.availability !== "Operative") {
        throw new StationCommandInputError(
          "availability must be Operative; chargeOS never makes a charger Inoperative because that persists without chargeOS",
        );
      }
      return {
        availability: "Operative",
        connectorId: connectorId(input.connectorId, true),
        type: "ChangeAvailability",
      };
    }
  }
}

function connectorId(value: unknown, allowWholeStation = false): number {
  const minimum = allowWholeStation ? 0 : 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > 99) {
    throw new StationCommandInputError(`connectorId must be a whole number from ${minimum} to 99`);
  }
  return value;
}

/** Transactions with a recorded start and no recorded stop. */
export function activeTransactions(
  events: readonly EvidenceEvent[],
): ReadonlyMap<number, { readonly connectorId: number }> {
  const active = new Map<number, { readonly connectorId: number }>();
  for (const event of events) {
    const payload = record(event.payload);
    if (
      event.message === "StartTransaction" &&
      typeof payload.transactionId === "number" &&
      typeof payload.connectorId === "number" &&
      !active.has(payload.transactionId)
    ) {
      active.set(payload.transactionId, { connectorId: payload.connectorId });
    }
    if (event.message === "StopTransaction" && typeof payload.transactionId === "number") {
      active.delete(payload.transactionId);
    }
  }
  return active;
}

/**
 * Connectors that currently hold a session. A start with no recorded stop stops counting once the
 * charger later reports that connector `Available` (for example after a power cut lost the stop),
 * so a phantom session cannot block remote start forever.
 */
export function occupiedConnectors(events: readonly EvidenceEvent[]): ReadonlySet<number> {
  const byConnector = new Map<number, number>();
  for (const event of events) {
    const payload = record(event.payload);
    if (
      event.message === "StartTransaction" &&
      typeof payload.transactionId === "number" &&
      typeof payload.connectorId === "number"
    ) {
      byConnector.set(payload.connectorId, payload.transactionId);
    } else if (event.message === "StopTransaction" && typeof payload.transactionId === "number") {
      for (const [connectorId, transactionId] of byConnector) {
        if (transactionId === payload.transactionId) byConnector.delete(connectorId);
      }
    } else if (
      event.message === "StatusNotification" &&
      typeof payload.connectorId === "number" &&
      payload.status === "Available"
    ) {
      byConnector.delete(payload.connectorId);
    }
  }
  return new Set(byConnector.keys());
}

/**
 * Build the owner-visible command history: what was requested, what the charger answered and what
 * later charger messages show actually happened. A missing answer never becomes success.
 */
export function buildStationCommands(
  events: readonly EvidenceEvent[],
  now = new Date(),
): readonly StationCommandRecord[] {
  interface Working {
    record: StationCommandRecord;
    readonly requestedIndex: number;
  }
  const commands = new Map<string, Working>();
  for (const [index, event] of events.entries()) {
    const payload = record(event.payload);
    const commandId = typeof payload.commandId === "string" ? payload.commandId : null;
    if (!commandId) continue;
    if (event.message === "StationCommandRequested" && event.direction === "system") {
      const type = payload.type;
      if (typeof type !== "string" || !Object.hasOwn(COMMAND_KEYS, type)) continue;
      if (commands.has(commandId)) continue;
      commands.set(commandId, {
        record: {
          commandId,
          connectorId: numberOrNull(payload.connectorId),
          observed: null,
          requestedAt: event.at,
          resetType:
            payload.resetType === "Hard" || payload.resetType === "Soft" ? payload.resetType : null,
          resolvedAt: null,
          state: "pending",
          status: null,
          tagPseudonym: typeof payload.tagPseudonym === "string" ? payload.tagPseudonym : null,
          transactionId: numberOrNull(payload.transactionId),
          type: type as StationCommandType,
        },
        requestedIndex: index,
      });
      continue;
    }
    const working = commands.get(commandId);
    if (!working || working.record.resolvedAt !== null) continue;
    if (event.message === "StationCommandResult" && typeof payload.status === "string") {
      working.record = {
        ...working.record,
        resolvedAt: event.at,
        state: answeredState(working.record.type, payload.status),
        status: payload.status,
      };
    } else if (event.message === "StationCommandFailed" && event.direction === "system") {
      const reason = typeof payload.reason === "string" ? payload.reason : "unknown";
      working.record = {
        ...working.record,
        resolvedAt: event.at,
        state:
          reason === "timeout" ||
          reason === "connection-lost" ||
          reason.startsWith("unreadable-reply:")
            ? "uncertain"
            : "failed",
        status: reason,
      };
    }
  }

  return [...commands.values()]
    .map(({ record: command, requestedIndex }) => {
      let current = command;
      if (
        current.state === "pending" &&
        now.getTime() - Date.parse(current.requestedAt) > UNANSWERED_AFTER_MS
      ) {
        current = { ...current, state: "uncertain", status: "no-answer-recorded" };
      }
      return {
        ...current,
        observed:
          current.state === "accepted" && current.resolvedAt !== null
            ? observedOutcome(current, current.resolvedAt, events.slice(requestedIndex + 1))
            : null,
      };
    })
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    .slice(0, MAX_PROJECTED_COMMANDS);
}

function answeredState(type: StationCommandType, status: string): StationCommandState {
  if (type === "UnlockConnector") return status === "Unlocked" ? "accepted" : "rejected";
  if (type === "ChangeAvailability") {
    return status === "Accepted" || status === "Scheduled" ? "accepted" : "rejected";
  }
  return status === "Accepted" ? "accepted" : "rejected";
}

function observedOutcome(
  command: StationCommandRecord,
  answeredAt: string,
  later: readonly EvidenceEvent[],
): string | null {
  const answered = Date.parse(answeredAt);
  const inWindow = later.filter((event) => {
    const at = Date.parse(event.at);
    return at >= answered - 1_000 && at <= answered + OBSERVATION_WINDOW_MS;
  });
  switch (command.type) {
    case "RemoteStartTransaction": {
      // Same connector and the same card chargeOS sent, received shortly after the answer.
      const start = inWindow.find((event) => {
        const payload = record(event.payload);
        return (
          event.message === "StartTransaction" &&
          payload.connectorId === command.connectorId &&
          payload.idTag === command.tagPseudonym
        );
      });
      const transactionId = record(start?.payload).transactionId;
      return typeof transactionId === "number"
        ? `Session #${transactionId} started on connector ${command.connectorId}`
        : null;
    }
    case "RemoteStopTransaction":
      return inWindow.some(
        (event) =>
          event.message === "StopTransaction" &&
          record(event.payload).transactionId === command.transactionId,
      )
        ? `Session #${command.transactionId} stopped`
        : null;
    case "Reset": {
      // A restart shows up as the connection dropping and a new BootNotification.
      const disconnect = inWindow.findIndex((event) => event.message === "Disconnected");
      const boot =
        disconnect < 0
          ? undefined
          : inWindow.slice(disconnect + 1).find((event) => event.message === "BootNotification");
      return boot ? `Charger restarted and reconnected at ${boot.at}` : null;
    }
    case "UnlockConnector":
      return command.status === "Unlocked" ? "Charger reported the connector unlocked" : null;
    case "ChangeAvailability": {
      const latest = new Map<number, string>();
      for (const event of inWindow) {
        const payload = record(event.payload);
        if (
          event.message === "StatusNotification" &&
          typeof payload.connectorId === "number" &&
          typeof payload.status === "string" &&
          (command.connectorId === 0 || payload.connectorId === command.connectorId)
        ) {
          latest.set(payload.connectorId, payload.status);
        }
      }
      if (!latest.size) return null;
      return [...latest]
        .sort(([left], [right]) => left - right)
        .map(([connectorId, status]) => `Connector ${connectorId} now reports ${status}`)
        .join("; ");
    }
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
