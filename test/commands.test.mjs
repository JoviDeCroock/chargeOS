import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSimulatedCharger } from "../scripts/simulate-charger.mjs";
import { createOwnerApi } from "../server/api.ts";
import {
  buildStationCommands,
  parseStationCommandInput,
  StationCommandConflictError,
} from "../server/commands.ts";
import { evidenceEvent } from "../server/events.ts";
import { createChargeGateway } from "../server/gateway.ts";
import { OwnerTagRegistry, withOwnerTagRegistry } from "../server/owner-tags.ts";
import { buildOwnerSnapshot } from "../server/projections.ts";
import { pseudonymizeTag } from "../server/tag.ts";
import { STATION_RESET_PHRASE, STATION_UNLOCK_PHRASE } from "../shared/commands.ts";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.ts";

const OWNER_TAG = "remote-owner-card";
const STATION_SECRET = "0123456789abcdef0123456789abcdef01234567";
const TOKEN = "owner-token-at-least-thirty-two-characters";
const OWNER_PSEUDONYM = `tag_${pseudonymizeTag(OWNER_TAG, STATION_SECRET)}`;

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
  ownerApiToken: TOKEN,
  ownerTags: new Set([OWNER_TAG]),
  port: 0,
  stationId: "REMOTE_1",
  stationSecret: STATION_SECRET,
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

describe("owner station commands (P08/P09)", () => {
  let gateway;
  let charger;
  let rawClient;
  let api;
  let directory;

  afterEach(async () => {
    await charger?.close();
    await rawClient?.close({ force: true });
    await api?.close();
    await gateway?.close();
    if (directory) await rm(directory, { force: true, recursive: true });
    charger = rawClient = api = directory = undefined;
  });

  async function start(options = {}) {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence, options);
    const server = await gateway.listen(0, "127.0.0.1");
    charger = createSimulatedCharger({
      endpoint: `ws://127.0.0.1:${server.address().port}`,
      identity: config.stationId,
      password: STATION_SECRET,
    });
    await charger.connect();
    await charger.boot();
    return evidence;
  }

  const commands = (evidence) => buildStationCommands(evidence.events);

  it("remote start uses a desired owner card by pseudonym and shows the observed session", async () => {
    const evidence = await start();
    const command = await gateway.sendStationCommand(config.stationId, {
      connectorId: 1,
      tagPseudonym: OWNER_PSEUDONYM,
      type: "RemoteStartTransaction",
    });
    expect(command).toMatchObject({ state: "accepted", status: "Accepted" });
    await vi.waitFor(() =>
      expect(commands(evidence)[0]?.observed).toBe("Session #1 started on connector 1"),
    );
    expect(charger.activeTransactionIds).toEqual([1]);

    const sent = evidence.events.find((event) => event.message === "RemoteStartTransaction");
    expect(sent?.direction).toBe("csms-to-station");
    expect(sent?.payload).toMatchObject({ idTag: OWNER_PSEUDONYM });
    expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);

    await expect(
      gateway.sendStationCommand(config.stationId, {
        connectorId: 1,
        tagPseudonym: OWNER_PSEUDONYM,
        type: "RemoteStartTransaction",
      }),
    ).rejects.toThrow(/already active/);
  });

  it("refuses an unknown card before recording or sending anything", async () => {
    const evidence = await start();
    const before = evidence.events.length;
    await expect(
      gateway.sendStationCommand(config.stationId, {
        connectorId: 1,
        tagPseudonym: `tag_${"0".repeat(24)}`,
        type: "RemoteStartTransaction",
      }),
    ).rejects.toBeInstanceOf(StationCommandConflictError);
    expect(evidence.events.length).toBe(before);
  });

  it("remote stop targets only an active session and reports the observed stop", async () => {
    const evidence = await start();
    const { transactionId } = await charger.startSession({ tag: OWNER_TAG });
    const command = await gateway.sendStationCommand(config.stationId, {
      transactionId,
      type: "RemoteStopTransaction",
    });
    expect(command.state).toBe("accepted");
    await vi.waitFor(() =>
      expect(commands(evidence)[0]?.observed).toBe(`Session #${transactionId} stopped`),
    );
    const snapshot = buildOwnerSnapshot(config, gateway, evidence.events);
    expect(snapshot.sessions[0]).toMatchObject({ status: "complete", transactionId });

    await expect(
      gateway.sendStationCommand(config.stationId, {
        transactionId,
        type: "RemoteStopTransaction",
      }),
    ).rejects.toThrow(/not active/);
    await expect(
      gateway.sendStationCommand(config.stationId, {
        transactionId: 999,
        type: "RemoteStopTransaction",
      }),
    ).rejects.toThrow(/not active/);
  });

  it("reset, unlock and set-operative record the charger's answer and later observation", async () => {
    const evidence = await start();
    await expect(
      gateway.sendStationCommand(config.stationId, {
        confirmation: STATION_RESET_PHRASE,
        resetType: "Soft",
        type: "Reset",
      }),
    ).resolves.toMatchObject({ resetType: "Soft", state: "accepted" });
    await vi.waitFor(() =>
      expect(commands(evidence)[0]?.observed).toMatch(/^Charger restarted and reconnected at /),
    );

    await expect(
      gateway.sendStationCommand(config.stationId, {
        confirmation: STATION_UNLOCK_PHRASE,
        connectorId: 1,
        type: "UnlockConnector",
      }),
    ).resolves.toMatchObject({
      observed: "Charger reported the connector unlocked",
      state: "accepted",
      status: "Unlocked",
    });

    await gateway.sendStationCommand(config.stationId, {
      availability: "Operative",
      connectorId: 1,
      type: "ChangeAvailability",
    });
    await vi.waitFor(() =>
      expect(commands(evidence)[0]).toMatchObject({
        observed: "Connector now reports Available",
        state: "accepted",
        type: "ChangeAvailability",
      }),
    );
    const snapshot = buildOwnerSnapshot(config, gateway, evidence.events);
    expect(snapshot.commands.map(({ type }) => type)).toEqual([
      "ChangeAvailability",
      "UnlockConnector",
      "Reset",
    ]);
  });

  it("marks a timed-out command uncertain instead of failed or successful", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence, { commandTimeoutMs: 150 });
    const server = await gateway.listen(0, "127.0.0.1");
    rawClient = new RPCClient({
      endpoint: `ws://127.0.0.1:${server.address().port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      reconnect: false,
      strictMode: true,
    });
    rawClient.handle("Reset", () => new Promise(() => undefined));
    await rawClient.connect();

    const command = await gateway.sendStationCommand(config.stationId, {
      confirmation: STATION_RESET_PHRASE,
      resetType: "Hard",
      type: "Reset",
    });
    expect(command).toMatchObject({ observed: null, state: "uncertain", status: "timeout" });
  });

  it("marks an unsupported command failed with the charger's protocol error", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const server = await gateway.listen(0, "127.0.0.1");
    rawClient = new RPCClient({
      endpoint: `ws://127.0.0.1:${server.address().port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      reconnect: false,
      strictMode: true,
    });
    await rawClient.connect();
    await expect(
      gateway.sendStationCommand(config.stationId, {
        confirmation: STATION_UNLOCK_PHRASE,
        connectorId: 1,
        type: "UnlockConnector",
      }),
    ).resolves.toMatchObject({ state: "failed", status: "call-error:NotImplemented" });
  });

  it("refuses commands for a disconnected charger without recording intent", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    await gateway.listen(0, "127.0.0.1");
    await expect(
      gateway.sendStationCommand(config.stationId, {
        confirmation: STATION_RESET_PHRASE,
        resetType: "Soft",
        type: "Reset",
      }),
    ).rejects.toThrow(/not connected/);
    expect(evidence.events).toEqual([]);
  });

  it("projects a command with no recorded answer as uncertain after the answer window", () => {
    const requested = {
      ...evidenceEvent("REMOTE_1", "system", "StationCommandRequested", {
        commandId: "c1",
        resetType: "Soft",
        type: "Reset",
      }),
      at: "2026-11-01T10:00:00.000Z",
    };
    expect(buildStationCommands([requested], new Date("2026-11-01T10:00:10.000Z"))[0]?.state).toBe(
      "pending",
    );
    expect(
      buildStationCommands([requested], new Date("2026-11-01T10:05:00.000Z"))[0],
    ).toMatchObject({ state: "uncertain", status: "no-answer-recorded" });
  });

  it("keeps commands and owner cards isolated between fleet stations", async () => {
    const officeSecret = "fedcba9876543210fedcba9876543210fedcba98";
    const fleetConfig = {
      ...config,
      stations: [
        {
          id: config.stationId,
          label: "Home",
          ownerTags: new Set([OWNER_TAG]),
          secret: STATION_SECRET,
          site: "Home",
        },
        {
          id: "OFFICE_1",
          label: "Office",
          ownerTags: new Set(["office-card"]),
          secret: officeSecret,
          site: "Office",
        },
      ],
    };
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(fleetConfig, evidence);
    const server = await gateway.listen(0, "127.0.0.1");
    const endpoint = `ws://127.0.0.1:${server.address().port}`;
    charger = createSimulatedCharger({ endpoint, identity: "OFFICE_1", password: officeSecret });
    await charger.connect();
    await charger.boot();

    // The home owner card is not a desired card for the office charger.
    await expect(
      gateway.sendStationCommand("OFFICE_1", {
        connectorId: 1,
        tagPseudonym: OWNER_PSEUDONYM,
        type: "RemoteStartTransaction",
      }),
    ).rejects.toThrow(/desired owner card/);
    // The home charger is offline; a command for it never reaches the office socket.
    await expect(
      gateway.sendStationCommand(config.stationId, {
        confirmation: STATION_RESET_PHRASE,
        resetType: "Soft",
        type: "Reset",
      }),
    ).rejects.toThrow(/not connected/);
    await expect(
      gateway.sendStationCommand("UNKNOWN", {
        confirmation: STATION_RESET_PHRASE,
        resetType: "Soft",
        type: "Reset",
      }),
    ).rejects.toThrow();
    expect(evidence.events.filter((event) => event.message === "StationCommandRequested")).toEqual(
      [],
    );

    const officeCard = `tag_${pseudonymizeTag("office-card", officeSecret)}`;
    await expect(
      gateway.sendStationCommand("OFFICE_1", {
        connectorId: 1,
        tagPseudonym: officeCard,
        type: "RemoteStartTransaction",
      }),
    ).resolves.toMatchObject({ state: "accepted" });
    const requested = evidence.events.filter(
      (event) => event.message === "StationCommandRequested",
    );
    expect(requested.map((event) => event.stationId)).toEqual(["OFFICE_1"]);
  });

  it("validates input strictly and never makes a charger Inoperative", () => {
    expect(() =>
      parseStationCommandInput({
        availability: "Inoperative",
        connectorId: 1,
        type: "ChangeAvailability",
      }),
    ).toThrow(/never makes a charger Inoperative/);
    expect(() => parseStationCommandInput({ resetType: "Soft", type: "Reset" })).toThrow(
      /reset phrase/,
    );
    expect(() =>
      parseStationCommandInput({ confirmation: "yes", connectorId: 1, type: "UnlockConnector" }),
    ).toThrow(/unlock phrase/);
    expect(() =>
      parseStationCommandInput({
        connectorId: 1,
        idTag: OWNER_TAG,
        tagPseudonym: OWNER_PSEUDONYM,
        type: "RemoteStartTransaction",
      }),
    ).toThrow(/unexpected field idTag/);
    expect(() =>
      parseStationCommandInput({
        connectorId: 0,
        tagPseudonym: OWNER_PSEUDONYM,
        type: "RemoteStartTransaction",
      }),
    ).toThrow(/connectorId/);
    expect(() => parseStationCommandInput({ type: "ChangeConfiguration" })).toThrow(/type must be/);
  });

  it("exposes commands only through the owner-authenticated station route", async () => {
    await start();
    directory = await mkdtemp(join(tmpdir(), "chargeos-commands-ui-"));
    await writeFile(join(directory, "index.html"), "<h1>chargeOS</h1>");
    const registry = OwnerTagRegistry.memory(config.ownerTags, STATION_SECRET);
    const live = withOwnerTagRegistry({ ...config, uiDirectory: directory }, registry);
    const evidence = new MemoryEvidenceStore();
    api = createOwnerApi(live, gateway, evidence, registry);
    const port = await api.listen(0, "127.0.0.1");
    const url = `http://127.0.0.1:${port}/api/v1/stations/${config.stationId}/commands`;
    const post = (body, token = TOKEN) =>
      fetch(url, {
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });

    expect((await post({ type: "Reset" }, "wrong-token")).status).toBe(401);
    const invalid = await post({
      availability: "Inoperative",
      connectorId: 1,
      type: "ChangeAvailability",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_station_command");
    const conflict = await post({ transactionId: 42, type: "RemoteStopTransaction" });
    expect(conflict.status).toBe(409);
    const ok = await post({
      confirmation: STATION_UNLOCK_PHRASE,
      connectorId: 1,
      type: "UnlockConnector",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).command).toMatchObject({ state: "accepted", type: "UnlockConnector" });
  });
});
