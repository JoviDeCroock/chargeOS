import { useEffect, useState } from "preact/hooks";

import type { MessageKey } from "./i18n/index.js";
import type { OptionalModule } from "./console-modules.js";

export const PAGES = [
  "overview",
  "stations",
  "people",
  "cards",
  "sessions",
  "usage",
  "settings",
] as const;
export type Page = (typeof PAGES)[number];

/** Station settings tabs, in menu order. Everything technical or optional lives here. */
export const ADVANCED_TABS = [
  "offline",
  "controls",
  "details",
  "sharing",
  "evidence",
  "switching",
  "freedom",
  "assist",
] as const;
export type AdvancedTab = (typeof ADVANCED_TABS)[number];

export type Route =
  | { readonly page: Page }
  | { readonly page: "advanced"; readonly tab: AdvancedTab };

export const PAGE_LABELS: Readonly<Record<Page | "advanced", MessageKey>> = {
  advanced: "nav.advanced",
  cards: "nav.cards",
  overview: "nav.overview",
  people: "nav.people",
  sessions: "nav.sessions",
  settings: "nav.preferences",
  stations: "nav.stations",
  usage: "nav.usage",
};

export const TAB_LABELS: Readonly<Record<AdvancedTab, MessageKey>> = {
  assist: "tab.assist",
  controls: "tab.controls",
  details: "tab.details",
  evidence: "tab.evidence",
  freedom: "tab.freedom",
  offline: "tab.offline",
  sharing: "tab.sharing",
  switching: "tab.switching",
};

/** Tabs that belong to an optional module; the rest are always available. */
export const TAB_MODULE: Partial<Readonly<Record<AdvancedTab, OptionalModule>>> = {
  assist: "assist",
  evidence: "evidence",
  freedom: "liberation",
  sharing: "sharing",
  switching: "liberation",
};

/** Addresses from the previous console layout keep working. */
const LEGACY_ROUTES: Readonly<Record<string, Route>> = {
  assist: { page: "advanced", tab: "assist" },
  charging: { page: "advanced", tab: "controls" },
  delegates: { page: "advanced", tab: "sharing" },
  evidence: { page: "advanced", tab: "evidence" },
  fleet: { page: "stations" },
  freedom: { page: "advanced", tab: "freedom" },
  migration: { page: "advanced", tab: "switching" },
};

export function parseRoute(hash: string): Route | null {
  const match = /^#\/([a-z]+)(?:\/([a-z]+))?$/u.exec(hash);
  if (!match) return null;
  const [, page = "", tab] = match;
  if (page === "advanced") {
    // Charging sessions are everyday owner data and moved out of Station settings.
    if (tab === "sessions") return { page: "sessions" };
    return (ADVANCED_TABS as readonly string[]).includes(tab ?? "")
      ? { page: "advanced", tab: tab as AdvancedTab }
      : { page: "advanced", tab: "offline" };
  }
  if (tab !== undefined) return null;
  if ((PAGES as readonly string[]).includes(page)) return { page: page as Page };
  return LEGACY_ROUTES[page] ?? null;
}

export function routeHash(route: Route): string {
  return route.page === "advanced" ? `#/advanced/${route.tab}` : `#/${route.page}`;
}

export function useRoute(): [Route | null, (next: Route) => void] {
  const [route, setRoute] = useState<Route | null>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const go = (next: Route) => {
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setRoute(next);
    window.scrollTo?.({ top: 0 });
  };
  return [route, go];
}
