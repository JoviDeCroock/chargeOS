import type { CapabilityAssessment, OwnerSnapshot } from "../../shared/contracts.js";
import type { OwnerDirectory } from "../../shared/directory.js";
import { formatDate, formatTime, t, tn } from "../i18n/index.js";
import { action, runInspection, runStationCommand } from "../model.js";
import type { Route } from "../routes.js";
import { freedomStatusLabel, migrationStatusLabel } from "../switching.js";
import { UsagePanel } from "../usage.js";
import { ConnectChargerPanel, needsConnectionHelp } from "./connect.js";
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

      {needsConnectionHelp(current) && <ConnectChargerPanel snapshot={current} />}

      <ChargingNow snapshot={current} directory={directory} />

      <UsagePanel sessions={current.sessions} stationId={station.id} directory={directory} />

      <OfflineHero snapshot={current} go={go} />

      <div class="overview-grid">
        <StatusBoard snapshot={current} go={go} visibleTabs={visibleTabs} />
        <StationPanel snapshot={current} />
      </div>
    </div>
  );
}

function ChargingNow({
  snapshot: current,
  directory,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
}) {
  const active = current.sessions.filter(({ status }) => status === "active");
  const last = current.sessions[0];
  const offline = !current.station.connected;
  return (
    <section class="charging-summary glass" aria-label={t("overview.chargingNow")}>
      {active.length ? (
        active.map((session) => {
          const card = cardLabel(directory, current.station.id, session.tagPseudonym);
          return (
            <div class="charging-now live" key={session.transactionId}>
              <span class="charging-pulse" aria-hidden="true" />
              <div>
                <strong>
                  {t("overview.chargingOn", {
                    connector: session.connectorId,
                    time: formatTime(session.startedAt),
                  })}
                </strong>
                <small>{card.holder ? `${card.name} · ${card.holder}` : card.name}</small>
              </div>
              <button
                class="button secondary"
                type="button"
                disabled={offline || action.value !== null}
                onClick={() =>
                  void runStationCommand({
                    transactionId: session.transactionId,
                    type: "RemoteStopTransaction",
                  })
                }
              >
                {t("overview.stop")}
              </button>
            </div>
          );
        })
      ) : (
        <div class="charging-now idle">
          <span class="charging-pulse" aria-hidden="true" />
          <div>
            <strong>{t("overview.notCharging")}</strong>
            <small>
              {offline
                ? t("overview.offlineCardsWork")
                : last
                  ? t("overview.lastSession", { date: formatDate(last.startedAt) })
                  : t("overview.noSessions")}
            </small>
          </div>
        </div>
      )}
    </section>
  );
}

function OfflineHero({
  snapshot: current,
  go,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
}) {
  const readiness = current.readiness;
  const state = readiness?.state ?? "unknown";
  return (
    <section class={`hero glass readiness-${state}`} aria-labelledby="readiness-title">
      <Halo readiness={readiness} connected={current.station.connected} />
      <div class="hero-body">
        <p class="hero-kicker">{t("offline.kicker")}</p>
        <h2 id="readiness-title" class="hero-title">
          {t(
            state === "ready"
              ? "offline.readyTitle"
              : state === "blocked"
                ? "offline.blockedTitle"
                : "offline.unknownTitle",
          )}
        </h2>
        <p class="hero-text">
          {state === "ready"
            ? t("offline.readyText")
            : state === "blocked"
              ? t("offline.blockedText")
              : current.station.connected
                ? t("offline.unknownText")
                : t("offline.connectFirst")}
        </p>
        {state === "ready" && <p class="physical-gate">{t("offline.physicalTest")}</p>}
        <div class="hero-actions">
          <button
            class="button primary"
            type="button"
            disabled={!current.station.connected || action.value !== null}
            onClick={() => void runInspection()}
          >
            {action.value === "inspect"
              ? t("offline.checking")
              : readiness
                ? t("offline.checkAgain")
                : t("offline.check")}
          </button>
          <a
            class="text-link"
            href="#/advanced/offline"
            onClick={(event) => {
              event.preventDefault();
              go({ page: "advanced", tab: "offline" });
            }}
          >
            {t("offline.details")}
          </a>
          {readiness && (
            <span class="hero-meta">
              {t("offline.lastChecked", { date: formatDate(readiness.checkedAt) })}
            </span>
          )}
        </div>
      </div>
    </section>
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
  const sync = current.authorization.syncState;
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
      detail: tn("cards.count", current.authorization.tagCount),
      href: "#/cards",
      key: "cards",
      name: t("nav.cards"),
      route: { page: "cards" },
      tone: sync === "current" ? "ok" : "warn",
      value: t(
        sync === "current"
          ? "cards.sync.current"
          : sync === "never-synced"
            ? "cards.sync.never"
            : "cards.sync.pending",
      ),
      visible: true,
    },
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
