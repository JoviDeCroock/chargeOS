import type { EvidenceEvent } from "./events.js";

/** Evidence message chargeOS records just before asking a charger to send its BootNotification. */
export const BOOT_TRIGGER_MESSAGE = "TriggerMessage";

/**
 * Whether the BootNotification at `bootIndex` may have been sent because chargeOS asked for it
 * with TriggerMessage on the same connection.
 *
 * A requested Boot reports the charger's identity, but it is not a restart: the charger keeps its
 * running configuration and connection. Anything that treats a Boot as proof of a restart or of a
 * new connection (a pending `RebootRequired`, an owner restart command, the authorized post-switch
 * Boot in the migration dossier) must ignore requested Boots. Fail closed: any request recorded
 * after the charger's latest `Connected` (or `Disconnected`) marks every later Boot on that connection as requested,
 * whatever the charger answered.
 */
export function isRequestedBoot(events: readonly EvidenceEvent[], bootIndex: number): boolean {
  const boot = events[bootIndex];
  if (!boot || boot.message !== "BootNotification") return false;
  for (let index = bootIndex - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.stationId !== boot.stationId) continue;
    // The charger's previous connection ended here, so earlier requests belong to that one.
    if (event.message === "Connected" || event.message === "Disconnected") return false;
    if (
      event.message === BOOT_TRIGGER_MESSAGE &&
      event.direction === "csms-to-station" &&
      requestedMessage(event.payload) === "BootNotification"
    ) {
      return true;
    }
  }
  return false;
}

/** Whether `event` is a BootNotification the charger sent on its own (after starting up). */
export function isUnrequestedBoot(
  events: readonly EvidenceEvent[],
  event: EvidenceEvent,
  index: number,
): boolean {
  return event.message === "BootNotification" && !isRequestedBoot(events, index);
}

function requestedMessage(payload: unknown): unknown {
  return payload && typeof payload === "object"
    ? (payload as { requestedMessage?: unknown }).requestedMessage
    : undefined;
}
