// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerSnapshot, StationConnectionDiagnostics } from "../shared/contracts.js";
import { locale } from "../src/i18n/index.js";
import { ConnectChargerPanel, needsConnectionHelp } from "../src/pages/connect.js";

function snapshotWith(
  station: Partial<OwnerSnapshot["station"]>,
  connection: Partial<StationConnectionDiagnostics> = {},
): OwnerSnapshot {
  return {
    station: {
      boot: null,
      connected: false,
      connectedAt: null,
      connection: {
        acceptedAlias: null,
        aliasCandidate: null,
        endpointBase: "wss://ocpp.example.test/",
        lastRefused: null,
        lastUnmatchedAt: null,
        refusedSinceStart: 0,
        unmatchedSinceStart: 0,
        ...connection,
      },
      connectors: [],
      driver: null,
      id: "HOME-1",
      label: "Driveway",
      site: "Home",
      ...station,
    },
  } as unknown as OwnerSnapshot;
}

describe("connect your charger", () => {
  beforeEach(() => {
    locale.value = "en";
  });
  afterEach(() => cleanup());

  it("lists exactly what to type into the charger tool, without the password", () => {
    render(<ConnectChargerPanel snapshot={snapshotWith({})} />);
    expect(screen.getByRole("heading", { name: "Connect your charger" })).toBeTruthy();
    expect(screen.getByText("wss://ocpp.example.test/HOME-1")).toBeTruthy();
    expect(screen.getByText("HOME-1")).toBeTruthy();
    expect(screen.getByText(/stationSecret.*never shown here/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Waiting for the charger");
  });

  it("explains a charger that used a different name in plain words", () => {
    render(
      <ConnectChargerPanel
        snapshot={snapshotWith(
          {},
          {
            lastRefused: {
              at: "2026-11-02T10:00:00.000Z",
              offeredProtocols: [],
              presentedIdentity: "ACE0123456",
              reason: "identity-mismatch",
            },
          },
        )}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your charger used a different name");
    expect(alert.textContent).toContain("called itself ACE0123456. chargeOS expects HOME-1.");
  });

  it("keeps offering a password-proven name after a later wrong-password attempt", () => {
    render(
      <ConnectChargerPanel
        snapshot={snapshotWith(
          {},
          {
            aliasCandidate: { at: "2026-11-02T10:00:00.000Z", presentedIdentity: "ACE0123456" },
            lastRefused: {
              at: "2026-11-02T10:01:00.000Z",
              offeredProtocols: [],
              presentedIdentity: null,
              reason: "password-wrong",
            },
          },
        )}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("wrong password");
    expect(screen.getByRole("button", { name: "Use ACE0123456" })).toBeTruthy();
  });

  it("translates the guide", () => {
    locale.value = "nl";
    render(
      <ConnectChargerPanel
        snapshot={snapshotWith(
          {},
          {
            lastRefused: {
              at: "2026-11-02T10:00:00.000Z",
              offeredProtocols: [],
              presentedIdentity: null,
              reason: "password-wrong",
            },
          },
        )}
      />,
    );
    expect(screen.getByRole("heading", { name: "Verbind je laadpaal" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("verkeerd wachtwoord");
  });

  it("leaves the overview once the charger has connected and introduced itself", () => {
    const boot = { firmwareVersion: "7.1.0", model: "Eve Single", vendor: "Alfen" };
    expect(needsConnectionHelp(snapshotWith({}))).toBe(true);
    expect(needsConnectionHelp(snapshotWith({ boot, connected: true }))).toBe(false);
    // A later refusal (another device using the name) brings it back.
    expect(
      needsConnectionHelp(
        snapshotWith(
          { boot, connected: true },
          {
            lastRefused: {
              at: "2026-11-02T10:00:00.000Z",
              offeredProtocols: [],
              presentedIdentity: null,
              reason: "already-connected",
            },
          },
        ),
      ),
    ).toBe(true);
  });
});
