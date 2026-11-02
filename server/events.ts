import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const ARCHIVE_FILE = /^segment-(\d{8})-([a-f0-9]{64})\.ndjson$/u;

export interface EvidenceEvent {
  readonly at: string;
  readonly carriedFromRecordHash?: string;
  readonly direction: "station-to-csms" | "csms-to-station" | "system";
  readonly eventId: string;
  readonly message: string;
  readonly payload: unknown;
  readonly previousRecordHash?: string | null;
  readonly recordHash?: string;
  readonly sourcePayloadHmac?: string;
  readonly stationId: string;
}

export interface EvidenceStore {
  allocateAuthorizationRevision(stationId: string, minimum: number): Promise<number>;
  recordTransactionStart(
    stationId: string,
    fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ readonly replayed: boolean; readonly transactionId: number }>;
  append(event: EvidenceEvent): Promise<void>;
  getCapacity?(): Promise<EvidenceCapacity>;
  readEvents(): Promise<readonly EvidenceEvent[]>;
}

export interface EvidenceCapacity {
  readonly maxBytes: number;
  readonly remainingBytes: number;
  readonly usedBytes: number;
}

export interface EvidenceArchiveSegment {
  readonly eventCount: number;
  readonly firstRecordHash: string;
  readonly lastRecordHash: string;
  readonly sequence: number;
  readonly sha256: string;
}

export interface EvidenceSnapshot {
  readonly archives: readonly EvidenceArchiveSegment[];
  readonly currentEventCount: number;
  readonly events: readonly EvidenceEvent[];
}

export class NdjsonEvidenceStore implements EvidenceStore {
  readonly #maxBytes: number;
  readonly #path: string;
  readonly #allowReadOnlyArchiveDirectory: boolean;
  readonly #authorizationRevisions = new Map<string, number>();
  readonly #transactionFingerprints = new Map<string, number>();
  readonly #transactionIds = new Map<string, number>();
  // Stations whose persisted StartTransaction fingerprints are fully indexed in memory. Only
  // recordTransactionStart appends StartTransaction while the edge runs, so after one ledger
  // scan a fingerprint miss is authoritative and needs no further full read.
  readonly #indexedTransactionStations = new Set<string>();
  #appendTail: Promise<void> = Promise.resolve();
  #allocationTail: Promise<void> = Promise.resolve();
  #lastRecordHash: string | null | undefined;

  constructor(path: string, maxBytes = 268_435_456, allowReadOnlyArchiveDirectory = false) {
    this.#path = path;
    this.#maxBytes = maxBytes;
    this.#allowReadOnlyArchiveDirectory = allowReadOnlyArchiveDirectory;
  }

  allocateAuthorizationRevision(stationId: string, minimum: number): Promise<number> {
    return this.#allocate(async () => {
      let lastRevision = this.#authorizationRevisions.get(stationId);
      if (lastRevision === undefined) {
        lastRevision = findHighestNumber(
          await this.readEvents(),
          stationId,
          "SendLocalList",
          "listVersion",
        );
      }
      const nextRevision = Math.max(lastRevision + 1, minimum);
      this.#authorizationRevisions.set(stationId, nextRevision);
      return nextRevision;
    });
  }

  recordTransactionStart(
    stationId: string,
    fingerprint: string,
    event: (transactionId: number) => EvidenceEvent,
  ): Promise<{ readonly replayed: boolean; readonly transactionId: number }> {
    return this.#allocate(async () => {
      const fingerprintKey = `${stationId}:${fingerprint}`;
      const reservedId = this.#transactionFingerprints.get(fingerprintKey);
      if (reservedId !== undefined) {
        return { replayed: true, transactionId: reservedId };
      }
      if (!this.#indexedTransactionStations.has(stationId)) {
        const events = await this.readEvents();
        for (const [persisted, transactionId] of transactionFingerprints(events, stationId)) {
          this.#transactionFingerprints.set(`${stationId}:${persisted}`, transactionId);
        }
        this.#transactionIds.set(
          stationId,
          Math.max(
            this.#transactionIds.get(stationId) ?? 0,
            findHighestNumber(events, stationId, "StartTransaction", "transactionId"),
          ),
        );
        this.#indexedTransactionStations.add(stationId);
        const persistedId = this.#transactionFingerprints.get(fingerprintKey);
        if (persistedId !== undefined) return { replayed: true, transactionId: persistedId };
      }
      const lastId = this.#transactionIds.get(stationId) ?? 0;
      const transactionId = lastId + 1;
      await this.append(event(transactionId));
      this.#transactionIds.set(stationId, transactionId);
      this.#transactionFingerprints.set(fingerprintKey, transactionId);
      return { replayed: false, transactionId };
    });
  }

  append(event: EvidenceEvent): Promise<void> {
    const operation = this.#appendTail.then(async () => {
      if (this.#lastRecordHash === undefined) {
        const events = await this.#readStoredEvents();
        this.#lastRecordHash = events.at(-1)?.recordHash ?? null;
      }
      const sealedEvent = sealEvidenceEvent(event, this.#lastRecordHash);
      const serialized = Buffer.from(`${JSON.stringify(sealedEvent)}\n`, "utf8");
      await mkdir(dirname(this.#path), { recursive: true });
      const file = await open(this.#path, "a", 0o600);
      try {
        await file.chmod(0o600);
        const metadata = await file.stat();
        if (metadata.size + serialized.byteLength > this.#maxBytes) {
          throw new EvidenceCapacityError(this.#maxBytes);
        }
        await file.writeFile(serialized);
        await file.sync();
      } finally {
        await file.close();
      }
      this.#lastRecordHash = sealedEvent.recordHash ?? null;
    });
    this.#appendTail = operation.catch(() => undefined);
    return operation;
  }

  async readEvents(): Promise<readonly EvidenceEvent[]> {
    await this.#appendTail;
    return this.#readStoredEvents();
  }

  async readSnapshot(): Promise<EvidenceSnapshot> {
    await this.#appendTail;
    return this.#readSnapshot();
  }

  archiveCurrentSegment(): Promise<EvidenceArchiveSegment> {
    const operation = this.#appendTail.then(async () => {
      const snapshot = await this.#readSnapshot();
      if (snapshot.currentEventCount === 0) {
        throw new EvidenceArchiveError("Current evidence segment is empty");
      }
      const currentContent = await readFile(this.#path);
      const currentEvents = snapshot.events.slice(-snapshot.currentEventCount);
      const sha256 = createHash("sha256").update(currentContent).digest("hex");
      const sequence = snapshot.archives.length + 1;
      const segment: EvidenceArchiveSegment = {
        eventCount: currentEvents.length,
        firstRecordHash: currentEvents[0]!.recordHash!,
        lastRecordHash: currentEvents.at(-1)!.recordHash!,
        sequence,
        sha256,
      };
      const archiveDirectory = `${this.#path}.archives`;
      await ensureOwnerArchiveDirectory(archiveDirectory);
      const archivePath = join(
        archiveDirectory,
        `segment-${String(sequence).padStart(8, "0")}-${sha256}.ndjson`,
      );
      await assertPathDoesNotExist(archivePath);
      await rename(this.#path, archivePath);
      const archiveFile = await open(archivePath, "r");
      try {
        await archiveFile.chmod(0o400);
        await archiveFile.sync();
      } finally {
        await archiveFile.close();
      }
      const directory = await open(archiveDirectory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return segment;
    });
    this.#appendTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async getCapacity(): Promise<EvidenceCapacity> {
    await this.#appendTail;
    let usedBytes = 0;
    try {
      usedBytes = (await stat(this.#path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return {
      maxBytes: this.#maxBytes,
      remainingBytes: Math.max(0, this.#maxBytes - usedBytes),
      usedBytes,
    };
  }

  async #readStoredEvents(): Promise<readonly EvidenceEvent[]> {
    return (await this.#readSnapshot()).events;
  }

  async #readSnapshot(): Promise<EvidenceSnapshot> {
    const archiveDirectory = `${this.#path}.archives`;
    const archives = await readArchiveSegments(
      archiveDirectory,
      this.#allowReadOnlyArchiveDirectory,
    );
    const archivedEvents = archives.flatMap((segment) => segment.events);
    const currentEvents = await readEvidenceFile(this.#path);
    const events = [...archivedEvents, ...currentEvents];
    verifyEvidenceChain(events);
    return {
      archives: archives.map(({ events: _, ...segment }) => segment),
      currentEventCount: currentEvents.length,
      events,
    };
  }

  #allocate<T>(allocation: () => Promise<T>): Promise<T> {
    const operation = this.#allocationTail.then(allocation);
    this.#allocationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

export class EvidenceCapacityError extends Error {
  constructor(maxBytes: number) {
    super(`Evidence log reached its configured ${maxBytes}-byte limit`);
    this.name = "EvidenceCapacityError";
  }
}

export class EvidenceArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceArchiveError";
  }
}

export function evidenceEvent(
  stationId: string,
  direction: EvidenceEvent["direction"],
  message: string,
  payload: unknown,
  sourcePayloadHmac?: string,
): EvidenceEvent {
  return {
    at: new Date().toISOString(),
    direction,
    eventId: randomUUID(),
    message,
    payload,
    ...(sourcePayloadHmac ? { sourcePayloadHmac } : {}),
    stationId,
  };
}

function findHighestNumber(
  events: readonly EvidenceEvent[],
  stationId: string,
  message: string,
  field: string,
): number {
  let highest = 0;
  for (const event of events) {
    if (event.stationId !== stationId || event.message !== message) continue;
    const value = (event.payload as Record<string, unknown>)[field];
    if (typeof value === "number" && Number.isInteger(value)) {
      highest = Math.max(highest, value);
    }
  }
  return highest;
}

function transactionFingerprints(
  events: readonly EvidenceEvent[],
  stationId: string,
): Map<string, number> {
  // Later records win, matching the previous newest-first lookup.
  const fingerprints = new Map<string, number>();
  for (const event of events) {
    if (event.stationId !== stationId || event.message !== "StartTransaction") continue;
    const payload = event.payload as Record<string, unknown>;
    if (
      typeof payload.transactionFingerprint === "string" &&
      typeof payload.transactionId === "number"
    ) {
      fingerprints.set(payload.transactionFingerprint, payload.transactionId);
    }
  }
  return fingerprints;
}

function parseEvidenceEvent(line: string, lineNumber: number): EvidenceEvent {
  const value = JSON.parse(line) as Partial<EvidenceEvent>;
  if (
    typeof value.at !== "string" ||
    typeof value.eventId !== "string" ||
    typeof value.message !== "string" ||
    typeof value.recordHash !== "string" ||
    typeof value.stationId !== "string" ||
    !(
      value.carriedFromRecordHash === undefined ||
      (typeof value.carriedFromRecordHash === "string" &&
        /^[a-f0-9]{64}$/u.test(value.carriedFromRecordHash))
    ) ||
    !(value.previousRecordHash === null || typeof value.previousRecordHash === "string") ||
    !["station-to-csms", "csms-to-station", "system"].includes(value.direction ?? "")
  ) {
    throw new Error(`Invalid evidence record at line ${lineNumber}`);
  }
  return value as EvidenceEvent;
}

interface LoadedEvidenceArchiveSegment extends EvidenceArchiveSegment {
  readonly events: readonly EvidenceEvent[];
}

async function readArchiveSegments(
  archiveDirectory: string,
  allowReadOnlyDirectory: boolean,
): Promise<readonly LoadedEvidenceArchiveSegment[]> {
  let metadata;
  try {
    metadata = await lstat(archiveDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new EvidenceArchiveError("Evidence archive path must be a non-symlinked directory");
  }
  const ownerOnly = (metadata.mode & 0o077) === 0;
  const protectedRecoveryMount = allowReadOnlyDirectory && (metadata.mode & 0o022) === 0;
  if (!ownerOnly && !protectedRecoveryMount) {
    throw new EvidenceArchiveError(
      "Evidence archive directory must be owner-only or an explicitly allowed protected recovery mount",
    );
  }
  const entries = (await readdir(archiveDirectory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const segments: LoadedEvidenceArchiveSegment[] = [];
  for (const [index, entry] of entries.entries()) {
    const match = ARCHIVE_FILE.exec(entry.name);
    if (!entry.isFile() || !match) {
      throw new EvidenceArchiveError(`Unexpected evidence archive entry: ${entry.name}`);
    }
    const sequence = Number(match[1]);
    const expectedSha256 = match[2]!;
    if (sequence !== index + 1) {
      throw new EvidenceArchiveError("Evidence archive sequence is not contiguous");
    }
    const path = join(archiveDirectory, entry.name);
    const fileMetadata = await lstat(path);
    if (fileMetadata.isSymbolicLink() || !fileMetadata.isFile()) {
      throw new EvidenceArchiveError(`Evidence archive is not a regular file: ${entry.name}`);
    }
    const content = await readFile(path);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (sha256 !== expectedSha256) {
      throw new EvidenceArchiveError(`Evidence archive digest mismatch: ${entry.name}`);
    }
    const events = parseEvidenceContent(content.toString("utf8"), entry.name);
    if (events.length === 0) {
      throw new EvidenceArchiveError(`Evidence archive is empty: ${entry.name}`);
    }
    segments.push({
      eventCount: events.length,
      events,
      firstRecordHash: events[0]!.recordHash!,
      lastRecordHash: events.at(-1)!.recordHash!,
      sequence,
      sha256,
    });
  }
  return segments;
}

async function readEvidenceFile(path: string): Promise<readonly EvidenceEvent[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseEvidenceContent(content, basename(path));
}

function parseEvidenceContent(content: string, source: string): readonly EvidenceEvent[] {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return parseEvidenceEvent(line, index + 1);
      } catch (error) {
        throw new EvidenceArchiveError(
          `Invalid evidence in ${source} at line ${index + 1}: ${error instanceof Error ? error.message : "parse failed"}`,
        );
      }
    });
}

async function ensureOwnerArchiveDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    throw new EvidenceArchiveError(
      "Evidence archive directory must be owner-only and non-symlinked",
    );
  }
}

async function assertPathDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new EvidenceArchiveError("Evidence archive target already exists");
}

export class EvidenceIntegrityError extends Error {
  constructor(lineNumber: number) {
    super(`Evidence integrity verification failed at line ${lineNumber}`);
    this.name = "EvidenceIntegrityError";
  }
}

function sealEvidenceEvent(event: EvidenceEvent, previousRecordHash: string | null): EvidenceEvent {
  const unsealed = {
    at: event.at,
    ...(event.carriedFromRecordHash ? { carriedFromRecordHash: event.carriedFromRecordHash } : {}),
    direction: event.direction,
    eventId: event.eventId,
    message: event.message,
    payload: event.payload,
    previousRecordHash,
    ...(event.sourcePayloadHmac ? { sourcePayloadHmac: event.sourcePayloadHmac } : {}),
    stationId: event.stationId,
  };
  return {
    ...unsealed,
    recordHash: hashEvidenceRecord(unsealed),
  };
}

export function verifyEvidenceChain(events: readonly EvidenceEvent[]): void {
  let previousRecordHash: string | null = null;
  for (const [index, event] of events.entries()) {
    if (
      event.previousRecordHash !== previousRecordHash ||
      event.recordHash !==
        hashEvidenceRecord({
          at: event.at,
          ...(event.carriedFromRecordHash
            ? { carriedFromRecordHash: event.carriedFromRecordHash }
            : {}),
          direction: event.direction,
          eventId: event.eventId,
          message: event.message,
          payload: event.payload,
          previousRecordHash: event.previousRecordHash,
          ...(event.sourcePayloadHmac ? { sourcePayloadHmac: event.sourcePayloadHmac } : {}),
          stationId: event.stationId,
        })
    ) {
      throw new EvidenceIntegrityError(index + 1);
    }
    previousRecordHash = event.recordHash;
  }
}

export function rechainEvidenceEvents(events: readonly EvidenceEvent[]): readonly EvidenceEvent[] {
  let previousRecordHash: string | null = null;
  return events.map((event) => {
    const sealed = sealEvidenceEvent(event, previousRecordHash);
    previousRecordHash = sealed.recordHash ?? null;
    return sealed;
  });
}

function hashEvidenceRecord(event: Omit<EvidenceEvent, "recordHash">): string {
  return createHash("sha256").update(JSON.stringify(event), "utf8").digest("hex");
}
