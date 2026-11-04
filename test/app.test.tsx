// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
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
} from "../src/model.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";
import type { FleetSnapshot, OwnerSnapshot } from "../shared/contracts.js";
import type { OwnerDirectory } from "../shared/directory.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function signIn() {
  fireEvent.input(screen.getByLabelText("Owner token"), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole("button", { name: "Open console" }));
}

function openSection(name: string) {
  const nav = screen.getByRole("navigation", { name: "Console sections" });
  fireEvent.click(within(nav).getByRole("link", { name: new RegExp(`^${name}`) }));
}

function openTab(name: string) {
  const tabs = screen.getByRole("navigation", { name: "Station settings sections" });
  fireEvent.click(within(tabs).getByRole("link", { name: new RegExp(`^${name}`) }));
}

function visit(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function called(path: string): boolean {
  return vi.mocked(fetch).mock.calls.some(([candidate]) => candidate === path);
}

const OWNER_SNAPSHOT = {
  authorization: {
    acknowledgedTagPseudonyms: ["tag_stale_owner"],
    lastAttemptAt: "2026-08-14T11:58:00.000Z",
    lastAttemptRevision: 2,
    lastAttemptStatus: "Accepted",
    lastSyncAt: "2026-08-14T11:58:00.000Z",
    lastSyncRevision: 2,
    lastSyncStatus: "Accepted",
    pendingAdditions: ["tag_1234567890abcdef"],
    pendingRevocations: ["tag_stale_owner"],
    pendingRevision: null,
    syncState: "pending",
    tagCount: 1,
    tagPseudonyms: ["tag_1234567890abcdef"],
  },
  commands: [
    {
      commandId: "command-1",
      connectorId: null,
      observed: null,
      requestedAt: "2026-08-14T11:59:00.000Z",
      resetType: "Soft",
      resolvedAt: "2026-08-14T11:59:30.000Z",
      state: "uncertain",
      status: "timeout",
      tagPseudonym: null,
      transactionId: null,
      type: "Reset",
    },
  ],
  delegations: [],
  evidence: [],
  evidenceHistory: {
    custodyBundleCount: 0,
    custodiedEventCount: 0,
    mode: "complete",
  },
  freedomTest: {
    device: null,
    disclaimer:
      "Evidence completeness is not certification. Review physical evidence before publication.",
    run: null,
    schemaVersion: 3,
    status: "not-started",
    steps: [
      {
        evidence: [],
        externalEvidenceSha256: null,
        id: "authorization-synchronized",
        label: "Owner authorization list acknowledged",
        observedAt: null,
        source: "automatic",
        state: "pending",
      },
      {
        evidence: [],
        externalEvidenceSha256: null,
        id: "unknown-tag-rejected-offline",
        label: "Unknown tag rejected while backend and WAN were unavailable",
        observedAt: null,
        source: "witnessed",
        state: "pending",
      },
    ],
  },
  genesisPlan: {
    disclaimer:
      "This plan orders evidence and software actions; it is not permission for electrical work.",
    nextActions: [
      {
        actor: "owner",
        evidence: "external-sha256",
        execution: "owner-console",
        id: "record-device-inventory",
        instruction: "Record the exact evidenced device inventory.",
        migrationStepId: "exact-device-identity",
        safety: "ordinary",
      },
    ],
    phase: "pre-switch-evidence",
    schemaVersion: 1,
    state: "action-required",
  },
  migration: {
    authorization: null,
    disclaimer: "A ready dossier is not permission for electrical work or a liberation claim.",
    preSwitchReady: false,
    schemaVersion: 1,
    status: "collecting",
    steps: [
      {
        evidence: [],
        externalEvidenceSha256: null,
        gate: "pre-switch",
        id: "ownership-authority",
        label: "Owner authority over the exact charger is evidenced",
        observedAt: null,
        phase: "inventory",
        source: "owner-recorded",
        state: "pending",
      },
      {
        evidence: [],
        externalEvidenceSha256: null,
        gate: "post-switch",
        id: "authorized-boot-observed",
        label: "BootNotification was observed during the authorized change window",
        observedAt: null,
        phase: "online-proof",
        source: "protocol-derived",
        state: "pending",
      },
    ],
  },
  generatedAt: "2026-08-14T12:00:00.000Z",
  readiness: {
    checkedAt: "2026-08-14T12:00:00.000Z",
    checks: [],
    localListVersion: 3,
    state: "ready",
  },
  sessions: [
    {
      authorizationStatus: "Accepted",
      connectorId: 1,
      energyWh: 1_000,
      integrity: "conflict",
      meterStart: 10_000,
      meterStop: 11_000,
      replayedMessageCount: 3,
      startedAt: "2026-08-14T10:00:00.000Z",
      status: "complete",
      stoppedAt: "2026-08-14T10:30:00.000Z",
      tagPseudonym: "tag_1234567890abcdef",
      transactionId: 1,
    },
  ],
  station: {
    boot: {
      firmwareVersion: "7.1.0",
      model: "Eve Single S-line",
      vendor: "Alfen",
    },
    connected: true,
    connectedAt: "2026-08-14T11:59:00.000Z",
    connectors: [],
    id: "STATION_1",
    label: "Home charger",
    site: "Home",
  },
} as unknown as OwnerSnapshot;

const SINGLE_FLEET: FleetSnapshot = {
  // The company profile turns on shared access and records by default.
  console: { profile: "company" },
  generatedAt: "2026-08-14T12:00:00.000Z",
  stations: [
    {
      activeSessionCount: 0,
      attention: ["authorization-pending"],
      authorizationState: "pending",
      boot: { firmwareVersion: "7.1.0", model: "Eve Single S-line", vendor: "Alfen" },
      connected: true,
      connectedAt: "2026-08-14T11:59:00.000Z",
      connectorCount: 0,
      driver: null,
      energyWh: 1_000,
      id: "STATION_1",
      label: "Home charger",
      lastSessionAt: "2026-08-14T10:00:00.000Z",
      readiness: "ready",
      site: "Home",
    },
  ],
  totals: { activeSessions: 0, attentionRequired: 1, connected: 1, energyWh: 1_000, stations: 1 },
};

const EMPTY_DIRECTORY: OwnerDirectory = {
  cards: [
    {
      holderPersonId: null,
      name: null,
      stationId: "STATION_1",
      tagPseudonym: "tag_1234567890abcdef",
    },
  ],
  people: [],
  stations: [{ driverPersonId: null, id: "STATION_1", label: "Home charger", site: "Home" }],
  writable: true,
};

describe("owner console", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
    localStorage.clear();
    locale.value = "en";
    ownerToken.value = "";
    fleet.value = null;
    directory.value = null;
    selectedStationId.value = "";
    snapshot.value = null;
    loading.value = false;
    action.value = null;
    notice.value = null;
    issuedDelegate.value = null;
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens a multi-charger overview of chargers before drilling into one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path, init) => {
        if (path === "/api/v1/sync-ready") {
          if (init?.method === "POST") {
            return json({
              stations: [
                { listVersion: 7, outcome: "synced", stationId: "HOME_1" },
                { listVersion: null, outcome: "offline", stationId: "OFFICE_1" },
              ],
            });
          }
          return json({
            reviewId: "test-review",
            stations: [
              { additions: 1, removals: 0, state: "eligible", stationId: "HOME_1" },
              { additions: 1, removals: 0, state: "offline", stationId: "OFFICE_1" },
            ],
          });
        }
        if (path === "/api/v1/fleet") {
          return json({
            console: { profile: "company" },
            generatedAt: "2026-08-15T08:00:00.000Z",
            stations: [
              {
                activeSessionCount: 1,
                attention: ["migration-action"],
                authorizationState: "current",
                boot: null,
                connected: true,
                connectedAt: "2026-08-15T07:55:00.000Z",
                connectorCount: 1,
                driver: "Sofie Peeters",
                energyWh: 7_400,
                id: "HOME_1",
                label: "Driveway",
                lastSessionAt: "2026-08-15T07:30:00.000Z",
                readiness: "ready",
                site: "Home",
              },
              {
                activeSessionCount: 0,
                attention: ["offline", "continuity-unproven"],
                authorizationState: "never-synced",
                boot: null,
                connected: false,
                connectedAt: null,
                connectorCount: 0,
                energyWh: 0,
                id: "OFFICE_1",
                label: "Office bay 1",
                lastSessionAt: null,
                readiness: "not-inspected",
                site: "Brussels office",
              },
            ],
            totals: {
              activeSessions: 1,
              attentionRequired: 1,
              connected: 1,
              energyWh: 7_400,
              stations: 2,
            },
          });
        }
        if (path === "/api/v1/directory") {
          return json({
            cards: [
              {
                holderPersonId: "person_aaaaaaaaaaaaaaaaaaaaaaaa",
                name: "Blue fob",
                stationId: "HOME_1",
                tagPseudonym: "tag_aaaaaaaaaaaaaaaaaaaaaaaa",
              },
            ],
            people: [{ id: "person_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Sofie Peeters" }],
            stations: [
              {
                driverPersonId: "person_aaaaaaaaaaaaaaaaaaaaaaaa",
                id: "HOME_1",
                label: "Driveway",
                site: "Home",
              },
              {
                driverPersonId: null,
                id: "OFFICE_1",
                label: "Office bay 1",
                site: "Brussels office",
              },
            ],
            writable: true,
          } satisfies OwnerDirectory);
        }
        return json({
          ...OWNER_SNAPSHOT,
          station: { ...OWNER_SNAPSHOT.station, id: "HOME_1", label: "Driveway" },
        });
      }),
    );

    render(<App />);
    signIn();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Chargers" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review card sync" }));
    const review = within(screen.getByRole("dialog"));
    await review.findByText("Skipped · charger disconnected");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([path, init]) => path === "/api/v1/sync-ready" && init?.method === "POST",
        ),
    ).toBe(false);
    fireEvent.click(review.getByRole("button", { name: "Send to 1 charger" }));
    await review.findByText(/Charger accepted the list.*List version 7/);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.find(
          ([path, init]) => path === "/api/v1/sync-ready" && init?.method === "POST",
        )?.[1]?.body,
    ).toBe('{"reviewId":"test-review"}');
    fireEvent.click(review.getAllByRole("button", { name: "Close" }).at(-1)!);
    const list = screen.getByRole("list", { name: "Chargers" });
    const cards = [...list.querySelectorAll<HTMLElement>(":scope > li")];
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Driveway")).toBeTruthy();
    expect(within(cards[0]!).getByText("Sofie Peeters")).toBeTruthy();
    expect(within(cards[0]!).getByText("Blue fob")).toBeTruthy();
    // The routine switching signal is noise for a company that does not use that module.
    expect(within(cards[0]!).queryByText("Switching step open")).toBeNull();
    expect(within(cards[1]!).getByText("Office bay 1")).toBeTruthy();
    expect(within(cards[1]!).getByText("Offline charging not checked")).toBeTruthy();
    expect(screen.getByText("1 of 2 connected")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Console sections" });
    expect(within(nav).getByRole("link", { name: "Employees" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Usage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open connection help" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit names" })).toHaveLength(2);

    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Driveway", level: 1 })).toBeTruthy(),
    );
    expect(screen.getByRole("heading", { name: "What chargeOS knows" })).toBeTruthy();
  });

  it("keeps stale charging reports, acknowledged cards and field review independent", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const earlier = "2026-08-14T11:58:00.000Z";
    const connectedAt = "2026-08-14T11:59:00.000Z";
    const liveAt = "2026-08-14T11:59:30.000Z";
    const openSession = {
      ...OWNER_SNAPSHOT.sessions[0]!,
      status: "active",
      stoppedAt: null,
    } as const;
    const cached: OwnerSnapshot = {
      ...OWNER_SNAPSHOT,
      sessions: [openSession],
      station: {
        ...OWNER_SNAPSHOT.station,
        connectedAt,
        connectors: [
          { connectorId: 1, errorCode: "NoError", status: "Charging", updatedAt: earlier },
        ],
      },
    };
    let response = cached;
    let unavailable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        if (path === "/api/v1/fleet") return json(SINGLE_FLEET);
        if (path === "/api/v1/directory") return json(EMPTY_DIRECTORY);
        if (unavailable) throw new TypeError("Connection refused");
        return json(response);
      }),
    );

    render(<App />);
    signIn();
    const status = within(await screen.findByRole("region", { name: "What chargeOS knows" }));
    expect(status.getByText("Unknown")).toBeTruthy();
    expect(status.queryByRole("button", { name: "Stop charging" })).toBeNull();
    expect(status.getByText("1 removed card may still work at the charger")).toBeTruthy();
    expect(status.getByText("Not verified")).toBeTruthy();

    response = {
      ...cached,
      sessions: [{ ...openSession, startedAt: liveAt }],
      station: {
        ...cached.station,
        connectors: [
          { connectorId: 1, errorCode: "NoError", status: "Charging", updatedAt: liveAt },
        ],
      },
    };
    await waitFor(() => {
      fireEvent.click(status.getByRole("button", { name: "Refresh status" }));
      expect(status.getByText("Connector 1 reports charging")).toBeTruthy();
    });
    expect(status.getByRole("button", { name: "Stop charging" })).toBeTruthy();

    unavailable = true;
    await waitFor(() => {
      fireEvent(document, new Event("visibilitychange"));
      expect(status.getByText(/The console couldn’t refresh/)).toBeTruthy();
    });
    expect(status.getByText("Unknown")).toBeTruthy();
    expect(status.queryByRole("button", { name: "Stop charging" })).toBeNull();
    expect(status.getByText("Changes waiting for the charger")).toBeTruthy();
    expect(status.getByText("Not verified")).toBeTruthy();

    unavailable = false;
    response = {
      ...response,
      station: { ...response.station, connected: false, connectedAt: null },
    };
    await waitFor(() => {
      fireEvent(document, new Event("visibilitychange"));
      expect(status.getByText("No live status from the charger.")).toBeTruthy();
    });
    expect(status.getByText("Unknown")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the connection guide" }).getAttribute("href"),
    ).toBe("/help?guide=connect-a-charger");
  });

  it("keeps everyday tasks simple and technical tools in station settings", async () => {
    let savedDirectory = EMPTY_DIRECTORY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path, init) => {
        if (path === "/api/v1/fleet") return json(SINGLE_FLEET);
        if (path === "/api/v1/directory") return json(savedDirectory);
        if (path === "/api/v1/stations/STATION_1/owner-tags" && init?.method === "POST") {
          return json({ tagCount: 2, tagPseudonym: "tag_abcdef1234567890abcdef12" }, 201);
        }
        if (
          path === "/api/v1/stations/STATION_1/cards/tag_abcdef1234567890abcdef12" &&
          init?.method === "POST"
        ) {
          savedDirectory = {
            ...EMPTY_DIRECTORY,
            cards: [
              ...EMPTY_DIRECTORY.cards,
              {
                holderPersonId: null,
                name: "Blue fob",
                stationId: "STATION_1",
                tagPseudonym: "tag_abcdef1234567890abcdef12",
              },
            ],
          };
          return json(savedDirectory);
        }
        if (
          path === "/api/v1/stations/STATION_1/prepare-owner-continuity" &&
          init?.method === "POST"
        ) {
          return json({
            assessment: {
              checkedAt: "2026-08-14T12:00:00.000Z",
              checks: [],
              localListVersion: 3,
              restartRequired: false,
              state: "ready",
            },
            changes: [],
            state: "ready",
          });
        }
        if (path === "/api/v1/stations/STATION_1/delegations" && init?.method === "POST") {
          return json(
            {
              grant: {
                createdAt: "2026-08-14T12:00:00.000Z",
                expiresAt: "2026-08-15T12:00:00.000Z",
                grantId: "12345678-1234-4123-8123-123456789abc",
                revokedAt: null,
                role: "employer",
                scopes: ["sessions:read"],
                status: "active",
                tokenHint: "…abc123",
              },
              token: "chgdel.12345678-1234-4123-8123-123456789abc.one-time-secret",
            },
            201,
          );
        }
        return json(OWNER_SNAPSHOT);
      }),
    );

    render(<App />);
    signIn();

    // A single charger opens on its overview, in plain language.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Home charger", level: 1 })).toBeTruthy(),
    );
    expect(screen.getByRole("heading", { name: "What chargeOS knows" })).toBeTruthy();
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByText(/Only a test at the charger/)).toBeTruthy();
    expect(screen.getByText("Changes waiting for the charger")).toBeTruthy();
    // The company profile leaves switching and the Freedom Test out of the overview.
    expect(screen.queryByText("Field test not started")).toBeNull();
    expect(screen.getByText("Nobody else has access")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();

    // Cards: pending removals stay visible and the raw identifier is never rendered.
    openSection("RFID cards");
    expect(screen.getByText("1 removed card may still work at the charger")).toBeTruthy();
    expect(screen.getByText("2 changes are waiting to be sent to the charger")).toBeTruthy();
    expect(screen.getByText("Unnamed card")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    // Tapping the card is the default; typing the number is one click away.
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Type the card number instead",
      }),
    );
    const addDialog = screen.getByRole("dialog");
    fireEvent.input(within(addDialog).getByLabelText("Card number"), {
      target: { value: "second-owner-tag" },
    });
    fireEvent.input(within(addDialog).getByLabelText("Card name"), {
      target: { value: "Blue fob" },
    });
    fireEvent.click(within(addDialog).getByRole("button", { name: "Add card" }));
    await waitFor(() => expect(called("/api/v1/stations/STATION_1/owner-tags")).toBe(true));
    await waitFor(() =>
      expect(called("/api/v1/stations/STATION_1/cards/tag_abcdef1234567890abcdef12")).toBe(true),
    );
    const addRequest = vi
      .mocked(fetch)
      .mock.calls.find(([path]) => path === "/api/v1/stations/STATION_1/owner-tags");
    expect(JSON.parse(String(addRequest?.[1]?.body))).toEqual({ tag: "second-owner-tag" });
    const nameRequest = vi
      .mocked(fetch)
      .mock.calls.find(
        ([path]) => path === "/api/v1/stations/STATION_1/cards/tag_abcdef1234567890abcdef12",
      );
    // The name travels separately from the card number and never contains it.
    expect(JSON.parse(String(nameRequest?.[1]?.body))).toEqual({
      holderPersonId: null,
      name: "Blue fob",
    });
    await waitFor(() => expect(screen.getByText(/Card added\. Send the card list/)).toBeTruthy());
    expect(screen.queryByText("second-owner-tag")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    snapshot.value = {
      ...snapshot.value!,
      authorization: {
        ...snapshot.value!.authorization,
        tagCount: 2,
        tagPseudonyms: ["tag_1234567890abcdef", "tag_abcdef1234567890abcdef12"],
      },
    };
    await waitFor(() => expect(screen.getByText("Blue fob")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    const removeDialog = screen.getByRole("dialog", { name: "Remove Blue fob?" });
    const removeButton = within(removeDialog).getByRole("button", {
      name: "Remove card",
    }) as HTMLButtonElement;
    expect(removeButton.disabled).toBe(true);
    fireEvent.click(within(removeDialog).getByRole("checkbox"));
    fireEvent.click(removeButton);
    await waitFor(() =>
      expect(
        called("/api/v1/stations/STATION_1/owner-tags/tag_abcdef1234567890abcdef12/revoke"),
      ).toBe(true),
    );
    const revokeRequest = vi
      .mocked(fetch)
      .mock.calls.find(
        ([path]) =>
          path === "/api/v1/stations/STATION_1/owner-tags/tag_abcdef1234567890abcdef12/revoke",
      );
    expect(JSON.parse(String(revokeRequest?.[1]?.body))).toEqual({
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    await waitFor(() => expect(screen.getByText(/may keep working at the charger/)).toBeTruthy());
    // Let the background refresh land before overriding the snapshot.
    await waitFor(() => expect(action.value).toBeNull());
    await waitFor(() => expect(loading.value).toBe(false));

    // Station settings hold the technical tools.
    openSection("Station settings");
    expect(screen.getByRole("heading", { name: "Station settings", level: 1 })).toBeTruthy();
    snapshot.value = {
      ...snapshot.value!,
      readiness: { ...snapshot.value!.readiness!, restartRequired: false, state: "blocked" },
    };
    const preparationPhrase = await screen.findByLabelText(/Type this exact phrase to confirm/);
    fireEvent.input(preparationPhrase, { target: { value: CONTINUITY_PREPARATION_PHRASE } });
    const prepareButton = screen.getByRole("button", {
      name: "Change offline settings",
    }) as HTMLButtonElement;
    await waitFor(() => expect(prepareButton.disabled).toBe(false));
    fireEvent.click(prepareButton);
    await waitFor(() =>
      expect(called("/api/v1/stations/STATION_1/prepare-owner-continuity")).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Change offline settings" })).toBeNull(),
    );

    openTab("Sessions");
    expect(screen.getByText("3 repeated messages")).toBeTruthy();
    expect(screen.getByText("conflicting data")).toBeTruthy();

    snapshot.value = {
      ...snapshot.value!,
      station: {
        ...snapshot.value!.station,
        connectors: [
          {
            connectorId: 1,
            status: "Available",
            errorCode: "NoError",
            updatedAt: OWNER_SNAPSHOT.generatedAt,
          },
          {
            connectorId: 2,
            status: "Available",
            errorCode: "NoError",
            updatedAt: OWNER_SNAPSHOT.generatedAt,
          },
        ],
      },
    };
    openTab("Remote control");
    expect(screen.getByText("Command history")).toBeTruthy();
    expect(screen.getByText("uncertain")).toBeTruthy();
    const startControls = within(screen.getByRole("form", { name: "Start charging" }));
    fireEvent.change(startControls.getByLabelText("Connector"), { target: { value: "2" } });
    expect(startControls.getByRole("button", { name: "Start on connector 2" })).toBeTruthy();
    const availability = within(screen.getByRole("form", { name: "Connector availability" }));
    // The fixture reports connector 1 as available, so there is nothing to change.
    expect(
      (availability.getByRole("button", { name: "Already available" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Commands for Home charger.")).toBeTruthy();
    const maintenance = screen.getByText("Maintenance").closest("details")!;
    expect(maintenance.open).toBe(false);
    maintenance.open = true;
    expect((screen.getByRole("button", { name: "Restart" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    openTab("Shared access");
    fireEvent.change(screen.getByLabelText("Who is it for"), { target: { value: "employer" } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create access" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create access" }));
    await waitFor(() => expect(screen.getByText(/chgdel\.12345678.*one-time-secret/)).toBeTruthy());
    expect(screen.getByText("Copy this secret now")).toBeTruthy();
    await waitFor(() => expect(action.value).toBeNull());
    await waitFor(() => expect(loading.value).toBe(false));
  });

  it("keeps switching and the Freedom Test in reviewed English with their safety gates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        if (path === "/api/v1/fleet") return json(SINGLE_FLEET);
        if (path === "/api/v1/directory") return json(EMPTY_DIRECTORY);
        return json(OWNER_SNAPSHOT);
      }),
    );
    locale.value = "nl";

    render(<App />);
    fireEvent.input(screen.getByLabelText("Eigenaarstoken"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Console openen" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Home charger", level: 1 })).toBeTruthy(),
    );
    expect(document.documentElement.lang).toBe("nl");

    visit("#/advanced/freedom");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Field test not started" })).toBeTruthy(),
    );
    expect(screen.getByText(/alleen in het Engels/)).toBeTruthy();
    expect(screen.getByText(/Evidence completeness is not certification/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export field review pack" })).toBeTruthy();

    visit("#/advanced/switching");
    await waitFor(() =>
      expect(screen.getByText("Collecting reversible-migration evidence")).toBeTruthy(),
    );
    expect(screen.getByText("Next safe action")).toBeTruthy();
    expect(screen.getByText("record-device-inventory")).toBeTruthy();
    expect(screen.getByText(/Locked until every pre-switch checkpoint passes/)).toBeTruthy();

    visit("#/advanced/switching");
    fireEvent.input(
      await screen.findByLabelText(
        "Evidence SHA-256 for Owner authority over the exact charger is evidenced",
      ),
      { target: { value: "b".repeat(64) } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm checkpoint: Owner authority over the exact charger is evidenced",
      }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([path]) =>
              path === "/api/v1/stations/STATION_1/migration/checkpoints/ownership-authority",
          ),
      ).toBe(true),
    );

    visit("#/advanced/freedom");
    fireEvent.input(await screen.findByLabelText("Article number"), {
      target: { value: "904460023" },
    });
    fireEvent.input(screen.getByLabelText("Hardware revision"), {
      target: { value: "NG910" },
    });
    fireEvent.input(screen.getByLabelText("Inventory vendor"), {
      target: { value: "Alfen" },
    });
    fireEvent.input(screen.getByLabelText("Inventory model"), {
      target: { value: "Eve Single S-line" },
    });
    fireEvent.input(screen.getByLabelText("Inventory firmware"), {
      target: { value: "7.1.0" },
    });
    fireEvent.input(screen.getByLabelText("Prior operator"), {
      target: { value: "Synthetic operator" },
    });
    fireEvent.input(screen.getByLabelText("Endpoint configuration path"), {
      target: { value: "ACE > Connectivity > Backoffice" },
    });
    fireEvent.input(screen.getByLabelText("Inventory evidence SHA-256"), {
      target: { value: "d".repeat(64) },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save exact device identity" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save exact device identity" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([path]) => path === "/api/v1/stations/STATION_1/freedom-test/device"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Exact device metadata added to the hash-chained field record."),
      ).toBeTruthy(),
    );

    snapshot.value = {
      ...snapshot.value!,
      freedomTest: {
        ...snapshot.value!.freedomTest,
        run: {
          authorizedBoot: { eventId: "boot-event", recordHash: null },
          deviceInventory: { eventId: "inventory-event", recordHash: null },
          migrationAuthorization: { eventId: "authorization-event", recordHash: null },
          runId: "12345678-1234-4123-8123-123456789abc",
          startedAt: "2026-08-14T12:00:00.000Z",
          state: "active",
        },
        status: "in-progress",
      },
    };

    // Witness controls appear only once a bound field run is active.
    fireEvent.input(
      await screen.findByLabelText(
        "Evidence SHA-256 for Unknown tag rejected while backend and WAN were unavailable",
      ),
      { target: { value: "a".repeat(64) } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Record pass" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([path]) =>
              path ===
              "/api/v1/stations/STATION_1/freedom-test/observations/unknown-tag-rejected-offline",
          ),
      ).toBe(true),
    );
    await waitFor(() => expect(action.value).toBeNull());
    // Earlier actions refresh in the background; let them land before overriding the snapshot.
    await waitFor(() => expect(loading.value).toBe(false));

    snapshot.value = {
      ...snapshot.value!,
      migration: {
        ...snapshot.value!.migration,
        preSwitchReady: true,
        status: "ready-for-owner-confirmation",
      },
    };
    visit("#/advanced/switching");
    const manifestContents = '{"format":"chargeos-migration-target"}\n';
    const manifestFile = new File([manifestContents], "alfen-target.json", {
      type: "application/json",
    });
    Object.defineProperty(manifestFile, "text", {
      value: async () => manifestContents,
    });
    fireEvent.change(await screen.findByLabelText(/Canonical target manifest/), {
      target: { files: [manifestFile] },
    });
    fireEvent.input(screen.getByLabelText(/Type this exact authorization phrase/), {
      target: { value: "I authorize the documented reversible endpoint change" },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Authorize documented endpoint-change window",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Authorize documented endpoint-change window" }),
    );
    await waitFor(() => {
      const request = vi
        .mocked(fetch)
        .mock.calls.find(([path]) => path === "/api/v1/stations/STATION_1/migration/authorize");
      expect(request).toBeTruthy();
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        targetManifest: manifestContents,
        transport: "isolated-lan-ws",
      });
    });
  });
});
