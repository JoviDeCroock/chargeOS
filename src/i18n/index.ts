import { computed, signal } from "@preact/signals";

import { en, type MessageKey } from "./en.js";
import { fr } from "./fr.js";
import { nl } from "./nl.js";

export type { MessageKey } from "./en.js";

/** Console languages. English is the reference catalog; every other catalog must match its keys. */
export const LOCALES = ["en", "nl", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language names itself, so a reader can always find their own. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: "English",
  fr: "Français",
  nl: "Nederlands",
};

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, fr, nl };
const STORAGE_KEY = "chargeos.locale";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Stored choice first, then the browser's preferred languages, then English. */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable in private browsing.
  }
  const preferred = typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
  for (const language of preferred) {
    const base = language.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

export const locale = signal<Locale>(detectLocale());

/** BCP 47 tag for Intl formatting; Belgian conventions for Dutch and French. */
export const intlLocale = computed(() =>
  locale.value === "nl" ? "nl-BE" : locale.value === "fr" ? "fr-BE" : "en-GB",
);

export function setLocale(next: Locale): void {
  locale.value = next;
  applyDocumentLanguage(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies until reload.
  }
}

export function applyDocumentLanguage(value: Locale = locale.value): void {
  if (typeof document !== "undefined") document.documentElement.lang = value;
}

type Values = Readonly<Record<string, string | number>>;

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Translate a message, filling `{name}` placeholders. */
export function t(key: MessageKey, values?: Values): string {
  return interpolate(CATALOGS[locale.value][key] ?? en[key], values);
}

/** Message bases that have both a `.one` and an `.other` form. */
type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.one`
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never;
}[MessageKey];

/** Translate a counted message using the language's plural rules; `{count}` is filled in. */
export function tn(base: PluralBase, count: number, values?: Values): string {
  const rule = new Intl.PluralRules(intlLocale.value).select(count);
  const key = (rule === "one" ? `${base}.one` : `${base}.other`) as MessageKey;
  return t(key, { count: formatNumber(count), ...values });
}

export function formatNumber(value: number, fractionDigits?: number): string {
  return new Intl.NumberFormat(
    intlLocale.value,
    fractionDigits === undefined
      ? {}
      : { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits },
  ).format(value);
}

export function formatKwh(wh: number): string {
  const kwh = wh / 1_000;
  return `${formatNumber(kwh, kwh >= 100 ? 0 : 1)} kWh`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(intlLocale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(intlLocale.value, { timeStyle: "short" }).format(new Date(value));
}

export function monthLabel(month: string, style: "long" | "short" | "narrow" = "long"): string {
  // Mid-month noon UTC is the same calendar month in every time zone.
  const date = new Date(`${month}-15T12:00:00Z`);
  return new Intl.DateTimeFormat(intlLocale.value, {
    month: style,
    timeZone: "UTC",
    ...(style === "long" ? { year: "numeric" } : {}),
  }).format(date);
}
