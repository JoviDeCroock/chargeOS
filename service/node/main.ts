import { fileURLToPath } from "node:url";
import { migrateNativeDatabase, readNativeMigrations } from "./migrations.js";
import { createNativeCommercialServer } from "./http.js";
import type { ServiceEnv } from "../auth.js";
import { nativeConfiguration } from "./configuration.js";

const { configuration, directory, port } = nativeConfiguration();
const { NativeCommercialDatabase } = await import("./sqlite.js");
const database = new NativeCommercialDatabase(directory, {
  recoverySecret: configuration.SERVICE_AUTH_SECRET,
});
try {
  // Compiled service code and source code resolve their checked-in migrations
  // from their respective service root; the native build copies the SQL files.
  await migrateNativeDatabase(
    database,
    readNativeMigrations(fileURLToPath(new URL("../migrations", import.meta.url))),
  );
  const env: ServiceEnv = { ...configuration, SERVICE_DB: database };
  const server = createNativeCommercialServer(env);
  const listeningPort = await server.listen(port);
  console.log(
    `Commercial accounts and reimbursements listening on http://127.0.0.1:${listeningPort} (local delivery only)`,
  );
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void server.close().finally(() => database.close());
    });
} catch {
  database.close();
  throw new Error("Native commercial service failed startup verification");
}
