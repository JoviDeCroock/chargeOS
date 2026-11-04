import { signal } from "@preact/signals";

import { METER_TRACE_MAX_POINTS, type ChargeSession } from "../shared/contracts.js";
import {
  formatKwh,
  formatNumber,
  formatTime,
  intlLocale,
  t,
  type MessageKey,
} from "./i18n/index.js";

/* ------------------------------------------------------------------ */
/* Charging speed                                                      */
/* ------------------------------------------------------------------ */

/** Below this much charging time an average says more about rounding than about the charger. */
const MIN_AVERAGE_HOURS = 0.1;

/** Below this an interval counts as paused (car full, scheduled, held back), not as charging. */
const PAUSED_KW = 0.05;

/**
 * Average power (kW) while actually charging: energy to the latest meter reading divided by the
 * time since session start, leaving out intervals in which the meter barely moved. Null when there
 * is too little charging time to say.
 */
export function averagePowerKw(session: ChargeSession): number | null {
  const reading = session.latestMeterReading;
  if (!reading) return null;
  const total = (Date.parse(reading.at) - Date.parse(session.startedAt)) / 3_600_000;
  if (!Number.isFinite(total)) return null;
  const pausedHours = intervalPowers(session)
    .filter(({ kw, hours }) => kw < PAUSED_KW && hours > 0)
    .reduce((sum, { hours }) => sum + hours, 0);
  const hours = total - pausedHours;
  if (hours < MIN_AVERAGE_HOURS || reading.energyWh <= 0) return null;
  return reading.energyWh / 1_000 / hours;
}

export function formatKw(kw: number): string {
  return `${formatNumber(kw, kw >= 10 ? 0 : 1)} kW`;
}

/** Power (kW) over each interval between consecutive meter readings, starting at session start. */
export function intervalPowers(
  session: ChargeSession,
): { at: number; hours: number; kw: number }[] {
  const start = Date.parse(session.startedAt);
  const points = session.meterTrace.map(({ at, energyWh }) => ({ energyWh, time: Date.parse(at) }));
  if (Number.isFinite(start) && (points.length === 0 || points[0]!.time > start)) {
    points.unshift({ energyWh: 0, time: start });
  }
  const powers: { at: number; hours: number; kw: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const hours = (current.time - previous.time) / 3_600_000;
    // Readings closer than a minute apart (start/periodic pairs) would spike the line.
    if (!(hours >= 1 / 60)) continue;
    powers.push({
      at: current.time,
      hours,
      kw: Math.max(0, current.energyWh - previous.energyWh) / 1_000 / hours,
    });
  }
  return powers;
}

/**
 * Typical gap between the charger's meter readings, when at least two gaps are known. A trace at
 * its cap has been thinned, so its gaps no longer match the charger's interval: say nothing then.
 */
export function readingInterval(session: ChargeSession): number | null {
  if (session.meterTrace.length >= METER_TRACE_MAX_POINTS) return null;
  const times = session.meterTrace.map(({ at }) => Date.parse(at));
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index]!)
    .filter((gap) => gap >= 60_000);
  if (gaps.length < 2) return null;
  const sorted = [...gaps].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Elapsed charging time as "1 h 05 min" or "12 min". */
export function formatElapsed(fromIso: string, to = Date.now()): string {
  const minutes = Math.max(0, Math.round((to - Date.parse(fromIso)) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours
    ? t("sessions.hoursMinutes", { hours, minutes: String(minutes % 60).padStart(2, "0") })
    : t("sessions.minutes", { minutes });
}

/* ------------------------------------------------------------------ */
/* Pause reasons                                                       */
/* ------------------------------------------------------------------ */

export type PauseStatus = "SuspendedEV" | "SuspendedEVSE";

export function isPauseStatus(status: string): status is PauseStatus {
  return status === "SuspendedEV" || status === "SuspendedEVSE";
}

/** What an OCPP suspended state means for the owner; it names who is holding back, not why. */
export const PAUSE_COPY: Readonly<Record<PauseStatus, { title: MessageKey; hint: MessageKey }>> = {
  SuspendedEV: { hint: "live.pausedByCarHint", title: "live.pausedByCar" },
  SuspendedEVSE: { hint: "live.pausedByChargerHint", title: "live.pausedByCharger" },
};

/* ------------------------------------------------------------------ */
/* Energy price (this browser only)                                    */
/* ------------------------------------------------------------------ */

export const PRICE_CURRENCIES = ["EUR", "GBP", "CHF", "USD", "SEK", "NOK", "DKK", "PLN"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];
export interface EnergyPrice {
  /** Price per kWh in `currency`. */
  readonly amount: number;
  readonly currency: PriceCurrency;
}

const PRICE_KEY = "chargeos.energyPrice";
/** A per-kWh price above this is almost certainly a typo (for example cents entered as units). */
export const MAX_PRICE_PER_KWH = 10;

export function parseEnergyPrice(value: unknown): EnergyPrice | null {
  if (!value || typeof value !== "object") return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  if (amount <= 0 || amount > MAX_PRICE_PER_KWH) return null;
  if (!(PRICE_CURRENCIES as readonly unknown[]).includes(currency)) return null;
  return { amount, currency: currency as PriceCurrency };
}

function readStoredPrice(): EnergyPrice | null {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    return raw === null ? null : parseEnergyPrice(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The owner's own price per kWh. It only drives estimates in this browser; never a bill. */
export const energyPrice = signal<EnergyPrice | null>(readStoredPrice());

export function setEnergyPrice(next: EnergyPrice | null): void {
  const valid = next === null ? null : parseEnergyPrice(next);
  energyPrice.value = valid;
  try {
    if (valid) localStorage.setItem(PRICE_KEY, JSON.stringify(valid));
    else localStorage.removeItem(PRICE_KEY);
  } catch {
    // Private browsing can refuse storage; the price still applies until the tab closes.
  }
}

export function formatMoney(amount: number, currency: PriceCurrency, perKwh = false): string {
  return new Intl.NumberFormat(intlLocale.value, {
    currency,
    maximumFractionDigits: perKwh ? 3 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

/** Estimated cost of `energyWh` at the configured price, or null when no price is set. */
export function estimatedCost(energyWh: number, price = energyPrice.value): string | null {
  return price ? formatMoney((energyWh / 1_000) * price.amount, price.currency) : null;
}

export function priceLabel(price: EnergyPrice): string {
  return t("prefs.price.perKwh", { price: formatMoney(price.amount, price.currency, true) });
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/**
 * Charging speed over the session, from the charger's meter readings. A flat line means a steady
 * current; dips are pauses or limits. Hidden until there are two intervals to compare.
 */
export function SessionSparkline({
  session,
  width = 96,
  height = 24,
}: {
  session: ChargeSession;
  width?: number;
  height?: number;
}) {
  const powers = intervalPowers(session);
  if (powers.length < 2) return null;
  const start = Date.parse(session.startedAt);
  const end = powers.at(-1)!.at;
  const span = Math.max(end - start, 1);
  const peak = Math.max(...powers.map(({ kw }) => kw), 0.1);
  const low = Math.min(...powers.map(({ kw }) => kw));
  const pad = 2;
  const x = (time: number) => pad + ((time - start) / span) * (width - pad * 2);
  const y = (kw: number) => height - pad - (kw / peak) * (height - pad * 2);
  // Each interval is drawn as a flat step: the meter only knows the average over it.
  let path = `M ${x(start).toFixed(1)} ${y(powers[0]!.kw).toFixed(1)}`;
  let previous = start;
  for (const { at, kw } of powers) {
    path += ` L ${x(previous).toFixed(1)} ${y(kw).toFixed(1)} L ${x(at).toFixed(1)} ${y(kw).toFixed(1)}`;
    previous = at;
  }
  const area = `${path} L ${x(end).toFixed(1)} ${height - pad} L ${x(start).toFixed(1)} ${height - pad} Z`;
  return (
    <svg
      class="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={t("live.sparkLabel", { high: formatKw(peak), low: formatKw(low) })}
    >
      <path class="sparkline-area" d={area} />
      <path class="sparkline-line" d={path} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Live readout of an open session                                     */
/* ------------------------------------------------------------------ */

export function LiveReadout({
  session,
  paused = false,
}: {
  session: ChargeSession;
  /** The charger reports a pause: keep the figure, stop the pulse. */
  paused?: boolean;
}) {
  const reading = session.latestMeterReading;
  if (!reading) return <p>{t("overview.noMeterReading")}</p>;
  const average = averagePowerKw(session);
  const interval = readingInterval(session);
  const cost = estimatedCost(reading.energyWh);
  const price = energyPrice.value;
  return (
    <div class="live-readout">
      <p class="live-figure">
        <span class={`live-dot${paused ? " paused" : ""}`} aria-hidden="true" />
        <span class="live-kwh">{formatKwh(reading.energyWh)}</span>
        <span class="live-unit">{t("live.soFar")}</span>
      </p>
      <p class="live-meta">
        {t("live.since", {
          duration: formatElapsed(session.startedAt),
          time: formatTime(session.startedAt),
        })}
        {average !== null && <> · {t("live.average", { power: formatKw(average) })}</>}
      </p>
      {cost && price && (
        <p class="live-meta">{t("live.costSoFar", { cost, price: priceLabel(price) })}</p>
      )}
      <SessionSparkline session={session} width={220} height={40} />
      <p class="live-sub">
        {interval
          ? t("live.meterReadNext", {
              next: formatTime(new Date(Date.parse(reading.at) + interval).toISOString()),
              time: formatTime(reading.at),
            })
          : t("live.meterRead", { time: formatTime(reading.at) })}
      </p>
    </div>
  );
}
