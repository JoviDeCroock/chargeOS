import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent } from "../server/events.js";
import type { ChargeGateway } from "../server/gateway.js";
import {
  buildDelegateSessionExport,
  buildOwnerSnapshot,
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
