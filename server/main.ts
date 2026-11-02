import { loadEnvFile } from "node:process";

import { createOwnerApi } from "./api.js";
import { configForStation, loadConfig, stationSecretInteroperabilityAdvisories } from "./config.js";
import { NdjsonEvidenceStore } from "./events.js";
import { OwnerDirectoryStore } from "./directory.js";
import { createChargeGateway, identityAliasesFromEvents } from "./gateway.js";
import { openOwnerTagRegistries, withOwnerTagRegistries } from "./owner-tags.js";

try {
  loadEnvFile(process.env.CHARGEOS_ENV_FILE);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const bootstrapConfig = loadConfig();
const evidence = new NdjsonEvidenceStore(
  bootstrapConfig.eventLogPath,
  bootstrapConfig.eventLogMaxBytes,
);
await evidence.readEvents();
const ownerTags = await openOwnerTagRegistries(bootstrapConfig);
const config = withOwnerTagRegistries(bootstrapConfig, ownerTags);
for (const [stationId, registry] of ownerTags) {
  await registry.reconcile(configForStation(config, stationId), evidence);
}
const gateway = createChargeGateway(config, evidence, {
  identityAliases: identityAliasesFromEvents(config, await evidence.readEvents()),
});
const directory = await OwnerDirectoryStore.open(config);
const api = createOwnerApi(config, gateway, evidence, ownerTags, fetch, directory);

await gateway.listen();
try {
  await api.listen();
} catch (error) {
  await gateway.close();
  throw error;
}

console.log(`chargeOS OCPP 1.6J listening on ${config.ocppHost}:${config.port}`);
console.log(`chargeOS owner UI/API listening on http://${config.apiHost}:${config.apiPort}`);
console.log(
  "Internet-facing use requires TLS/WSS termination; plaintext is for local development only.",
);
for (const advisory of stationSecretInteroperabilityAdvisories(config)) {
  console.warn(`Warning: ${advisory}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([api.close(), gateway.close()]).finally(() => process.exit(0));
  });
}
