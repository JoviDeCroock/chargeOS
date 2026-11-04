import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOwnerApi, type OwnerApi } from "../server/api.js";
import { CardPolicyStore } from "../server/card-policy.js";
import type { GatewayConfig } from "../server/config.js";
import { OwnerDirectoryStore } from "../server/directory.js";
import { createChargeGateway, type ChargeGateway } from "../server/gateway.js";
import { OwnerTagRegistry, withOwnerTagRegistries } from "../server/owner-tags.js";
import { StationRegistry } from "../server/station-registry.js";
import { pseudonymizeTag } from "../server/tag.js";
import type { DriverView, ReimbursementFeed } from "../shared/driver.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import type { AddStationResult } from "../shared/stations.js";
import { retirementPhrase } from "../shared/stations.js";
import { monthOf } from "../shared/usage.js";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";
const OFFICE_SECRET = "0123456789abcdef0123456789abcdef01234567";
const HOME_SECRET = "fedcba9876543210fedcba9876543210fedcba98";
/** A company card used at the office and at Sam's home. */
const COMPANY_CARD = "04C0FFEE0001";
/** A pool card that only works at the office and is never classified. */
const POOL_CARD = "04B0B0B0B0B0";
/** Sam's own card, added from the employee page. */
const PERSONAL_CARD = "04CAFE1234";
const TIME_ZONE = "Europe/Brussels";

const pseudonym = (tag: string, secret: string) => `tag_${pseudonymizeTag(tag, secret)}`;
const HOME = (tag: string) => pseudonym(tag, HOME_SECRET);
const OFFICE = (tag: string) => pseudonym(tag, OFFICE_SECRET);

interface Harness {
  readonly base: string;
  readonly cardPolicy: CardPolicyStore;
  readonly config: GatewayConfig;
  readonly driverCaptures: Set<string>;
  readonly evidence: MemoryEvidenceStore;
  readonly gateway: ChargeGateway;
  readonly ocppPort: number;
  readonly registries: Map<string, OwnerTagRegistry>;
}

describe("company gateway", () => {
  let api: OwnerApi | undefined;
  let gateway: ChargeGateway | undefined;
  let directory: string | undefined;
  const clients: RPCClient[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    for (const client of clients.splice(0)) await client.close({ force: true });
    await api?.close();
    await gateway?.close();
    api = undefined;
    gateway = undefined;
    if (directory) await rm(directory, { force: true, recursive: true });
    directory = undefined;
  });

  async function start(options: { readOnlyCardPolicy?: boolean } = {}): Promise<Harness> {
    directory = await mkdtemp(join(tmpdir(), "chargeos-fleet-gateway-"));
    const officeTags = new Set([COMPANY_CARD, POOL_CARD]);
    const homeTags = new Set([COMPANY_CARD]);
    const bootstrap: GatewayConfig = {
      apiHost: "127.0.0.1",
      apiPort: 0,
      eventLogPath: join(directory, "events.ndjson"),
      eventLogMaxBytes: 268_435_456,
      heartbeatSeconds: 60,
      ocppHost: "127.0.0.1",
      ocppMaxConnections: 8,
      ocppMaxPayloadBytes: 1_048_576,
      ocppMessageBurst: 60,
      ocppMessagesPerMinute: 600,
      ownerApiToken: TOKEN,
      ownerTags: officeTags,
      port: 0,
      profile: "company",
      stationId: "OFFICE-1",
      stationSecret: OFFICE_SECRET,
      stations: [
        {
          id: "OFFICE-1",
          label: "Office bay 1",
          ownerTags: officeTags,
          secret: OFFICE_SECRET,
          site: "Ghent",
        },
        { id: "HOME-1", label: "Driveway", ownerTags: homeTags, secret: HOME_SECRET, site: "Home" },
      ],
      trustProxyHeaders: false,
      uiDirectory: "dist/ui",
    };
    const evidence = new MemoryEvidenceStore();
    const stations = await StationRegistry.open(bootstrap, evidence);
    const registries = new Map([
      ["OFFICE-1", OwnerTagRegistry.memory(officeTags, OFFICE_SECRET)],
      ["HOME-1", OwnerTagRegistry.memory(homeTags, HOME_SECRET)],
    ]);
    for (const [stationId, registry] of registries) stations.setOwnerTags(stationId, registry.tags);
    const config = withOwnerTagRegistries(stations.bind(bootstrap), registries, stations.stations);
    gateway = createChargeGateway(config, evidence);
    const ocpp = await gateway.listen(0, "127.0.0.1");
    // A directory where the file should be cannot be read, so the store opens read-only.
    const cardPolicy = options.readOnlyCardPolicy
      ? await CardPolicyStore.open(bootstrap, directory)
      : CardPolicyStore.memory();
    const driverCaptures = new Set<string>();
    api = createOwnerApi(
      config,
      gateway,
      evidence,
      registries,
      fetch,
      OwnerDirectoryStore.memory(config),
      { cardPolicy, driverCaptures, registries, stations },
    );
    const port = await api.listen(0, "127.0.0.1");
    return {
      base: `http://127.0.0.1:${port}`,
      cardPolicy,
      config,
      driverCaptures,
      evidence,
      gateway,
      ocppPort: (ocpp.address() as AddressInfo).port,
      registries,
    };
  }

  async function connect(harness: Harness, identity: string, password: string) {
    const client = new RPCClient({
      endpoint: `ws://127.0.0.1:${harness.ocppPort}`,
      identity,
      password,
      protocols: ["ocpp1.6"],
      reconnect: false,
      strictMode: true,
    } as ConstructorParameters<typeof RPCClient>[0]);
    clients.push(client);
    await client.connect();
    return client;
  }

  const tap = (client: RPCClient, idTag: string) =>
    client.call("Authorize", { idTag }) as Promise<{ idTagInfo: { status: string } }>;

  async function charge(client: RPCClient, idTag: string, energyWh: number) {
    const started = (await client.call("StartTransaction", {
      connectorId: 1,
      idTag,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    })) as { idTagInfo: { status: string }; transactionId: number };
    await client.call("StopTransaction", {
      meterStop: energyWh,
      timestamp: new Date().toISOString(),
      transactionId: started.transactionId,
    });
    return started;
  }

  function call(
    harness: Harness,
    path: string,
    options: { body?: unknown; method?: string; token?: string } = {},
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.token ?? TOKEN}`,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    return fetch(`${harness.base}${path}`, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers,
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    });
  }

  async function grant(harness: Harness, stationPath: string, role: string) {
    const response = await call(harness, `${stationPath}/delegations`, {
      body: { expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), role },
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { grant: { grantId: string }; token: string };
  }

  /* ---------------------------------------------------------------- */
  /* Owner routes                                                      */
  /* ---------------------------------------------------------------- */

  it("reviews eligible chargers, rejects changed lists and reports an accepted full revision", async () => {
    const harness = await start();
    const client = await connect(harness, "HOME-1", HOME_SECRET);
    const settings: Record<string, string> = {
      AllowOfflineTxForUnknownId: "false",
      LocalAuthListEnabled: "true",
      LocalAuthorizeOffline: "true",
      LocalAuthListMaxLength: "100",
      SendLocalListMaxLength: "100",
    };
    let version = 0;
    client.handle("GetConfiguration", async ({ params }) => ({
      configurationKey: ((params?.key ?? []) as string[]).map((key) => ({
        key,
        readonly: false,
        value: settings[key] ?? "true",
      })),
    }));
    client.handle("GetLocalListVersion", async () => ({ listVersion: version }));
    const send = vi.fn(async ({ params }) => {
      version = params.listVersion;
      return { status: "Accepted" };
    });
    client.handle("SendLocalList", send);
    await harness.gateway.inspectLocalAuthorization("HOME-1");

    const path = "/api/v1/sync-ready";
    const review = await (await call(harness, path)).json();
    expect(review.stations).toEqual([
      { additions: 2, removals: 0, state: "offline", stationId: "OFFICE-1" },
      { additions: 1, removals: 0, state: "eligible", stationId: "HOME-1" },
    ]);
    expect(JSON.stringify(review)).not.toContain(COMPANY_CARD);
    expect(send).not.toHaveBeenCalled();
    expect((await call(harness, path, { body: {} })).status).toBe(400);

    const added = await call(harness, "/api/v1/stations/HOME-1/owner-tags", {
      body: { tag: PERSONAL_CARD },
    });
    expect(added.status).toBe(201);
    expect((await call(harness, path, { body: { reviewId: review.reviewId } })).status).toBe(409);
    expect(send).not.toHaveBeenCalled();

    const beforeChange = await (await call(harness, path)).json();
    version = 4; // A charger-side change after review must never send a replacement list.
    expect(
      await (await call(harness, path, { body: { reviewId: beforeChange.reviewId } })).json(),
    ).toMatchObject({
      stations: [{ outcome: "offline" }, { outcome: "changed" }],
    });
    expect(send).not.toHaveBeenCalled();

    const next = await (await call(harness, path)).json();
    const body = { reviewId: next.reviewId };
    expect(await (await call(harness, path, { body })).json()).toMatchObject({
      stations: [
        { listVersion: null, outcome: "offline", stationId: "OFFICE-1" },
        { listVersion: 5, outcome: "synced", stationId: "HOME-1" },
      ],
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: expect.objectContaining({
          updateType: "Full",
          localAuthorizationList: expect.arrayContaining([
            expect.objectContaining({ idTag: COMPANY_CARD }),
            expect.objectContaining({ idTag: PERSONAL_CARD }),
          ]),
        }),
      }),
    );
    expect((await call(harness, path, { body })).status).toBe(409);
    expect(JSON.stringify(harness.evidence.events)).not.toContain(PERSONAL_CARD);
  });

  it("keeps live connector reports separate from recorded sessions across disconnects", async () => {
    const harness = await start();
    const client = await connect(harness, "HOME-1", HOME_SECRET);
    await client.call("StartTransaction", {
      connectorId: 1,
      idTag: COMPANY_CARD,
      meterStart: 0,
      timestamp: new Date().toISOString(),
    });
    const status = async () => {
      const response = await call(harness, "/api/v1/fleet");
      return (await response.json()).stations.find(({ id }: { id: string }) => id === "HOME-1");
    };
    expect(await status()).toMatchObject({ activeSessionCount: 1, chargingStatus: "unknown" });
    await client.call("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Charging",
    });
    expect(await status()).toMatchObject({ chargingStatus: "charging" });
    await client.close({ force: true });
    await vi.waitFor(async () =>
      expect(await status()).toMatchObject({
        activeSessionCount: 1,
        chargingStatus: "unknown",
        connected: false,
      }),
    );
  });

  it("copies a card to other chargers and refuses unknown targets without changing anything", async () => {
    const harness = await start();
    const card = { stationId: "OFFICE-1", tagPseudonym: OFFICE(POOL_CARD) };
    await expect(
      call(harness, "/api/v1/fleet-cards/policy", {
        body: { card, ownership: "company", use: "business" },
      }).then((response) => response.status),
    ).resolves.toBe(200);

    const refused = await call(harness, "/api/v1/fleet-cards/copy", {
      body: { card, toStationIds: ["HOME-1", "NOWHERE"] },
    });
    expect(refused.status).toBe(404);
    expect(harness.registries.get("HOME-1")!.tags.has(POOL_CARD)).toBe(false);

    const copied = await call(harness, "/api/v1/fleet-cards/copy", {
      body: { card, toStationIds: ["HOME-1", "OFFICE-1"] },
    });
    expect(copied.status).toBe(200);
    expect(await copied.json()).toEqual({
      stations: [
        { outcome: "added", stationId: "HOME-1" },
        { outcome: "already-present", stationId: "OFFICE-1" },
      ],
    });
    expect(harness.registries.get("HOME-1")!.tags.has(POOL_CARD)).toBe(true);
    // The copy keeps its classification under the target charger's own pseudonym.
    expect(harness.cardPolicy.get("HOME-1", HOME(POOL_CARD))).toEqual({
      ownership: "company",
      use: "business",
    });

    const cards = (await (await call(harness, "/api/v1/fleet-cards")).json()) as {
      cards: { members: { stationId: string; tagPseudonym: string }[] }[];
    };
    const pool = cards.cards.find(({ members }) =>
      members.some(({ tagPseudonym }) => tagPseudonym === OFFICE(POOL_CARD)),
    );
    expect(pool?.members.map(({ stationId }) => stationId).sort()).toEqual(["HOME-1", "OFFICE-1"]);
    const projected = JSON.stringify(cards);
    for (const raw of [COMPANY_CARD, POOL_CARD]) expect(projected).not.toContain(raw);
    for (const raw of [COMPANY_CARD, POOL_CARD]) {
      expect(JSON.stringify(harness.evidence.events)).not.toContain(raw);
    }
  });

  it("removes a card everywhere but keeps the last card of a charger", async () => {
    const harness = await start();
    const response = await call(harness, "/api/v1/fleet-cards/remove", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: HOME(COMPANY_CARD) },
        confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      stations: [
        { outcome: "removed", stationId: "OFFICE-1" },
        { outcome: "kept-last-card", stationId: "HOME-1" },
      ],
    });
    expect([...harness.registries.get("OFFICE-1")!.tags]).toEqual([POOL_CARD]);
    expect([...harness.registries.get("HOME-1")!.tags]).toEqual([COMPANY_CARD]);

    // The exact confirmation phrase is required.
    const unconfirmed = await call(harness, "/api/v1/fleet-cards/remove", {
      body: {
        card: { stationId: "OFFICE-1", tagPseudonym: OFFICE(POOL_CARD) },
        confirmation: "yes",
      },
    });
    expect(unconfirmed.status).toBe(400);
    expect(harness.registries.get("OFFICE-1")!.tags.has(POOL_CARD)).toBe(true);
  });

  it("classifies a card on every charger that holds it", async () => {
    const harness = await start();
    const response = await call(harness, "/api/v1/fleet-cards/policy", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: HOME(COMPANY_CARD) },
        ownership: "company",
        use: "business",
      },
    });
    expect(response.status).toBe(200);
    expect(harness.cardPolicy.get("HOME-1", HOME(COMPANY_CARD))).toMatchObject({ use: "business" });
    expect(harness.cardPolicy.get("OFFICE-1", OFFICE(COMPANY_CARD))).toMatchObject({
      use: "business",
    });
    const invalid = await call(harness, "/api/v1/fleet-cards/policy", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: HOME(COMPANY_CARD) },
        ownership: "company",
        use: "sometimes",
      },
    });
    expect(invalid.status).toBe(400);
    // A pseudonym of another charger does not address this one.
    const foreign = await call(harness, "/api/v1/fleet-cards/policy", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: OFFICE(COMPANY_CARD) },
        ownership: "personal",
        use: "private",
      },
    });
    expect(foreign.status).toBe(409);
    expect(harness.cardPolicy.get("HOME-1", HOME(COMPANY_CARD))).toMatchObject({ use: "business" });
  });

  it("accepts a card reference with exactly stationId and tagPseudonym", async () => {
    const harness = await start();
    const extra = {
      onCharger: true,
      stationId: "OFFICE-1",
      tagPseudonym: OFFICE(POOL_CARD),
    };
    const responses = await Promise.all([
      call(harness, "/api/v1/fleet-cards/copy", {
        body: { card: extra, toStationIds: ["HOME-1"] },
      }),
      call(harness, "/api/v1/fleet-cards/remove", {
        body: { card: extra, confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
      }),
      call(harness, "/api/v1/fleet-cards/policy", {
        body: { card: extra, ownership: "company", use: "business" },
      }),
      call(harness, "/api/v1/fleet-cards/policy", {
        body: {
          card: { stationId: "OFFICE-1", tagPseudonym: POOL_CARD },
          ownership: "company",
          use: "business",
        },
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: expect.stringMatching(/invalid/u) },
      });
    }
    expect(harness.registries.get("HOME-1")!.tags.has(POOL_CARD)).toBe(false);
    expect(harness.registries.get("OFFICE-1")!.tags.has(POOL_CARD)).toBe(true);
    expect(harness.cardPolicy.get("OFFICE-1", OFFICE(POOL_CARD))).toBeNull();
  });

  it("registers a tapped card once, classified, without its value leaving the server", async () => {
    const harness = await start();
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    expect((await call(harness, "/api/v1/stations/HOME-1/card-capture", { body: {} })).status).toBe(
      200,
    );
    await tap(home, PERSONAL_CARD);
    const snapshot = await (await call(harness, "/api/v1/stations/HOME-1/snapshot")).json();
    expect(snapshot.cardCapture).toMatchObject({
      state: "captured",
      tagPseudonym: HOME(PERSONAL_CARD),
    });

    const body = {
      holderPersonId: null,
      name: null,
      ownership: "company",
      tagPseudonym: HOME(PERSONAL_CARD),
      use: "business",
    };
    const wrongStation = await call(harness, "/api/v1/stations/OFFICE-1/card-capture/register", {
      body,
    });
    expect(wrongStation.status).toBe(409);
    expect(await wrongStation.json()).toMatchObject({
      error: { code: "card_capture_unavailable" },
    });

    const registered = await call(harness, "/api/v1/stations/HOME-1/card-capture/register", {
      body,
    });
    expect(registered.status).toBe(201);
    const text = await registered.text();
    expect(text).not.toContain(PERSONAL_CARD);
    expect(JSON.parse(text)).toEqual({ tagCount: 2, tagPseudonym: HOME(PERSONAL_CARD) });
    expect(harness.registries.get("HOME-1")!.tags.has(PERSONAL_CARD)).toBe(true);
    expect(harness.registries.get("OFFICE-1")!.tags.has(PERSONAL_CARD)).toBe(false);
    expect(harness.cardPolicy.get("HOME-1", HOME(PERSONAL_CARD))).toEqual({
      ownership: "company",
      use: "business",
    });

    const again = await call(harness, "/api/v1/stations/HOME-1/card-capture/register", { body });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "card_capture_unavailable" } });
    expect(JSON.stringify(harness.evidence.events)).not.toContain(PERSONAL_CARD);
    await expect(tap(home, PERSONAL_CARD)).resolves.toMatchObject({
      idTagInfo: { status: "Accepted" },
    });
  });

  /* ---------------------------------------------------------------- */
  /* Employee page                                                     */
  /* ---------------------------------------------------------------- */

  it("lets an employee add and remove only personal cards on their own charger", async () => {
    const harness = await start();
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    const { token } = await grant(harness, "/api/v1/stations/HOME-1", "driver");
    const driver = (path: string, body?: unknown) =>
      call(harness, `/api/v1/stations/HOME-1/delegate/driver${path}`, { body, token });

    const view = (await (await driver("")).json()) as DriverView;
    expect(view.station.id).toBe("HOME-1");
    expect(view.cards.map(({ tagPseudonym }) => tagPseudonym)).toEqual([HOME(COMPANY_CARD)]);
    expect(view.cardCapture).toBeNull();
    // Office cards and raw values never appear.
    const text = JSON.stringify(view);
    expect(text).not.toContain(OFFICE(POOL_CARD));
    expect(text).not.toContain(COMPANY_CARD);

    expect((await driver("/card-capture", {})).status).toBe(201);
    await tap(home, PERSONAL_CARD);
    const captured = (await (await driver("")).json()) as DriverView;
    expect(captured.cardCapture).toMatchObject({
      state: "captured",
      tagPseudonym: HOME(PERSONAL_CARD),
    });
    const confirmed = await driver("/card-capture/confirm", { tagPseudonym: HOME(PERSONAL_CARD) });
    expect(confirmed.status).toBe(201);
    expect(await confirmed.text()).not.toContain(PERSONAL_CARD);
    // An employee can only ever add a personal, private card.
    expect(harness.cardPolicy.get("HOME-1", HOME(PERSONAL_CARD))).toEqual({
      ownership: "personal",
      use: "private",
    });
    expect(harness.driverCaptures.has("HOME-1")).toBe(false);

    const removeCompany = await driver(`/cards/${HOME(COMPANY_CARD)}/remove`, {
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    expect(removeCompany.status).toBe(403);
    expect(await removeCompany.json()).toMatchObject({ error: { code: "company_card" } });
    // A card of another charger is never theirs to remove.
    expect(
      (
        await driver(`/cards/${OFFICE(POOL_CARD)}/remove`, {
          confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
        })
      ).status,
    ).toBe(403);
    expect(harness.registries.get("OFFICE-1")!.tags.has(POOL_CARD)).toBe(true);

    const removePersonal = await driver(`/cards/${HOME(PERSONAL_CARD)}/remove`, {
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    expect(removePersonal.status).toBe(200);
    expect(harness.registries.get("HOME-1")!.tags.has(PERSONAL_CARD)).toBe(false);
    expect(harness.cardPolicy.get("HOME-1", HOME(PERSONAL_CARD))).toBeNull();
    // The owner's company card keeps working throughout.
    expect(harness.registries.get("HOME-1")!.tags.has(COMPANY_CARD)).toBe(true);
    await expect(tap(home, COMPANY_CARD)).resolves.toMatchObject({
      idTagInfo: { status: "Accepted" },
    });
  });

  it("keeps the owner's tap private from the employee page", async () => {
    const harness = await start();
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    const { token } = await grant(harness, "/api/v1/stations/HOME-1", "driver");
    const driver = (path: string, body?: unknown) =>
      call(harness, `/api/v1/stations/HOME-1/delegate/driver${path}`, { body, token });

    // The owner starts listening: the employee neither sees nor confirms it, nor cancels it.
    await call(harness, "/api/v1/stations/HOME-1/card-capture", { body: {} });
    await tap(home, PERSONAL_CARD);
    expect(((await (await driver("")).json()) as DriverView).cardCapture).toBeNull();
    const stolen = await driver("/card-capture/confirm", { tagPseudonym: HOME(PERSONAL_CARD) });
    expect(stolen.status).toBe(409);
    expect((await driver("/card-capture/cancel", {})).status).toBe(200);
    const owner = await (await call(harness, "/api/v1/stations/HOME-1/snapshot")).json();
    expect(owner.cardCapture).toMatchObject({ state: "captured" });
    expect(harness.registries.get("HOME-1")!.tags.has(PERSONAL_CARD)).toBe(false);
    // Nor can the employee start listening over it and claim the tapped card as personal.
    const takeover = await driver("/card-capture", {});
    expect(takeover.status).toBe(409);
    expect(await takeover.json()).toMatchObject({ error: { code: "card_capture_busy" } });
    expect(harness.driverCaptures.has("HOME-1")).toBe(false);
    const still = await (await call(harness, "/api/v1/stations/HOME-1/snapshot")).json();
    expect(still.cardCapture).toMatchObject({
      state: "captured",
      tagPseudonym: HOME(PERSONAL_CARD),
    });
    await call(harness, "/api/v1/stations/HOME-1/card-capture/cancel", { body: {} });

    // The employee starts listening, then the owner takes it over.
    expect((await driver("/card-capture", {})).status).toBe(201);
    expect(harness.driverCaptures.has("HOME-1")).toBe(true);
    await call(harness, "/api/v1/stations/HOME-1/card-capture", { body: {} });
    expect(harness.driverCaptures.has("HOME-1")).toBe(false);
    await tap(home, PERSONAL_CARD);
    expect(((await (await driver("")).json()) as DriverView).cardCapture).toBeNull();
    expect(
      (await driver("/card-capture/confirm", { tagPseudonym: HOME(PERSONAL_CARD) })).status,
    ).toBe(409);
    expect(harness.registries.get("HOME-1")!.tags.has(PERSONAL_CARD)).toBe(false);
  });

  it("refuses an employee card it cannot record as personal, without using up the tap", async () => {
    const harness = await start({ readOnlyCardPolicy: true });
    expect(harness.cardPolicy.writable).toBe(false);
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    const { token } = await grant(harness, "/api/v1/stations/HOME-1", "driver");
    const driver = (path: string, body?: unknown) =>
      call(harness, `/api/v1/stations/HOME-1/delegate/driver${path}`, { body, token });
    expect((await driver("/card-capture", {})).status).toBe(201);
    await tap(home, PERSONAL_CARD);
    const confirmed = await driver("/card-capture/confirm", { tagPseudonym: HOME(PERSONAL_CARD) });
    expect(confirmed.status).toBe(503);
    expect(harness.registries.get("HOME-1")!.tags.has(PERSONAL_CARD)).toBe(false);
    expect(((await (await driver("")).json()) as DriverView).cardCapture).toMatchObject({
      state: "captured",
    });
  });

  it("shows an employee only sessions since their link was issued", async () => {
    const harness = await start();
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    // The previous employee charged before this link existed.
    await charge(home, COMPANY_CARD, 4_000);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { token } = await grant(harness, "/api/v1/stations/HOME-1", "driver");
    const driver = () => call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token });
    expect(((await (await driver()).json()) as DriverView).sessions).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await charge(home, COMPANY_CARD, 6_000);
    expect(((await (await driver()).json()) as DriverView).sessions).toEqual([
      expect.objectContaining({ energyWh: 6_000 }),
    ]);
    // Renewing the link while the old one is active keeps the employee's history whole.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { token: renewed } = await grant(harness, "/api/v1/stations/HOME-1", "driver");
    const view = await call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token: renewed });
    expect(((await view.json()) as DriverView).sessions).toEqual([
      expect.objectContaining({ energyWh: 6_000 }),
    ]);
  });

  it("confines an employee link to its own charger, scope, lifetime and revocation", async () => {
    const harness = await start();
    const { grant: issued, token } = await grant(harness, "/api/v1/stations/HOME-1", "driver");

    expect((await call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token })).status).toBe(
      200,
    );
    // Another charger, or the legacy unscoped route (the first charger), refuses the link.
    expect(
      (await call(harness, "/api/v1/stations/OFFICE-1/delegate/driver", { token })).status,
    ).toBe(401);
    expect((await call(harness, "/api/v1/delegate/driver", { token })).status).toBe(401);
    expect(
      (await call(harness, "/api/v1/stations/NOWHERE/delegate/driver", { token })).status,
    ).toBe(401);
    // A driver link is not an owner token.
    expect((await call(harness, "/api/v1/fleet-cards", { token })).status).toBe(401);
    // On its own charger the delegate router answers, and it has no owner routes.
    for (const path of ["/snapshot", "/owner-tags", "/delegations", "/card-capture/register"]) {
      expect((await call(harness, `/api/v1/stations/HOME-1${path}`, { token })).status).toBe(404);
    }
    // Offline: listening cannot start.
    const offline = await call(harness, "/api/v1/stations/HOME-1/delegate/driver/card-capture", {
      body: {},
      token,
    });
    expect(offline.status).toBe(409);

    // Another role does not carry the driver scopes.
    const { token: employer } = await grant(harness, "/api/v1/stations/HOME-1", "employer");
    expect(
      (await call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token: employer })).status,
    ).toBe(403);

    // Expired.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 86_400_000);
    expect((await call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token })).status).toBe(
      401,
    );
    vi.useRealTimers();

    // Revoked.
    const revoked = await call(
      harness,
      `/api/v1/stations/HOME-1/delegations/${issued.grantId}/revoke`,
      { method: "POST" },
    );
    expect(revoked.status).toBe(200);
    expect((await call(harness, "/api/v1/stations/HOME-1/delegate/driver", { token })).status).toBe(
      401,
    );
    // The owner's card list is unchanged by any of this.
    expect([...harness.registries.get("HOME-1")!.tags]).toEqual([COMPANY_CARD]);
    // Every use is audited for the owner, without the bearer secret.
    expect(JSON.stringify(harness.evidence.events)).not.toContain(token);
  });

  /* ---------------------------------------------------------------- */
  /* Reimbursement feed                                                */
  /* ---------------------------------------------------------------- */

  it("feeds finance business sessions for the whole fleet from the first charger only", async () => {
    const harness = await start();
    const office = await connect(harness, "OFFICE-1", OFFICE_SECRET);
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    await call(harness, "/api/v1/fleet-cards/policy", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: HOME(COMPANY_CARD) },
        ownership: "company",
        use: "business",
      },
    });
    // Sam's personal card, classified private.
    await harness.registries.get("HOME-1")!.add(
      {
        ...harness.config,
        ownerTags: harness.registries.get("HOME-1")!.tags,
        stationId: "HOME-1",
        stationSecret: HOME_SECRET,
      },
      harness.evidence,
      PERSONAL_CARD,
    );
    await harness.cardPolicy.set(
      harness.config,
      harness.evidence,
      [{ stationId: "HOME-1", tagPseudonym: HOME(PERSONAL_CARD) }],
      "personal",
      "private",
    );
    await charge(home, COMPANY_CARD, 7_000);
    await charge(home, PERSONAL_CARD, 3_000);
    await charge(office, POOL_CARD, 2_000);
    // A refused card never counts.
    await charge(office, "04DEADBEEF", 9_000);

    // A finance feed is issued only on the first charger.
    const misplaced = await call(harness, "/api/v1/stations/HOME-1/delegations", {
      body: { expiresAt: new Date(Date.now() + 86_400_000).toISOString(), role: "finance" },
    });
    expect(misplaced.status).toBe(400);
    const { token } = await grant(harness, "/api/v1/stations/OFFICE-1", "finance");

    const month = monthOf(new Date().toISOString(), TIME_ZONE)!;
    const query = `?month=${month}&timeZone=${encodeURIComponent(TIME_ZONE)}`;
    const response = await call(harness, `/api/v1/delegate/reimbursement${query}`, { token });
    expect(response.status).toBe(200);
    const text = await response.text();
    const feed = JSON.parse(text) as ReimbursementFeed;
    expect(feed.excludedPrivateSessions).toBe(1);
    const byStation = Object.fromEntries(
      feed.stations.map(({ sessions, stationId }) => [stationId, sessions]),
    );
    expect(byStation["HOME-1"]).toEqual([
      expect.objectContaining({
        cardOwnership: "company",
        cardUse: "business",
        energyWh: 7_000,
        tagPseudonym: HOME(COMPANY_CARD),
      }),
    ]);
    // Unclassified is never silently business.
    expect(byStation["OFFICE-1"]).toEqual([
      expect.objectContaining({ cardOwnership: null, cardUse: "unclassified", energyWh: 2_000 }),
    ]);
    for (const raw of [COMPANY_CARD, POOL_CARD, PERSONAL_CARD, "04DEADBEEF"]) {
      expect(text).not.toContain(raw);
    }
    expect(text).not.toContain(HOME(PERSONAL_CARD));
    for (const name of ["Driveway", "Office bay 1", "Ghent"]) expect(text).not.toContain(name);

    // The feed answers on the first charger only, and the token reads nothing else.
    expect(
      (await call(harness, `/api/v1/stations/HOME-1/delegate/reimbursement${query}`, { token }))
        .status,
    ).toBe(401);
    expect((await call(harness, "/api/v1/delegate/driver", { token })).status).toBe(403);
    expect((await call(harness, "/api/v1/delegate/sessions", { token })).status).toBe(403);
    // A driver link cannot read the feed.
    const { token: driver } = await grant(harness, "/api/v1/stations/OFFICE-1", "driver");
    expect(
      (await call(harness, `/api/v1/delegate/reimbursement${query}`, { token: driver })).status,
    ).toBe(403);

    // Removing the private card later never makes its earlier sessions reimbursable.
    const removed = await call(harness, "/api/v1/fleet-cards/remove", {
      body: {
        card: { stationId: "HOME-1", tagPseudonym: HOME(PERSONAL_CARD) },
        confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
      },
    });
    expect(removed.status).toBe(200);
    expect(harness.cardPolicy.get("HOME-1", HOME(PERSONAL_CARD))).toBeNull();
    const after = await call(harness, `/api/v1/delegate/reimbursement${query}`, { token });
    const afterText = await after.text();
    expect((JSON.parse(afterText) as ReimbursementFeed).excludedPrivateSessions).toBe(1);
    expect(afterText).not.toContain(HOME(PERSONAL_CARD));
  });

  /* ---------------------------------------------------------------- */
  /* Chargers added and retired at runtime                             */
  /* ---------------------------------------------------------------- */

  it("connects a charger added at runtime and refuses it once retired, leaving others alone", async () => {
    const harness = await start();
    const home = await connect(harness, "HOME-1", HOME_SECRET);
    const added = await call(harness, "/api/v1/managed-stations", {
      body: {
        driverPersonId: null,
        expected: null,
        id: "garage-2",
        label: "Garage",
        ownership: "company",
        site: "Ghent",
      },
    });
    expect(added.status).toBe(201);
    const { setupSheet } = (await added.json()) as AddStationResult;
    expect(setupSheet.password).toMatch(/^[0-9a-f]{40}$/u);
    expect(JSON.stringify(harness.evidence.events)).not.toContain(setupSheet.password);

    // Its password belongs to it alone.
    await expect(connect(harness, "HOME-1", setupSheet.password)).rejects.toThrow();
    await expect(connect(harness, "garage-2", HOME_SECRET)).rejects.toThrow();
    const garage = await connect(harness, "garage-2", setupSheet.password);
    expect(harness.gateway.getRuntime("garage-2").connected).toBe(true);
    // A new charger has no cards: every card is refused until the owner adds one.
    await expect(tap(garage, COMPANY_CARD)).resolves.toMatchObject({
      idTagInfo: { status: "Invalid" },
    });
    // Its first card is the owner's to add, never an employee's personal card.
    const { token: employee } = await grant(harness, "/api/v1/stations/garage-2", "driver");
    const driver = (path: string, body?: unknown) =>
      call(harness, `/api/v1/stations/garage-2/delegate/driver${path}`, { body, token: employee });
    expect((await driver("/card-capture", {})).status).toBe(201);
    await tap(garage, PERSONAL_CARD);
    const first = await driver("/card-capture/confirm", {
      tagPseudonym: `tag_${pseudonymizeTag(PERSONAL_CARD, setupSheet.password)}`,
    });
    expect(first.status).toBe(409);
    expect(harness.registries.get("garage-2")!.tags.size).toBe(0);
    expect((await driver("/card-capture/cancel", {})).status).toBe(200);

    const closed = new Promise<void>((resolve) => garage.once("close", () => resolve()));
    const wrongPhrase = await call(harness, "/api/v1/stations/garage-2/retire", {
      body: { confirmation: "RETIRE garage" },
    });
    expect(wrongPhrase.status).toBe(400);
    expect(harness.gateway.getRuntime("garage-2").connected).toBe(true);
    const retired = await call(harness, "/api/v1/stations/garage-2/retire", {
      body: { confirmation: retirementPhrase("garage-2") },
    });
    expect(retired.status).toBe(200);
    await closed;
    expect(harness.gateway.getRuntime("garage-2").connected).toBe(false);
    await expect(connect(harness, "garage-2", setupSheet.password)).rejects.toThrow();
    expect((await call(harness, "/api/v1/stations/garage-2/snapshot")).status).toBe(404);

    // The first charger cannot be retired; the other charger never noticed.
    expect(
      (
        await call(harness, "/api/v1/stations/OFFICE-1/retire", {
          body: { confirmation: retirementPhrase("OFFICE-1") },
        })
      ).status,
    ).toBe(409);
    expect(harness.gateway.getRuntime("HOME-1").connected).toBe(true);
    await expect(tap(home, COMPANY_CARD)).resolves.toMatchObject({
      idTagInfo: { status: "Accepted" },
    });
    // A retired name is never reused.
    const reused = await call(harness, "/api/v1/managed-stations", {
      body: {
        driverPersonId: null,
        expected: null,
        id: "garage-2",
        label: "Garage again",
        ownership: "company",
        site: "Ghent",
      },
    });
    expect(reused.status).toBe(409);
  });
});
