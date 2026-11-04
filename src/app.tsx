import { useEffect, useState } from "preact/hooks";

import type {
  FleetSnapshot,
  FreedomTestProjection,
  MigrationProjection,
  OwnerSnapshot,
} from "../shared/contracts.js";
import { BrandMark } from "./brand.js";
import { enabledModules, OPTIONAL_MODULES, type OptionalModule } from "./console-modules.js";
import { applyDocumentLanguage, formatTime, locale, t, tn } from "./i18n/index.js";
import {
  directory,
  fleet,
  isAuthenticated,
  loading,
  notice,
  ownerToken,
  refreshFleet,
  refreshSnapshot,
  selectStation,
  selectedStationId,
  setOwnerToken,
  snapshot,
} from "./model.js";
import { CardsPage } from "./pages/cards.js";
import { refreshFleetExtras } from "./fleet-model.js";
import { FinanceFeedPanel } from "./pages/finance-feed.js";
import { OverviewPage } from "./pages/overview.js";
import { PeoplePage } from "./pages/people.js";
import { SessionsPage } from "./pages/sessions.js";
import { StationSettingsPage } from "./pages/station-settings.js";
import { StationEditDialog, StationsPage } from "./pages/stations.js";
import {
  ADVANCED_TABS,
  PAGE_LABELS,
  TAB_LABELS,
  TAB_MODULE,
  routeHash,
  useRoute,
  type AdvancedTab,
  type Page,
  type Route,
} from "./routes.js";
import { StatusPill, type Tone } from "./ui.js";
import { ConsoleSettingsSection, LanguagePicker, UsageReportSection } from "./usage.js";
import { startChargingNotifications } from "./notifications.js";

/** Pages about every charger at once; the rest act on the selected charger. */
const CONSOLE_PAGES: ReadonlySet<Page> = new Set(["stations", "people", "usage", "settings"]);

export function App() {
  const [route, go] = useRoute();
  const [editingStation, setEditingStation] = useState<string | null>(null);
  // Phones fold the page list behind one button so content starts near the top.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    applyDocumentLanguage();
    if (ownerToken.value) void refreshFleet().then(refreshFleetExtras);
    startChargingNotifications();
  }, []);

  const current = snapshot.value;
  const fleetSnapshot = fleet.value;
  const names = directory.value;
  const hasMultipleStations = (fleetSnapshot?.stations.length ?? 0) > 1;
  // An older server without a profile keeps the complete console.
  const profile = fleetSnapshot?.console?.profile ?? null;
  const company = profile === "company";
  const showUsageReport = company || hasMultipleStations;
  const resolved: Route =
    route === null || (route.page === "usage" && !showUsageReport)
      ? { page: hasMultipleStations ? "stations" : "overview" }
      : route;

  const modules: ReadonlySet<OptionalModule> = profile
    ? enabledModules(profile)
    : new Set(OPTIONAL_MODULES);
  const required = current ? tabsNeedingOwner(current) : new Set<AdvancedTab>();
  const activeTab = resolved.page === "advanced" ? resolved.tab : null;
  const visibleTabs = new Set(
    ADVANCED_TABS.filter((id) => {
      const module = TAB_MODULE[id];
      // A hidden module stays reachable while it needs the owner or is open.
      return !module || modules.has(module) || required.has(id) || id === activeTab;
    }),
  );
  const pageTitle =
    resolved.page === "advanced"
      ? `${t(TAB_LABELS[resolved.tab])} · ${t(PAGE_LABELS.advanced)}`
      : resolved.page === "people" && company
        ? t("people.titleCompany")
        : t(PAGE_LABELS[resolved.page]);

  const currentRoute = routeHash(resolved);
  useEffect(() => {
    // An action result belongs to the page where it happened.
    notice.value = null;
    setMenuOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    document.title = `${pageTitle} · chargeOS`;
    // On narrow screens the page list scrolls sideways; keep the current one visible.
    document
      .querySelector(".rail-link.active")
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [pageTitle, locale.value]);

  if (!isAuthenticated.value) return <TokenGate />;
  if (!fleetSnapshot || !current) {
    return (
      <div class="console-backdrop">
        <main class="centered-shell">
          <div class="glass centered-card">
            <BrandMark />
            <p role="status">{loading.value ? t("app.opening") : notice.value?.message}</p>
            {!loading.value && (
              <button class="button secondary" type="button" onClick={() => setOwnerToken("")}>
                {t("app.otherToken")}
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const consolePage = resolved.page !== "advanced" && CONSOLE_PAGES.has(resolved.page);
  const tones = consolePage ? {} : navTones(current);
  const tabTones = advancedTabTones(current);
  const canEditNames = Boolean(names?.writable);
  const editStation = canEditNames ? () => setEditingStation(current.station.id) : null;
  const navItems: { route: Route; label: string; tone?: Tone; badge?: string; hint?: string }[] = [
    { label: t("nav.overview"), route: { page: "overview" }, ...tones.overview },
    {
      label: t("nav.stations"),
      route: { page: "stations" },
      ...(hasMultipleStations
        ? { badge: `${fleetSnapshot.totals.connected}/${fleetSnapshot.totals.stations}` }
        : {}),
    },
    { label: t(company ? "people.titleCompany" : "nav.people"), route: { page: "people" } },
    { label: t("nav.cards"), route: { page: "cards" }, ...tones.cards },
    { label: t("nav.sessions"), route: { page: "sessions" } },
    ...(showUsageReport ? [{ label: t("nav.usage"), route: { page: "usage" } as Route }] : []),
    {
      label: t("nav.advanced"),
      route: { page: "advanced", tab: activeTab ?? "offline" },
      ...tones.advanced,
    },
  ];

  const openStation = (stationId: string, route: Route = { page: "overview" }) => {
    selectStation(stationId);
    go(route);
    void refreshSnapshot();
  };

  return (
    <div class="console console-backdrop">
      <a class="skip-link" href="#console-main">
        {t("app.skip")}
      </a>
      <aside class={`rail glass-chrome${menuOpen ? " menu-open" : ""}`}>
        <a
          class="rail-brand"
          href={hasMultipleStations ? "#/stations" : "#/overview"}
          onClick={(event) => {
            event.preventDefault();
            go({ page: hasMultipleStations ? "stations" : "overview" });
          }}
        >
          <BrandMark />
        </a>
        <button
          class="rail-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="console-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span class="rail-menu-icon" aria-hidden="true" />
          {t(menuOpen ? "app.closeMenu" : "app.menu")}
        </button>

        <nav id="console-menu" class="rail-nav" aria-label={t("app.sections")}>
          {hasMultipleStations && (
            <label class="station-switcher">
              <span>{t("app.charger")}</span>
              <select
                value={selectedStationId.value}
                onChange={(event) => {
                  selectStation(event.currentTarget.value);
                  if (consolePage) go({ page: "overview" });
                  void refreshSnapshot();
                }}
              >
                {fleetSnapshot.stations.map((station) => (
                  <option value={station.id} key={station.id}>
                    {station.label}, {station.site}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ul class="rail-group">
            {navItems.map((item) => (
              <NavLink
                key={item.route.page}
                route={item.route}
                label={item.label}
                active={resolved.page === item.route.page}
                go={go}
                tone={item.tone}
                badge={item.badge}
                hint={item.hint}
              />
            ))}
          </ul>
        </nav>

        <div class="rail-foot">
          <a
            class={`rail-foot-link${resolved.page === "settings" ? " active" : ""}`}
            href="#/settings"
            aria-current={resolved.page === "settings" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go({ page: "settings" });
            }}
          >
            {t("nav.preferences")}
          </a>
          <a class="rail-foot-link" href="/help">
            {t("app.help")}
          </a>
          <button class="rail-foot-link" type="button" onClick={() => setOwnerToken("")}>
            {t("app.lock")}
          </button>
        </div>
      </aside>

      <div class="stage">
        {/* With several chargers the bar names the selected one; with one, pages carry their own status. */}
        {hasMultipleStations && (
          <header class="stage-bar">
            <div class="stage-context">
              {consolePage ? (
                <>
                  <strong>
                    {resolved.page === "people" && company
                      ? t("people.titleCompany")
                      : t(PAGE_LABELS[resolved.page as Page])}
                  </strong>
                  <span>{tn("app.chargerCount", fleetSnapshot.totals.stations)}</span>
                </>
              ) : (
                <>
                  <strong>{current.station.label}</strong>
                  <span>
                    {current.station.site}
                    {current.station.driver ? `, ${current.station.driver}` : ""}
                  </span>
                </>
              )}
            </div>
            <div class="stage-status">
              {consolePage ? (
                <FleetStatusPill fleet={fleetSnapshot} />
              ) : (
                <StatusPill
                  connected={current.station.connected}
                  awaitingConnection={!current.station.boot}
                />
              )}
              <span class="stage-updated">
                {t("app.updated")}{" "}
                <time dateTime={consolePage ? fleetSnapshot.generatedAt : current.generatedAt}>
                  {formatTime(consolePage ? fleetSnapshot.generatedAt : current.generatedAt)}
                </time>
              </span>
            </div>
          </header>
        )}

        <main id="console-main" class="stage-main" tabIndex={-1}>
          {notice.value && (
            <div class={`notice ${notice.value.kind}`} role="status">
              {notice.value.message}
            </div>
          )}

          {resolved.page === "advanced" ? (
            <StationSettingsPage
              snapshot={current}
              directory={names}
              tab={resolved.tab}
              visibleTabs={visibleTabs}
              tabTones={tabTones}
              go={go}
              onEdit={editStation}
            />
          ) : resolved.page === "stations" ? (
            <StationsPage
              fleet={fleetSnapshot}
              directory={names}
              onOpen={openStation}
              showSwitching={modules.has("liberation")}
            />
          ) : resolved.page === "people" ? (
            <PeoplePage directory={names} fleet={fleetSnapshot} company={company} />
          ) : resolved.page === "cards" ? (
            <CardsPage snapshot={current} directory={names} go={go} company={company} />
          ) : resolved.page === "sessions" ? (
            <SessionsPage snapshot={current} directory={names} />
          ) : resolved.page === "usage" ? (
            <div class="section-stack">
              <UsageReportSection profile={profile ?? "personal"} />
              {company && <FinanceFeedPanel />}
            </div>
          ) : resolved.page === "settings" ? (
            <ConsoleSettingsSection profile={profile ?? "personal"} />
          ) : (
            <OverviewPage
              snapshot={current}
              directory={names}
              go={go}
              visibleTabs={visibleTabs}
              onEdit={editStation}
            />
          )}
        </main>

        <footer class="stage-foot">
          <span>{t("app.footer")}</span>
        </footer>
      </div>

      {editingStation && names && (
        <StationEditDialog
          stationId={editingStation}
          directory={names}
          onClose={() => setEditingStation(null)}
        />
      )}
    </div>
  );
}

function NavLink({
  route,
  label,
  active,
  go,
  tone,
  badge,
  hint,
}: {
  route: Route;
  label: string;
  active: boolean;
  go: (next: Route) => void;
  tone?: Tone | undefined;
  badge?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <li>
      <a
        class={`rail-link${active ? " active" : ""}`}
        href={routeHash(route)}
        aria-current={active ? "page" : undefined}
        aria-label={hint ? `${label}, ${hint}` : undefined}
        onClick={(event) => {
          event.preventDefault();
          go(route);
        }}
      >
        <span class="rail-link-label">{label}</span>
        {badge ? (
          <span class={`rail-badge ${tone ?? "idle"}`}>{badge}</span>
        ) : tone && tone !== "idle" ? (
          <span class={`rail-dot ${tone}`} aria-hidden="true" />
        ) : null}
      </a>
    </li>
  );
}

/**
 * Optional tabs that must stay visible whatever the owner's module choice: someone else holds
 * live access, a switching step is open or stopped, or field-test evidence needs attention.
 */
function tabsNeedingOwner(current: OwnerSnapshot): ReadonlySet<AdvancedTab> {
  const required = new Set<AdvancedTab>();
  if (current.delegations.some(({ status }) => status === "active")) required.add("sharing");
  const openMigration: readonly MigrationProjection["status"][] = [
    "blocked",
    "ready-for-owner-confirmation",
    "owner-authorized-window",
    "online-proof-in-progress",
  ];
  const openFreedom: readonly FreedomTestProjection["status"][] = [
    "in-progress",
    "failed",
    "baseline-stale",
  ];
  if (
    openMigration.includes(current.migration.status) ||
    current.genesisPlan.state === "stop" ||
    openFreedom.includes(current.freedomTest.status)
  ) {
    required.add("switching");
    required.add("freedom");
  }
  return required;
}

type NavTone = { tone: Tone; badge?: string; hint?: string };

function navTones(
  current: OwnerSnapshot,
): Partial<Record<"overview" | "cards" | "advanced", NavTone>> {
  const readiness = current.readiness?.state ?? "unknown";
  const advanced = advancedTabTones(current);
  const worst = Object.values(advanced).includes("risk")
    ? "risk"
    : Object.values(advanced).includes("warn")
      ? "warn"
      : null;
  return {
    advanced: worst ? { hint: t("nav.hint.attention"), tone: worst } : { tone: "idle" },
    // Navigation stays quiet: a dot only where something waits on the owner or has stopped.
    // Setup progress itself lives on the overview checklist.
    cards:
      current.authorization.pendingRevocations.length > 0
        ? { hint: t("nav.hint.cardsWaiting"), tone: "risk" }
        : current.authorization.syncState !== "current" &&
            readiness === "ready" &&
            current.station.connected
          ? { hint: t("nav.hint.cardsWaiting"), tone: "warn" }
          : { tone: "idle" },
    overview:
      current.genesisPlan.state === "stop" || readiness === "blocked"
        ? { hint: t("nav.hint.attention"), tone: "risk" }
        : { tone: "idle" },
  };
}

function advancedTabTones(current: OwnerSnapshot): Partial<Record<AdvancedTab, Tone>> {
  const freedom = current.freedomTest.status;
  return {
    controls: current.sessions.some(({ status }) => status === "active") ? "live" : "idle",
    evidence: current.evidenceHistory.mode === "compacted-operational" ? "warn" : "idle",
    freedom: freedom === "failed" ? "risk" : freedom === "baseline-stale" ? "warn" : "idle",
    offline: current.readiness?.state === "blocked" ? "risk" : "idle",
    switching:
      current.migration.status === "blocked" || current.genesisPlan.state === "stop"
        ? "risk"
        : "idle",
  };
}

function FleetStatusPill({ fleet: summary }: { fleet: FleetSnapshot }) {
  return (
    <span class={`status-pill ${summary.totals.connected ? "connected" : "offline"}`}>
      <span class="signal-dot" aria-hidden="true" />
      {t("app.connectedCount", {
        connected: summary.totals.connected,
        total: summary.totals.stations,
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-in                                                             */
/* ------------------------------------------------------------------ */

function TokenGate() {
  const [value, setValue] = useState("");
  return (
    <div class="console-backdrop">
      <main class="token-gate">
        <div class="token-card glass">
          <BrandMark />
          <h1>{t("signin.title")}</h1>
          <p>{t("signin.body")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOwnerToken(value);
              void refreshFleet().then(refreshFleetExtras);
            }}
          >
            <div class="token-label">
              <label for="owner-token">{t("signin.token")}</label>
              <a class="text-link" href="/help?guide=owner-console#sign-in">
                {t("signin.where")}
              </a>
            </div>
            <input
              id="owner-token"
              type="password"
              value={value}
              minLength={32}
              autocomplete="current-password"
              aria-describedby="owner-token-hint"
              onInput={(event) => setValue(event.currentTarget.value)}
            />
            <p id="owner-token-hint" class="field-hint">
              {t("signin.tokenHint")}
            </p>
            <button class="button primary" type="submit" disabled={value.trim().length < 32}>
              {t("signin.open")}
            </button>
          </form>
          {notice.value && <div class="notice error">{notice.value.message}</div>}
          {/* One help link, beside the field it explains; the foot keeps only the language. */}
          <div class="token-foot">
            <LanguagePicker id="signin-language" />
          </div>
        </div>
      </main>
    </div>
  );
}
