import type { AddressInfo } from "node:net";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";
import {
  createChargeGateway,
  OwnerContinuityBlockedError,
  OwnerContinuityPreparationBlockedError,
  type ChargeGateway,
} from "../server/gateway.js";
import { OwnerTagRegistry, withOwnerTagRegistry } from "../server/owner-tags.js";
import { buildOwnerSnapshot } from "../server/projections.js";
import { pseudonymizeTag } from "../server/tag.js";
import { CARD_CAPTURE_HOLD_MS, CARD_CAPTURE_LISTEN_MS } from "../shared/card-capture.js";

const SECRET = "0123456789abcdef0123456789abcdef01234567";
const OWNER_TAG = "04A1B2C3D4E5F6";
const NEW_TAG = "04FFEEDDCCBBAA";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  #nextTransactionId = 1;
  async allocateAuthorizationRevision(_stationId: string, minimum: number): Promise<number> {
    return minimum;
  }
  async recordTransactionStart(
    _stationId: string,
    _fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ replayed: boolean; transactionId: number }> {
    const transactionId = this.#nextTransactionId++;
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

function baseConfig(ownerTags: ReadonlySet<string>): GatewayConfig {
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
    ownerApiToken: "owner-token-at-least-thirty-two-characters",
    ownerTags,
    port: 0,
    stationId: "HOME-1",
    stationSecret: SECRET,
    trustProxyHeaders: false,
    uiDirectory: "dist/ui",
  };
}

const pseudonym = (tag: string) => `tag_${pseudonymizeTag(tag, SECRET)}`;

describe("tap a card to add it", () => {
  let gateway: ChargeGateway | undefined;
  let client: RPCClient | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await client?.close({ force: true });
    client = undefined;
    await gateway?.close();
  });

  async function start(tags: ReadonlySet<string> = new Set([OWNER_TAG])) {
    const bootstrap = baseConfig(tags);
    const registry = OwnerTagRegistry.memory(bootstrap.ownerTags, SECRET);
    const config = withOwnerTagRegistry(bootstrap, registry);
    const evidence = new MemoryEvidenceStore();
    gateway = createChargeGateway(config, evidence);
    const httpServer = await gateway.listen(0, "127.0.0.1");
    client = new RPCClient({
      endpoint: `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}`,
      identity: "HOME-1",
      password: SECRET,
      protocols: ["ocpp1.6"],
      strictMode: true,
    } as ConstructorParameters<typeof RPCClient>[0]);
    return { config, evidence, registry };
  }

  const tap = (idTag: string) =>
    client!.call("Authorize", { idTag }) as Promise<{ idTagInfo: { status: string } }>;

  it("listens only while connected and offers the tapped card by pseudonym", async () => {
    const { config, evidence, registry } = await start();
    expect(() => gateway!.armCardCapture("HOME-1")).toThrow(/not connected/);
    await client!.connect();

    // Not listening: a tap is refused and nothing is held.
    await expect(tap(NEW_TAG)).resolves.toMatchObject({ idTagInfo: { status: "Invalid" } });
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG))).toBeNull();

    expect(gateway!.armCardCapture("HOME-1")).toMatchObject({ state: "listening" });
    // The listening tap is still refused at the charger: unknown cards are always rejected.
    await expect(tap(NEW_TAG)).resolves.toMatchObject({ idTagInfo: { status: "Invalid" } });
    await tap(NEW_TAG);
    const snapshot = buildOwnerSnapshot(config, gateway!, evidence.events);
    expect(snapshot.cardCapture).toMatchObject({
      state: "captured",
      tagPseudonym: pseudonym(NEW_TAG),
    });
    // The raw value is never projected, logged into evidence, or part of the snapshot.
    expect(JSON.stringify(snapshot)).not.toContain(NEW_TAG);
    expect(JSON.stringify(evidence.events)).not.toContain(NEW_TAG);

    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(OWNER_TAG))).toBeNull();
    const raw = gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG));
    expect(raw).toBe(NEW_TAG);
    // Handed over exactly once.
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG))).toBeNull();
    await registry.add(config, evidence, raw);
    await expect(tap(NEW_TAG)).resolves.toMatchObject({ idTagInfo: { status: "Accepted" } });
  });

  it("captures from StartTransaction when a charger skips Authorize", async () => {
    await start();
    await client!.connect();
    gateway!.armCardCapture("HOME-1");
    await client!.call("StartTransaction", {
      connectorId: 1,
      idTag: NEW_TAG,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    expect(gateway!.getRuntime("HOME-1").cardCapture).toMatchObject({ state: "captured" });
  });

  it("offers nothing when two different cards are tapped", async () => {
    await start();
    await client!.connect();
    gateway!.armCardCapture("HOME-1");
    await tap(NEW_TAG);
    await tap("04SOMEONEELSE");
    expect(gateway!.getRuntime("HOME-1").cardCapture).toMatchObject({
      state: "several",
      tagPseudonym: null,
    });
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG))).toBeNull();
    // Further taps cannot turn it back into an offer.
    await tap(NEW_TAG);
    expect(gateway!.getRuntime("HOME-1").cardCapture?.state).toBe("several");
  });

  it("cancels the offer when a different card follows after the listening window", async () => {
    await start();
    await client!.connect();
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    gateway!.armCardCapture("HOME-1");
    vi.setSystemTime(Date.now() + CARD_CAPTURE_LISTEN_MS - 1_000);
    await tap("04PASSERBY");
    vi.setSystemTime(Date.now() + 5_000);
    // The listening window is over, but the passer-by's card is still held: the owner's own tap
    // must still cancel it rather than be ignored.
    await tap(NEW_TAG);
    expect(gateway!.getRuntime("HOME-1").cardCapture).toMatchObject({ state: "several" });
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym("04PASSERBY"))).toBeNull();
  });

  it("never treats a queued, old or replayed start as a fresh tap", async () => {
    const { evidence } = await start();
    await client!.connect();
    gateway!.armCardCapture("HOME-1");
    await client!.call("StartTransaction", {
      connectorId: 1,
      idTag: NEW_TAG,
      meterStart: 0,
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    expect(gateway!.getRuntime("HOME-1").cardCapture?.state).toBe("listening");
    vi.spyOn(evidence, "recordTransactionStart").mockImplementationOnce(async () => ({
      replayed: true,
      transactionId: 1,
    }));
    await client!.call("StartTransaction", {
      connectorId: 1,
      idTag: NEW_TAG,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    expect(gateway!.getRuntime("HOME-1").cardCapture?.state).toBe("listening");
  });

  it("says when the tapped card is already known and holds no value for it", async () => {
    await start();
    await client!.connect();
    gateway!.armCardCapture("HOME-1");
    await tap(OWNER_TAG);
    expect(gateway!.getRuntime("HOME-1").cardCapture).toMatchObject({
      state: "known",
      tagPseudonym: pseudonym(OWNER_TAG),
    });
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(OWNER_TAG))).toBeNull();
  });

  it("stops listening and forgets the tapped card after a short time", async () => {
    await start();
    await client!.connect();
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    gateway!.armCardCapture("HOME-1");
    vi.setSystemTime(Date.now() + CARD_CAPTURE_LISTEN_MS + 1);
    await tap(NEW_TAG);
    expect(gateway!.getRuntime("HOME-1").cardCapture?.state).toBe("expired");

    gateway!.armCardCapture("HOME-1");
    await tap(NEW_TAG);
    vi.setSystemTime(Date.now() + CARD_CAPTURE_HOLD_MS + 1);
    expect(gateway!.getRuntime("HOME-1").cardCapture?.state).toBe("expired");
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG))).toBeNull();

    gateway!.armCardCapture("HOME-1");
    await tap(NEW_TAG);
    expect(gateway!.cancelCardCapture("HOME-1").state).toBe("idle");
    expect(gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG))).toBeNull();
  });

  it("starts with no card, refuses every card and never sends an empty list", async () => {
    const { config, evidence, registry } = await start(new Set());
    expect(registry.tags.size).toBe(0);
    client!.handle("GetConfiguration", async ({ params }) => ({
      configurationKey: (params as { key: string[] }).key.map((key) => ({
        key,
        readonly: false,
        value:
          key === "AllowOfflineTxForUnknownId"
            ? "true"
            : key.endsWith("MaxLength")
              ? "100"
              : "true",
      })),
    }));
    client!.handle("GetLocalListVersion", async () => ({ listVersion: 0 }));
    const sendLocalList = vi.fn(async () => ({ status: "Accepted" }));
    client!.handle("SendLocalList", sendLocalList);
    await client!.connect();

    await expect(tap(NEW_TAG)).resolves.toMatchObject({ idTagInfo: { status: "Invalid" } });
    const assessment = await gateway!.inspectLocalAuthorization("HOME-1");
    expect(assessment.state).toBe("blocked");
    expect(assessment.checks.find(({ id }) => id === "owner-card")?.state).toBe("fail");
    await expect(gateway!.syncOwnerList("HOME-1")).rejects.toBeInstanceOf(
      OwnerContinuityBlockedError,
    );
    expect(sendLocalList).not.toHaveBeenCalled();

    // Preparing offline charging would switch off unknown-card offline charging while no owner
    // card exists; it must change nothing.
    const changeConfiguration = vi.fn(async () => ({ status: "Accepted" }));
    client!.handle("ChangeConfiguration", changeConfiguration);
    await expect(
      gateway!.prepareOwnerContinuity("HOME-1", {
        confirmation: (await import("../shared/continuity.js")).CONTINUITY_PREPARATION_PHRASE,
      }),
    ).rejects.toBeInstanceOf(OwnerContinuityPreparationBlockedError);
    expect(changeConfiguration).not.toHaveBeenCalled();
    expect(evidence.events.at(-1)).toMatchObject({
      message: "ContinuityPreparationBlocked",
      payload: { reason: "no-owner-card" },
    });

    // The first card arrives by tapping it.
    gateway!.armCardCapture("HOME-1");
    await tap(NEW_TAG);
    await registry.add(config, evidence, gateway!.takeCapturedCard("HOME-1", pseudonym(NEW_TAG)));
    await expect(tap(NEW_TAG)).resolves.toMatchObject({ idTagInfo: { status: "Accepted" } });
    // The last card can still never be removed.
    await expect(
      registry.revoke(config, evidence, pseudonym(NEW_TAG), {
        confirmation: (await import("../shared/owner-tags.js")).OWNER_TAG_REVOCATION_CONFIRMATION,
      }),
    ).rejects.toThrow(/At least one desired owner tag must remain/);
  });
});
