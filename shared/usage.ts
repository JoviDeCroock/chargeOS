/**
 * Usage reporting shared by the owner API and the owner console.
 *
 * Usage is a read-only projection of already-recorded sessions. It never changes evidence,
 * authorization or charger state, and it is not a financial statement: reimbursement approval
 * stays in the separate commercial service.
 */

/** Who the console is arranged for. Presentation only; it grants and removes no authority. */
export const CONSOLE_PROFILES = ["personal", "company"] as const;
export type ConsoleProfile = (typeof CONSOLE_PROFILES)[number];

export function isConsoleProfile(value: unknown): value is ConsoleProfile {
  return typeof value === "string" && (CONSOLE_PROFILES as readonly string[]).includes(value);
}

/** Minimal session fields needed to attribute usage. Never includes a raw RFID value. */
export interface UsageSessionInput {
  readonly energyWh: number | null;
  readonly integrity: "consistent" | "conflict";
  readonly startedAt: string;
  readonly status: "active" | "complete";
  readonly stoppedAt: string | null;
  readonly tagPseudonym: string;
  readonly transactionId: number;
}

export interface MonthlyUsage {
  /** Calendar month in the report time zone, formatted `YYYY-MM`. */
  readonly month: string;
  readonly energyWh: number;
  readonly sessionCount: number;
}

export interface UsageReportSession {
  readonly energyWh: number | null;
  readonly integrity: "consistent" | "conflict";
  readonly startedAt: string;
  readonly status: "active" | "complete";
  readonly stoppedAt: string | null;
  readonly tagPseudonym: string;
  readonly transactionId: number;
}

export interface UsageReportStation {
  readonly driver: string | null;
  readonly energyWh: number;
  readonly id: string;
  readonly label: string;
  readonly sessionCount: number;
  readonly sessions: readonly UsageReportSession[];
  readonly site: string;
}

export interface UsageReportDriver {
  /** `null` groups chargers that have no assigned driver. */
  readonly driver: string | null;
  readonly energyWh: number;
  readonly sessionCount: number;
  readonly stationIds: readonly string[];
}

/** Owner-only monthly usage across every provisioned charger. */
export interface UsageReport {
  readonly drivers: readonly UsageReportDriver[];
  readonly generatedAt: string;
  readonly month: string;
  readonly profile: ConsoleProfile;
  readonly stations: readonly UsageReportStation[];
  readonly timeZone: string;
  readonly totals: {
    readonly conflictSessions: number;
    readonly energyWh: number;
    readonly openSessions: number;
    readonly sessionCount: number;
  };
}

export class UsageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageInputError";
  }
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;

export function parseUsageMonth(value: string | null): string {
  if (!value || !MONTH_PATTERN.test(value)) {
    throw new UsageInputError("month must be a calendar month formatted YYYY-MM");
  }
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2200) throw new UsageInputError("month is outside the supported range");
  return value;
}

export function parseTimeZone(value: string | null): string {
  if (!value || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/u.test(value)) {
    throw new UsageInputError("timeZone must be an IANA time zone such as Europe/Brussels");
  }
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new UsageInputError("timeZone must be an IANA time zone such as Europe/Brussels");
  }
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar month (`YYYY-MM`) of an instant in the given IANA time zone. */
export function monthOf(instant: string, timeZone: string): string | null {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) return null;
  let formatter = monthFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
    monthFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(time);
  const year = parts.find(({ type }) => type === "year")?.value;
  const month = parts.find(({ type }) => type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

/** The `count` calendar months ending with the month that contains `now`, oldest first. */
export function recentMonths(now: Date, timeZone: string, count: number): readonly string[] {
  const current = monthOf(now.toISOString(), timeZone);
  if (!current) return [];
  let year = Number(current.slice(0, 4));
  let month = Number(current.slice(5, 7));
  const months: string[] = [];
  for (let index = 0; index < count; index += 1) {
    months.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/** Sessions are attributed to the month in which they started. */
export function sessionsInMonth<T extends UsageSessionInput>(
  sessions: readonly T[],
  month: string,
  timeZone: string,
): readonly T[] {
  return sessions.filter(({ startedAt }) => monthOf(startedAt, timeZone) === month);
}

export function recordedEnergyWh(sessions: readonly UsageSessionInput[]): number {
  return sessions.reduce((total, { energyWh }) => total + (energyWh ?? 0), 0);
}

export function monthlyUsage(
  sessions: readonly UsageSessionInput[],
  months: readonly string[],
  timeZone: string,
): readonly MonthlyUsage[] {
  const buckets = new Map(months.map((month) => [month, { energyWh: 0, sessionCount: 0 }]));
  for (const session of sessions) {
    const month = monthOf(session.startedAt, timeZone);
    const bucket = month ? buckets.get(month) : undefined;
    if (!bucket) continue;
    bucket.sessionCount += 1;
    bucket.energyWh += session.energyWh ?? 0;
  }
  return months.map((month) => ({ month, ...buckets.get(month)! }));
}

/** Per-card split of sessions, largest energy first. Uses pseudonyms only. */
export function usageByCard(
  sessions: readonly UsageSessionInput[],
): readonly { energyWh: number; sessionCount: number; tagPseudonym: string }[] {
  const cards = new Map<string, { energyWh: number; sessionCount: number }>();
  for (const { energyWh, tagPseudonym } of sessions) {
    const card = cards.get(tagPseudonym) ?? { energyWh: 0, sessionCount: 0 };
    card.energyWh += energyWh ?? 0;
    card.sessionCount += 1;
    cards.set(tagPseudonym, card);
  }
  return [...cards.entries()]
    .map(([tagPseudonym, card]) => ({ tagPseudonym, ...card }))
    .sort(
      (left, right) =>
        right.energyWh - left.energyWh || left.tagPseudonym.localeCompare(right.tagPseudonym),
    );
}

export interface UsageStationInput {
  readonly driver: string | null;
  readonly id: string;
  readonly label: string;
  readonly sessions: readonly UsageSessionInput[];
  readonly site: string;
}

export function buildUsageReport(input: {
  readonly generatedAt: string;
  readonly month: string;
  readonly profile: ConsoleProfile;
  readonly stations: readonly UsageStationInput[];
  readonly timeZone: string;
}): UsageReport {
  const stations = input.stations.map((station): UsageReportStation => {
    const sessions = sessionsInMonth(station.sessions, input.month, input.timeZone)
      .map((session): UsageReportSession => ({
        energyWh: session.energyWh,
        integrity: session.integrity,
        startedAt: session.startedAt,
        status: session.status,
        stoppedAt: session.stoppedAt,
        tagPseudonym: session.tagPseudonym,
        transactionId: session.transactionId,
      }))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    return {
      driver: station.driver,
      energyWh: recordedEnergyWh(sessions),
      id: station.id,
      label: station.label,
      sessionCount: sessions.length,
      sessions,
      site: station.site,
    };
  });

  const drivers = new Map<
    string | null,
    { energyWh: number; sessionCount: number; ids: string[] }
  >();
  for (const station of stations) {
    const driver = drivers.get(station.driver) ?? { energyWh: 0, ids: [], sessionCount: 0 };
    driver.energyWh += station.energyWh;
    driver.sessionCount += station.sessionCount;
    driver.ids.push(station.id);
    drivers.set(station.driver, driver);
  }

  const allSessions = stations.flatMap(({ sessions }) => sessions);
  return {
    drivers: [...drivers.entries()]
      .map(([driver, value]) => ({
        driver,
        energyWh: value.energyWh,
        sessionCount: value.sessionCount,
        stationIds: value.ids,
      }))
      .sort((left, right) => {
        if (left.driver === null) return 1;
        if (right.driver === null) return -1;
        return left.driver.localeCompare(right.driver);
      }),
    generatedAt: input.generatedAt,
    month: input.month,
    profile: input.profile,
    stations,
    timeZone: input.timeZone,
    totals: {
      conflictSessions: allSessions.filter(({ integrity }) => integrity === "conflict").length,
      energyWh: recordedEnergyWh(allSessions),
      openSessions: allSessions.filter(({ status }) => status === "active").length,
      sessionCount: allSessions.length,
    },
  };
}

const CSV_HEADER = [
  "month",
  "driver",
  "charger_id",
  "charger_label",
  "site",
  "session_id",
  "transaction_id",
  "started_at",
  "stopped_at",
  "energy_kwh",
  "status",
  "integrity",
  "card_pseudonym",
] as const;

/**
 * Spreadsheet-safe CSV. Every cell is quoted, so a comma or a semicolon (the separator Excel uses
 * in Belgian, Dutch and German locales) cannot split a cell, and cells that a spreadsheet could
 * interpret as a formula are prefixed so a hostile label or driver name cannot execute.
 */
export function usageReportCsv(report: UsageReport): string {
  const rows: string[][] = [[...CSV_HEADER]];
  for (const station of report.stations) {
    for (const session of station.sessions) {
      rows.push([
        report.month,
        station.driver ?? "",
        station.id,
        station.label,
        station.site,
        `${station.id}:${session.transactionId}`,
        String(session.transactionId),
        session.startedAt,
        session.stoppedAt ?? "",
        session.energyWh === null ? "" : (session.energyWh / 1_000).toFixed(3),
        session.status === "active" ? "in-progress" : "complete",
        session.integrity,
        session.tagPseudonym,
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
