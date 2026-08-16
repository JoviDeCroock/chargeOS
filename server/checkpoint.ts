import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { inspectContinuityPayload, type ContinuityPayload } from "./continuity.js";

const CHECKPOINT_FIELDS = [
  "algorithm",
  "createdAt",
  "eventCount",
  "evidenceExportedAt",
  "format",
  "lastRecordHash",
  "publicKeySha256",
  "schemaVersion",
  "signature",
  "stationId",
] as const;

export interface EvidenceCheckpoint {
  readonly algorithm: "Ed25519";
  readonly createdAt: string;
  readonly eventCount: number;
  readonly evidenceExportedAt: string;
  readonly format: "chargeos-evidence-checkpoint";
  readonly lastRecordHash: string | null;
  readonly publicKeySha256: string;
  readonly schemaVersion: 1;
  readonly signature: string;
  readonly stationId: string;
}

type UnsignedEvidenceCheckpoint = Omit<EvidenceCheckpoint, "signature">;

export interface EvidenceSigningKeyManifest {
  readonly algorithm: "Ed25519";
  readonly createdAt: string;
  readonly privateKeyFile: "private-key.pem";
  readonly publicKeyFile: "public-key.pem";
  readonly publicKeySha256: string;
  readonly schemaVersion: 1;
}

export async function writeEvidenceSigningKeyPair(
  targetDirectory: string,
  passphrase: string,
): Promise<EvidenceSigningKeyManifest> {
  requireKeyPassphrase(passphrase);
  const target = resolve(targetDirectory);
  if (target === "/" || basename(target) === "") {
    throw new EvidenceCheckpointError("Refusing to create signing keys at a broad target");
  }
  await assertTargetDoesNotExist(target);
  const temporary = await mkdtemp(join(dirname(target), ".chargeos-signing-key-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({
      cipher: "aes-256-cbc",
      format: "pem",
      passphrase,
      type: "pkcs8",
    });
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
    const manifest: EvidenceSigningKeyManifest = {
      algorithm: "Ed25519",
      createdAt: new Date().toISOString(),
      privateKeyFile: "private-key.pem",
      publicKeyFile: "public-key.pem",
      publicKeySha256: fingerprintPublicKey(publicKey),
      schemaVersion: 1,
    };
    await writeFile(join(temporary, manifest.privateKeyFile), privateKeyPem, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(temporary, manifest.publicKeyFile), publicKeyPem, {
      flag: "wx",
      mode: 0o644,
    });
    await writeFile(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, target);
    return manifest;
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }
}

export async function readEvidencePrivateKey(path: string): Promise<string> {
  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    throw new EvidenceCheckpointError("Signing key must be a regular, non-symlinked file");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino
    ) {
      throw new EvidenceCheckpointError("Signing key changed while it was being opened");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new EvidenceCheckpointError("Signing key must not be accessible by group or others");
    }
    return file.readFile("utf8");
  } finally {
    await file.close();
  }
}

export function createEvidenceCheckpoint(
  payload: ContinuityPayload,
  privateKeyPem: string,
  keyPassphrase: string,
): EvidenceCheckpoint {
  requireKeyPassphrase(keyPassphrase);
  const privateKey = openPrivateKey(privateKeyPem, keyPassphrase);
  const publicKey = createPublicKey(privateKey);
  const inspection = inspectContinuityPayload(payload);
  const unsigned: UnsignedEvidenceCheckpoint = {
    algorithm: "Ed25519",
    createdAt: new Date().toISOString(),
    eventCount: inspection.eventCount,
    evidenceExportedAt: inspection.exportedAt,
    format: "chargeos-evidence-checkpoint",
    lastRecordHash: inspection.lastRecordHash,
    publicKeySha256: fingerprintPublicKey(publicKey),
    schemaVersion: 1,
    stationId: inspection.stationId,
  };
  return {
    ...unsigned,
    signature: sign(null, canonicalCheckpoint(unsigned), privateKey).toString("base64"),
  };
}

export function verifyEvidenceCheckpoint(
  serialized: string,
  publicKeyPem: string,
): EvidenceCheckpoint {
  const checkpoint = parseCheckpoint(serialized);
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new EvidenceCheckpointError("Evidence checkpoint public key is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new EvidenceCheckpointError("Evidence checkpoint requires an Ed25519 public key");
  }
  if (fingerprintPublicKey(publicKey) !== checkpoint.publicKeySha256) {
    throw new EvidenceCheckpointError("Evidence checkpoint public key fingerprint does not match");
  }
  const signature = decodeCanonicalBase64(checkpoint.signature);
  if (!verify(null, canonicalCheckpoint(unsignedCheckpoint(checkpoint)), publicKey, signature)) {
    throw new EvidenceCheckpointError("Evidence checkpoint signature is invalid");
  }
  return checkpoint;
}

export function compareEvidenceCheckpoint(
  checkpoint: EvidenceCheckpoint,
  payload: ContinuityPayload,
): void {
  const inspection = inspectContinuityPayload(payload);
  if (
    checkpoint.stationId !== inspection.stationId ||
    checkpoint.evidenceExportedAt !== inspection.exportedAt ||
    checkpoint.eventCount !== inspection.eventCount ||
    checkpoint.lastRecordHash !== inspection.lastRecordHash
  ) {
    throw new EvidenceCheckpointError("Evidence checkpoint does not match the continuity bundle");
  }
}

export class EvidenceCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceCheckpointError";
  }
}

function openPrivateKey(privateKeyPem: string, passphrase: string): KeyObject {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ format: "pem", key: privateKeyPem, passphrase });
  } catch {
    throw new EvidenceCheckpointError("Evidence signing key could not be opened");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new EvidenceCheckpointError("Evidence signing key must be Ed25519");
  }
  return privateKey;
}

function fingerprintPublicKey(publicKey: KeyObject): string {
  return createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
}

function canonicalCheckpoint(checkpoint: UnsignedEvidenceCheckpoint): Buffer {
  return Buffer.from(JSON.stringify(checkpoint), "utf8");
}

function unsignedCheckpoint(checkpoint: EvidenceCheckpoint): UnsignedEvidenceCheckpoint {
  return {
    algorithm: checkpoint.algorithm,
    createdAt: checkpoint.createdAt,
    eventCount: checkpoint.eventCount,
    evidenceExportedAt: checkpoint.evidenceExportedAt,
    format: checkpoint.format,
    lastRecordHash: checkpoint.lastRecordHash,
    publicKeySha256: checkpoint.publicKeySha256,
    schemaVersion: checkpoint.schemaVersion,
    stationId: checkpoint.stationId,
  };
}

function parseCheckpoint(serialized: string): EvidenceCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new EvidenceCheckpointError("Evidence checkpoint is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EvidenceCheckpointError("Evidence checkpoint is malformed");
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...CHECKPOINT_FIELDS].sort()) ||
    record.algorithm !== "Ed25519" ||
    record.format !== "chargeos-evidence-checkpoint" ||
    record.schemaVersion !== 1 ||
    !isCanonicalTimestamp(record.createdAt) ||
    !isCanonicalTimestamp(record.evidenceExportedAt) ||
    typeof record.stationId !== "string" ||
    !Number.isSafeInteger(record.eventCount) ||
    (record.eventCount as number) < 0 ||
    !(
      record.lastRecordHash === null ||
      (typeof record.lastRecordHash === "string" && /^[a-f0-9]{64}$/u.test(record.lastRecordHash))
    ) ||
    typeof record.publicKeySha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.publicKeySha256) ||
    typeof record.signature !== "string"
  ) {
    throw new EvidenceCheckpointError("Evidence checkpoint is malformed");
  }
  decodeCanonicalBase64(record.signature);
  return record as unknown as EvidenceCheckpoint;
}

function decodeCanonicalBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    throw new EvidenceCheckpointError("Evidence checkpoint signature is not canonical base64");
  }
  return decoded;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

async function assertTargetDoesNotExist(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new EvidenceCheckpointError("Signing-key target already exists; choose a new directory");
}

function requireKeyPassphrase(passphrase: string): void {
  if (passphrase.length < 16) {
    throw new EvidenceCheckpointError(
      "Evidence signing-key passphrase must be at least 16 characters",
    );
  }
}
