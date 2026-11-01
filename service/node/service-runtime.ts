import { fileURLToPath } from "node:url";
import { migrateNativeDatabase, readNativeMigrations } from "./migrations.js";
import { createNativeCommercialServer } from "./http.js";
import type { ServiceEnv } from "../auth.js";
import type { nativeConfiguration } from "./configuration.js";
import { acquireNativeServiceCustody } from "./service-custody.js";
import { NativeCommercialDatabase } from "./sqlite.js";

export async function runNativeCommercialService(settings: ReturnType<typeof nativeConfiguration>) {
  const { configuration, directory, port } = settings;
  const hosted = configuration.SERVICE_MODE === "production";
  const custody = await acquireNativeServiceCustody(directory);
  let database: NativeCommercialDatabase | undefined;
  let server: ReturnType<typeof createNativeCommercialServer> | undefined;
  let listening = false,
    requested = false,
    closing = false;
  let stopped!: () => void, failed!: (error: unknown) => void;
  const stoppedPromise = new Promise<void>((resolve, reject) => {
    stopped = resolve;
    failed = reject;
  });
  const stop = () => {
    requested = true;
    if (!server || !listening || closing) return;
    closing = true;
    void server.close().then(stopped, failed);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    database = new NativeCommercialDatabase(directory, {
      recoverySecret: configuration.SERVICE_AUTH_SECRET,
      recoveryOrigin: configuration.SERVICE_ORIGIN,
    });
    // The native build copies the same checked-in migrations as source mode.
    await migrateNativeDatabase(
      database,
      readNativeMigrations(fileURLToPath(new URL("../migrations", import.meta.url))),
    );
    if (requested) return;
    const env: ServiceEnv = { ...configuration, SERVICE_DB: database };
    server = createNativeCommercialServer(
      env,
      undefined,
      hosted ? { uiDirectory: process.env.SERVICE_UI_DIRECTORY ?? "/app/dist/ui" } : {},
    );
    const listeningPort = await server.listen(port);
    listening = true;
    if (requested) stop();
    else
      console.log(
        `Commercial accounts and reimbursements listening on http://127.0.0.1:${listeningPort} (loopback ${hosted ? "HTTPS proxy" : "only"}; ${configuration.SERVICE_DELIVERY === "smtp" ? "SMTP queue enabled" : "local outbox"})`,
      );
    await stoppedPromise;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    try {
      if (listening) await server?.close();
    } finally {
      // If database closure fails, leave custody for a stopped-process audit.
      database?.close();
      await custody.close();
    }
  }
}
