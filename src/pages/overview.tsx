import { currentChargingReport } from "../../shared/charging-status.js";
import { useEffect, useRef, useState } from "preact/hooks";

import type { CapabilityAssessment, OwnerSnapshot } from "../../shared/contracts.js";
import type { OwnerDirectory } from "../../shared/directory.js";
import { formatDate, formatKwh, t, tn } from "../i18n/index.js";
import { action, pollSnapshot, runStationCommand } from "../model.js";
import type { Route } from "../routes.js";
import { freedomStatusLabel, migrationStatusLabel } from "../switching.js";
import { UsagePanel } from "../usage.js";
import { ConnectChargerPanel, needsConnectionHelp } from "./connect.js";
import { TapCardDialog } from "./cards.js";
import { SetupChecklist } from "./fleet-setup.js";
import {
  cardLabel,
  visibleSite,
  StatusPill,
  connectorStatusLabel,
  connectorTone,
  Fact,
  PageHead,
  type Tone,
} from "../ui.js";

export function OverviewPage({
  snapshot: current,
  directory,
  go,
  visibleTabs,
  onEdit,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  go: (next: Route) => void;
  visibleTabs: ReadonlySet<string>;
  onEdit: (() => void) | null;
}) {
  const station = current.station;
  const [registering, setRegistering] = useState(false);
  // A snapshot replays the station's evidence. Read often during setup, where it drives
  // progress, and once a minute while charging so the energy so far keeps up with the
  // charger's meter reports; owners can refresh an idle established charger on demand.
  const waitingForSetup =
    !station.boot || Boolean(current.setup && current.setup.state !== "active");
  const charging = currentChargingReport(station).status === "charging";
  const { refresh, refreshing, unavailableFor } = useOverviewRefresh(
    station.id,
    waitingForSetup ? 5_000 : charging ? 60_000 : null,
  );
  const unavailable = unavailableFor === current;
  const awaitingFirstConnection =
    !station.connected && !station.boot && !current.sessions.length && !current.readiness;
  const connectionHelp = needsConnectionHelp(current);
  const showStatusBoard = ["sharing", "switching", "freedom"].some((tab) => visibleTabs.has(tab));
  // A charger nobody has named yet only has its technical ID; lead with a plain title instead.
  const unnamed = station.label === station.id;
  const settingUp = Boolean(current.setup && current.setup.state !== "active");
  const report = currentChargingReport(station);
  const activity =
    report.status === "charging"
      ? "stations.chargingNow"
      : report.status === "idle" && station.connected
        ? "overview.notCharging"
        : null;
  const liveOrAlert =
    unavailable || current.authorization.pendingRevocations.length > 0 || charging;
  const capabilities: { label: string; tone: Tone; text: string }[] | null =
    settingUp && station.boot && !liveOrAlert
      ? [
          {
            label: t("head.connection"),
            text: t(station.connected ? "head.connectedChargeOS" : "status.offlineShort"),
            tone: station.connected ? "ok" : "idle",
          },
          {
            label: t("head.charging"),
            text: t(activity ?? "overview.chargingUnknown"),
            tone: report.status === "charging" ? "live" : "idle",
          },
          {
            label: t("head.offline"),
            // Software can only get the charger ready; the owner's own test proves it.
            text: t("head.offlineNotReady"),
            tone: "warn",
          },
        ]
      : null;
  return (
    <div class="section-stack">
      <PageHead
        title={unnamed ? t("overview.unnamedTitle") : station.label}
        lede={
          <>
            {/* Connection, what the charger is doing and where it is, in one quiet line.
                Separators trail each part so a wrapped line never starts with a dot. */}
            <span class="lede-parts">
              {capabilities ? (
                // During setup the header answers three separate questions, each labelled.
                capabilities.map(({ label, tone, text }) => (
                  <span key={label} class={`lede-part head-fact ${tone}`}>
                    <span class="head-fact-label">{label}</span>
                    <span class="head-fact-value">
                      <span class={`status-dot ${tone}`} aria-hidden="true" />
                      {text}
                    </span>
                  </span>
                ))
              ) : (
                <span class="lede-part">
                  <StatusPill
                    connected={station.connected}
                    awaitingConnection={!station.boot}
                    inline
                  />
                </span>
              )}
              {[visibleSite(station.site), station.driver].filter(Boolean).map((part) => (
                <span key={part} class="lede-part">
                  {part}
                </span>
              ))}
            </span>
          </>
        }
        // Naming waits while setup leads; afterwards it is one quiet button, as on Chargers.
        actions={
          onEdit && !settingUp ? (
            <button class="button secondary" type="button" onClick={onEdit}>
              {t(unnamed ? "stations.nameItShort" : "stations.edit")}
            </button>
          ) : undefined
        }
      />

      {current.genesisPlan.state === "stop" && (
        <div class="inline-alert risk" role="alert">
          <strong>{t("overview.stopTitle")}</strong>
          <p>{t("overview.stopBody")}</p>
          <a
            href="#/advanced/switching"
            onClick={(event) => {
              event.preventDefault();
              go({ page: "advanced", tab: "switching" });
            }}
          >
            {t("overview.stopLink")}
          </a>
        </div>
      )}

      {connectionHelp && <ConnectChargerPanel key={station.id} snapshot={current} overview />}

      {/* During setup the checklist already reports cards and offline settings, so the
          summary only appears when something there needs attention or is live. */}
      {(!settingUp || liveOrAlert) && (
        <OverviewStatus
          snapshot={current}
          directory={directory}
          go={go}
          unavailable={unavailable}
          onRefresh={station.boot || unavailable ? refresh : null}
          refreshing={refreshing}
          compact={settingUp}
        />
      )}

      <SetupChecklist snapshot={current} go={go} onRegisterCard={() => setRegistering(true)} />

      {/* The setup checklist already asks for the first card on a charger added here. */}
      {current.authorization.tagCount === 0 && !current.setup && (
        <div class="inline-alert warn" role="status">
          <strong>{t("cards.first.title")}</strong>
          <p>{t("cards.first.body")}</p>
          <a
            href="#/cards"
            onClick={(event) => {
              event.preventDefault();
              go({ page: "cards" });
            }}
          >
            {t("cards.tap.start")}
          </a>
        </div>
      )}

      {registering && (
        <TapCardDialog
          capture={current.cardCapture}
          connected={station.connected}
          directory={directory}
          stationLabel={station.label}
          onClose={() => setRegistering(false)}
          onType={() => {
            setRegistering(false);
            go({ page: "cards" });
          }}
        />
      )}

      {!awaitingFirstConnection && (
        <>
          <UsagePanel
            sessions={current.sessions}
            stationId={station.id}
            directory={directory}
            onSessions={() => go({ page: "sessions" })}
          />
          {showStatusBoard && <StatusBoard snapshot={current} go={go} visibleTabs={visibleTabs} />}
        </>
      )}
    </div>
  );
}

function useOverviewRefresh(stationId: string, intervalMs: number | null) {
  const [unavailableFor, setUnavailableFor] = useState<OwnerSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setRefreshing(true);
      const result = await pollSnapshot(lifetime.signal);
      pending = false;
      if (lifetime.signal.aborted) return;
      setRefreshing(false);
      if (result) setUnavailableFor(result.unavailableFor);
    };
    request.current = refresh;
    setRefreshing(false);
    const timer = intervalMs === null ? undefined : setInterval(() => void refresh(), intervalMs);
    const onVisibility = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      lifetime.abort();
      request.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stationId, intervalMs]);
  return { refresh: () => void request.current?.(), refreshing, unavailableFor };
}

export function offlineFieldState(freedomTest: OwnerSnapshot["freedomTest"]) {
  const fieldState =
    freedomTest.status === "baseline-stale"
      ? "overview.fieldStale"
      : freedomTest.run?.state === "active" && freedomTest.status === "evidence-complete-unreviewed"
        ? "overview.fieldReview"
        : freedomTest.run?.state === "active" && freedomTest.status === "failed"
          ? "overview.fieldFailed"
          : "overview.fieldUnverified";
  return fieldState;
}

function OverviewStatus({
  snapshot: current,
  directory,
  go,
  unavailable,
  onRefresh,
  refreshing,
  compact = false,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  go: (next: Route) => void;
  unavailable: boolean;
  onRefresh: (() => void) | null;
  refreshing: boolean;
  /** While setup runs, the checklist below carries the actions; the summary only reports. */
  compact?: boolean;
}) {
  const { authorization, readiness, freedomTest } = current;
  const fieldState = offlineFieldState(freedomTest);
  const report = unavailable ? null : currentChargingReport(current.station);
  const chargingTone: Tone = report?.status === "charging" ? "live" : "idle";
  const cardsTone: Tone =
    authorization.pendingRevocations.length > 0
      ? "risk"
      : authorization.syncState === "current"
        ? "ok"
        : "warn";
  const offlineTone: Tone =
    fieldState === "overview.fieldFailed"
      ? "risk"
      : readiness?.state === "blocked" || fieldState !== "overview.fieldUnverified"
        ? "warn"
        : "idle";
  return (
    <section
      class={`panel glass overview-status${compact ? " compact" : ""}`}
      aria-labelledby="overview-status-title"
    >
      <header class="panel-head">
        <h2 id="overview-status-title">{t("overview.statusTitle")}</h2>
        {onRefresh && (
          <button class="text-button" type="button" disabled={refreshing} onClick={onRefresh}>
            {t(refreshing ? "overview.refreshing" : "overview.refresh")}
          </button>
        )}
      </header>
      <dl>
        <div class="overview-status-row">
          <dt>
            <span class={`status-dot ${chargingTone}`} aria-hidden="true" />
            {t("overview.chargingNow")}
          </dt>
          <dd>
            <ChargingStatus snapshot={current} directory={directory} unavailable={unavailable} />
          </dd>
        </div>
        <div class="overview-status-row">
          <dt>
            <span class={`status-dot ${cardsTone}`} aria-hidden="true" />
            {t("overview.cardsOnCharger")}
          </dt>
          <dd>
            {/* Lead with what the charger has; what chargeOS holds is the supporting line. */}
            <strong>
              {authorization.syncState === "current"
                ? t("overview.listAccepted")
                : authorization.syncState === "pending"
                  ? t("cards.sync.pending")
                  : !authorization.tagCount
                    ? t("overview.noCards")
                    : authorization.lastAttemptRevision === null &&
                        authorization.pendingRevision === null
                      ? t("overview.notSentValue")
                      : t("overview.notConfirmedValue")}
            </strong>
            {authorization.tagCount > 0 && (
              <p>{tn("overview.cardsRegistered", authorization.tagCount)}</p>
            )}
            {authorization.lastSyncAt && (
              <p>{t("overview.lastCardList", { date: formatDate(authorization.lastSyncAt) })}</p>
            )}
            {authorization.pendingRevision !== null && <p>{t("overview.cardListWaiting")}</p>}
            {authorization.pendingRevocations.length > 0 && (
              <p class="risk-text">
                {tn("cards.staleTitle", authorization.pendingRevocations.length)}
              </p>
            )}
            {!compact && (current.station.boot || authorization.syncState !== "never-synced") && (
              <a
                class="text-link"
                href="#/cards"
                onClick={(event) => {
                  event.preventDefault();
                  go({ page: "cards" });
                }}
              >
                {t("overview.cardDetails")}
              </a>
            )}
          </dd>
        </div>
        <div class="overview-status-row">
          <dt>
            <span class={`status-dot ${offlineTone}`} aria-hidden="true" />
            {t("offline.kicker")}
          </dt>
          <dd>
            <strong>{t(fieldState)}</strong>
            <p>
              {t(
                readiness?.restartRequired || readiness?.state === "blocked"
                  ? "overview.settingsBlocked"
                  : readiness?.state === "ready"
                    ? "overview.settingsPassed"
                    : "overview.settingsUnchecked",
              )}
            </p>
            {readiness && (
              <p>{t("offline.lastChecked", { date: formatDate(readiness.checkedAt) })}</p>
            )}
            {!compact && (current.station.boot || readiness) && (
              <a
                class="text-link"
                href="#/advanced/offline"
                onClick={(event) => {
                  event.preventDefault();
                  go({ page: "advanced", tab: "offline" });
                }}
              >
                {t("overview.offlineDetails")}
              </a>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ChargingStatus({
  snapshot: current,
  directory,
  unavailable,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  unavailable: boolean;
}) {
  const { station, sessions } = current;
  const connectedAt = station.connectedAt ? Date.parse(station.connectedAt) : Number.NaN;
  const report = unavailable ? null : currentChargingReport(station);
  const charging = report?.status === "charging" ? report.connectors : [];
  if (charging.length) {
    return (
      <ul class="overview-live">
        {charging.map((connector) => {
          const active = sessions.filter(
            ({ status, connectorId }) =>
              status === "active" && connectorId === connector.connectorId,
          );
          // One open session on a connector that reports charging is what it is charging,
          // also when it started before chargeOS last reconnected (a restart mid-charge).
          const session = active.length === 1 ? active[0]! : null;
          // A carried/replayed open session is not enough to target a current stop: the
          // charger must have started it, or timestamped a meter reading for it, since
          // this connection began.
          const stoppable =
            session &&
            (Date.parse(session.startedAt) >= connectedAt ||
              (session.latestMeterReading !== null &&
                Date.parse(session.latestMeterReading.at) >= connectedAt))
              ? session
              : null;
          const card = session ? cardLabel(directory, station.id, session.tagPseudonym) : null;
          return (
            <li key={connector.connectorId}>
              <div>
                <strong>{t("overview.chargingOn", { connector: connector.connectorId })}</strong>
                {session && (
                  <p>
                    {session.latestMeterReading
                      ? t("overview.chargedSoFar", {
                          date: formatDate(session.latestMeterReading.at),
                          energy: formatKwh(session.latestMeterReading.energyWh),
                        })
                      : t("overview.noMeterReading")}
                  </p>
                )}
                {session && (
                  <p>{t("overview.chargingSince", { date: formatDate(session.startedAt) })}</p>
                )}
                <p>{t("overview.lastChargingReport", { date: formatDate(connector.updatedAt) })}</p>
                {card && <p>{card.holder ? `${card.name} · ${card.holder}` : card.name}</p>}
              </div>
              {stoppable && (
                <button
                  class="button secondary"
                  type="button"
                  disabled={action.value !== null}
                  onClick={() =>
                    void runStationCommand({
                      transactionId: stoppable.transactionId,
                      type: "RemoteStopTransaction",
                    })
                  }
                >
                  {t("overview.stop")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  const oldestReport =
    report?.status === "idle"
      ? report.connectors.reduce((oldest, connector) =>
          oldest.updatedAt < connector.updatedAt ? oldest : connector,
        )
      : null;
  return (
    <>
      <strong>{t(oldestReport ? "overview.notCharging" : "overview.chargingUnknown")}</strong>
      <p>
        {oldestReport
          ? t("overview.lastChargingReport", { date: formatDate(oldestReport.updatedAt) })
          : t(unavailable ? "overview.statusUnavailable" : "overview.waitingForStatus")}
      </p>
    </>
  );
}

export function Halo({
  readiness,
  connected,
}: {
  readiness: CapabilityAssessment | null;
  connected: boolean;
}) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const checks = readiness?.checks ?? [];
  // Round caps extend half the stroke width past each end, so the visible gap
  // between segments is the dash gap minus one stroke width.
  const stroke = 14;
  const gap = checks.length > 1 ? stroke + 6 : 0;
  const segment = checks.length ? circumference / checks.length : circumference;
  const passed = checks.filter(({ state }) => state === "pass").length;
  const state = readiness?.state ?? "unknown";
  return (
    <div class={`halo ${state} ${connected ? "connected" : "offline"}`} aria-hidden="true">
      <span class="halo-glow" />
      <svg viewBox="0 0 200 200">
        <circle class="halo-track" cx="100" cy="100" r={radius} />
        {checks.length ? (
          checks.map((check, index) => (
            <circle
              key={check.id}
              class={`halo-segment ${check.state}`}
              cx="100"
              cy="100"
              r={radius}
              style={{
                "--delay": `${index * 70}ms`,
                strokeDasharray: `${Math.max(segment - gap, 0.01)} ${circumference}`,
                strokeDashoffset: `${-(index * segment + gap / 2)}`,
              }}
            />
          ))
        ) : (
          <circle class="halo-pending" cx="100" cy="100" r={radius} />
        )}
      </svg>
      <div class="halo-core">
        <strong>{checks.length ? `${passed}/${checks.length}` : "—"}</strong>
        <span>{t(checks.length ? "offline.checksPass" : "offline.notChecked")}</span>
      </div>
    </div>
  );
}

function StatusBoard({
  snapshot: current,
  go,
  visibleTabs,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
  visibleTabs: ReadonlySet<string>;
}) {
  const activeGrants = current.delegations.filter(({ status }) => status === "active").length;
  const rows: {
    key: string;
    route: Route;
    href: string;
    name: string;
    tone: Tone;
    value: string;
    detail: string;
    visible: boolean;
  }[] = [
    {
      detail: t("board.sharingDetail"),
      href: "#/advanced/sharing",
      key: "sharing",
      name: t("tab.sharing"),
      route: { page: "advanced", tab: "sharing" },
      tone: "idle",
      value: activeGrants ? tn("board.sharingActive", activeGrants) : t("board.sharingNone"),
      visible: visibleTabs.has("sharing"),
    },
    {
      detail: t("board.switchingDetail"),
      href: "#/advanced/switching",
      key: "switching",
      name: t("tab.switching"),
      route: { page: "advanced", tab: "switching" },
      tone: current.migration.status === "blocked" ? "risk" : "idle",
      value: migrationStatusLabel(current.migration.status),
      visible: visibleTabs.has("switching"),
    },
    {
      detail: t("board.freedomDetail"),
      href: "#/advanced/freedom",
      key: "freedom",
      name: t("tab.freedom"),
      route: { page: "advanced", tab: "freedom" },
      tone: current.freedomTest.status === "failed" ? "risk" : "idle",
      value: freedomStatusLabel(current.freedomTest.status),
      visible: visibleTabs.has("freedom"),
    },
  ];
  return (
    <section class="panel glass status-board" aria-labelledby="status-board-title">
      <header class="panel-head">
        <h2 id="status-board-title">{t("board.title")}</h2>
      </header>
      <ul>
        {rows
          .filter((row) => row.visible)
          .map((row) => (
            <li key={row.key}>
              <a
                href={row.href}
                onClick={(event) => {
                  event.preventDefault();
                  go(row.route);
                }}
              >
                <span class={`board-dot ${row.tone}`} aria-hidden="true" />
                <span class="board-name">{row.name}</span>
                <span class="board-value">
                  <strong>{row.value}</strong>
                  <small>{row.detail}</small>
                </span>
                <span class="board-chevron" aria-hidden="true" />
              </a>
            </li>
          ))}
      </ul>
    </section>
  );
}

export function StationPanel({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <section class="panel glass station-panel" aria-labelledby="station-title">
      <header class="panel-head">
        <h2 id="station-title">{t("station.title")}</h2>
        <span class={`state-chip ${current.station.connected ? "ok" : "idle"}`}>
          {t(current.station.connected ? "station.connected" : "station.offline")}
        </span>
      </header>
      <dl class="facts">
        <Fact
          label={t("station.hardware")}
          value={
            current.station.boot
              ? `${current.station.boot.vendor} ${current.station.boot.model}`
              : t("station.awaitingBoot")
          }
        />
        <Fact label={t("station.connectedSince")} value={formatDate(current.station.connectedAt)} />
      </dl>
      <div class="connector-list">
        {current.station.connectors.length ? (
          current.station.connectors.map((connector) => (
            <div class="connector-row" key={connector.connectorId}>
              <span class={`connector-dot ${connectorTone(connector.status)}`} aria-hidden="true" />
              <span>{t("station.connector", { id: connector.connectorId })}</span>
              <strong>{connectorStatusLabel(connector.status)}</strong>
              {connector.errorCode && connector.errorCode !== "NoError" && (
                <small>{connector.errorCode}</small>
              )}
            </div>
          ))
        ) : (
          <p class="muted">{t("station.noConnectors")}</p>
        )}
      </div>
    </section>
  );
}
