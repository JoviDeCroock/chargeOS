import { connect, type AddressInfo } from "node:net";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";
import { createChargeGateway, type ChargeGateway } from "../server/gateway.js";
import { buildDelegateStationStatus, buildOwnerSnapshot } from "../server/projections.js";

const STATION_SECRET = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210fedcba98";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  async allocateAuthorizationRevision(_stationId: string, minimum: number): Promise<number> {
    return minimum;
  }
  async recordTransactionStart(
    _stationId: string,
    _fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ replayed: boolean; transactionId: number }> {
    this.events.push(event(1));
    return { replayed: false, transactionId: 1 };
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
  ocppPublicUrl: "wss://ocpp.example.test/",
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set(["owner-tag"]),
  port: 0,
  stationId: "HOME-1",
  stationSecret: STATION_SECRET,
  stations: [
    {
      id: "HOME-1",
      label: "Home",
      ownerTags: new Set(["owner-tag"]),
      secret: STATION_SECRET,
      site: "Home",
    },
    {
      id: "HOME-2",
      label: "Holiday home",
      ownerTags: new Set(["other-tag"]),
      secret: OTHER_SECRET,
      site: "Coast",
    },
  ],
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

function basic(identity: string, password: string): string {
  return `Basic ${Buffer.from(`${identity}:${password}`).toString("base64")}`;
}

function rawUpgrade(
  port: number,
  identity: string,
  headers: Record<string, string | undefined>,
): Promise<string> {
  const base: Record<string, string> = {
    Connection: "Upgrade",
    Host: "127.0.0.1",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Protocol": "ocpp1.6",
    "Sec-WebSocket-Version": "13",
    Upgrade: "websocket",
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete base[name];
    else base[name] = value;
  }
  const lines = [
    `GET /${encodeURIComponent(identity)} HTTP/1.1`,
    ...Object.entries(base).map(([name, value]) => `${name}: ${value}`),
  ];
  return new Promise((resolveReply, rejectReply) => {
    let reply = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      reply += chunk;
      // An accepted upgrade stays open; the status line is enough.
      if (reply.includes("\r\n\r\n")) socket.destroy();
    });
    socket.on("error", rejectReply);
    socket.on("close", () => resolveReply(reply));
  });
}

describe("charger connection diagnostics", () => {
  let gateway: ChargeGateway | undefined;
  let client: RPCClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true });
    client = undefined;
    await gateway?.close();
  });

  async function start() {
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    return { evidence, port: (httpServer.address() as AddressInfo).port };
  }

  it("explains a wrong or missing password for a known charger name", async () => {
    const { evidence, port } = await start();
    expect(gateway!.getRuntime("HOME-1").connection).toMatchObject({
      endpointBase: "wss://ocpp.example.test/",
      lastRefused: null,
      refusedSinceStart: 0,
    });

    await expect(
      rawUpgrade(port, "HOME-1", { Authorization: basic("HOME-1", "wrong-password-value") }),
    ).resolves.toMatch(/^HTTP\/1\.1 401 /);
    expect(gateway!.getRuntime("HOME-1").connection?.lastRefused).toMatchObject({
      offeredProtocols: [],
      presentedIdentity: null,
      reason: "password-wrong",
    });

    await expect(rawUpgrade(port, "HOME-1", {})).resolves.toMatch(/^HTTP\/1\.1 401 /);
    expect(gateway!.getRuntime("HOME-1").connection?.lastRefused?.reason).toBe("password-missing");
    // A user name other than the charger name means no usable password reached chargeOS.
    await rawUpgrade(port, "HOME-1", { Authorization: basic("admin", STATION_SECRET) });
    expect(gateway!.getRuntime("HOME-1").connection).toMatchObject({
      lastRefused: { reason: "password-missing" },
      refusedSinceStart: 3,
    });
    // Refusals are diagnostics, never evidence, and are scoped to their own charger.
    expect(evidence.events).toHaveLength(0);
    expect(gateway!.getRuntime("HOME-2").connection?.refusedSinceStart).toBe(0);
  });

  it("names the charger that sent this charger's password under a different name", async () => {
    const { evidence, port } = await start();
    await expect(
      rawUpgrade(port, "ACE0123456", { Authorization: basic("ACE0123456", OTHER_SECRET) }),
    ).resolves.toMatch(/^HTTP\/1\.1 401 /);
    expect(gateway!.getRuntime("HOME-2").connection?.lastRefused).toMatchObject({
      presentedIdentity: "ACE0123456",
      reason: "identity-mismatch",
    });
    expect(gateway!.getRuntime("HOME-1").connection?.lastRefused).toBeNull();

    // A name that is not printable ASCII is never echoed back.
    await rawUpgrade(port, "naïve\u0007", { Authorization: basic("naïve\u0007", STATION_SECRET) });
    expect(gateway!.getRuntime("HOME-1").connection?.lastRefused).toMatchObject({
      presentedIdentity: null,
      reason: "identity-mismatch",
    });
    expect(evidence.events).toHaveLength(0);
  });

  it("counts unknown name and password attempts without keeping any of their text", async () => {
    const { port } = await start();
    await rawUpgrade(port, "SCANNER", { Authorization: basic("SCANNER", "guess-guess-guess") });
    await rawUpgrade(port, "SCANNER", {});
    for (const stationId of ["HOME-1", "HOME-2"]) {
      const connection = gateway!.getRuntime(stationId).connection!;
      expect(connection.unmatchedSinceStart).toBe(2);
      expect(connection.lastUnmatchedAt).toEqual(expect.any(String));
      expect(connection.lastRefused).toBeNull();
      expect(JSON.stringify(connection)).not.toContain("SCANNER");
      expect(JSON.stringify(connection)).not.toContain("guess");
    }
  });

  it("tells the owner when the charger offers another OCPP version", async () => {
    const { port } = await start();
    await expect(
      rawUpgrade(port, "HOME-1", {
        Authorization: basic("HOME-1", STATION_SECRET),
        "Sec-WebSocket-Protocol": "ocpp2.0.1, vendor-private, ocpp1.5",
      }),
    ).resolves.toMatch(/^HTTP\/1\.1 400 /);
    expect(gateway!.getRuntime("HOME-1").connection?.lastRefused).toMatchObject({
      offeredProtocols: ["ocpp2.0.1", "ocpp1.5"],
      reason: "protocol-not-offered",
    });
    expect(gateway!.getRuntime("HOME-1").connected).toBe(false);
  });

  it("clears the explanation on a successful connection and reports a duplicate", async () => {
    const { port } = await start();
    await rawUpgrade(port, "HOME-1", { Authorization: basic("HOME-1", "wrong-password-value") });
    client = new RPCClient({
      endpoint: `ws://127.0.0.1:${port}`,
      identity: "HOME-1",
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      strictMode: true,
    } as ConstructorParameters<typeof RPCClient>[0]);
    await client.connect();
    expect(gateway!.getRuntime("HOME-1")).toMatchObject({
      connected: true,
      connection: { lastRefused: null, refusedSinceStart: 1 },
    });

    await expect(
      rawUpgrade(port, "HOME-1", { Authorization: basic("HOME-1", STATION_SECRET) }),
    ).resolves.toMatch(/^HTTP\/1\.1 409 /);
    expect(gateway!.getRuntime("HOME-1")).toMatchObject({
      connected: true,
      connection: { lastRefused: { reason: "already-connected" } },
    });
  });

  it("shows diagnostics to the owner only, never to a delegate", async () => {
    const { evidence, port } = await start();
    await rawUpgrade(port, "ACE0123456", { Authorization: basic("ACE0123456", STATION_SECRET) });
    const owner = buildOwnerSnapshot(config, gateway!, evidence.events);
    expect(owner.station.connection.lastRefused?.presentedIdentity).toBe("ACE0123456");
    const delegate = buildDelegateStationStatus(config, gateway!, evidence.events);
    expect(JSON.stringify(delegate)).not.toContain("ACE0123456");
    expect(JSON.stringify(delegate)).not.toContain("lastRefused");
    expect(JSON.stringify(owner)).not.toContain(STATION_SECRET);
  });
});
