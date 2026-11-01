import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NativeCommercialDatabase } from "./sqlite.js";

export interface NativeMigration {
  readonly position: number;
  readonly name: string;
  readonly sha256: string;
  readonly statements: string[];
}
export function readNativeMigrations(directory: string): NativeMigration[] {
  const journal: unknown = JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8"));
  const entries = (journal as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("Commercial migration journal is invalid");
  return entries.map((entry: unknown, index) => {
    const row = entry as { idx?: number; tag?: string };
    if (row.idx !== index || typeof row.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(row.tag))
      throw new Error("Commercial migration order is invalid");
    const sql = readFileSync(join(directory, `${row.tag}.sql`), "utf8");
    return {
      position: index,
      name: row.tag,
      sha256: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  });
}
export async function migrateNativeDatabase(
  database: NativeCommercialDatabase,
  migrations: NativeMigration[],
): Promise<void> {
  if (
    !migrations.length ||
    migrations.some(
      (migration, index) =>
        migration.position !== index ||
        !/^\d{4}_[a-z0-9_]+$/.test(migration.name) ||
        !/^[a-f0-9]{64}$/.test(migration.sha256) ||
        !migration.statements.length,
    )
  )
    throw new Error("Commercial migration is invalid");
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS _chargeos_native_migration (position INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL)",
    )
    .run();
  const applied = await database
    .prepare("SELECT position,name,sha256 FROM _chargeos_native_migration ORDER BY position")
    .all<{ position: number; name: string; sha256: string }>();
  for (const [index, row] of applied.results.entries()) {
    const source = migrations[index];
    if (
      !source ||
      row.position !== index ||
      row.name !== source.name ||
      row.sha256 !== source.sha256
    )
      throw new Error("Commercial migration history differs from this software; refusing startup");
  }
  for (const migration of migrations.slice(applied.results.length)) {
    await database.batch([
      ...migration.statements.map((sql) => database.prepare(sql)),
      database
        .prepare("INSERT INTO _chargeos_native_migration(position,name,sha256) VALUES (?,?,?)")
        .bind(migration.position, migration.name, migration.sha256),
    ]);
  }
  database.checkIntegrity();
}
