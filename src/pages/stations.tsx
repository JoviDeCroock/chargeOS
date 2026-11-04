import { useState } from "preact/hooks";

import type { FleetSnapshot, FleetStationSummary } from "../../shared/contracts.js";
import { DIRECTORY_NAME_MAX_LENGTH, type OwnerDirectory } from "../../shared/directory.js";
import { formatDate, formatKwh, t, tn, type MessageKey } from "../i18n/index.js";
import { action, runSaveStation } from "../model.js";
import { closeRowMenu, Dialog, PageHead, personName, PersonSelect } from "../ui.js";
import { runSetOwnership, setupSheet, stationRegistry } from "../fleet-model.js";
import type { Route } from "../routes.js";
import { FleetSyncDialog } from "./fleet-sync.js";
import { AddChargerDialog, RetireChargerDialog, SetupSheetDialog } from "./fleet-setup.js";

const ATTENTION_KEYS: Readonly<Record<FleetStationSummary["attention"][number], MessageKey>> = {
  "authorization-pending": "attention.authorization-pending",
  "continuity-unproven": "attention.continuity-unproven",
  "evidence-conflict": "attention.evidence-conflict",
  "migration-action": "attention.migration-action",
  "no-cards": "attention.no-cards",
  offline: "attention.offline",
};

export function StationsPage({
  fleet,
  directory,
  onOpen,
  showSwitching,
}: {
  fleet: FleetSnapshot;
  directory: OwnerDirectory | null;
  onOpen: (stationId: string, route?: Route) => void;
  /** The routine "next switching step" signal only matters to owners who use that module. */
  showSwitching: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reviewingSync, setReviewingSync] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  const registry = stationRegistry.value;
  const firstStationId = fleet.stations[0]?.id;
  return (
    <div class="section-stack">
      <PageHead
        title={t("stations.title")}
        lede={t("stations.lede")}
        actions={
          <>
            {fleet.stations.length > 1 && (
              <button
                class="button secondary"
                type="button"
                disabled={action.value !== null}
                onClick={() => setReviewingSync(true)}
              >
                {t("fleet.cards.syncAll")}
              </button>
            )}
            {registry && (
              <button class="button secondary" type="button" onClick={() => setAdding(true)}>
                {t("fleet.add.button")}
              </button>
            )}
          </>
        }
      />

      {fleet.totals.stations > 1 && (
        <section class="fleet-metrics glass" aria-label={t("stations.summary")}>
          <Metric label={t("stations.metric.chargers")} value={String(fleet.totals.stations)} />
          <Metric
            label={t("stations.metric.connected")}
            value={`${fleet.totals.connected} / ${fleet.totals.stations}`}
          />
          <Metric
            label={t("stations.metric.charging")}
            value={String(
              fleet.stations.filter(({ chargingStatus }) => chargingStatus === "charging").length,
            )}
          />
          <Metric
            label={t("stations.metric.unknown")}
            value={String(
              fleet.stations.filter(
                ({ chargingStatus }) => !chargingStatus || chargingStatus === "unknown",
              ).length,
            )}
          />
          <Metric label={t("stations.metric.energy")} value={formatKwh(fleet.totals.energyWh)} />
        </section>
      )}

      <ul class="entity-grid" aria-label={t("stations.title")}>
        {fleet.stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            directory={directory}
            attention={station.attention.filter(
              (item) => showSwitching || item !== "migration-action",
            )}
            onOpen={(route) => onOpen(station.id, route)}
            onEdit={directory?.writable ? () => setEditing(station.id) : null}
            onRetire={
              registry && station.id !== firstStationId ? () => setRetiring(station.id) : null
            }
          />
        ))}
      </ul>

      {registry && registry.retired.length > 0 && (
        <details class="retired-list">
          <summary>{tn("fleet.retired.count", registry.retired.length)}</summary>
          <ul>
            {registry.retired.map((station) => (
              <li key={station.id}>
                <code>{station.id}</code>
                <span class="muted">
                  {t("fleet.retired.on", { date: formatDate(station.retiredAt) })}
                </span>
              </li>
            ))}
          </ul>
          <p class="fine-print">{t("fleet.retired.note")}</p>
        </details>
      )}

      <p class="fine-print">{t("stations.independence")}</p>

      {reviewingSync && <FleetSyncDialog fleet={fleet} onClose={() => setReviewingSync(false)} />}

      {adding && (
        <AddChargerDialog
          directory={directory}
          onClose={() => setAdding(false)}
          onAdded={(stationId) => {
            setAdding(false);
            setAdded(stationId);
          }}
        />
      )}
      {added && setupSheet.value && (
        <SetupSheetDialog
          label={fleet.stations.find(({ id }) => id === added)?.label ?? added}
          onClose={() => {
            setAdded(null);
            onOpen(added);
          }}
        />
      )}
      {retiring && (
        <RetireChargerDialog
          stationId={retiring}
          label={fleet.stations.find(({ id }) => id === retiring)?.label ?? retiring}
          onClose={() => setRetiring(null)}
        />
      )}
      {editing && directory && (
        <StationEditDialog
          stationId={editing}
          directory={directory}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StationCard({
  station,
  directory,
  attention,
  onOpen,
  onEdit,
  onRetire,
}: {
  station: FleetStationSummary;
  directory: OwnerDirectory | null;
  attention: FleetStationSummary["attention"];
  onOpen: (route?: Route) => void;
  onEdit: (() => void) | null;
  onRetire: (() => void) | null;
}) {
  const cards = directory?.cards.filter(({ stationId }) => stationId === station.id) ?? [];
  const charging = station.connected && station.chargingStatus === "charging";
  const state = charging ? "live" : station.connected ? "ok" : "idle";
  let next: { label: MessageKey; route?: Route } =
    station.setup === "stopped"
      ? { label: "stations.resolveSetup" }
      : !station.connected
        ? { label: "stations.connectionHelp" }
        : station.registeredCardCount === 0
          ? { label: "overview.cardDetails", route: { page: "cards" } }
          : station.readiness !== "ready"
            ? { label: "overview.offlineDetails", route: { page: "advanced", tab: "offline" } }
            : station.authorizationState !== "current"
              ? { label: "overview.cardDetails", route: { page: "cards" } }
              : { label: "stations.open" };
  const settingUp = station.setup !== undefined && station.setup !== "active";
  // While setup runs, the overview checklist is the single next step for this charger.
  if (settingUp && station.setup !== "stopped" && station.connected) {
    next = { label: "stations.continueSetup" };
  }
  return (
    <li class={`entity-card glass station-card ${state}`}>
      <header class="entity-head">
        <span class={`entity-icon station ${state}`} aria-hidden="true" />
        <div class="entity-title">
          <h2>{station.label}</h2>
          <span>{station.site}</span>
        </div>
        <span class={`state-chip ${state === "live" ? "live" : state === "ok" ? "ok" : "idle"}`}>
          {t(station.connected ? "station.connected" : "station.offline")}
        </span>
      </header>
      {(station.setup === "stopped" || station.ownership) && (
        <div class="station-badges">
          {station.setup === "stopped" && (
            <span class={`label-chip setup ${station.setup}`}>
              {t(`fleet.setup.state.${station.setup}` as MessageKey)}
            </span>
          )}
          {station.ownership && (
            <span class={`label-chip ${station.ownership}`}>
              {t(`fleet.ownership.${station.ownership}Short` as MessageKey)}
            </span>
          )}
        </div>
      )}
      <dl class="entity-facts">
        <div>
          <dt>{t("stations.chargingShort")}</dt>
          <dd>
            {t(
              charging
                ? "stations.chargingNow"
                : station.connected && station.chargingStatus === "idle"
                  ? "overview.notCharging"
                  : "overview.chargingUnknown",
            )}
          </dd>
        </div>
        <div>
          <dt>{t("stations.driver")}</dt>
          <dd>{station.driver ?? <span class="muted">{t("people.nobody")}</span>}</dd>
        </div>
        <div>
          <dt>{t("nav.cards")}</dt>
          <dd>
            {cards.length
              ? cards
                  .map(
                    (card) =>
                      card.name ?? personName(directory, card.holderPersonId) ?? t("cards.unnamed"),
                  )
                  .join(", ")
              : station.registeredCardCount === undefined
                ? t("overview.chargingUnknown")
                : tn("cards.count", station.registeredCardCount)}
          </dd>
        </div>
        <div>
          <dt>{t("stations.energy")}</dt>
          <dd>{formatKwh(station.energyWh)}</dd>
        </div>
        <div>
          <dt>{t("stations.lastSession")}</dt>
          <dd>{formatDate(station.lastSessionAt)}</dd>
        </div>
      </dl>
      {attention.length > 0 && (
        <ul class="attention-list" aria-label={t("stations.attention")}>
          {attention.map((item) => (
            <li key={item}>
              <span class="status-dot warn" aria-hidden="true" />
              {t(ATTENTION_KEYS[item])}
            </li>
          ))}
        </ul>
      )}
      <footer class="entity-actions">
        <button class="button primary compact" type="button" onClick={() => onOpen(next.route)}>
          {t(next.label)}
        </button>
        {next.route && (
          <button class="button ghost compact" type="button" onClick={() => onOpen()}>
            {t("stations.openOverview")}
          </button>
        )}
        {onEdit && (
          <button class="button secondary compact" type="button" onClick={onEdit}>
            {t("stations.edit")}
          </button>
        )}
        {onRetire && (
          <details class="row-menu">
            <summary class="button ghost compact">{t("fleet.cards.more")}</summary>
            <div class="row-menu-list glass" onClickCapture={closeRowMenu}>
              {(["company", "employee"] as const)
                .filter((value) => value !== station.ownership)
                .map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void runSetOwnership(station.id, value)}
                  >
                    {t(`fleet.ownership.mark.${value}` as MessageKey)}
                  </button>
                ))}
              <button type="button" class="danger" onClick={onRetire}>
                {t("fleet.retire.button")}
              </button>
            </div>
          </details>
        )}
      </footer>
    </li>
  );
}

export function StationEditDialog({
  stationId,
  directory,
  onClose,
}: {
  stationId: string;
  directory: OwnerDirectory;
  onClose: () => void;
}) {
  const station = directory.stations.find(({ id }) => id === stationId);
  const [label, setLabel] = useState(station?.label ?? "");
  const [site, setSite] = useState(station?.site ?? "");
  const [driver, setDriver] = useState<string | null>(station?.driverPersonId ?? null);
  if (!station) return null;
  const valid = label.trim().length > 0 && site.trim().length > 0;
  return (
    <Dialog title={t("stations.editTitle")} onClose={onClose}>
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSaveStation(stationId, { driverPersonId: driver, label, site }).then(
            (saved) => saved && onClose(),
          );
        }}
      >
        <label>
          {t("stations.field.name")}
          <input
            value={label}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            placeholder={t("stations.field.namePlaceholder")}
            onInput={(event) => setLabel(event.currentTarget.value)}
          />
        </label>
        <label>
          {t("stations.field.site")}
          <input
            value={site}
            maxLength={DIRECTORY_NAME_MAX_LENGTH}
            placeholder={t("stations.field.sitePlaceholder")}
            onInput={(event) => setSite(event.currentTarget.value)}
          />
        </label>
        <PersonSelect
          label={t("stations.field.driver")}
          value={driver}
          onChange={setDriver}
          people={directory.people}
        />
        <p class="field-hint">{t("stations.field.driverHint")}</p>
        <p class="field-hint">
          {t("stations.field.id")} <code>{station.id}</code>
        </p>
        <footer class="dialog-actions">
          <button class="button ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button class="button primary" type="submit" disabled={!valid || action.value !== null}>
            {t("common.save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div class="fleet-metric neutral">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
