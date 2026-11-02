import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  EXPECTED_IDENTITY_MAX_LENGTH,
  isStationOwnership,
  retirementPhrase,
  STATION_ID_PATTERN,
  type AddStationInput,
  type ExpectedChargerIdentity,
  type StationOwnership,
  type StationRegistryProjection,
} from "../shared/stations.js";
import { normalizeDirectoryName } from "../shared/directory.js";
import { configuredStations, type GatewayConfig, type StationConfig } from "./config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";

const REGISTRY_SCHEMA_VERSION = 1 as const;
const MAXIMUM_REGISTRY_BYTES = 1024 * 1024;
const MAXIMUM_STATIONS = 1_000;
export const STATION_REGISTRY_AUDIT = "StationRegistryChanged";
export const STATION_REGISTRY_RECONCILED = "StationRegistryReconciled";

interface StoredAddedStation {
  readonly addedAt: string;
  readonly expected: ExpectedChargerIdentity | null;
  readonly id: string;
  readonly label: string;
  readonly secret: string;
  readonly site: string;
}

interface StoredRegistry {
  readonly added: readonly StoredAddedStation[];
  /** Hardware ownership per charger, for stations-file chargers too. Presentation and planning only. */
  readonly ownership: Readonly<Record<string, StationOwnership>>;
  readonly retired: readonly { readonly id: string; readonly retiredAt: string }[];
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly version: number;
}

export class StationRegistryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationRegistryInputError";
  }
}

export class StationRegistryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationRegistryConflictError";
  }
}

export class StationRegistryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StationRegistryStateError";
  }
}

type Persist = (state: StoredRegistry) => Promise<void>;

/**
 * The live list of provisioned chargers: stations-file chargers that were not retired, followed by
 * chargers added from the console. `stations` is one array mutated in place, so every config that
 * shares it (gateway, API, projections) sees an added or retired charger without a restart.
 *
 * State is persisted before its ledger audit; at start the file must equal the last audited state
 * or be exactly one change ahead of it (a crash between the two writes). Anything older is refused,
 * because it could resurrect a retired charger or forget an added one.
 */
export class StationRegistry {
  readonly stations: StationConfig[];
  readonly #seeded: readonly StationConfig[];
  readonly #persist: Persist;
  #state: StoredRegistry;
  #tail: Promise<void> = Promise.resolve();

  private constructor(seeded: readonly StationConfig[], state: StoredRegistry, persist: Persist) {
    this.#seeded = seeded;
    this.#state = state;
    this.#persist = persist;
    this.stations = [];
    this.#rebuild();
  }

  static async open(
    config: GatewayConfig,
    evidence: EvidenceStore,
    path = stationRegistryPath(config.eventLogPath),
  ): Promise<StationRegistry> {
    const seeded = configuredStations(config);
    const stored = await readRegistry(path);
    const audited = latestAudit(await evidence.readEvents());
    let state = stored ?? emptyState();
    if (!stored && audited) {
      throw new StationRegistryStateError(
        "Console-managed chargers were recorded but managed-stations.json is missing; restore it or recover from a backup",
      );
    }
    validateAgainstSeed(state, seeded);
    const registry = new StationRegistry(seeded, state, (next) => writeRegistry(path, next));
    if (audited) {
      if (
        state.version < audited.version ||
        (state.version === audited.version && digest(state) !== audited.stateSha256)
      ) {
        throw new StationRegistryStateError(
          "managed-stations.json is older than or differs from its last recorded version; restore the latest copy",
        );
      }
      if (state.version === audited.version + 1) {
        await registry.#audit(evidence, config.stationId, STATION_REGISTRY_RECONCILED, {
          action: "reconciled",
        });
      } else if (state.version !== audited.version) {
        throw new StationRegistryStateError(
          "managed-stations.json is more than one change ahead of the ledger; it cannot be trusted",
        );
      }
    }
    state = registry.#state;
    return registry;
  }

  /** Non-persistent registry for tests and embedded use. */
  static memory(config: GatewayConfig): StationRegistry {
    return new StationRegistry(configuredStations(config), emptyState(), async () => {});
  }

  /** Binds the live list into a config; every station resolution then sees changes. */
  bind(config: GatewayConfig): GatewayConfig {
    return { ...config, stations: this.stations };
  }

  /** Replaces one charger's card set reference (after its owner-tag registry was opened). */
  setOwnerTags(stationId: string, ownerTags: ReadonlySet<string>): void {
    const index = this.stations.findIndex(({ id }) => id === stationId);
    if (index >= 0) this.stations[index] = { ...this.stations[index]!, ownerTags };
  }

  /** Retired chargers; their recorded sessions still belong in usage and reimbursement history. */
  get retired(): readonly { readonly id: string; readonly retiredAt: string }[] {
    return this.#state.retired;
  }

  isRetired(stationId: string): boolean {
    return this.#state.retired.some(({ id }) => id === stationId);
  }

  ownership(stationId: string): StationOwnership | null {
    return Object.hasOwn(this.#state.ownership, stationId)
      ? (this.#state.ownership[stationId] ?? null)
      : null;
  }

  expected(stationId: string): ExpectedChargerIdentity | null {
    return this.#state.added.find(({ id }) => id === stationId)?.expected ?? null;
  }

  isManaged(stationId: string): boolean {
    return this.#state.added.some(({ id }) => id === stationId);
  }

  /** `true` once any charger was added, retired or classified from the console. */
  get hasChanges(): boolean {
    return this.#state.version > 0;
  }

  project(config: GatewayConfig): StationRegistryProjection {
    return {
      connectionLimit: config.ocppMaxConnections,
      retired: this.#state.retired.map(({ id, retiredAt }) => ({ id, retiredAt })),
      stations: this.stations.map(({ id }) => {
        const added = this.#state.added.find((station) => station.id === id);
        return {
          addedAt: added?.addedAt ?? null,
          expected: added?.expected ?? null,
          id,
          managed: Boolean(added),
          ownership: this.ownership(id),
        };
      }),
    };
  }

  add(
    evidence: EvidenceStore,
    input: AddStationInput,
  ): Promise<{ readonly secret: string; readonly station: StationConfig }> {
    return this.#serialize(async () => {
      const label = normalizeDirectoryName(input.label, "label");
      const site = normalizeDirectoryName(input.site, "site");
      if (!isStationOwnership(input.ownership)) {
        throw new StationRegistryInputError("ownership must be company or employee");
      }
      const expected = expectedIdentity(input.expected);
      const id = input.id === null ? this.#generateId() : stationId(input.id);
      // A name with any ledger history is never reused: old evidence, cards and employee links
      // recorded under it must not attach to a different charger.
      const used =
        this.#knownIds().has(id.toLowerCase()) ||
        (await evidence.readEvents()).some(
          (event) => event.stationId.toLowerCase() === id.toLowerCase(),
        );
      if (used) {
        throw new StationRegistryConflictError(
          "That charger name is already used, or was used by a retired charger",
        );
      }
      if (this.stations.length >= MAXIMUM_STATIONS) {
        throw new StationRegistryConflictError("This server already has 1000 chargers");
      }
      // 20 random bytes as 40 hexadecimal digits: the OCPP 1.6 security whitepaper's
      // AuthorizationKey format, so conforming chargers can store it.
      const secret = randomBytes(20).toString("hex");
      const station: StoredAddedStation = {
        addedAt: new Date().toISOString(),
        expected,
        id,
        label,
        secret,
        site,
      };
      await this.#commit(
        evidence,
        id,
        {
          ...this.#state,
          added: [...this.#state.added, station],
          ownership: { ...this.#state.ownership, [id]: input.ownership },
          version: this.#state.version + 1,
        },
        { action: "added", ownership: input.ownership, ...(expected ? { expected } : {}) },
      );
      return { secret, station: this.stations.find((candidate) => candidate.id === id)! };
    });
  }

  /**
   * Gives an added charger a new password. Allowed only before it has ever connected and while it
   * has no cards, because card references and evidence integrity are derived from the password.
   */
  reissueSecret(
    evidence: EvidenceStore,
    stationIdValue: string,
    hasHistory: boolean,
  ): Promise<{ readonly secret: string; readonly station: StationConfig }> {
    return this.#serialize(async () => {
      const index = this.#state.added.findIndex(({ id }) => id === stationIdValue);
      if (index < 0) {
        throw new StationRegistryConflictError(
          "Only chargers added from the console can get a new password here",
        );
      }
      if (hasHistory) {
        throw new StationRegistryConflictError(
          "This charger has already connected or has cards; its password can no longer be replaced here",
        );
      }
      const secret = randomBytes(20).toString("hex");
      const added = [...this.#state.added];
      added[index] = { ...added[index]!, secret };
      await this.#commit(
        evidence,
        stationIdValue,
        { ...this.#state, added, version: this.#state.version + 1 },
        { action: "password-reissued" },
      );
      return { secret, station: this.stations.find(({ id }) => id === stationIdValue)! };
    });
  }

  setOwnership(
    evidence: EvidenceStore,
    stationIdValue: string,
    ownership: StationOwnership,
  ): Promise<void> {
    return this.#serialize(async () => {
      if (!isStationOwnership(ownership)) {
        throw new StationRegistryInputError("ownership must be company or employee");
      }
      if (!this.stations.some(({ id }) => id === stationIdValue)) {
        throw new StationRegistryConflictError("Unknown charge point");
      }
      if (this.ownership(stationIdValue) === ownership) return;
      await this.#commit(
        evidence,
        stationIdValue,
        {
          ...this.#state,
          ownership: { ...this.#state.ownership, [stationIdValue]: ownership },
          version: this.#state.version + 1,
        },
        { action: "ownership", ownership },
      );
    });
  }

  /**
   * Retires a charger: it can no longer connect, its name is never reused, and its history stays
   * in the ledger. The first configured charger anchors legacy routes and cannot be retired.
   */
  retire(
    config: GatewayConfig,
    evidence: EvidenceStore,
    stationIdValue: string,
    confirmation: unknown,
  ): Promise<void> {
    return this.#serialize(async () => {
      if (confirmation !== retirementPhrase(stationIdValue)) {
        throw new StationRegistryInputError(
          `confirmation must be exactly ${retirementPhrase(stationIdValue)}`,
        );
      }
      if (stationIdValue === config.stationId) {
        throw new StationRegistryConflictError(
          "The first charger of this server cannot be retired",
        );
      }
      if (!this.stations.some(({ id }) => id === stationIdValue)) {
        throw new StationRegistryConflictError("Unknown charge point");
      }
      await this.#commit(
        evidence,
        stationIdValue,
        {
          ...this.#state,
          retired: [
            ...this.#state.retired,
            { id: stationIdValue, retiredAt: new Date().toISOString() },
          ],
          version: this.#state.version + 1,
        },
        { action: "retired" },
      );
    });
  }

  async #commit(
    evidence: EvidenceStore,
    stationIdValue: string,
    next: StoredRegistry,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const previous = this.#state;
    await this.#persist(next);
    this.#state = next;
    try {
      await this.#audit(evidence, stationIdValue, STATION_REGISTRY_AUDIT, detail);
    } catch (auditError) {
      try {
        await this.#persist(previous);
        this.#state = previous;
      } catch (rollbackError) {
        throw new AggregateError(
          [auditError, rollbackError],
          "Charger registry persisted but its audit and rollback failed; restart is required",
        );
      }
      throw auditError;
    }
    this.#rebuild();
  }

  async #audit(
    evidence: EvidenceStore,
    stationIdValue: string,
    message: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    // Never the password: only a digest of the whole state, so a rollback is detectable.
    await evidence.append(
      evidenceEvent(stationIdValue, "system", message, {
        ...detail,
        registryVersion: this.#state.version,
        stateSha256: digest(this.#state),
      }),
    );
  }

  #rebuild(): void {
    const retired = new Set(this.#state.retired.map(({ id }) => id));
    const previous = new Map(this.stations.map((station) => [station.id, station]));
    const next: StationConfig[] = [
      ...this.#seeded.filter(({ id }) => !retired.has(id)),
      ...this.#state.added
        .filter(({ id }) => !retired.has(id))
        .map((station): StationConfig => ({
          id: station.id,
          label: station.label,
          // A live card set is attached by setOwnerTags once its registry is open.
          ownerTags: new Set<string>(),
          secret: station.secret,
          site: station.site,
        })),
    ].map((station) => {
      const existing = previous.get(station.id);
      // Keep the live card set; a reissued password replaces the secret.
      return existing ? { ...station, ownerTags: existing.ownerTags } : station;
    });
    this.stations.splice(0, this.stations.length, ...next);
  }

  #knownIds(): Set<string> {
    return new Set(
      [
        ...this.#seeded.map(({ id }) => id),
        ...this.#state.added.map(({ id }) => id),
        ...this.#state.retired.map(({ id }) => id),
      ].map((id) => id.toLowerCase()),
    );
  }

  #generateId(): string {
    const known = this.#knownIds();
    for (;;) {
      const candidate = `cos-${randomBytes(4).toString("hex")}`;
      if (!known.has(candidate)) return candidate;
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function stationRegistryPath(eventLogPath: string): string {
  return join(dirname(eventLogPath), "managed-stations.json");
}

/** `true` when the ledger shows chargers were added, retired or classified from the console. */
export function hasStationRegistryHistory(events: readonly EvidenceEvent[]): boolean {
  return events.some(
    ({ message }) => message === STATION_REGISTRY_AUDIT || message === STATION_REGISTRY_RECONCILED,
  );
}

function latestAudit(
  events: readonly EvidenceEvent[],
): { readonly stateSha256: string; readonly version: number } | null {
  const event = events.findLast(
    ({ message }) => message === STATION_REGISTRY_AUDIT || message === STATION_REGISTRY_RECONCILED,
  );
  if (!event) return null;
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : {};
  if (
    typeof payload.registryVersion !== "number" ||
    !Number.isSafeInteger(payload.registryVersion) ||
    typeof payload.stateSha256 !== "string"
  ) {
    throw new StationRegistryStateError("The ledger's charger registry audit is malformed");
  }
  return { stateSha256: payload.stateSha256, version: payload.registryVersion };
}

function validateAgainstSeed(state: StoredRegistry, seeded: readonly StationConfig[]): void {
  const seededIds = new Set(seeded.map(({ id }) => id.toLowerCase()));
  const secrets = new Set(seeded.map(({ secret }) => secret));
  for (const station of state.added) {
    if (seededIds.has(station.id.toLowerCase())) {
      throw new StationRegistryStateError(
        `Charger ${station.id} is in both the stations file and managed-stations.json`,
      );
    }
    if (secrets.has(station.secret)) {
      throw new StationRegistryStateError("Every charger password must be unique");
    }
    secrets.add(station.secret);
  }
  const retired = new Set(state.retired.map(({ id }) => id));
  if (seeded[0] && retired.has(seeded[0].id)) {
    throw new StationRegistryStateError("The first charger of this server cannot be retired");
  }
}

function emptyState(): StoredRegistry {
  return {
    added: [],
    ownership: {},
    retired: [],
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    version: 0,
  };
}

function canonical(state: StoredRegistry): string {
  return JSON.stringify({
    added: state.added.map((station) => ({
      addedAt: station.addedAt,
      expected: station.expected,
      id: station.id,
      label: station.label,
      secret: station.secret,
      site: station.site,
    })),
    ownership: Object.fromEntries(
      Object.entries(state.ownership).sort(([left], [right]) => left.localeCompare(right)),
    ),
    retired: state.retired.map(({ id, retiredAt }) => ({ id, retiredAt })),
    schemaVersion: state.schemaVersion,
    version: state.version,
  });
}

function digest(state: StoredRegistry): string {
  return createHash("sha256").update(canonical(state), "utf8").digest("hex");
}

function stationId(value: unknown): string {
  if (typeof value !== "string" || !STATION_ID_PATTERN.test(value)) {
    throw new StationRegistryInputError(
      "Charger name must be 1-64 letters, digits, dots, dashes or underscores",
    );
  }
  return value;
}

function expectedIdentity(value: unknown): ExpectedChargerIdentity | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StationRegistryInputError("expected must contain vendor, model and firmwareVersion");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "firmwareVersion,model,vendor") {
    throw new StationRegistryInputError("expected must contain vendor, model and firmwareVersion");
  }
  const text = (field: string, input: unknown): string => {
    if (
      typeof input !== "string" ||
      !input.trim() ||
      input.trim() !== input ||
      input.length > EXPECTED_IDENTITY_MAX_LENGTH ||
      /[\p{Cc}\p{Cf}]/u.test(input)
    ) {
      throw new StationRegistryInputError(
        `expected ${field} must be 1-${EXPECTED_IDENTITY_MAX_LENGTH} printable characters`,
      );
    }
    return input;
  };
  return {
    firmwareVersion:
      record.firmwareVersion === null ? null : text("firmware", record.firmwareVersion),
    model: text("model", record.model),
    vendor: text("vendor", record.vendor),
  };
}

async function readRegistry(path: string): Promise<StoredRegistry | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StationRegistryStateError("managed-stations.json cannot be inspected");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new StationRegistryStateError(
      "managed-stations.json must be a regular, non-symlinked file",
    );
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new StationRegistryStateError(
      "managed-stations.json must not be accessible by group or other users",
    );
  }
  if (metadata.size > MAXIMUM_REGISTRY_BYTES) {
    throw new StationRegistryStateError("managed-stations.json exceeds its size limit");
  }
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new StationRegistryStateError("managed-stations.json changed while it was opened");
    }
    return parseRegistry(JSON.parse(await file.readFile("utf8")) as unknown);
  } catch (error) {
    if (error instanceof StationRegistryStateError) throw error;
    throw new StationRegistryStateError("managed-stations.json is malformed or unreadable");
  } finally {
    await file?.close();
  }
}

function parseRegistry(value: unknown): StoredRegistry {
  const fail = () => new StationRegistryStateError("managed-stations.json schema is invalid");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "added,ownership,retired,schemaVersion,version" ||
    record.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    typeof record.version !== "number" ||
    !Number.isSafeInteger(record.version) ||
    record.version < 0 ||
    !Array.isArray(record.added) ||
    !Array.isArray(record.retired) ||
    !record.ownership ||
    typeof record.ownership !== "object" ||
    Array.isArray(record.ownership)
  ) {
    throw fail();
  }
  const ids = new Set<string>();
  const added = record.added.map((candidate): StoredAddedStation => {
    if (!candidate || typeof candidate !== "object") throw fail();
    const station = candidate as Record<string, unknown>;
    if (
      Object.keys(station).sort().join(",") !== "addedAt,expected,id,label,secret,site" ||
      typeof station.addedAt !== "string" ||
      typeof station.secret !== "string" ||
      !/^[0-9a-f]{40}$/u.test(station.secret)
    ) {
      throw fail();
    }
    const id = stationId(station.id);
    if (ids.has(id.toLowerCase())) throw fail();
    ids.add(id.toLowerCase());
    return {
      addedAt: station.addedAt,
      expected: expectedIdentity(station.expected),
      id,
      label: normalizeDirectoryName(station.label, "label"),
      secret: station.secret,
      site: normalizeDirectoryName(station.site, "site"),
    };
  });
  const retired = record.retired.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw fail();
    const entry = candidate as Record<string, unknown>;
    if (
      Object.keys(entry).sort().join(",") !== "id,retiredAt" ||
      typeof entry.id !== "string" ||
      typeof entry.retiredAt !== "string"
    ) {
      throw fail();
    }
    return { id: entry.id, retiredAt: entry.retiredAt };
  });
  const ownership: Record<string, StationOwnership> = {};
  for (const [id, kind] of Object.entries(record.ownership as Record<string, unknown>)) {
    if (!isStationOwnership(kind)) throw fail();
    ownership[id] = kind;
  }
  return {
    added,
    ownership,
    retired,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    version: record.version,
  };
}

async function writeRegistry(path: string, state: StoredRegistry): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${canonical(state)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    await rename(temporaryPath, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
