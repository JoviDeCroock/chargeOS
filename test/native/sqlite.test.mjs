import { chmod, lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { StatementSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import { migrateNativeDatabase } from "../../service/node/migrations.ts";

const connections = [],
  directories = [];
afterEach(async () => {
  vi.restoreAllMocks();
  connections.splice(0).forEach((database) => database.close());
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function open() {
  const path = await mkdtemp(join(tmpdir(), "chargeos-native-db-"));
  directories.push(path);
  const database = new NativeCommercialDatabase(path);
  connections.push(database);
  return { database, path };
}
const migration = (position, statements, sha256 = String(position).repeat(64)) => ({
  position,
  name: `000${position}_test`,
  sha256,
  statements,
});

it("rejects an incompatible SQLite runtime before creating commercial state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-native-capabilities-"));
  directories.push(directory);
  const data = join(directory, "must-not-be-created");
  vi.spyOn(StatementSync.prototype, "setReturnArrays").mockImplementation(() => {});
  expect(() => new NativeCommercialDatabase(data)).toThrow(/required SQLite APIs.*22\.22/);
  expect(existsSync(data)).toBe(false);
});

it("keeps tenant bindings immutable and raw joined columns in their original order", async () => {
  const { database } = await open();
  const query = database.prepare("SELECT ? AS id, ? AS id");
  expect(
    await Promise.all([
      query.bind("tenant-a", "row-a").raw(),
      query.bind("tenant-b", "row-b").raw(),
    ]),
  ).toEqual([[["tenant-a", "row-a"]], [["tenant-b", "row-b"]]]);
  expect(await query.bind("a", "b").raw({ columnNames: true })).toEqual([
    ["id", "id"],
    ["a", "b"],
  ]);
  expect(await database.prepare("SELECT 1 AS value").first()).toEqual({ value: 1 });
  expect(await database.prepare("SELECT 1 WHERE 0").first()).toBeNull();
  await expect(database.prepare("SELECT 1 AS value").first("toString")).rejects.toThrow(/column/);
  expect(() => query.bind(undefined)).toThrow(/binding type/);
});
it("commits complete batches, preserves changes() and rolls back prior writes and audits on late failure", async () => {
  const { database } = await open();
  await database.batch([
    database.prepare("CREATE TABLE claim (id TEXT PRIMARY KEY)"),
    database.prepare("CREATE TABLE audit (id TEXT PRIMARY KEY)"),
  ]);
  await expect(
    database.batch([
      database.prepare("INSERT INTO claim VALUES ('new')"),
      database.prepare("INSERT INTO audit SELECT 'new' WHERE changes() = 1"),
      database.prepare("INSERT INTO claim VALUES ('new')"),
    ]),
  ).rejects.toThrow();
  expect((await database.prepare("SELECT * FROM claim").all()).results).toEqual([]);
  expect((await database.prepare("SELECT * FROM audit").all()).results).toEqual([]);
  const result = await database.batch([
    database.prepare("INSERT INTO claim VALUES ('new')"),
    database.prepare("INSERT INTO audit SELECT 'new' WHERE changes() = 1"),
  ]);
  expect(result.map((item) => item.meta.changes)).toEqual([1, 1]);
  await expect(database.prepare("BEGIN").run()).rejects.toThrow(/transaction control/);
  for (const operation of [
    "BEGIN IMMEDIATE",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT test",
    "RELEASE test",
  ])
    await expect(
      database.prepare(`/* comment */; -- empty statement\n ; ${operation}`).run(),
    ).rejects.toThrow(/transaction control/);
  await expect(database.prepare("SELECT 1; SELECT 2").all()).rejects.toThrow(/one SQL statement/);
});
it("rejects foreign statements and enforces SQL foreign keys", async () => {
  const first = await open(),
    second = await open();
  await expect(first.database.batch([second.database.prepare("SELECT 1")])).rejects.toThrow(
    /same database/,
  );
  await first.database.batch([
    first.database.prepare("CREATE TABLE parent(id INTEGER PRIMARY KEY)"),
    first.database.prepare("CREATE TABLE child(id INTEGER REFERENCES parent(id))"),
  ]);
  await expect(first.database.prepare("INSERT INTO child VALUES(42)").run()).rejects.toThrow();
});
it("protects database custody and verifies real on-disk persistence", async () => {
  const { database, path } = await open();
  await database.prepare("CREATE TABLE private_state (value TEXT)").run();
  await database
    .prepare("INSERT INTO private_state VALUES (?)")
    .bind("synthetic-private-value")
    .run();
  expect((await lstat(database.path)).mode & 0o777).toBe(0o600);
  database.close();
  connections.splice(connections.indexOf(database), 1);
  const replacement = new NativeCommercialDatabase(path);
  connections.push(replacement);
  expect(await replacement.prepare("SELECT value FROM private_state").first("value")).toBe(
    "synthetic-private-value",
  );
  replacement.close();
  connections.splice(connections.indexOf(replacement), 1);
  await chmod(join(path, "commercial.sqlite"), 0o644);
  expect(() => new NativeCommercialDatabase(path)).toThrow(/owner-private/);
  await chmod(join(path, "commercial.sqlite"), 0o600);
  await symlink(join(path, "commercial.sqlite"), join(path, "commercial.sqlite-journal"));
  expect(() => new NativeCommercialDatabase(path)).toThrow(/owner-private/);
});
it("commits each generated migration and hash atomically and rejects changed, missing or future history", async () => {
  const { database } = await open();
  const first = migration(0, ["CREATE TABLE first_table(id INTEGER)"]);
  await migrateNativeDatabase(database, [first]);
  await migrateNativeDatabase(database, [first]);
  await expect(
    migrateNativeDatabase(database, [{ ...first, sha256: "f".repeat(64) }]),
  ).rejects.toThrow(/history differs/);
  const second = migration(1, [
    "CREATE TABLE second_table(id INTEGER)",
    "INSERT INTO missing_table VALUES(1)",
  ]);
  await expect(migrateNativeDatabase(database, [first, second])).rejects.toThrow();
  expect(
    await database.prepare("SELECT name FROM sqlite_master WHERE name='second_table'").first(),
  ).toBeNull();
  expect(
    (await database.prepare("SELECT * FROM _chargeos_native_migration").all()).results,
  ).toHaveLength(1);
  await database
    .prepare("INSERT INTO _chargeos_native_migration VALUES (1,'0001_unknown',?)")
    .bind("b".repeat(64))
    .run();
  await expect(migrateNativeDatabase(database, [first])).rejects.toThrow(/history differs/);
});
