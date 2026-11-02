import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent, type EvidenceEvent } from "../server/events.js";
import { buildUsageReportProjection } from "../server/projections.js";
import { mapObservationSessions, parseObservationCsv } from "../shared/observation-engine.js";
import {
  buildUsageReport,
  monthlyUsage,
  monthOf,
  parseTimeZone,
  parseUsageMonth,
  recentMonths,
  usageByCard,
  usageReportCsv,
  UsageInputError,
  type UsageSessionInput,
} from "../shared/usage.js";

function session(overrides: Partial<UsageSessionInput>): UsageSessionInput {
  return {
    energyWh: 1_000,
    integrity: "consistent",
    startedAt: "2026-10-10T08:00:00.000Z",
    status: "complete",
    stoppedAt: "2026-10-10T09:00:00.000Z",
    tagPseudonym: "tag_a",
    transactionId: 1,
    ...overrides,
  };
}

describe("usage months", () => {
  it("attributes a session to the calendar month of the reader's time zone", () => {
    // 23:30 UTC on 31 October is already 1 November in Brussels.
    expect(monthOf("2026-10-31T23:30:00.000Z", "UTC")).toBe("2026-10");
    expect(monthOf("2026-10-31T23:30:00.000Z", "Europe/Brussels")).toBe("2026-11");
    expect(monthOf("not a timestamp", "UTC")).toBeNull();
  });

  it("lists recent months oldest first across a year boundary", () => {
    expect(recentMonths(new Date("2026-02-10T12:00:00.000Z"), "UTC", 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("buckets energy and counts open sessions without inventing energy", () => {
    const series = monthlyUsage(
      [
        session({ energyWh: 7_400, transactionId: 1 }),
        session({ energyWh: 2_600, startedAt: "2026-10-20T08:00:00.000Z", transactionId: 2 }),
        session({ energyWh: null, status: "active", stoppedAt: null, transactionId: 3 }),
        session({ startedAt: "2026-09-01T08:00:00.000Z", transactionId: 4 }),
        session({ startedAt: "2025-01-01T08:00:00.000Z", transactionId: 5 }),
      ],
      ["2026-09", "2026-10"],
      "UTC",
    );
    expect(series).toEqual([
      { energyWh: 1_000, month: "2026-09", sessionCount: 1 },
      { energyWh: 10_000, month: "2026-10", sessionCount: 3 },
    ]);
  });

  it("splits usage per card pseudonym, largest first", () => {
    expect(
      usageByCard([
        session({ energyWh: 500, tagPseudonym: "tag_b" }),
        session({ energyWh: 4_000, tagPseudonym: "tag_a" }),
        session({ energyWh: 700, tagPseudonym: "tag_b" }),
      ]),
    ).toEqual([
      { energyWh: 4_000, sessionCount: 1, tagPseudonym: "tag_a" },
      { energyWh: 1_200, sessionCount: 2, tagPseudonym: "tag_b" },
    ]);
  });

  it("rejects malformed months and time zones", () => {
    expect(parseUsageMonth("2026-11")).toBe("2026-11");
    for (const month of [null, "", "2026-13", "2026-1", "26-01", "2026-01-01", "1999-12"]) {
      expect(() => parseUsageMonth(month)).toThrow(UsageInputError);
    }
    expect(parseTimeZone("Europe/Brussels")).toBe("Europe/Brussels");
    for (const zone of [null, "", "Mars/Olympus", "../etc", "Europe/Brussels; drop"]) {
      expect(() => parseTimeZone(zone)).toThrow(UsageInputError);
    }
  });
});

describe("usage report", () => {
  const report = buildUsageReport({
    generatedAt: "2026-11-02T08:00:00.000Z",
    month: "2026-10",
    profile: "company",
    stations: [
      {
        driver: "Bob",
        id: "HOME_BOB",
        label: "Bob's driveway",
        sessions: [session({ energyWh: 3_000, transactionId: 1 })],
        site: "Ghent",
      },
      {
        driver: null,
        id: "OFFICE_1",
        label: "Office bay 1",
        sessions: [
          session({ energyWh: 1_000, integrity: "conflict", transactionId: 2 }),
          session({ startedAt: "2026-09-30T08:00:00.000Z", transactionId: 3 }),
        ],
        site: "Brussels",
      },
      {
        driver: "Alice",
        id: "HOME_ALICE",
        label: '=HYPERLINK("http://evil")',
        sessions: [
          session({ energyWh: 5_000, transactionId: 4 }),
          session({ energyWh: null, status: "active", stoppedAt: null, transactionId: 5 }),
        ],
        site: "Leuven",
      },
      {
        driver: "Alice",
        id: "HOLIDAY_ALICE",
        label: "Holiday home",
        sessions: [session({ energyWh: 2_000, transactionId: 6 })],
        site: "Coast",
      },
    ],
    timeZone: "UTC",
  });

  it("groups chargers by driver with unassigned chargers last", () => {
    expect(report.drivers).toEqual([
      {
        driver: "Alice",
        energyWh: 7_000,
        sessionCount: 3,
        stationIds: ["HOME_ALICE", "HOLIDAY_ALICE"],
      },
      { driver: "Bob", energyWh: 3_000, sessionCount: 1, stationIds: ["HOME_BOB"] },
      { driver: null, energyWh: 1_000, sessionCount: 1, stationIds: ["OFFICE_1"] },
    ]);
    expect(report.totals).toEqual({
      conflictSessions: 1,
      energyWh: 11_000,
      openSessions: 1,
      sessionCount: 5,
    });
  });

  it("exports spreadsheet-safe CSV with pseudonyms and explicit open/conflict markers", () => {
    const csv = usageReportCsv(report);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      '"month","driver","charger_id","charger_label","site","session_id","transaction_id","started_at","stopped_at","energy_kwh","status","integrity","card_pseudonym","card_use"',
    );
    expect(lines).toHaveLength(6);
    expect(csv).toContain(`"2026-10","Bob","HOME_BOB","Bob's driveway","Ghent","HOME_BOB:1","1",`);
    expect(csv).toContain(`,"3.000","complete","consistent","tag_a"`);
    expect(csv).toContain(`,"","in-progress","consistent","tag_a"`);
    expect(csv).toContain(`,"1.000","complete","conflict","tag_a"`);
    // A formula-looking label is neutralized and quoted rather than executed.
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).not.toMatch(/(^|[,;"])=HYPERLINK/mu);
  });

  it("keeps a semicolon inside one quoted cell for semicolon-separated spreadsheet locales", () => {
    const csv = usageReportCsv(
      buildUsageReport({
        generatedAt: "2026-11-02T08:00:00.000Z",
        month: "2026-10",
        profile: "company",
        stations: [
          {
            driver: "Alex;=HYPERLINK(A1)",
            id: "HOME_ALEX",
            label: "Home;+1+1",
            sessions: [session({})],
            site: "Leuven",
          },
        ],
        timeZone: "UTC",
      }),
    );
    expect(csv).toContain(`"Alex;=HYPERLINK(A1)","HOME_ALEX","Home;+1+1"`);
    // Split the way a semicolon-locale spreadsheet would: no field outside quotes starts a formula.
    const unquoted = csv.replace(/"(?:[^"]|"")*"/gu, "Q");
    expect(unquoted).not.toMatch(/[=+@]/u);
  });
});

describe("usage export into the reimbursement import", () => {
  it("maps completed sessions and rejects in-progress rows instead of guessing energy", () => {
    const report = buildUsageReport({
      generatedAt: "2026-11-02T08:00:00.000Z",
      month: "2026-10",
      profile: "company",
      stations: [
        {
          driver: "Alice Peeters",
          id: "HOME_ALICE",
          label: "Driveway",
          sessions: [
            session({ energyWh: 7_400, transactionId: 1 }),
            session({ energyWh: null, status: "active", stoppedAt: null, transactionId: 2 }),
          ],
          site: "Leuven",
        },
        {
          driver: "Alice Peeters",
          id: "HOLIDAY_ALICE",
          label: "Holiday home",
          // The same transaction number on another charger stays a distinct session.
          sessions: [session({ energyWh: 1_250, transactionId: 1 })],
          site: "Coast",
        },
      ],
      timeZone: "UTC",
    });
    const imported = mapObservationSessions(
      parseObservationCsv(usageReportCsv(report)),
      {
        decimalSeparator: ".",
        driverAlias: null,
        endedAt: "stopped_at",
        energy: "energy_kwh",
        energyUnit: "kWh",
        sessionId: "session_id",
        startedAt: "started_at",
        stationId: "charger_id",
      },
      { format: "csv", label: "chargeos-usage-2026-10.csv", sha256: "a".repeat(64) },
      "alice",
    );
    expect(
      imported.sessions.map(({ energyWh, sessionId, stationId }) => ({
        energyWh,
        sessionId,
        stationId,
      })),
    ).toEqual([
      { energyWh: 7_400, sessionId: "HOME_ALICE:1", stationId: "HOME_ALICE" },
      { energyWh: 1_250, sessionId: "HOLIDAY_ALICE:1", stationId: "HOLIDAY_ALICE" },
    ]);
    expect(imported.issues).toHaveLength(1);
  });
});

describe("usage report projection", () => {
  it("reports every provisioned charger from evidence without exposing raw RFID", () => {
    const config = {
      ownerTags: new Set(["raw-owner-tag"]),
      profile: "company",
      stationId: "HOME_1",
      stationSecret: "station-secret-at-least-sixteen",
      stations: [
        {
          driver: "Alice",
          id: "HOME_1",
          label: "Driveway",
          ownerTags: new Set(["raw-owner-tag"]),
          secret: "station-secret-at-least-sixteen",
          site: "Home",
        },
        {
          id: "OFFICE_1",
          label: "Office bay 1",
          ownerTags: new Set(["office-tag"]),
          secret: "office-station-secret-strong",
          site: "Office",
        },
      ],
    } as unknown as GatewayConfig;
    const events: EvidenceEvent[] = [
      evidenceEvent("HOME_1", "station-to-csms", "StartTransaction", {
        authorizationStatus: "Accepted",
        connectorId: 1,
        idTag: "tag_home",
        meterStart: 10_000,
        timestamp: "2026-10-05T18:00:00.000Z",
        transactionId: 1,
      }),
      evidenceEvent("HOME_1", "station-to-csms", "StopTransaction", {
        meterStop: 17_400,
        timestamp: "2026-10-05T21:00:00.000Z",
        transactionId: 1,
      }),
      evidenceEvent("UNKNOWN", "station-to-csms", "StartTransaction", {
        connectorId: 1,
        idTag: "tag_x",
        meterStart: 0,
        timestamp: "2026-10-05T18:00:00.000Z",
        transactionId: 9,
      }),
    ];

    const report = buildUsageReportProjection(
      config,
      events,
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(report.profile).toBe("company");
    expect(report.stations.map(({ id }) => id)).toEqual(["HOME_1", "OFFICE_1"]);
    expect(report.stations[0]).toMatchObject({ driver: "Alice", energyWh: 7_400, sessionCount: 1 });
    expect(report.stations[1]).toMatchObject({ driver: null, energyWh: 0, sessionCount: 0 });
    expect(JSON.stringify(report)).not.toContain("raw-owner-tag");
    expect(JSON.stringify(report)).not.toContain("tag_x");
  });
});

describe("private card use in the usage report", () => {
  const config = {
    ownerTags: new Set(["raw-owner-tag"]),
    profile: "company",
    stationId: "HOME_1",
    stationSecret: "station-secret-at-least-sixteen",
    stations: [
      {
        driver: "Alice",
        id: "HOME_1",
        label: "Driveway",
        ownerTags: new Set(["raw-owner-tag"]),
        secret: "station-secret-at-least-sixteen",
        site: "Home",
      },
    ],
  } as unknown as GatewayConfig;
  const charge = (transactionId: number, idTag: string, day: string, energyWh: number) => [
    evidenceEvent("HOME_1", "station-to-csms", "StartTransaction", {
      authorizationStatus: "Accepted",
      connectorId: 1,
      idTag,
      meterStart: 0,
      timestamp: `2026-10-${day}T18:00:00.000Z`,
      transactionId,
    }),
    evidenceEvent("HOME_1", "station-to-csms", "StopTransaction", {
      meterStop: energyWh,
      timestamp: `2026-10-${day}T20:00:00.000Z`,
      transactionId,
    }),
  ];
  const classify = (
    tagPseudonym: string,
    use: "business" | "private",
    at: string,
    stationId = "HOME_1",
  ): EvidenceEvent => ({
    ...evidenceEvent(stationId, "system", "CardPolicyChanged", {
      ownership: use === "private" ? "personal" : "company",
      tagPseudonym,
      use,
    }),
    at,
  });
  const company = { retiredStationIds: [] };
  const events: EvidenceEvent[] = [
    classify("tag_company", "business", "2026-10-01T08:00:00.000Z"),
    classify("tag_personal", "private", "2026-10-01T08:00:00.000Z"),
    ...charge(1, "tag_company", "05", 7_000),
    ...charge(2, "tag_personal", "06", 3_000),
    ...charge(3, "tag_unknown", "07", 1_000),
  ];
  const report = buildUsageReportProjection(
    config,
    events,
    "2026-10",
    "Europe/Brussels",
    new Date("2026-11-01T00:00:00.000Z"),
    undefined,
    company,
  );

  it("labels every session with its card use and keeps unclassified cards unclassified", () => {
    expect(report.stations[0]!.sessions.map(({ cardUse }) => cardUse)).toEqual([
      "business",
      "private",
      null,
    ]);
  });

  it("reports the private part per employee without removing it from the total", () => {
    expect(report.drivers).toEqual([
      expect.objectContaining({ driver: "Alice", energyWh: 11_000, privateEnergyWh: 3_000 }),
    ]);
  });

  it("omits the private part when an employee charged no private session", () => {
    const business = buildUsageReportProjection(
      config,
      [
        classify("tag_company", "business", "2026-10-01T08:00:00.000Z"),
        ...charge(1, "tag_company", "05", 7_000),
      ],
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
      undefined,
      company,
    );
    expect(business.drivers[0]).not.toHaveProperty("privateEnergyWh");
  });

  it("exports card use as the last CSV column, empty when unclassified", () => {
    const lines = usageReportCsv(report).trimEnd().split("\r\n");
    expect(lines[0]!.split(",").at(-1)).toBe('"card_use"');
    expect(lines.slice(1).map((line) => line.split(",").at(-1))).toEqual([
      '"business"',
      '"private"',
      '""',
    ]);
  });

  it("classifies each session as its card stood then, not as it stands now", () => {
    const history = buildUsageReportProjection(
      config,
      [
        ...events,
        // Later the private card is reclassified as business; earlier sessions stay private.
        classify("tag_personal", "business", "2026-10-20T08:00:00.000Z"),
        ...charge(4, "tag_personal", "21", 2_000),
      ],
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
      undefined,
      company,
    );
    expect(
      history.stations[0]!.sessions.map(({ cardUse, transactionId }) => [transactionId, cardUse]),
    ).toEqual([
      [1, "business"],
      [2, "private"],
      [3, null],
      [4, "business"],
    ]);
  });

  const useOf = (extra: EvidenceEvent[]) =>
    buildUsageReportProjection(
      config,
      extra,
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
      undefined,
      company,
    ).stations[0]!.sessions.map(({ cardUse, transactionId }) => [transactionId, cardUse]);

  it("never lets a later first classification reach back beyond clock skew", () => {
    expect(
      useOf([
        // Session at 18:00 on the charger clock; classified ten minutes later by the gateway.
        ...charge(2, "tag_personal", "06", 3_000),
        classify("tag_personal", "private", "2026-10-06T18:10:00.000Z"),
        // A card used unclassified for days and then marked business stays unclassified then.
        ...charge(5, "tag_late", "02", 1_000),
        classify("tag_late", "business", "2026-10-09T08:00:00.000Z"),
      ]),
    ).toEqual([
      [5, null],
      [2, "private"],
    ]);
  });

  it("errs towards private when a change is within clock skew of the session", () => {
    expect(
      useOf([
        classify("tag_personal", "private", "2026-10-01T08:00:00.000Z"),
        // Reclassified business at 17:55; a charger clock running ahead says the session
        // started at 18:00 although it may really have started before the change.
        classify("tag_personal", "business", "2026-10-06T17:55:00.000Z"),
        ...charge(2, "tag_personal", "06", 3_000),
      ]),
    ).toEqual([[2, "private"]]);
  });

  it("ends a classification when the card is removed, so a re-added card is unclassified", () => {
    expect(
      useOf([
        classify("tag_company", "business", "2026-10-01T08:00:00.000Z"),
        ...charge(1, "tag_company", "05", 7_000),
        {
          ...evidenceEvent("HOME_1", "system", "OwnerTagDesiredStateChanged", {
            action: "removed",
            tagPseudonym: "tag_company",
          }),
          at: "2026-10-10T08:00:00.000Z",
        },
        ...charge(6, "tag_company", "20", 2_000),
      ]),
    ).toEqual([
      [1, "business"],
      [6, null],
    ]);
  });

  it("keeps a retired charger's sessions in the months they happened", () => {
    const retired = buildUsageReportProjection(
      config,
      [
        ...events,
        classify("tag_old", "business", "2026-10-01T08:00:00.000Z", "OLD_1"),
        {
          ...evidenceEvent("OLD_1", "station-to-csms", "StartTransaction", {
            authorizationStatus: "Accepted",
            connectorId: 1,
            idTag: "tag_old",
            meterStart: 0,
            timestamp: "2026-10-10T18:00:00.000Z",
            transactionId: 9,
          }),
        },
        evidenceEvent("OLD_1", "station-to-csms", "StopTransaction", {
          meterStop: 4_000,
          timestamp: "2026-10-10T20:00:00.000Z",
          transactionId: 9,
        }),
      ],
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
      undefined,
      { retiredStationIds: ["OLD_1", "NEVER_USED"] },
    );
    expect(retired.stations.map(({ id }) => id)).toEqual(["HOME_1", "OLD_1"]);
    expect(retired.stations[1]).toMatchObject({ energyWh: 4_000, sessionCount: 1 });
  });

  it("adds no card use when the report is built without classifications", () => {
    const personal = buildUsageReportProjection(
      config,
      events,
      "2026-10",
      "Europe/Brussels",
      new Date("2026-11-01T00:00:00.000Z"),
    );
    for (const session of personal.stations[0]!.sessions) {
      expect(session).not.toHaveProperty("cardUse");
    }
    expect(personal.drivers[0]).not.toHaveProperty("privateEnergyWh");
  });
});
