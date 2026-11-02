import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOwnerApi, type OwnerApi } from "../server/api.js";
import type { GatewayConfig } from "../server/config.js";
import {
  DirectoryNotFoundError,
  DirectoryUnavailableError,
  OwnerDirectoryStore,
} from "../server/directory.js";
import { evidenceEvent } from "../server/events.js";
import type { ChargeGateway } from "../server/gateway.js";
import { OwnerTagRegistry, withOwnerTagRegistries } from "../server/owner-tags.js";
import { pseudonymizeTag } from "../server/tag.js";
import {
  DirectoryInputError,
  normalizeDirectoryName,
  type OwnerDirectory,
} from "../shared/directory.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.js";

const TOKEN = "owner-token-at-least-thirty-two-characters";
const HOME_SECRET = "station-secret-at-least-sixteen";
const OFFICE_SECRET = "office-station-secret-strong";

function fleetConfig(root: string, homeId = "HOME_1"): GatewayConfig {
  return {
    apiHost: "127.0.0.1",
    apiPort: 0,
    eventLogMaxBytes: 268_435_456,
    eventLogPath: join(root, "events.ndjson"),
    heartbeatSeconds: 60,
    ocppHost: "127.0.0.1",
    ocppMaxConnections: 8,
    ocppMaxPayloadBytes: 1_048_576,
    ocppMessageBurst: 60,
    ocppMessagesPerMinute: 600,
    ownerApiToken: TOKEN,
    ownerTags: new Set(["home-owner-tag"]),
    port: 0,
    profile: "company",
    stationId: homeId,
    stationSecret: HOME_SECRET,
    stations: [
      {
        driver: "Alice  Peeters",
        id: homeId,
        label: "Driveway",
        ownerTags: new Set(["home-owner-tag"]),
        secret: HOME_SECRET,
        site: "Leuven",
      },
      {
        id: "OFFICE_1",
        label: "Office bay 1",
        ownerTags: new Set(["office-owner-tag"]),
        secret: OFFICE_SECRET,
        site: "Brussels office",
      },
    ],
    trustProxyHeaders: false,
    uiDirectory: root,
  };
}

function scoped(config: GatewayConfig, stationId: string): GatewayConfig {
  const station = config.stations!.find(({ id }) => id === stationId)!;
  return { ...config, ownerTags: station.ownerTags, stationId, stationSecret: station.secret };
}

function pseudonym(tag: string, secret: string): string {
  return `tag_${pseudonymizeTag(tag, secret)}`;
}

describe("owner directory names", () => {
  it("accepts ordinary names and rejects invisible or oversized ones", () => {
    const char = (code: number) => String.fromCodePoint(code);
    expect(normalizeDirectoryName("  Sofie \t Peeters ")).toBe("Sofie Peeters");
    // Decomposed input is stored in composed form.
    expect(normalizeDirectoryName(`Zoe${char(0x301)}`)).toBe(`Zo${char(0xe9)}`);
    // Line and paragraph separators are whitespace: folded into one space, never stored.
    expect(normalizeDirectoryName(`line\nbreak${char(0x2029)}here`)).toBe("line break here");
    for (const value of [
      "",
      "   ",
      "a".repeat(81),
      `Evil${char(0x202e)}gnp.exe`,
      `zero${char(0x200b)}width`,
      `soft${char(0xad)}hyphen`,
      `private${char(0xe000)}use`,
      `bell${char(0x7)}`,
      42,
      null,
    ]) {
      expect(() => normalizeDirectoryName(value)).toThrow(DirectoryInputError);
    }
  });
});

describe("owner directory store", () => {
  let root: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await rm(root, { force: true, recursive: true });
    root = undefined;
  });

  it("seeds configured names once, persists owner-only and keeps console edits", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const path = join(root, "directory.json");

    const store = await OwnerDirectoryStore.open(config);
    expect(store.writable).toBe(true);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    const seeded = store.project(config);
    expect(seeded.people).toEqual([
      { id: expect.stringMatching(/^person_[a-f0-9]{24}$/u), name: "Alice Peeters" },
    ]);
    expect(seeded.stations).toEqual([
      { driverPersonId: seeded.people[0]!.id, id: "HOME_1", label: "Driveway", site: "Leuven" },
      { driverPersonId: null, id: "OFFICE_1", label: "Office bay 1", site: "Brussels office" },
    ]);
    expect(seeded.cards).toEqual([
      {
        holderPersonId: null,
        name: null,
        stationId: "HOME_1",
        tagPseudonym: pseudonym("home-owner-tag", HOME_SECRET),
      },
      {
        holderPersonId: null,
        name: null,
        stationId: "OFFICE_1",
        tagPseudonym: pseudonym("office-owner-tag", OFFICE_SECRET),
      },
    ]);

    const bob = await store.addPerson({ name: "Bob Janssens" });
    await store.updateStation("OFFICE_1", {
      driverPersonId: bob.id,
      label: "Bob's driveway",
      site: "Gent",
    });
    await store.updateCard(
      scoped(config, "OFFICE_1"),
      pseudonym("office-owner-tag", OFFICE_SECRET),
      {
        holderPersonId: bob.id,
        name: "Blue fob",
      },
    );

    const raw = await readFile(path, "utf8");
    // The file holds names and pseudonyms only, never a raw card identifier or secret.
    expect(raw).not.toContain("office-owner-tag");
    expect(raw).not.toContain(OFFICE_SECRET);

    const reopened = await OwnerDirectoryStore.open(config);
    const names = reopened.stationNames(config);
    expect(names("OFFICE_1")).toEqual({
      driver: "Bob Janssens",
      label: "Bob's driveway",
      site: "Gent",
    });
    expect(names("HOME_1")).toEqual({ driver: "Alice Peeters", label: "Driveway", site: "Leuven" });
    expect(names("UNKNOWN")).toBeUndefined();
    expect(reopened.project(config).cards[1]).toMatchObject({
      holderPersonId: bob.id,
      name: "Blue fob",
    });
    // Reopening never re-seeds a station that already has an entry.
    expect(await readFile(path, "utf8")).toBe(raw);
  });

  it("clears assignments when a person is removed", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const store = await OwnerDirectoryStore.open(config);
    const alice = store.project(config).people[0]!;
    const tag = pseudonym("home-owner-tag", HOME_SECRET);
    await store.updateCard(scoped(config, "HOME_1"), tag, { holderPersonId: alice.id, name: null });

    await store.removePerson(alice.id);
    const after = store.project(config);
    expect(after.people).toEqual([]);
    expect(after.stations[0]!.driverPersonId).toBeNull();
    // A card with neither a name nor a holder has nothing left to remember.
    expect(after.cards[0]).toMatchObject({ holderPersonId: null, name: null });
    await expect(store.removePerson(alice.id)).rejects.toThrow(DirectoryNotFoundError);
    await expect(store.renamePerson(alice.id, { name: "Ghost" })).rejects.toThrow(
      DirectoryNotFoundError,
    );
    await expect(
      store.updateStation("HOME_1", {
        driverPersonId: alice.id,
        label: "Driveway",
        site: "Leuven",
      }),
    ).rejects.toThrow(DirectoryNotFoundError);
  });

  it("names only cards in the same charger's desired set", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const store = await OwnerDirectoryStore.open(config);
    const officeTag = pseudonym("office-owner-tag", OFFICE_SECRET);

    // Another charger's pseudonym, the same raw tag under this charger's secret, or garbage.
    for (const candidate of [
      officeTag,
      pseudonym("office-owner-tag", HOME_SECRET),
      "tag_000000000000000000000000",
      "__proto__",
    ]) {
      await expect(
        store.updateCard(scoped(config, "HOME_1"), candidate, { holderPersonId: null, name: "x" }),
      ).rejects.toThrow(DirectoryNotFoundError);
    }
    await store.updateCard(scoped(config, "OFFICE_1"), officeTag, {
      holderPersonId: null,
      name: "Desk fob",
    });
    expect(
      store.project(config).cards.find(({ stationId }) => stationId === "HOME_1")?.name,
    ).toBeNull();

    // A second card keeps its name while the revoked one is forgotten.
    const officeTags = config.stations![1]!.ownerTags as Set<string>;
    officeTags.add("spare-office-tag");
    const spareTag = pseudonym("spare-office-tag", OFFICE_SECRET);
    await store.updateCard(scoped(config, "OFFICE_1"), spareTag, {
      holderPersonId: null,
      name: "Spare",
    });
    officeTags.delete("office-owner-tag");
    await store.forgetRevokedCards(config);
    const raw = await readFile(join(root, "directory.json"), "utf8");
    expect(raw).not.toContain("Desk fob");
    expect(raw).toContain("Spare");

    // Re-adding the same physical card starts unnamed.
    officeTags.add("office-owner-tag");
    await store.forgetAddedCard(scoped(config, "OFFICE_1"), officeTag);
    expect(
      store.project(config).cards.find((card) => card.tagPseudonym === officeTag)?.name,
    ).toBeNull();
  });

  it("cannot commit a name for a card revoked while the name was being saved", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const store = await OwnerDirectoryStore.open(config);
    const officeTags = config.stations![1]!.ownerTags as Set<string>;
    officeTags.add("spare-office-tag");
    const officeTag = pseudonym("office-owner-tag", OFFICE_SECRET);

    // The naming request is admitted first; the revoke lands before it is written.
    const naming = store.updateCard(scoped(config, "OFFICE_1"), officeTag, {
      holderPersonId: null,
      name: "Old holder fob",
    });
    // Let the naming request pass its desired-card check; its write is still in flight.
    for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
    officeTags.delete("office-owner-tag");
    const forgetting = store.forgetRevokedCards(config);
    await Promise.all([naming, forgetting]);
    expect(await readFile(join(root, "directory.json"), "utf8")).not.toContain("Old holder fob");
    officeTags.add("office-owner-tag");
    await store.forgetAddedCard(scoped(config, "OFFICE_1"), officeTag);
    expect(await readFile(join(root, "directory.json"), "utf8")).not.toContain("Old holder fob");
    expect(
      store.project(config).cards.find((card) => card.tagPseudonym === officeTag)?.name,
    ).toBeNull();
  });

  it("refuses an edit that would make the stored names unreadable on the next start", async () => {
    const base = fleetConfig("/unused");
    // 1,000 chargers, each with one card: the most a fleet configuration allows per entry type.
    const config: GatewayConfig = {
      ...base,
      stations: Array.from({ length: 1_000 }, (_, index) => ({
        id: `STATION_${index}`,
        label: `Charger ${index}`,
        ownerTags: new Set([`tag-${index}`]),
        secret: `station-secret-${index}-padding`,
        site: "Site",
      })),
    };
    const store = OwnerDirectoryStore.memory(config);
    const longName = String.fromCodePoint(0x1f50b).repeat(80);
    let refused: unknown = null;
    try {
      for (const station of config.stations!) {
        await store.updateStation(station.id, {
          driverPersonId: null,
          label: longName,
          site: longName,
        });
      }
      for (const station of config.stations!) {
        await store.updateCard(
          scoped(config, station.id),
          pseudonym(`tag-${station.id.slice(8)}`, station.secret),
          { holderPersonId: null, name: longName },
        );
      }
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(DirectoryInputError);
    // The refused edit left the last valid state in place.
    expect(store.writable).toBe(true);
  });

  it("reports a failed save as unavailable and keeps the last saved names", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const store = await OwnerDirectoryStore.open(config);
    await chmod(root, 0o500);
    try {
      await expect(store.addPerson({ name: "Sofie" })).rejects.toThrow(DirectoryUnavailableError);
    } finally {
      await chmod(root, 0o700);
    }
    expect(store.project(config).people.map(({ name }) => name)).toEqual(["Alice Peeters"]);
    await expect(store.addPerson({ name: "Sofie" })).resolves.toMatchObject({ name: "Sofie" });
  });

  it("removes abandoned temporary copies and drops chargers that are no longer configured", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    await OwnerDirectoryStore.open(config);
    const leftover = join(root, "directory.json.tmp-12345678-1234-4123-8123-123456789abc");
    await writeFile(leftover, "{}", { mode: 0o600 });
    const unrelated = join(root, "directory.json.tmp-not-ours");
    await writeFile(unrelated, "{}", { mode: 0o600 });

    const smaller: GatewayConfig = { ...config, stations: [config.stations![0]!] };
    const store = await OwnerDirectoryStore.open(smaller);
    await expect(lstat(leftover)).rejects.toThrow();
    expect((await lstat(unrelated)).isFile()).toBe(true);
    expect(store.project(smaller).stations.map(({ id }) => id)).toEqual(["HOME_1"]);
    expect(await readFile(join(root, "directory.json"), "utf8")).not.toContain("OFFICE_1");
  });

  it("treats prototype-like charge point IDs as ordinary keys", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root, "__proto__");
    const store = await OwnerDirectoryStore.open(config);
    await store.updateStation("__proto__", { driverPersonId: null, label: "Proto", site: "Lab" });
    const tag = pseudonym("home-owner-tag", HOME_SECRET);
    await store.updateCard(scoped(config, "__proto__"), tag, {
      holderPersonId: null,
      name: "Lab fob",
    });

    const reopened = await OwnerDirectoryStore.open(config);
    expect(reopened.stationNames(config)("__proto__")).toMatchObject({
      label: "Proto",
      site: "Lab",
    });
    expect(reopened.project(config).cards[0]).toMatchObject({
      name: "Lab fob",
      stationId: "__proto__",
    });
    expect(({} as Record<string, unknown>).label).toBeUndefined();
  });

  it("falls back to read-only configured names without overwriting a damaged file", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-"));
    const config = fleetConfig(root);
    const path = join(root, "directory.json");
    const damaged = [
      "{not json",
      JSON.stringify({ cards: [], extra: 1, people: [], schemaVersion: 1, stations: [] }),
      JSON.stringify({
        cards: [],
        people: [{ id: "person_x", name: "Bad" }],
        schemaVersion: 1,
        stations: [],
      }),
      JSON.stringify({
        cards: [],
        people: [],
        schemaVersion: 1,
        stations: [
          {
            driverPersonId: "person_aaaaaaaaaaaaaaaaaaaaaaaa",
            id: "HOME_1",
            label: "A",
            site: "B",
          },
        ],
      }),
      JSON.stringify({ cards: [], people: [], schemaVersion: 2, stations: [] }),
    ];
    for (const contents of damaged) {
      await writeFile(path, contents, { mode: 0o600 });
      const store = await OwnerDirectoryStore.open(config);
      expect(store.writable).toBe(false);
      expect(store.project(config)).toMatchObject({
        stations: [{ label: "Driveway" }, { label: "Office bay 1" }],
        writable: false,
      });
      await expect(store.addPerson({ name: "Someone" })).rejects.toThrow(DirectoryUnavailableError);
      await store.forgetRevokedCards(config);
      expect(await readFile(path, "utf8")).toBe(contents);
    }

    await writeFile(
      path,
      JSON.stringify({ cards: [], people: [], schemaVersion: 1, stations: [] }),
    );
    await chmod(path, 0o644);
    expect((await OwnerDirectoryStore.open(config)).writable).toBe(false);

    await rm(path);
    const target = join(root, "elsewhere.json");
    await writeFile(
      target,
      JSON.stringify({ cards: [], people: [], schemaVersion: 1, stations: [] }),
      {
        mode: 0o600,
      },
    );
    await symlink(target, path);
    expect((await OwnerDirectoryStore.open(config)).writable).toBe(false);
    expect((await lstat(path)).isSymbolicLink()).toBe(true);

    // Warnings are closed messages: no names, paths or file contents.
    for (const call of warn.mock.calls) {
      expect(call.join(" ")).not.toMatch(/Alice|Driveway|directory\.json:|elsewhere/u);
    }
  });
});

describe("owner directory API", () => {
  let api: OwnerApi | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
    if (root) await rm(root, { force: true, recursive: true });
    root = undefined;
  });

  it("lets only the owner name chargers, people and cards and keeps names out of shared output", async () => {
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-api-"));
    await writeFile(join(root, "index.html"), "<h1>chargeOS</h1>");
    const bootstrap = fleetConfig(root);
    const registries = new Map([
      ["HOME_1", OwnerTagRegistry.memory(new Set(["home-owner-tag"]), HOME_SECRET)],
      ["OFFICE_1", OwnerTagRegistry.memory(new Set(["office-owner-tag"]), OFFICE_SECRET)],
    ]);
    const config = withOwnerTagRegistries(bootstrap, registries);
    const unused = async () => {
      throw new Error("not used");
    };
    const gateway: ChargeGateway = {
      async close() {},
      getRuntime: () => ({ connected: false, connectedAt: null }),
      inspectLocalAuthorization: unused,
      listen() {
        throw new Error("not used");
      },
      prepareOwnerContinuity: unused,
      sendStationCommand: unused,
      syncOwnerList: unused,
    };
    const evidence = new MemoryEvidenceStore();
    const officeTag = pseudonym("office-owner-tag", OFFICE_SECRET);
    await evidence.append(
      evidenceEvent("OFFICE_1", "station-to-csms", "StartTransaction", {
        authorizationStatus: "Accepted",
        connectorId: 1,
        idTag: officeTag,
        meterStart: 0,
        timestamp: "2026-10-12T17:00:00.000Z",
        transactionId: 1,
      }),
    );
    const directory = await OwnerDirectoryStore.open(config);
    api = createOwnerApi(config, gateway, evidence, registries, fetch, directory);
    const base = `http://127.0.0.1:${await api.listen(0, "127.0.0.1")}`;
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const post = (path: string, body: unknown, extra: Record<string, string> = headers) =>
      fetch(`${base}${path}`, { body: JSON.stringify(body), headers: extra, method: "POST" });

    expect((await fetch(`${base}/api/v1/directory`)).status).toBe(401);
    expect(
      (await post("/api/v1/people", { name: "Sofie" }, { "content-type": "application/json" }))
        .status,
    ).toBe(401);

    const added = await post("/api/v1/people", { name: "  Sofie   Peeters " });
    expect(added.status).toBe(201);
    const { person } = (await added.json()) as { person: { id: string; name: string } };
    expect(person.name).toBe("Sofie Peeters");

    for (const body of [
      { name: "Sofie", role: "admin" },
      { name: `${String.fromCodePoint(0x202e)}evil` },
      { name: "" },
      {},
    ]) {
      expect((await post("/api/v1/people", body)).status).toBe(400);
    }

    const profile = await post("/api/v1/stations/OFFICE_1/profile", {
      driverPersonId: person.id,
      label: "Sofie's driveway",
      site: "Leuven",
    });
    expect(profile.status).toBe(200);
    expect(
      (
        await post("/api/v1/stations/UNKNOWN/profile", {
          driverPersonId: null,
          label: "X",
          site: "Y",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post("/api/v1/stations/OFFICE_1/profile", {
          driverPersonId: "person_000000000000000000000000",
          label: "X",
          site: "Y",
        })
      ).status,
    ).toBe(404);
    expect(
      (await post("/api/v1/stations/OFFICE_1/profile", { label: "X", site: "Y" })).status,
    ).toBe(400);

    // A card is named on its own charger only.
    expect(
      (
        await post(`/api/v1/stations/HOME_1/cards/${officeTag}`, {
          holderPersonId: null,
          name: "Fob",
        })
      ).status,
    ).toBe(404);
    const named = await post(`/api/v1/stations/OFFICE_1/cards/${officeTag}`, {
      holderPersonId: person.id,
      name: "Blue fob",
    });
    expect(named.status).toBe(200);
    expect(((await named.json()) as OwnerDirectory).cards).toContainEqual({
      holderPersonId: person.id,
      name: "Blue fob",
      stationId: "OFFICE_1",
      tagPseudonym: officeTag,
    });

    // A runtime-added card can be named straight away, by the pseudonym the add returned.
    const addCard = await post("/api/v1/stations/OFFICE_1/owner-tags", {
      tag: "second-office-tag",
    });
    expect(addCard.status).toBe(201);
    const { tagPseudonym: secondTag } = (await addCard.json()) as { tagPseudonym: string };
    expect(
      (
        await post(`/api/v1/stations/OFFICE_1/cards/${secondTag}`, {
          holderPersonId: null,
          name: "Spare",
        })
      ).status,
    ).toBe(200);

    const fleet = await (await fetch(`${base}/api/v1/fleet`, { headers })).json();
    expect(fleet.stations[1]).toMatchObject({
      driver: "Sofie Peeters",
      label: "Sofie's driveway",
      site: "Leuven",
    });
    const snapshot = await (
      await fetch(`${base}/api/v1/stations/OFFICE_1/snapshot`, { headers })
    ).json();
    expect(snapshot.station).toMatchObject({ driver: "Sofie Peeters", label: "Sofie's driveway" });

    // Revoking a card forgets its name (data minimization).
    const revoked = await post(`/api/v1/stations/OFFICE_1/owner-tags/${secondTag}/revoke`, {
      confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
    });
    expect(revoked.status).toBe(200);
    const afterRevoke = (await (
      await fetch(`${base}/api/v1/directory`, { headers })
    ).json()) as OwnerDirectory;
    expect(afterRevoke.cards.some(({ tagPseudonym }) => tagPseudonym === secondTag)).toBe(false);
    expect(await readFile(join(root, "directory.json"), "utf8")).not.toContain("Spare");

    // Delegates never reach the directory, and names never reach shareable output.
    const grant = await post("/api/v1/stations/OFFICE_1/delegations", {
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      role: "employer",
    });
    expect(grant.status).toBe(201);
    const { token: delegateToken } = (await grant.json()) as { token: string };
    const delegateHeaders = { authorization: `Bearer ${delegateToken}` };
    expect((await fetch(`${base}/api/v1/directory`, { headers: delegateHeaders })).status).toBe(
      401,
    );
    expect(
      (
        await post(
          "/api/v1/people",
          { name: "Intruder" },
          { ...delegateHeaders, "content-type": "application/json" },
        )
      ).status,
    ).toBe(401);
    const shared = await Promise.all([
      fetch(`${base}/api/v1/delegate/sessions`, { headers: delegateHeaders }).then((r) => r.text()),
      fetch(`${base}/api/v1/stations/OFFICE_1/continuity-export`, { headers }).then((r) =>
        r.text(),
      ),
      fetch(`${base}/api/v1/stations/OFFICE_1/field-pack`, { headers }).then((r) => r.text()),
      fetch(`${base}/api/v1/stations/OFFICE_1/troubleshooting/preview`, { headers }).then((r) =>
        r.text(),
      ),
    ]);
    for (const body of shared) {
      expect(body).not.toContain("Sofie");
      expect(body).not.toContain("Blue fob");
    }
    expect(JSON.stringify(evidence.events)).not.toMatch(/Sofie|Blue fob|Spare/u);

    // Removing the person unassigns the charger and card; charging state is untouched.
    expect((await post(`/api/v1/people/${person.id}/remove`, {})).status).toBe(200);
    const cleared = (await (
      await fetch(`${base}/api/v1/directory`, { headers })
    ).json()) as OwnerDirectory;
    expect(cleared.people).toEqual([{ id: expect.any(String), name: "Alice Peeters" }]);
    expect(cleared.stations[1]!.driverPersonId).toBeNull();
    expect(registries.get("OFFICE_1")?.tags).toContain("office-owner-tag");
  });

  it("refuses edits with 503 while the stored names are unreadable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = await mkdtemp(join(tmpdir(), "chargeos-directory-api-"));
    await writeFile(join(root, "directory.json"), "{damaged", { mode: 0o600 });
    const bootstrap = fleetConfig(root);
    const registries = new Map([
      ["HOME_1", OwnerTagRegistry.memory(new Set(["home-owner-tag"]), HOME_SECRET)],
      ["OFFICE_1", OwnerTagRegistry.memory(new Set(["office-owner-tag"]), OFFICE_SECRET)],
    ]);
    const config = withOwnerTagRegistries(bootstrap, registries);
    const unused = async () => {
      throw new Error("not used");
    };
    const directory = await OwnerDirectoryStore.open(config);
    api = createOwnerApi(
      config,
      {
        async close() {},
        getRuntime: () => ({ connected: false, connectedAt: null }),
        inspectLocalAuthorization: unused,
        listen() {
          throw new Error("not used");
        },
        prepareOwnerContinuity: unused,
        sendStationCommand: unused,
        syncOwnerList: unused,
      },
      new MemoryEvidenceStore(),
      registries,
      fetch,
      directory,
    );
    const base = `http://127.0.0.1:${await api.listen(0, "127.0.0.1")}`;
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const projection = (await (
      await fetch(`${base}/api/v1/directory`, { headers })
    ).json()) as OwnerDirectory;
    expect(projection.writable).toBe(false);
    const response = await fetch(`${base}/api/v1/people`, {
      body: JSON.stringify({ name: "Sofie" }),
      headers,
      method: "POST",
    });
    expect(response.status).toBe(503);
    expect(await readFile(join(root, "directory.json"), "utf8")).toBe("{damaged");
    // Owner cards keep working: adding a card does not depend on the names file.
    const card = await fetch(`${base}/api/v1/stations/HOME_1/owner-tags`, {
      body: JSON.stringify({ tag: "another-home-tag" }),
      headers,
      method: "POST",
    });
    expect(card.status).toBe(201);
  });
});
