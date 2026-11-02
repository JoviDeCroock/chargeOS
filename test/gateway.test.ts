import { connect, type AddressInfo } from "node:net";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";
import {
  createChargeGateway,
  OwnerContinuityPreparationBlockedError,
  OwnerContinuityRestartRequiredError,
  type ChargeGateway,
} from "../server/gateway.js";
import { buildOwnerSnapshot } from "../server/projections.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";

const OWNER_TAG = "owner-secret-tag";
const STATION_SECRET = "station-secret-at-least-sixteen";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  #authorizationRevision = 0;
  readonly #transactions = new Map<string, number>();
  #nextTransactionId = 1;

  async allocateAuthorizationRevision(_stationId: string, minimum: number): Promise<number> {
    this.#authorizationRevision = Math.max(this.#authorizationRevision + 1, minimum);
    return this.#authorizationRevision;
  }

  async recordTransactionStart(
    _stationId: string,
    fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ replayed: boolean; transactionId: number }> {
    const existing = this.#transactions.get(fingerprint);
    if (existing) return { replayed: true, transactionId: existing };
    const transactionId = this.#nextTransactionId++;
    this.#transactions.set(fingerprint, transactionId);
    this.events.push(event(transactionId));
    return { replayed: false, transactionId };
  }

  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }

  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

const config: GatewayConfig = {
  apiHost: "127.0.0.1",
  apiPort: 0,
  eventLogPath: "unused.ndjson",
  eventLogMaxBytes: 268_435_456,
  heartbeatSeconds: 60,
  ocppHost: "127.0.0.1",
  ocppMaxConnections: 8,
  ocppMaxPayloadBytes: 1_048_576,
  ocppMessageBurst: 60,
  ocppMessagesPerMinute: 600,
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set([OWNER_TAG]),
  port: 0,
  stationId: "ALFEN_TEST",
  stationSecret: STATION_SECRET,
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

describe("OCPP 1.6J Genesis gateway", () => {
  let gateway: ChargeGateway | undefined;
  let client: RPCClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true });
    await gateway?.close();
  });

  it("authenticates the provisioned station and records a redacted session", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);

    client.handle("GetConfiguration", async ({ params }) => {
      const keys = params?.key;
      if (!Array.isArray(keys)) {
        throw new Error("Expected configuration keys");
      }
      const values: Record<string, string> = {
        AllowOfflineTxForUnknownId: "false",
        LocalAuthListEnabled: "true",
        LocalAuthorizeOffline: "true",
        LocalAuthListMaxLength: "100",
        SendLocalListMaxLength: "100",
      };
      return {
        configurationKey: keys.map((key) => ({
          key,
          readonly: false,
          value: values[key] ?? "true",
        })),
      };
    });
    client.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
    client.handle("SendLocalList", async () => ({ status: "Accepted" }));

    await client.connect();

    await expect(
      client.call("BootNotification", {
        chargePointModel: "Eve Single S-line",
        chargePointVendor: "Alfen",
        firmwareVersion: "test",
      }),
    ).resolves.toMatchObject({ status: "Accepted" });

    await expect(client.call("Authorize", { idTag: OWNER_TAG })).resolves.toEqual({
      idTagInfo: { status: "Accepted" },
    });
    await expect(client.call("Authorize", { idTag: "unknown-tag" })).resolves.toEqual({
      idTagInfo: { status: "Invalid" },
    });

    const start = await client.call("StartTransaction", {
      connectorId: 1,
      idTag: OWNER_TAG,
      meterStart: 10_000,
      timestamp: "2026-08-14T10:00:00.000Z",
    });
    expect(start).toMatchObject({ idTagInfo: { status: "Accepted" }, transactionId: 1 });
    await expect(
      client.call("StartTransaction", {
        connectorId: 1,
        idTag: OWNER_TAG,
        meterStart: 10_000,
        timestamp: "2026-08-14T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ transactionId: 1 });

    await client.call("MeterValues", {
      connectorId: 1,
      meterValue: [
        {
          sampledValue: [
            {
              context: "Sample.Periodic",
              measurand: "Energy.Active.Import.Register",
              unit: "Wh",
              value: "10500",
            },
          ],
          timestamp: "2026-08-14T10:05:00.000Z",
        },
      ],
      transactionId: 1,
    });
    await client.call("StopTransaction", {
      idTag: OWNER_TAG,
      meterStop: 11_000,
      timestamp: "2026-08-14T10:10:00.000Z",
      transactionId: 1,
    });

    await expect(gateway.inspectLocalAuthorization(config.stationId)).resolves.toMatchObject({
      state: "ready",
    });
    await expect(gateway.syncOwnerList(config.stationId)).resolves.toEqual({
      listVersion: 1,
      status: "Accepted",
    });
    await expect(
      client.call("DataTransfer", { data: OWNER_TAG, vendorId: "untrusted-vendor" }),
    ).resolves.toEqual({ status: "UnknownVendorId" });

    const persisted = JSON.stringify(evidence.events);
    expect(persisted).not.toContain(OWNER_TAG);
    expect(persisted).not.toContain('"idTag":"unknown-tag"');
    expect(evidence.events.map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "BootNotification",
        "Authorize",
        "AuthorizationDecision",
        "StartTransaction",
        "StartTransactionReplay",
        "MeterValues",
        "StopTransaction",
        "GetConfiguration",
        "GetLocalListVersion",
        "SendLocalList",
      ]),
    );
    expect(
      evidence.events.find((event) => event.message === "StartTransaction")?.payload,
    ).toMatchObject({ authorizationStatus: "Accepted" });
    expect(
      evidence.events.find((event) => event.message === "SendLocalListResult")?.payload,
    ).toEqual({ listVersion: 1, status: "Accepted" });
  });

  it("rejects an unprovisioned identity", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port, "UNTRUSTED");

    await expect(client.connect()).rejects.toThrow();
    expect(evidence.events).toHaveLength(0);
  });

  it("authenticates multiple provisioned stations with isolated credentials and owner tags", async () => {
    const evidence = new MemoryEvidenceStore();
    const fleetConfig: GatewayConfig = {
      ...config,
      stations: [
        {
          id: config.stationId,
          label: "Home charger",
          ownerTags: new Set([OWNER_TAG]),
          secret: STATION_SECRET,
          site: "Home",
        },
        {
          id: "OFFICE_1",
          label: "Office charger",
          ownerTags: new Set(["office-owner-tag"]),
          secret: "office-station-secret-strong",
          site: "Office",
        },
      ],
    };
    gateway = createChargeGateway(fleetConfig, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    const home = fleetClient(port, config.stationId, STATION_SECRET);
    const office = fleetClient(port, "OFFICE_1", "office-station-secret-strong");
    try {
      await Promise.all([home.connect(), office.connect()]);
      await Promise.all([
        home.call("BootNotification", {
          chargePointModel: "Eve Single",
          chargePointVendor: "Alfen",
        }),
        office.call("BootNotification", {
          chargePointModel: "Office simulator",
          chargePointVendor: "chargeOS",
        }),
      ]);

      await expect(home.call("Authorize", { idTag: OWNER_TAG })).resolves.toMatchObject({
        idTagInfo: { status: "Accepted" },
      });
      await expect(home.call("Authorize", { idTag: "office-owner-tag" })).resolves.toMatchObject({
        idTagInfo: { status: "Invalid" },
      });
      await expect(office.call("Authorize", { idTag: "office-owner-tag" })).resolves.toMatchObject({
        idTagInfo: { status: "Accepted" },
      });
      await expect(office.call("Authorize", { idTag: OWNER_TAG })).resolves.toMatchObject({
        idTagInfo: { status: "Invalid" },
      });

      expect(gateway.getRuntime(config.stationId).connected).toBe(true);
      expect(gateway.getRuntime("OFFICE_1").connected).toBe(true);
      expect(
        evidence.events.filter(({ stationId }) => stationId === config.stationId),
      ).not.toHaveLength(0);
      expect(evidence.events.filter(({ stationId }) => stationId === "OFFICE_1")).not.toHaveLength(
        0,
      );
      expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);
      expect(JSON.stringify(evidence.events)).not.toContain("office-owner-tag");
    } finally {
      await Promise.all([home.close({ force: true }), office.close({ force: true })]);
    }
  });

  it("does not project a rejected local list as acknowledged owner access", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);
    client.handle("GetConfiguration", async ({ params }) => ({
      configurationKey: ((params?.key as string[]) ?? []).map((key) => ({
        key,
        readonly: false,
        value:
          key === "AllowOfflineTxForUnknownId"
            ? "false"
            : key === "SendLocalListMaxLength" || key === "LocalAuthListMaxLength"
              ? "100"
              : "true",
      })),
    }));
    client.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
    client.handle("SendLocalList", async () => ({ status: "Failed" }));
    await client.connect();

    await expect(gateway.syncOwnerList(config.stationId)).rejects.toThrow(
      "Charge point rejected local authorization list",
    );
    expect(buildOwnerSnapshot(config, gateway, evidence.events).authorization).toMatchObject({
      lastAttemptRevision: 1,
      lastAttemptStatus: "Failed",
      lastSyncRevision: null,
      pendingAdditions: [expect.stringMatching(/^tag_/u)],
      pendingRevision: null,
      syncState: "never-synced",
    });
  });

  it("moves only writable settings toward owner continuity and verifies the result", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);
    const values: Record<string, string> = {
      AllowOfflineTxForUnknownId: "true",
      LocalAuthListEnabled: "false",
      LocalAuthorizeOffline: "false",
      LocalAuthListMaxLength: "100",
      SendLocalListMaxLength: "100",
    };
    const changes: { key: string; value: string }[] = [];
    client.handle("GetConfiguration", async ({ params }) => {
      const keys = params?.key;
      if (!Array.isArray(keys)) throw new Error("Expected configuration keys");
      return {
        configurationKey: keys.map((key: string) => ({
          key,
          readonly: false,
          value: values[key] ?? "true",
        })),
      };
    });
    client.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
    client.handle("ChangeConfiguration", async ({ params }) => {
      const key = params?.key;
      const value = params?.value;
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Expected a configuration change");
      }
      changes.push({ key, value });
      values[key] = value;
      return { status: "Accepted" };
    });
    await client.connect();

    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).resolves.toMatchObject({
      assessment: { restartRequired: false, state: "ready" },
      changes: [
        { key: "LocalAuthListEnabled", to: "true" },
        { key: "LocalAuthorizeOffline", to: "true" },
        { key: "AllowOfflineTxForUnknownId", to: "false" },
      ],
      state: "ready",
    });
    expect(changes).toEqual([
      { key: "LocalAuthListEnabled", value: "true" },
      { key: "LocalAuthorizeOffline", value: "true" },
      { key: "AllowOfflineTxForUnknownId", value: "false" },
    ]);
    expect(evidence.events.map((event) => event.message)).toContain(
      "ContinuityPreparationVerified",
    );
  });

  it("preflights every setting before mutation and keeps reboot-required changes blocked", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);
    let changeCalls = 0;
    let readonly = true;
    let rebootRequired = true;
    const values: Record<string, string> = {
      AllowOfflineTxForUnknownId: "true",
      LocalAuthListEnabled: "false",
      LocalAuthorizeOffline: "true",
      LocalAuthListMaxLength: "100",
      SendLocalListMaxLength: "100",
    };
    client.handle("GetConfiguration", async ({ params }) => {
      const keys = params?.key;
      if (!Array.isArray(keys)) throw new Error("Expected configuration keys");
      return {
        configurationKey: keys.map((key: string) => ({
          key,
          readonly: key === "LocalAuthListEnabled" ? readonly : false,
          value: values[key] ?? "true",
        })),
      };
    });
    client.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
    client.handle("ChangeConfiguration", async ({ params }) => {
      const key = params?.key;
      const value = params?.value;
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Expected a configuration change");
      }
      changeCalls += 1;
      values[key] = value;
      if (rebootRequired) {
        rebootRequired = false;
        return { status: "RebootRequired" };
      }
      return { status: "Accepted" };
    });
    await client.connect();

    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).rejects.toBeInstanceOf(OwnerContinuityPreparationBlockedError);
    expect(changeCalls).toBe(0);

    readonly = false;
    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).rejects.toBeInstanceOf(OwnerContinuityRestartRequiredError);
    expect(changeCalls).toBe(1);
    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).rejects.toBeInstanceOf(OwnerContinuityRestartRequiredError);
    expect(changeCalls).toBe(1);

    await client.call("BootNotification", {
      chargePointModel: "Eve Single S-line",
      chargePointVendor: "Alfen",
      firmwareVersion: "test",
    });
    await expect(
      gateway.prepareOwnerContinuity(config.stationId, {
        confirmation: CONTINUITY_PREPARATION_PHRASE,
      }),
    ).resolves.toMatchObject({ state: "ready" });
  });

  it("keeps one authenticated connection for the provisioned station", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);
    const duplicate = testClient(port);

    try {
      await client.connect();
      await expect(duplicate.connect()).rejects.toThrow();
      await expect(client.call("Heartbeat", {})).resolves.toHaveProperty("currentTime");
    } finally {
      await duplicate.close({ force: true });
    }
  });

  it("refuses an undecodable upgrade target without terminating the gateway", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;

    const reply = await rawUpgrade(port, "/%E0", {});
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);

    client = testClient(port);
    await client.connect();
    await expect(client.call("Heartbeat", {})).resolves.toHaveProperty("currentTime");
  });

  it("releases the station reservation after an authenticated handshake fails", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    const authorization = Buffer.from(`${config.stationId}:${STATION_SECRET}`).toString("base64");

    const reply = await rawUpgrade(port, `/${config.stationId}`, {
      Authorization: `Basic ${authorization}`,
      "Sec-WebSocket-Key": "bad",
    });
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);

    client = testClient(port);
    await client.connect();
    await expect(client.call("Heartbeat", {})).resolves.toHaveProperty("currentTime");
  });

  it("records charger-chosen namespaced method names only as Unrecognized", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = new RPCClient({
      endpoint: `ws://127.0.0.1:${port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      strictMode: false,
    } as ConstructorParameters<typeof RPCClient>[0]);
    await client.connect();

    await expect(client.call("ocpp-rpc:Heartbeat", {})).rejects.toThrow();
    const recorded = evidence.events.filter((event) => event.direction === "station-to-csms");
    expect(recorded.at(-1)).toMatchObject({ message: "Unrecognized" });
    expect(recorded.some((event) => event.message.includes(":"))).toBe(false);
  });

  it("closes a station that exhausts its message burst", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(
      { ...config, ocppMessageBurst: 1, ocppMessagesPerMinute: 1 },
      evidence,
    );
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = testClient(port);
    await client.connect();

    await expect(
      client.call("BootNotification", {
        chargePointModel: "Eve Single S-line",
        chargePointVendor: "Alfen",
      }),
    ).resolves.toMatchObject({ status: "Accepted" });
    await expect(client.call("Heartbeat", {})).rejects.toThrow();
    expect(evidence.events.map((event) => event.message)).toContain("ProtocolRateLimitExceeded");
  });

  it("closes a station before parsing an oversized WebSocket message", async () => {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway({ ...config, ocppMaxPayloadBytes: 512 }, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = new RPCClient({
      callTimeoutMs: 1_000,
      endpoint: `ws://127.0.0.1:${port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      strictMode: false,
    } as ConstructorParameters<typeof RPCClient>[0]);
    await client.connect();

    await expect(
      client.call("DataTransfer", { data: "x".repeat(2_000), vendorId: "load-test" }),
    ).rejects.toThrow();
    expect(evidence.events.map((event) => event.message)).not.toContain("DataTransfer");
  });
});

function testClient(port: number, identity = config.stationId): RPCClient {
  return fleetClient(port, identity, STATION_SECRET);
}

function fleetClient(port: number, identity: string, password: string): RPCClient {
  return new RPCClient({
    endpoint: `ws://127.0.0.1:${port}`,
    identity,
    password,
    protocols: ["ocpp1.6"],
    strictMode: true,
  } as ConstructorParameters<typeof RPCClient>[0]);
}

function rawUpgrade(
  port: number,
  target: string,
  headers: Record<string, string>,
): Promise<string> {
  const lines = [
    `GET ${target} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Protocol: ocpp1.6",
  ].filter((line) => !Object.keys(headers).some((name) => line.startsWith(`${name}:`)));
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  return new Promise((resolveReply, rejectReply) => {
    let reply = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (reply += chunk));
    socket.on("error", rejectReply);
    socket.on("close", () => resolveReply(reply));
  });
}
