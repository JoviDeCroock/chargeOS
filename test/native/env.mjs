import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../../service/index.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import { migrateNativeDatabase, readNativeMigrations } from "../../service/node/migrations.ts";
import { fileURLToPath } from "node:url";

let directory;
export const env = {
  SERVICE_MODE: "local",
  SERVICE_ORIGIN: "http://127.0.0.1:5173",
  SERVICE_AUTH_SECRET: "synthetic-test-secret-with-at-least-32-characters",
  SERVICE_DB: undefined,
};
export const SELF = { fetch: (input, init) => worker.fetch(new Request(input, init), env) };
export async function initialize() {
  directory = await mkdtemp(join(tmpdir(), "chargeos-native-parity-"));
  env.SERVICE_DB = new NativeCommercialDatabase(directory);
  await migrateNativeDatabase(
    env.SERVICE_DB,
    readNativeMigrations(fileURLToPath(new URL("../../service/migrations", import.meta.url))),
  );
}
export async function dispose() {
  env.SERVICE_DB?.close();
  env.SERVICE_DB = undefined;
  await rm(directory, { recursive: true, force: true });
}
