import { useEffect, useState } from "preact/hooks";

import type { DriverView } from "../../shared/driver.js";
import { BrandMark } from "../brand.js";
import {
  driverArmCapture,
  driverCancelCapture,
  driverConfirmCapture,
  driverRemoveCard,
  driverSync,
  fetchDriverView,
} from "../fleet-client.js";
import {
  applyDocumentLanguage,
  formatDate,
  formatKwh,
  formatTime,
  t,
  tn,
  type MessageKey,
} from "../i18n/index.js";
import { LanguagePicker } from "../usage.js";

const STORAGE_KEY = "chargeos.driverAccess";

interface Access {
  readonly stationId: string;
  readonly token: string;
}

/** Reads the link once, keeps it for this browser tab, and removes the secret from the address bar. */
function readAccess(): Access | null {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const stationId = fragment.get("station");
  const token = fragment.get("token");
  if (stationId && token) {
    const access = { stationId, token };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(access));
    window.history.replaceState(null, "", window.location.pathname);
    return access;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Access | null;
    return stored && typeof stored.stationId === "string" && typeof stored.token === "string"
      ? stored
      : null;
  } catch {
    return null;
  }
}

/**
 * An employee's own page: their charger, their sessions and their cards. It uses a time-limited
 * delegate link from their employer. They may register and remove personal cards only; company
 * cards and every other charger stay with the owner.
 */
export function DriverWorkspace() {
  const [access] = useState(readAccess);
  const [view, setView] = useState<DriverView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async (work?: () => Promise<DriverView>) => {
    if (!access) return;
    setBusy(Boolean(work));
    try {
      setView(await (work ?? (() => fetchDriverView(access.stationId, access.token)))());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("notice.failed"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    applyDocumentLanguage();
    void load();
  }, []);

  const capture = view?.cardCapture ?? null;
  const listening = capture?.state === "listening";
  useEffect(() => {
    if (!listening) return;
    const poll = setInterval(() => void load(), 1_500);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [listening]);

  if (!access) {
    return (
      <Shell>
        <section class="glass driver-card">
          <h1>{t("driver.noLink.title")}</h1>
          <p>{t("driver.noLink.body")}</p>
        </section>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <section class="glass driver-card">
          <p role="status">{error ?? t("app.opening")}</p>
        </section>
      </Shell>
    );
  }

  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = view.sessions.filter(({ startedAt }) => startedAt.startsWith(month));
  const charging = view.station.connectors.some(({ status }) => status === "Charging");
  const removable = view.cards.find(({ tagPseudonym }) => tagPseudonym === removing);

  return (
    <Shell>
      {error && <div class="notice error">{error}</div>}
      <section
        class={`glass driver-hero ${view.station.connected ? (charging ? "live" : "ok") : "idle"}`}
      >
        <span class="driver-ring" aria-hidden="true" />
        <div>
          <p class="driver-kicker">{t("driver.yourCharger")}</p>
          <h1>
            {charging
              ? t("driver.state.charging")
              : view.station.connected
                ? t("driver.state.ready")
                : t("driver.state.offline")}
          </h1>
          <p>{view.offlineReady ? t("driver.offlineReady") : t("driver.offlineUnknown")}</p>
        </div>
        <dl class="driver-month">
          <div>
            <dt>{t("usage.thisMonth")}</dt>
            <dd>
              {formatKwh(thisMonth.reduce((total, session) => total + (session.energyWh ?? 0), 0))}
            </dd>
          </div>
          <div>
            <dt>{t("driver.sessions")}</dt>
            <dd>{thisMonth.length}</dd>
          </div>
        </dl>
      </section>

      <section class="glass driver-card" aria-labelledby="driver-cards">
        <header class="panel-head">
          <h2 id="driver-cards">{t("driver.cards")}</h2>
          {!listening && capture?.state !== "captured" && (
            <button
              class="button primary compact"
              type="button"
              disabled={busy || !view.station.connected}
              onClick={() => void load(() => driverArmCapture(access.stationId, access.token))}
            >
              {t("driver.addPersonal")}
            </button>
          )}
        </header>

        {listening && capture.until && (
          <div class="tap-stage compact" role="status" aria-live="polite">
            <div class="tap-visual" aria-hidden="true">
              <span class="tap-ring" />
              <span class="tap-ring delay" />
              <span class="tap-glyph" />
            </div>
            <strong>{t("driver.tapNow")}</strong>
            <p class="tap-countdown">
              {t("fleet.capture.remaining", {
                time: countdown(Date.parse(capture.until) - now),
              })}
            </p>
            <button
              class="button ghost compact"
              type="button"
              onClick={() => void load(() => driverCancelCapture(access.stationId, access.token))}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
        {capture?.state === "captured" && capture.tagPseudonym && (
          <div class="tap-result driver-confirm">
            <span class="tap-glyph small" aria-hidden="true" />
            <div>
              <strong>
                {t("fleet.capture.tapped", {
                  time: capture.tappedAt ? formatTime(capture.tappedAt) : "—",
                })}
              </strong>
              <small>{t("driver.personalNote")}</small>
            </div>
            <div class="driver-confirm-actions">
              <button
                class="button ghost compact"
                type="button"
                onClick={() => void load(() => driverCancelCapture(access.stationId, access.token))}
              >
                {t("fleet.capture.discard")}
              </button>
              <button
                class="button primary compact"
                type="button"
                disabled={busy}
                onClick={() =>
                  void load(() =>
                    driverConfirmCapture(access.stationId, capture.tagPseudonym!, access.token),
                  )
                }
              >
                {t("cards.add")}
              </button>
            </div>
          </div>
        )}

        {capture && ["known", "several", "expired"].includes(capture.state) && (
          <p class={`inline-alert ${capture.state === "known" ? "idle" : "warn"}`} role="status">
            {t(
              capture.state === "expired"
                ? "fleet.capture.expired"
                : (`cards.tap.${capture.state}` as MessageKey),
            )}
          </p>
        )}

        <ul class="card-list">
          {view.cards.map((card) => (
            <li class="card-row" key={card.tagPseudonym}>
              <span class="rfid-chip" aria-hidden="true" />
              <div class="card-main">
                <strong>{t("cards.unnamedShort", { id: card.tagPseudonym.slice(4, 10) })}</strong>
                <small>
                  {card.ownership
                    ? t(`fleet.card.ownership.${card.ownership}` as MessageKey)
                    : t("fleet.card.unclassified")}
                  {card.use ? ` · ${t(`fleet.card.use.${card.use}` as MessageKey)}` : ""}
                </small>
              </div>
              <span class={`state-chip ${card.onCharger ? "ok" : "warn"}`}>
                {t(card.onCharger ? "cards.onCharger" : "cards.waiting")}
              </span>
              <div class="card-actions">
                {card.manageable && (
                  <button
                    class="button danger-ghost compact"
                    type="button"
                    onClick={() => setRemoving(card.tagPseudonym)}
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {view.syncState !== "current" && (
          <div class="sync-banner pending with-action">
            <span class="sync-icon" aria-hidden="true" />
            <div>
              <strong>{t("driver.syncTitle")}</strong>
              <p>{view.offlineReady ? t("driver.syncBody") : t("driver.syncOwner")}</p>
            </div>
            {view.offlineReady && view.station.connected && (
              <button
                class="button primary"
                type="button"
                disabled={busy}
                onClick={() => void load(() => driverSync(access.stationId, access.token))}
              >
                {t("cards.sync.send")}
              </button>
            )}
          </div>
        )}
        <p class="fine-print">{t("driver.companyCards")}</p>
      </section>

      <section class="glass driver-card" aria-labelledby="driver-sessions">
        <header class="panel-head">
          <h2 id="driver-sessions">{t("driver.recent")}</h2>
        </header>
        {view.sessions.length === 0 ? (
          <p class="muted">{t("driver.noSessions")}</p>
        ) : (
          <ul class="driver-sessions">
            {view.sessions.slice(0, 12).map((session) => (
              <li key={session.transactionId}>
                <span>
                  {formatDate(session.startedAt)}
                  <small>
                    {t("cards.unnamedShort", { id: session.tagPseudonym.slice(4, 10) })}
                  </small>
                </span>
                <strong>
                  {session.status === "active"
                    ? t("stations.chargingNow")
                    : formatKwh(session.energyWh ?? 0)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p class="fine-print driver-foot">
        {t("driver.expires", { date: formatDate(view.grant.expiresAt) })}{" "}
        {tn("driver.cardCount", view.cards.length)}
      </p>

      {removable && (
        <div
          class="dialog-backdrop"
          onClick={(event) => event.target === event.currentTarget && setRemoving(null)}
        >
          <div class="dialog glass" role="dialog" aria-modal="true" aria-labelledby="driver-remove">
            <h2 id="driver-remove">{t("driver.removeTitle")}</h2>
            <p>{t("cards.removeBody")}</p>
            <footer class="dialog-actions">
              <button class="button ghost" type="button" onClick={() => setRemoving(null)}>
                {t("common.cancel")}
              </button>
              <button
                class="button danger"
                type="button"
                disabled={busy}
                onClick={() =>
                  void load(() =>
                    driverRemoveCard(access.stationId, removable.tagPseudonym, access.token),
                  ).then(() => setRemoving(null))
                }
              >
                {t("cards.removeConfirm")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="console-backdrop driver-backdrop">
      <header class="driver-bar glass-chrome">
        <BrandMark />
        <LanguagePicker id="driver-language" />
      </header>
      <main class="driver-main">{children}</main>
    </div>
  );
}

function countdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
