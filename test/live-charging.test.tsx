// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChargeSession, OwnerSnapshot } from "../shared/contracts.js";
import { locale } from "../src/i18n/index.js";
import {
  averagePowerKw,
  energyPrice,
  estimatedCost,
  intervalPowers,
  parseEnergyPrice,
  readingInterval,
  setEnergyPrice,
} from "../src/live-charging.js";
import { chargingEvents, notificationSupport } from "../src/notifications.js";
import { SessionTable } from "../src/ui.js";
import { ConsoleSettingsSection, UsagePanel } from "../src/usage.js";

const START = "2026-11-04T10:18:30.000Z";

function trace(...points: [minutes: number, wh: number][]): ChargeSession["meterTrace"] {
  return points.map(([minutes, energyWh]) => ({
    at: new Date(Date.parse(START) + minutes * 60_000).toISOString(),
    energyWh,
  }));
}

function session(overrides: Partial<ChargeSession> = {}): ChargeSession {
  const meterTrace = overrides.meterTrace ?? trace([0, 0], [15, 698], [30, 1_379], [45, 2_088]);
  return {
    authorizationStatus: "Accepted",
    connectorId: 1,
    energyWh: null,
    integrity: "consistent",
    latestMeterReading: meterTrace.at(-1) ?? null,
    meterStart: 1_242_132,
    meterStop: null,
    meterTrace,
    replayedMessageCount: 0,
    startedAt: START,
    status: "active",
    stoppedAt: null,
    tagPseudonym: "tag_1234567890abcdef",
    transactionId: 2,
    ...overrides,
  };
}

function snapshotWith(
  sessions: readonly ChargeSession[],
  connectors: OwnerSnapshot["station"]["connectors"],
): OwnerSnapshot {
  return {
    sessions,
    station: { connectors, id: "STATION_1", label: "Home charger" },
  } as unknown as OwnerSnapshot;
}

function connector(status: string, connectorId = 1) {
  return { connectorId, errorCode: "NoError", status, updatedAt: "2026-11-04T11:00:00.000Z" };
}

beforeEach(() => {
  localStorage.clear();
  locale.value = "en";
  energyPrice.value = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("charging speed", () => {
  it("averages from session start to the latest reading, not before enough time passed", () => {
    expect(averagePowerKw(session())).toBeCloseTo(2.784, 3);
    expect(averagePowerKw(session({ meterTrace: trace([0, 0], [3, 140]) }))).toBeNull();
    expect(averagePowerKw(session({ latestMeterReading: null, meterTrace: [] }))).toBeNull();
  });

  it("derives per-interval power from start, skipping near-duplicate readings", () => {
    const powers = intervalPowers(
      session({ meterTrace: trace([0.5, 10], [15, 698], [15.2, 700], [30, 1_379]) }),
    );
    // Start is prepended at 0 Wh; the 30-second start gap and the 12-second pair are both skipped.
    expect(powers.map(({ kw }) => Number(kw.toFixed(2)))).toEqual([2.85, 2.75]);
    expect(readingInterval(session())).toBe(15 * 60_000);
    expect(readingInterval(session({ meterTrace: trace([0, 0], [15, 698]) }))).toBeNull();
  });
});

describe("charging speed after a pause and on long sessions", () => {
  it("leaves out time the car sat paused, and stops predicting readings once thinned", () => {
    // 2.1 kWh in 45 minutes, then two hours plugged in with the meter standing still.
    const paused = session({
      meterTrace: trace([0, 0], [15, 698], [30, 1_379], [45, 2_088], [105, 2_088], [165, 2_089]),
    });
    expect(averagePowerKw(paused)).toBeCloseTo(2.785, 2);
    const thinned = session({
      meterTrace: trace(
        ...Array.from({ length: 24 }, (_, index): [number, number] => [index * 30, index * 1_400]),
      ),
    });
    expect(readingInterval(thinned)).toBeNull();
  });

  it("shows no estimated cost for an open session without a meter reading", () => {
    setEnergyPrice({ amount: 0.3, currency: "EUR" });
    render(
      <SessionTable
        sessions={[session({ latestMeterReading: null, meterTrace: [] })]}
        directory={null}
        stationId="STATION_1"
      />,
    );
    expect(screen.queryByText("€0.00")).toBeNull();
  });
});

describe("energy price", () => {
  it("accepts only a positive, plausible price in a listed currency and keeps it in this browser", () => {
    expect(parseEnergyPrice({ amount: 0.32, currency: "EUR" })).toEqual({
      amount: 0.32,
      currency: "EUR",
    });
    for (const invalid of [
      { amount: 0, currency: "EUR" },
      { amount: 32, currency: "EUR" },
      { amount: Number.NaN, currency: "EUR" },
      { amount: 0.3, currency: "XYZ" },
      "0.3",
      null,
    ]) {
      expect(parseEnergyPrice(invalid)).toBeNull();
    }
    expect(estimatedCost(4_222)).toBeNull();
    setEnergyPrice({ amount: 0.3, currency: "EUR" });
    expect(JSON.parse(localStorage.getItem("chargeos.energyPrice")!)).toEqual({
      amount: 0.3,
      currency: "EUR",
    });
    expect(estimatedCost(4_222)).toBe("€1.27");
    setEnergyPrice(null);
    expect(localStorage.getItem("chargeos.energyPrice")).toBeNull();
  });

  it("saves a price from Preferences and refuses an implausible one", () => {
    render(<ConsoleSettingsSection profile="personal" />);
    const price = screen.getByLabelText("Price per kWh");
    fireEvent.input(price, { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(screen.getByRole("alert").textContent).toContain("up to 10 per kWh");
    expect(energyPrice.value).toBeNull();

    fireEvent.input(price, { target: { value: "0,28" } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(energyPrice.value).toEqual({ amount: 0.28, currency: "EUR" });
    expect(screen.getByText("Estimates use €0.28/kWh.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove price" }));
    expect(energyPrice.value).toBeNull();
  });
});

describe("notifications", () => {
  it("explains that browsers need HTTPS or this computer before offering a switch", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(notificationSupport()).toBe("insecure");
    render(<ConsoleSettingsSection profile="personal" />);
    const panel = within(screen.getByRole("region", { name: "Notifications" }));
    expect(panel.getByText(/only allow notifications on a secure \(HTTPS\) address/)).toBeTruthy();
    expect(panel.queryByRole("button", { name: "Turn on" })).toBeNull();
  });

  it("reports a finished session, pauses by car or charger, a resume and a fault", () => {
    const open = session();
    const before = snapshotWith([open], [connector("Charging")]);
    expect(chargingEvents(before, before)).toEqual([]);

    const finished = snapshotWith(
      [{ ...open, energyWh: 7_400, status: "complete", stoppedAt: "2026-11-04T13:00:00Z" }],
      [connector("Finishing")],
    );
    expect(chargingEvents(before, finished)).toEqual([
      {
        body: "Home charger: 7.4 kWh charged.",
        tag: "chargeos-STATION_1-session-2",
        title: "Charging finished",
      },
    ]);
    setEnergyPrice({ amount: 0.3, currency: "EUR" });
    expect(chargingEvents(before, finished)[0]!.body).toBe(
      "Home charger: 7.4 kWh charged, about €2.22.",
    );

    const byCar = snapshotWith([open], [connector("SuspendedEV")]);
    expect(chargingEvents(before, byCar).map(({ body }) => body)).toEqual([
      "Home charger, connector 1: the car isn’t taking power right now.",
    ]);
    const byCharger = snapshotWith([open], [connector("SuspendedEVSE")]);
    expect(chargingEvents(before, byCharger)[0]!.body).toContain(
      "the charger is holding back power",
    );
    expect(chargingEvents(byCar, before)[0]!.title).toBe("Charging resumed");
    expect(chargingEvents(before, snapshotWith([open], [connector("Faulted")]))[0]!.title).toBe(
      "Charger reports a fault",
    );
  });

  it("stays quiet for another charger, a pause without an open session and connector 0", () => {
    const open = session();
    const before = snapshotWith([open], [connector("Charging"), connector("Available", 0)]);
    const other = {
      ...snapshotWith([], [connector("SuspendedEV")]),
      station: { ...before.station, id: "OTHER" },
    } as OwnerSnapshot;
    expect(chargingEvents(before, other)).toEqual([]);
    const idle = snapshotWith([], [connector("Preparing")]);
    expect(chargingEvents(idle, snapshotWith([], [connector("SuspendedEV")]))).toEqual([]);
    expect(
      chargingEvents(
        before,
        snapshotWith([open], [connector("Charging"), connector("Faulted", 0)]),
      ),
    ).toEqual([]);
  });
});

describe("usage and sessions", () => {
  const history = Array.from({ length: 3 }, (_, index) =>
    session({
      energyWh: 10_000,
      latestMeterReading: null,
      meterTrace: [],
      startedAt: `2026-0${7 + index}-10T18:00:00.000Z`,
      status: "complete",
      stoppedAt: `2026-0${7 + index}-10T21:00:00.000Z`,
      transactionId: 100 + index,
    }),
  );

  it("adds a charge in progress to this month for sight and screen readers alike", () => {
    render(
      <UsagePanel
        sessions={[session(), ...history]}
        stationId="STATION_1"
        directory={null}
        now={new Date("2026-11-04T12:00:00.000Z")}
      />,
    );
    expect(screen.getByText("incl. 2.1 kWh charging now")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "November 2026: 2.1 kWh, including 2.1 kWh charging now, 1 session",
      }),
    ).toBeTruthy();
    // Months without a live charge keep their plain label.
    expect(screen.getByLabelText("October 2026: 0.0 kWh, 0 sessions")).toBeTruthy();
  });

  it("shows estimated costs only once the owner has set a price", () => {
    const view = render(
      <UsagePanel
        sessions={[session(), ...history]}
        stationId="STATION_1"
        directory={null}
        now={new Date("2026-11-04T12:00:00.000Z")}
      />,
    );
    expect(screen.queryByText(/at your price/)).toBeNull();
    setEnergyPrice({ amount: 0.3, currency: "EUR" });
    view.rerender(
      <UsagePanel
        sessions={[session(), ...history]}
        stationId="STATION_1"
        directory={null}
        now={new Date("2026-11-04T12:00:00.000Z")}
      />,
    );
    expect(screen.getAllByText("≈ €0.63 at your price").length).toBeGreaterThan(0);
  });

  it("lists each session's charging speed as a labelled sparkline and its estimated cost", () => {
    setEnergyPrice({ amount: 0.3, currency: "EUR" });
    render(<SessionTable sessions={[session()]} directory={null} stationId="STATION_1" />);
    expect(screen.getByRole("columnheader", { name: "Charging speed" })).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Charging speed during this session, between 2.7 kW and 2.8 kW",
      }),
    ).toBeTruthy();
    expect(screen.getByText("about 2.8 kW on average")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Est. cost" })).toBeTruthy();
    expect(screen.getByText("€0.63")).toBeTruthy();
  });
});
