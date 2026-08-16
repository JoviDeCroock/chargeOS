import { readFile } from "node:fs/promises";

import { verifyFieldEvidencePack } from "./field-pack.js";

await main().catch((error: unknown) => {
  console.error(
    `chargeOS field pack: ${error instanceof Error ? error.message : "verification failed"}`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(`chargeOS field evidence pack

Usage:
  field-pack verify --pack <redacted-pack.json>`);
    return;
  }
  if (command !== "verify") throw new Error("Usage: field-pack verify --pack <redacted-pack.json>");
  const pack = verifyFieldEvidencePack(
    await readFile(requireArgument(arguments_, "--pack"), "utf8"),
  );
  console.log(
    JSON.stringify(
      {
        artifactDigests: {
          continuity: pack.artifacts.continuity.sha256,
          freedomTest: pack.artifacts.freedomTest.sha256,
          migration: pack.artifacts.migration.sha256,
        },
        evidenceChainHead: pack.artifacts.freedomTest.value.evidenceChainHead,
        evidenceRecordCount: pack.artifacts.freedomTest.value.evidenceRecordCount,
        freedomTestStatus: pack.artifacts.freedomTest.value.test.status,
        migrationStatus: pack.artifacts.migration.value.migration.status,
        reviewState: pack.reviewState,
        stationId: pack.stationId,
        verified: true,
      },
      null,
      2,
    ),
  );
}

function requireArgument(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
