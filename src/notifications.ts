import { effect, signal } from "@preact/signals";

import type { OwnerSnapshot } from "../shared/contracts.js";
import { formatKwh, t } from "./i18n/index.js";
import { estimatedCost } from "./live-charging.js";
import { pollSnapshot, snapshot } from "./model.js";

/*
 * Browser notifications about the charger that is open in this console. They come from this tab
 * polling chargeOS, so they only arrive while the console is open somewhere on this device; there
 * is no push service. Turning them on changes nothing on the charger or in chargeOS.
 */

const STORAGE_KEY = "chargeos.notifications";
/** How often a hidden tab checks an open session; browsers throttle background timers to ~1/min. */
export const BACKGROUND_POLL_MS = 60_000;
/** How often a hidden tab checks an idle charger, so a fault still gets noticed. */
export const IDLE_POLL_MS = 5 * 60_000;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export const notificationsEnabled = signal(readEnabled());

export type NotificationSupport = "unsupported" | "insecure" | NotificationPermission;

export function notificationSupport(): NotificationSupport {
  if (typeof window === "undefined") return "unsupported";
  // Browsers hide or refuse the API outside HTTPS or this computer itself.
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Ask the browser for permission; turns notifications on only when it is granted. */
export async function enableNotifications(): Promise<NotificationSupport> {
  const support = notificationSupport();
  if (support === "unsupported" || support === "insecure" || support === "denied") return support;
  const permission = support === "granted" ? "granted" : await Notification.requestPermission();
  setEnabled(permission === "granted");
  return permission;
}

export function disableNotifications(): void {
  setEnabled(false);
}

function setEnabled(next: boolean): void {
  notificationsEnabled.value = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the choice lasts until the tab closes.
  }
}

export interface ChargingEvent {
  readonly body: string;
  /** Replaces an earlier notification about the same thing instead of stacking. */
  readonly tag: string;
  readonly title: string;
}

/**
 * What changed between two snapshots of the same charger that is worth a notification: a session
 * that finished, a connector that paused, resumed or reports a fault. Pure, so it is testable.
 */
export function chargingEvents(before: OwnerSnapshot, after: OwnerSnapshot): ChargingEvent[] {
  if (before.station.id !== after.station.id) return [];
  const station = after.station.label;
  const events: ChargingEvent[] = [];
  const wasOpen = new Set(
    before.sessions
      .filter(({ status }) => status === "active")
      .map(({ transactionId }) => transactionId),
  );
  for (const session of after.sessions) {
    if (session.status !== "complete" || !wasOpen.has(session.transactionId)) continue;
    const energy = session.energyWh ?? 0;
    const cost = estimatedCost(energy);
    events.push({
      body: cost
        ? t("notify.finishedBodyCost", { cost, energy: formatKwh(energy), station })
        : t("notify.finishedBody", { energy: formatKwh(energy), station }),
      tag: `chargeos-${after.station.id}-session-${session.transactionId}`,
      title: t("notify.finishedTitle"),
    });
  }
  const open = new Set(
    after.sessions
      .filter(({ status }) => status === "active")
      .map(({ connectorId }) => connectorId),
  );
  const previous = new Map(
    before.station.connectors.map((connector) => [connector.connectorId, connector]),
  );
  for (const connector of after.station.connectors) {
    if (connector.connectorId === 0) continue;
    const prior = previous.get(connector.connectorId)?.status;
    if (!prior || prior === connector.status) continue;
    const tag = `chargeos-${after.station.id}-connector-${connector.connectorId}`;
    const values = { connector: connector.connectorId, station };
    if (connector.status === "Faulted") {
      events.push({ body: t("notify.faultBody", values), tag, title: t("notify.faultTitle") });
    } else if (!open.has(connector.connectorId)) {
      continue;
    } else if (connector.status === "SuspendedEV") {
      events.push({ body: t("notify.pausedCarBody", values), tag, title: t("notify.pausedTitle") });
    } else if (connector.status === "SuspendedEVSE") {
      events.push({
        body: t("notify.pausedChargerBody", values),
        tag,
        title: t("notify.pausedTitle"),
      });
    } else if (
      connector.status === "Charging" &&
      (prior === "SuspendedEV" || prior === "SuspendedEVSE")
    ) {
      events.push({ body: t("notify.resumedBody", values), tag, title: t("notify.resumedTitle") });
    }
  }
  return events;
}

/** Whether the open charger has anything a notification could be about. */
function worthWatching(current: OwnerSnapshot | null): boolean {
  return Boolean(
    current?.sessions.some(({ status }) => status === "active") ||
    current?.station.connectors.some(
      ({ connectorId, status }) =>
        connectorId > 0 &&
        (status === "Charging" || status === "SuspendedEV" || status === "SuspendedEVSE"),
    ),
  );
}

let started = false;

/**
 * Watch snapshot changes for notification-worthy events, and keep reading the open charger while
 * this tab is hidden: once a minute during a charge, every five minutes otherwise. The overview's
 * own refresh handles a visible tab. Safe to call more than once.
 */
export function startChargingNotifications(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  let last: OwnerSnapshot | null = snapshot.peek();
  effect(() => {
    const next = snapshot.value;
    const before = last;
    last = next;
    if (!before || !next || !notificationsEnabled.peek()) return;
    if (notificationSupport() !== "granted") return;
    // Someone looking at the console already sees the change.
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    for (const event of chargingEvents(before, next)) {
      try {
        new Notification(event.title, { body: event.body, tag: event.tag });
      } catch {
        // Some platforms only allow notifications from a service worker; stay quiet there.
      }
    }
  });
  let lastPoll = 0;
  setInterval(() => {
    if (!notificationsEnabled.value || document.visibilityState !== "hidden") return;
    const current = snapshot.value;
    if (!current) return;
    const now = Date.now();
    if (!worthWatching(current) && now - lastPoll < IDLE_POLL_MS) return;
    lastPoll = now;
    void pollSnapshot();
  }, BACKGROUND_POLL_MS);
}
