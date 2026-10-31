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
  GenesisPlan,
  MigrationPhase,
  MigrationProjection,
  MigrationStepResult,
} from "../shared/contracts.js";
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
  setOwnerToken,
  selectStation,
  selectedStationId,
  snapshot,
} from "./model.js";

export function App() {
  const [view, setView] = useState<"charger" | "fleet">("fleet");
  const [continuityConfirmation, setContinuityConfirmation] = useState("");
  const [newOwnerTag, setNewOwnerTag] = useState("");
  const [ownerTagRevocationConfirmation, setOwnerTagRevocationConfirmation] = useState("");
  useEffect(() => {
    if (ownerToken.value) void refreshFleet();
  }, []);

  if (!isAuthenticated.value) return <TokenGate />;
  if (!fleet.value || !snapshot.value) {
    return (
      <main class="centered-shell">
        <div class="brand-mark">chargeOS</div>
        <p>{loading.value ? "Opening the owner ledger…" : notice.value?.message}</p>
        {!loading.value && (
          <button class="button secondary" type="button" onClick={() => setOwnerToken("")}>
            Use another token
          </button>
        )}
      </main>
    );
  }

  const current = snapshot.value;
  const fleetSnapshot = fleet.value;
  const hasMultipleStations = fleetSnapshot.stations.length > 1;
  const showFleet = hasMultipleStations && view === "fleet";
  return (
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand-mark">chargeOS</div>
          <p class="eyebrow">Owner-controlled charging</p>
        </div>
        <div class="topbar-actions">
          {hasMultipleStations && (
            <button
              class={`text-button ${showFleet ? "active" : ""}`}
              type="button"
              onClick={() => setView("fleet")}
            >
              Fleet overview
            </button>
          )}
          {!showFleet && (
            <label class="station-switcher">
              <span>Charger</span>
              <select
                value={selectedStationId.value}
                onChange={(event) => {
                  selectStation(event.currentTarget.value);
                  setView("charger");
                  void refreshSnapshot();
                }}
              >
                {fleetSnapshot.stations.map((station) => (
                  <option value={station.id} key={station.id}>
                    {station.label} · {station.site}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showFleet ? (
            <FleetStatusPill fleet={fleetSnapshot} />
          ) : (
            <StatusPill connected={current.station.connected} />
          )}
          <button class="text-button" type="button" onClick={() => setOwnerToken("")}>
            Lock console
          </button>
        </div>
      </header>

      <main>
        {showFleet ? (
          <FleetDashboard
            fleet={fleetSnapshot}
            onManage={(stationId) => {
              selectStation(stationId);
              setView("charger");
              void refreshSnapshot();
            }}
          />
        ) : (
          <>
            <section class="hero-grid">
              <article class="hero-copy">
                <p class="eyebrow">Essential-use invariant</p>
                <h1>Your charger remains yours.</h1>
                <p class="hero-text">
                  A synchronized owner credential must deliver energy without chargeOS, DNS,
                  internet, or any vendor cloud. Software checks are evidence—not a substitute for
                  the witnessed physical Freedom Test.
                </p>
              </article>
              <ReadinessCard readiness={current.readiness} connected={current.station.connected} />
            </section>

            {notice.value && (
              <div class={`notice ${notice.value.kind}`}>{notice.value.message}</div>
            )}

            {current.evidenceHistory.mode === "compacted-operational" && (
              <div class="notice history-warning" role="status">
                This edge uses compacted operational history. It carries state from{" "}
                {current.evidenceHistory.custodyBundleCount} separately held source bundle
                {current.evidenceHistory.custodyBundleCount === 1 ? "" : "s"} covering{" "}
                {current.evidenceHistory.custodiedEventCount} records. Full historical review
                requires those source bundles; this local ledger is not the original complete chain.
              </div>
            )}

            <GenesisPlanPanel plan={current.genesisPlan} />

            <TroubleshootingPanel
              key={current.station.id}
              stationId={current.station.id}
              token={ownerToken.value}
            />

            <section class="dashboard-grid">
              <article class="panel station-panel">
                <PanelHeading label="Station" title={current.station.id} />
                <dl class="facts">
                  <Fact
                    label="Connection"
                    value={current.station.connected ? "Connected" : "Offline"}
                  />
                  <Fact label="Connected since" value={formatDate(current.station.connectedAt)} />
                  <Fact
                    label="Hardware"
                    value={
                      current.station.boot
                        ? `${current.station.boot.vendor} ${current.station.boot.model}`
                        : "Awaiting BootNotification"
                    }
                  />
                  <Fact
                    label="Firmware"
                    value={current.station.boot?.firmwareVersion ?? "Unknown"}
                  />
                </dl>
                <div class="connector-list">
                  {current.station.connectors.length ? (
                    current.station.connectors.map((connector) => (
                      <div class="connector-row" key={connector.connectorId}>
                        <span>Connector {connector.connectorId}</span>
                        <strong>{connector.status}</strong>
                        <small>{connector.errorCode}</small>
                      </div>
                    ))
                  ) : (
                    <p class="muted">No connector status received yet.</p>
                  )}
                </div>
              </article>

              <article class="panel">
                <PanelHeading
                  label="Owner authorization"
                  title={`${current.authorization.tagCount} essential tag${current.authorization.tagCount === 1 ? "" : "s"}`}
                />
                <div class={`authorization-state ${current.authorization.syncState}`}>
                  <span class="signal-dot" />
                  <strong>
                    {current.authorization.syncState === "current"
                      ? "Charger list matches desired owner access"
                      : current.authorization.syncState === "never-synced"
                        ? "Owner access has never been acknowledged"
                        : "Owner access changes are pending"}
                  </strong>
                </div>
                <p class="muted">
                  Raw RFID identifiers stay in local configuration and are never written to the
                  evidence ledger.
                </p>
                <ul class="tag-list owner-tag-list">
                  {current.authorization.tagPseudonyms.map((tag) => (
                    <li key={tag}>
                      <code>{tag}</code>
                      <button
                        class="text-button"
                        type="button"
                        disabled={
                          current.authorization.tagCount <= 1 ||
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
                <label class="owner-tag-revocation-confirmation">
                  Type this exact phrase before removing a desired tag
                  <span>{OWNER_TAG_REVOCATION_CONFIRMATION}</span>
                  <input
                    value={ownerTagRevocationConfirmation}
                    autocomplete="off"
                    onInput={(event) =>
                      setOwnerTagRevocationConfirmation(event.currentTarget.value)
                    }
                  />
                </label>
                {current.authorization.pendingRevocations.length > 0 && (
                  <div class="authorization-risk" role="alert">
                    <strong>
                      {current.authorization.pendingRevocations.length} removed owner tag
                      {current.authorization.pendingRevocations.length === 1
                        ? " may"
                        : "s may"}{" "}
                      still authorize locally
                    </strong>
                    <p>
                      The charger has not acknowledged a replacement list. During an outage, stale
                      local access can remain available until synchronization succeeds.
                    </p>
                    <ul class="tag-list">
                      {current.authorization.pendingRevocations.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {current.authorization.pendingAdditions.length > 0 && (
                  <p class="authorization-pending">
                    {current.authorization.pendingAdditions.length} configured owner tag
                    {current.authorization.pendingAdditions.length === 1 ? " is" : "s are"} not yet
                    acknowledged by the charger.
                  </p>
                )}
                <dl class="facts compact">
                  <Fact
                    label="Last accepted revision"
                    value={valueOrDash(current.authorization.lastSyncRevision)}
                  />
                  <Fact label="Last sync" value={formatDate(current.authorization.lastSyncAt)} />
                  <Fact
                    label="Latest completed attempt"
                    value={
                      current.authorization.lastAttemptRevision === null
                        ? "—"
                        : `r${current.authorization.lastAttemptRevision} · ${current.authorization.lastAttemptStatus ?? "unknown"}`
                    }
                  />
                  {current.authorization.pendingRevision !== null && (
                    <Fact
                      label="Unacknowledged command"
                      value={`revision ${current.authorization.pendingRevision}`}
                    />
                  )}
                </dl>
              </article>

              <article class="panel control-panel">
                <PanelHeading label="Guarded actions" title="Prove, then synchronize" />
                <button
                  class="button primary"
                  type="button"
                  disabled={!current.station.connected || action.value !== null}
                  onClick={() => void runInspection()}
                >
                  {action.value === "inspect" ? "Inspecting…" : "Inspect offline capabilities"}
                </button>
                <button
                  class="button secondary"
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
                {current.readiness?.state !== "ready" && (
                  <form
                    class="continuity-preparation"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runContinuityPreparation({ confirmation: continuityConfirmation });
                    }}
                  >
                    <p>
                      This one-way action can only request <code>LocalAuthListEnabled=true</code>,
                      <code> LocalAuthorizeOffline=true</code>, and
                      <code> AllowOfflineTxForUnknownId=false</code>. Missing or read-only settings
                      stop before mutation. It never synchronizes tags or restarts the charger.
                    </p>
                    <label>
                      Type this exact owner-continuity authorization phrase
                      <span>{CONTINUITY_PREPARATION_PHRASE}</span>
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
                      {action.value === "prepare"
                        ? "Preparing…"
                        : "Prepare owner-continuity settings"}
                    </button>
                  </form>
                )}
                <button
                  class="button ghost"
                  type="button"
                  disabled={action.value !== null}
                  onClick={() => void runContinuityExport()}
                >
                  {action.value === "export" ? "Exporting…" : "Export redacted continuity evidence"}
                </button>
                <p class="fine-print">
                  Endpoint changes, firmware, and physical work remain outside this console and
                  require the reversible installer runbook.
                </p>
              </article>
            </section>

            <FreedomTestPanel test={current.freedomTest} />

            <MigrationPanel migration={current.migration} />

            <DelegationPanel grants={current.delegations} />

            <section class="panel wide-panel">
              <PanelHeading label="Sessions" title="Energy history" />
              <SessionTable sessions={current.sessions} />
            </section>

            <section class="panel wide-panel">
              <PanelHeading label="Evidence" title="Latest owner ledger events" />
              <EvidenceTimeline events={current.evidence} />
            </section>
          </>
        )}
      </main>

      <footer>
        <span>Open source. Local first. No hidden root administrator.</span>
        <span>
          Snapshot {formatDate(showFleet ? fleetSnapshot.generatedAt : current.generatedAt)}
        </span>
      </footer>
    </div>
  );
}

function FleetDashboard({
  fleet,
  onManage,
}: {
  fleet: FleetSnapshot;
  onManage: (stationId: string) => void;
}) {
  return (
    <div class="fleet-dashboard">
      <section class="fleet-hero">
        <div>
          <p class="eyebrow">Owner fleet</p>
          <h1>Every charger. One owner.</h1>
          <p class="hero-text">
            Operate every provisioned charge point from one replaceable console. Previously
            synchronized owner credentials remain local to each charger when this fleet view, its
            network, or chargeOS disappears.
          </p>
        </div>
        <div class="fleet-invariant" role="note">
          <strong>Fleet visibility is convenience, not authority.</strong>
          <span>
            Each charger keeps an independent identity, local authorization list, and evidence
            boundary.
          </span>
        </div>
      </section>

      <section class="fleet-metrics" aria-label="Fleet summary">
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

      <section class="panel wide-panel fleet-list-panel">
        <div class="fleet-list-heading">
          <PanelHeading label="Charge points" title="Fleet operations" />
          <span class="muted">
            Select a charger for RFID, sessions, migration, continuity, and delegates.
          </span>
        </div>
        <div class="fleet-table-wrap">
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
        <strong>{station.label}</strong>
        <span>{station.site}</span>
        <code>{station.id}</code>
      </td>
      <td>
        <span class={`fleet-state ${station.connected ? "ok" : "offline"}`}>
          {station.connected ? "Connected" : "Offline"}
        </span>
      </td>
      <td>{station.authorizationState === "current" ? "Synchronized" : "Pending"}</td>
      <td>{station.readiness === "ready" ? "Software-ready" : "Not proven"}</td>
      <td>
        {station.activeSessionCount ? `${station.activeSessionCount} active` : "No active session"}
      </td>
      <td>{formatEnergy(station.energyWh)}</td>
      <td>
        {station.attention.length ? (
          <ul class="fleet-attention">
            {station.attention.map((item) => (
              <li key={item}>{fleetAttentionLabel(item)}</li>
            ))}
          </ul>
        ) : (
          <span class="fleet-state ok">Clear</span>
        )}
      </td>
      <td>
        <button class="button secondary" type="button" onClick={() => onManage(station.id)}>
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
    <article class={`fleet-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FleetStatusPill({ fleet }: { fleet: FleetSnapshot }) {
  return (
    <span class={`status-pill ${fleet.totals.connected ? "online" : "offline"}`}>
      <span class="signal-dot" />
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

const MIGRATION_PHASES: readonly { label: string; phase: MigrationPhase }[] = [
  { label: "Inventory and custody", phase: "inventory" },
  { label: "Preservation and rollback", phase: "preservation" },
  { label: "Owner endpoint readiness", phase: "endpoint-readiness" },
  { label: "Observed online path", phase: "online-proof" },
];

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
  return (
    <section class={`panel wide-panel genesis-plan ${plan.state}`}>
      <div class="genesis-plan-heading">
        <PanelHeading label="Genesis plan" title={title} />
        <code>phase: {plan.phase}</code>
      </div>
      <p class="migration-disclaimer">{plan.disclaimer}</p>
      <div class="genesis-action-list">
        {plan.nextActions.map((next, index) => (
          <article
            class="genesis-action"
            key={`${next.id}-${next.migrationStepId ?? next.freedomTestStepId ?? index}`}
          >
            <div class="genesis-action-meta">
              <span>{next.actor}</span>
              <span>{next.execution}</span>
              <span>{next.evidence}</span>
              <span>{next.safety}</span>
            </div>
            <strong>{next.id}</strong>
            <p>{next.instruction}</p>
            {(next.migrationStepId || next.freedomTestStepId) && (
              <code>{next.migrationStepId ?? next.freedomTestStepId}</code>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

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
    <section class="panel wide-panel migration-panel">
      <div class="migration-heading">
        <PanelHeading label="Liberate my charger" title={statusLabel} />
        <button
          class="button ghost compact-button"
          type="button"
          disabled={action.value !== null}
          onClick={() => void runMigrationReportExport()}
        >
          {action.value === "migration-export" ? "Exporting…" : "Export migration dossier"}
        </button>
      </div>
      <p class="migration-disclaimer">{migration.disclaimer}</p>

      <div class="migration-phases">
        {MIGRATION_PHASES.map(({ label, phase }) => (
          <section class="migration-phase" key={phase}>
            <div class="field-section-heading">
              <p class="eyebrow">{label}</p>
              <small>
                {phase === "online-proof"
                  ? "Derived only from protocol events after a valid owner-authorized change window."
                  : "Owner-recorded checks require a SHA-256 digest of separately held evidence."}
              </small>
            </div>
            <div class="migration-step-list">
              {migration.steps
                .filter((step) => step.phase === phase)
                .map((step) => (
                  <MigrationStep
                    key={step.id}
                    step={step}
                    digest={digests[step.id] ?? ""}
                    onDigest={(value) => setDigests({ ...digests, [step.id]: value })}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>

      <form
        class={`migration-authorization ${migration.preSwitchReady ? "ready" : "locked"}`}
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
        <div class="field-section-heading">
          <p class="eyebrow">Owner authorization gate</p>
          <strong>
            {migration.preSwitchReady
              ? "Pre-switch evidence is ready for explicit owner confirmation."
              : "Locked until every pre-switch checkpoint passes."}
          </strong>
          <small>
            Select the canonical file produced by <code>pnpm migration-manifest create</code>. The
            API validates its station, inventory, evidence hashes, transport, and safety boundary,
            then persists only its canonical hash. The file must never contain a station secret.
          </small>
        </div>
        <label class="manifest-field">
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
        <label class="confirmation-field">
          Type this exact authorization phrase
          <span>{MIGRATION_AUTHORIZATION_PHRASE}</span>
          <input
            value={confirmation}
            autocomplete="off"
            onInput={(event) => setConfirmation(event.currentTarget.value)}
          />
        </label>
        <button class="button danger" type="submit" disabled={!authorizationReady}>
          {action.value === "migration-authorize"
            ? "Recording authorization…"
            : "Authorize documented endpoint-change window"}
        </button>
      </form>

      {migration.authorization && (
        <div
          class={`migration-window ${migration.authorization.validForChange ? "active" : "expired"}`}
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
    </section>
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
    <article class={`migration-step ${step.state}`}>
      <div class="migration-step-summary">
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
        <div class="migration-step-controls">
          <label>
            Evidence SHA-256 for {step.label}
            <input
              value={digest}
              placeholder="64-character digest"
              spellcheck={false}
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <div class="migration-step-actions">
            <button
              class="button secondary"
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
              class="button danger"
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
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </article>
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
    <section class="panel wide-panel delegation-panel">
      <div class="delegation-heading">
        <PanelHeading label="Delegated access" title="Owner stays root" />
        <p class="muted">
          Delegates receive expiring, revocable read capabilities. They cannot synchronize RFID,
          change configuration, issue charger commands, or transfer ownership.
        </p>
      </div>

      <form
        class="delegation-form"
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
        <p class="delegation-scope">{roleDescription}</p>
        <button class="button secondary" type="submit" disabled={action.value !== null}>
          {action.value === "delegate-issue" ? "Issuing capability…" : "Issue one-time secret"}
        </button>
      </form>

      {issuedDelegate.value && (
        <div class="delegate-secret" role="status">
          <div>
            <strong>Copy this bearer secret now</strong>
            <p>Only its verifier is stored. Closing or dismissing this message loses the secret.</p>
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

      <div class="delegation-list">
        {grants.length ? (
          grants.map((grant) => (
            <article class="delegate-row" key={grant.grantId}>
              <div>
                <strong>{delegateRoleLabel(grant.role)}</strong>
                <small>
                  {grant.scopes.join(" · ")} · token {grant.tokenHint}
                </small>
              </div>
              <div class="delegate-row-actions">
                <span class={`delegate-state ${grant.status}`}>{grant.status}</span>
                <small>Expires {formatDate(grant.expiresAt)}</small>
                {grant.status === "active" && (
                  <button
                    class="button danger compact-button"
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
            </article>
          ))
        ) : (
          <p class="empty-state">No third party currently has a chargeOS capability.</p>
        )}
      </div>
    </section>
  );
}

function delegateRoleLabel(role: DelegateRole): string {
  if (role === "installer") return "Installer";
  if (role === "employer") return "Employer reimbursement";
  return "Energy provider";
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
  const statusLabel =
    test.status === "evidence-complete-unreviewed"
      ? "Evidence complete — review required"
      : test.status === "failed"
        ? "Failed observation recorded"
        : test.status === "baseline-stale"
          ? "Baseline changed — start a new field run"
          : test.status === "in-progress"
            ? "Field test in progress"
            : "Field test not started";
  const deviceReady =
    Object.values(device).every((value) => value.trim().length > 0) &&
    /^[a-fA-F0-9]{64}$/.test(device.evidenceSha256);
  const automaticReady =
    test.device?.identityMatch === "match" &&
    test.steps.filter((step) => step.source === "automatic").every((step) => step.state === "pass");

  return (
    <section class="panel wide-panel freedom-panel">
      <div class="freedom-heading">
        <PanelHeading label="Freedom Test" title={statusLabel} />
        <div class="freedom-export-actions">
          <button
            class="button ghost compact-button"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFreedomReportExport()}
          >
            {action.value === "freedom-export" ? "Exporting…" : "Export unreviewed report"}
          </button>
          <button
            class="button ghost compact-button"
            type="button"
            disabled={action.value !== null}
            onClick={() => void runFieldPackExport()}
          >
            {action.value === "field-pack-export" ? "Packing…" : "Export field review pack"}
          </button>
        </div>
      </div>
      <p class="freedom-disclaimer">{test.disclaimer}</p>

      {test.run?.state !== "active" ? (
        <form
          class="migration-authorization"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomTestStart({ confirmation: FREEDOM_TEST_RUN_CONFIRMATION_PHRASE });
          }}
        >
          <div class="field-section-heading">
            <p class="eyebrow">Witnessed run baseline</p>
            <strong>
              {test.run?.state === "stale"
                ? "The device or authorized migration baseline changed. Old witnessed outcomes cannot carry forward."
                : automaticReady
                  ? "Online evidence is ready to bind to a new physical field run."
                  : "Locked until the exact authorized device and all automatic online steps pass."}
            </strong>
          </div>
          <label class="confirmation-field">
            Type this exact field-run phrase
            <span>{FREEDOM_TEST_RUN_CONFIRMATION_PHRASE}</span>
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
        </form>
      ) : (
        <div class="migration-window active" role="status">
          <strong>Witnessed field run active</strong>
          <span>Started {formatDate(test.run.startedAt)}</span>
          <code>run {test.run.runId}</code>
        </div>
      )}

      <div class="freedom-layout">
        <form
          class="device-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runFreedomDeviceSave(device);
          }}
        >
          <div class="field-section-heading">
            <p class="eyebrow">Exact device identity</p>
            <small>
              Record label, ACE, or current-backend inventory before the switch. The first
              authorized Boot must match it exactly.
            </small>
          </div>
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
              onInput={(event) => setDevice({ ...device, countryCode: event.currentTarget.value })}
            />
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
          <label>
            Inventory firmware
            <input
              value={device.inventoryFirmwareVersion}
              maxLength={50}
              onInput={(event) =>
                setDevice({ ...device, inventoryFirmwareVersion: event.currentTarget.value })
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
              value={device.evidenceSha256}
              placeholder="64-character digest"
              spellcheck={false}
              onInput={(event) =>
                setDevice({ ...device, evidenceSha256: event.currentTarget.value.trim() })
              }
            />
          </label>
          <div class="observed-device full-field">
            <span>Pre-switch inventory</span>
            <strong>
              {device.inventoryVendor && device.inventoryModel
                ? `${device.inventoryVendor} ${device.inventoryModel}`
                : "Inventory not recorded"}
            </strong>
            <small>{device.inventoryFirmwareVersion || "Firmware not recorded"}</small>
          </div>
          <div class="observed-device full-field">
            <span>Observed boot identity</span>
            <strong>
              {test.device?.vendor && test.device.model
                ? `${test.device.vendor} ${test.device.model}`
                : "Awaiting BootNotification"}
            </strong>
            <small>{test.device?.firmwareVersion ?? "Firmware not observed"}</small>
            <small>
              {test.device?.identityMatch === "match"
                ? "Matches the authorized pre-switch inventory"
                : test.device?.identityMatch === "mismatch"
                  ? "Mismatch — stop and investigate before continuing"
                  : "Awaiting exact post-switch match"}
            </small>
          </div>
          <button
            class="button secondary full-field"
            type="submit"
            disabled={!deviceReady || action.value !== null}
          >
            {action.value === "freedom-device" ? "Saving identity…" : "Save exact device identity"}
          </button>
        </form>

        <div class="freedom-steps">
          <div class="field-section-heading">
            <p class="eyebrow">Versioned evidence steps</p>
            <small>Witnessed steps require a SHA-256 digest of separately held evidence.</small>
          </div>
          {test.steps.map((step) => (
            <FreedomStep
              key={step.id}
              step={step}
              runId={test.run?.state === "active" ? test.run.runId : null}
              digest={digests[step.id] ?? ""}
              onDigest={(value) => setDigests({ ...digests, [step.id]: value })}
            />
          ))}
        </div>
      </div>
    </section>
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
    <article class={`freedom-step ${step.state}`}>
      <div class="freedom-step-summary">
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
      {step.source === "witnessed" && (
        <div class="witness-controls">
          <label>
            Evidence SHA-256 for {step.label}
            <input
              value={digest}
              placeholder="64-character digest"
              spellcheck={false}
              onInput={(event) => onDigest(event.currentTarget.value.trim())}
            />
          </label>
          <div class="witness-actions">
            <button
              class="button secondary"
              type="button"
              disabled={!digestReady || !runId || action.value !== null}
              onClick={() =>
                void runFreedomObservationSave(step.id, {
                  evidenceSha256: digest,
                  observedAt: new Date().toISOString(),
                  outcome: "pass",
                  runId: runId!,
                })
              }
            >
              Record pass
            </button>
            <button
              class="button danger"
              type="button"
              disabled={!digestReady || !runId || action.value !== null}
              onClick={() =>
                void runFreedomObservationSave(step.id, {
                  evidenceSha256: digest,
                  observedAt: new Date().toISOString(),
                  outcome: "fail",
                  runId: runId!,
                })
              }
            >
              Record failure
            </button>
          </div>
        </div>
      )}
      {step.externalEvidenceSha256 && (
        <code class="evidence-digest">sha256:{step.externalEvidenceSha256}</code>
      )}
    </article>
  );
}

function TokenGate() {
  const [value, setValue] = useState("");
  return (
    <main class="token-gate">
      <div class="token-card">
        <div class="brand-mark">chargeOS</div>
        <p class="eyebrow">Local owner console</p>
        <h1>Control starts with you.</h1>
        <p>
          Enter the owner API token from your local chargeOS configuration. It stays in this browser
          tab and is never written to the evidence ledger.
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
      </div>
    </main>
  );
}

function ReadinessCard({
  readiness,
  connected,
}: {
  readiness: CapabilityAssessment | null;
  connected: boolean;
}) {
  const state = readiness?.state ?? "unknown";
  return (
    <article class={`readiness-card ${state}`}>
      <p class="eyebrow">Offline readiness</p>
      <div class="readiness-title">
        <strong>
          {state === "ready"
            ? "Software prerequisites pass"
            : state === "blocked"
              ? "Blocked"
              : "Not yet inspected"}
        </strong>
        <span class={`signal-dot ${state}`} />
      </div>
      {!connected && <p class="muted">Connect the charge point before inspection.</p>}
      {readiness ? (
        <ul class="check-list">
          {readiness.checks.map((check) => (
            <li key={check.id} class={check.state}>
              <span>{check.label}</span>
              <small>{check.observed}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No capability evidence has been collected from this firmware.</p>
      )}
      {state === "ready" && (
        <p class="physical-gate">Physical offline and restart tests are still required.</p>
      )}
    </article>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span class={`status-pill ${connected ? "connected" : "offline"}`}>
      <span class="signal-dot" />
      {connected ? "Station connected" : "Station offline"}
    </span>
  );
}

function PanelHeading({ label, title }: { label: string; title: string }) {
  return (
    <div class="panel-heading">
      <p class="eyebrow">{label}</p>
      <h2>{title}</h2>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
            <th>Energy</th>
            <th>Authorization</th>
            <th>Reconciliation</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.transactionId}>
              <td>#{session.transactionId}</td>
              <td>{formatDate(session.startedAt)}</td>
              <td>{session.connectorId}</td>
              <td>
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

function EvidenceTimeline({ events }: { events: readonly EvidenceSummary[] }) {
  if (!events.length) return <p class="empty-state">The evidence ledger is empty.</p>;
  return (
    <ol class="timeline">
      {events.map((event) => (
        <li key={event.eventId}>
          <span class={`event-direction ${event.direction}`} />
          <div>
            <strong>{event.message}</strong>
            <small>
              {event.direction.replaceAll("-", " ")}
              {event.carriedFromRecordHash ? " · carried from custodied source" : ""}
            </small>
          </div>
          <time>{formatDate(event.at)}</time>
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

function valueOrDash(value: number | null): string {
  return value === null ? "—" : String(value);
}
