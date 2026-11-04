import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type { ChargeSession } from "../shared/contracts.js";
import type { OwnerDirectory } from "../shared/directory.js";
import { formatDate, formatKwh, t, tn, type MessageKey } from "./i18n/index.js";

export type Tone = "ok" | "warn" | "risk" | "live" | "idle";

export function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ComponentChildren;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd class={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

export function StatusPill({
  connected,
  awaitingConnection = false,
}: {
  connected: boolean;
  awaitingConnection?: boolean;
}) {
  return (
    <span class={`status-pill ${connected ? "connected" : "offline"}`}>
      <span class="signal-dot" aria-hidden="true" />
      {t(
        connected
          ? "status.connected"
          : awaitingConnection
            ? "overview.notConnected"
            : "status.offline",
      )}
    </span>
  );
}

/** Small modal dialog. Escape and the backdrop close it; focus starts on the first field. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current
      ?.querySelector<HTMLElement>("input, select, textarea, button:not(.dialog-close)")
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      class="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        class="dialog glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={panel}
      >
        <header class="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button
            class="dialog-close"
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Select a person from the directory, or nobody. */
export function PersonSelect({
  label,
  value,
  onChange,
  people,
}: {
  label: string;
  value: string | null;
  onChange: (personId: string | null) => void;
  people: OwnerDirectory["people"];
}) {
  return (
    <label>
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value || null)}>
        <option value="">{t("people.nobody")}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function personName(
  directory: OwnerDirectory | null,
  personId: string | null,
): string | null {
  if (!directory || !personId) return null;
  return directory.people.find(({ id }) => id === personId)?.name ?? null;
}

/** Human label for a card: its name, else a short pseudonym so unnamed cards stay distinguishable. */
export function cardLabel(
  directory: OwnerDirectory | null,
  stationId: string,
  tagPseudonym: string,
): { name: string; holder: string | null; named: boolean } {
  const card = directory?.cards.find(
    (candidate) => candidate.stationId === stationId && candidate.tagPseudonym === tagPseudonym,
  );
  return {
    holder: personName(directory, card?.holderPersonId ?? null),
    name: card?.name ?? t("cards.unnamedShort", { id: shortPseudonym(tagPseudonym) }),
    named: Boolean(card?.name),
  };
}

export function shortPseudonym(tagPseudonym: string): string {
  return tagPseudonym.replace(/^tag_/u, "").slice(0, 6);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/u);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function connectorTone(status: string): Tone {
  if (status === "Charging") return "live";
  if (status === "Available") return "ok";
  if (status === "Faulted" || status === "Unavailable") return "risk";
  if (status === "SuspendedEV" || status === "SuspendedEVSE" || status === "Preparing")
    return "warn";
  return "idle";
}

const CONNECTOR_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  Available: "connector.Available",
  Charging: "connector.Charging",
  Faulted: "connector.Faulted",
  Finishing: "connector.Finishing",
  Preparing: "connector.Preparing",
  Reserved: "connector.Reserved",
  SuspendedEV: "connector.SuspendedEV",
  SuspendedEVSE: "connector.SuspendedEVSE",
  Unavailable: "connector.Unavailable",
};

/** Plain-language OCPP connector status; unknown values are shown as reported. */
export function connectorStatusLabel(status: string): string {
  const key = CONNECTOR_STATUS_KEYS[status];
  return key ? t(key) : status;
}

export function SessionTable({
  sessions,
  directory,
  stationId,
}: {
  sessions: readonly ChargeSession[];
  directory: OwnerDirectory | null;
  stationId: string;
}) {
  if (!sessions.length) return <p class="empty-state">{t("sessions.empty")}</p>;
  return (
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t("sessions.started")}</th>
            <th>{t("sessions.card")}</th>
            <th>{t("sessions.connector")}</th>
            <th class="numeric">{t("sessions.energy")}</th>
            <th>{t("sessions.status")}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const card = cardLabel(directory, stationId, session.tagPseudonym);
            return (
              <tr key={session.transactionId}>
                <td class="nowrap">{formatDate(session.startedAt)}</td>
                <td>
                  {card.name}
                  {card.holder && <small class="cell-sub">{card.holder}</small>}
                  {session.authorizationStatus !== "Accepted" && (
                    <small class="cell-sub risk-text">{t("sessions.cardRefused")}</small>
                  )}
                </td>
                <td>{session.connectorId}</td>
                <td class="numeric">
                  {session.energyWh !== null ? (
                    formatKwh(session.energyWh)
                  ) : session.status === "active" && session.latestMeterReading ? (
                    <>
                      {formatKwh(session.latestMeterReading.energyWh)}
                      <small class="cell-sub">{t("sessions.soFar")}</small>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span
                    class={`table-status ${session.integrity === "conflict" ? "conflict" : session.status}`}
                  >
                    {t(
                      session.integrity === "conflict"
                        ? "sessions.conflict"
                        : session.status === "active"
                          ? "sessions.active"
                          : "sessions.complete",
                    )}
                  </span>
                  {session.replayedMessageCount > 0 && (
                    <small class="cell-sub">
                      {tn("sessions.retries", session.replayedMessageCount)}
                    </small>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PageHead({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <header class={`page-head${actions ? " with-actions" : ""}`}>
      <div>
        <h1>{title}</h1>
        {lede && <p class="lede">{lede}</p>}
      </div>
      {actions && <div class="head-actions">{actions}</div>}
    </header>
  );
}

/** Closes the `<details>` overflow menu that contains the clicked item, so a dialog opens alone. */
export function closeRowMenu(event: MouseEvent): void {
  const menu = (event.currentTarget as HTMLElement | null)?.closest("details");
  if (menu) menu.open = false;
}
