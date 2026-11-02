import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  DIRECTORY_MAX_PEOPLE,
  DirectoryInputError,
  normalizeDirectoryName,
  PERSON_ID_PATTERN,
  TAG_PSEUDONYM_PATTERN,
  type CardProfileInput,
  type DirectoryPerson,
  type OwnerDirectory,
  type PersonInput,
  type StationProfileInput,
} from "../shared/directory.js";
import { configuredStations, type GatewayConfig } from "./config.js";
import { pseudonymizeTag } from "./tag.js";

const DIRECTORY_SCHEMA_VERSION = 1 as const;
const MAXIMUM_DIRECTORY_BYTES = 1024 * 1024;

interface StoredStation {
  driverPersonId: string | null;
  label: string;
  site: string;
}

interface StoredCard {
  holderPersonId: string | null;
  name: string | null;
}

interface StoredDirectory {
  /** stationId -> tagPseudonym -> names. Maps keep station IDs away from object prototypes. */
  cards: Map<string, Map<string, StoredCard>>;
  people: DirectoryPerson[];
  stations: Map<string, StoredStation>;
}

/** Names shown for one station; `driver` is the resolved person name. */
export interface StationNames {
  readonly driver: string | null;
  readonly label: string;
  readonly site: string;
}

export type StationNameLookup = (stationId: string) => StationNames | undefined;

export class DirectoryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryNotFoundError";
  }
}

export class DirectoryUnavailableError extends Error {
  constructor(
    message = "Stored names could not be read; fix or remove directory.json and restart chargeOS",
  ) {
    super(message);
    this.name = "DirectoryUnavailableError";
  }
}

type Persist = (state: StoredDirectory) => Promise<void>;

/**
 * Owner-private display names for chargers, people and cards, persisted beside the ledger.
 *
 * A damaged or unreadable file never stops charging or the console: the store falls back to the
 * configured station names in memory and refuses edits, so the damaged file is not overwritten.
 */
export class OwnerDirectoryStore {
  #state: StoredDirectory;
  readonly #persist: Persist | null;
  #tail: Promise<void> = Promise.resolve();

  private constructor(state: StoredDirectory, persist: Persist | null) {
    this.#state = state;
    this.#persist = persist;
  }

  static async open(
    config: GatewayConfig,
    path = directoryStatePath(config.eventLogPath),
  ): Promise<OwnerDirectoryStore> {
    await removeAbandonedTemporaryFiles(path);
    let stored: StoredDirectory | null;
    try {
      stored = await readDirectory(path);
    } catch {
      // Closed message only: the file holds personal names and must never reach logs.
      console.warn(
        "Owner directory unavailable; names are read-only until directory.json is fixed",
      );
      return new OwnerDirectoryStore(seed(emptyState(), config).state, null);
    }
    const persist: Persist = (state) => writeDirectory(path, state);
    const seeded = seed(stored ?? emptyState(), config);
    const state = seeded.state;
    const pruned = pruneCards(state, config);
    if (seeded.changed || pruned || !stored) {
      try {
        await persist(state);
      } catch {
        // Names are presentation only; they must never stop the edge from starting.
        console.warn("Owner directory could not be saved; names are read-only for this run");
        return new OwnerDirectoryStore(state, null);
      }
    }
    return new OwnerDirectoryStore(state, persist);
  }

  /** Non-persistent store for tests and embedded use. */
  static memory(config: GatewayConfig): OwnerDirectoryStore {
    return new OwnerDirectoryStore(seed(emptyState(), config).state, async () => {});
  }

  get writable(): boolean {
    return this.#persist !== null;
  }

  /** Names for owner-only projections. Never pass this to delegate, export or AI projections. */
  stationNames(config: GatewayConfig): StationNameLookup {
    const state = this.#state;
    const configured = new Map(configuredStations(config).map((station) => [station.id, station]));
    return (stationId) => {
      if (!configured.has(stationId)) return undefined;
      const entry = state.stations.get(stationId);
      if (!entry) return undefined;
      return {
        driver: personName(state, entry.driverPersonId),
        label: entry.label,
        site: entry.site,
      };
    };
  }

  project(config: GatewayConfig): OwnerDirectory {
    const state = this.#state;
    const stations = configuredStations(config);
    return {
      cards: stations.flatMap((station) =>
        [...station.ownerTags]
          .map((tag) => `tag_${pseudonymizeTag(tag, station.secret)}`)
          .sort()
          .map((tagPseudonym) => {
            const card = state.cards.get(station.id)?.get(tagPseudonym);
            return {
              holderPersonId: card?.holderPersonId ?? null,
              name: card?.name ?? null,
              stationId: station.id,
              tagPseudonym,
            };
          }),
      ),
      people: [...state.people].sort((left, right) => left.name.localeCompare(right.name)),
      stations: stations.map((station) => {
        const entry = state.stations.get(station.id);
        return {
          driverPersonId: entry?.driverPersonId ?? null,
          id: station.id,
          label: entry?.label ?? station.label,
          site: entry?.site ?? station.site,
        };
      }),
      writable: this.writable,
    };
  }

  updateStation(stationId: string, input: StationProfileInput): Promise<void> {
    return this.#mutate((state) => {
      const label = normalizeDirectoryName(input.label, "label");
      const site = normalizeDirectoryName(input.site, "site");
      const driverPersonId = optionalPerson(state, input.driverPersonId);
      state.stations.set(stationId, { driverPersonId, label, site });
    });
  }

  addPerson(input: PersonInput): Promise<DirectoryPerson> {
    return this.#mutate((state) => {
      const name = normalizeDirectoryName(input.name);
      if (state.people.length >= DIRECTORY_MAX_PEOPLE) {
        throw new DirectoryInputError(`At most ${DIRECTORY_MAX_PEOPLE} people can be named`);
      }
      const person = { id: `person_${randomBytes(12).toString("hex")}`, name };
      state.people.push(person);
      return person;
    });
  }

  renamePerson(personId: string, input: PersonInput): Promise<DirectoryPerson> {
    return this.#mutate((state) => {
      const name = normalizeDirectoryName(input.name);
      const index = state.people.findIndex(({ id }) => id === personId);
      if (index < 0) throw new DirectoryNotFoundError("Person not found");
      const person = { id: personId, name };
      state.people[index] = person;
      return person;
    });
  }

  /** Removes a person and clears every station and card assignment that pointed at them. */
  removePerson(personId: string): Promise<void> {
    return this.#mutate((state) => {
      const index = state.people.findIndex(({ id }) => id === personId);
      if (index < 0) throw new DirectoryNotFoundError("Person not found");
      state.people.splice(index, 1);
      for (const station of state.stations.values()) {
        if (station.driverPersonId === personId) station.driverPersonId = null;
      }
      for (const cards of state.cards.values()) {
        for (const card of cards.values()) {
          if (card.holderPersonId === personId) card.holderPersonId = null;
        }
      }
    });
  }

  /** Names a card already in the station's desired owner-card set. */
  updateCard(config: GatewayConfig, tagPseudonym: string, input: CardProfileInput): Promise<void> {
    return this.#mutate((state) => {
      if (!TAG_PSEUDONYM_PATTERN.test(tagPseudonym) || !hasDesiredCard(config, tagPseudonym)) {
        throw new DirectoryNotFoundError("Card is not an owner card of this charger");
      }
      const name = input.name === null ? null : normalizeDirectoryName(input.name);
      const holderPersonId = optionalPerson(state, input.holderPersonId);
      const cards = state.cards.get(config.stationId) ?? new Map<string, StoredCard>();
      if (name === null && holderPersonId === null) cards.delete(tagPseudonym);
      else cards.set(tagPseudonym, { holderPersonId, name });
      if (cards.size === 0) state.cards.delete(config.stationId);
      else state.cards.set(config.stationId, cards);
    });
  }

  /**
   * Drops names of cards no longer in their charger's desired set, including letter-case variants
   * removed together, and of chargers no longer configured (data minimization). Runs inside the
   * write queue so a naming request that was already admitted cannot commit a revoked card's name.
   */
  forgetRevokedCards(config: GatewayConfig): Promise<boolean> {
    if (!this.writable) return Promise.resolve(false);
    return this.#mutate((state) => pruneCards(state, config), { skipUnchanged: true });
  }

  /** A newly desired card starts unnamed, even if the same card was named before it was revoked. */
  forgetAddedCard(config: GatewayConfig, tagPseudonym: string): Promise<boolean> {
    if (!this.writable) return Promise.resolve(false);
    return this.#mutate(
      (state) => {
        const cards = state.cards.get(config.stationId);
        const removed = cards?.delete(tagPseudonym) ?? false;
        if (cards?.size === 0) state.cards.delete(config.stationId);
        return pruneCards(state, config) || removed;
      },
      { skipUnchanged: true },
    );
  }

  #mutate<T>(
    change: (state: StoredDirectory) => T,
    options: { readonly skipUnchanged?: boolean } = {},
  ): Promise<T> {
    const result = this.#tail.then(async () => {
      if (!this.#persist) throw new DirectoryUnavailableError();
      const next = structuredClone(this.#state);
      const value = change(next);
      if (options.skipUnchanged && value === false) return value;
      // Never write a file that the next start would refuse to read.
      if (Buffer.byteLength(serializeDirectory(next)) + 1 > MAXIMUM_DIRECTORY_BYTES) {
        throw new DirectoryInputError("Too many names are saved; remove some before adding more");
      }
      try {
        await this.#persist(next);
      } catch {
        throw new DirectoryUnavailableError("Names could not be saved; check the data volume");
      }
      this.#state = next;
      return value;
    });
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function directoryStatePath(eventLogPath: string): string {
  return join(dirname(eventLogPath), "directory.json");
}

function hasDesiredCard(config: GatewayConfig, tagPseudonym: string): boolean {
  for (const tag of config.ownerTags) {
    if (`tag_${pseudonymizeTag(tag, config.stationSecret)}` === tagPseudonym) return true;
  }
  return false;
}

/** Removes names for unconfigured chargers and for cards outside each charger's desired set. */
function pruneCards(state: StoredDirectory, config: GatewayConfig): boolean {
  const stations = new Map(configuredStations(config).map((station) => [station.id, station]));
  let changed = false;
  // Deleting the current entry while iterating a Map is well defined.
  for (const stationId of state.stations.keys()) {
    if (!stations.has(stationId)) {
      state.stations.delete(stationId);
      changed = true;
    }
  }
  for (const [stationId, cards] of state.cards) {
    const station = stations.get(stationId);
    const desired = new Set(
      station
        ? [...station.ownerTags].map((tag) => `tag_${pseudonymizeTag(tag, station.secret)}`)
        : [],
    );
    for (const tagPseudonym of cards.keys()) {
      if (!desired.has(tagPseudonym)) {
        cards.delete(tagPseudonym);
        changed = true;
      }
    }
    if (cards.size === 0) state.cards.delete(stationId);
  }
  return changed;
}

function optionalPerson(state: StoredDirectory, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !PERSON_ID_PATTERN.test(value)) {
    throw new DirectoryInputError("person must be a person id or null");
  }
  if (!state.people.some(({ id }) => id === value)) {
    throw new DirectoryNotFoundError("Person not found");
  }
  return value;
}

function personName(state: StoredDirectory, personId: string | null): string | null {
  if (personId === null) return null;
  return state.people.find(({ id }) => id === personId)?.name ?? null;
}

function emptyState(): StoredDirectory {
  return { cards: new Map(), people: [], stations: new Map() };
}

/**
 * Adds an entry for every configured station that has none yet, carrying its configured label,
 * site and driver. Once a station has an entry, names edited in the console take precedence.
 */
function seed(
  input: StoredDirectory,
  config: GatewayConfig,
): { changed: boolean; state: StoredDirectory } {
  const state = structuredClone(input);
  let changed = false;
  for (const station of configuredStations(config)) {
    if (state.stations.has(station.id)) continue;
    let driverPersonId: string | null = null;
    if (station.driver) {
      let name: string | null;
      try {
        name = normalizeDirectoryName(station.driver);
      } catch {
        name = null;
      }
      if (name !== null) {
        const existing = state.people.find((person) => person.name === name);
        if (existing) driverPersonId = existing.id;
        else if (state.people.length < DIRECTORY_MAX_PEOPLE) {
          driverPersonId = `person_${randomBytes(12).toString("hex")}`;
          state.people.push({ id: driverPersonId, name });
        }
      }
    }
    state.stations.set(station.id, {
      driverPersonId,
      label: safeName(station.label, station.id),
      site: safeName(station.site, "Primary site"),
    });
    changed = true;
  }
  return { changed, state };
}

function safeName(value: string, fallback: string): string {
  try {
    return normalizeDirectoryName(value);
  } catch {
    return fallback.slice(0, 80);
  }
}

async function readDirectory(path: string): Promise<StoredDirectory | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("directory must be a regular file");
  }
  if ((metadata.mode & 0o077) !== 0) throw new Error("directory must be owner-only");
  if (metadata.size > MAXIMUM_DIRECTORY_BYTES) throw new Error("directory is too large");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new Error("directory changed while opening");
    }
    return parseDirectory(JSON.parse(await file.readFile("utf8")) as unknown);
  } finally {
    await file.close();
  }
}

/** File format: arrays of records, so no stored key is ever used as an object property. */
function parseDirectory(value: unknown): StoredDirectory {
  const record = plainObject(value, ["cards", "people", "schemaVersion", "stations"]);
  if (
    record.schemaVersion !== DIRECTORY_SCHEMA_VERSION ||
    !Array.isArray(record.people) ||
    !Array.isArray(record.stations) ||
    !Array.isArray(record.cards)
  ) {
    throw new Error("directory schema is invalid");
  }
  if (record.people.length > DIRECTORY_MAX_PEOPLE) throw new Error("too many people");
  const people = record.people.map((entry: unknown) => {
    const person = plainObject(entry, ["id", "name"]);
    if (typeof person.id !== "string" || !PERSON_ID_PATTERN.test(person.id)) {
      throw new Error("person id is invalid");
    }
    return { id: person.id, name: normalizeDirectoryName(person.name) };
  });
  const personIds = new Set(people.map(({ id }) => id));
  if (personIds.size !== people.length) throw new Error("duplicate person id");
  const reference = (candidate: unknown): string | null => {
    if (candidate === null) return null;
    if (typeof candidate !== "string" || !personIds.has(candidate)) {
      throw new Error("unknown person reference");
    }
    return candidate;
  };
  const stations = new Map<string, StoredStation>();
  for (const entry of record.stations as unknown[]) {
    const station = plainObject(entry, ["driverPersonId", "id", "label", "site"]);
    if (typeof station.id !== "string" || station.id.length < 1 || station.id.length > 128) {
      throw new Error("station id is invalid");
    }
    if (stations.has(station.id)) throw new Error("duplicate station");
    stations.set(station.id, {
      driverPersonId: reference(station.driverPersonId),
      label: normalizeDirectoryName(station.label),
      site: normalizeDirectoryName(station.site),
    });
  }
  const cards = new Map<string, Map<string, StoredCard>>();
  for (const entry of record.cards as unknown[]) {
    const card = plainObject(entry, ["holderPersonId", "name", "stationId", "tagPseudonym"]);
    if (
      typeof card.stationId !== "string" ||
      card.stationId.length < 1 ||
      card.stationId.length > 128 ||
      typeof card.tagPseudonym !== "string" ||
      !TAG_PSEUDONYM_PATTERN.test(card.tagPseudonym)
    ) {
      throw new Error("card key is invalid");
    }
    const stationCards = cards.get(card.stationId) ?? new Map<string, StoredCard>();
    if (stationCards.has(card.tagPseudonym)) throw new Error("duplicate card");
    stationCards.set(card.tagPseudonym, {
      holderPersonId: reference(card.holderPersonId),
      name: card.name === null ? null : normalizeDirectoryName(card.name),
    });
    cards.set(card.stationId, stationCards);
  }
  return { cards, people, stations };
}

function serializeDirectory(state: StoredDirectory): string {
  return JSON.stringify({
    cards: [...state.cards].flatMap(([stationId, stationCards]) =>
      [...stationCards].map(([tagPseudonym, card]) => ({
        holderPersonId: card.holderPersonId,
        name: card.name,
        stationId,
        tagPseudonym,
      })),
    ),
    people: state.people,
    schemaVersion: DIRECTORY_SCHEMA_VERSION,
    stations: [...state.stations].map(([id, station]) => ({ id, ...station })),
  });
}

function plainObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(",")) {
    throw new Error("unexpected fields");
  }
  return record;
}

async function writeDirectory(path: string, state: StoredDirectory): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new DirectoryUnavailableError();
  }
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${serializeDirectory(state)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  // The rename is the commit point: once it succeeds the new names are what the next start reads,
  // so a failed directory fsync must not make memory and disk disagree.
  try {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    console.warn("Owner directory saved, but its folder could not be flushed to disk");
  }
}

/** A crash between writing and renaming leaves a private temporary copy of personal names. */
async function removeAbandonedTemporaryFiles(path: string): Promise<void> {
  const prefix = `${basename(path)}.tmp-`;
  let entries: string[];
  try {
    entries = await readdir(dirname(path));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !/^[0-9a-f-]{36}$/u.test(entry.slice(prefix.length))) {
      continue;
    }
    const candidate = join(dirname(path), entry);
    try {
      const metadata = await lstat(candidate);
      if (metadata.isFile() && !metadata.isSymbolicLink()) await unlink(candidate);
    } catch {
      // Best effort; a leftover file is owner-only and never read.
    }
  }
}
