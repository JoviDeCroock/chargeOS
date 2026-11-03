import { useEffect, useRef, useState } from "preact/hooks";

import type { CapabilityAssessment, OwnerSnapshot } from "../../shared/contracts.js";
import type { OwnerDirectory } from "../../shared/directory.js";
import { formatDate, t, tn } from "../i18n/index.js";
import { action, pollSnapshot, runStationCommand } from "../model.js";
import type { Route } from "../routes.js";
import { freedomStatusLabel, migrationStatusLabel } from "../switching.js";
import { UsagePanel } from "../usage.js";
import { ConnectChargerPanel, needsConnectionHelp } from "./connect.js";
import { TapCardDialog } from "./cards.js";
import { SetupChecklist } from "./fleet-setup.js";
import {
  cardLabel,
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
  // A snapshot replays the station's evidence. Keep periodic reads to setup, where
  // they already drive progress; owners can refresh an established charger on demand.
  const waitingForSetup =
    !station.boot || Boolean(current.setup && current.setup.state !== "active");
  const { refresh, refreshing, unavailableFor } = useOverviewRefresh(station.id, waitingForSetup);
  const unavailable = unavailableFor === current;
  const awaitingFirstConnection =
    !station.connected && !station.boot && !current.sessions.length && !current.readiness;
  const connectionHelp = needsConnectionHelp(current);
  const showStatusBoard = ["sharing", "switching", "freedom"].some((tab) => visibleTabs.has(tab));
  return (
    <div class="section-stack">
      <PageHead
        title={station.label}
        lede={[station.site, station.driver].filter(Boolean).join(" · ")}
        actions={
          onEdit && (
            <button class="button secondary" type="button" onClick={onEdit}>
              {t("stations.edit")}
            </button>
          )
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

      <OverviewStatus
        snapshot={current}
        directory={directory}
        go={go}
        unavailable={unavailable}
        onRefresh={station.boot || unavailable ? refresh : null}
        refreshing={refreshing}
      />

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
          <UsagePanel sessions={current.sessions} stationId={station.id} directory={directory} />
          <div class="overview-grid">
            {showStatusBoard && (
              <StatusBoard snapshot={current} go={go} visibleTabs={visibleTabs} />
            )}
            <StationPanel snapshot={current} />
          </div>
        </>
      )}
    </div>
  );
}

function useOverviewRefresh(stationId: string, automatic: boolean) {
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
    const timer = automatic ? setInterval(() => void refresh(), 5_000) : undefined;
    const onVisibility = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      lifetime.abort();
      request.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stationId, automatic]);
  return { refresh: () => void request.current?.(), refreshing, unavailableFor };
}

function OverviewStatus({
  snapshot: current,
  directory,
  go,
  unavailable,
  onRefresh,
  refreshing,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  go: (next: Route) => void;
  unavailable: boolean;
  onRefresh: (() => void) | null;
  refreshing: boolean;
}) {
  const { authorization, readiness, freedomTest } = current;
  const fieldState =
    freedomTest.status === "baseline-stale"
      ? "overview.fieldStale"
      : freedomTest.run?.state === "active" && freedomTest.status === "evidence-complete-unreviewed"
        ? "overview.fieldReview"
        : freedomTest.run?.state === "active" && freedomTest.status === "failed"
          ? "overview.fieldFailed"
          : "overview.fieldUnverified";
  return (
    <section class="panel glass overview-status" aria-labelledby="overview-status-title">
      <header class="panel-head">
        <h2 id="overview-status-title">{t("overview.statusTitle")}</h2>
        {onRefresh && (
          <button
            class="button secondary compact"
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {t(refreshing ? "overview.refreshing" : "overview.refresh")}
          </button>
        )}
      </header>
      <dl>
        <div class="overview-status-row">
          <dt>{t("overview.chargingNow")}</dt>
          <dd>
            <ChargingStatus snapshot={current} directory={directory} unavailable={unavailable} />
          </dd>
        </div>
        <div class="overview-status-row">
          <dt>{t("overview.cardsOnCharger")}</dt>
          <dd>
            <strong>
              {authorization.syncState === "current"
                ? t("overview.listAccepted")
                : authorization.syncState === "pending"
                  ? t("cards.sync.pending")
                  : authorization.tagCount
                    ? tn("overview.cardsRegistered", authorization.tagCount)
                    : t("overview.noCards")}
            </strong>
            {authorization.lastSyncAt ? (
              <p>{t("overview.lastCardList", { date: formatDate(authorization.lastSyncAt) })}</p>
            ) : (
              <p>{t("overview.noCardList")}</p>
            )}
            {authorization.pendingRevision !== null && <p>{t("overview.cardListWaiting")}</p>}
            {authorization.pendingRevocations.length > 0 && (
              <p class="risk-text">
                {tn("cards.staleTitle", authorization.pendingRevocations.length)}
              </p>
            )}
            {(current.station.boot || authorization.syncState !== "never-synced") && (
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
          <dt>{t("offline.kicker")}</dt>
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
            {(current.station.boot || readiness) && (
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

const NON_CHARGING_STATUSES = new Set([
  "Available",
  "Preparing",
  "SuspendedEVSE",
  "SuspendedEV",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
]);

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
  const connectors = station.connectors.filter(({ connectorId }) => connectorId > 0);
  const isCurrent = ({ updatedAt }: { updatedAt: string }) => Date.parse(updatedAt) >= connectedAt;
  const charging =
    !unavailable && station.connected
      ? connectors.filter((connector) => connector.status === "Charging" && isCurrent(connector))
      : [];
  if (charging.length) {
    return (
      <ul class="overview-live">
        {charging.map((connector) => {
          const active = sessions.filter(
            ({ status, connectorId }) =>
              status === "active" && connectorId === connector.connectorId,
          );
          // A carried/replayed open session is not enough to target a current stop.
          const session =
            active.length === 1 && Date.parse(active[0]!.startedAt) >= connectedAt
              ? active[0]
              : null;
          const card = session ? cardLabel(directory, station.id, session.tagPseudonym) : null;
          return (
            <li key={connector.connectorId}>
              <div>
                <strong>{t("overview.chargingOn", { connector: connector.connectorId })}</strong>
                <p>{t("overview.lastChargingReport", { date: formatDate(connector.updatedAt) })}</p>
                {card && <p>{card.holder ? `${card.name} · ${card.holder}` : card.name}</p>}
              </div>
              {session && (
                <button
                  class="button secondary"
                  type="button"
                  disabled={action.value !== null}
                  onClick={() =>
                    void runStationCommand({
                      transactionId: session.transactionId,
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
  const reportsIdle =
    !unavailable &&
    station.connected &&
    connectors.length > 0 &&
    connectors.every(
      (connector) => isCurrent(connector) && NON_CHARGING_STATUSES.has(connector.status),
    );
  const oldestReport = reportsIdle
    ? connectors.reduce((oldest, connector) =>
        oldest.updatedAt < connector.updatedAt ? oldest : connector,
      )
    : null;
  return (
    <>
      <strong>{t(reportsIdle ? "overview.notCharging" : "overview.chargingUnknown")}</strong>
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
