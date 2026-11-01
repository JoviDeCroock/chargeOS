import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { TroubleshootingPanel } from "./troubleshooting.js";

import type {
  CapabilityAssessment,
  ChargeSession,
  DelegateGrantSummary,
  DelegateRole,
  EvidenceSummary,
  FleetSnapshot,
  FleetStationSummary,
  FreedomTestDeviceInput,
  FreedomTestProjection,
  FreedomTestStepResult,
  GenesisAction,
  GenesisPhase,
  GenesisPlan,
  MigrationPhase,
  MigrationProjection,
  MigrationStepResult,
  OwnerSnapshot,
} from "../shared/contracts.js";
import { STATION_RESET_PHRASE, STATION_UNLOCK_PHRASE } from "../shared/commands.js";
import type { StationCommandRecord } from "../shared/commands.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";
import { FREEDOM_TEST_RUN_CONFIRMATION_PHRASE } from "../shared/freedom-test.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import { MIGRATION_AUTHORIZATION_PHRASE } from "../shared/migration.js";
import {
  action,
  fleet,
  issuedDelegate,
  isAuthenticated,
  loading,
  notice,
  ownerToken,
  refreshFleet,
  refreshSnapshot,
  runAuthorizationSync,
  runContinuityExport,
  runContinuityPreparation,
  runDelegateIssue,
  runDelegateRevoke,
  runFreedomDeviceSave,
  runFreedomObservationSave,
  runFreedomTestStart,
  runFreedomReportExport,
  runFieldPackExport,
  runInspection,
  runMigrationAuthorization,
  runMigrationCheckpointSave,
  runMigrationReportExport,
  runOwnerTagAdd,
  runOwnerTagRevoke,
  runStationCommand,
  STATION_COMMAND_LABELS,
  setOwnerToken,
  selectStation,
  selectedStationId,
  snapshot,
} from "./model.js";

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

type Section =
  | "fleet"
  | "overview"
  | "charging"
  | "cards"
  | "migration"
  | "freedom"
  | "delegates"
  | "evidence"
  | "assist";

const SECTION_LABELS: Readonly<Record<Section, string>> = {
  assist: "AI troubleshooting",
  cards: "Owner cards",
  charging: "Charging",
  delegates: "Delegated access",
  evidence: "Evidence",
  fleet: "All chargers",
  freedom: "Freedom Test",
  migration: "Liberate my charger",
  overview: "Overview",
};

const CHARGER_SECTIONS: readonly Exclude<Section, "fleet">[] = [
  "overview",
  "charging",
  "cards",
  "migration",
  "freedom",
  "delegates",
  "evidence",
  "assist",
];

function readSection(): Section | null {
  const match = /^#\/([a-z]+)$/.exec(window.location.hash);
  const candidate = match?.[1];
  return candidate && candidate in SECTION_LABELS ? (candidate as Section) : null;
}

function useSection(): [Section | null, (next: Section) => void] {
  const [section, setSection] = useState<Section | null>(readSection);
  useEffect(() => {
    const sync = () => setSection(readSection());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const go = (next: Section) => {
    if (window.location.hash !== `#/${next}`) window.history.pushState(null, "", `#/${next}`);
    setSection(next);
    window.scrollTo({ top: 0 });
  };
  return [section, go];
}

type Tone = "ok" | "warn" | "risk" | "live" | "idle";

/* ------------------------------------------------------------------ */
/* Application shell                                                   */
/* ------------------------------------------------------------------ */

export function App() {
  const [route, go] = useSection();
  const [continuityConfirmation, setContinuityConfirmation] = useState("");
  useEffect(() => {
    if (ownerToken.value) void refreshFleet();
  }, []);

  const current = snapshot.value;
  const fleetSnapshot = fleet.value;
  const hasMultipleStations = (fleetSnapshot?.stations.length ?? 0) > 1;
  const section: Section =
    route === null || (route === "fleet" && !hasMultipleStations)
      ? hasMultipleStations
        ? "fleet"
        : "overview"
      : route;

  useEffect(() => {
    document.title = `${SECTION_LABELS[section]} · chargeOS`;
    // On narrow screens the section list scrolls sideways; keep the current one visible.
    document
      .querySelector(".rail-link.active")
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [section]);

  if (!isAuthenticated.value) return <TokenGate />;
  if (!fleetSnapshot || !current) {
    return (
      <div class="console-backdrop">
        <main class="centered-shell">
          <div class="glass centered-card">
            <BrandMark />
            <p role="status">
              {loading.value ? "Opening the owner ledger…" : notice.value?.message}
            </p>
            {!loading.value && (
              <button class="button secondary" type="button" onClick={() => setOwnerToken("")}>
                Use another token
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const showFleet = section === "fleet";
  // The fleet view only has fleet summaries; per-charger nav signals need a full snapshot.
  const navTones = showFleet ? {} : sectionTones(current);

  return (
    <div class="console console-backdrop">
      <a class="skip-link" href="#console-main">
        Skip to content
      </a>
      <aside class="rail glass">
        <a
          class="rail-brand"
          href={hasMultipleStations ? "#/fleet" : "#/overview"}
          onClick={(event) => {
            event.preventDefault();
            go(hasMultipleStations ? "fleet" : "overview");
          }}
        >
          <BrandMark />
        </a>

        <nav class="rail-nav" aria-label="Console sections">
          {hasMultipleStations && (
            <ul class="rail-group">
              <NavLink
                section="fleet"
                active={section}
                go={go}
                badge={`${fleetSnapshot.totals.connected}/${fleetSnapshot.totals.stations}`}
              />
            </ul>
          )}
          {hasMultipleStations ? (
            <label class="station-switcher">
              <span>Charger</span>
              <select
                value={selectedStationId.value}
                onChange={(event) => {
                  selectStation(event.currentTarget.value);
                  go(showFleet ? "overview" : section);
                  void refreshSnapshot();
                }}
              >
                {fleetSnapshot.stations.map((station) => (
                  <option value={station.id} key={station.id}>
                    {station.label}, {station.site}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div class="station-identity">
              <strong>{current.station.label}</strong>
              <span>{current.station.site}</span>
            </div>
          )}
          <ul class="rail-group">
            {CHARGER_SECTIONS.map((id) => (
              <NavLink
                key={id}
                section={id}
                active={showFleet ? null : section}
                go={go}
                tone={navTones[id]?.tone}
                badge={navTones[id]?.badge}
                hint={navTones[id]?.hint}
              />
            ))}
          </ul>
        </nav>

        <div class="rail-foot">
          <a class="rail-foot-link" href="/help">
            Help guides
          </a>
          <button class="rail-foot-link" type="button" onClick={() => setOwnerToken("")}>
            Lock console
          </button>
        </div>
      </aside>

      <div class="stage">
        <header class="stage-bar">
          <div class="stage-context">
            {showFleet ? (
              <>
                <strong>Owner fleet</strong>
                <span>{fleetSnapshot.totals.stations} chargers</span>
              </>
            ) : (
              <>
                <strong>{current.station.label}</strong>
                <span>{current.station.site}</span>
                {current.station.id !== current.station.label && <code>{current.station.id}</code>}
              </>
            )}
          </div>
          <div class="stage-status">
            {showFleet ? (
              <FleetStatusPill fleet={fleetSnapshot} />
            ) : (
              <StatusPill connected={current.station.connected} />
            )}
            <span class="stage-updated">
              Updated{" "}
              <time dateTime={showFleet ? fleetSnapshot.generatedAt : current.generatedAt}>
                {formatTime(showFleet ? fleetSnapshot.generatedAt : current.generatedAt)}
              </time>
            </span>
          </div>
        </header>

        <main id="console-main" class="stage-main" tabIndex={-1}>
          {notice.value && (
            <div class={`notice ${notice.value.kind}`} role="status">
              {notice.value.message}
            </div>
          )}

          {showFleet ? (
            <FleetDashboard
              fleet={fleetSnapshot}
              onManage={(stationId) => {
                selectStation(stationId);
                go("overview");
                void refreshSnapshot();
              }}
            />
          ) : section === "overview" ? (
            <OverviewSection snapshot={current} go={go} />
          ) : section === "charging" ? (
            <ChargingSection snapshot={current} />
          ) : section === "cards" ? (
            <OwnerCardsSection
              snapshot={current}
              continuityConfirmation={continuityConfirmation}
              setContinuityConfirmation={setContinuityConfirmation}
            />
          ) : section === "migration" ? (
            <MigrationPanel migration={current.migration} />
          ) : section === "freedom" ? (
            <FreedomTestPanel test={current.freedomTest} />
          ) : section === "delegates" ? (
            <DelegationPanel grants={current.delegations} />
          ) : section === "evidence" ? (
            <EvidenceSection snapshot={current} />
          ) : (
            <TroubleshootingPanel
              key={current.station.id}
              stationId={current.station.id}
              token={ownerToken.value}
            />
          )}
        </main>

        <footer class="stage-foot">
          <span>Open source. Local first. No hidden root administrator.</span>
          <span>
            Snapshot {formatDate(showFleet ? fleetSnapshot.generatedAt : current.generatedAt)}
          </span>
        </footer>
      </div>
    </div>
  );
}

function NavLink({
  section,
  active,
  go,
  tone,
  badge,
  hint,
}: {
  section: Section;
  active: Section | null;
  go: (next: Section) => void;
  tone?: Tone | undefined;
  badge?: string | undefined;
  hint?: string | undefined;
}) {
  const isActive = active === section;
  return (
    <li>
      <a
        class={`rail-link${isActive ? " active" : ""}`}
        href={`#/${section}`}
        aria-current={isActive ? "page" : undefined}
        aria-label={hint ? `${SECTION_LABELS[section]}, ${hint}` : undefined}
        onClick={(event) => {
          event.preventDefault();
          go(section);
        }}
      >
        <span class="rail-link-label">{SECTION_LABELS[section]}</span>
        {badge ? (
          <span class={`rail-badge ${tone ?? "idle"}`}>{badge}</span>
        ) : tone && tone !== "idle" ? (
          <span class={`rail-dot ${tone}`} aria-hidden="true" />
        ) : null}
      </a>
    </li>
  );
}

function sectionTones(
  current: OwnerSnapshot,
): Partial<Record<Section, { tone: Tone; badge?: string; hint?: string }>> {
  const activeSessions = current.sessions.filter(({ status }) => status === "active").length;
  const activeGrants = current.delegations.filter(({ status }) => status === "active").length;
  const readiness = current.readiness?.state ?? "unknown";
  const freedom = current.freedomTest.status;
  const migration = current.migration.status;
  return {
    cards:
      current.authorization.syncState === "current"
        ? { tone: "ok" }
        : { hint: "owner access changes pending", tone: "warn" },
    charging: activeSessions
      ? { badge: `${activeSessions} live`, hint: "charging now", tone: "live" }
      : { tone: "idle" },
    delegates: activeGrants ? { badge: String(activeGrants), tone: "idle" } : { tone: "idle" },
    evidence:
      current.evidenceHistory.mode === "compacted-operational"
        ? { hint: "compacted history", tone: "warn" }
        : { tone: "idle" },
    freedom:
      freedom === "failed"
        ? { hint: "failed observation", tone: "risk" }
        : freedom === "baseline-stale"
          ? { hint: "baseline changed", tone: "warn" }
          : freedom === "in-progress" || freedom === "evidence-complete-unreviewed"
            ? { tone: "live" }
            : { tone: "idle" },
    migration:
      migration === "blocked"
        ? { hint: "stop condition", tone: "risk" }
        : migration === "owner-authorized-window" || migration === "online-proof-in-progress"
          ? { tone: "live" }
          : { tone: "idle" },
    overview:
      current.genesisPlan.state === "stop" || readiness === "blocked"
        ? { hint: "needs attention", tone: "risk" }
        : readiness === "ready"
          ? { tone: "ok" }
          : { hint: "offline readiness not inspected", tone: "warn" },
  };
}

function BrandMark() {
  return (
    <span class="brand-mark">
      <svg class="brand-glyph" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="12" />
        <path d="M17.5 8.5 11.5 17h4.5l-1.5 6.5 6-8.5H16l1.5-6.5Z" />
      </svg>
      <span>chargeOS</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewSection({
  snapshot: current,
  go,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Section) => void;
}) {
  const readiness = current.readiness;
  const state = readiness?.state ?? "unknown";
  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>Your charger remains yours.</h1>
        <p class="lede">
          A synchronized owner credential must deliver energy without chargeOS, DNS, internet, or
          any vendor cloud. Software checks are evidence, not a substitute for the witnessed
          physical Freedom Test.
        </p>
      </header>

      {current.evidenceHistory.mode === "compacted-operational" && (
        <CompactedHistoryNotice snapshot={current} />
      )}

      <section class={`hero glass readiness-${state}`} aria-labelledby="readiness-title">
        <Halo readiness={readiness} connected={current.station.connected} />
        <div class="hero-body">
          <p class="hero-kicker">Offline readiness</p>
          <h2 id="readiness-title" class="hero-title">
            {state === "ready"
              ? "Software prerequisites pass"
              : state === "blocked"
                ? "Blocked"
                : "Not yet inspected"}
          </h2>
          <p class="hero-text">
            {state === "ready"
              ? "The charger reported every setting needed to authorize owner cards locally."
              : state === "blocked"
                ? "At least one offline setting is missing or wrong. Resolve it under Owner cards before synchronizing."
                : current.station.connected
                  ? "Ask the charger which offline settings it supports. Inspection only reads configuration."
                  : "Connect the charge point before inspection."}
          </p>
          {state === "ready" && (
            <p class="physical-gate">Physical offline and restart tests are still required.</p>
          )}
          <div class="hero-actions">
            <button
              class="button primary"
              type="button"
              disabled={!current.station.connected || action.value !== null}
              onClick={() => void runInspection()}
            >
              {action.value === "inspect"
                ? "Inspecting…"
                : readiness
                  ? "Inspect again"
                  : "Inspect offline capabilities"}
            </button>
            {readiness && (
              <span class="hero-meta">Last inspected {formatDate(readiness.checkedAt)}</span>
            )}
          </div>
        </div>
        {readiness && readiness.checks.length > 0 ? (
          <ul class="check-list" aria-label="Offline readiness checks">
            {readiness.checks.map((check) => (
              <li key={check.id} class={check.state}>
                <span class="check-mark" aria-hidden="true" />
                <span class="check-label">{check.label}</span>
                <small>{check.observed}</small>
                <span class="visually-hidden">{check.state}</span>
              </li>
            ))}
          </ul>
        ) : (
          !readiness && (
            <p class="hero-empty">No capability evidence has been collected from this firmware.</p>
          )
        )}
      </section>

      <div class="overview-grid">
        <StatusBoard snapshot={current} go={go} />
        <StationPanel snapshot={current} />
      </div>

      <GenesisPlanPanel plan={current.genesisPlan} />
    </div>
  );
}

function Halo({
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
        <span>{checks.length ? "checks pass" : "not inspected"}</span>
      </div>
    </div>
  );
}

function StationPanel({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <section class="panel glass station-panel" aria-labelledby="station-title">
      <header class="panel-head">
        <h2 id="station-title">Station</h2>
        <span class={`state-chip ${current.station.connected ? "ok" : "idle"}`}>
          {current.station.connected ? "Connected" : "Offline"}
        </span>
      </header>
      <dl class="facts">
        <Fact label="Connected since" value={formatDate(current.station.connectedAt)} />
        <Fact
          label="Hardware"
          value={
            current.station.boot
              ? `${current.station.boot.vendor} ${current.station.boot.model}`
              : "Awaiting BootNotification"
          }
        />
        <Fact label="Firmware" value={current.station.boot?.firmwareVersion ?? "Unknown"} />
        <Fact label="Charge point ID" value={current.station.id} mono />
      </dl>
      <div class="connector-list">
        {current.station.connectors.length ? (
          current.station.connectors.map((connector) => (
            <div class="connector-row" key={connector.connectorId}>
              <span class={`connector-dot ${connectorTone(connector.status)}`} aria-hidden="true" />
              <span>Connector {connector.connectorId}</span>
              <strong>{connector.status}</strong>
              {connector.errorCode && connector.errorCode !== "NoError" && (
                <small>{connector.errorCode}</small>
              )}
            </div>
          ))
        ) : (
          <p class="muted">No connector status received yet.</p>
        )}
      </div>
    </section>
  );
}

function connectorTone(status: string): Tone {
  if (status === "Charging") return "live";
  if (status === "Available") return "ok";
  if (status === "Faulted" || status === "Unavailable") return "risk";
  if (status === "SuspendedEV" || status === "SuspendedEVSE" || status === "Preparing")
    return "warn";
  return "idle";
}

function StatusBoard({
  snapshot: current,
  go,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Section) => void;
}) {
  const activeSessions = current.sessions.filter(({ status }) => status === "active");
  const lastSession = current.sessions[0];
  const activeGrants = current.delegations.filter(({ status }) => status === "active").length;
  const rows: { section: Section; tone: Tone; value: string; detail: string }[] = [
    {
      detail: activeSessions.length
        ? `On connector ${activeSessions.map(({ connectorId }) => connectorId).join(", ")}`
        : lastSession
          ? `Last session ${formatDate(lastSession.startedAt)}`
          : "No sessions recorded yet",
      section: "charging",
      tone: activeSessions.length ? "live" : "idle",
      value: activeSessions.length ? "Charging now" : "Idle",
    },
    {
      detail: `${current.authorization.tagCount} owner card${current.authorization.tagCount === 1 ? "" : "s"}`,
      section: "cards",
      tone: current.authorization.syncState === "current" ? "ok" : "warn",
      value:
        current.authorization.syncState === "current"
          ? "In sync with the charger"
          : current.authorization.syncState === "never-synced"
            ? "Never synchronized"
            : "Changes waiting for the charger",
    },
    {
      detail: "Reversible migration dossier",
      section: "migration",
      tone: current.migration.status === "blocked" ? "risk" : "idle",
      value: migrationStatusLabel(current.migration.status),
    },
    {
      detail: "Witnessed field evidence",
      section: "freedom",
      tone: current.freedomTest.status === "failed" ? "risk" : "idle",
      value: freedomStatusLabel(current.freedomTest.status),
    },
    {
      detail: "Expiring read-only capabilities",
      section: "delegates",
      tone: "idle",
      value: activeGrants
        ? `${activeGrants} active delegate${activeGrants === 1 ? "" : "s"}`
        : "Nobody else has access",
    },
  ];
  return (
    <section class="panel glass status-board" aria-labelledby="status-board-title">
      <header class="panel-head">
        <h2 id="status-board-title">At a glance</h2>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.section}>
            <a
              href={`#/${row.section}`}
              onClick={(event) => {
                event.preventDefault();
                go(row.section);
              }}
            >
              <span class={`board-dot ${row.tone}`} aria-hidden="true" />
              <span class="board-name">{SECTION_LABELS[row.section]}</span>
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

function CompactedHistoryNotice({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <div class="notice history-warning" role="status">
      This edge uses compacted operational history. It carries state from{" "}
      {current.evidenceHistory.custodyBundleCount} separately held source bundle
      {current.evidenceHistory.custodyBundleCount === 1 ? "" : "s"} covering{" "}
      {current.evidenceHistory.custodiedEventCount} records. Full historical review requires those
      source bundles; this local ledger is not the original complete chain.
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Genesis plan                                                        */
/* ------------------------------------------------------------------ */

const GENESIS_PHASES: readonly { label: string; phase: GenesisPhase }[] = [
  { label: "Pre-switch evidence", phase: "pre-switch-evidence" },
  { label: "Owner authorization", phase: "owner-authorization" },
  { label: "Endpoint change", phase: "endpoint-change" },
  { label: "Online proof", phase: "online-proof" },
  { label: "Physical Freedom Test", phase: "physical-freedom-test" },
  { label: "Independent review", phase: "independent-review" },
];

const ACTOR_LABELS: Readonly<Record<GenesisAction["actor"], string>> = {
  installer: "Installer",
  owner: "Owner",
  reviewer: "Reviewer",
  station: "Charger",
  witness: "Witness",
};

const EXECUTION_LABELS: Readonly<Record<GenesisAction["execution"], string>> = {
  "external-manual": "Outside chargeOS",
  "local-cli": "Local command line",
  observe: "Observed automatically",
  "owner-console": "In this console",
  review: "Independent review",
};

const EVIDENCE_LABELS: Readonly<Record<GenesisAction["evidence"], string>> = {
  "external-sha256": "SHA-256 of held evidence",
  none: "No evidence recorded",
  "protocol-derived": "From protocol records",
  "review-pack": "Field review pack",
};

const SAFETY_LABELS: Readonly<Record<GenesisAction["safety"], string>> = {
  ordinary: "Ordinary",
  "power-isolated-competent-installer": "Power isolated, competent installer",
  "supported-installer-procedure": "Supported installer procedure",
  "witnessed-real-energy": "Witnessed with real energy",
};

function GenesisPlanPanel({ plan }: { plan: GenesisPlan }) {
  const title =
    plan.state === "stop"
      ? "Stop condition — preserve evidence"
      : plan.state === "ready-for-review"
        ? "Field evidence ready for independent review"
        : plan.state === "waiting-for-station"
          ? "Waiting for exact station evidence"
          : plan.nextActions.length === 1
            ? "Next safe action"
            : "Next safe actions";
  const currentPhase = GENESIS_PHASES.findIndex(({ phase }) => phase === plan.phase);
  const [featured, ...rest] = plan.nextActions;
  const visible = rest.slice(0, 3);
  const folded = rest.slice(3);
  return (
    <section class={`panel glass genesis-plan ${plan.state}`} aria-labelledby="genesis-title">
      <header class="panel-head">
        <div>
          <p class="panel-kicker">Genesis plan</p>
          <h2 id="genesis-title">{title}</h2>
        </div>
      </header>

      <ol class="phase-track" aria-label="Genesis phases">
        {GENESIS_PHASES.map(({ label, phase }, index) => (
          <li
            key={phase}
            class={index < currentPhase ? "done" : index === currentPhase ? "current" : "upcoming"}
            aria-current={index === currentPhase ? "step" : undefined}
          >
            <span class="phase-index" aria-hidden="true">
              {index + 1}
            </span>
            <span class="phase-label">{label}</span>
          </li>
        ))}
      </ol>

      {featured ? (
        <ol class="genesis-actions">
          <GenesisActionItem next={featured} index={0} featured />
          {visible.map((next, index) => (
            <GenesisActionItem
              key={`${next.id}-${next.migrationStepId ?? next.freedomTestStepId ?? index}`}
              next={next}
              index={index + 1}
            />
          ))}
        </ol>
      ) : (
        <p class="empty-state">No console action is due right now.</p>
      )}
      {folded.length > 0 && (
        <details class="genesis-more">
          <summary>
            Show {folded.length} more action{folded.length === 1 ? "" : "s"}
          </summary>
          <ol class="genesis-actions" start={visible.length + 2}>
            {folded.map((next, index) => (
              <GenesisActionItem
                key={`${next.id}-${next.migrationStepId ?? next.freedomTestStepId ?? index}`}
                next={next}
                index={index + visible.length + 1}
              />
            ))}
          </ol>
        </details>
      )}
      <p class="fine-print">{plan.disclaimer}</p>
    </section>
  );
}

function GenesisActionItem({
  next,
  index,
  featured = false,
}: {
  next: GenesisAction;
  index: number;
  featured?: boolean;
}) {
  const elevated = next.safety !== "ordinary";
  return (
    <li class={`genesis-action${featured ? " featured" : ""}`}>
      <span class="genesis-index" aria-hidden="true">
        {index + 1}
      </span>
      <div class="genesis-body">
        <p class="genesis-instruction">{next.instruction}</p>
        <div class="genesis-meta">
          <span>{ACTOR_LABELS[next.actor]}</span>
          <span>{EXECUTION_LABELS[next.execution]}</span>
          <span>{EVIDENCE_LABELS[next.evidence]}</span>
          {elevated && <span class="safety">{SAFETY_LABELS[next.safety]}</span>}
        </div>
        <div class="genesis-ids">
          <code>{next.id}</code>
          {(next.migrationStepId || next.freedomTestStepId) && (
            <code>{next.migrationStepId ?? next.freedomTestStepId}</code>
          )}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Charging                                                            */
/* ------------------------------------------------------------------ */

function ChargingSection({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  const activeSessions = current.sessions.filter(({ status }) => status === "active");
  const totalWh = current.sessions.reduce((sum, { energyWh }) => sum + (energyWh ?? 0), 0);
  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>Charging</h1>
        <p class="lede">
          Start, stop and recover sessions on this charger, and review every session it reported.
        </p>
      </header>

      <div class="charging-summary glass">
        <div class={`charging-now ${activeSessions.length ? "live" : "idle"}`}>
          <span class="charging-pulse" aria-hidden="true" />
          <div>
            <strong>
              {activeSessions.length
                ? `Charging on connector ${activeSessions.map(({ connectorId }) => connectorId).join(", ")}`
                : "No session in progress"}
            </strong>
            <small>
              {activeSessions.length
                ? `Started ${formatDate(activeSessions[0]!.startedAt)}`
                : current.station.connected
                  ? "Present an owner card or start remotely below."
                  : "The charger is offline. Owner cards still work at the charger."}
            </small>
          </div>
        </div>
        <dl class="facts inline">
          <Fact label="Sessions" value={String(current.sessions.length)} />
          <Fact label="Recorded energy" value={formatEnergy(totalWh)} />
        </dl>
      </div>

      <StationCommandPanel snapshot={current} />

      <section class="panel glass" aria-labelledby="sessions-title">
        <header class="panel-head">
          <h2 id="sessions-title">Energy history</h2>
        </header>
        <SessionTable sessions={current.sessions} />
      </section>
    </div>
  );
}

function StationCommandPanel({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  const connectorIds = [
    ...new Set([1, ...current.station.connectors.map(({ connectorId }) => connectorId)]),
  ]
    .filter((connectorId) => connectorId >= 1)
    .sort((left, right) => left - right);
  const [connectorId, setConnectorId] = useState(connectorIds[0] ?? 1);
  const [tagPseudonym, setTagPseudonym] = useState(current.authorization.tagPseudonyms[0] ?? "");
  const [resetType, setResetType] = useState<"Hard" | "Soft">("Soft");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [unlockConfirmation, setUnlockConfirmation] = useState("");
  const busy = action.value !== null;
  const offline = !current.station.connected;
  const activeSessions = current.sessions.filter(({ status }) => status === "active");

  return (
    <section class="panel glass command-panel" aria-labelledby="commands-title">
      <header class="panel-head">
        <div>
          <p class="panel-kicker">Charger controls</p>
          <h2 id="commands-title">Remote commands</h2>
        </div>
      </header>
      <p class="panel-intro">
        Only you can send these, and only while the charger is connected. A charger can accept a
        command and still fail to carry it out, so each command shows the charger&rsquo;s answer and
        what it actually did afterwards. chargeOS never switches a charger off
        (&ldquo;Inoperative&rdquo;) because that would persist if chargeOS disappeared.
      </p>
      {offline && (
        <p class="inline-alert warn">The charger is offline. Remote commands are unavailable.</p>
      )}

      <div class="command-grid">
        <form
          class="command-form"
          aria-label="Remote start"
          onSubmit={(event) => {
            event.preventDefault();
            void runStationCommand({ connectorId, tagPseudonym, type: "RemoteStartTransaction" });
          }}
        >
          <h3>Start charging</h3>
          <label>
            Connector
            <select
              value={connectorId}
              onChange={(event) => setConnectorId(Number(event.currentTarget.value))}
            >
              {connectorIds.map((id) => (
                <option key={id} value={id}>
                  Connector {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner card
            <select
              value={tagPseudonym}
              onChange={(event) => setTagPseudonym(event.currentTarget.value)}
            >
              {current.authorization.tagPseudonyms.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <button class="button primary" type="submit" disabled={offline || busy || !tagPseudonym}>
            Start remotely
          </button>
        </form>

        <div class="command-form">
          <h3>Stop charging</h3>
          {activeSessions.length === 0 ? (
            <p class="muted">No active session.</p>
          ) : (
            activeSessions.map((session) => (
              <button
                key={session.transactionId}
                class="button secondary"
                type="button"
                disabled={offline || busy}
                onClick={() =>
                  void runStationCommand({
                    transactionId: session.transactionId,
                    type: "RemoteStopTransaction",
                  })
                }
              >
                Stop session #{session.transactionId} (connector {session.connectorId})
              </button>
            ))
          )}
          <button
            class="button ghost"
            type="button"
            disabled={offline || busy}
            onClick={() =>
              void runStationCommand({
                availability: "Operative",
                connectorId,
                type: "ChangeAvailability",
              })
            }
          >
            Make connector {connectorId} available
          </button>
        </div>

        <form
          class="command-form guarded"
          aria-label="Unlock connector"
          onSubmit={(event) => {
            event.preventDefault();
            void runStationCommand({
              confirmation: unlockConfirmation,
              connectorId,
              type: "UnlockConnector",
            }).then((done) => done && setUnlockConfirmation(""));
          }}
        >
          <h3>Unlock connector {connectorId}</h3>
          <label class="confirmation-field">
            Type this exact phrase
            <span class="phrase">{STATION_UNLOCK_PHRASE}</span>
            <input
              value={unlockConfirmation}
              autocomplete="off"
              onInput={(event) => setUnlockConfirmation(event.currentTarget.value)}
            />
          </label>
          <button
            class="button danger"
            type="submit"
            disabled={offline || busy || unlockConfirmation !== STATION_UNLOCK_PHRASE}
          >
            Unlock
          </button>
        </form>

        <form
          class="command-form guarded"
          aria-label="Restart charger"
          onSubmit={(event) => {
            event.preventDefault();
            void runStationCommand({
              confirmation: resetConfirmation,
              resetType,
              type: "Reset",
            }).then((done) => done && setResetConfirmation(""));
          }}
        >
          <h3>Restart charger</h3>
          <label>
            Restart type
            <select
              value={resetType}
              onChange={(event) => setResetType(event.currentTarget.value as "Hard" | "Soft")}
            >
              <option value="Soft">Soft (ends sessions cleanly first)</option>
              <option value="Hard">Hard (immediate)</option>
            </select>
          </label>
          <label class="confirmation-field">
            Type this exact phrase
            <span class="phrase">{STATION_RESET_PHRASE}</span>
            <input
              value={resetConfirmation}
              autocomplete="off"
              onInput={(event) => setResetConfirmation(event.currentTarget.value)}
            />
          </label>
          <button
            class="button danger"
            type="submit"
            disabled={offline || busy || resetConfirmation !== STATION_RESET_PHRASE}
          >
            Restart
          </button>
        </form>
      </div>

      <h3 class="subhead">Command history</h3>
      <CommandHistory commands={current.commands} />
    </section>
  );
}

function CommandHistory({ commands }: { commands: readonly StationCommandRecord[] }) {
  if (!commands.length) return <p class="empty-state">No remote commands sent yet.</p>;
  return (
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Requested</th>
            <th>Command</th>
            <th>Charger answer</th>
            <th>Observed afterwards</th>
          </tr>
        </thead>
        <tbody>
          {commands.map((command) => (
            <tr key={command.commandId}>
              <td class="nowrap">{formatDate(command.requestedAt)}</td>
              <td>
                {STATION_COMMAND_LABELS[command.type]}
                {command.resetType ? ` (${command.resetType})` : ""}
                {command.transactionId !== null ? ` #${command.transactionId}` : ""}
                {command.connectorId !== null && command.type !== "RemoteStopTransaction"
                  ? `, connector ${command.connectorId}`
                  : ""}
              </td>
              <td>
                <span class={`table-status command-${command.state}`}>{command.state}</span>
                {command.status && command.status.toLowerCase() !== command.state
                  ? ` ${command.status}`
                  : ""}
              </td>
              <td>
                {command.observed ?? (command.state === "accepted" ? "Not yet observed" : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Owner cards                                                         */
/* ------------------------------------------------------------------ */

function OwnerCardsSection({
  snapshot: current,
  continuityConfirmation,
  setContinuityConfirmation,
}: {
  snapshot: OwnerSnapshot;
  continuityConfirmation: string;
  setContinuityConfirmation: (value: string) => void;
}) {
  const [newOwnerTag, setNewOwnerTag] = useState("");
  const [ownerTagRevocationConfirmation, setOwnerTagRevocationConfirmation] = useState("");
  const authorization = current.authorization;
  const readinessState = current.readiness?.state ?? "unknown";
  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>Owner cards</h1>
        <p class="lede">
          The RFID cards that can start charging at this charger, even when chargeOS and every cloud
          are unreachable. Raw RFID identifiers stay in local configuration and are never written to
          the evidence ledger.
        </p>
      </header>

      <div class="cards-layout">
        <section class="panel glass" aria-labelledby="authorization-title">
          <header class="panel-head">
            <div>
              <p class="panel-kicker">Owner authorization</p>
              <h2 id="authorization-title">
                {`${authorization.tagCount} essential tag${authorization.tagCount === 1 ? "" : "s"}`}
              </h2>
            </div>
          </header>
          <div class={`sync-banner ${authorization.syncState}`}>
            <span class="sync-icon" aria-hidden="true" />
            <strong>
              {authorization.syncState === "current"
                ? "Charger list matches desired owner access"
                : authorization.syncState === "never-synced"
                  ? "Owner access has never been acknowledged"
                  : "Owner access changes are pending"}
            </strong>
          </div>

          {authorization.pendingRevocations.length > 0 && (
            <div class="inline-alert risk" role="alert">
              <strong>
                {authorization.pendingRevocations.length} removed owner tag
                {authorization.pendingRevocations.length === 1 ? " may" : "s may"} still authorize
                locally
              </strong>
              <p>
                The charger has not acknowledged a replacement list. During an outage, stale local
                access can remain available until synchronization succeeds.
              </p>
              <ul class="pseudonym-list">
                {authorization.pendingRevocations.map((tag) => (
                  <li key={tag}>
                    <code>{tag}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {authorization.pendingAdditions.length > 0 && (
            <p class="inline-alert warn">
              {authorization.pendingAdditions.length} configured owner tag
              {authorization.pendingAdditions.length === 1 ? " is" : "s are"} not yet acknowledged
              by the charger.
            </p>
          )}

          <ul class="owner-tag-list">
            {authorization.tagPseudonyms.map((tag) => (
              <li key={tag}>
                <span class="tag-chip" aria-hidden="true" />
                <code>{tag}</code>
                <span
                  class={`state-chip ${authorization.acknowledgedTagPseudonyms.includes(tag) ? "ok" : "warn"}`}
                >
                  {authorization.acknowledgedTagPseudonyms.includes(tag)
                    ? "On charger"
                    : "Not acknowledged"}
                </span>
                <button
                  class="text-button danger-text"
                  type="button"
                  disabled={
                    authorization.tagCount <= 1 ||
                    ownerTagRevocationConfirmation !== OWNER_TAG_REVOCATION_CONFIRMATION ||
                    action.value !== null
                  }
                  onClick={() => {
                    setOwnerTagRevocationConfirmation("");
                    void runOwnerTagRevoke(tag, {
                      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
                    });
                  }}
                >
                  Revoke desired tag
                </button>
              </li>
            ))}
          </ul>

          <form
            class="owner-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runOwnerTagAdd({ tag: newOwnerTag });
              setNewOwnerTag("");
            }}
          >
            <label>
              Add owner RFID identifier
              <input
                value={newOwnerTag}
                type="password"
                maxlength={20}
                autocomplete="off"
                onInput={(event) => setNewOwnerTag(event.currentTarget.value)}
              />
            </label>
            <button
              class="button secondary"
              type="submit"
              disabled={!newOwnerTag || newOwnerTag.length > 20 || action.value !== null}
            >
              {action.value === "owner-tag-add" ? "Adding desired tag…" : "Add desired tag"}
            </button>
          </form>

          <details class="revocation-details">
            <summary>Remove a card</summary>
            <label class="confirmation-field">
              Type this exact phrase before removing a desired tag
              <span class="phrase">{OWNER_TAG_REVOCATION_CONFIRMATION}</span>
              <input
                value={ownerTagRevocationConfirmation}
                autocomplete="off"
                onInput={(event) => setOwnerTagRevocationConfirmation(event.currentTarget.value)}
              />
            </label>
            <p class="fine-print">
              Then use <strong>Revoke desired tag</strong> next to the card. chargeOS keeps at least
              one owner card.
            </p>
          </details>

          <dl class="facts compact">
            <Fact
              label="Last accepted revision"
              value={valueOrDash(authorization.lastSyncRevision)}
            />
            <Fact label="Last sync" value={formatDate(authorization.lastSyncAt)} />
            <Fact
              label="Latest completed attempt"
              value={
                authorization.lastAttemptRevision === null
                  ? "—"
                  : `r${authorization.lastAttemptRevision} ${authorization.lastAttemptStatus ?? "unknown"}`
              }
            />
            {authorization.pendingRevision !== null && (
              <Fact
                label="Unacknowledged command"
                value={`revision ${authorization.pendingRevision}`}
              />
            )}
          </dl>
        </section>

        <section class="panel glass control-panel" aria-labelledby="guarded-title">
          <header class="panel-head">
            <div>
              <p class="panel-kicker">Guarded actions</p>
              <h2 id="guarded-title">Prove, then synchronize</h2>
            </div>
          </header>
          <ol class="guarded-steps">
            <li class={readinessState === "ready" ? "done" : "current"}>
              <div>
                <strong>Inspect offline capabilities</strong>
                <small>
                  {readinessState === "ready"
                    ? "Software prerequisites pass."
                    : readinessState === "blocked"
                      ? "Blocked: an offline setting is missing or wrong."
                      : "Not yet inspected."}
                </small>
              </div>
              <button
                class="button secondary"
                type="button"
                disabled={!current.station.connected || action.value !== null}
                onClick={() => void runInspection()}
              >
                {action.value === "inspect" ? "Inspecting…" : "Inspect"}
              </button>
            </li>
            <li class={readinessState === "ready" ? "current" : "upcoming"}>
              <div>
                <strong>Send the owner list to the charger</strong>
                <small>
                  Replaces the charger&rsquo;s local list. Enabled once every readiness check
                  passes.
                </small>
              </div>
              <button
                class="button primary"
                type="button"
                disabled={
                  !current.station.connected ||
                  current.readiness?.state !== "ready" ||
                  action.value !== null
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Replace the charger's local authorization list with the configured owner tags?",
                    )
                  ) {
                    void runAuthorizationSync();
                  }
                }}
              >
                {action.value === "sync" ? "Synchronizing…" : "Synchronize owner tags"}
              </button>
            </li>
          </ol>
          {current.readiness?.state !== "ready" && (
            <form
              class="continuity-preparation"
              onSubmit={(event) => {
                event.preventDefault();
                void runContinuityPreparation({ confirmation: continuityConfirmation });
              }}
            >
              <h3>Prepare owner-continuity settings</h3>
              <p>
                This one-way action can only request <code>LocalAuthListEnabled=true</code>,{" "}
                <code>LocalAuthorizeOffline=true</code>, and{" "}
                <code>AllowOfflineTxForUnknownId=false</code>. Missing or read-only settings stop
                before mutation. It never synchronizes tags or restarts the charger.
              </p>
              <label class="confirmation-field">
                Type this exact owner-continuity authorization phrase
                <span class="phrase">{CONTINUITY_PREPARATION_PHRASE}</span>
                <input
                  value={continuityConfirmation}
                  autocomplete="off"
                  onInput={(event) => setContinuityConfirmation(event.currentTarget.value)}
                />
              </label>
              <button
                class="button danger"
                type="submit"
                disabled={
                  !current.station.connected ||
                  continuityConfirmation !== CONTINUITY_PREPARATION_PHRASE ||
                  action.value !== null
                }
              >
                {action.value === "prepare" ? "Preparing…" : "Prepare owner-continuity settings"}
              </button>
            </form>
          )}
          <p class="fine-print">
            Endpoint changes, firmware, and physical work remain outside this console and require
            the reversible installer runbook.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

function EvidenceSection({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <div class="section-stack">
      <header class="page-head with-actions">
        <div>
          <h1>Evidence</h1>
          <p class="lede">
            The tamper-evident ledger chargeOS keeps for this charger. Exports use pseudonyms
            instead of card identifiers and are never a recovery backup.
          </p>
        </div>
        <button
          class="button secondary"
          type="button"
          disabled={action.value !== null}
          onClick={() => void runContinuityExport()}
        >
          {action.value === "export" ? "Exporting…" : "Export redacted continuity evidence"}
        </button>
      </header>
      {current.evidenceHistory.mode === "compacted-operational" && (
        <CompactedHistoryNotice snapshot={current} />
      )}
      <section class="panel glass" aria-labelledby="ledger-title">
        <header class="panel-head">
          <h2 id="ledger-title">Latest owner ledger events</h2>
          <span class="legend">
            <span class="event-direction station-to-csms" aria-hidden="true" /> From charger
            <span class="event-direction csms-to-station" aria-hidden="true" /> To charger
            <span class="event-direction system" aria-hidden="true" /> System
          </span>
        </header>
        <EvidenceTimeline events={current.evidence} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fleet                                                               */
/* ------------------------------------------------------------------ */

function FleetDashboard({
  fleet,
  onManage,
}: {
  fleet: FleetSnapshot;
  onManage: (stationId: string) => void;
}) {
  return (
    <div class="section-stack fleet-dashboard">
      <header class="page-head">
        <h1>Every charger. One owner.</h1>
        <p class="lede">
          Operate every provisioned charge point from one replaceable console. Previously
          synchronized owner credentials remain local to each charger when this fleet view, its
          network, or chargeOS disappears.
        </p>
      </header>

      <section class="fleet-metrics glass" aria-label="Fleet summary">
        <FleetMetric label="Chargers" value={String(fleet.totals.stations)} />
        <FleetMetric
          label="Connected"
          value={`${fleet.totals.connected} / ${fleet.totals.stations}`}
        />
        <FleetMetric label="Charging now" value={String(fleet.totals.activeSessions)} />
        <FleetMetric label="Recorded energy" value={formatEnergy(fleet.totals.energyWh)} />
        <FleetMetric
          label="Needs attention"
          value={String(fleet.totals.attentionRequired)}
          tone={fleet.totals.attentionRequired ? "warn" : "ok"}
        />
      </section>

      <section class="panel glass fleet-list-panel" aria-labelledby="fleet-title">
        <header class="panel-head">
          <div>
            <h2 id="fleet-title">Fleet operations</h2>
            <p class="panel-sub">
              Select a charger for RFID, sessions, migration, continuity, and delegates.
            </p>
          </div>
        </header>
        <div class="table-scroll">
          <table class="fleet-table">
            <thead>
              <tr>
                <th>Charger</th>
                <th>Connection</th>
                <th>Owner access</th>
                <th>Offline readiness</th>
                <th>Sessions</th>
                <th>Energy</th>
                <th>Attention</th>
                <th>
                  <span class="visually-hidden">Manage</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fleet.stations.map((station) => (
                <FleetStationRow station={station} onManage={onManage} key={station.id} />
              ))}
            </tbody>
          </table>
        </div>
        <p class="fine-print fleet-invariant">
          Fleet visibility is convenience, not authority. Each charger keeps an independent
          identity, local authorization list, and evidence boundary.
        </p>
      </section>
    </div>
  );
}

function FleetStationRow({
  station,
  onManage,
}: {
  station: FleetStationSummary;
  onManage: (stationId: string) => void;
}) {
  return (
    <tr>
      <td>
        <div class="fleet-station">
          <strong>{station.label}</strong>
          <span>{station.site}</span>
          <code>{station.id}</code>
        </div>
      </td>
      <td>
        <span class={`state-chip ${station.connected ? "ok" : "idle"}`}>
          {station.connected ? "Connected" : "Offline"}
        </span>
      </td>
      <td>{station.authorizationState === "current" ? "Synchronized" : "Pending"}</td>
      <td>{station.readiness === "ready" ? "Software-ready" : "Not proven"}</td>
      <td>
        {station.activeSessionCount ? `${station.activeSessionCount} active` : "No active session"}
      </td>
      <td class="numeric">{formatEnergy(station.energyWh)}</td>
      <td>
        {station.attention.length ? (
          <ul class="fleet-attention">
            {station.attention.map((item) => (
              <li key={item}>{fleetAttentionLabel(item)}</li>
            ))}
          </ul>
        ) : (
          <span class="state-chip ok">Clear</span>
        )}
      </td>
      <td>
        <button class="button secondary compact" type="button" onClick={() => onManage(station.id)}>
          Manage
        </button>
      </td>
    </tr>
  );
}

function FleetMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  return (
    <div class={`fleet-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FleetStatusPill({ fleet }: { fleet: FleetSnapshot }) {
  return (
    <span class={`status-pill ${fleet.totals.connected ? "connected" : "offline"}`}>
      <span class="signal-dot" aria-hidden="true" />
      {fleet.totals.connected} of {fleet.totals.stations} connected
    </span>
  );
}

function fleetAttentionLabel(item: FleetStationSummary["attention"][number]): string {
  const labels: Record<FleetStationSummary["attention"][number], string> = {
    "authorization-pending": "Owner access pending",
    "continuity-unproven": "Offline readiness unproven",
    "evidence-conflict": "Evidence conflict",
    "migration-action": "Migration action",
    offline: "Offline",
  };
  return labels[item];
}

function formatEnergy(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} kWh` : `${value} Wh`;
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

const MIGRATION_PHASES: readonly { label: string; phase: MigrationPhase }[] = [
  { label: "Inventory and custody", phase: "inventory" },
  { label: "Preservation and rollback", phase: "preservation" },
  { label: "Owner endpoint readiness", phase: "endpoint-readiness" },
  { label: "Observed online path", phase: "online-proof" },
];

function MigrationPanel({ migration }: { migration: MigrationProjection }) {
  const [digests, setDigests] = useState<Record<string, string>>({});
  const [targetManifest, setTargetManifest] = useState("");
  const [targetManifestName, setTargetManifestName] = useState("");
  const [transport, setTransport] = useState<"internet-wss" | "isolated-lan-ws">("isolated-lan-ws");
  const [windowHours, setWindowHours] = useState("1");
  const [confirmation, setConfirmation] = useState("");
  const targetReady = targetManifest.length > 0 && targetManifest.length <= 6 * 1024;
  const authorizationReady =
    migration.preSwitchReady &&
    targetReady &&
    confirmation === MIGRATION_AUTHORIZATION_PHRASE &&
    action.value === null;
  const statusLabel = migrationStatusLabel(migration.status);

  return (
    <div class="section-stack">
      <header class="page-head with-actions">
        <div>
          <p class="page-kicker">Liberate my charger</p>
          <h1>{statusLabel}</h1>
          <p class="lede">{migration.disclaimer}</p>
        </div>
        <button
          class="button secondary"
          type="button"
          disabled={action.value !== null}
          onClick={() => void runMigrationReportExport()}
        >
          {action.value === "migration-export" ? "Exporting…" : "Export migration dossier"}
        </button>
      </header>

      <div class="migration-phases">
        {MIGRATION_PHASES.map(({ label, phase }, index) => {
          const steps = migration.steps.filter((step) => step.phase === phase);
          const done = steps.filter((step) => step.state === "pass").length;
          return (
            <section class="panel glass step-group" key={phase} aria-label={label}>
              <header class="step-group-head">
                <span class="phase-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h2>{label}</h2>
                  <small>
                    {phase === "online-proof"
                      ? "Derived only from protocol events after a valid owner-authorized change window."
                      : "Owner-recorded checks require a SHA-256 digest of separately held evidence."}
                  </small>
                </div>
                <span class="progress-count">
                  {done}/{steps.length}
                </span>
              </header>
              <ul class="step-list">
                {steps.map((step) => (
                  <MigrationStep
                    key={step.id}
                    step={step}
                    digest={digests[step.id] ?? ""}
                    onDigest={(value) => setDigests({ ...digests, [step.id]: value })}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <form
        class={`panel glass authorization-gate ${migration.preSwitchReady ? "ready" : "locked"}`}
        onSubmit={(event) => {
          event.preventDefault();
          void runMigrationAuthorization({
            confirmation: MIGRATION_AUTHORIZATION_PHRASE,
            expiresAt: new Date(Date.now() + Number(windowHours) * 60 * 60 * 1000).toISOString(),
            targetManifest,
            transport,
          });
        }}
      >
        <header class="panel-head">
          <div>
            <p class="panel-kicker">Owner authorization gate</p>
            <h2>
              {migration.preSwitchReady
                ? "Pre-switch evidence is ready for explicit owner confirmation."
                : "Locked until every pre-switch checkpoint passes."}
            </h2>
          </div>
          <span
            class={`gate-lock ${migration.preSwitchReady ? "open" : "closed"}`}
            aria-hidden="true"
          />
        </header>
        <p class="panel-intro">
          Select the canonical file produced by <code>pnpm migration-manifest create</code>. The API
          validates its station, inventory, evidence hashes, transport, and safety boundary, then
          persists only its canonical hash. The file must never contain a station secret.
        </p>
        <div class="form-grid">
          <label class="manifest-field full-field">
            Canonical target manifest
            <input
              accept="application/json,.json"
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                setTargetManifestName(file?.name ?? "");
                setTargetManifest("");
                if (file) {
                  void file.text().then((contents) => {
                    setTargetManifest(contents);
                  });
                }
              }}
            />
            <span>{targetManifestName || "No manifest selected"}</span>
          </label>
          <label>
            Target transport
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.currentTarget.value as "internet-wss" | "isolated-lan-ws")
              }
            >
              <option value="isolated-lan-ws">Isolated LAN WS</option>
              <option value="internet-wss">Certificate-validated internet WSS</option>
            </select>
          </label>
          <label>
            Authorization window
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(event.currentTarget.value)}
            >
              <option value="1">1 hour</option>
              <option value="4">4 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
            </select>
          </label>
          <label class="confirmation-field full-field">
            Type this exact authorization phrase
            <span class="phrase">{MIGRATION_AUTHORIZATION_PHRASE}</span>
            <input
              value={confirmation}
              autocomplete="off"
              onInput={(event) => setConfirmation(event.currentTarget.value)}
            />
          </label>
        </div>
        <button class="button danger" type="submit" disabled={!authorizationReady}>
          {action.value === "migration-authorize"
            ? "Recording authorization…"
            : "Authorize documented endpoint-change window"}
        </button>
      </form>

      {migration.authorization && (
        <div
          class={`window-banner ${migration.authorization.validForChange ? "active" : "expired"}`}
          role="status"
        >
          <strong>
            {migration.authorization.validForChange
              ? "Owner authorization window is active"
              : "Owner authorization window expired"}
          </strong>
          <span>{migration.authorization.transport}</span>
          <span>Expires {formatDate(migration.authorization.expiresAt)}</span>
          <code>manifest sha256:{migration.authorization.targetManifestSha256}</code>
        </div>
      )}
    </div>
  );
}

function MigrationStep({
  step,
  digest,
  onDigest,
}: {
  step: MigrationStepResult;
  digest: string;
  onDigest(value: string): void;
}) {
  const digestReady = /^[a-fA-F0-9]{64}$/.test(digest);
  return (
    <li class={`step-row ${step.state}`}>
      <div class="step-summary">
        <span class={`step-mark ${step.state}`} aria-hidden="true" />
        <div>
          <strong>{step.label}</strong>
          <small>
            {step.source === "protocol-derived"
              ? "Derived from bounded protocol evidence"
              : step.source === "device-inventory"
                ? "Derived from the evidenced pre-switch device inventory"
                : "Owner-recorded external evidence"}
          </small>
        </div>
        <span class={`step-state ${step.state}`}>{step.state}</span>
      </div>
      {step.source === "owner-recorded" && (
        <div class="digest-controls">
          <label>
            <span class="visually-hidden">Evidence SHA-256 for {step.label}</span>
            <input
              value={digest}
              placeholder="Evidence SHA-256 (64 hex characters)"
              spellcheck={false}
              class="mono-input"
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <button
            class="button secondary compact"
            type="button"
            aria-label={`Confirm checkpoint: ${step.label}`}
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runMigrationCheckpointSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "confirmed",
              })
            }
          >
            Confirm checkpoint
          </button>
          <button
            class="button danger-ghost compact"
            type="button"
            aria-label={`Record stop condition: ${step.label}`}
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runMigrationCheckpointSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "blocked",
              })
            }
          >
            Record stop
          </button>
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </li>
  );
}

function migrationStatusLabel(status: MigrationProjection["status"]): string {
  if (status === "blocked") return "Stop condition recorded";
  if (status === "ready-for-owner-confirmation") return "Ready for owner confirmation";
  if (status === "owner-authorized-window") return "Owner-authorized window active";
  if (status === "online-proof-in-progress") return "Online proof in progress";
  if (status === "online-path-observed-unreviewed") return "Online path observed — review pending";
  if (status === "collecting") return "Collecting reversible-migration evidence";
  return "Migration dossier not started";
}

/* ------------------------------------------------------------------ */
/* Delegated access                                                    */
/* ------------------------------------------------------------------ */

function DelegationPanel({ grants }: { grants: readonly DelegateGrantSummary[] }) {
  const [role, setRole] = useState<DelegateRole>("installer");
  const [lifetimeDays, setLifetimeDays] = useState("1");
  const roleDescription =
    role === "installer"
      ? "Station status, diagnostics, migration dossier, and unreviewed Freedom Test evidence"
      : role === "employer"
        ? "Session timestamps and energy only; no RFID identity or household-wide data"
        : "Station and connector status only; no schedules or charger commands";

  return (
    <div class="section-stack">
      <header class="page-head">
        <p class="page-kicker">Delegated access</p>
        <h1>Owner stays root</h1>
        <p class="lede">
          Delegates receive expiring, revocable read capabilities. They cannot synchronize RFID,
          change configuration, issue charger commands, or transfer ownership.
        </p>
      </header>

      <div class="delegation-layout">
        <form
          class="panel glass delegation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runDelegateIssue({
              expiresAt: new Date(
                Date.now() + Number(lifetimeDays) * 24 * 60 * 60 * 1000,
              ).toISOString(),
              role,
            });
          }}
        >
          <header class="panel-head">
            <h2>Issue read access</h2>
          </header>
          <label>
            Delegate role
            <select
              value={role}
              onChange={(event) => setRole(event.currentTarget.value as DelegateRole)}
            >
              <option value="installer">Installer</option>
              <option value="employer">Employer reimbursement</option>
              <option value="energy-provider">Energy provider</option>
            </select>
          </label>
          <p class="scope-note">
            <span>Can read</span>
            {roleDescription}
          </p>
          <label>
            Expires after
            <select
              value={lifetimeDays}
              onChange={(event) => setLifetimeDays(event.currentTarget.value)}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <button class="button primary" type="submit" disabled={action.value !== null}>
            {action.value === "delegate-issue" ? "Issuing capability…" : "Issue one-time secret"}
          </button>
        </form>

        <section class="panel glass" aria-labelledby="grants-title">
          <header class="panel-head">
            <h2 id="grants-title">Current capabilities</h2>
          </header>
          {issuedDelegate.value && (
            <div class="delegate-secret" role="status">
              <div>
                <strong>Copy this bearer secret now</strong>
                <p>
                  Only its verifier is stored. Closing or dismissing this message loses the secret.
                </p>
              </div>
              <code>{issuedDelegate.value.token}</code>
              <button
                class="text-button"
                type="button"
                onClick={() => {
                  issuedDelegate.value = null;
                }}
              >
                Dismiss secret
              </button>
            </div>
          )}
          {grants.length ? (
            <ul class="delegation-list">
              {grants.map((grant) => (
                <li class="delegate-row" key={grant.grantId}>
                  <div>
                    <strong>{delegateRoleLabel(grant.role)}</strong>
                    <small>
                      {grant.scopes.join(", ")}; token <code>{grant.tokenHint}</code>
                    </small>
                  </div>
                  <div class="delegate-row-actions">
                    <span class={`state-chip ${grant.status === "active" ? "ok" : "idle"}`}>
                      {grant.status}
                    </span>
                    <small>Expires {formatDate(grant.expiresAt)}</small>
                    {grant.status === "active" && (
                      <button
                        class="button danger-ghost compact"
                        type="button"
                        disabled={action.value !== null}
                        onClick={() => {
                          if (window.confirm("Revoke this delegate capability immediately?")) {
                            void runDelegateRevoke(grant.grantId);
                          }
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p class="empty-state">No third party currently has a chargeOS capability.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function delegateRoleLabel(role: DelegateRole): string {
  if (role === "installer") return "Installer";
  if (role === "employer") return "Employer reimbursement";
  return "Energy provider";
}

/* ------------------------------------------------------------------ */
/* Freedom Test                                                        */
/* ------------------------------------------------------------------ */

function freedomStatusLabel(status: FreedomTestProjection["status"]): string {
  return status === "evidence-complete-unreviewed"
    ? "Evidence complete — review required"
    : status === "failed"
      ? "Failed observation recorded"
      : status === "baseline-stale"
        ? "Baseline changed — start a new field run"
        : status === "in-progress"
          ? "Field test in progress"
          : "Field test not started";
}

function FreedomTestPanel({ test }: { test: FreedomTestProjection }) {
  const [runConfirmation, setRunConfirmation] = useState("");
  const [device, setDevice] = useState<FreedomTestDeviceInput>({
    articleNumber: test.device?.articleNumber ?? "",
    configurationPath: test.device?.configurationPath ?? "",
    connectivity: test.device?.connectivity ?? "ethernet",
    countryCode: test.device?.countryCode ?? "BE",
    evidenceSha256: test.device?.inventoryEvidenceSha256 ?? "",
    hardwareRevision: test.device?.hardwareRevision ?? "",
    inventoryFirmwareVersion: test.device?.inventoryFirmwareVersion ?? "",
    inventoryModel: test.device?.inventoryModel ?? "",
    inventoryVendor: test.device?.inventoryVendor ?? "",
    priorOperator: test.device?.priorOperator ?? "",
  });
  const [digests, setDigests] = useState<Record<string, string>>({});
  const statusLabel = freedomStatusLabel(test.status);
  const deviceReady =
    Object.values(device).every((value) => value.trim().length > 0) &&
    /^[a-fA-F0-9]{64}$/.test(device.evidenceSha256);
  const automaticReady =
    test.device?.identityMatch === "match" &&
    test.steps.filter((step) => step.source === "automatic").every((step) => step.state === "pass");
  const passed = test.steps.filter((step) => step.state === "pass").length;

  return (
    <div class="section-stack">
      <header class="page-head with-actions">
        <div>
          <p class="page-kicker">Freedom Test</p>
          <h1>{statusLabel}</h1>
          <p class="lede">{test.disclaimer}</p>
        </div>
        <div class="head-actions">
          <button
            class="button ghost"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFreedomReportExport()}
          >
            {action.value === "freedom-export" ? "Exporting…" : "Export unreviewed report"}
          </button>
          <button
            class="button secondary"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFieldPackExport()}
          >
            {action.value === "field-pack-export" ? "Packing…" : "Export field review pack"}
          </button>
        </div>
      </header>

      {test.run?.state !== "active" ? (
        <form
          class="panel glass authorization-gate"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomTestStart({ confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE });
          }}
        >
          <header class="panel-head">
            <div>
              <p class="panel-kicker">Witnessed run baseline</p>
              <h2>
                {test.run?.state === "stale"
                  ? "The device or authorized migration baseline changed. Old witnessed outcomes cannot carry forward."
                  : automaticReady
                    ? "Online evidence is ready to bind to a new physical field run."
                    : "Locked until the exact authorized device and all automatic online steps pass."}
              </h2>
            </div>
            <span class={`gate-lock ${automaticReady ? "open" : "closed"}`} aria-hidden="true" />
          </header>
          <div class="form-row">
            <label class="confirmation-field">
              Type this exact field-run phrase
              <span class="phrase">{FREEDOM_TEST_RUN_CONFIRMATION_PHRASE}</span>
              <input
                value={runConfirmation}
                autocomplete="off"
                onInput={(event) => setRunConfirmation(event.currentTarget.value)}
              />
            </label>
            <button
              class="button danger"
              type="submit"
              disabled={
                !automaticReady ||
                runConfirmation !== FREEDOM_TEST_RUN_CONFIRMATION_PHRASE ||
                action.value !== null
              }
            >
              {action.value === "freedom-run" ? "Starting field run…" : "Start bound field run"}
            </button>
          </div>
        </form>
      ) : (
        <div class="window-banner active" role="status">
          <strong>Witnessed field run active</strong>
          <span>Started {formatDate(test.run.startedAt)}</span>
          <code>run {test.run.runId}</code>
        </div>
      )}

      <div class="freedom-layout">
        <form
          class="panel glass device-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomDeviceSave(device);
          }}
        >
          <header class="panel-head">
            <div>
              <h2>Exact device identity</h2>
              <p class="panel-sub">
                Record label, ACE, or current-backend inventory before the switch. The first
                authorized Boot must match it exactly.
              </p>
            </div>
          </header>
          <div class="identity-compare">
            <div class="identity-card">
              <span>Pre-switch inventory</span>
              <strong>
                {device.inventoryVendor && device.inventoryModel
                  ? `${device.inventoryVendor} ${device.inventoryModel}`
                  : "Inventory not recorded"}
              </strong>
              <small>{device.inventoryFirmwareVersion || "Firmware not recorded"}</small>
            </div>
            <span
              class={`identity-link ${test.device?.identityMatch ?? "pending"}`}
              aria-hidden="true"
            />
            <div class="identity-card">
              <span>Observed boot identity</span>
              <strong>
                {test.device?.vendor && test.device.model
                  ? `${test.device.vendor} ${test.device.model}`
                  : "Awaiting BootNotification"}
              </strong>
              <small>{test.device?.firmwareVersion ?? "Firmware not observed"}</small>
            </div>
            <p class={`identity-verdict ${test.device?.identityMatch ?? "pending"}`}>
              {test.device?.identityMatch === "match"
                ? "Matches the authorized pre-switch inventory"
                : test.device?.identityMatch === "mismatch"
                  ? "Mismatch — stop and investigate before continuing"
                  : "Awaiting exact post-switch match"}
            </p>
          </div>
          <div class="form-grid">
            <label>
              Article number
              <input
                value={device.articleNumber}
                onInput={(event) =>
                  setDevice({ ...device, articleNumber: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Hardware revision
              <input
                value={device.hardwareRevision}
                onInput={(event) =>
                  setDevice({ ...device, hardwareRevision: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Country code
              <input
                value={device.countryCode}
                maxLength={2}
                onInput={(event) =>
                  setDevice({ ...device, countryCode: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Connectivity
              <select
                value={device.connectivity}
                onChange={(event) =>
                  setDevice({ ...device, connectivity: event.currentTarget.value })
                }
              >
                <option value="ethernet">Ethernet</option>
                <option value="wifi">Wi-Fi</option>
                <option value="cellular">Cellular</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Inventory vendor
              <input
                value={device.inventoryVendor}
                maxLength={20}
                onInput={(event) =>
                  setDevice({ ...device, inventoryVendor: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Inventory model
              <input
                value={device.inventoryModel}
                maxLength={20}
                onInput={(event) =>
                  setDevice({ ...device, inventoryModel: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Inventory firmware
              <input
                value={device.inventoryFirmwareVersion}
                maxLength={50}
                onInput={(event) =>
                  setDevice({ ...device, inventoryFirmwareVersion: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Prior operator
              <input
                value={device.priorOperator}
                onInput={(event) =>
                  setDevice({ ...device, priorOperator: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Endpoint configuration path
              <input
                value={device.configurationPath}
                onInput={(event) =>
                  setDevice({ ...device, configurationPath: event.currentTarget.value })
                }
              />
            </label>
            <label class="full-field">
              Inventory evidence SHA-256
              <input
                class="mono-input"
                value={device.evidenceSha256}
                placeholder="64-character digest"
                spellcheck={false}
                onInput={(event) =>
                  setDevice({ ...device, evidenceSha256: event.currentTarget.value.trim() })
                }
              />
            </label>
          </div>
          <button
            class="button secondary"
            type="submit"
            disabled={!deviceReady || action.value !== null}
          >
            {action.value === "freedom-device" ? "Saving identity…" : "Save exact device identity"}
          </button>
        </form>

        <section class="panel glass step-group" aria-labelledby="freedom-steps-title">
          <header class="step-group-head">
            <div>
              <h2 id="freedom-steps-title">Versioned evidence steps</h2>
              <small>Witnessed steps require a SHA-256 digest of separately held evidence.</small>
            </div>
            <span class="progress-count">
              {passed}/{test.steps.length}
            </span>
          </header>
          <ul class="step-list">
            {test.steps.map((step) => (
              <FreedomStep
                key={step.id}
                step={step}
                runId={test.run?.state === "active" ? test.run.runId : null}
                digest={digests[step.id] ?? ""}
                onDigest={(value) => setDigests({ ...digests, [step.id]: value })}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FreedomStep({
  step,
  runId,
  digest,
  onDigest,
}: {
  step: FreedomTestStepResult;
  runId: string | null;
  digest: string;
  onDigest(value: string): void;
}) {
  const digestReady = /^[a-fA-F0-9]{64}$/.test(digest);
  return (
    <li class={`step-row ${step.state}`}>
      <div class="step-summary">
        <span class={`step-mark ${step.state}`} aria-hidden="true" />
        <div>
          <strong>{step.label}</strong>
          <small>
            {step.source === "automatic"
              ? "Derived from protocol evidence"
              : "Witnessed physical observation"}
          </small>
        </div>
        <span class={`step-state ${step.state}`}>{step.state}</span>
      </div>
      {step.source === "witnessed" && runId && (
        <div class="digest-controls">
          <label>
            <span class="visually-hidden">Evidence SHA-256 for {step.label}</span>
            <input
              value={digest}
              placeholder="Evidence SHA-256 (64 hex characters)"
              spellcheck={false}
              class="mono-input"
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <button
            class="button secondary compact"
            type="button"
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runFreedomObservationSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "pass",
                runId,
              })
            }
          >
            Record pass
          </button>
          <button
            class="button danger-ghost compact"
            type="button"
            disabled={!digestReady || action.value !== null}
            onClick={() =>
              void runFreedomObservationSave(step.id, {
                evidenceSha256: digest,
                observedAt: new Date().toISOString(),
                outcome: "fail",
                runId,
              })
            }
          >
            Record failure
          </button>
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-in                                                             */
/* ------------------------------------------------------------------ */

function TokenGate() {
  const [value, setValue] = useState("");
  return (
    <div class="console-backdrop">
      <main class="token-gate">
        <div class="token-card glass">
          <BrandMark />
          <h1>Control starts with you.</h1>
          <p>
            Enter the owner API token from your local chargeOS configuration. It stays in this
            browser tab and is never written to the evidence ledger.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOwnerToken(value);
              void refreshFleet();
            }}
          >
            <label for="owner-token">Owner API token</label>
            <input
              id="owner-token"
              type="password"
              value={value}
              minLength={32}
              autocomplete="current-password"
              onInput={(event) => setValue(event.currentTarget.value)}
            />
            <button class="button primary" type="submit" disabled={value.trim().length < 32}>
              Open owner console
            </button>
          </form>
          {notice.value && <div class="notice error">{notice.value.message}</div>}
          <p class="token-foot">
            <a class="text-button" href="/help">
              Setup and help guides
            </a>
            <span>Local first. No hidden root administrator.</span>
          </p>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span class={`status-pill ${connected ? "connected" : "offline"}`}>
      <span class="signal-dot" aria-hidden="true" />
      {connected ? "Station connected" : "Station offline"}
    </span>
  );
}

function Fact({
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

function SessionTable({ sessions }: { sessions: readonly ChargeSession[] }) {
  if (!sessions.length) return <p class="empty-state">No charging sessions recorded yet.</p>;
  return (
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Started</th>
            <th>Connector</th>
            <th class="numeric">Energy</th>
            <th>Authorization</th>
            <th>Reconciliation</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.transactionId}>
              <td class="mono">#{session.transactionId}</td>
              <td class="nowrap">{formatDate(session.startedAt)}</td>
              <td>{session.connectorId}</td>
              <td class="numeric">
                {session.energyWh === null ? "—" : `${(session.energyWh / 1000).toFixed(2)} kWh`}
              </td>
              <td>
                <span class={`table-status ${session.authorizationStatus.toLowerCase()}`}>
                  {session.authorizationStatus}
                </span>
              </td>
              <td>
                {session.replayedMessageCount === 0
                  ? "No exact retries"
                  : `${session.replayedMessageCount} exact ${session.replayedMessageCount === 1 ? "retry" : "retries"}`}
              </td>
              <td>
                <span
                  class={`table-status ${session.integrity === "conflict" ? "conflict" : session.status}`}
                >
                  {session.integrity === "conflict" ? "evidence conflict" : session.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EVENT_DIRECTION_LABELS: Readonly<Record<EvidenceSummary["direction"], string>> = {
  "csms-to-station": "To charger",
  "station-to-csms": "From charger",
  system: "System",
};

function EvidenceTimeline({ events }: { events: readonly EvidenceSummary[] }) {
  if (!events.length) return <p class="empty-state">The evidence ledger is empty.</p>;
  return (
    <ol class="timeline">
      {events.map((event) => (
        <li key={event.eventId}>
          <span class={`event-direction ${event.direction}`} aria-hidden="true" />
          <div>
            <strong>{event.message}</strong>
            <small>
              {EVENT_DIRECTION_LABELS[event.direction]}
              {event.carriedFromRecordHash ? ", carried from custodied source" : ""}
            </small>
          </div>
          <time dateTime={event.at}>{formatDate(event.at)}</time>
        </li>
      ))}
    </ol>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));
}

function valueOrDash(value: number | null): string {
  return value === null ? "—" : String(value);
}
