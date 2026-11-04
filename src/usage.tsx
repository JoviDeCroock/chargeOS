import { useEffect, useState } from "preact/hooks";

import type { ChargeSession, ConsoleProfile, MonthlyUsage } from "../shared/contracts.js";
import type { OwnerDirectory } from "../shared/directory.js";
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
  OPTIONAL_MODULES,
  PROFILE_DEFAULT_MODULES,
  resetModules,
  setModuleEnabled,
} from "./console-modules.js";
import {
  formatDate,
  formatKwh,
  LOCALE_NAMES,
  LOCALES,
  locale,
  monthLabel,
  setLocale,
  t,
  tn,
  type Locale,
  type MessageKey,
} from "./i18n/index.js";
import {
  browserTimeZone,
  downloadUsageCsv,
  refreshUsage,
  usageLoading,
  usageReport,
} from "./model.js";
import { cardLabel } from "./ui.js";

/* ------------------------------------------------------------------ */
/* Per-charger usage on the overview                                   */
/* ------------------------------------------------------------------ */

export function UsagePanel({
  sessions,
  stationId,
  directory,
  onSessions,
  now = new Date(),
}: {
  sessions: readonly ChargeSession[];
  stationId: string;
  directory: OwnerDirectory | null;
  /** Opens the full session list on the Sessions page. */
  onSessions?: () => void;
  now?: Date;
}) {
  const timeZone = browserTimeZone();
  const months = recentMonths(now, timeZone, 12);
  const series = monthlyUsage(sessions, months, timeZone);
  const thisMonth = series.at(-1);
  const lastMonth = series.at(-2);
  const thisMonthSessions = thisMonth ? sessionsInMonth(sessions, thisMonth.month, timeZone) : [];
  const cards = usageByCard(thisMonthSessions);
  const yearWh = series.reduce((total, { energyWh }) => total + energyWh, 0);
  const openSessions = thisMonthSessions.filter(({ status }) => status === "active").length;
  // Until an earlier month has charging, comparisons and a 12-month chart only repeat this month.
  const hasHistory = series.slice(0, -1).some(({ sessionCount }) => sessionCount > 0);
  const thisMonthDetail = `${tn("usage.sessions", thisMonth?.sessionCount ?? 0)}${openSessions ? `, ${tn("usage.stillCharging", openSessions)}` : ""}`;
  const lastSession = sessions.reduce<ChargeSession | null>(
    (latest, session) => (!latest || session.startedAt > latest.startedAt ? session : latest),
    null,
  );

  return (
    <section class="panel glass usage-panel" aria-labelledby="usage-title">
      <header class="panel-head">
        <div>
          <h2 id="usage-title">{t("usage.panelTitle")}</h2>
        </div>
      </header>

      {hasHistory ? (
        <div class="usage-tiles">
          <UsageTile
            label={t("usage.thisMonth")}
            value={formatKwh(thisMonth?.energyWh ?? 0)}
            detail={thisMonthDetail}
          />
          <UsageTile
            label={lastMonth ? monthLabel(lastMonth.month) : t("usage.lastMonth")}
            value={formatKwh(lastMonth?.energyWh ?? 0)}
            detail={tn("usage.sessions", lastMonth?.sessionCount ?? 0)}
          />
          <UsageTile
            label={t("usage.last12")}
            value={formatKwh(yearWh)}
            detail={tn(
              "usage.sessions",
              series.reduce((total, { sessionCount }) => total + sessionCount, 0),
            )}
          />
        </div>
      ) : (
        // One month of charging is one figure; comparisons would only repeat it.
        <div class="usage-summary-block">
          <p class="usage-summary">
            <strong>{formatKwh(thisMonth?.energyWh ?? 0)}</strong>
            <span>
              {t("usage.thisMonthLower")} · {thisMonthDetail}
            </span>
          </p>
          {lastSession && (
            <p class="usage-last">
              {t("usage.lastOn", { date: formatDate(lastSession.startedAt) })}
            </p>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <p class="empty-state">{t("usage.empty")}</p>
      ) : (
        <>
          {hasHistory && <MonthlyColumns series={series} />}
          {cards.length > 1 && (
            <div class="usage-cards">
              <h3>{t("usage.byCard")}</h3>
              <ul>
                {cards.map((card) => {
                  const label = cardLabel(directory, stationId, card.tagPseudonym);
                  return (
                    <li key={card.tagPseudonym}>
                      <span class="usage-card-name">{label.name}</span>
                      <span>{label.holder ?? ""}</span>
                      <strong>{formatKwh(card.energyWh)}</strong>
                      <small>{tn("usage.sessions", card.sessionCount)}</small>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
      {/* One quiet line; the counting rules stay one click away. */}
      <div class="usage-foot">
        <p class="fine-print">{t("usage.meterShort")}</p>
        <details class="usage-how">
          <summary>{t("usage.howCounted")}</summary>
          <p>
            {!hasHistory && sessions.length > 0 && <>{t("usage.historyHint")} </>}
            {t("usage.meterNoteZone", { timeZone })}
          </p>
        </details>
        {onSessions && sessions.length > 0 && (
          <a
            class="text-link"
            href="#/sessions"
            onClick={(event) => {
              event.preventDefault();
              onSessions();
            }}
          >
            {t("usage.allSessions")}
          </a>
        )}
      </div>
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
/** One quiet line above the session list: this month's energy and session count. */
export function MonthSummary({
  sessions,
  now = new Date(),
}: {
  sessions: readonly ChargeSession[];
  now?: Date;
}) {
  if (sessions.length === 0) return null;
  const timeZone = browserTimeZone();
  const thisMonth = monthlyUsage(sessions, recentMonths(now, timeZone, 1), timeZone).at(-1);
  return (
    <p class="usage-summary sessions-summary">
      <strong>{formatKwh(thisMonth?.energyWh ?? 0)}</strong>
      <span>
        {t("usage.thisMonthLower")} · {tn("usage.sessions", thisMonth?.sessionCount ?? 0)}
      </span>
    </p>
  );
}

export function MonthlyColumns({ series }: { series: readonly MonthlyUsage[] }) {
  const [showTable, setShowTable] = useState(false);
  const maxKwh = niceCeiling(Math.max(...series.map(({ energyWh }) => energyWh / 1_000), 0));
  const current = series.at(-1);
  return (
    <figure class="usage-chart">
      <figcaption>
        <span>{t("usage.chartTitle")}</span>
        <button
          class="link-button"
          type="button"
          aria-pressed={showTable}
          onClick={() => setShowTable(!showTable)}
        >
          {t(showTable ? "usage.showChart" : "usage.showTable")}
        </button>
      </figcaption>
      {showTable ? (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("usage.col.month")}</th>
                <th class="numeric">{t("usage.col.sessions")}</th>
                <th class="numeric">{t("usage.col.energy")}</th>
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
          <ol class="usage-columns" aria-label={t("usage.chartTitle")}>
            {series.map((bucket) => {
              const height = (bucket.energyWh / 1_000 / maxKwh) * 100;
              const label = `${monthLabel(bucket.month)}: ${formatKwh(bucket.energyWh)}, ${tn("usage.sessions", bucket.sessionCount)}`;
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
                      <small>{tn("usage.sessions", bucket.sessionCount)}</small>
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
        <h1>{t(profile === "company" ? "usage.titleCompany" : "usage.title")}</h1>
        <p class="lede">{t(profile === "company" ? "usage.ledeCompany" : "usage.lede")}</p>
      </header>

      <section class="panel glass usage-report" aria-labelledby="usage-report-title">
        <header class="panel-head usage-report-head">
          <h2 id="usage-report-title">{month ? monthLabel(month) : t("usage.col.month")}</h2>
          <div class="usage-report-actions">
            <label class="usage-month-field">
              <span>{t("usage.col.month")}</span>
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
              {t("usage.download")}
            </button>
          </div>
        </header>

        {!report ? (
          <p role="status">{t(usageLoading.value ? "usage.loading" : "usage.notLoaded")}</p>
        ) : (
          <>
            <div class="usage-tiles">
              <UsageTile
                label={t("usage.col.energy")}
                value={formatKwh(report.totals.energyWh)}
                detail={tn("usage.sessions", report.totals.sessionCount)}
              />
              <UsageTile
                label={t("usage.chargers")}
                value={String(report.stations.length)}
                detail={t("usage.withSessions", {
                  count: report.stations.filter(({ sessionCount }) => sessionCount > 0).length,
                })}
              />
              {hasDrivers && (
                <UsageTile
                  label={t("usage.drivers")}
                  value={String(report.drivers.filter(({ driver }) => driver !== null).length)}
                  detail={t("usage.driversDetail")}
                />
              )}
            </div>

            {(report.totals.openSessions > 0 || report.totals.conflictSessions > 0) && (
              <div class="inline-alert warn" role="status">
                {report.totals.openSessions > 0 &&
                  `${tn("usage.openNote", report.totals.openSessions)} `}
                {report.totals.conflictSessions > 0 &&
                  tn("usage.conflictNote", report.totals.conflictSessions)}
              </div>
            )}

            {hasDrivers && (
              <div class="table-scroll">
                <table aria-label={t("usage.byDriver")}>
                  <thead>
                    <tr>
                      <th>{t("usage.col.driver")}</th>
                      <th>{t("usage.chargers")}</th>
                      <th class="numeric">{t("usage.col.sessions")}</th>
                      <th class="numeric">{t("usage.col.energy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.drivers.map((row) => (
                      <tr key={row.driver ?? "unassigned"}>
                        <td>{row.driver ?? <span class="muted">{t("usage.unassigned")}</span>}</td>
                        <td>
                          {row.stationIds
                            .map(
                              (id) => report.stations.find((station) => station.id === id)?.label,
                            )
                            .join(", ")}
                        </td>
                        <td class="numeric">{row.sessionCount}</td>
                        <td class="numeric">
                          {formatKwh(row.energyWh)}
                          {row.privateEnergyWh ? (
                            <small class="usage-private">
                              {t("usage.privatePart", { energy: formatKwh(row.privateEnergyWh) })}
                            </small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div class="table-scroll">
              <table aria-label={t("usage.byCharger")}>
                <thead>
                  <tr>
                    <th>{t("usage.col.charger")}</th>
                    <th>{t("usage.col.site")}</th>
                    {hasDrivers && <th>{t("usage.col.driver")}</th>}
                    <th class="numeric">{t("usage.col.sessions")}</th>
                    <th class="numeric">{t("usage.col.energy")}</th>
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
                        <td>
                          {station.driver ?? <span class="muted">{t("usage.unassigned")}</span>}
                        </td>
                      )}
                      <td class="numeric">{station.sessionCount}</td>
                      <td class="numeric">{formatKwh(station.energyWh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="fine-print">{t("usage.reportNote", { timeZone: report.timeZone })}</p>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Console settings                                                    */
/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

const MODULE_KEYS: Readonly<
  Record<(typeof OPTIONAL_MODULES)[number], { label: MessageKey; description: MessageKey }>
> = {
  assist: { description: "module.assist.description", label: "module.assist.label" },
  evidence: { description: "module.evidence.description", label: "module.evidence.label" },
  liberation: { description: "module.liberation.description", label: "module.liberation.label" },
  sharing: { description: "module.sharing.description", label: "module.sharing.label" },
};

export function LanguagePicker({
  id = "console-language",
  hideLabel = false,
}: {
  id?: string;
  /** Under a "Language" heading the visible label would only repeat it. */
  hideLabel?: boolean;
}) {
  return (
    <label class="language-picker" for={id}>
      <span class={hideLabel ? "visually-hidden" : undefined}>{t("prefs.language")}</span>
      <select
        id={id}
        value={locale.value}
        onChange={(event) => setLocale(event.currentTarget.value as Locale)}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ConsoleSettingsSection({ profile }: { profile: ConsoleProfile }) {
  const enabled = enabledModules(profile);
  return (
    <div class="section-stack">
      <header class="page-head">
        <h1>{t("prefs.title")}</h1>
        <p class="lede">{t("prefs.lede")}</p>
      </header>

      <section class="panel glass" aria-labelledby="language-title">
        <header class="panel-head">
          <h2 id="language-title">{t("prefs.language")}</h2>
        </header>
        <LanguagePicker id="preferences-language" hideLabel />
        <p class="fine-print">{t("prefs.languageNote")}</p>
      </section>

      <section class="panel glass" aria-labelledby="modules-title">
        <header class="panel-head">
          <div>
            <h2 id="modules-title">{t("prefs.modules")}</h2>
            <p class="panel-sub">
              {t(chosenModules.value === null ? "prefs.modulesDefault" : "prefs.modulesCustom")}
            </p>
          </div>
          {chosenModules.value !== null && (
            <button class="button secondary compact" type="button" onClick={resetModules}>
              {t("prefs.useDefaults")}
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
                  <strong>{t(MODULE_KEYS[module].label)}</strong>
                  <small>
                    {t(MODULE_KEYS[module].description)}
                    {PROFILE_DEFAULT_MODULES[profile].includes(module)
                      ? ` ${t("prefs.onByDefault")}`
                      : ""}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <details class="privacy-note">
          <summary>{t("prefs.modulesNoteShort")}</summary>
          <p>{t("prefs.modulesNote")}</p>
        </details>
      </section>

      {/* Read-only context goes after the choices the owner can make here. */}
      <section class="panel glass" aria-labelledby="profile-title">
        <header class="panel-head">
          <h2 id="profile-title">{t("prefs.profile")}</h2>
          <span class="state-chip idle">
            {t(profile === "company" ? "prefs.company" : "prefs.personal")}
          </span>
        </header>
        <p>{t(profile === "company" ? "prefs.companyText" : "prefs.personalText")}</p>
        <p class="fine-print">{t("prefs.profileNote")}</p>
      </section>
    </div>
  );
}
