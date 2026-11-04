// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FleetSnapshot, OwnerSnapshot, UsageReport } from "../shared/contracts.js";
import { FREEDOM_TEST_SCHEMA_VERSION } from "../shared/freedom-test.js";
import { GENESIS_PLAN_SCHEMA_VERSION } from "../shared/genesis.js";
import { MIGRATION_SCHEMA_VERSION } from "../shared/migration.js";
import { App } from "../src/app.js";
import { chosenModules } from "../src/console-modules.js";
import { locale } from "../src/i18n/index.js";
import {
  action,
  directory,
  fleet,
  issuedDelegate,
  loading,
  notice,
  ownerToken,
  selectedStationId,
  snapshot,
  usageReport,
} from "../src/model.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";
const NOW = new Date("2026-10-20T12:00:00.000Z");

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function station(
  id: string,
  label: string,
  driver: string | null,
): FleetSnapshot["stations"][number] {
  return {
    activeSessionCount: 0,
    attention: [],
    authorizationState: "current",
    boot: null,
    connected: true,
    connectedAt: "2026-10-20T08:00:00.000Z",
    connectorCount: 1,
    driver,
    energyWh: 0,
    id,
    label,
    lastSessionAt: null,
    readiness: "ready",
    site: "Home",
  };
}

function fleetSnapshot(
  profile: "personal" | "company",
  stations: FleetSnapshot["stations"],
): FleetSnapshot {
  return {
    console: { profile },
    generatedAt: NOW.toISOString(),
    stations,
    totals: {
      activeSessions: 0,
      attentionRequired: 0,
      connected: stations.length,
      energyWh: 0,
      stations: stations.length,
    },
  };
}

function ownerSnapshot(
  overrides: {
    activeDelegate?: boolean;
    freedomStatus?: OwnerSnapshot["freedomTest"]["status"];
    migrationStatus?: OwnerSnapshot["migration"]["status"];
    planState?: OwnerSnapshot["genesisPlan"]["state"];
  } = {},
): OwnerSnapshot {
  const completed = (transactionId: number, startedAt: string, energyWh: number, tag: string) => ({
    authorizationStatus: "Accepted" as const,
    connectorId: 1,
    energyWh,
    integrity: "consistent" as const,
    latestMeterReading: null,
    meterStart: 0,
    meterStop: energyWh,
    replayedMessageCount: 0,
    startedAt,
    status: "complete" as const,
    stoppedAt: startedAt,
    tagPseudonym: tag,
    transactionId,
  });
  return {
    cardCapture: { state: "idle", tagPseudonym: null, tappedAt: null, until: null },
    authorization: {
      acknowledgedTagPseudonyms: ["tag_owner"],
      lastAttemptAt: null,
      lastAttemptRevision: 1,
      lastAttemptStatus: "Accepted",
      lastSyncAt: null,
      lastSyncRevision: 1,
      lastSyncStatus: "Accepted",
      pendingAdditions: [],
      pendingRevocations: [],
      pendingRevision: null,
      syncState: "current",
      tagCount: 1,
      tagPseudonyms: ["tag_owner"],
    },
    commands: [],
    delegations: overrides.activeDelegate
      ? [
          {
            createdAt: "2026-10-19T12:00:00.000Z",
            expiresAt: "2026-11-19T12:00:00.000Z",
            grantId: "12345678-1234-4123-8123-123456789abc",
            revokedAt: null,
            role: "employer",
            scopes: ["sessions:read"],
            status: "active",
            tokenHint: "…abc123",
          },
        ]
      : [],
    evidence: [],
    evidenceHistory: { custodyBundleCount: 0, custodiedEventCount: 0, mode: "complete" },
    freedomTest: {
      device: null,
      disclaimer: "Evidence completeness is not certification.",
      run: null,
      schemaVersion: FREEDOM_TEST_SCHEMA_VERSION,
      status: overrides.freedomStatus ?? "not-started",
      steps: [],
    },
    generatedAt: NOW.toISOString(),
    genesisPlan: {
      disclaimer: "Not permission for electrical work.",
      nextActions: [],
      phase: "pre-switch-evidence",
      schemaVersion: GENESIS_PLAN_SCHEMA_VERSION,
      state: overrides.planState ?? "action-required",
    },
    migration: {
      authorization: null,
      disclaimer: "Not permission for electrical work.",
      preSwitchReady: false,
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      status: overrides.migrationStatus ?? "collecting",
      steps: [],
    },
    readiness: {
      checkedAt: NOW.toISOString(),
      checks: [],
      localListVersion: 1,
      restartRequired: false,
      state: "ready",
    },
    sessions: [
      completed(3, "2026-10-18T18:00:00.000Z", 12_400, "tag_owner"),
      completed(2, "2026-10-04T18:00:00.000Z", 2_000, "tag_guest"),
      completed(1, "2026-09-12T18:00:00.000Z", 9_000, "tag_owner"),
    ],
    station: {
      boot: null,
      connected: true,
      connectedAt: NOW.toISOString(),
      connection: {
        acceptedAlias: null,
        aliasCandidate: null,
        endpointBase: null,
        lastRefused: null,
        lastUnmatchedAt: null,
        refusedSinceStart: 0,
        unmatchedSinceStart: 0,
      },
      connectors: [],
      driver: null,
      id: "HOME_1",
      label: "Driveway",
      site: "Home",
    },
  };
}

function navLinks(name = "Console sections"): string[] {
  const nav = screen.getByRole("navigation", { name });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

function visit(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** The station-settings tabs currently offered, read from the tab strip. */
async function settingsTabs(): Promise<string[]> {
  visit("#/advanced/details");
  const tabs = await screen.findByRole("navigation", { name: "Station settings sections" });
  return within(tabs)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

const EVERYDAY_TABS = ["Offline charging", "Remote control", "Sessions", "Details"];

async function openConsole() {
  render(<App />);
  fireEvent.input(screen.getByLabelText("Owner token"), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole("button", { name: "Open console" }));
}

describe("console profiles", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
    localStorage.clear();
    locale.value = "en";
    chosenModules.value = null;
    ownerToken.value = "";
    fleet.value = null;
    directory.value = null;
    selectedStationId.value = "";
    snapshot.value = null;
    loading.value = false;
    action.value = null;
    notice.value = null;
    issuedDelegate.value = null;
    usageReport.value = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a personal console on usage and keeps power-user modules optional", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/v1/fleet"
          ? json(fleetSnapshot("personal", [station("HOME_1", "Driveway", null)]))
          : json(ownerSnapshot()),
      ),
    );
    await openConsole();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your charging" })).toBeTruthy(),
    );
    const usage = screen.getByRole("region", { name: "Your charging" });
    // 12.4 kWh + 2.0 kWh in October, 9.0 kWh in September.
    expect(within(usage).getByText("14.4 kWh", { selector: ".usage-tile strong" })).toBeTruthy();
    expect(within(usage).getByText("9.0 kWh", { selector: ".usage-tile strong" })).toBeTruthy();
    expect(within(usage).getByText("This month by card")).toBeTruthy();
    // Without saved names, cards fall back to a short anonymous reference.
    expect(within(usage).getByText("Unnamed card · guest")).toBeTruthy();

    expect(navLinks()).toEqual(["Overview", "Chargers", "People", "Cards", "Station settings"]);
    expect(screen.queryByText("Next safe action")).toBeNull();

    fireEvent.click(within(usage).getByRole("button", { name: "Show table" }));
    expect(within(usage).getByRole("cell", { name: "14.4 kWh" })).toBeTruthy();

    expect(await settingsTabs()).toEqual(EVERYDAY_TABS);

    fireEvent.click(screen.getByRole("link", { name: "Preferences" }));
    expect(screen.getByRole("heading", { name: "Preferences", level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Switching provider/ }));
    expect(JSON.parse(localStorage.getItem("chargeos.consoleModules") ?? "null")).toEqual([
      "liberation",
    ]);
    expect(await settingsTabs()).toEqual([...EVERYDAY_TABS, "Switching provider", "Freedom Test"]);

    fireEvent.click(screen.getByRole("link", { name: "Preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Use profile defaults" }));
    expect(localStorage.getItem("chargeos.consoleModules")).toBeNull();
    expect(await settingsTabs()).toEqual(EVERYDAY_TABS);
  });

  it("switches the console language and remembers it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/v1/fleet"
          ? json(fleetSnapshot("company", [station("HOME_1", "Driveway", "Alice Peeters")]))
          : json(ownerSnapshot()),
      ),
    );
    await openConsole();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your charging" })).toBeTruthy(),
    );

    // The language picker lives in Preferences once signed in.
    fireEvent.click(screen.getByRole("link", { name: "Preferences" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "nl" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Overzicht" }));
    expect(localStorage.getItem("chargeos.locale")).toBe("nl");
    expect(document.documentElement.lang).toBe("nl");
    expect(navLinks("Onderdelen van de console")).toEqual([
      "Overzicht",
      "Laadpalen",
      "Werknemers",
      "Laadpassen",
      "Verbruik",
      "Laadpaalinstellingen",
    ]);
    expect(screen.getByRole("heading", { name: "Jouw laadbeurten" })).toBeTruthy();
    // Belgian number formatting.
    expect(screen.getByText("14,4 kWh", { selector: ".usage-tile strong" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Voorkeuren" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Taal" }), { target: { value: "fr" } });
    fireEvent.click(screen.getByRole("link", { name: "Aperçu" }));
    expect(localStorage.getItem("chargeos.locale")).toBe("fr");
    expect(navLinks("Sections de la console")).toContain("Collaborateurs");
    expect(screen.getByRole("heading", { name: "Vos recharges" })).toBeTruthy();
  });

  it("keeps a hidden module reachable while it needs the owner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/v1/fleet"
          ? json(fleetSnapshot("personal", [station("HOME_1", "Driveway", null)]))
          : json(ownerSnapshot({ migrationStatus: "blocked" })),
      ),
    );
    await openConsole();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your charging" })).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: "Station settings, needs attention" })).toBeTruthy();
    // Both pages of the switching module return together.
    const tabs = await settingsTabs();
    expect(tabs).toContain("Switching provider");
    expect(tabs).toContain("Freedom Test");
    expect(tabs).not.toContain("Shared access");
  });

  it("never hides live shared access or a stopped switching plan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/v1/fleet"
          ? json(fleetSnapshot("personal", [station("HOME_1", "Driveway", null)]))
          : json(
              ownerSnapshot({
                activeDelegate: true,
                freedomStatus: "baseline-stale",
                migrationStatus: "online-path-observed-unreviewed",
                planState: "stop",
              }),
            ),
      ),
    );
    await openConsole();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your charging" })).toBeTruthy(),
    );
    expect(screen.getByText("Stop: a problem was recorded")).toBeTruthy();
    expect(screen.getByText("1 person has read access")).toBeTruthy();
    expect(await settingsTabs()).toEqual([
      ...EVERYDAY_TABS,
      "Shared access",
      "Switching provider",
      "Freedom Test",
    ]);
    visit("#/advanced/switching");
    expect(
      await screen.findByRole("heading", { name: "Stop condition — preserve evidence" }),
    ).toBeTruthy();
  });

  it("reports company usage per employee and exports it", async () => {
    const report: UsageReport = {
      drivers: [
        { driver: "Alice Peeters", energyWh: 14_400, sessionCount: 2, stationIds: ["HOME_1"] },
        { driver: null, energyWh: 0, sessionCount: 0, stationIds: ["OFFICE_1"] },
      ],
      generatedAt: NOW.toISOString(),
      month: "2026-10",
      profile: "company",
      stations: [
        {
          driver: "Alice Peeters",
          energyWh: 14_400,
          id: "HOME_1",
          label: "Driveway",
          sessionCount: 2,
          sessions: [
            {
              energyWh: 14_400,
              integrity: "consistent",
              startedAt: "2026-10-18T18:00:00.000Z",
              status: "complete",
              stoppedAt: "2026-10-18T21:00:00.000Z",
              tagPseudonym: "tag_owner",
              transactionId: 3,
            },
            {
              energyWh: null,
              integrity: "consistent",
              startedAt: "2026-10-20T10:00:00.000Z",
              status: "active",
              stoppedAt: null,
              tagPseudonym: "tag_owner",
              transactionId: 4,
            },
          ],
          site: "Leuven",
        },
        {
          driver: null,
          energyWh: 0,
          id: "OFFICE_1",
          label: "Office bay 1",
          sessionCount: 0,
          sessions: [],
          site: "Brussels",
        },
      ],
      timeZone: "Europe/Brussels",
      totals: { conflictSessions: 0, energyWh: 14_400, openSessions: 1, sessionCount: 2 },
    };
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        requested.push(path);
        if (path === "/api/v1/fleet") {
          return json(
            fleetSnapshot("company", [
              station("HOME_1", "Driveway", "Alice Peeters"),
              station("OFFICE_1", "Office bay 1", null),
            ]),
          );
        }
        if (path.startsWith("/api/v1/usage?")) return json(report);
        return json(ownerSnapshot());
      }),
    );
    const created: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          created.push(blob);
          return "blob:usage";
        },
        revokeObjectURL: () => undefined,
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await openConsole();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Chargers" })).toBeTruthy());
    expect(screen.getByText("Alice Peeters")).toBeTruthy();
    expect(screen.getByText("Not assigned")).toBeTruthy();
    expect(navLinks()).toEqual([
      "Overview",
      "Chargers2/2",
      "Employees",
      "Cards",
      "Usage",
      "Station settings",
    ]);
    // Company defaults: sharing and records on, switching off.
    expect(await settingsTabs()).toEqual([...EVERYDAY_TABS, "Shared access", "Records"]);

    fireEvent.click(screen.getByRole("link", { name: "Usage" }));
    expect(screen.getByRole("heading", { name: "Usage per employee", level: 1 })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Usage by person" })).toBeTruthy(),
    );
    expect(requested.find((path) => path.startsWith("/api/v1/usage?"))).toMatch(
      /^\/api\/v1\/usage\?month=2026-10&timeZone=/u,
    );
    const drivers = screen.getByRole("table", { name: "Usage by person" });
    expect(within(drivers).getByText("Alice Peeters")).toBeTruthy();
    expect(within(drivers).getByText("14.4 kWh")).toBeTruthy();
    expect(screen.getByText(/1 session is still charging/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(click).toHaveBeenCalledOnce();
    const csv = await created[0]!.text();
    expect(csv).toContain(`"2026-10","Alice Peeters","HOME_1","Driveway","Leuven","HOME_1:3","3",`);
    expect(csv).toContain(`,"in-progress","consistent","tag_owner"`);
    click.mockRestore();
  });
});
