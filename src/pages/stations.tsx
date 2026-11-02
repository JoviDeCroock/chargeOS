import { useState } from "preact/hooks";

import type { FleetSnapshot, FleetStationSummary } from "../../shared/contracts.js";
import { DIRECTORY_NAME_MAX_LENGTH, type OwnerDirectory } from "../../shared/directory.js";
import { formatDate, formatKwh, t, tn, type MessageKey } from "../i18n/index.js";
import { action, runSaveStation } from "../model.js";
import { Dialog, PageHead, PersonSelect, personName } from "../ui.js";

const ATTENTION_KEYS: Readonly<Record<FleetStationSummary["attention"][number], MessageKey>> = {
  "authorization-pending": "attention.authorization-pending",
  "continuity-unproven": "attention.continuity-unproven",
  "evidence-conflict": "attention.evidence-conflict",
  "migration-action": "attention.migration-action",
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
  onOpen: (stationId: string) => void;
  /** The routine "next switching step" signal only matters to owners who use that module. */
  showSwitching: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div class="section-stack">
      <PageHead title={t("stations.title")} lede={t("stations.lede")} />

      <section class="fleet-metrics glass" aria-label={t("stations.summary")}>
        <Metric label={t("stations.metric.chargers")} value={String(fleet.totals.stations)} />
        <Metric
          label={t("stations.metric.connected")}
          value={`${fleet.totals.connected} / ${fleet.totals.stations}`}
        />
        <Metric label={t("stations.metric.charging")} value={String(fleet.totals.activeSessions)} />
        <Metric label={t("stations.metric.energy")} value={formatKwh(fleet.totals.energyWh)} />
      </section>

      <ul class="entity-grid" aria-label={t("stations.title")}>
        {fleet.stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            directory={directory}
            attention={station.attention.filter(
              (item) => showSwitching || item !== "migration-action",
            )}
            onOpen={() => onOpen(station.id)}
            onEdit={directory?.writable ? () => setEditing(station.id) : null}
          />
        ))}
      </ul>

      <p class="fine-print">{t("stations.independence")}</p>

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
}: {
  station: FleetStationSummary;
  directory: OwnerDirectory | null;
  attention: FleetStationSummary["attention"];
  onOpen: () => void;
  onEdit: (() => void) | null;
}) {
  const cards = directory?.cards.filter(({ stationId }) => stationId === station.id) ?? [];
  const state = station.activeSessionCount ? "live" : station.connected ? "ok" : "idle";
  return (
    <li class={`entity-card glass station-card ${state}`}>
      <header class="entity-head">
        <span class={`entity-icon station ${state}`} aria-hidden="true" />
        <div class="entity-title">
          <h2>{station.label}</h2>
          <span>{station.site}</span>
        </div>
        <span class={`state-chip ${state === "live" ? "live" : state === "ok" ? "ok" : "idle"}`}>
          {station.activeSessionCount
            ? t("stations.chargingNow")
            : t(station.connected ? "stations.available" : "stations.offline")}
        </span>
      </header>
      <dl class="entity-facts">
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
              : tn("cards.count", 0)}
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
            <li key={item}>{t(ATTENTION_KEYS[item])}</li>
          ))}
        </ul>
      )}
      <footer class="entity-actions">
        <button class="button primary compact" type="button" onClick={onOpen}>
          {t("stations.open")}
        </button>
        {onEdit && (
          <button class="button secondary compact" type="button" onClick={onEdit}>
            {t("stations.edit")}
          </button>
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
