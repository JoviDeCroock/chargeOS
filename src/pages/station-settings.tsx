import { useState } from "preact/hooks";

import {
  STATION_RESET_PHRASE,
  STATION_UNLOCK_PHRASE,
  type StationCommandRecord,
} from "../../shared/commands.js";
import type {
  DelegateGrantSummary,
  DelegateRole,
  EvidenceSummary,
  OwnerSnapshot,
} from "../../shared/contracts.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../../shared/continuity.js";
import type { OwnerDirectory } from "../../shared/directory.js";
import { formatDate, t, tn, type MessageKey } from "../i18n/index.js";
import {
  action,
  issuedDelegate,
  ownerToken,
  runAuthorizationSync,
  runContinuityExport,
  runContinuityPreparation,
  runDelegateIssue,
  runDelegateRevoke,
  runInspection,
  runStationCommand,
  stationCommandLabel,
} from "../model.js";
import { ADVANCED_TABS, TAB_LABELS, type AdvancedTab, type Route } from "../routes.js";
import { ConnectChargerPanel } from "./connect.js";
import {
  CompactedHistoryNotice,
  FreedomTestPanel,
  GenesisPlanPanel,
  MigrationPanel,
} from "../switching.js";
import { TroubleshootingPanel } from "../troubleshooting.js";
import {
  cardLabel,
  connectorStatusLabel,
  connectorTone,
  Fact,
  PageHead,
  SessionTable,
  type Tone,
} from "../ui.js";
import { Halo, offlineFieldState } from "./overview.js";

export function StationSettingsPage({
  snapshot: current,
  directory,
  tab,
  visibleTabs,
  tabTones,
  go,
  onEdit,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
  tab: AdvancedTab;
  visibleTabs: ReadonlySet<AdvancedTab>;
  tabTones: Partial<Record<AdvancedTab, Tone>>;
  go: (next: Route) => void;
  onEdit: (() => void) | null;
}) {
  return (
    <div class={`section-stack${tab === "controls" ? " remote-settings" : ""}`}>
      <PageHead title={t("nav.advanced")} lede={t("advanced.lede")} />
      <nav class="tab-strip" aria-label={t("advanced.tabs")}>
        {ADVANCED_TABS.filter((id) => visibleTabs.has(id)).map((id) => {
          const tone = tabTones[id];
          return (
            <a
              key={id}
              class={`tab-link${id === tab ? " active" : ""}`}
              href={`#/advanced/${id}`}
              aria-current={id === tab ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go({ page: "advanced", tab: id });
              }}
            >
              {t(TAB_LABELS[id])}
              {tone && tone !== "idle" && tone !== "ok" && (
                <span class={`rail-dot ${tone}`} aria-hidden="true" />
              )}
            </a>
          );
        })}
      </nav>

      {tab === "offline" ? (
        <OfflineTab snapshot={current} go={go} />
      ) : tab === "controls" ? (
        <ControlsTab key={current.station.id} snapshot={current} directory={directory} />
      ) : tab === "sessions" ? (
        <section class="panel glass" aria-label={t("tab.sessions")}>
          <SessionTable
            sessions={current.sessions}
            directory={directory}
            stationId={current.station.id}
          />
        </section>
      ) : tab === "details" ? (
        <DetailsWithConnection snapshot={current} onEdit={onEdit} />
      ) : tab === "sharing" ? (
        <SharingTab grants={current.delegations} />
      ) : tab === "evidence" ? (
        <EvidenceTab snapshot={current} />
      ) : tab === "switching" ? (
        <EnglishOnly>
          <GenesisPlanPanel plan={current.genesisPlan} />
          <MigrationPanel migration={current.migration} />
        </EnglishOnly>
      ) : tab === "freedom" ? (
        <EnglishOnly>
          <FreedomTestPanel test={current.freedomTest} />
        </EnglishOnly>
      ) : (
        <EnglishOnly>
          <TroubleshootingPanel
            key={current.station.id}
            stationId={current.station.id}
            token={ownerToken.value}
          />
        </EnglishOnly>
      )}
    </div>
  );
}

/** Pages whose safety wording has not been reviewed in other languages say so in the reader's. */
function EnglishOnly({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="section-stack" lang="en">
      <p class="inline-alert idle english-only" lang={undefined}>
        {t("advanced.englishOnly")}
      </p>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Offline charging                                                    */
/* ------------------------------------------------------------------ */

function OfflineTab({
  snapshot: current,
  go,
}: {
  snapshot: OwnerSnapshot;
  go: (next: Route) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  // While setup runs, point back to the one checklist instead of repeating it here.
  const setupStep =
    current.setup && current.setup.state !== "active"
      ? current.setup.steps.findIndex(({ id }) => id === "offline-ready") + 1
      : 0;
  const readiness = current.readiness;
  const state = readiness?.state ?? "unknown";
  const authorization = current.authorization;
  const connected = current.station.connected;
  return (
    <div class="section-stack">
      <section class={`hero glass readiness-${state}`} aria-labelledby="offline-title">
        {readiness && <Halo readiness={readiness} connected={connected} />}
        <div class="hero-body">
          <h2 id="offline-title" class="hero-title">
            {t(
              state === "ready"
                ? "offline.readyTitle"
                : state === "blocked"
                  ? "offline.blockedTitle"
                  : "offline.unknownTitle",
            )}
          </h2>
          <p class="hero-text">{t("offline.explain")}</p>
          <div class="offline-field-summary">
            <strong>
              {t("offline.fieldResult", { result: t(offlineFieldState(current.freedomTest)) })}
            </strong>
            <p>
              {t(
                state !== "ready"
                  ? "offline.fieldAfterSettings"
                  : authorization.syncState === "current"
                    ? "offline.fieldNext"
                    : "offline.fieldAfterCards",
              )}
            </p>
            <a class="text-link" href="/help?guide=connect-a-charger#check-charging-after-the-move">
              {t("offline.fieldGuide")}
            </a>
          </div>
          {setupStep > 0 && (
            <p class="offline-step-of">
              {t("offline.stepOf", { step: setupStep, total: current.setup!.steps.length })}{" "}
              <a
                class="text-link"
                href="#/overview"
                onClick={(event) => {
                  event.preventDefault();
                  go({ page: "overview" });
                }}
              >
                {t("offline.allSteps")}
              </a>
            </p>
          )}
          <div class="hero-actions">
            <button
              class="button primary"
              type="button"
              disabled={!connected || action.value !== null}
              onClick={() => void runInspection()}
            >
              {action.value === "inspect"
                ? t("offline.checking")
                : readiness
                  ? t("offline.checkAgain")
                  : t("offline.check")}
            </button>
            {readiness && (
              <span class="hero-meta">
                {t("offline.lastChecked", { date: formatDate(readiness.checkedAt) })}
              </span>
            )}
          </div>
        </div>
        {readiness && readiness.checks.length > 0 && (
          <ul class="check-list" aria-label={t("offline.checksLabel")}>
            {readiness.checks.map((check) => (
              <li key={check.id} class={check.state}>
                <span class="check-mark" aria-hidden="true" />
                <span class="check-label">{check.label}</span>
                <small>{check.observed}</small>
                <span class="visually-hidden">{check.state}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {readiness && (
        <div class="cards-layout">
          <section class="panel glass" aria-labelledby="send-title">
            <header class="panel-head">
              <h2 id="send-title">{t("offline.sendTitle")}</h2>
            </header>
            <p>{t("offline.sendText")}</p>
            <button
              class="button primary"
              type="button"
              disabled={!connected || state !== "ready" || action.value !== null}
              onClick={() => {
                if (window.confirm(t("cards.sync.confirm"))) void runAuthorizationSync();
              }}
            >
              {action.value === "sync" ? t("cards.sync.sending") : t("cards.sync.send")}
            </button>
            {state !== "ready" && <p class="fine-print">{t("offline.sendLocked")}</p>}
            {authorization.syncState === "current" && <p>{t("overview.listAccepted")}</p>}
            {authorization.pendingRevocations.length > 0 && (
              <p class="risk-text">
                {tn("cards.staleTitle", authorization.pendingRevocations.length)}
              </p>
            )}
            {(authorization.lastAttemptRevision !== null ||
              authorization.pendingRevision !== null) && (
              <dl class="facts compact">
                <Fact
                  label={t("offline.lastRevision")}
                  value={
                    authorization.lastSyncRevision === null
                      ? "—"
                      : String(authorization.lastSyncRevision)
                  }
                />
                <Fact label={t("offline.lastSync")} value={formatDate(authorization.lastSyncAt)} />
                <Fact
                  label={t("offline.lastAttempt")}
                  value={
                    authorization.lastAttemptRevision === null
                      ? "—"
                      : `r${authorization.lastAttemptRevision} ${authorization.lastAttemptStatus ?? "?"}`
                  }
                />
                {authorization.pendingRevision !== null && (
                  <Fact
                    label={t("offline.unanswered")}
                    value={`r${authorization.pendingRevision}`}
                  />
                )}
              </dl>
            )}
          </section>

          {state !== "ready" && (
            <form
              class="panel glass continuity-preparation"
              onSubmit={(event) => {
                event.preventDefault();
                void runContinuityPreparation({ confirmation });
              }}
            >
              <header class="panel-head">
                <h2>{t("offline.prepareTitle")}</h2>
              </header>
              <p>{t("offline.prepareText")}</p>
              <details class="tech-details">
                <summary>{t("offline.techDetails")}</summary>
                <p>
                  <code>LocalAuthListEnabled=true</code>, <code>LocalAuthorizeOffline=true</code>,{" "}
                  <code>AllowOfflineTxForUnknownId=false</code>
                </p>
              </details>
              <label class="confirmation-field">
                {t("common.typePhrase")}
                <span class="phrase neutral" lang="en">
                  {CONTINUITY_PREPARATION_PHRASE}
                </span>
                <input
                  value={confirmation}
                  autocomplete="off"
                  onInput={(event) => setConfirmation(event.currentTarget.value)}
                />
              </label>
              <button
                class="button primary"
                type="submit"
                disabled={
                  !connected ||
                  confirmation !== CONTINUITY_PREPARATION_PHRASE ||
                  action.value !== null
                }
              >
                {action.value === "prepare" ? t("offline.preparing") : t("offline.prepare")}
              </button>
              <p class="fine-print">{t("offline.physicalWork")}</p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Remote control                                                      */
/* ------------------------------------------------------------------ */

function ControlsTab({
  snapshot: current,
  directory,
}: {
  snapshot: OwnerSnapshot;
  directory: OwnerDirectory | null;
}) {
  const reportedConnectorIds = [
    ...new Set(current.station.connectors.map(({ connectorId }) => connectorId)),
  ]
    .filter((id) => id > 0)
    .sort((left, right) => left - right);
  const connectorIds = reportedConnectorIds.length ? reportedConnectorIds : [1];
  const [connectorId, setConnectorId] = useState(connectorIds[0] ?? 1);
  const [availabilityConnector, setAvailabilityConnector] = useState(connectorIds[0] ?? 1);
  const [unlockConnector, setUnlockConnector] = useState(connectorIds[0] ?? 1);
  const unnamed = current.station.label === current.station.id;
  const name = current.station.label;
  const [tagPseudonym, setTagPseudonym] = useState(current.authorization.tagPseudonyms[0] ?? "");
  const [resetType, setResetType] = useState<"Hard" | "Soft">("Soft");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [unlockConfirmation, setUnlockConfirmation] = useState("");
  const busy = action.value !== null;
  const offline = !current.station.connected;
  const activeSessions = current.sessions.filter(({ status }) => status === "active");
  const availabilityStatus =
    current.station.connectors.find(({ connectorId: id }) => id === availabilityConnector)
      ?.status ?? null;

  return (
    <section class="panel glass command-panel" aria-labelledby="commands-title">
      <header class="panel-head">
        <h2 id="commands-title">{t("controls.title")}</h2>
      </header>
      <p class="panel-intro">
        {unnamed ? t("controls.targetThis") : t("controls.target", { name })}
      </p>
      {offline && <p class="inline-alert warn">{t("controls.offline")}</p>}

      <div class="command-grid">
        <form
          class="command-form"
          aria-label={t("controls.startTitle")}
          onSubmit={(event) => {
            event.preventDefault();
            void runStationCommand({ connectorId, tagPseudonym, type: "RemoteStartTransaction" });
          }}
        >
          <h2>{t("controls.startTitle")}</h2>
          <ConnectorSelect ids={connectorIds} value={connectorId} onChange={setConnectorId} />
          <label>
            {t("controls.card")}
            <select
              value={tagPseudonym}
              onChange={(event) => setTagPseudonym(event.currentTarget.value)}
            >
              {current.authorization.tagPseudonyms.map((tag) => {
                const card = cardLabel(directory, current.station.id, tag);
                return (
                  <option key={tag} value={tag}>
                    {card.holder ? `${card.name} · ${card.holder}` : card.name}
                  </option>
                );
              })}
            </select>
          </label>
          <button class="button primary" type="submit" disabled={offline || busy || !tagPseudonym}>
            {t("controls.startTarget", { connector: connectorId })}
          </button>
        </form>

        {/* Stopping only appears while something charges; otherwise it would be an empty tile. */}
        {activeSessions.length > 0 && (
          <div class="command-form">
            <h2>{t("controls.stopTitle")}</h2>
            {activeSessions.map((session) => (
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
                {t("controls.stopSession", {
                  connector: session.connectorId,
                  id: session.transactionId,
                })}
              </button>
            ))}
          </div>
        )}

        <form
          class="command-form"
          aria-label={t("controls.availability")}
          onSubmit={(event) => {
            event.preventDefault();
            void runStationCommand({
              availability: "Operative",
              connectorId: availabilityConnector,
              type: "ChangeAvailability",
            });
          }}
        >
          <h2>{t("controls.availability")}</h2>
          <ConnectorSelect
            ids={connectorIds}
            value={availabilityConnector}
            onChange={setAvailabilityConnector}
          />
          {availabilityStatus === "Available" ? (
            <p class="muted">{t("controls.isAvailable", { connector: availabilityConnector })}</p>
          ) : (
            <>
              {availabilityStatus && (
                <p class="muted">
                  {t("controls.availableNow", {
                    status: connectorStatusLabel(availabilityStatus),
                  })}
                </p>
              )}
              <button class="button secondary" type="submit" disabled={offline || busy}>
                {t("controls.makeAvailable", { connector: availabilityConnector })}
              </button>
            </>
          )}
        </form>
      </div>

      <details class="command-maintenance">
        <summary>{t("controls.maintenance")}</summary>
        <div class="command-grid">
          <form
            class="command-form guarded"
            aria-label={t("controls.unlockTitle", { connector: unlockConnector })}
            onSubmit={(event) => {
              event.preventDefault();
              void runStationCommand({
                confirmation: unlockConfirmation,
                connectorId: unlockConnector,
                type: "UnlockConnector",
              }).then((done) => done && setUnlockConfirmation(""));
            }}
          >
            <h2>{t("controls.unlockTitle", { connector: unlockConnector })}</h2>
            <p class="fine-print">{t("controls.unlockHint")}</p>
            <ConnectorSelect
              ids={connectorIds}
              value={unlockConnector}
              onChange={(id) => {
                setUnlockConnector(id);
                setUnlockConfirmation("");
              }}
            />
            <label class="confirmation-field">
              {t("common.typePhrase")}
              <span class="phrase" lang="en">
                {STATION_UNLOCK_PHRASE}
              </span>
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
              {t("controls.unlock")}
            </button>
          </form>

          <form
            class="command-form guarded"
            aria-label={t("controls.restartTitle")}
            onSubmit={(event) => {
              event.preventDefault();
              void runStationCommand({
                confirmation: resetConfirmation,
                resetType,
                type: "Reset",
              }).then((done) => done && setResetConfirmation(""));
            }}
          >
            <h2>{t("controls.restartTitle")}</h2>
            <label>
              {t("controls.restartType")}
              <select
                value={resetType}
                onChange={(event) => setResetType(event.currentTarget.value as "Hard" | "Soft")}
              >
                <option value="Soft">{t("controls.soft")}</option>
                <option value="Hard">{t("controls.hard")}</option>
              </select>
            </label>
            <label class="confirmation-field">
              {t("common.typePhrase")}
              <span class="phrase" lang="en">
                {STATION_RESET_PHRASE}
              </span>
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
              {t("controls.restart")}
            </button>
          </form>
        </div>
      </details>

      <h2 class="subhead">{t("controls.history")}</h2>
      <p class="panel-intro">{t("controls.historyIntro")}</p>
      <CommandHistory commands={current.commands} />
    </section>
  );
}

function ConnectorSelect({
  ids,
  value,
  onChange,
}: {
  ids: readonly number[];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <label>
      {t("controls.connector")}
      <select value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {ids.map((id) => (
          <option key={id} value={id}>
            {t("station.connector", { id })}
          </option>
        ))}
      </select>
    </label>
  );
}

const COMMAND_STATE_KEYS: Readonly<Record<StationCommandRecord["state"], MessageKey>> = {
  accepted: "command.state.accepted",
  failed: "command.state.failed",
  pending: "command.state.pending",
  rejected: "command.state.rejected",
  uncertain: "command.state.uncertain",
};

function CommandHistory({ commands }: { commands: readonly StationCommandRecord[] }) {
  if (!commands.length) return <p class="empty-state">{t("controls.historyEmpty")}</p>;
  return (
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t("controls.col.requested")}</th>
            <th>{t("controls.col.command")}</th>
            <th>{t("controls.col.answer")}</th>
            <th>{t("controls.col.observed")}</th>
          </tr>
        </thead>
        <tbody>
          {commands.map((command) => (
            <tr key={command.commandId}>
              <td class="nowrap">{formatDate(command.requestedAt)}</td>
              <td>
                {stationCommandLabel(command.type)}
                {command.resetType ? ` (${command.resetType})` : ""}
                {command.transactionId !== null ? ` #${command.transactionId}` : ""}
                {command.connectorId !== null && command.type !== "RemoteStopTransaction"
                  ? `, ${t("station.connector", { id: command.connectorId })}`
                  : ""}
              </td>
              <td>
                <span class={`table-status command-${command.state}`}>
                  {t(COMMAND_STATE_KEYS[command.state])}
                </span>
                {command.status && command.status.toLowerCase() !== command.state
                  ? ` ${command.status}`
                  : ""}
              </td>
              <td>
                {command.observed ??
                  (command.state === "accepted" ? t("controls.notObserved") : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Technical details                                                   */
/* ------------------------------------------------------------------ */

function DetailsTab({
  snapshot: current,
  onEdit,
}: {
  snapshot: OwnerSnapshot;
  onEdit: (() => void) | null;
}) {
  const station = current.station;
  return (
    <section class="panel glass station-panel" aria-labelledby="details-title">
      <header class="panel-head">
        <h2 id="details-title">{t("details.title")}</h2>
        {onEdit && (
          <button class="button secondary compact" type="button" onClick={onEdit}>
            {t(station.label === station.id ? "stations.nameItShort" : "stations.edit")}
          </button>
        )}
      </header>
      <dl class="facts">
        <Fact
          label={t("stations.field.name")}
          value={
            station.label === station.id ? (
              <span class="muted">{t("details.notNamed")}</span>
            ) : (
              station.label
            )
          }
        />
        <Fact label={t("stations.field.site")} value={station.site} />
        <Fact label={t("stations.driver")} value={station.driver ?? t("people.nobody")} />
        <Fact label={t("details.chargePointId")} value={station.id} mono />
        <Fact
          label={t("station.hardware")}
          value={
            station.boot
              ? `${station.boot.vendor} ${station.boot.model}`
              : t("station.awaitingBoot")
          }
        />
        <Fact label={t("details.firmware")} value={station.boot?.firmwareVersion ?? "—"} />
        <Fact label={t("station.connectedSince")} value={formatDate(station.connectedAt)} />
      </dl>
      <div class="connector-list">
        {station.connectors.length ? (
          station.connectors.map((connector) => (
            <div class="connector-row" key={connector.connectorId}>
              <span class={`connector-dot ${connectorTone(connector.status)}`} aria-hidden="true" />
              <span>{t("station.connector", { id: connector.connectorId })}</span>
              <strong>{connectorStatusLabel(connector.status)}</strong>
              {connectorStatusLabel(connector.status) !== connector.status && (
                <small class="mono">{connector.status}</small>
              )}
              {connector.errorCode && connector.errorCode !== "NoError" && (
                <small>{connector.errorCode}</small>
              )}
            </div>
          ))
        ) : (
          <p class="muted">{t("station.noConnectors")}</p>
        )}
      </div>
      <p class="fine-print">{t("details.namesNote")}</p>
    </section>
  );
}

function DetailsWithConnection(props: { snapshot: OwnerSnapshot; onEdit: (() => void) | null }) {
  return (
    <div class="section-stack">
      <DetailsTab {...props} />
      <ConnectChargerPanel snapshot={props.snapshot} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared access                                                       */
/* ------------------------------------------------------------------ */

const ROLE_KEYS: Readonly<Record<DelegateRole, { label: MessageKey; scope: MessageKey }>> = {
  employer: { label: "sharing.role.employer", scope: "sharing.scope.employer" },
  "energy-provider": { label: "sharing.role.energy", scope: "sharing.scope.energy" },
  installer: { label: "sharing.role.installer", scope: "sharing.scope.installer" },
  driver: { label: "fleet.role.driver", scope: "fleet.scope.driver" },
  finance: { label: "fleet.role.finance", scope: "fleet.scope.finance" },
};

function SharingTab({ grants }: { grants: readonly DelegateGrantSummary[] }) {
  const [role, setRole] = useState<DelegateRole>("installer");
  const [lifetimeDays, setLifetimeDays] = useState("1");
  return (
    <div class="section-stack">
      <p class="lede">{t("sharing.lede")}</p>
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
            <h2>{t("sharing.issueTitle")}</h2>
          </header>
          <label>
            {t("sharing.role")}
            <select
              value={role}
              onChange={(event) => setRole(event.currentTarget.value as DelegateRole)}
            >
              {(Object.keys(ROLE_KEYS) as DelegateRole[])
                .filter((candidate) => candidate !== "finance")
                .map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {t(ROLE_KEYS[candidate].label)}
                  </option>
                ))}
            </select>
          </label>
          <p class="scope-note">
            <span>{t("sharing.canRead")}</span>
            {t(ROLE_KEYS[role].scope)}
          </p>
          <label>
            {t("sharing.expires")}
            <select
              value={lifetimeDays}
              onChange={(event) => setLifetimeDays(event.currentTarget.value)}
            >
              {["1", "7", "30", "90"].map((days) => (
                <option key={days} value={days}>
                  {t(days === "1" ? "sharing.day" : "sharing.days", { count: days })}
                </option>
              ))}
            </select>
          </label>
          <button class="button primary" type="submit" disabled={action.value !== null}>
            {action.value === "delegate-issue" ? t("sharing.issuing") : t("sharing.issue")}
          </button>
        </form>

        <section class="panel glass" aria-labelledby="grants-title">
          <header class="panel-head">
            <h2 id="grants-title">{t("sharing.current")}</h2>
          </header>
          {issuedDelegate.value && (
            <div class="delegate-secret" role="status">
              <div>
                <strong>{t("sharing.copyNow")}</strong>
                <p>{t("sharing.copyNowBody")}</p>
              </div>
              <code>{issuedDelegate.value.token}</code>
              <button
                class="text-button"
                type="button"
                onClick={() => {
                  issuedDelegate.value = null;
                }}
              >
                {t("sharing.dismiss")}
              </button>
            </div>
          )}
          {grants.length ? (
            <ul class="delegation-list">
              {grants.map((grant) => (
                <li class="delegate-row" key={grant.grantId}>
                  <div>
                    <strong>{t(ROLE_KEYS[grant.role].label)}</strong>
                    <small>
                      {grant.scopes.join(", ")}; <code>{grant.tokenHint}</code>
                    </small>
                  </div>
                  <div class="delegate-row-actions">
                    <span class={`state-chip ${grant.status === "active" ? "ok" : "idle"}`}>
                      {t(
                        grant.status === "active"
                          ? "sharing.status.active"
                          : grant.status === "revoked"
                            ? "sharing.status.revoked"
                            : "sharing.status.expired",
                      )}
                    </span>
                    <small>{t("sharing.expiresOn", { date: formatDate(grant.expiresAt) })}</small>
                    {grant.status === "active" && (
                      <button
                        class="button danger-ghost compact"
                        type="button"
                        disabled={action.value !== null}
                        onClick={() => {
                          if (window.confirm(t("sharing.revokeConfirm"))) {
                            void runDelegateRevoke(grant.grantId);
                          }
                        }}
                      >
                        {t("sharing.revoke")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p class="empty-state">{t("sharing.none")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

function EvidenceTab({ snapshot: current }: { snapshot: OwnerSnapshot }) {
  return (
    <div class="section-stack">
      <div class="with-actions page-head">
        <p class="lede">{t("evidence.lede")}</p>
        <button
          class="button secondary"
          type="button"
          disabled={action.value !== null}
          onClick={() => void runContinuityExport()}
        >
          {action.value === "export" ? t("evidence.exporting") : t("evidence.export")}
        </button>
      </div>
      {current.evidenceHistory.mode === "compacted-operational" && (
        <div lang="en">
          <CompactedHistoryNotice snapshot={current} />
        </div>
      )}
      <section class="panel glass" aria-labelledby="ledger-title">
        <header class="panel-head">
          <h2 id="ledger-title">{t("evidence.latest")}</h2>
          <span class="legend">
            <span class="event-direction station-to-csms" aria-hidden="true" />{" "}
            {t("evidence.fromCharger")}
            <span class="event-direction csms-to-station" aria-hidden="true" />{" "}
            {t("evidence.toCharger")}
            <span class="event-direction system" aria-hidden="true" /> {t("evidence.system")}
          </span>
        </header>
        <EvidenceTimeline events={current.evidence} />
      </section>
    </div>
  );
}

const EVENT_DIRECTION_KEYS: Readonly<Record<EvidenceSummary["direction"], MessageKey>> = {
  "csms-to-station": "evidence.toCharger",
  "station-to-csms": "evidence.fromCharger",
  system: "evidence.system",
};

/** Event names are protocol identifiers and stay as recorded. */
function EvidenceTimeline({ events }: { events: readonly EvidenceSummary[] }) {
  if (!events.length) return <p class="empty-state">{t("evidence.empty")}</p>;
  return (
    <ol class="timeline">
      {events.map((event) => (
        <li key={event.eventId}>
          <span class={`event-direction ${event.direction}`} aria-hidden="true" />
          <div>
            <strong class="mono">{event.message}</strong>
            <small>
              {t(EVENT_DIRECTION_KEYS[event.direction])}
              {event.carriedFromRecordHash ? `, ${t("evidence.carried")}` : ""}
            </small>
          </div>
          <time dateTime={event.at}>{formatDate(event.at)}</time>
        </li>
      ))}
    </ol>
  );
}
