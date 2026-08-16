import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { RPCClient } from "ocpp-rpc";
import { describe, expect, it } from "vitest";

import { loadConfig, type GatewayConfig } from "../server/config.js";
import {
  createContinuityBundle,
  openContinuityBundle,
  restoreContinuityPayload,
} from "../server/continuity.js";
import { NdjsonEvidenceStore } from "../server/events.js";
import { createChargeGateway } from "../server/gateway.js";

const OWNER_TAG = "owner-recovery-tag";
const STATION_SECRET = "station-recovery-secret-1234";
const PASSPHRASE = "owner-recovery-passphrase";
const TRANSACTION = {
  connectorId: 1,
  idTag: OWNER_TAG,
  meterStart: 42_000,
  timestamp: "2026-08-14T12:00:00.000Z",
};

describe("gateway disaster recovery", () => {
  it("restores onto a replacement edge and deduplicates the charger's replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-edge-recovery-"));
    const sourcePath = join(directory, "source.ndjson");
    const target = join(directory, "replacement");
    const sourceConfig = config(sourcePath);
    const sourceStore = new NdjsonEvidenceStore(sourcePath);
    const sourceGateway = createChargeGateway(sourceConfig, sourceStore);
    let sourceClient: RPCClient | undefined;
    let replacementClient: RPCClient | undefined;
    let replacementGateway: ReturnType<typeof createChargeGateway> | undefined;

    try {
      const sourceServer = await sourceGateway.listen(0, "127.0.0.1");
      sourceClient = client((sourceServer.address() as AddressInfo).port);
      await sourceClient.connect();
      await expect(sourceClient.call("StartTransaction", TRANSACTION)).resolves.toMatchObject({
        transactionId: 1,
      });

      const encrypted = await createContinuityBundle(
        sourceConfig,
        await sourceStore.readEvents(),
        PASSPHRASE,
      );
      const payload = await openContinuityBundle(JSON.stringify(encrypted), PASSPHRASE);
      await restoreContinuityPayload(payload, target);

      await sourceClient.close({ force: true });
      sourceClient = undefined;
      await sourceGateway.close();

      const replacementPath = join(target, "events.ndjson");
      const replacementStore = new NdjsonEvidenceStore(replacementPath);
      const replacementConfig = loadConfig(parseEnv(await readFile(join(target, ".env"), "utf8")));
      expect(replacementConfig).toMatchObject({
        eventLogPath: replacementPath,
        ocppMaxConnections: 3,
        ocppMaxPayloadBytes: 262_144,
        ocppMessageBurst: 17,
        ocppMessagesPerMinute: 123,
        trustProxyHeaders: false,
      });
      replacementGateway = createChargeGateway(replacementConfig, replacementStore);
      const replacementServer = await replacementGateway.listen(0, "127.0.0.1");
      replacementClient = client((replacementServer.address() as AddressInfo).port);
      await replacementClient.connect();

      await expect(replacementClient.call("StartTransaction", TRANSACTION)).resolves.toMatchObject({
        transactionId: 1,
      });
      expect((await replacementStore.readEvents()).map((event) => event.message)).toContain(
        "StartTransactionReplay",
      );
    } finally {
      await sourceClient?.close({ force: true });
      await replacementClient?.close({ force: true });
      await sourceGateway.close().catch(() => undefined);
      await replacementGateway?.close().catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function config(eventLogPath: string): GatewayConfig {
  return {
    apiHost: "127.0.0.1",
    apiPort: 9080,
    eventLogPath,
    eventLogMaxBytes: 268_435_456,
    heartbeatSeconds: 60,
    ocppHost: "127.0.0.1",
    ocppMaxConnections: 3,
    ocppMaxPayloadBytes: 262_144,
    ocppMessageBurst: 17,
    ocppMessagesPerMinute: 123,
    ownerApiToken: "owner-api-token-with-at-least-thirty-two-characters",
    ownerTags: new Set([OWNER_TAG]),
    port: 9000,
    stationId: "RECOVERY_STATION",
    stationSecret: STATION_SECRET,
    trustProxyHeaders: true,
    uiDirectory: "dist/ui",
  };
}

function client(port: number): RPCClient {
  return new RPCClient({
    endpoint: `ws://127.0.0.1:${port}`,
    identity: "RECOVERY_STATION",
    password: STATION_SECRET,
    protocols: ["ocpp1.6"],
    strictMode: true,
  } as ConstructorParameters<typeof RPCClient>[0]);
}
