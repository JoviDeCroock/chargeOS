import { recoverySourceOrigin } from "./recovery-origin.js";
import { NATIVE_HANDOFF_SQL, NATIVE_HANDOFF_HISTORY_SQL } from "./handoff-marker.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceConfiguration, type ServiceSettings } from "../configuration.js";
import { financialJournal, readFinancialData } from "../reimbursement-journal.js";
import { validateSupportHistory } from "../support-history.js";
import { migrateNativeDatabase, readNativeMigrations } from "./migrations.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import {
  decodeCommercialBase64,
  exactObject,
  MAX_COMMERCIAL_DATABASE_BYTES,
  MAX_COMMERCIAL_ENVELOPE_BYTES,
  openCommercialPayload,
  sealCommercialPayload,
} from "./recovery-crypto.js";
import {
  readPrivateRecoveryFile,
  syncRecoveryDirectory,
  writePrivateRecoveryFile,
} from "./recovery-files.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
import {
  NATIVE_RECOVERY_QUARANTINE_SQL,
  NATIVE_RECOVERY_RELEASE_SQL,
  NATIVE_RECOVERY_HISTORY_SQL,
} from "./recovery-marker.js";
export { NATIVE_RECOVERY_QUARANTINE_SQL } from "./recovery-marker.js";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Configuration = ServiceSettings;
interface Snapshot {
  format: "chargeos-commercial-snapshot";
  schemaVersion: 1;
  backupCompletedAt: string;
  sourceOrigin: string;
  databaseSha256: string;
  databaseBase64: string;
}
export interface CommercialRecoverySummary {
  backupCompletedAt: string;
  snapshotSha256: string;
  financialSha256: string;
  accounts: number;
  organizations: number;
  statements: number;
  adjustments: number;
  financialState: "snapshot-only-unreconciled";
}
async function schema(database: NativeCommercialDatabase) {
  return await database
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .raw();
}
export async function inspectNativeCommercialDatabase(
  database: NativeCommercialDatabase,
  quarantine: boolean | "released" = false,
): Promise<Omit<CommercialRecoverySummary, "backupCompletedAt" | "snapshotSha256">> {
  const pages = (await database.prepare("PRAGMA page_count").first<number>("page_count"))!,
    pageSize = (await database.prepare("PRAGMA page_size").first<number>("page_size"))!;
  if (pages * pageSize > MAX_COMMERCIAL_DATABASE_BYTES)
    throw new Error("Commercial database exceeds the supported recovery size boundary");
  const scratch = await mkdtemp(join(tmpdir(), "chargeos-commercial-schema-"));
  let reference: NativeCommercialDatabase | undefined;
  try {
    reference = new NativeCommercialDatabase(scratch);
    const migrations = readNativeMigrations(migrationsDirectory);
    await migrateNativeDatabase(reference, migrations);
    if (quarantine) await reference.prepare(NATIVE_RECOVERY_QUARANTINE_SQL).run();
    if (quarantine === "released") await reference.prepare(NATIVE_RECOVERY_RELEASE_SQL).run();
    if (
      await database
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_release_history'")
        .first()
    )
      await reference.prepare(NATIVE_RECOVERY_HISTORY_SQL).run();
    for (const [name, sql] of [
      ["_chargeos_native_handoff", NATIVE_HANDOFF_SQL],
      ["_chargeos_native_handoff_history", NATIVE_HANDOFF_HISTORY_SQL],
    ])
      if (await database.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").bind(name).first())
        await reference.prepare(sql!).run();
    if (JSON.stringify(await schema(database)) !== JSON.stringify(await schema(reference)))
      throw new Error("Commercial database schema differs from the checked-in migrations");
    const applied = await database
      .prepare("SELECT position,name,sha256 FROM _chargeos_native_migration ORDER BY position")
      .all();
    if (
      JSON.stringify(applied.results) !==
      JSON.stringify(migrations.map(({ position, name, sha256 }) => ({ position, name, sha256 })))
    )
      throw new Error("Commercial migration history differs from this software");
    database.checkIntegrity();
    const organizations = await database
      .prepare("SELECT id FROM organization ORDER BY id")
      .all<{ id: string }>();
    for (const organization of organizations.results) {
      const data = await readFinancialData({ SERVICE_DB: database }, organization.id, "", true);
      financialJournal(data);
    }
    await validateSupportHistory({ SERVICE_DB: database });
    const tables = await database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'reimbursement_*' ORDER BY name",
      )
      .all<{ name: string }>();
    const hash = createHash("sha256");
    for (const table of tables.results) {
      // Names are trusted only after exact schema comparison. Sorted logical
      // rows make this fingerprint independent of row insertion order.
      const rows = await database.prepare(`SELECT * FROM "${table.name}"`).raw();
      hash.update(JSON.stringify([table.name, rows.map((row) => JSON.stringify(row)).sort()]));
    }
    async function count(table: string): Promise<number> {
      return (await database
        .prepare(`SELECT count(*) AS total FROM ${table}`)
        .first<number>("total"))!;
    }
    return {
      financialSha256: hash.digest("hex"),
      organizations: organizations.results.length,
      accounts: await count("user"),
      statements: await count("reimbursement_statement"),
      adjustments: await count("reimbursement_adjustment"),
      financialState: "snapshot-only-unreconciled",
    };
  } finally {
    reference?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
async function withSnapshot<T>(
  bytes: Buffer,
  callback: (database: NativeCommercialDatabase) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-commercial-inspection-"));
  let database: NativeCommercialDatabase | undefined;
  try {
    await writePrivateRecoveryFile(join(directory, "commercial.sqlite"), bytes);
    database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
    if (!["ordinary", "released"].includes(database.recoveryState(undefined, true)))
      throw new Error("Quarantined snapshots cannot be reused as source backups");
    return await callback(database);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
async function parseSnapshot(
  serialized: string,
  passphrase: string,
): Promise<{ snapshot: Snapshot; bytes: Buffer }> {
  const { value, createdAt } = await openCommercialPayload(serialized, passphrase);
  exactObject(value, [
    "format",
    "schemaVersion",
    "backupCompletedAt",
    "sourceOrigin",
    "databaseSha256",
    "databaseBase64",
  ]);
  if (
    value.format !== "chargeos-commercial-snapshot" ||
    value.schemaVersion !== 1 ||
    value.backupCompletedAt !== createdAt ||
    typeof value.sourceOrigin !== "string" ||
    typeof value.databaseSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.databaseSha256) ||
    !recoverySourceOrigin(value.sourceOrigin)
  )
    throw new Error("Invalid commercial recovery snapshot");
  const bytes = decodeCommercialBase64(value.databaseBase64, MAX_COMMERCIAL_DATABASE_BYTES);
  if (
    bytes.subarray(0, 16).toString("binary") !== "SQLite format 3\0" ||
    digest(bytes) !== value.databaseSha256
  )
    throw new Error("Commercial database snapshot digest is invalid");
  return { snapshot: value as unknown as Snapshot, bytes };
}
export async function exportCommercialRecovery(
  configuration: Configuration,
  directory: string,
  output: string,
  passphrase: string,
): Promise<CommercialRecoverySummary> {
  const config = serviceConfiguration(configuration);
  if (!config || config.secret.length > 4096)
    throw new Error("Use the configured native commercial source");
  // Refuse accidental initialization of a missing source database.
  await lstat(join(directory, "commercial.sqlite"));
  const staging = await mkdtemp(join(tmpdir(), "chargeos-commercial-backup-"));
  let source: NativeCommercialDatabase | undefined, snapshot: NativeCommercialDatabase | undefined;
  try {
    source = new NativeCommercialDatabase(directory, {
      recoverySecret: config.secret,
      recoveryOrigin: config.origin,
    });
    const pageCount = (await source.prepare("PRAGMA page_count").first<number>("page_count"))!;
    const pageSize = (await source.prepare("PRAGMA page_size").first<number>("page_size"))!;
    if (pageCount * pageSize > MAX_COMMERCIAL_DATABASE_BYTES)
      throw new Error("Commercial database exceeds the supported recovery size");
    await source.snapshotTo(staging);
    source.close();
    source = undefined;
    snapshot = new NativeCommercialDatabase(staging, {
      recoverySecret: config.secret,
      recoveryOrigin: config.origin,
    });
    const summary = await inspectNativeCommercialDatabase(
      snapshot,
      snapshot.recoveryState(config.secret) === "released" ? "released" : false,
    );
    snapshot.close();
    snapshot = undefined;
    const bytes = await readPrivateRecoveryFile(
      join(staging, "commercial.sqlite"),
      MAX_COMMERCIAL_DATABASE_BYTES,
    );
    const payload: Snapshot = {
      format: "chargeos-commercial-snapshot",
      schemaVersion: 1,
      backupCompletedAt: new Date().toISOString(),
      sourceOrigin: config.origin,
      databaseSha256: digest(bytes),
      databaseBase64: bytes.toString("base64"),
    };
    const serialized = await sealCommercialPayload(payload, payload.backupCompletedAt, passphrase);
    await writePrivateRecoveryFile(output, serialized);
    return {
      ...summary,
      backupCompletedAt: payload.backupCompletedAt,
      snapshotSha256: payload.databaseSha256,
    };
  } finally {
    source?.close();
    snapshot?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
export async function inspectCommercialRecovery(
  input: string,
  passphrase: string,
): Promise<CommercialRecoverySummary> {
  const serialized = (await readPrivateRecoveryFile(input, MAX_COMMERCIAL_ENVELOPE_BYTES)).toString(
    "utf8",
  );
  const { snapshot, bytes } = await parseSnapshot(serialized, passphrase);
  return withSnapshot(bytes, async (database) => ({
    ...(await inspectNativeCommercialDatabase(
      database,
      database.recoveryState(undefined, true) === "released" ? "released" : false,
    )),
    backupCompletedAt: snapshot.backupCompletedAt,
    snapshotSha256: snapshot.databaseSha256,
  }));
}
export async function restoreCommercialRecovery(
  input: string,
  target: string,
  passphrase: string,
): Promise<CommercialRecoverySummary & { restoreId: string; status: "quarantined" }> {
  const serialized = (await readPrivateRecoveryFile(input, MAX_COMMERCIAL_ENVELOPE_BYTES)).toString(
    "utf8",
  );
  const { snapshot, bytes } = await parseSnapshot(serialized, passphrase);
  const destination = resolve(target);
  const parent = await lstat(dirname(destination));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0)
    throw new Error("Restore parent must be an existing private directory without a final symlink");
  return withSnapshot(bytes, async (database) => {
    const released = database.recoveryState(undefined, true) === "released";
    const summary = await inspectNativeCommercialDatabase(database, released ? "released" : false);
    const provenance = {
      restoreId: randomUUID(),
      sourceBundleSha256: digest(serialized),
      snapshotSha256: snapshot.databaseSha256,
      sourceOrigin: snapshot.sourceOrigin,
      backupCompletedAt: snapshot.backupCompletedAt,
      restoredAt: new Date().toISOString(),
      financialSha256: summary.financialSha256,
      schemaVersion: 1,
      status: "quarantined",
      financialState: "snapshot-only-unreconciled",
      credentials: "removed-reenrollment-required",
    } as const;
    await database.prepare("PRAGMA secure_delete=ON").run();
    await database.batch([
      ...(released
        ? [
            ...((await database
              .prepare("SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff'")
              .first())
              ? [database.prepare("DROP TABLE _chargeos_native_handoff")]
              : []),
            database.prepare("DROP TABLE _chargeos_native_release"),
            database.prepare("DROP TABLE _chargeos_native_recovery"),
          ]
        : []),
      database.prepare("DELETE FROM session"),
      database.prepare("DELETE FROM verification"),
      database.prepare("DELETE FROM local_outbox"),
      database.prepare("DELETE FROM account"),
      database.prepare("DELETE FROM two_factor"),
      database.prepare("DELETE FROM rate_limit"),
      database.prepare("UPDATE user SET email_verified=0,two_factor_enabled=0"),
      database.prepare("UPDATE invitation SET status='revoked' WHERE status='pending'"),
      database.prepare(NATIVE_RECOVERY_QUARANTINE_SQL),
      database
        .prepare("INSERT INTO _chargeos_native_recovery VALUES (1,?)")
        .bind(JSON.stringify(provenance)),
    ]);
    await database.prepare("VACUUM").run();
    database.checkIntegrity();
    // Validate finances again after credential sanitization, without treating
    // stale membership or approvals as current operational permission.
    const organizations = await database
      .prepare("SELECT id FROM organization")
      .all<{ id: string }>();
    for (const org of organizations.results)
      financialJournal(await readFinancialData({ SERVICE_DB: database }, org.id, "", true));
    const output = await mkdtemp(join(tmpdir(), "chargeos-commercial-sanitized-"));
    try {
      await database.snapshotTo(output);
      const sanitized = await readPrivateRecoveryFile(
        join(output, "commercial.sqlite"),
        MAX_COMMERCIAL_DATABASE_BYTES,
      );
      // mkdir is the exclusive create operation. Never rename onto an existing
      // (even empty) directory, merge data, or clean up a caller's old target.
      await mkdir(destination, { mode: 0o700 });
      const created = await lstat(destination);
      try {
        await mkdir(join(destination, "data"), { mode: 0o700 });
        await writePrivateRecoveryFile(join(destination, "data/commercial.sqlite"), sanitized);
        await writePrivateRecoveryFile(
          join(destination, "recovery.json"),
          JSON.stringify(provenance, null, 2) + "\n",
        );
        const authSecret = randomBytes(48).toString("hex");
        await writePrivateRecoveryFile(
          join(destination, "service.vars"),
          `SERVICE_MODE=local\nSERVICE_ORIGIN=${snapshot.sourceOrigin.startsWith("http:") ? snapshot.sourceOrigin : "http://127.0.0.1:5173"}\nSERVICE_AUTH_SECRET=${authSecret}\n`,
        );
        const check = new NativeCommercialDatabase(join(destination, "data"), {
          recoveryInspection: true,
        });
        try {
          check.checkIntegrity();
        } finally {
          check.close();
        }
        await syncRecoveryDirectory(dirname(destination));
      } catch (error) {
        const current = await lstat(destination).catch(() => null);
        if (
          current?.isDirectory() &&
          !current.isSymbolicLink() &&
          current.dev === created.dev &&
          current.ino === created.ino
        )
          await rm(destination, { recursive: true, force: true });
        throw error;
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
    return {
      ...summary,
      backupCompletedAt: snapshot.backupCompletedAt,
      snapshotSha256: snapshot.databaseSha256,
      restoreId: provenance.restoreId,
      status: "quarantined",
    };
  });
}
