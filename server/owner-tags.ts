import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  OWNER_TAG_REVOCATION_CONFIRMATION,
  type OwnerTagMutationResult,
  type OwnerTagRevokeInput,
} from "../shared/owner-tags.js";
import {
  configForStation,
  configuredStations,
  type GatewayConfig,
  type StationConfig,
} from "./config.js";
import { evidenceEvent, type EvidenceEvent, type EvidenceStore } from "./events.js";
import { foldIdTag, pseudonymizeTag } from "./tag.js";

const OWNER_TAG_STATE_SCHEMA_VERSION = 1 as const;
const MAXIMUM_OWNER_TAGS = 10_000;
const MAXIMUM_STATE_BYTES = 512 * 1024;

interface StoredOwnerTagState {
  readonly integrityHmac: string;
  readonly schemaVersion: typeof OWNER_TAG_STATE_SCHEMA_VERSION;
  readonly tags: readonly string[];
  readonly version: number;
}

interface OwnerTagAuditPayload {
  readonly action: "added" | "removed" | "reconciled";
  readonly desiredCount: number;
  readonly stateHmac: string;
  readonly stateVersion: number;
  readonly tagPseudonym?: string;
}

type PersistState = (state: StoredOwnerTagState) => Promise<void>;

export class OwnerTagInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerTagInputError";
  }
}

export class OwnerTagConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerTagConflictError";
  }
}

export class OwnerTagStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerTagStateError";
  }
}

export class OwnerTagRegistry {
  readonly #persist: PersistState;
  readonly #stationSecret: string;
  readonly #tags: Set<string>;
  #tail: Promise<void> = Promise.resolve();
  #version: number;

  private constructor(
    tags: readonly string[],
    version: number,
    stationSecret: string,
    persist: PersistState,
  ) {
    this.#tags = new Set(tags);
    this.#version = version;
    this.#stationSecret = stationSecret;
    this.#persist = persist;
  }

  static async open(
    config: GatewayConfig,
    path = ownerTagStatePath(config.eventLogPath),
  ): Promise<OwnerTagRegistry> {
    const persist = (state: StoredOwnerTagState) => writeOwnerTagState(path, state);
    const existing = await readOwnerTagState(path, config.stationSecret);
    if (existing) {
      return new OwnerTagRegistry(existing.tags, existing.version, config.stationSecret, persist);
    }
    const initial = createState([...config.ownerTags], 1, config.stationSecret);
    try {
      await createOwnerTagState(path, initial);
      return new OwnerTagRegistry(initial.tags, initial.version, config.stationSecret, persist);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raced = await readOwnerTagState(path, config.stationSecret);
      if (!raced) throw new OwnerTagStateError("Owner tag state could not be initialized");
      return new OwnerTagRegistry(raced.tags, raced.version, config.stationSecret, persist);
    }
  }

  static memory(tags: ReadonlySet<string>, stationSecret: string): OwnerTagRegistry {
    const initial = createState([...tags], 1, stationSecret);
    return new OwnerTagRegistry(initial.tags, initial.version, stationSecret, async () => {});
  }

  get tags(): ReadonlySet<string> {
    return this.#tags;
  }

  get version(): number {
    return this.#version;
  }

  async add(
    config: GatewayConfig,
    evidence: EvidenceStore,
    value: unknown,
  ): Promise<OwnerTagMutationResult> {
    const tag = ownerTag(value);
    return this.#mutate(config, evidence, "added", tag);
  }

  async revoke(
    config: GatewayConfig,
    evidence: EvidenceStore,
    tagPseudonym: string,
    input: OwnerTagRevokeInput,
  ): Promise<OwnerTagMutationResult> {
    if (input.confirmation !== OWNER_TAG_REVOCATION_CONFIRMATION) {
      throw new OwnerTagInputError(
        "confirmation must exactly acknowledge delayed charger-local revocation",
      );
    }
    if (!/^tag_[a-f0-9]{24}$/u.test(tagPseudonym)) {
      throw new OwnerTagInputError("tagPseudonym is invalid");
    }
    const tag = [...this.#tags].find(
      (candidate) => `tag_${pseudonymizeTag(candidate, this.#stationSecret)}` === tagPseudonym,
    );
    if (!tag) throw new OwnerTagConflictError("Owner tag is not in desired state");
    return this.#mutate(config, evidence, "removed", tag);
  }

  async reconcile(config: GatewayConfig, evidence: EvidenceStore): Promise<void> {
    const events = (await evidence.readEvents()).filter(
      (event) => event.stationId === config.stationId,
    );
    const latest = events.findLast(
      (event) =>
        event.message === "OwnerTagDesiredStateChanged" ||
        event.message === "OwnerTagDesiredStateReconciled",
    );
    const payload = payloadRecord(latest);
    let current = createState([...this.#tags], this.#version, this.#stationSecret);
    if (payload.stateVersion === current.version && payload.stateHmac === current.integrityHmac) {
      return;
    }
    const audited =
      typeof payload.stateVersion === "number" && Number.isSafeInteger(payload.stateVersion)
        ? payload.stateVersion
        : null;
    if (audited !== null && current.version <= audited) {
      // Persist-then-audit means a crash can only leave the file ahead of the ledger. State at or
      // below the audited version is accepted only when it is exactly the last audited desired
      // set: a continuity restore or an interrupted first reconcile. Anything else (an earlier
      // backup, the original first-boot file, or a stale deployment seed after deletion) could
      // silently re-desire revoked tags, so refuse it.
      const asAudited = createState([...this.#tags], audited, this.#stationSecret);
      if (asAudited.integrityHmac !== payload.stateHmac) {
        throw new OwnerTagStateError(
          `Owner tag state for ${config.stationId} is older than or differs from its last audited version; restore the latest owner-tag state or recover from a continuity bundle`,
        );
      }
      // Continue the version sequence so no older state file can later look newer.
      current = createState([...this.#tags], audited + 1, this.#stationSecret);
      await this.#persist(current);
      this.#apply(current);
    }
    await appendAudit(config, evidence, "OwnerTagDesiredStateReconciled", {
      action: "reconciled",
      desiredCount: current.tags.length,
      stateHmac: current.integrityHmac,
      stateVersion: current.version,
    });
  }

  #mutate(
    config: GatewayConfig,
    evidence: EvidenceStore,
    action: "added" | "removed",
    tag: string,
  ): Promise<OwnerTagMutationResult> {
    return this.#serialize(async () => {
      if (action === "added" && this.#tags.has(tag)) {
        throw new OwnerTagConflictError("Owner tag is already in desired state");
      }
      if (
        action === "added" &&
        [...this.#tags].some((existing) => foldIdTag(existing) === foldIdTag(tag))
      ) {
        throw new OwnerTagConflictError(
          "Owner tag differs only in letter case from a desired tag; OCPP compares tags case-insensitively",
        );
      }
      if (action === "removed" && !this.#tags.has(tag)) {
        throw new OwnerTagConflictError("Owner tag is not in desired state");
      }
      // Online authorization folds letter case, so revoking a tag must also revoke any legacy
      // case variant that was seeded or restored before variants were refused on add.
      const removedVariants =
        action === "removed"
          ? [...this.#tags].filter((existing) => foldIdTag(existing) === foldIdTag(tag))
          : [];
      if (action === "removed" && this.#tags.size - removedVariants.length < 1) {
        throw new OwnerTagConflictError("At least one desired owner tag must remain");
      }
      if (action === "added" && this.#tags.size >= MAXIMUM_OWNER_TAGS) {
        throw new OwnerTagConflictError("Owner tag state reached its supported maximum");
      }

      const previous = createState([...this.#tags], this.#version, this.#stationSecret);
      const nextTags = new Set(this.#tags);
      if (action === "added") nextTags.add(tag);
      else for (const variant of removedVariants) nextTags.delete(variant);
      const next = createState([...nextTags], this.#version + 1, this.#stationSecret);
      await this.#persist(next);
      const tagPseudonym = `tag_${pseudonymizeTag(tag, this.#stationSecret)}`;
      try {
        await appendAudit(config, evidence, "OwnerTagDesiredStateChanged", {
          action,
          desiredCount: next.tags.length,
          stateHmac: next.integrityHmac,
          stateVersion: next.version,
          tagPseudonym,
          ...(removedVariants.length > 1
            ? { caseVariantsRemoved: removedVariants.length - 1 }
            : {}),
        });
      } catch (auditError) {
        try {
          await this.#persist(previous);
        } catch (rollbackError) {
          this.#apply(next);
          throw new AggregateError(
            [auditError, rollbackError],
            "Owner tag desired state persisted but its audit and rollback failed; restart is required",
          );
        }
        throw auditError;
      }
      this.#apply(next);
      return { stateVersion: next.version, tagCount: next.tags.length, tagPseudonym };
    });
  }

  #apply(state: StoredOwnerTagState): void {
    this.#tags.clear();
    for (const tag of state.tags) this.#tags.add(tag);
    this.#version = state.version;
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

export function withOwnerTagRegistry(
  config: GatewayConfig,
  registry: OwnerTagRegistry,
): GatewayConfig {
  return { ...config, ownerTags: registry.tags };
}

export type OwnerTagRegistries = ReadonlyMap<string, OwnerTagRegistry>;

export async function openOwnerTagRegistries(config: GatewayConfig): Promise<OwnerTagRegistries> {
  const registries = new Map<string, OwnerTagRegistry>();
  const stations = configuredStations(config);
  for (const [index, station] of stations.entries()) {
    const scoped = configForStation(config, station.id);
    const path =
      index === 0
        ? ownerTagStatePath(config.eventLogPath)
        : stationOwnerTagStatePath(config.eventLogPath, station.id);
    registries.set(station.id, await OwnerTagRegistry.open(scoped, path));
  }
  return registries;
}

export function withOwnerTagRegistries(
  config: GatewayConfig,
  registries: OwnerTagRegistries,
): GatewayConfig {
  const stations: StationConfig[] = configuredStations(config).map((station) => {
    const registry = registries.get(station.id);
    if (!registry) throw new OwnerTagStateError("Owner tag registry is missing for a station");
    return { ...station, ownerTags: registry.tags };
  });
  const primary = stations[0]!;
  return {
    ...config,
    ownerTags: primary.ownerTags,
    stationId: primary.id,
    stationSecret: primary.secret,
    stations,
  };
}

export function ownerTagRegistryFor(
  registries: OwnerTagRegistry | OwnerTagRegistries,
  stationId: string,
): OwnerTagRegistry {
  if (registries instanceof OwnerTagRegistry) return registries;
  const registry = registries.get(stationId);
  if (!registry) throw new OwnerTagStateError("Owner tag registry is missing for a station");
  return registry;
}

export function ownerTagStatePath(eventLogPath: string): string {
  return join(dirname(eventLogPath), "owner-tags.json");
}

export function stationOwnerTagStatePath(eventLogPath: string, stationId: string): string {
  const digest = createHash("sha256").update(stationId, "utf8").digest("hex").slice(0, 24);
  return join(dirname(eventLogPath), "owner-tags", `${digest}.json`);
}

function ownerTag(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 20 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new OwnerTagInputError(
      "tag must be 1-20 characters without surrounding whitespace or control characters",
    );
  }
  return value;
}

function createState(
  tags: readonly string[],
  version: number,
  stationSecret: string,
): StoredOwnerTagState {
  const normalized = [...new Set(tags.map(ownerTag))].sort();
  // An empty set is the state before the first card is added. Revocation can never return to it:
  // removing the last desired card is refused.
  if (normalized.length > MAXIMUM_OWNER_TAGS) {
    throw new OwnerTagStateError("Owner tag state exceeds its supported maximum");
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new OwnerTagStateError("Owner tag state version is invalid");
  }
  const canonical = JSON.stringify({
    schemaVersion: OWNER_TAG_STATE_SCHEMA_VERSION,
    tags: normalized,
    version,
  });
  return {
    integrityHmac: createHmac("sha256", stationSecret).update(canonical, "utf8").digest("hex"),
    schemaVersion: OWNER_TAG_STATE_SCHEMA_VERSION,
    tags: normalized,
    version,
  };
}

async function readOwnerTagState(
  path: string,
  stationSecret: string,
): Promise<StoredOwnerTagState | null> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new OwnerTagStateError("Owner tag state cannot be inspected");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new OwnerTagStateError("Owner tag state must be a regular, non-symlinked file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new OwnerTagStateError("Owner tag state must not be accessible by group or other users");
  }
  if (metadata.size > MAXIMUM_STATE_BYTES) {
    throw new OwnerTagStateError("Owner tag state exceeds its size limit");
  }
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size > MAXIMUM_STATE_BYTES
    ) {
      throw new OwnerTagStateError("Owner tag state changed while it was opened");
    }
    const parsed = JSON.parse(await file.readFile("utf8")) as unknown;
    return parseState(parsed, stationSecret);
  } catch (error) {
    if (error instanceof OwnerTagStateError) throw error;
    throw new OwnerTagStateError("Owner tag state is malformed or unreadable");
  } finally {
    await file?.close();
  }
}

function parseState(value: unknown, stationSecret: string): StoredOwnerTagState {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (
    Object.keys(record).sort().join(",") !== "integrityHmac,schemaVersion,tags,version" ||
    record.schemaVersion !== OWNER_TAG_STATE_SCHEMA_VERSION ||
    typeof record.integrityHmac !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.integrityHmac) ||
    !Array.isArray(record.tags) ||
    !record.tags.every((tag) => typeof tag === "string") ||
    typeof record.version !== "number"
  ) {
    throw new OwnerTagStateError("Owner tag state schema is invalid");
  }
  const expected = createState(record.tags as string[], record.version, stationSecret);
  if (JSON.stringify(record.tags) !== JSON.stringify(expected.tags)) {
    throw new OwnerTagStateError("Owner tag state must use canonical tag ordering");
  }
  if (!safeEqual(record.integrityHmac, expected.integrityHmac)) {
    throw new OwnerTagStateError("Owner tag state authentication failed");
  }
  return expected;
}

async function createOwnerTagState(path: string, state: StoredOwnerTagState): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    await link(temporaryPath, path);
    await unlink(temporaryPath);
    await syncDirectory(dirname(path));
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function writeOwnerTagState(path: string, state: StoredOwnerTagState): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(state)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    await rename(temporaryPath, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function appendAudit(
  config: GatewayConfig,
  evidence: EvidenceStore,
  message: string,
  payload: OwnerTagAuditPayload,
): Promise<void> {
  const sourcePayloadHmac = createHmac("sha256", config.stationSecret)
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
  await evidence.append(
    evidenceEvent(config.stationId, "system", message, payload, sourcePayloadHmac),
  );
}

function payloadRecord(event: EvidenceEvent | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
