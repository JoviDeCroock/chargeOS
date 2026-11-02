import { useEffect, useState } from "preact/hooks";

import type { ChargeSession, ConsoleProfile, MonthlyUsage } from "../shared/contracts.js";
import {
  monthlyUsage,
  monthOf,
  recentMonths,
  sessionsInMonth,
  usageByCard,
} from "../shared/usage.js";
import {
  chosenModules,
  enabledModules,
  MODULE_INFO,
  OPTIONAL_MODULES,
  PROFILE_DEFAULT_MODULES,
  resetModules,
  setModuleEnabled,
} from "./console-modules.js";
import {
  browserTimeZone,
  downloadUsageCsv,
  refreshUsage,
  usageLoading,
  usageReport,
} from "./model.js";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatKwh(wh: number): string {
  const kwh = wh / 1_000;
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: kwh >= 100 ? 0 : 1,
    minimumFractionDigits: kwh >= 100 ? 0 : 1,
  }).format(kwh)} kWh`;
}

function monthLabel(month: string, style: "long" | "short" | "narrow" = "long"): string {
  // Mid-month noon UTC is the same calendar month in every time zone.
  const date = new Date(`${month}-15T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    month: style,
    timeZone: "UTC",
    ...(style === "long" ? { year: "numeric" } : {}),
  }).format(date);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function shortCard(pseudonym: string): string {
  return pseudonym.length > 14 ? `${pseudonym.slice(0, 12)}…` : pseudonym;
}

/* ------------------------------------------------------------------ */
/* Per-charger usage on the overview                                   */
/* ------------------------------------------------------------------ */

export function UsagePanel({
  ownerCardPseudonyms,
  sessions,
  now = new Date(),
}: {
  ownerCardPseudonyms: readonly string[];
  sessions: readonly ChargeSession[];
  now?: Date;
}) {
  const timeZone = browserTimeZone();
  const months = recentMonths(now, timeZone, 12);
  const series = monthlyUsage(sessions, months, timeZone);
  const thisMonth = series.at(-1);
  const lastMonth = series.at(-2);
  const thisMonthSessions = thisMonth ? sessionsInMonth(sessions, thisMonth.month, timeZone) : [];
  const cards = usageByCard(thisMonthSessions);
  const ownerCards = new Set(ownerCardPseudonyms);
  const yearWh = series.reduce((total, { energyWh }) => total + energyWh, 0);
  const openSessions = thisMonthSessions.filter(({ status }) => status === "active").length;

  return (
    <section class="panel glass usage-panel" aria-labelledby="usage-title">
      <header class="panel-head">
        <div>
          <h2 id="usage-title">Your charging</h2>
          <p class="panel-sub">
            Energy the charger reported, by the month each session started ({timeZone}).
          </p>
        </div>
      </header>

      <div class="usage-tiles">
        <UsageTile
          label="This month"
          value={formatKwh(thisMonth?.energyWh ?? 0)}
          detail={`${plural(thisMonth?.sessionCount ?? 0, "session")}${openSessions ? `, ${openSessions} still charging` : ""}`}
        />
        <UsageTile
          label={lastMonth ? monthLabel(lastMonth.month) : "Last month"}
          value={formatKwh(lastMonth?.energyWh ?? 0)}
          detail={plural(lastMonth?.sessionCount ?? 0, "session")}
        />
        <UsageTile
          label="Last 12 months"
          value={formatKwh(yearWh)}
          detail={plural(
            series.reduce((total, { sessionCount }) => total + sessionCount, 0),
            "session",
          )}
        />
      </div>

      {sessions.length === 0 ? (
        <p class="empty-state">
          No charging sessions yet. Usage appears here after the first card or remote start.
        </p>
      ) : (
        <>
          <MonthlyColumns series={series} />
          {cards.length > 1 && (
            <div class="usage-cards">
              <h3>This month by card</h3>
              <ul>
                {cards.map((card) => (
                  <li key={card.tagPseudonym}>
                    <code title={card.tagPseudonym}>{shortCard(card.tagPseudonym)}</code>
                    <span>{ownerCards.has(card.tagPseudonym) ? "Owner card" : "Other card"}</span>
                    <strong>{formatKwh(card.energyWh)}</strong>
                    <small>{plural(card.sessionCount, "session")}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p class="fine-print">
        Reported by the charger's own meter. Sessions still in progress count once they stop. This
        is a usage overview, not a bill or an approved reimbursement.
      </p>
    </section>
  );
}

function UsageTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div class="usage-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Single-series monthly columns with hover/focus values and a table view. */
export function MonthlyColumns({ series }: { series: readonly MonthlyUsage[] }) {
  const [showTable, setShowTable] = useState(false);
  const maxKwh = niceCeiling(Math.max(...series.map(({ energyWh }) => energyWh / 1_000), 0));
  const current = series.at(-1);
  return (
    <figure class="usage-chart">
      <figcaption>
        <span>Energy per month, kWh</span>
        <button
          class="link-button"
          type="button"
          aria-pressed={showTable}
          onClick={() => setShowTable(!showTable)}
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </figcaption>
      {showTable ? (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th class="numeric">Sessions</th>
                <th class="numeric">Energy</th>
              </tr>
            </thead>
            <tbody>
              {series.map((bucket) => (
                <tr key={bucket.month}>
                  <td>{monthLabel(bucket.month)}</td>
                  <td class="numeric">{bucket.sessionCount}</td>
                  <td class="numeric">{formatKwh(bucket.energyWh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="usage-plot">
          <div class="usage-axis" aria-hidden="true">
            <span>{maxKwh}</span>
            <span>{maxKwh / 2}</span>
            <span>0</span>
          </div>
          <ol class="usage-columns" aria-label="Energy per month">
            {series.map((bucket) => {
              const height = (bucket.energyWh / 1_000 / maxKwh) * 100;
              const label = `${monthLabel(bucket.month)}: ${formatKwh(bucket.energyWh)}, ${plural(bucket.sessionCount, "session")}`;
              const isCurrent = bucket.month === current?.month;
              return (
                <li key={bucket.month} class={isCurrent ? "current" : undefined}>
                  <span class="usage-slot" tabIndex={0} aria-label={label}>
                    {isCurrent && bucket.energyWh > 0 && (
                      <span class="usage-cap" aria-hidden="true">
                        {formatKwh(bucket.energyWh)}
                      </span>
                    )}
                    <span
                      class="usage-column"
                      style={{ height: `${bucket.energyWh > 0 ? Math.max(height, 1.5) : 0}%` }}
                    />
                    <span class="usage-tip" role="tooltip">
                      <strong>{monthLabel(bucket.month)}</strong>
                      {formatKwh(bucket.energyWh)}
                      <small>{plural(bucket.sessionCount, "session")}</small>
                    </span>
                  </span>
                  <span class="usage-month" aria-hidden="true">
                    {monthLabel(bucket.month, "narrow")}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Usage report across chargers (company profile, or several chargers) */
/* ------------------------------------------------------------------ */

export function UsageReportSection({ profile }: { profile: ConsoleProfile }) {
  const timeZone = browserTimeZone();
  const [month, setMonth] = useState(() => monthOf(new Date().toISOString(), timeZone) ?? "");
  useEffect(() => {
    if (month) void refreshUsage(month);
  }, [month]);
  const report = usageReport.value?.month === month ? usageReport.value : null;
  const hasDrivers = Boolean(report?.drivers.some(({ driver }) => driver !== null));

  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>{profile === "company" ? "Usage by driver" : "Usage report"}</h1>
        <p class="lede">
          {profile === "company"
            ? "Energy recorded on every charger this server manages, grouped by the driver each charger is assigned to. Use the export for reimbursement or payroll review."
            : "Energy recorded on every charger you manage, month by month."}
        </p>
      </header>

      <section class="panel glass usage-report" aria-labelledby="usage-report-title">
        <header class="panel-head usage-report-head">
          <h2 id="usage-report-title">{month ? monthLabel(month) : "Month"}</h2>
          <div class="usage-report-actions">
            <label class="usage-month-field">
              <span>Month</span>
              <input
                type="month"
                value={month}
                max={monthOf(new Date().toISOString(), timeZone) ?? undefined}
                onChange={(event) => setMonth(event.currentTarget.value)}
              />
            </label>
            <button
              class="button secondary"
              type="button"
              disabled={!report || report.totals.sessionCount === 0}
              onClick={() => report && downloadUsageCsv(report)}
            >
              Download CSV
            </button>
          </div>
        </header>

        {!report ? (
          <p role="status">{usageLoading.value ? "Loading usage…" : "No report loaded."}</p>
        ) : (
          <>
            <div class="usage-tiles">
              <UsageTile
                label="Energy"
                value={formatKwh(report.totals.energyWh)}
                detail={plural(report.totals.sessionCount, "session")}
              />
              <UsageTile
                label="Chargers"
                value={String(report.stations.length)}
                detail={`${report.stations.filter(({ sessionCount }) => sessionCount > 0).length} with sessions`}
              />
              {hasDrivers && (
                <UsageTile
                  label="Drivers"
                  value={String(report.drivers.filter(({ driver }) => driver !== null).length)}
                  detail="assigned to chargers"
                />
              )}
            </div>

            {(report.totals.openSessions > 0 || report.totals.conflictSessions > 0) && (
              <div class="inline-alert warn" role="status">
                {report.totals.openSessions > 0 &&
                  `${plural(report.totals.openSessions, "session")} still charging; their energy counts once they stop. `}
                {report.totals.conflictSessions > 0 &&
                  `${plural(report.totals.conflictSessions, "session")} reported conflicting stop values; the first reported value is used and the row is marked "conflict" in the export.`}
              </div>
            )}

            {hasDrivers && (
              <div class="table-scroll">
                <table aria-label="Usage by driver">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Chargers</th>
                      <th class="numeric">Sessions</th>
                      <th class="numeric">Energy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.drivers.map((row) => (
                      <tr key={row.driver ?? "unassigned"}>
                        <td>{row.driver ?? <span class="muted">Unassigned</span>}</td>
                        <td>
                          {row.stationIds
                            .map(
                              (id) => report.stations.find((station) => station.id === id)?.label,
                            )
                            .join(", ")}
                        </td>
                        <td class="numeric">{row.sessionCount}</td>
                        <td class="numeric">{formatKwh(row.energyWh)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div class="table-scroll">
              <table aria-label="Usage by charger">
                <thead>
                  <tr>
                    <th>Charger</th>
                    <th>Site</th>
                    {hasDrivers && <th>Driver</th>}
                    <th class="numeric">Sessions</th>
                    <th class="numeric">Energy</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stations.map((station) => (
                    <tr key={station.id}>
                      <td>
                        <strong>{station.label}</strong>
                      </td>
                      <td>{station.site}</td>
                      {hasDrivers && (
                        <td>{station.driver ?? <span class="muted">Unassigned</span>}</td>
                      )}
                      <td class="numeric">{station.sessionCount}</td>
                      <td class="numeric">{formatKwh(station.energyWh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="fine-print">
              Months follow {report.timeZone}; a session belongs to the month it started. Figures
              come from each charger's own meter reports. The export lists card pseudonyms, never
              raw RFID numbers, and is not an approved reimbursement statement.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Console settings                                                    */
/* ------------------------------------------------------------------ */

export function ConsoleSettingsSection({ profile }: { profile: ConsoleProfile }) {
  const enabled = enabledModules(profile);
  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>Console settings</h1>
        <p class="lede">
          Choose what this console shows. Charging, cards and usage are always here; everything else
          is optional.
        </p>
      </header>

      <section class="panel glass" aria-labelledby="profile-title">
        <header class="panel-head">
          <h2 id="profile-title">Profile</h2>
          <span class="state-chip idle">{profile === "company" ? "Company" : "Personal"}</span>
        </header>
        <p>
          {profile === "company"
            ? "Arranged for an organization that runs chargers for its drivers: usage is reported per driver and can be exported."
            : "Arranged for a person with their own charger: the overview leads with how much you charge."}
        </p>
        <p class="fine-print">
          The operator sets the profile with <code>CHARGEOS_PROFILE</code> (<code>personal</code> or{" "}
          <code>company</code>) when the server starts.
        </p>
      </section>

      <section class="panel glass" aria-labelledby="modules-title">
        <header class="panel-head">
          <div>
            <h2 id="modules-title">Optional modules</h2>
            <p class="panel-sub">
              {chosenModules.value === null
                ? "Following the profile defaults."
                : "Using your choice in this browser."}
            </p>
          </div>
          {chosenModules.value !== null && (
            <button class="button secondary compact" type="button" onClick={resetModules}>
              Use profile defaults
            </button>
          )}
        </header>
        <ul class="module-list">
          {OPTIONAL_MODULES.map((module) => (
            <li key={module}>
              <label>
                <input
                  type="checkbox"
                  checked={enabled.has(module)}
                  onChange={(event) =>
                    setModuleEnabled(profile, module, event.currentTarget.checked)
                  }
                />
                <span>
                  <strong>{MODULE_INFO[module].label}</strong>
                  <small>
                    {MODULE_INFO[module].description}
                    {PROFILE_DEFAULT_MODULES[profile].includes(module) ? " On by default." : ""}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p class="fine-print">
          Hiding a module only changes this browser's view. It does not switch off owner cards,
          offline charging, safety checks or anything already recorded. A hidden module reappears in
          the menu while it needs your attention.
        </p>
      </section>
    </div>
  );
}
