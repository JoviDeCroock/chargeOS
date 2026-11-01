import { afterEach, describe, expect, it } from "vitest";

import { createChargeGateway } from "../server/gateway.ts";
import { buildOwnerSnapshot } from "../server/projections.ts";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.ts";
import { createSimulatedCharger, PROFILES } from "../scripts/simulate-charger.mjs";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.ts";

const OWNER_TAG = "sim-owner-card";
const STATION_SECRET = "simulator-station-secret-123";

const config = {
  apiHost: "127.0.0.1",
  apiPort: 0,
  eventLogMaxBytes: 268_435_456,
  eventLogPath: "unused.ndjson",
  heartbeatSeconds: 60,
  ocppHost: "127.0.0.1",
  ocppMaxConnections: 8,
  ocppMaxPayloadBytes: 1_048_576,
  ocppMessageBurst: 60,
  ocppMessagesPerMinute: 600,
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set([OWNER_TAG]),
  port: 0,
  stationId: "SIM_1",
  stationSecret: STATION_SECRET,
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

describe("pnpm simulate charge point", () => {
  let gateway;
  let charger;

  afterEach(async () => {
    await charger?.close();
    await gateway?.close();
  });

  async function start(profile) {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const server = await gateway.listen(0, "127.0.0.1");
    charger = createSimulatedCharger({
      endpoint: `ws://127.0.0.1:${server.address().port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      profile,
    });
    await charger.connect();
    await charger.boot();
    return evidence;
  }

  it("names every profile after a behavior rather than a brand", () => {
    for (const name of Object.keys(PROFILES)) {
      expect(name).toMatch(/^[a-z-]+$/);
      expect(name).not.toMatch(/alfen|abb|easee|zaptec|wallbox|keba|tesla|mennekes|schneider/);
    }
  });

  it("conformant: inspects ready, synchronizes and records a complete owner session", async () => {
    const evidence = await start("conformant");
    await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
      state: "ready",
    });
    await expect(gateway.syncOwnerList(config.stationId)).resolves.toMatchObject({
      status: "Accepted",
    });
    expect(charger.localListSize).toBe(1);
    await expect(charger.runSession({ energyWh: 5_000, tag: OWNER_TAG })).resolves.toMatchObject({
      authorization: "Accepted",
    });

    const snapshot = buildOwnerSnapshot(config, gateway, evidence.events);
    expect(snapshot.authorization.syncState).toBe("current");
    expect(snapshot.sessions[0]).toMatchObject({ energyWh: 5_000, status: "complete" });
    expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);
  });

  it("unsafe-defaults: owner continuity preparation moves only the three offline settings", async () => {
    await start("unsafe-defaults");
    await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
      state: "blocked",
    });
    const result = await gateway.prepareOwnerContinuity(config.stationId, {
      confirmation: CONTINUITY_PREPARATION_PHRASE,
    });
    expect(result.state).toBe("ready");
    expect(result.changes.map(({ key }) => key).sort()).toEqual([
      "AllowOfflineTxForUnknownId",
      "LocalAuthListEnabled",
      "LocalAuthorizeOffline",
    ]);
  });

  it("read-only-settings: refuses preparation before changing anything", async () => {
    await start("read-only-settings");
    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).rejects.toThrow(/could not be proven safe/i);
    expect(charger.configuration.get("AllowOfflineTxForUnknownId")).toBe("true");
  });

  it("upper-case-uid and vendor-messages: charge normally", async () => {
    await start("upper-case-uid");
    await expect(charger.runSession({ tag: OWNER_TAG })).resolves.toMatchObject({
      authorization: "Accepted",
    });
    await charger.close();
    await gateway.close();

    const evidence = await start("vendor-messages");
    await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
      state: "ready",
    });
    expect(evidence.events.map((event) => event.message)).toEqual(
      expect.arrayContaining(["DataTransfer", "FirmwareStatusNotification"]),
    );
    expect(JSON.stringify(evidence.events)).not.toContain("simulated-private-payload");
  });

  it("local-list-unsupported: keeps synchronization blocked", async () => {
    await start("local-list-unsupported");
    await expect(gateway.syncOwnerList(config.stationId)).rejects.toThrow(/blocked/i);
    expect(charger.localListSize).toBe(0);
  });

  it("rejects an unknown card", async () => {
    await start("conformant");
    await expect(charger.runSession({ tag: "not-an-owner-card" })).resolves.toEqual({
      authorization: "Invalid",
      transactionId: null,
    });
  });
});
