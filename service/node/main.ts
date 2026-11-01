import { nativeConfiguration } from "./configuration.js";

async function main() {
  // Reject unsupported Node/configuration before importing node:sqlite or
  // opening service state. The runtime owns custody through drained shutdown.
  const settings = nativeConfiguration();
  const { runNativeCommercialService } = await import("./service-runtime.js");
  await runNativeCommercialService(settings);
}
void main().catch(() => {
  console.error(
    "Native commercial service failed startup or shutdown verification. Inspect configured origin, recovery state and private process custody; do not remove a stale lease without a stopped-process audit.",
  );
  process.exitCode = 1;
});
