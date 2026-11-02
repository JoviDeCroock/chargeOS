// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import {
  action,
  fleet,
  issuedDelegate,
  loading,
  notice,
  ownerToken,
  selectedStationId,
  snapshot,
} from "../src/model.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";

function openSection(name: string) {
  const nav = screen.getByRole("navigation", { name: "Console sections" });
  fireEvent.click(within(nav).getByRole("link", { name: new RegExp(`^${name}`) }));
}

describe("owner console", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
    ownerToken.value = "";
    fleet.value = null;
    selectedStationId.value = "";
    snapshot.value = null;
    loading.value = false;
    action.value = null;
    notice.value = null;
    issuedDelegate.value = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens a multi-charger fleet overview before drilling into a charger", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        if (path === "/api/v1/fleet") {
          return new Response(
            JSON.stringify({
              generatedAt: "2026-08-15T08:00:00.000Z",
              stations: [
                {
                  activeSessionCount: 1,
                  attention: [],
                  authorizationState: "current",
                  boot: null,
                  connected: true,
                  connectedAt: "2026-08-15T07:55:00.000Z",
                  connectorCount: 1,
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
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            generatedAt: "2026-08-15T08:00:00.000Z",
            station: { id: "HOME_1", label: "Driveway", site: "Home" },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );

    render(<App />);
    fireEvent.input(screen.getByLabelText("Owner API token"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Open owner console" }));

    await waitFor(() => expect(screen.getByText("Every charger. One owner.")).toBeTruthy());
    expect(screen.getByText("Driveway")).toBeTruthy();
    expect(screen.getByText("Office bay 1")).toBeTruthy();
    expect(screen.getByText("1 of 2 connected")).toBeTruthy();
    expect(screen.getByText("Offline readiness unproven")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Manage" })).toHaveLength(2);
    expect(screen.queryByText("Your charger remains yours.")).toBeNull();
  });

  it("opens the authenticated dashboard without presenting software checks as field proof", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path, init) => {
        if (path === "/api/v1/fleet") {
          return new Response(
            JSON.stringify({
              generatedAt: "2026-08-14T12:00:00.000Z",
              stations: [
                {
                  activeSessionCount: 0,
                  attention: ["authorization-pending"],
                  authorizationState: "pending",
                  boot: {
                    firmwareVersion: "7.1.0",
                    model: "Eve Single S-line",
                    vendor: "Alfen",
                  },
                  connected: true,
                  connectedAt: "2026-08-14T11:59:00.000Z",
                  connectorCount: 0,
                  energyWh: 1_000,
                  id: "STATION_1",
                  label: "Home charger",
                  lastSessionAt: "2026-08-14T10:00:00.000Z",
                  readiness: "ready",
                  site: "Home",
                },
              ],
              totals: {
                activeSessions: 0,
                attentionRequired: 1,
                connected: 1,
                energyWh: 1_000,
                stations: 1,
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        if (
          path === "/api/v1/stations/STATION_1/prepare-owner-continuity" &&
          init?.method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              assessment: {
                checkedAt: "2026-08-14T12:00:00.000Z",
                checks: [],
                localListVersion: 3,
                restartRequired: false,
                state: "ready",
              },
              changes: [],
              state: "ready",
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        if (path === "/api/v1/stations/STATION_1/delegations" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
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
            }),
            { headers: { "content-type": "application/json" }, status: 201 },
          );
        }
        return new Response(
          JSON.stringify({
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
              disclaimer:
                "A ready dossier is not permission for electrical work or a liberation claim.",
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
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }),
    );

    render(<App />);
    fireEvent.input(screen.getByLabelText("Owner API token"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Open owner console" }));

    await waitFor(() => expect(screen.getByText("Your charger remains yours.")).toBeTruthy());
    expect(screen.getByText("Software prerequisites pass")).toBeTruthy();
    expect(screen.getByText("Physical offline and restart tests are still required.")).toBeTruthy();
    expect(screen.getByText("Next safe action")).toBeTruthy();
    expect(screen.getByText("record-device-inventory")).toBeTruthy();
    // The overview summarizes every section without presenting a software result as field proof.
    expect(screen.getByText("Field test not started")).toBeTruthy();
    expect(screen.getByText("Changes waiting for the charger")).toBeTruthy();

    openSection("Freedom Test");
    expect(screen.getByRole("heading", { name: "Field test not started" })).toBeTruthy();
    expect(screen.getByText(/Evidence completeness is not certification/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export field review pack" })).toBeTruthy();

    openSection("Liberate my charger");
    expect(screen.getByText("Collecting reversible-migration evidence")).toBeTruthy();
    expect(screen.getByText(/Locked until every pre-switch checkpoint passes/)).toBeTruthy();

    openSection("Charging");
    expect(screen.getByText("3 exact retries")).toBeTruthy();
    expect(screen.getByText("evidence conflict")).toBeTruthy();
    expect(screen.getByText("Remote commands")).toBeTruthy();
    expect(screen.getByText("uncertain")).toBeTruthy();
    expect(screen.getByText(/never switches a charger off/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restart" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    openSection("RFID cards");
    expect(screen.getByText("Owner access changes are pending")).toBeTruthy();
    expect(screen.getByText(/1 removed owner tag may still authorize locally/)).toBeTruthy();
    expect(screen.getByText(/1 configured owner tag is not yet acknowledged/)).toBeTruthy();
    expect(screen.queryByText("raw-owner-tag")).toBeNull();

    fireEvent.input(screen.getByLabelText("Add owner RFID identifier"), {
      target: { value: "second-owner-tag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add desired tag" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([path]) => path === "/api/v1/stations/STATION_1/owner-tags"),
      ).toBe(true),
    );
    expect(screen.queryByText("second-owner-tag")).toBeNull();
    await waitFor(() =>
      expect(screen.getByText(/Owner tag added to durable desired state/)).toBeTruthy(),
    );

    snapshot.value = {
      ...snapshot.value!,
      authorization: {
        ...snapshot.value!.authorization,
        tagCount: 2,
        tagPseudonyms: ["tag_1234567890abcdef", "tag_abcdef1234567890abcdef12"],
      },
    };
    fireEvent.input(
      await screen.findByLabelText(/Type this exact phrase before removing a desired tag/),
      { target: { value: OWNER_TAG_REVOCATION_CONFIRMATION } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke desired tag" })[1]!);
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([path]) =>
              path === "/api/v1/stations/STATION_1/owner-tags/tag_abcdef1234567890abcdef12/revoke",
          ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText(/may still authorize locally/)).toBeTruthy());

    snapshot.value = {
      ...snapshot.value!,
      readiness: {
        ...snapshot.value!.readiness!,
        restartRequired: false,
        state: "blocked",
      },
    };
    const preparationPhrase = await waitFor(() =>
      screen.getByLabelText(/Type this exact owner-continuity authorization phrase/),
    );
    fireEvent.input(preparationPhrase, {
      target: { value: CONTINUITY_PREPARATION_PHRASE },
    });
    const prepareButton = screen.getByRole("button", {
      name: "Prepare owner-continuity settings",
    }) as HTMLButtonElement;
    await waitFor(() => expect(prepareButton.disabled).toBe(false));
    fireEvent.click(prepareButton);
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([path]) => path === "/api/v1/stations/STATION_1/prepare-owner-continuity",
          ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Prepare owner-continuity settings" }),
      ).toBeNull(),
    );

    openSection("Liberate my charger");
    fireEvent.input(
      screen.getByLabelText(
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

    openSection("Delegated access");
    fireEvent.change(screen.getByLabelText("Delegate role"), {
      target: { value: "employer" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Issue one-time secret" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Issue one-time secret" }));
    await waitFor(() => expect(screen.getByText(/chgdel\.12345678.*one-time-secret/)).toBeTruthy());
    expect(screen.getByText(/Only its verifier is stored/)).toBeTruthy();
    openSection("Freedom Test");
    fireEvent.input(screen.getByLabelText("Article number"), {
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
    openSection("Liberate my charger");
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
