import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as deriveKeyWithScrypt,
} from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, join, resolve } from "node:path";

import { configuredStations, type GatewayConfig } from "./config.js";
import {
  type EvidenceArchiveSegment,
  type EvidenceEvent,
  type EvidenceSnapshot,
  NdjsonEvidenceStore,
  evidenceEvent,
  rechainEvidenceEvents,
  verifyEvidenceChain,
} from "./events.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SCRYPT_N = 32_768;
const SCRYPT_P = 1;
const SCRYPT_R = 8;

export const EVIDENCE_ARCHIVE_CONFIRMATION =
  "I confirm chargeOS is stopped and the matching continuity bundle is held separately";
export const EVIDENCE_COMPACTION_CONFIRMATION =
  "I confirm the full source bundle remains separately held and the compacted ledger will be installed only into a new empty edge";

export interface EvidenceCustodyRecord {
  readonly archiveSegmentCount: number;
  readonly bundleSha256: string;
  readonly eventCount: number;
  readonly exportedAt: string;
  readonly lastRecordHash: string | null;
  readonly payloadSchemaVersion: 1 | 2 | 3 | 4;
}

export interface EvidenceHistory {
  readonly custody: readonly EvidenceCustodyRecord[];
  readonly mode: "compacted-operational";
  readonly omittedEventCount: number;
  readonly retainedEventCount: number;
  readonly schemaVersion: 1;
}

export interface ContinuityBundleEnvelope {
  readonly createdAt: string;
  readonly encryption: {
    readonly algorithm: typeof ALGORITHM;
    readonly authTag: string;
    readonly ciphertext: string;
    readonly iv: string;
    readonly kdf: "scrypt";
    readonly n: number;
    readonly p: number;
    readonly r: number;
    readonly salt: string;
  };
  readonly format: "chargeos-owner-continuity";
  readonly schemaVersion: 1;
}

export interface ContinuityPayload {
  readonly configuration: {
    readonly apiHost: string;
    readonly apiPort: number;
    readonly eventLogMaxBytes?: number;
    readonly heartbeatSeconds: number;
    readonly ocppHost: string;
    readonly ocppMaxConnections?: number;
    readonly ocppMaxPayloadBytes?: number;
    readonly ocppMessageBurst?: number;
    readonly ocppMessagesPerMinute?: number;
    readonly ownerApiToken: string;
    readonly ownerTags: readonly string[];
    readonly port: number;
    readonly stationId: string;
    readonly stationSecret: string;
    readonly trustProxyHeaders?: boolean;
    readonly uiDirectory: string;
  };
  readonly evidence: readonly EvidenceEvent[];
  readonly evidenceArchives?: readonly EvidenceArchiveSegment[];
  readonly evidenceHistory?: EvidenceHistory;
  readonly exportedAt: string;
  readonly schemaVersion: 1 | 2 | 3 | 4;
}

export interface ContinuityInspection {
  readonly eventCount: number;
  readonly exportedAt: string;
  readonly lastRecordHash: string | null;
  readonly ownerTagCount: number;
  readonly payloadSchemaVersion: 1 | 2 | 3 | 4;
  readonly archiveSegmentCount: number;
  readonly currentEventCount: number;
  readonly evidenceHistory: {
    readonly custodyBundleCount: number;
    readonly custodiedEventCount: number;
    readonly mode: "complete" | "compacted-operational";
    readonly omittedEventCount: number;
    readonly retainedEventCount: number;
  };
  readonly recoveryPolicy: {
    readonly legacySafetyDefaultsApplied: boolean;
    readonly proxyTrustRequiresTopologyReview: true;
    readonly sourceTrustedProxyHeaders: boolean | null;
    readonly restoredTrustProxyHeaders: false;
  };
  readonly stationId: string;
}

export interface ProductionRecoveryMetadata {
  readonly acmeEmail: string;
  readonly ocppDomain: string;
  readonly ownerDomain: string;
}

export function assertContinuityMatchesEvidenceSnapshot(
  payload: ContinuityPayload,
  snapshot: EvidenceSnapshot,
): void {
  verifyContinuityEvidence(payload);
  verifyEvidenceChain(snapshot.events);
  if (
    payload.configuration.stationId !== snapshot.events.at(-1)?.stationId ||
    JSON.stringify(payload.evidence) !== JSON.stringify(snapshot.events) ||
    JSON.stringify(continuityEvidenceArchives(payload)) !== JSON.stringify(snapshot.archives)
  ) {
    throw new ContinuityBundleError("Continuity bundle does not match the current evidence layout");
  }
}

export async function createContinuityBundle(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  passphrase: string,
  evidenceArchives: readonly EvidenceArchiveSegment[] = [],
): Promise<ContinuityBundleEnvelope> {
  if (configuredStations(config).length !== 1) {
    throw new ContinuityBundleError(
      "Encrypted continuity bundles currently require one station per edge; fleet mode must not emit an incomplete recovery artifact",
    );
  }
  requireStrongPassphrase(passphrase);
  verifyEvidenceChain(events);
  validateEvidenceArchiveLayout(events, evidenceArchives);
  const createdAt = new Date().toISOString();
  const evidenceHistory = evidenceHistoryFromEvents(events);
  const payload: ContinuityPayload = {
    configuration: {
      apiHost: config.apiHost,
      apiPort: config.apiPort,
      eventLogMaxBytes: config.eventLogMaxBytes,
      heartbeatSeconds: config.heartbeatSeconds,
      ocppHost: config.ocppHost,
      ocppMaxConnections: config.ocppMaxConnections,
      ocppMaxPayloadBytes: config.ocppMaxPayloadBytes,
      ocppMessageBurst: config.ocppMessageBurst,
      ocppMessagesPerMinute: config.ocppMessagesPerMinute,
      ownerApiToken: config.ownerApiToken,
      ownerTags: [...config.ownerTags],
      port: config.port,
      stationId: config.stationId,
      stationSecret: config.stationSecret,
      trustProxyHeaders: config.trustProxyHeaders,
      uiDirectory: config.uiDirectory,
    },
    evidence: events,
    evidenceArchives,
    ...(evidenceHistory ? { evidenceHistory } : {}),
    exportedAt: createdAt,
    schemaVersion: evidenceHistory ? 4 : 3,
  };
  return encryptContinuityPayload(payload, passphrase);
}

export async function compactContinuityBundle(
  serializedSource: string,
  passphrase: string,
  now = new Date(),
): Promise<ContinuityBundleEnvelope> {
  const source = await openContinuityBundle(serializedSource, passphrase);
  if (source.evidence.length === 0) {
    throw new ContinuityBundleError("Cannot compact an empty evidence bundle");
  }
  const retained = compactOperationalEvidence(source.evidence);
  const priorCustody = source.evidenceHistory?.custody ?? [];
  const custodyRecord: EvidenceCustodyRecord = {
    archiveSegmentCount: continuityEvidenceArchives(source).length,
    bundleSha256: createHash("sha256").update(serializedSource, "utf8").digest("hex"),
    eventCount: source.evidence.length,
    exportedAt: source.exportedAt,
    lastRecordHash: source.evidence.at(-1)?.recordHash ?? null,
    payloadSchemaVersion: source.schemaVersion,
  };
  const history: EvidenceHistory = {
    custody: [...priorCustody, custodyRecord],
    mode: "compacted-operational",
    omittedEventCount: source.evidence.length - retained.length,
    retainedEventCount: retained.length,
    schemaVersion: 1,
  };
  const carried = retained.map(carryEvidenceEvent);
  const checkpoint = evidenceEvent(
    source.configuration.stationId,
    "system",
    "EvidenceHistoryCompacted",
    {
      custody: history.custody,
      custodyBundleCount: history.custody.length,
      custodiedEventCount: history.custody.reduce((total, record) => total + record.eventCount, 0),
      latestCustodyBundleSha256: custodyRecord.bundleSha256,
      mode: history.mode,
      omittedEventCount: history.omittedEventCount,
      retainedEventCount: history.retainedEventCount,
      schemaVersion: history.schemaVersion,
    },
  );
  const events = rechainEvidenceEvents([...carried, { ...checkpoint, at: now.toISOString() }]);
  const serializedEvents = serializeEvents(events);
  const maximumBytes = source.configuration.eventLogMaxBytes ?? 268_435_456;
  const reservedHeadroom = (source.configuration.ocppMaxPayloadBytes ?? 1_048_576) + 4_096;
  if (Buffer.byteLength(serializedEvents, "utf8") + reservedHeadroom > maximumBytes) {
    throw new ContinuityBundleError(
      "Compacted operational ledger does not fit the configured evidence capacity with append headroom",
    );
  }
  const payload: ContinuityPayload = {
    configuration: source.configuration,
    evidence: events,
    evidenceArchives: [],
    evidenceHistory: history,
    exportedAt: now.toISOString(),
    schemaVersion: 4,
  };
  return encryptContinuityPayload(payload, passphrase);
}

export function assertEvidenceCustodyIncludesBundle(
  compacted: ContinuityPayload,
  serializedSource: string,
): EvidenceCustodyRecord {
  verifyContinuityEvidence(compacted);
  if (compacted.schemaVersion !== 4 || !compacted.evidenceHistory) {
    throw new ContinuityBundleError("Continuity bundle is not compacted operational recovery");
  }
  const digest = createHash("sha256").update(serializedSource, "utf8").digest("hex");
  const record = compacted.evidenceHistory.custody.find(
    (candidate) => candidate.bundleSha256 === digest,
  );
  if (!record) {
    throw new ContinuityBundleError("Source bundle is not referenced by compacted custody");
  }
  return record;
}

export async function verifyEvidenceCustodySource(
  compacted: ContinuityPayload,
  serializedSource: string,
  sourcePassphrase: string,
): Promise<EvidenceCustodyRecord> {
  const record = assertEvidenceCustodyIncludesBundle(compacted, serializedSource);
  const source = await openContinuityBundle(serializedSource, sourcePassphrase);
  if (
    record.archiveSegmentCount !== continuityEvidenceArchives(source).length ||
    record.eventCount !== source.evidence.length ||
    record.exportedAt !== source.exportedAt ||
    record.lastRecordHash !== (source.evidence.at(-1)?.recordHash ?? null) ||
    record.payloadSchemaVersion !== source.schemaVersion
  ) {
    throw new ContinuityBundleError("Custodied source metadata does not match its bundle");
  }
  if (record === compacted.evidenceHistory?.custody.at(-1)) {
    verifyCarriedEvidenceMatchesSource(compacted, source);
  }
  return record;
}

export async function rewrapContinuityBundle(
  serialized: string,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<ContinuityBundleEnvelope> {
  requireStrongPassphrase(newPassphrase);
  if (currentPassphrase === newPassphrase) {
    throw new ContinuityBundleError("New continuity passphrase must be different");
  }
  const payload = await openContinuityBundle(serialized, currentPassphrase);
  return encryptContinuityPayload(payload, newPassphrase);
}

async function encryptContinuityPayload(
  payload: ContinuityPayload,
  passphrase: string,
): Promise<ContinuityBundleEnvelope> {
  requireStrongPassphrase(passphrase);
  verifyContinuityEvidence(payload);
  const createdAt = payload.exportedAt;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(continuityAad(createdAt));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    createdAt,
    encryption: {
      algorithm: ALGORITHM,
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      kdf: "scrypt",
      n: SCRYPT_N,
      p: SCRYPT_P,
      r: SCRYPT_R,
      salt: salt.toString("base64"),
    },
    format: "chargeos-owner-continuity",
    schemaVersion: 1,
  };
}

export async function openContinuityBundle(
  serialized: string,
  passphrase: string,
): Promise<ContinuityPayload> {
  requireStrongPassphrase(passphrase);
  const envelope = parseEnvelope(serialized);
  const encryption = envelope.encryption;
  const key = await deriveKey(
    passphrase,
    decodeBase64(encryption.salt, "salt"),
    encryption.n,
    encryption.r,
    encryption.p,
  );
  try {
    const decipher = createDecipheriv(ALGORITHM, key, decodeBase64(encryption.iv, "iv"));
    decipher.setAAD(continuityAad(envelope.createdAt));
    decipher.setAuthTag(decodeBase64(encryption.authTag, "authTag"));
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64(encryption.ciphertext, "ciphertext")),
      decipher.final(),
    ]);
    const payload = parsePayload(plaintext.toString("utf8"));
    if (payload.exportedAt !== envelope.createdAt) {
      throw new Error("Continuity bundle timestamp mismatch");
    }
    verifyContinuityEvidence(payload);
    return payload;
  } catch (error) {
    if (error instanceof ContinuityBundleError) throw error;
    throw new ContinuityBundleError("Continuity bundle authentication failed");
  }
}

export function inspectContinuityPayload(payload: ContinuityPayload): ContinuityInspection {
  const archives = continuityEvidenceArchives(payload);
  const archivedEventCount = archives.reduce((total, segment) => total + segment.eventCount, 0);
  return {
    archiveSegmentCount: archives.length,
    currentEventCount: payload.evidence.length - archivedEventCount,
    evidenceHistory: payload.evidenceHistory
      ? {
          custodyBundleCount: payload.evidenceHistory.custody.length,
          custodiedEventCount: payload.evidenceHistory.custody.reduce(
            (total, record) => total + record.eventCount,
            0,
          ),
          mode: payload.evidenceHistory.mode,
          omittedEventCount: payload.evidenceHistory.omittedEventCount,
          retainedEventCount: payload.evidenceHistory.retainedEventCount,
        }
      : {
          custodyBundleCount: 0,
          custodiedEventCount: 0,
          mode: "complete",
          omittedEventCount: 0,
          retainedEventCount: payload.evidence.length,
        },
    eventCount: payload.evidence.length,
    exportedAt: payload.exportedAt,
    lastRecordHash: payload.evidence.at(-1)?.recordHash ?? null,
    ownerTagCount: payload.configuration.ownerTags.length,
    payloadSchemaVersion: payload.schemaVersion,
    recoveryPolicy: {
      legacySafetyDefaultsApplied: payload.schemaVersion === 1,
      proxyTrustRequiresTopologyReview: true,
      sourceTrustedProxyHeaders: payload.configuration.trustProxyHeaders ?? null,
      restoredTrustProxyHeaders: false,
    },
    stationId: payload.configuration.stationId,
  };
}

export async function restoreContinuityPayload(
  payload: ContinuityPayload,
  targetDirectory: string,
): Promise<string> {
  verifyContinuityEvidence(payload);
  const target = resolve(targetDirectory);
  if (target === "/" || basename(target) === "") {
    throw new ContinuityBundleError("Refusing to restore into a broad filesystem target");
  }
  await assertTargetDoesNotExist(target);
  const temporary = await mkdtemp(join(dirname(target), ".chargeos-restore-"));
  try {
    const eventLogPath = join(target, "events.ndjson");
    await writeContinuityEvidence(payload, join(temporary, "events.ndjson"), 0o600, 0o400, 0o700);
    await writeFile(
      join(temporary, ".env"),
      serializeEnvironment(payload.configuration, eventLogPath),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(temporary, "restore-manifest.json"),
      `${JSON.stringify(inspectContinuityPayload(payload), null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }
}

export async function restoreProductionContinuityPayload(
  payload: ContinuityPayload,
  targetDirectory: string,
  metadata: ProductionRecoveryMetadata,
): Promise<string> {
  verifyContinuityEvidence(payload);
  const deployment = productionRecoveryMetadata(metadata);
  const target = resolve(targetDirectory);
  if (target === "/" || basename(target) === "") {
    throw new ContinuityBundleError("Refusing to restore into a broad filesystem target");
  }
  await assertTargetDoesNotExist(target);
  const temporary = await mkdtemp(join(dirname(target), ".chargeos-production-restore-"));
  try {
    const secretsDirectory = join(temporary, "secrets");
    await mkdir(secretsDirectory, { mode: 0o700 });
    await writeContinuityEvidence(
      payload,
      join(temporary, "events.ndjson"),
      0o444,
      0o444,
      0o755,
      true,
    );
    await writeFile(join(secretsDirectory, "station-secret"), payload.configuration.stationSecret, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o444,
    });
    await writeFile(
      join(secretsDirectory, "owner-api-token"),
      payload.configuration.ownerApiToken,
      { encoding: "utf8", flag: "wx", mode: 0o444 },
    );
    await writeFile(
      join(secretsDirectory, "owner-tags"),
      `${payload.configuration.ownerTags.join("\n")}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o444 },
    );
    await writeFile(
      join(temporary, ".env.production"),
      serializeProductionEnvironment(payload, target, deployment),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(temporary, "restore-manifest.json"),
      `${JSON.stringify(
        {
          ...inspectContinuityPayload(payload),
          productionRecovery: {
            ledgerInstallRequired: true,
            ocppDomain: deployment.ocppDomain,
            ownerDomain: deployment.ownerDomain,
            proxyTopologyValidated: false,
          },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }
}

export async function installRecoveredLedger(
  sourcePath: string,
  targetPath: string,
  maximumBytes: number,
): Promise<ContinuityInspection["eventCount"]> {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  if (source === target) throw new ContinuityBundleError("Recovery source and target must differ");
  await assertTargetDoesNotExist(target);
  const sourceStore = new NdjsonEvidenceStore(source, maximumBytes, true);
  const sourceSnapshot = await sourceStore.readSnapshot();
  const sourceArchiveDirectory = `${source}.archives`;
  const targetArchiveDirectory = `${target}.archives`;
  if (sourceSnapshot.archives.length > 0) {
    await assertTargetDoesNotExist(targetArchiveDirectory);
  }
  let archiveCreated = false;
  let targetCreated = false;
  let temporaryArchiveDirectory: string | undefined;
  try {
    if (sourceSnapshot.archives.length > 0) {
      temporaryArchiveDirectory = await mkdtemp(
        join(dirname(target), `.${basename(target)}.archives-install-`),
      );
      for (const segment of sourceSnapshot.archives) {
        const name = archiveSegmentFileName(segment);
        const output = await open(join(temporaryArchiveDirectory, name), "wx", 0o400);
        try {
          await output.writeFile(await readFile(join(sourceArchiveDirectory, name)));
          await output.sync();
        } finally {
          await output.close();
        }
      }
      await rename(temporaryArchiveDirectory, targetArchiveDirectory);
      temporaryArchiveDirectory = undefined;
      archiveCreated = true;
    }
    const targetFile = await open(target, "wx", 0o600);
    targetCreated = true;
    try {
      await targetFile.writeFile(await readFile(source));
      await targetFile.sync();
    } finally {
      await targetFile.close();
    }
    const installed = await new NdjsonEvidenceStore(target, maximumBytes).readSnapshot();
    if (
      JSON.stringify(installed.archives) !== JSON.stringify(sourceSnapshot.archives) ||
      installed.currentEventCount !== sourceSnapshot.currentEventCount ||
      installed.events.length !== sourceSnapshot.events.length ||
      installed.events.at(-1)?.recordHash !== sourceSnapshot.events.at(-1)?.recordHash
    ) {
      throw new ContinuityBundleError("Installed recovery ledger does not match its source");
    }
    return installed.events.length;
  } catch (error) {
    if (targetCreated) await rm(target, { force: true });
    if (archiveCreated) await rm(targetArchiveDirectory, { force: true, recursive: true });
    if (temporaryArchiveDirectory) {
      await rm(temporaryArchiveDirectory, { force: true, recursive: true });
    }
    throw error;
  }
}

export async function readPassphraseFile(path: string): Promise<string> {
  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    throw new ContinuityBundleError("Passphrase path must be a regular, non-symlinked file");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino
    ) {
      throw new ContinuityBundleError("Passphrase file changed while it was being opened");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new ContinuityBundleError("Passphrase file must not be readable by group or others");
    }
    const passphrase = (await file.readFile("utf8")).replace(/[\r\n]+$/, "");
    requireStrongPassphrase(passphrase);
    return passphrase;
  } finally {
    await file.close();
  }
}

export async function readPassphraseStream(input: AsyncIterable<string | Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    size += buffer.length;
    if (size > 4_096) {
      throw new ContinuityBundleError("Continuity passphrase input is too large");
    }
    chunks.push(buffer);
  }
  const passphrase = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/[\r\n]+$/, "");
  if (/[\r\n\0]/u.test(passphrase)) {
    throw new ContinuityBundleError("Continuity passphrase input must contain exactly one line");
  }
  requireStrongPassphrase(passphrase);
  return passphrase;
}

export class ContinuityBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityBundleError";
  }
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    throw new ContinuityBundleError("Unsupported continuity bundle key derivation parameters");
  }
  return new Promise((resolveKey, rejectKey) => {
    deriveKeyWithScrypt(
      passphrase,
      salt,
      KEY_LENGTH,
      { N: n, maxmem: 64 * 1024 * 1024, p, r },
      (error, key) => (error ? rejectKey(error) : resolveKey(key as Buffer)),
    );
  });
}

function continuityAad(createdAt: string): Buffer {
  return Buffer.from(`chargeos-owner-continuity:1:${createdAt}`, "utf8");
}

function parseEnvelope(serialized: string): ContinuityBundleEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ContinuityBundleError("Continuity bundle is not valid JSON");
  }
  if (!isRecord(value) || !isRecord(value.encryption)) {
    throw new ContinuityBundleError("Continuity bundle envelope is malformed");
  }
  const encryption = value.encryption;
  if (
    value.format !== "chargeos-owner-continuity" ||
    value.schemaVersion !== 1 ||
    typeof value.createdAt !== "string" ||
    encryption.algorithm !== ALGORITHM ||
    encryption.kdf !== "scrypt" ||
    typeof encryption.authTag !== "string" ||
    typeof encryption.ciphertext !== "string" ||
    typeof encryption.iv !== "string" ||
    typeof encryption.salt !== "string" ||
    typeof encryption.n !== "number" ||
    typeof encryption.r !== "number" ||
    typeof encryption.p !== "number"
  ) {
    throw new ContinuityBundleError("Continuity bundle envelope is unsupported or malformed");
  }
  return value as unknown as ContinuityBundleEnvelope;
}

function parsePayload(serialized: string): ContinuityPayload {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ContinuityBundleError("Continuity bundle payload is not valid JSON");
  }
  if (!isRecord(value) || !isRecord(value.configuration) || !Array.isArray(value.evidence)) {
    throw new ContinuityBundleError("Continuity bundle payload is malformed");
  }
  const configuration = value.configuration;
  const isLegacyPayload = value.schemaVersion === 1;
  const hasSafetyConfiguration = [2, 3, 4].includes(Number(value.schemaVersion));
  const hasArchiveLayout = value.schemaVersion === 3 || value.schemaVersion === 4;
  const hasCompactedHistory = value.schemaVersion === 4;
  if (
    (!isLegacyPayload && !hasSafetyConfiguration) ||
    typeof value.exportedAt !== "string" ||
    typeof configuration.apiHost !== "string" ||
    typeof configuration.apiPort !== "number" ||
    !(
      configuration.eventLogMaxBytes === undefined ||
      (typeof configuration.eventLogMaxBytes === "number" &&
        Number.isSafeInteger(configuration.eventLogMaxBytes) &&
        configuration.eventLogMaxBytes > 0)
    ) ||
    typeof configuration.heartbeatSeconds !== "number" ||
    typeof configuration.ocppHost !== "string" ||
    (hasSafetyConfiguration &&
      (!isBoundedInteger(configuration.ocppMaxConnections, 1, 100) ||
        !isBoundedInteger(configuration.ocppMaxPayloadBytes, 16_384, 8_388_608) ||
        !isBoundedInteger(configuration.ocppMessageBurst, 1, 10_000) ||
        !isBoundedInteger(configuration.ocppMessagesPerMinute, 1, 60_000) ||
        configuration.ocppMessageBurst > configuration.ocppMessagesPerMinute ||
        typeof configuration.trustProxyHeaders !== "boolean")) ||
    typeof configuration.ownerApiToken !== "string" ||
    !Array.isArray(configuration.ownerTags) ||
    !configuration.ownerTags.every((tag) => typeof tag === "string") ||
    typeof configuration.port !== "number" ||
    typeof configuration.stationId !== "string" ||
    typeof configuration.stationSecret !== "string" ||
    typeof configuration.uiDirectory !== "string" ||
    !value.evidence.every(isEvidenceEvent) ||
    (hasArchiveLayout &&
      (!Array.isArray(value.evidenceArchives) ||
        !value.evidenceArchives.every(isEvidenceArchiveSegment))) ||
    (!hasArchiveLayout && value.evidenceArchives !== undefined) ||
    (hasCompactedHistory && !isEvidenceHistory(value.evidenceHistory)) ||
    (!hasCompactedHistory && value.evidenceHistory !== undefined)
  ) {
    throw new ContinuityBundleError("Continuity bundle payload is unsupported or malformed");
  }
  const payload = value as unknown as ContinuityPayload;
  verifyContinuityEvidence(payload);
  return payload;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function isEvidenceEvent(value: unknown): value is EvidenceEvent {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    ["station-to-csms", "csms-to-station", "system"].includes(String(value.direction)) &&
    typeof value.eventId === "string" &&
    (value.carriedFromRecordHash === undefined ||
      (typeof value.carriedFromRecordHash === "string" &&
        /^[a-f0-9]{64}$/u.test(value.carriedFromRecordHash))) &&
    typeof value.message === "string" &&
    (value.previousRecordHash === null || typeof value.previousRecordHash === "string") &&
    typeof value.recordHash === "string" &&
    typeof value.stationId === "string"
  );
}

function isEvidenceHistory(value: unknown): value is EvidenceHistory {
  return (
    isRecord(value) &&
    value.mode === "compacted-operational" &&
    value.schemaVersion === 1 &&
    Number.isSafeInteger(value.omittedEventCount) &&
    Number(value.omittedEventCount) >= 0 &&
    Number.isSafeInteger(value.retainedEventCount) &&
    Number(value.retainedEventCount) >= 0 &&
    Array.isArray(value.custody) &&
    value.custody.length > 0 &&
    value.custody.every(isEvidenceCustodyRecord)
  );
}

function isEvidenceCustodyRecord(value: unknown): value is EvidenceCustodyRecord {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.archiveSegmentCount) &&
    Number(value.archiveSegmentCount) >= 0 &&
    typeof value.bundleSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.bundleSha256) &&
    Number.isSafeInteger(value.eventCount) &&
    Number(value.eventCount) >= 0 &&
    typeof value.exportedAt === "string" &&
    normalizedIso(value.exportedAt) &&
    (value.lastRecordHash === null ||
      (typeof value.lastRecordHash === "string" && /^[a-f0-9]{64}$/u.test(value.lastRecordHash))) &&
    [1, 2, 3, 4].includes(Number(value.payloadSchemaVersion))
  );
}

function isEvidenceArchiveSegment(value: unknown): value is EvidenceArchiveSegment {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.eventCount) &&
    Number(value.eventCount) > 0 &&
    typeof value.firstRecordHash === "string" &&
    /^[a-f0-9]{64}$/u.test(value.firstRecordHash) &&
    typeof value.lastRecordHash === "string" &&
    /^[a-f0-9]{64}$/u.test(value.lastRecordHash) &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decodeBase64(value: string, field: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new ContinuityBundleError(`Continuity bundle ${field} is not canonical base64`);
  }
  return decoded;
}

function requireStrongPassphrase(passphrase: string): void {
  if (passphrase.length < 16) {
    throw new ContinuityBundleError("Continuity passphrase must be at least 16 characters");
  }
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new ContinuityBundleError("Restore target already exists; choose a new directory");
}

function verifyContinuityEvidence(payload: ContinuityPayload): void {
  verifyEvidenceChain(payload.evidence);
  validateEvidenceArchiveLayout(payload.evidence, continuityEvidenceArchives(payload));
  if (payload.schemaVersion === 4) {
    verifyCompactedEvidenceHistory(payload);
  }
}

function continuityEvidenceArchives(payload: ContinuityPayload): readonly EvidenceArchiveSegment[] {
  if (payload.schemaVersion !== 3 && payload.schemaVersion !== 4) return [];
  if (!payload.evidenceArchives) {
    throw new ContinuityBundleError("Continuity archive layout is missing");
  }
  return payload.evidenceArchives;
}

function verifyCompactedEvidenceHistory(payload: ContinuityPayload): void {
  const history = payload.evidenceHistory;
  if (!history || !isEvidenceHistory(history)) {
    throw new ContinuityBundleError("Compacted evidence history is missing or malformed");
  }
  const checkpoint = payload.evidence.findLast(
    (event) => event.message === "EvidenceHistoryCompacted" && event.direction === "system",
  );
  const checkpointPayload = recordValue(checkpoint?.payload);
  const custodiedEventCount = history.custody.reduce(
    (total, record) => total + record.eventCount,
    0,
  );
  if (
    checkpoint?.stationId !== payload.configuration.stationId ||
    checkpointPayload.schemaVersion !== history.schemaVersion ||
    checkpointPayload.mode !== history.mode ||
    JSON.stringify(checkpointPayload.custody) !== JSON.stringify(history.custody) ||
    checkpointPayload.custodyBundleCount !== history.custody.length ||
    checkpointPayload.custodiedEventCount !== custodiedEventCount ||
    checkpointPayload.latestCustodyBundleSha256 !== history.custody.at(-1)?.bundleSha256 ||
    checkpointPayload.omittedEventCount !== history.omittedEventCount ||
    checkpointPayload.retainedEventCount !== history.retainedEventCount
  ) {
    throw new ContinuityBundleError(
      "Compacted evidence checkpoint does not match custody metadata",
    );
  }
}

function validateEvidenceArchiveLayout(
  events: readonly EvidenceEvent[],
  archives: readonly EvidenceArchiveSegment[],
): void {
  let offset = 0;
  for (const [index, segment] of archives.entries()) {
    if (segment.sequence !== index + 1 || segment.eventCount < 1) {
      throw new ContinuityBundleError("Continuity archive sequence is invalid");
    }
    const segmentEvents = events.slice(offset, offset + segment.eventCount);
    if (segmentEvents.length !== segment.eventCount) {
      throw new ContinuityBundleError("Continuity archive layout exceeds its evidence chain");
    }
    offset += segment.eventCount;
    const serialized = serializeEvents(segmentEvents);
    const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
    if (
      segment.firstRecordHash !== segmentEvents[0]!.recordHash ||
      segment.lastRecordHash !== segmentEvents.at(-1)!.recordHash ||
      segment.sha256 !== sha256
    ) {
      throw new ContinuityBundleError("Continuity archive metadata does not match its evidence");
    }
  }
}

function serializeEvents(events: readonly EvidenceEvent[]): string {
  return events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
}

function compactOperationalEvidence(events: readonly EvidenceEvent[]): readonly EvidenceEvent[] {
  const keep = events.map(() => true);
  const latestStatusByConnector = new Map<number, number>();
  const delegateUseIndexes: number[] = [];
  const rateLimitIndexes: number[] = [];
  const protocolRejectionIndexes: number[] = [];
  const replayCountByTransaction = new Map<number, number>();
  const meterFingerprints = new Map<number, Set<string>>();
  const retainedMeterCount = new Map<number, number>();
  const stopFingerprints = new Map<number, Set<string>>();
  const retainedUniqueStopCount = new Map<number, number>();

  for (const [index, event] of events.entries()) {
    const payload = recordValue(event.payload);
    if (event.message === "Heartbeat") {
      keep[index] = false;
      continue;
    }
    if (
      event.message === "EvidenceSegmentArchived" ||
      event.message === "EvidenceHistoryCompacted"
    ) {
      keep[index] = false;
      continue;
    }
    if (event.message === "StatusNotification" && Number.isSafeInteger(payload.connectorId)) {
      const connectorId = Number(payload.connectorId);
      const previous = latestStatusByConnector.get(connectorId);
      if (previous !== undefined) keep[previous] = false;
      latestStatusByConnector.set(connectorId, index);
      continue;
    }
    if (event.message === "DelegateCapabilityUsed") {
      delegateUseIndexes.push(index);
      continue;
    }
    if (event.message === "ProtocolRateLimitExceeded") {
      rateLimitIndexes.push(index);
      continue;
    }
    if (event.message === "ProtocolMessageRejected" && event.direction === "system") {
      protocolRejectionIndexes.push(index);
      continue;
    }
    if (event.message === "StartTransaction" && Number.isSafeInteger(payload.transactionId)) {
      const transactionId = Number(payload.transactionId);
      const carriedCount = Number.isSafeInteger(payload.compactedReplayCount)
        ? Number(payload.compactedReplayCount)
        : 0;
      replayCountByTransaction.set(
        transactionId,
        (replayCountByTransaction.get(transactionId) ?? 0) + Math.max(0, carriedCount),
      );
      continue;
    }
    if (event.message === "StartTransactionReplay" && Number.isSafeInteger(payload.transactionId)) {
      incrementCompactedReplay(replayCountByTransaction, Number(payload.transactionId));
      keep[index] = false;
      continue;
    }
    if (event.message === "MeterValues" && Number.isSafeInteger(payload.transactionId)) {
      const transactionId = Number(payload.transactionId);
      const fingerprint = compactedEvidenceFingerprint(event, payload);
      const fingerprints = meterFingerprints.get(transactionId) ?? new Set<string>();
      if (fingerprints.has(fingerprint)) {
        incrementCompactedReplay(replayCountByTransaction, transactionId);
        keep[index] = false;
      } else {
        fingerprints.add(fingerprint);
        meterFingerprints.set(transactionId, fingerprints);
        const retainedCount = retainedMeterCount.get(transactionId) ?? 0;
        if (retainedCount >= 1) keep[index] = false;
        else retainedMeterCount.set(transactionId, 1);
      }
      continue;
    }
    if (event.message === "StopTransaction" && Number.isSafeInteger(payload.transactionId)) {
      const transactionId = Number(payload.transactionId);
      const fingerprint = compactedEvidenceFingerprint(event, payload);
      const fingerprints = stopFingerprints.get(transactionId) ?? new Set<string>();
      if (fingerprints.has(fingerprint)) {
        incrementCompactedReplay(replayCountByTransaction, transactionId);
        keep[index] = false;
      } else {
        fingerprints.add(fingerprint);
        stopFingerprints.set(transactionId, fingerprints);
        const retainedCount = retainedUniqueStopCount.get(transactionId) ?? 0;
        if (retainedCount >= 2) keep[index] = false;
        else retainedUniqueStopCount.set(transactionId, retainedCount + 1);
      }
    }
  }

  for (const index of delegateUseIndexes.slice(0, -100)) keep[index] = false;
  for (const index of rateLimitIndexes.slice(0, -20)) keep[index] = false;
  for (const index of protocolRejectionIndexes.slice(0, -20)) keep[index] = false;

  return events.flatMap((event, index) => {
    if (!keep[index]) return [];
    if (event.message !== "StartTransaction") return [event];
    const payload = recordValue(event.payload);
    if (!Number.isSafeInteger(payload.transactionId)) return [event];
    const replayCount = replayCountByTransaction.get(Number(payload.transactionId)) ?? 0;
    return [
      {
        ...event,
        payload: replayCount > 0 ? { ...payload, compactedReplayCount: replayCount } : payload,
      },
    ];
  });
}

function incrementCompactedReplay(counts: Map<number, number>, transactionId: number): void {
  counts.set(transactionId, (counts.get(transactionId) ?? 0) + 1);
}

function compactedEvidenceFingerprint(
  event: EvidenceEvent,
  payload: Record<string, unknown>,
): string {
  return event.sourcePayloadHmac ?? JSON.stringify(payload);
}

function carryEvidenceEvent(event: EvidenceEvent): EvidenceEvent {
  return {
    at: event.at,
    carriedFromRecordHash: event.carriedFromRecordHash ?? event.recordHash!,
    direction: event.direction,
    eventId: event.eventId,
    message: event.message,
    payload: event.payload,
    ...(event.sourcePayloadHmac ? { sourcePayloadHmac: event.sourcePayloadHmac } : {}),
    stationId: event.stationId,
  };
}

function verifyCarriedEvidenceMatchesSource(
  compacted: ContinuityPayload,
  source: ContinuityPayload,
): void {
  const checkpointIndex = compacted.evidence.findLastIndex(
    (event) => event.message === "EvidenceHistoryCompacted" && event.direction === "system",
  );
  const expected = compactOperationalEvidence(source.evidence).map(carryEvidenceEvent);
  const actual = checkpointIndex < 0 ? [] : compacted.evidence.slice(0, checkpointIndex);
  if (
    actual.length !== expected.length ||
    actual.some(
      (event, index) =>
        JSON.stringify(carriedEvidenceIdentity(event)) !==
        JSON.stringify(carriedEvidenceIdentity(expected[index]!)),
    )
  ) {
    throw new ContinuityBundleError(
      "Compacted carry-forward records do not match the custodied source bundle",
    );
  }
}

function carriedEvidenceIdentity(
  event: EvidenceEvent,
): Omit<EvidenceEvent, "previousRecordHash" | "recordHash"> {
  return {
    at: event.at,
    ...(event.carriedFromRecordHash ? { carriedFromRecordHash: event.carriedFromRecordHash } : {}),
    direction: event.direction,
    eventId: event.eventId,
    message: event.message,
    payload: event.payload,
    ...(event.sourcePayloadHmac ? { sourcePayloadHmac: event.sourcePayloadHmac } : {}),
    stationId: event.stationId,
  };
}

function evidenceHistoryFromEvents(events: readonly EvidenceEvent[]): EvidenceHistory | null {
  const checkpoint = events.findLast(
    (event) => event.message === "EvidenceHistoryCompacted" && event.direction === "system",
  );
  if (!checkpoint) return null;
  const payload = recordValue(checkpoint.payload);
  const candidate = {
    custody: payload.custody,
    mode: payload.mode,
    omittedEventCount: payload.omittedEventCount,
    retainedEventCount: payload.retainedEventCount,
    schemaVersion: payload.schemaVersion,
  };
  if (!isEvidenceHistory(candidate)) {
    throw new ContinuityBundleError("Stored compacted evidence checkpoint is malformed");
  }
  return candidate;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizedIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

async function writeContinuityEvidence(
  payload: ContinuityPayload,
  eventLogPath: string,
  currentMode: number,
  archiveMode: number,
  archiveDirectoryMode: number,
  createEmptyArchiveDirectory = false,
): Promise<void> {
  const archives = continuityEvidenceArchives(payload);
  let offset = 0;
  if (archives.length > 0 || createEmptyArchiveDirectory) {
    const archiveDirectory = `${eventLogPath}.archives`;
    await mkdir(archiveDirectory, { mode: 0o700 });
    for (const segment of archives) {
      const events = payload.evidence.slice(offset, offset + segment.eventCount);
      offset += segment.eventCount;
      await writeFile(
        join(archiveDirectory, archiveSegmentFileName(segment)),
        serializeEvents(events),
        {
          encoding: "utf8",
          flag: "wx",
          mode: archiveMode,
        },
      );
    }
    await chmod(archiveDirectory, archiveDirectoryMode);
  }
  await writeFile(eventLogPath, serializeEvents(payload.evidence.slice(offset)), {
    encoding: "utf8",
    flag: "wx",
    mode: currentMode,
  });
}

function archiveSegmentFileName(segment: EvidenceArchiveSegment): string {
  return `segment-${String(segment.sequence).padStart(8, "0")}-${segment.sha256}.ndjson`;
}

function serializeEnvironment(
  configuration: ContinuityPayload["configuration"],
  eventLogPath: string,
): string {
  const variables = {
    CHARGEOS_API_HOST: configuration.apiHost,
    CHARGEOS_API_PORT: String(configuration.apiPort),
    CHARGEOS_EVENT_LOG: eventLogPath,
    CHARGEOS_EVENT_LOG_MAX_BYTES: String(configuration.eventLogMaxBytes ?? 268_435_456),
    CHARGEOS_HEARTBEAT_SECONDS: String(configuration.heartbeatSeconds),
    CHARGEOS_OCPP_HOST: configuration.ocppHost,
    CHARGEOS_OCPP_MAX_CONNECTIONS: String(configuration.ocppMaxConnections ?? 8),
    CHARGEOS_OCPP_MAX_PAYLOAD_BYTES: String(configuration.ocppMaxPayloadBytes ?? 1_048_576),
    CHARGEOS_OCPP_MESSAGE_BURST: String(configuration.ocppMessageBurst ?? 60),
    CHARGEOS_OCPP_MESSAGES_PER_MINUTE: String(configuration.ocppMessagesPerMinute ?? 600),
    CHARGEOS_OWNER_API_TOKEN: configuration.ownerApiToken,
    CHARGEOS_OWNER_TAGS: configuration.ownerTags.join(","),
    CHARGEOS_PORT: String(configuration.port),
    CHARGEOS_STATION_ID: configuration.stationId,
    CHARGEOS_STATION_SECRET: configuration.stationSecret,
    CHARGEOS_TRUST_PROXY_HEADERS: "false",
    CHARGEOS_UI_DIRECTORY: configuration.uiDirectory,
  };
  return `${Object.entries(variables)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function serializeProductionEnvironment(
  payload: ContinuityPayload,
  target: string,
  metadata: ProductionRecoveryMetadata,
): string {
  const configuration = payload.configuration;
  const variables = {
    CHARGEOS_ACME_EMAIL: metadata.acmeEmail,
    CHARGEOS_EVENT_LOG_MAX_BYTES: String(configuration.eventLogMaxBytes ?? 268_435_456),
    CHARGEOS_OCPP_DOMAIN: metadata.ocppDomain,
    CHARGEOS_OCPP_MAX_CONNECTIONS: String(configuration.ocppMaxConnections ?? 8),
    CHARGEOS_OCPP_MAX_PAYLOAD_BYTES: String(configuration.ocppMaxPayloadBytes ?? 1_048_576),
    CHARGEOS_OCPP_MESSAGE_BURST: String(configuration.ocppMessageBurst ?? 60),
    CHARGEOS_OCPP_MESSAGES_PER_MINUTE: String(configuration.ocppMessagesPerMinute ?? 600),
    CHARGEOS_OWNER_API_TOKEN_PATH: join(target, "secrets", "owner-api-token"),
    CHARGEOS_OWNER_DOMAIN: metadata.ownerDomain,
    CHARGEOS_OWNER_TAGS_PATH: join(target, "secrets", "owner-tags"),
    CHARGEOS_STATION_ID: configuration.stationId,
    CHARGEOS_STATION_SECRET_PATH: join(target, "secrets", "station-secret"),
  };
  return `${Object.entries(variables)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function productionRecoveryMetadata(
  metadata: ProductionRecoveryMetadata,
): ProductionRecoveryMetadata {
  const ocppDomain = productionHostname(metadata.ocppDomain, "ocppDomain");
  const ownerDomain = productionHostname(metadata.ownerDomain, "ownerDomain");
  if (ocppDomain === ownerDomain) {
    throw new ContinuityBundleError("Production recovery requires separate OCPP and owner domains");
  }
  const acmeEmail = metadata.acmeEmail.trim().toLowerCase();
  if (
    acmeEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(acmeEmail) ||
    /[\r\n\0]/u.test(acmeEmail)
  ) {
    throw new ContinuityBundleError("Production recovery ACME email is invalid");
  }
  return { acmeEmail, ocppDomain, ownerDomain };
}

function productionHostname(value: string, name: string): string {
  const hostname = value.trim().toLowerCase();
  if (
    hostname.length > 253 ||
    hostname === "localhost" ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    !hostname
      .split(".")
      .every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
      )
  ) {
    throw new ContinuityBundleError(`Production recovery ${name} must be a DNS hostname`);
  }
  return hostname;
}
