import { afterEach, describe, expect, it, vi } from "vitest";

import { createChargeGateway } from "../server/gateway.ts";
import { buildStationCommands } from "../server/commands.ts";
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

  it("unknown-offline-unsupported: prepares only the offline setting; chargeOS still rejects unknown cards online", async () => {
    await start("unknown-offline-unsupported");
    const before = await gateway.inspectLocalAuthorization(config.stationId);
    expect(before.state).toBe("blocked");
    expect(before.checks).toContainEqual(
      expect.objectContaining({ id: "unknown-tags-rejected", state: "pass" }),
    );
    const result = await gateway.prepareOwnerContinuity(config.stationId, {
      confirmation: CONTINUITY_PREPARATION_PHRASE,
    });
    expect(result.state).toBe("ready");
    expect(result.changes.map(({ key }) => key)).toEqual(["LocalAuthorizeOffline"]);
    expect(charger.configuration.has("AllowOfflineTxForUnknownId")).toBe(false);
    await expect(gateway.syncOwnerList(config.stationId)).resolves.toMatchObject({
      status: "Accepted",
    });
    await expect(charger.runSession({ tag: "not-an-owner-card" })).resolves.toMatchObject({
      authorization: "Invalid",
    });
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

  describe("charger that connects without BootNotification", () => {
    const messages = (evidence) => evidence.events.map(({ message }) => message);
    const count = (evidence, name) => messages(evidence).filter((m) => m === name).length;

    async function connectSilently(profile, options = { bootRequestDelayMs: 50 }) {
      const evidence = new MemoryEvidenceStore();
      gateway = createChargeGateway(config, evidence, options);
      const server = await gateway.listen(0, "127.0.0.1");
      charger = createSimulatedCharger({
        boot: { firmwareVersion: "7.1.0", model: "Sim S-line", vendor: "SimVendor" },
        endpoint: `ws://127.0.0.1:${server.address().port}`,
        identity: config.stationId,
        password: STATION_SECRET,
        profile,
      });
      await charger.connect();
      return evidence;
    }

    it("asks once for the identity and records request, answer and Boot", async () => {
      const evidence = await connectSilently("conformant");
      await vi.waitFor(() => expect(count(evidence, "BootNotification")).toBe(1));
      const sequence = messages(evidence);
      const request = sequence.indexOf("TriggerMessage");
      expect(sequence.indexOf("Connected")).toBeLessThan(request);
      expect(request).toBeLessThan(sequence.indexOf("BootNotification"));
      expect(evidence.events[request]).toMatchObject({
        direction: "csms-to-station",
        payload: { requestedMessage: "BootNotification" },
      });
      await vi.waitFor(() =>
        expect(evidence.events.find((e) => e.message === "TriggerMessageResult")).toMatchObject({
          direction: "station-to-csms",
          payload: { status: "Accepted" },
        }),
      );
      const snapshot = buildOwnerSnapshot(config, gateway, evidence.events);
      expect(snapshot.station.boot).toMatchObject({ model: "Sim S-line", vendor: "SimVendor" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(count(evidence, "TriggerMessage")).toBe(1);
    });

    it("does not ask a charger that announced itself", async () => {
      const evidence = await connectSilently("conformant");
      await charger.boot();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(count(evidence, "TriggerMessage")).toBe(0);
    });

    it("does not ask after the charger disconnected", async () => {
      const evidence = await connectSilently("conformant", { bootRequestDelayMs: 150 });
      await charger.close();
      charger = undefined;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(count(evidence, "TriggerMessage")).toBe(0);
    });

    it("trigger-unsupported: records NotImplemented and owner charging still works", async () => {
      const evidence = await connectSilently("trigger-unsupported");
      await vi.waitFor(() =>
        expect(evidence.events.find((e) => e.message === "TriggerMessageResult")).toMatchObject({
          payload: { status: "NotImplemented" },
        }),
      );
      expect(count(evidence, "BootNotification")).toBe(0);
      await expect(charger.runSession({ energyWh: 1_000, tag: OWNER_TAG })).resolves.toMatchObject({
        authorization: "Accepted",
      });
      await expect(charger.runSession({ tag: "not-an-owner-card" })).resolves.toEqual({
        authorization: "Invalid",
        transactionId: null,
      });
      expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);
    });

    it("never lets a requested Boot clear a pending RebootRequired", async () => {
      const evidence = await connectSilently("conformant", { bootRequestDelayMs: 200 });
      await vi.waitFor(() => expect(count(evidence, "Connected")).toBe(1));
      // A settings change answered RebootRequired before chargeOS asked for the identity.
      evidence.events.push({
        ...evidence.events.at(-1),
        direction: "station-to-csms",
        eventId: "reboot-required",
        message: "ChangeConfigurationResult",
        payload: { status: "RebootRequired" },
      });
      await vi.waitFor(() => expect(count(evidence, "BootNotification")).toBe(1));
      await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
        restartRequired: true,
        state: "blocked",
      });

      // A real restart (new connection, the charger's own Boot) clears it.
      await charger.close();
      await charger.connect();
      await charger.boot();
      await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
        restartRequired: false,
        state: "ready",
      });
    });

    it("does not report an owner restart from a reconnect plus a requested Boot", () => {
      const event = (message, direction, payload, at) => ({
        at,
        direction,
        eventId: `${message}-${at}`,
        message,
        payload,
        stationId: config.stationId,
      });
      const base = [
        event(
          "StationCommandRequested",
          "system",
          { commandId: "c1", resetType: "Soft", type: "Reset" },
          "2026-11-03T12:00:00.000Z",
        ),
        event(
          "Reset",
          "csms-to-station",
          { commandId: "c1", type: "Soft" },
          "2026-11-03T12:00:00.100Z",
        ),
        event(
          "StationCommandResult",
          "station-to-csms",
          { commandId: "c1", status: "Accepted" },
          "2026-11-03T12:00:00.200Z",
        ),
        event("Disconnected", "system", {}, "2026-11-03T12:00:05.000Z"),
        event("Connected", "system", {}, "2026-11-03T12:00:20.000Z"),
      ];
      const boot = event(
        "BootNotification",
        "station-to-csms",
        { chargePointModel: "M", chargePointVendor: "V" },
        "2026-11-03T12:00:51.000Z",
      );
      const requested = [
        ...base,
        event(
          "TriggerMessage",
          "csms-to-station",
          { requestedMessage: "BootNotification" },
          "2026-11-03T12:00:50.000Z",
        ),
        boot,
      ];
      const now = new Date("2026-11-03T12:05:00.000Z");
      expect(buildStationCommands(requested, now)[0].observed).toBeNull();
      expect(buildStationCommands([...base, boot], now)[0].observed).toMatch(/restarted/);
    });
  });
});
