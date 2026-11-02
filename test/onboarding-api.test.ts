import { connect, type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createOwnerApi, type OwnerApi } from "../server/api.js";
import type { GatewayConfig } from "../server/config.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";
import { createChargeGateway, type ChargeGateway } from "../server/gateway.js";
import { OwnerTagRegistry, withOwnerTagRegistry } from "../server/owner-tags.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";
const SECRET = "0123456789abcdef0123456789abcdef01234567";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  async allocateAuthorizationRevision(_stationId: string, minimum: number): Promise<number> {
    return minimum;
  }
  async recordTransactionStart(): Promise<{ replayed: boolean; transactionId: number }> {
    return { replayed: false, transactionId: 1 };
  }
  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }
  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

export function onboardingConfig(): GatewayConfig {
  return {
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
    ownerApiToken: TOKEN,
    ownerTags: new Set(["owner-tag"]),
    port: 0,
    stationId: "HOME-1",
    stationSecret: SECRET,
    trustProxyHeaders: false,
    uiDirectory: "dist/ui",
  };
}

export function upgrade(port: number, identity: string, password: string): Promise<string> {
  const authorization = Buffer.from(`${identity}:${password}`).toString("base64");
  const lines = [
    `GET /${identity} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Upgrade: websocket",
    "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Protocol: ocpp1.6",
    `Authorization: Basic ${authorization}`,
  ];
  return new Promise((resolveReply, rejectReply) => {
    let reply = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      reply += chunk;
      if (reply.includes("\r\n\r\n")) socket.destroy();
    });
    socket.on("error", rejectReply);
    socket.on("close", () => resolveReply(reply));
  });
}

describe("owner onboarding API", () => {
  let api: OwnerApi | undefined;
  let gateway: ChargeGateway | undefined;

  afterEach(async () => {
    await api?.close();
    await gateway?.close();
  });

  async function start() {
    const bootstrap = onboardingConfig();
    const ownerTags = OwnerTagRegistry.memory(bootstrap.ownerTags, bootstrap.stationSecret);
    const config = withOwnerTagRegistry(bootstrap, ownerTags);
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const ocpp = await gateway.listen(0, "127.0.0.1");
    api = createOwnerApi(config, gateway, evidence, ownerTags);
    const apiPort = await api.listen(0, "127.0.0.1");
    const post = (path: string, body: unknown, token = TOKEN) =>
      fetch(`http://127.0.0.1:${apiPort}${path}`, {
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
    return { evidence, ocppPort: (ocpp.address() as AddressInfo).port, post };
  }

  it("adopts a charger name only for the owner and only after a password-proven attempt", async () => {
    const { evidence, ocppPort, post } = await start();
    const path = "/api/v1/stations/HOME-1/identity-alias";
    expect((await post(path, { presentedIdentity: "ACE0123456" })).status).toBe(409);

    await upgrade(ocppPort, "ACE0123456", SECRET);
    expect((await post(path, { presentedIdentity: "ACE0123456" }, "wrong-token")).status).toBe(401);
    expect((await post(path, { presentedIdentity: "ACE0123456", extra: true })).status).toBe(400);
    const accepted = await post(path, { presentedIdentity: "ACE0123456" });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({
      alias: "ACE0123456",
      replacedAlias: null,
      stationId: "HOME-1",
    });
    expect(evidence.events.map(({ message }) => message)).toEqual(["StationIdentityAliasAccepted"]);
    await expect(upgrade(ocppPort, "ACE0123456", SECRET)).resolves.toMatch(/^HTTP\/1\.1 101 /);
  });
});
