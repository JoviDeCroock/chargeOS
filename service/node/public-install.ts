import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, realpath, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { publicServiceOrigin } from "../configuration.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import { exactObject, MAX_COMMERCIAL_DATABASE_BYTES } from "./recovery-crypto.js";
import { inspectNativeCommercialDatabase } from "./recovery.js";
import {
  readPrivateRecoveryFile,
  syncRecoveryDirectory,
  writePrivateRecoveryFile,
} from "./recovery-files.js";
import { handoffDigest, parseNativeHandoff } from "./handoff-marker.js";
import { handoffStateDigest } from "./handoff-state.js";
import { withNativeStoppedServiceCustody } from "./service-custody.js";

interface Installation {
  format: "chargeos-native-public-install";
  schemaVersion: 1;
  handoffId: string;
  releaseId: string;
  origin: string;
  databaseSha256: string;
  handoffSha256: string;
}
interface Journal {
  format: "chargeos-native-public-install-journal";
  schemaVersion: 1;
  handoffId: string;
  origin: string;
  databaseSha256: string;
  handoffSha256: string;
  directoryDevice: string;
  directoryInode: string;
  stageDevice: string;
  stageInode: string;
  fileDevice: string;
  fileInode: string;
}
type InstallHooks = {
  at?: (stage: "before-link" | "after-link" | "after-unlink") => Promise<void>;
};
const failure = () =>
  new Error("Public installation refused; retain the capsule and stopped-installation custody");
function parseInstallation(raw: string, bytes: Buffer, origin: string): Installation {
  if (
    Buffer.byteLength(raw) > 16384 ||
    !publicServiceOrigin(origin) ||
    bytes.length > MAX_COMMERCIAL_DATABASE_BYTES ||
    bytes.subarray(0, 16).toString("binary") !== "SQLite format 3\0"
  )
    throw failure();
  const value: unknown = JSON.parse(raw);
  exactObject(value, [
    "format",
    "schemaVersion",
    "handoffId",
    "releaseId",
    "origin",
    "databaseSha256",
    "handoffSha256",
  ]);
  if (
    value.format !== "chargeos-native-public-install" ||
    value.schemaVersion !== 1 ||
    value.origin !== origin ||
    typeof value.handoffId !== "string" ||
    typeof value.releaseId !== "string" ||
    typeof value.handoffSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.handoffSha256) ||
    value.databaseSha256 !== handoffDigest(bytes)
  )
    throw failure();
  return value as unknown as Installation;
}
async function activePublic(
  database: NativeCommercialDatabase,
  secret: string,
  installation: Installation,
): Promise<string> {
  if (database.recoveryState(secret, false, installation.origin) !== "released") throw failure();
  const serialized = await database
    .prepare("SELECT receipt_json FROM _chargeos_native_handoff WHERE id=1")
    .first<string>("receipt_json");
  if (!serialized || handoffDigest(serialized) !== installation.handoffSha256) throw failure();
  const h = parseNativeHandoff(serialized, secret);
  if (
    h.role !== "public-install" ||
    h.handoffId !== installation.handoffId ||
    h.releaseId !== installation.releaseId ||
    h.targetOrigin !== installation.origin
  )
    throw failure();
  return serialized;
}
async function verifiedIncoming(bytes: Buffer, secret: string, installation: Installation) {
  const path = await mkdtemp(join(tmpdir(), "chargeos-install-input-"));
  let database: NativeCommercialDatabase | undefined;
  try {
    await writePrivateRecoveryFile(join(path, "commercial.sqlite"), bytes);
    database = new NativeCommercialDatabase(path, { recoveryInspection: true });
    const serialized = await activePublic(database, secret, installation),
      h = parseNativeHandoff(serialized, secret);
    if ((await handoffStateDigest(database, h.handoffId)) !== h.candidateStateSha256)
      throw failure();
    for (const table of ["session", "verification", "local_outbox", "rate_limit"])
      if ((await database.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n")) !== 0)
        throw failure();
    if (
      (await database
        .prepare("SELECT count(*) AS n FROM invitation WHERE status='pending'")
        .first<number>("n")) !== 0
    )
      throw failure();
    await inspectNativeCommercialDatabase(database, "released");
  } finally {
    database?.close();
    await rm(path, { recursive: true, force: true });
  }
}
const sealJournal = (journal: Journal, secret: string) =>
  JSON.stringify({
    journal,
    mac: createHmac("sha256", secret)
      .update("chargeos-native-public-install-journal:1\0")
      .update(JSON.stringify(journal))
      .digest("hex"),
  });
async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw failure();
  return info;
}
async function loadJournal(
  directory: string,
  secret: string,
  installation: Installation,
): Promise<Journal> {
  const raw = (
      await readPrivateRecoveryFile(join(directory, ".public-install/journal.json"), 16384)
    ).toString("utf8"),
    value: unknown = JSON.parse(raw);
  exactObject(value, ["journal", "mac"]);
  const j = value.journal;
  exactObject(j, [
    "format",
    "schemaVersion",
    "handoffId",
    "origin",
    "databaseSha256",
    "handoffSha256",
    "directoryDevice",
    "directoryInode",
    "stageDevice",
    "stageInode",
    "fileDevice",
    "fileInode",
  ]);
  if (
    j.format !== "chargeos-native-public-install-journal" ||
    j.schemaVersion !== 1 ||
    j.handoffId !== installation.handoffId ||
    j.origin !== installation.origin ||
    j.databaseSha256 !== installation.databaseSha256 ||
    j.handoffSha256 !== installation.handoffSha256 ||
    typeof value.mac !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.mac)
  )
    throw failure();
  for (const key of [
    "directoryDevice",
    "directoryInode",
    "stageDevice",
    "stageInode",
    "fileDevice",
    "fileInode",
  ])
    if (typeof j[key] !== "string" || !/^(?:0|[1-9][0-9]{0,31})$/.test(j[key])) throw failure();
  const journal = j as unknown as Journal,
    expected = JSON.parse(sealJournal(journal, secret)).mac as string;
  if (!timingSafeEqual(Buffer.from(value.mac, "hex"), Buffer.from(expected, "hex")))
    throw failure();
  const root = await privateDirectory(directory),
    stage = await privateDirectory(join(directory, ".public-install"));
  if (
    String(root.dev) !== journal.directoryDevice ||
    String(root.ino) !== journal.directoryInode ||
    String(stage.dev) !== journal.stageDevice ||
    String(stage.ino) !== journal.stageInode
  )
    throw failure();
  return journal;
}
async function publicationFile(
  path: string,
  journal: Journal,
  maximumLinks: number,
  bytes?: Buffer,
) {
  const original = await lstat(path),
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      original.isSymbolicLink() ||
      info.nlink !== maximumLinks ||
      (info.mode & 0o077) !== 0 ||
      String(info.dev) !== journal.fileDevice ||
      String(info.ino) !== journal.fileInode ||
      original.dev !== info.dev ||
      original.ino !== info.ino ||
      (bytes && info.size > MAX_COMMERCIAL_DATABASE_BYTES)
    )
      throw failure();
    if (bytes) {
      const hash = createHash("sha256");
      let size = 0;
      for (;;) {
        const chunk = Buffer.alloc(Math.min(16384, bytes.length + 1 - size)),
          { bytesRead } = await file.read(chunk);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > bytes.length) throw failure();
        hash.update(chunk.subarray(0, bytesRead));
      }
      if (size !== bytes.length || hash.digest("hex") !== journal.databaseSha256) throw failure();
    }
    const after = await file.stat(),
      current = await lstat(path);
    if (
      (bytes &&
        (after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs ||
          after.ctimeMs !== info.ctimeMs)) ||
      after.nlink !== info.nlink ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.isSymbolicLink()
    )
      throw failure();
  } finally {
    await file.close();
  }
}
async function existingInstallation(directory: string, secret: string, installation: Installation) {
  const journal = await loadJournal(directory, secret, installation);
  await publicationFile(join(directory, "commercial.sqlite"), journal, 1);
  const database = new NativeCommercialDatabase(directory, {
    recoveryInspection: true,
    readOnly: true,
  });
  try {
    await activePublic(database, secret, installation);
  } finally {
    database.close();
  }
  return {
    status: "already-installed" as const,
    handoffId: installation.handoffId,
    origin: installation.origin,
  };
}

/** Input validation always precedes idempotence. New publication stages on the
 * same volume, validates the finished DB, then uses a create-only hardlink.
 * A signed inode-bound journal can finish ONLY that exact interrupted pair. */
export async function installNativePublicHandoff(
  bytes: Buffer,
  secret: string,
  manifest: string,
  directory: string,
  origin: string,
  hooks: InstallHooks = {},
) {
  if (
    secret.length < 32 ||
    secret.length > 4096 ||
    secret.trim() !== secret ||
    /[\0\r\n]/.test(secret)
  )
    throw failure();
  const installation = parseInstallation(manifest, bytes, origin);
  await verifiedIncoming(bytes, secret, installation);
  directory = resolve(directory);
  await privateDirectory(directory);
  directory = await realpath(directory);
  const target = join(directory, "commercial.sqlite"),
    stage = join(directory, ".public-install"),
    staged = join(stage, "commercial.sqlite");
  const existing = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.nlink === 1) return existingInstallation(directory, secret, installation);
  return withNativeStoppedServiceCustody(directory, async () => {
    let journal: Journal;
    const marker = await lstat(stage).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!marker) {
      const entries = await (await import("node:fs/promises")).readdir(directory);
      if (existing || entries.some((name) => name !== ".recovery-lifecycle")) throw failure();
      await mkdir(stage, { mode: 0o700 });
      await writePrivateRecoveryFile(staged, bytes);
      const root = await privateDirectory(directory),
        privateStage = await privateDirectory(stage),
        file = await lstat(staged);
      journal = {
        format: "chargeos-native-public-install-journal",
        schemaVersion: 1,
        handoffId: installation.handoffId,
        origin: installation.origin,
        databaseSha256: installation.databaseSha256,
        handoffSha256: installation.handoffSha256,
        directoryDevice: String(root.dev),
        directoryInode: String(root.ino),
        stageDevice: String(privateStage.dev),
        stageInode: String(privateStage.ino),
        fileDevice: String(file.dev),
        fileInode: String(file.ino),
      };
      // The already-verified exact bytes are flushed before this durable intent.
      await writePrivateRecoveryFile(join(stage, "journal.json"), sealJournal(journal, secret));
      await syncRecoveryDirectory(stage);
      await syncRecoveryDirectory(directory);
    } else journal = await loadJournal(directory, secret, installation);
    const current = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current) {
      if (current.nlink !== 2) throw failure();
      await publicationFile(target, journal, 2, bytes);
      await publicationFile(staged, journal, 2, bytes);
    } else {
      await publicationFile(staged, journal, 1, bytes);
      await hooks.at?.("before-link");
      await link(staged, target);
      await syncRecoveryDirectory(directory);
      await hooks.at?.("after-link");
      await publicationFile(target, journal, 2, bytes);
      await publicationFile(staged, journal, 2, bytes);
    }
    await unlink(staged);
    await syncRecoveryDirectory(stage);
    await syncRecoveryDirectory(directory);
    await hooks.at?.("after-unlink");
    const result = await existingInstallation(directory, secret, installation);
    return { ...result, status: "installed" as const };
  });
}
