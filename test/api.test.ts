import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createOwnerApi, type OwnerApi } from "../server/api.js";
import type { GatewayConfig } from "../server/config.js";
import {
  evidenceEvent,
  type EvidenceCapacity,
  type EvidenceEvent,
  type EvidenceStore,
} from "../server/events.js";
import { verifyFieldEvidencePack } from "../server/field-pack.js";
import type { ChargeGateway } from "../server/gateway.js";
import { CONTINUITY_PREPARATION_PHRASE } from "../shared/continuity.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import { OwnerTagRegistry, withOwnerTagRegistry } from "../server/owner-tags.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";

class MemoryEvidenceStore implements EvidenceStore {
  capacity: EvidenceCapacity = {
    maxBytes: 268_435_456,
    remainingBytes: 268_435_456,
    usedBytes: 0,
  };
  readonly events: EvidenceEvent[] = [];
  async allocateAuthorizationRevision(): Promise<number> {
    return 1;
  }
  async recordTransactionStart(): Promise<{ replayed: boolean; transactionId: number }> {
    return { replayed: false, transactionId: 1 };
  }
  async append(event: EvidenceEvent): Promise<void> {
    this.events.push(event);
  }
  async getCapacity(): Promise<EvidenceCapacity> {
    return this.capacity;
  }
  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

describe("owner API", () => {
  let api: OwnerApi | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await api?.close();
    if (directory) await rm(directory, { force: true, recursive: true });
  });

  it("serves health publicly and keeps owner state behind a bearer token", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-ui-"));
    await writeFile(join(directory, "index.html"), "<h1>chargeOS</h1>");
    const bootstrapConfig = testConfig(directory);
    const ownerTags = OwnerTagRegistry.memory(
      bootstrapConfig.ownerTags,
      bootstrapConfig.stationSecret,
    );
    const config = withOwnerTagRegistry(bootstrapConfig, ownerTags);
    const gateway: ChargeGateway = {
      async close() {},
      getRuntime: () => ({ connected: false, connectedAt: null }),
      async inspectLocalAuthorization() {
        throw new Error("not used");
      },
      listen() {
        throw new Error("not used");
      },
      async sendStationCommand() {
        throw new Error("not used");
      },
      async prepareOwnerContinuity() {
        return {
          assessment: {
            checkedAt: "2026-08-14T12:00:00.000Z",
            checks: [],
            localListVersion: 0,
            restartRequired: false,
            state: "ready",
          },
          changes: [],
          state: "ready",
        };
      },
      async syncOwnerList() {
        throw new Error("not used");
      },
    };
    const evidence = new MemoryEvidenceStore();
    api = createOwnerApi(config, gateway, evidence, ownerTags);
    const port = await api.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${port}`;

    await expect(fetch(`${base}/api/v1/health`).then((response) => response.status)).resolves.toBe(
      200,
    );
    evidence.capacity = {
      maxBytes: config.ocppMaxPayloadBytes,
      remainingBytes: config.ocppMaxPayloadBytes,
      usedBytes: 0,
    };
    await expect(fetch(`${base}/api/v1/health`).then((response) => response.status)).resolves.toBe(
      503,
    );
    evidence.capacity = {
      maxBytes: 268_435_456,
      remainingBytes: 268_435_456,
      usedBytes: 0,
    };
    await expect(
      fetch(`${base}/api/v1/snapshot`).then((response) => response.status),
    ).resolves.toBe(401);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await fetch(`${base}/api/v1/snapshot`, {
        headers: {
          authorization: "Bearer invalid",
          "x-forwarded-for": "203.0.113.10",
        },
      });
    }
    await expect(
      fetch(`${base}/api/v1/snapshot`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-forwarded-for": "203.0.113.10",
        },
      }).then((response) => response.status),
    ).resolves.toBe(429);
    await expect(
      fetch(`${base}/api/v1/snapshot`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-forwarded-for": "203.0.113.11",
        },
      }).then((response) => response.status),
    ).resolves.toBe(200);

    const snapshotResponse = await fetch(`${base}/api/v1/snapshot`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(snapshotResponse.status).toBe(200);
    const body = await snapshotResponse.text();
    expect(body).toContain("STATION_1");
    expect(body).toContain('"genesisPlan"');
    expect(body).not.toContain("raw-owner-tag");
    expect(snapshotResponse.headers.get("x-frame-options")).toBe("DENY");

    const genesisPlanResponse = await fetch(`${base}/api/v1/genesis-plan`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(genesisPlanResponse.status).toBe(200);
    const genesisPlan = await genesisPlanResponse.json();
    expect(genesisPlan).toMatchObject({
      phase: "pre-switch-evidence",
      schemaVersion: 1,
      state: "action-required",
    });
    expect(genesisPlan.nextActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "record-device-inventory" })]),
    );

    const preparationResponse = await fetch(
      `${base}/api/v1/stations/STATION_1/prepare-owner-continuity`,
      {
        body: JSON.stringify({ confirmation: CONTINUITY_PREPARATION_PHRASE }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(preparationResponse.status).toBe(200);
    expect(await preparationResponse.text()).toContain('"state":"ready"');

    const exportResponse = await fetch(`${base}/api/v1/continuity-export`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await exportResponse.text()).not.toContain("raw-owner-tag");

    const fieldPackResponse = await fetch(`${base}/api/v1/field-pack`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(fieldPackResponse.status).toBe(200);
    expect(fieldPackResponse.headers.get("content-disposition")).toContain("field-pack.json");
    const fieldPack = await fieldPackResponse.text();
    expect(fieldPack).toContain('"reviewState":"unreviewed"');
    expect(fieldPack).not.toContain("raw-owner-tag");
    expect(verifyFieldEvidencePack(fieldPack).stationId).toBe("STATION_1");

    const malformedTagResponse = await fetch(`${base}/api/v1/owner-tags`, {
      body: "null",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(malformedTagResponse.status).toBe(400);

    const ambiguousTagResponse = await fetch(`${base}/api/v1/owner-tags`, {
      body: JSON.stringify({ tag: "second-raw-owner-tag", unexpected: true }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(ambiguousTagResponse.status).toBe(400);

    const addTagResponse = await fetch(`${base}/api/v1/owner-tags`, {
      body: JSON.stringify({ tag: "second-raw-owner-tag" }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(addTagResponse.status).toBe(201);
    const addedTag = await addTagResponse.json();
    expect(addedTag).toMatchObject({ stateVersion: 2, tagCount: 2 });
    expect(JSON.stringify(addedTag)).not.toContain("second-raw-owner-tag");
    expect(JSON.stringify(evidence.events)).not.toContain("second-raw-owner-tag");

    const unconfirmedRevokeResponse = await fetch(
      `${base}/api/v1/owner-tags/${addedTag.tagPseudonym}/revoke`,
      {
        body: JSON.stringify({ confirmation: "remove it" }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(unconfirmedRevokeResponse.status).toBe(400);

    const revokeTagResponse = await fetch(
      `${base}/api/v1/owner-tags/${addedTag.tagPseudonym}/revoke`,
      {
        body: JSON.stringify({ confirmation: OWNER_TAG_REVOCATION_CONFIRMATION }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(revokeTagResponse.status).toBe(200);
    expect(await revokeTagResponse.json()).toMatchObject({ stateVersion: 3, tagCount: 1 });
    expect(JSON.stringify(evidence.events)).not.toContain("second-raw-owner-tag");

    const deviceResponse = await fetch(`${base}/api/v1/freedom-test/device`, {
      body: JSON.stringify({
        articleNumber: "904460023",
        configurationPath: "ACE > Connectivity > Backoffice",
        connectivity: "ethernet",
        countryCode: "BE",
        evidenceSha256: "d".repeat(64),
        hardwareRevision: "NG910",
        inventoryFirmwareVersion: "7.1.0",
        inventoryModel: "Eve Single S-line",
        inventoryVendor: "Alfen",
        priorOperator: "Synthetic prior operator",
      }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(deviceResponse.status).toBe(200);
    expect(await deviceResponse.text()).toContain("904460023");

    const prematureRun = await fetch(`${base}/api/v1/freedom-test/runs`, {
      body: JSON.stringify({
        confirmation:
          "I am starting a witnessed Freedom Test for this exact device and migration baseline",
      }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(prematureRun.status).toBe(400);

    const invalidObservation = await fetch(
      `${base}/api/v1/freedom-test/observations/authorization-synchronized`,
      {
        body: JSON.stringify({
          evidenceSha256: "a".repeat(64),
          observedAt: new Date().toISOString(),
          outcome: "pass",
        }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(invalidObservation.status).toBe(400);

    const observationResponse = await fetch(
      `${base}/api/v1/freedom-test/observations/unknown-tag-rejected-offline`,
      {
        body: JSON.stringify({
          evidenceSha256: "a".repeat(64),
          observedAt: new Date().toISOString(),
          outcome: "pass",
        }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(observationResponse.status).toBe(400);

    const reportResponse = await fetch(`${base}/api/v1/freedom-test/report`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.text();
    expect(report).toContain('"reviewState":"unreviewed"');
    expect(report).not.toContain("raw-owner-tag");

    const invalidCheckpoint = await fetch(
      `${base}/api/v1/migration/checkpoints/authorized-boot-observed`,
      {
        body: JSON.stringify({
          evidenceSha256: "c".repeat(64),
          observedAt: new Date().toISOString(),
          outcome: "confirmed",
        }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(invalidCheckpoint.status).toBe(400);

    const checkpointResponse = await fetch(
      `${base}/api/v1/migration/checkpoints/ownership-authority`,
      {
        body: JSON.stringify({
          evidenceSha256: "c".repeat(64),
          observedAt: new Date().toISOString(),
          outcome: "confirmed",
        }),
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(checkpointResponse.status).toBe(200);
    expect(await checkpointResponse.text()).toContain("collecting");

    const blockedAuthorization = await fetch(`${base}/api/v1/migration/authorize`, {
      body: JSON.stringify({
        confirmation: "I authorize the documented reversible endpoint change",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        targetManifest: "{}",
        transport: "isolated-lan-ws",
      }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(blockedAuthorization.status).toBe(409);

    const migrationReportResponse = await fetch(`${base}/api/v1/migration/report`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(migrationReportResponse.status).toBe(200);
    expect(await migrationReportResponse.text()).not.toContain("raw-owner-tag");

    const grantResponse = await fetch(`${base}/api/v1/delegations`, {
      body: JSON.stringify({
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        role: "employer",
      }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(grantResponse.status).toBe(201);
    const created = (await grantResponse.json()) as {
      grant: { grantId: string };
      token: string;
    };
    expect(JSON.stringify(evidence.events)).not.toContain(created.token);

    const installerGrantResponse = await fetch(`${base}/api/v1/delegations`, {
      body: JSON.stringify({
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        role: "installer",
      }),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    const installer = (await installerGrantResponse.json()) as { token: string };
    const delegatedMigration = await fetch(`${base}/api/v1/delegate/migration`, {
      headers: { authorization: `Bearer ${installer.token}` },
    });
    expect(delegatedMigration.status).toBe(200);
    expect(await delegatedMigration.text()).not.toContain("raw-owner-tag");

    const sessionsResponse = await fetch(`${base}/api/v1/delegate/sessions`, {
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(sessionsResponse.status).toBe(200);
    expect(await sessionsResponse.text()).not.toContain("raw-owner-tag");
    expect(evidence.events.at(-1)?.message).toBe("DelegateCapabilityUsed");

    await expect(
      fetch(`${base}/api/v1/delegate/diagnostics`, {
        headers: { authorization: `Bearer ${created.token}` },
      }).then((response) => response.status),
    ).resolves.toBe(403);
    await expect(
      fetch(`${base}/api/v1/stations/STATION_1/sync-authorizations`, {
        headers: { authorization: `Bearer ${created.token}` },
        method: "POST",
      }).then((response) => response.status),
    ).resolves.toBe(404);
    await expect(
      fetch(`${base}/api/v1/owner-tags`, {
        body: JSON.stringify({ tag: "delegated-owner-tag" }),
        headers: {
          authorization: `Bearer ${created.token}`,
          "content-type": "application/json",
        },
        method: "POST",
      }).then((response) => response.status),
    ).resolves.toBe(404);

    const revokeResponse = await fetch(
      `${base}/api/v1/delegations/${created.grant.grantId}/revoke`,
      {
        headers: { authorization: `Bearer ${TOKEN}` },
        method: "POST",
      },
    );
    expect(revokeResponse.status).toBe(200);
    await expect(
      fetch(`${base}/api/v1/delegate/sessions`, {
        headers: { authorization: `Bearer ${created.token}` },
      }).then((response) => response.status),
    ).resolves.toBe(401);
  });

  it("serves a fleet overview and scopes charger management to the selected station", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-fleet-ui-"));
    await writeFile(join(directory, "index.html"), "<h1>chargeOS</h1>");
    const primary = testConfig(directory);
    const config: GatewayConfig = {
      ...primary,
      stations: [
        {
          id: primary.stationId,
          label: "Home charger",
          ownerTags: new Set(["raw-owner-tag"]),
          secret: primary.stationSecret,
          site: "Home",
        },
        {
          id: "OFFICE_1",
          label: "Office bay 1",
          ownerTags: new Set(["office-owner-tag"]),
          secret: "office-station-secret-strong",
          site: "Brussels office",
        },
      ],
    };
    const registries = new Map([
      [
        primary.stationId,
        OwnerTagRegistry.memory(new Set(["raw-owner-tag"]), primary.stationSecret),
      ],
      [
        "OFFICE_1",
        OwnerTagRegistry.memory(new Set(["office-owner-tag"]), "office-station-secret-strong"),
      ],
    ]);
    const gateway: ChargeGateway = {
      async close() {},
      getRuntime: (stationId) => ({
        connected: stationId === "OFFICE_1",
        connectedAt: stationId === "OFFICE_1" ? "2026-08-15T08:00:00.000Z" : null,
      }),
      async inspectLocalAuthorization() {
        throw new Error("not used");
      },
      listen() {
        throw new Error("not used");
      },
      async sendStationCommand() {
        throw new Error("not used");
      },
      async prepareOwnerContinuity() {
        throw new Error("not used");
      },
      async syncOwnerList() {
        throw new Error("not used");
      },
    };
    const evidence = new MemoryEvidenceStore();
    await evidence.append(
      evidenceEvent("OFFICE_1", "station-to-csms", "BootNotification", {
        chargePointModel: "Office simulator",
        chargePointVendor: "chargeOS",
        firmwareVersion: "1.0.0",
      }),
    );
    api = createOwnerApi(config, gateway, evidence, registries);
    const port = await api.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: `Bearer ${TOKEN}` };

    const fleetResponse = await fetch(`${base}/api/v1/fleet`, { headers });
    expect(fleetResponse.status).toBe(200);
    const fleet = await fleetResponse.json();
    expect(fleet).toMatchObject({
      stations: [
        { connected: false, id: "STATION_1", label: "Home charger", site: "Home" },
        {
          connected: true,
          id: "OFFICE_1",
          label: "Office bay 1",
          site: "Brussels office",
        },
      ],
      totals: { connected: 1, stations: 2 },
    });

    const officeSnapshot = await fetch(`${base}/api/v1/stations/OFFICE_1/snapshot`, { headers });
    expect(officeSnapshot.status).toBe(200);
    expect(await officeSnapshot.json()).toMatchObject({
      authorization: { tagCount: 1 },
      station: { id: "OFFICE_1", label: "Office bay 1", site: "Brussels office" },
    });

    const addResponse = await fetch(`${base}/api/v1/stations/OFFICE_1/owner-tags`, {
      body: JSON.stringify({ tag: "second-office-tag" }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    });
    expect(addResponse.status).toBe(201);
    expect(registries.get("OFFICE_1")?.tags).toContain("second-office-tag");
    expect(registries.get(primary.stationId)?.tags).not.toContain("second-office-tag");
    expect(JSON.stringify(evidence.events)).not.toContain("second-office-tag");

    await expect(
      fetch(`${base}/api/v1/stations/UNKNOWN/snapshot`, { headers }).then(
        (response) => response.status,
      ),
    ).resolves.toBe(404);
  });
});

function testConfig(uiDirectory: string): GatewayConfig {
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
    ownerTags: new Set(["raw-owner-tag"]),
    port: 0,
    stationId: "STATION_1",
    stationSecret: "station-secret-at-least-sixteen",
    trustProxyHeaders: true,
    uiDirectory,
  };
}
