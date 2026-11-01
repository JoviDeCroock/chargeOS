import type { AddressInfo } from "node:net";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { createChargeGateway, type ChargeGateway } from "../server/gateway.js";
import { buildOwnerSnapshot } from "../server/projections.js";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.js";

// Synthetic interoperability profiles. Each profile reproduces a protocol behavior that differs
// between OCPP 1.6J implementations. They are named after the behavior, never after a brand: a
// passing profile is simulator evidence only and is not a compatibility claim for any device.

const OWNER_TAG = "04a1b2c3d4e5f6";
const STATION_SECRET = "station-secret-at-least-sixteen";

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
  stationId: "QUIRK_TEST",
  stationSecret: STATION_SECRET,
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};

describe("charger interoperability profiles", () => {
  let gateway: ChargeGateway | undefined;
  let client: RPCClient | undefined;

  afterEach(async () => {
    await client?.close({ force: true });
    await gateway?.close();
  });

  async function connect(
    evidence: MemoryEvidenceStore,
    overrides: Partial<GatewayConfig> = {},
  ): Promise<RPCClient> {
    gateway = createChargeGateway({ ...config, ...overrides }, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    const port = (httpServer.address() as AddressInfo).port;
    client = new RPCClient({
      callTimeoutMs: 2_000,
      endpoint: `ws://127.0.0.1:${port}`,
      identity: config.stationId,
      password: STATION_SECRET,
      protocols: ["ocpp1.6"],
      reconnect: false,
      // Lenient on the simulated charger so it can send what real firmware sends.
      strictMode: false,
    } as ConstructorParameters<typeof RPCClient>[0]);
    await client.connect();
    return client;
  }

  it("profile upper-case-uid: authorizes an owner card reported in different letter case", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);
    const reported = OWNER_TAG.toUpperCase();

    await expect(charger.call("Authorize", { idTag: reported })).resolves.toEqual({
      idTagInfo: { status: "Accepted" },
    });
    await expect(
      charger.call("StartTransaction", {
        connectorId: 1,
        idTag: reported,
        meterStart: 0,
        timestamp: "2026-11-01T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({ idTagInfo: { status: "Accepted" } });
    await expect(charger.call("Authorize", { idTag: "04A1B2C3D4E5F7" })).resolves.toEqual({
      idTagInfo: { status: "Invalid" },
    });

    const serialized = JSON.stringify(evidence.events);
    expect(serialized).not.toContain(reported);
    expect(serialized).not.toContain(OWNER_TAG);
    const snapshot = buildOwnerSnapshot(config, gateway!, evidence.events);
    expect(snapshot.sessions[0]).toMatchObject({ authorizationStatus: "Accepted" });
  });

  it("profile vendor-data-transfer: answers DataTransfer without storing vendor data", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);

    await expect(
      charger.call("DataTransfer", {
        data: JSON.stringify({ idTag: OWNER_TAG, private: "vendor-diagnostic-blob" }),
        messageId: OWNER_TAG,
        vendorId: "com.example.vendor",
      }),
    ).resolves.toEqual({ status: "UnknownVendorId" });

    const recorded = evidence.events.find((event) => event.message === "DataTransfer");
    expect(recorded?.payload).toEqual({
      dataDiscarded: true,
      messageIdHmac: expect.stringMatching(/^[a-f0-9]{24}$/),
      vendorIdHmac: expect.stringMatching(/^[a-f0-9]{24}$/),
    });
    expect(JSON.stringify(evidence.events)).not.toContain("com.example.vendor");
    const serialized = JSON.stringify(evidence.events);
    expect(serialized).not.toContain("vendor-diagnostic-blob");
    expect(serialized).not.toContain(OWNER_TAG);
  });

  it("profile unsolicited-status: accepts firmware, diagnostics and security notifications", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);

    await expect(charger.call("FirmwareStatusNotification", { status: "Idle" })).resolves.toEqual(
      {},
    );
    await expect(
      charger.call("DiagnosticsStatusNotification", { status: "Idle" }),
    ).resolves.toEqual({});
    await expect(
      charger.call("SecurityEventNotification", {
        techInfo: "peer 192.0.2.10 user admin",
        timestamp: "2026-11-01T08:00:00.000Z",
        type: "StartupOfTheDevice",
      }),
    ).resolves.toEqual({});
    await expect(
      charger.call("SignedFirmwareStatusNotification", { requestId: 7, status: "Idle" }),
    ).resolves.toEqual({});
    await expect(
      charger.call("LogStatusNotification", { requestId: 3, status: "Idle" }),
    ).resolves.toEqual({});

    const byMessage = new Map(evidence.events.map((event) => [event.message, event.payload]));
    expect(byMessage.get("FirmwareStatusNotification")).toEqual({ status: "Idle" });
    expect(byMessage.get("DiagnosticsStatusNotification")).toEqual({ status: "Idle" });
    expect(byMessage.get("SecurityEventNotification")).toEqual({
      techInfoDiscarded: true,
      timestamp: "2026-11-01T08:00:00.000Z",
      type: "StartupOfTheDevice",
    });
    expect(byMessage.get("SignedFirmwareStatusNotification")).toEqual({
      requestId: 7,
      status: "Idle",
    });
    expect(byMessage.get("LogStatusNotification")).toEqual({ requestId: 3, status: "Idle" });
    expect(JSON.stringify(evidence.events)).not.toContain("192.0.2.10");

    await charger.call("SecurityEventNotification", {
      timestamp: "2026-11-01T08:00:01.000Z",
      type: `InvalidIdTag ${OWNER_TAG}`,
    });
    expect(evidence.events.at(-1)?.payload).toMatchObject({ type: "VendorDefined" });
    expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);
  });

  it("profile zoneless-timestamps: keeps a timestamp without offset verbatim instead of guessing", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);

    await expect(
      charger.call("StartTransaction", {
        connectorId: 1,
        idTag: OWNER_TAG,
        meterStart: 0,
        timestamp: "2026-11-01T09:00:00",
      }),
    ).resolves.toMatchObject({ idTagInfo: { status: "Accepted" } });
    const snapshot = buildOwnerSnapshot(config, gateway!, evidence.events);
    expect(snapshot.sessions[0]?.startedAt).toBe("2026-11-01T09:00:00");
  });

  it("profile non-iso-timestamps: rejects a non-conforming start visibly without storing the tag", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);

    await expect(
      charger.call("StartTransaction", {
        connectorId: 1,
        idTag: OWNER_TAG,
        meterStart: 0,
        timestamp: "01/11/2026 09:00",
      }),
    ).rejects.toThrow();

    await vi.waitFor(() =>
      expect(evidence.events.map((event) => event.message)).toContain("ProtocolMessageRejected"),
    );
    const rejection = evidence.events.find((event) => event.message === "ProtocolMessageRejected");
    expect(rejection).toMatchObject({
      direction: "system",
      payload: {
        errorCode: "FormatViolation",
        keyword: "format",
        method: "StartTransaction",
        origin: "station",
        path: "/timestamp",
        phase: "request",
      },
    });
    expect(evidence.events.map((event) => event.message)).not.toContain("StartTransaction");
    expect(JSON.stringify(evidence.events)).not.toContain(OWNER_TAG);
  });

  it("profile unknown-action: records only standard OCPP action names", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);

    await expect(charger.call("VendorBootstrap", { secret: "do-not-store" })).rejects.toThrow();
    await expect(charger.call(`A${OWNER_TAG}`, {})).rejects.toThrow();
    await expect(charger.call("GetDiagnostics", { location: 42 })).rejects.toThrow();

    await vi.waitFor(() =>
      expect(
        evidence.events.filter((event) => event.message === "ProtocolMessageRejected"),
      ).toHaveLength(3),
    );
    const methods = evidence.events
      .filter((event) => event.message === "ProtocolMessageRejected")
      .map((event) => (event.payload as { method: string }).method);
    expect(methods).toEqual(["Unrecognized", "Unrecognized", "GetDiagnostics"]);
    const serialized = JSON.stringify(evidence.events);
    expect(serialized).not.toContain("do-not-store");
    expect(serialized).not.toContain("VendorBootstrap");
    expect(serialized).not.toContain(OWNER_TAG);
  });

  it("profile invalid-flood: schema-invalid calls consume the rate limit and records stay bounded", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence, { ocppMessageBurst: 30, ocppMessagesPerMinute: 1 });

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, index) =>
        charger.call("StatusNotification", {
          connectorId: index,
          errorCode: "VendorSpecificFault",
          status: "Available",
        }),
      ),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);

    await vi.waitFor(() =>
      expect(evidence.events.map((event) => event.message)).toContain("ProtocolRateLimitExceeded"),
    );
    expect(
      evidence.events.filter((event) => event.message === "ProtocolMessageRejected").length,
    ).toBeLessThanOrEqual(16);
  });

  it("profile unsupported-local-list-keys: blocks continuity when keys are reported unknown", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);
    charger.handle("GetConfiguration", async ({ params }) => {
      const requested = (params as { key: string[] }).key;
      const known: Record<string, string> = {
        AllowOfflineTxForUnknownId: "FALSE",
        LocalAuthListEnabled: "TRUE",
        LocalAuthorizeOffline: "TRUE",
        SendLocalListMaxLength: "20",
      };
      return {
        configurationKey: requested
          .filter((key) => key in known)
          .map((key) => ({ key, readonly: false, value: known[key] })),
        unknownKey: requested.filter((key) => !(key in known)),
      };
    });
    charger.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));

    const assessment = await gateway!.inspectLocalAuthorization(config.stationId);
    expect(assessment.state).toBe("blocked");
    expect(assessment.checks).toContainEqual(
      expect.objectContaining({
        id: "local-list-storage",
        observed: "not supported by this charger",
        state: "fail",
      }),
    );
    await expect(gateway!.syncOwnerList(config.stationId)).rejects.toThrow(/blocked/i);
  });

  it("survives connect and disconnect audits failing when evidence capacity is exhausted", async () => {
    const evidence = new MemoryEvidenceStore();
    evidence.append = async () => {
      throw new Error("synthetic evidence capacity exhausted");
    };
    const charger = await connect(evidence);
    await charger.close({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gateway!.getRuntime(config.stationId).connected).toBe(false);
  });

  it("profile malformed-configuration-response: records a rejected charger reply", async () => {
    const evidence = new MemoryEvidenceStore();
    const charger = await connect(evidence);
    charger.handle("GetConfiguration", async () => ({
      configurationKey: [{ key: "LocalAuthListEnabled", readonly: "no", value: true }],
    }));

    await expect(gateway!.inspectLocalAuthorization(config.stationId)).rejects.toThrow();
    await vi.waitFor(() =>
      expect(evidence.events.map((event) => event.message)).toContain("ProtocolMessageRejected"),
    );
    const rejection = evidence.events.find((event) => event.message === "ProtocolMessageRejected");
    expect(rejection?.payload).toMatchObject({
      method: "GetConfiguration",
      origin: "station",
      phase: "response",
    });
  });
});
