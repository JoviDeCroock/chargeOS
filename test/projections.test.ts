import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent } from "../server/events.js";
import type { ChargeGateway } from "../server/gateway.js";
import {
  buildDelegateSessionExport,
  buildOwnerSnapshot,
  METER_TRACE_MAX_POINTS,
  buildRedactedContinuityExport,
} from "../server/projections.js";
import { pseudonymizeTag } from "../server/tag.js";

const config: GatewayConfig = {
  apiHost: "127.0.0.1",
  apiPort: 9080,
  eventLogPath: "unused.ndjson",
  eventLogMaxBytes: 268_435_456,
  heartbeatSeconds: 60,
  ocppHost: "127.0.0.1",
  ocppMaxConnections: 8,
  ocppMaxPayloadBytes: 1_048_576,
  ocppMessageBurst: 60,
  ocppMessagesPerMinute: 600,
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set(["raw-owner-tag"]),
  port: 9000,
  stationId: "STATION_1",
  stationSecret: "station-secret-at-least-sixteen",
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

describe("owner projections", () => {
  it("projects completed sessions and never exports the raw owner tag", () => {
    const events = [
      evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
        chargePointModel: "Eve Single S-line",
        chargePointVendor: "Alfen",
        firmwareVersion: "7.1.0",
      }),
      evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
        authorizationStatus: "Accepted",
        connectorId: 1,
        idTag: "tag_pseudonym",
        meterStart: 100,
        timestamp: "2026-08-14T10:00:00.000Z",
        transactionId: 7,
      }),
      evidenceEvent("STATION_1", "station-to-csms", "StopTransaction", {
        meterStop: 850,
        timestamp: "2026-08-14T10:30:00.000Z",
        transactionId: 7,
      }),
      evidenceEvent("STATION_1", "system", "DelegateCapabilityGranted", {
        createdAt: "2026-08-14T10:31:00.000Z",
        expiresAt: "2099-08-15T10:31:00.000Z",
        grantId: "12345678-1234-4123-8123-123456789abc",
        role: "employer",
        scopes: ["sessions:read"],
        tokenHash: "a".repeat(64),
        tokenHint: "…abc123",
      }),
    ];
    const gateway = {
      getRuntime: () => ({ connected: true, connectedAt: "2026-08-14T09:59:00.000Z" }),
    } satisfies Pick<ChargeGateway, "getRuntime">;

    const snapshot = buildOwnerSnapshot(config, gateway, events);
    expect(snapshot.sessions).toContainEqual(
      expect.objectContaining({
        authorizationStatus: "Accepted",
        energyWh: 750,
        integrity: "consistent",
        replayedMessageCount: 0,
        status: "complete",
        transactionId: 7,
      }),
    );
    expect(snapshot.station.boot).toMatchObject({ model: "Eve Single S-line", vendor: "Alfen" });
    expect(snapshot.delegations).toContainEqual(
      expect.objectContaining({ role: "employer", scopes: ["sessions:read"] }),
    );
    expect(JSON.stringify(snapshot)).not.toContain("a".repeat(64));

    const exported = JSON.stringify(buildRedactedContinuityExport(config, events));
    expect(exported).not.toContain("raw-owner-tag");
    expect(exported).not.toContain("a".repeat(64));
    expect(exported).toContain("tag_");

    const delegatedSessions = JSON.stringify(buildDelegateSessionExport(config, events));
    expect(delegatedSessions).toContain('"transactionId":7');
    expect(delegatedSessions).not.toContain("tag_pseudonym");
  });

  it("redacts raw SIM identifiers and status free text recorded by older ledgers", () => {
    const events = [
      evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
        chargePointModel: "Model",
        chargePointVendor: "Vendor",
        iccid: "8932000000000000001",
        imsi: "206010000000001",
      }),
      evidenceEvent("STATION_1", "station-to-csms", "StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        info: "card 04A1B2C3",
        status: "Available",
        vendorErrorCode: "E-04A1B2C3",
      }),
    ];
    const gateway = { getRuntime: () => ({ connected: false, connectedAt: null }) };
    for (const projected of [
      JSON.stringify(buildRedactedContinuityExport(config, events)),
      JSON.stringify(buildOwnerSnapshot(config, gateway, events)),
    ]) {
      for (const raw of ["8932000000000000001", "206010000000001", "04A1B2C3"])
        expect(projected).not.toContain(raw);
      expect(projected).toContain('"chargePointVendor":"Vendor"');
    }
  });

  it("deduplicates exact retries and preserves the first stop when later evidence conflicts", () => {
    const start = evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
      authorizationStatus: "Accepted",
      connectorId: 1,
      idTag: "tag_pseudonym",
      meterStart: 1_000,
      timestamp: "2026-08-14T10:00:00.000Z",
      transactionId: 9,
    });
    const meter = evidenceEvent("STATION_1", "station-to-csms", "MeterValues", {
      meterValue: [],
      transactionId: 9,
    });
    const stop = evidenceEvent("STATION_1", "station-to-csms", "StopTransaction", {
      meterStop: 2_000,
      timestamp: "2026-08-14T10:30:00.000Z",
      transactionId: 9,
    });
    const events = [
      start,
      evidenceEvent("STATION_1", "system", "StartTransactionReplay", {
        transactionId: 9,
      }),
      meter,
      meter,
      stop,
      stop,
      evidenceEvent("STATION_1", "station-to-csms", "StopTransaction", {
        meterStop: 9_999,
        timestamp: "2026-08-14T10:31:00.000Z",
        transactionId: 9,
      }),
    ];
    const gateway = {
      getRuntime: () => ({ connected: true, connectedAt: "2026-08-14T09:59:00.000Z" }),
    } satisfies Pick<ChargeGateway, "getRuntime">;

    expect(buildOwnerSnapshot(config, gateway, events).sessions).toEqual([
      expect.objectContaining({
        energyWh: 1_000,
        integrity: "conflict",
        meterStop: 2_000,
        replayedMessageCount: 3,
        transactionId: 9,
      }),
    ]);
  });

  it("shows energy so far from the latest whole-meter reading of an open session", () => {
    const station = (message: string, payload: unknown) =>
      evidenceEvent("STATION_1", "station-to-csms", message, payload);
    const reading = (timestamp: string, sampledValue: unknown[]) =>
      station("MeterValues", {
        connectorId: 1,
        meterValue: [{ sampledValue, timestamp }],
        transactionId: 2,
      });
    const energy = (value: string, extra: Record<string, unknown> = {}) => ({
      context: "Sample.Periodic",
      measurand: "Energy.Active.Import.Register",
      unit: "kWh",
      value,
      ...extra,
    });
    const gateway = {
      getRuntime: () => ({ connected: true, connectedAt: "2026-11-04T10:00:00.000Z" }),
    } satisfies Pick<ChargeGateway, "getRuntime">;
    const start = station("StartTransaction", {
      authorizationStatus: "Accepted",
      connectorId: 1,
      idTag: "tag_pseudonym",
      meterStart: 1_242_132,
      timestamp: "2026-11-04T10:18:30Z",
      transactionId: 2,
    });
    const latest = reading("2026-11-04T11:03:32Z", [energy("1244.220")]);
    const events = [
      start,
      reading("2026-11-04T10:18:30Z", [{ context: "Transaction.Begin", value: "1242132" }]),
      reading("2026-11-04T10:48:32Z", [energy("1243.511")]),
      latest,
      // A replayed earlier reading arriving late must not move progress backwards.
      reading("2026-11-04T10:33:32Z", [energy("1242.830")]),
      // Per-phase, EV-side, other measurands, unknown units and junk values are not the session total.
      reading("2026-11-04T11:10:00Z", [
        energy("1250.000", { phase: "L1" }),
        energy("1250.000", { location: "EV" }),
        { measurand: "Power.Active.Import", unit: "W", value: "7400" },
        energy("1250.000", { unit: "varh" }),
        energy("not-a-number"),
        energy("   "),
      ]),
      station("MeterValues", {
        meterValue: [{ sampledValue: [energy("1250")] }],
        transactionId: 2,
      }),
      latest,
    ];
    const [session] = buildOwnerSnapshot(config, gateway, events).sessions;
    expect(session).toMatchObject({
      energyWh: null,
      latestMeterReading: { at: "2026-11-04T11:03:32.000Z", energyWh: 2_088 },
      replayedMessageCount: 1,
      status: "active",
    });
    // The speed trace is in charger time order, deduplicated, and ignores the same junk.
    expect(session?.meterTrace).toEqual([
      { at: "2026-11-04T10:18:30.000Z", energyWh: 0 },
      { at: "2026-11-04T10:33:32.000Z", energyWh: 698 },
      { at: "2026-11-04T10:48:32.000Z", energyWh: 1_379 },
      { at: "2026-11-04T11:03:32.000Z", energyWh: 2_088 },
    ]);
    // The delegate export keeps its fixed schema-1 session shape.
    const exported = buildDelegateSessionExport(config, events).sessions[0];
    expect(exported).not.toHaveProperty("latestMeterReading");
    expect(exported).not.toHaveProperty("meterTrace");

    // A long session is thinned evenly, keeping its first and latest reading.
    const long = buildOwnerSnapshot(config, gateway, [
      start,
      ...Array.from({ length: 100 }, (_, index) =>
        reading(new Date(Date.parse("2026-11-04T10:20:00Z") + index * 300_000).toISOString(), [
          energy(String(1242.132 + (index + 1) * 0.2)),
        ]),
      ),
    ]).sessions[0]!.meterTrace;
    expect(long).toHaveLength(METER_TRACE_MAX_POINTS);
    expect(long[0]).toEqual({ at: "2026-11-04T10:20:00.000Z", energyWh: 200 });
    expect(long.at(-1)).toEqual({ at: "2026-11-04T18:35:00.000Z", energyWh: 20_000 });
    const times = long.map(({ at }) => Date.parse(at));
    expect(times).toEqual(times.toSorted((left, right) => left - right));

    // A meter reset below meterStart is not negative energy; the stop result stays authoritative.
    const stopped = buildOwnerSnapshot(config, gateway, [
      ...events,
      reading("2026-11-04T11:20:00Z", [{ unit: "Wh", value: "5" }]),
      station("StopTransaction", {
        meterStop: 1_244_600,
        timestamp: "2026-11-04T11:21:00Z",
        transactionId: 2,
      }),
    ]).sessions[0];
    expect(stopped).toMatchObject({
      energyWh: 2_468,
      latestMeterReading: { at: "2026-11-04T11:20:00.000Z", energyWh: 0 },
      status: "complete",
    });
  });

  it("keeps desired tags separate from the last accepted charger list", () => {
    const oldTag = `tag_${pseudonymizeTag("old-owner-tag", config.stationSecret)}`;
    const newTag = `tag_${pseudonymizeTag("new-owner-tag", config.stationSecret)}`;
    const changedConfig: GatewayConfig = {
      ...config,
      ownerTags: new Set(["new-owner-tag"]),
    };
    const accepted = [
      evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", {
        listVersion: 4,
        localAuthorizationList: [{ idTag: oldTag, idTagInfo: { status: "Accepted" } }],
        updateType: "Full",
      }),
      evidenceEvent("STATION_1", "station-to-csms", "SendLocalListResult", {
        listVersion: 4,
        status: "Accepted",
      }),
    ];
    const gateway = {
      getRuntime: () => ({ connected: false, connectedAt: null }),
    } satisfies Pick<ChargeGateway, "getRuntime">;

    const changed = buildOwnerSnapshot(changedConfig, gateway, accepted).authorization;
    expect(changed).toMatchObject({
      acknowledgedTagPseudonyms: [oldTag],
      lastSyncRevision: 4,
      lastSyncStatus: "Accepted",
      pendingAdditions: [newTag],
      pendingRevocations: [oldTag],
      pendingRevision: null,
      syncState: "pending",
      tagPseudonyms: [newTag],
    });

    const unacknowledged = [
      ...accepted,
      evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", {
        listVersion: 5,
        localAuthorizationList: [{ idTag: newTag, idTagInfo: { status: "Accepted" } }],
        updateType: "Full",
      }),
    ];
    expect(buildOwnerSnapshot(changedConfig, gateway, unacknowledged).authorization).toMatchObject({
      acknowledgedTagPseudonyms: [oldTag],
      lastSyncRevision: 4,
      pendingRevision: 5,
      syncState: "pending",
    });

    const rejected = [
      ...unacknowledged,
      evidenceEvent("STATION_1", "station-to-csms", "SendLocalListResult", {
        listVersion: 5,
        status: "Failed",
      }),
    ];
    expect(buildOwnerSnapshot(changedConfig, gateway, rejected).authorization).toMatchObject({
      acknowledgedTagPseudonyms: [oldTag],
      lastAttemptRevision: 5,
      lastAttemptStatus: "Failed",
      lastSyncRevision: 4,
      pendingRevocations: [oldTag],
      pendingRevision: null,
      syncState: "pending",
    });
  });

  it("pairs legacy unversioned results with only their nearest unresolved command", () => {
    const desiredTag = `tag_${pseudonymizeTag("raw-owner-tag", config.stationSecret)}`;
    const events = [
      evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", {
        listVersion: 7,
        localAuthorizationList: [{ idTag: desiredTag }],
      }),
      evidenceEvent("STATION_1", "station-to-csms", "SendLocalListResult", {
        status: "Accepted",
      }),
      evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", {
        listVersion: 8,
        localAuthorizationList: [{ idTag: desiredTag }],
      }),
    ];
    const gateway = {
      getRuntime: () => ({ connected: true, connectedAt: "2026-08-14T10:00:00.000Z" }),
    } satisfies Pick<ChargeGateway, "getRuntime">;

    expect(buildOwnerSnapshot(config, gateway, events).authorization).toMatchObject({
      lastSyncRevision: 7,
      pendingRevision: 8,
      syncState: "current",
    });
  });
});
