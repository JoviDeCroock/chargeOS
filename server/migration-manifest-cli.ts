import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { hashEvidenceFile } from "./evidence-file.js";
import {
  createMigrationTargetManifest,
  inspectMigrationTargetManifest,
  writeMigrationTargetManifest,
  type MigrationTargetManifestInput,
} from "./migration-manifest.js";

const CREATE_OPTIONS = [
  "--configuration-backup-file",
  "--configuration-backup-sha256",
  "--configuration-path",
  "--configuration-path-evidence-file",
  "--configuration-path-evidence-sha256",
  "--continuity-restore-evidence-file",
  "--continuity-restore-evidence-sha256",
  "--created-at",
  "--credential-custody-evidence-file",
  "--credential-custody-evidence-sha256",
  "--device-inventory-evidence-file",
  "--device-inventory-evidence-sha256",
  "--endpoint",
  "--expected-firmware",
  "--expected-model",
  "--expected-vendor",
  "--output",
  "--rollback-evidence-file",
  "--rollback-evidence-sha256",
  "--station-id",
  "--transaction-export-file",
  "--transaction-export-sha256",
  "--transport",
  "--transport-validation-evidence-file",
  "--transport-validation-evidence-sha256",
] as const;
const VERIFY_OPTIONS = ["--expected-sha256", "--manifest"] as const;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrationManifestCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      `chargeOS migration manifest: ${error instanceof Error ? error.message : "operation failed"}`,
    );
    process.exitCode = 1;
  });
}

export async function runMigrationManifestCli(
  arguments_: readonly string[],
  writeOutput: (value: string) => void = console.log,
): Promise<void> {
  const [command, ...commandArguments] = arguments_;
  if (!command || command === "--help" || command === "-h") {
    writeOutput(help());
    return;
  }
  if (command === "create") {
    const options = parseOptions(commandArguments, CREATE_OPTIONS);
    const output = required(options, "--output");
    const createdAt = options.get("--created-at");
    const input: MigrationTargetManifestInput = {
      configurationBackupSha256: await evidenceDigest(
        options,
        "--configuration-backup-sha256",
        "--configuration-backup-file",
      ),
      configurationPath: required(options, "--configuration-path"),
      configurationPathEvidenceSha256: await evidenceDigest(
        options,
        "--configuration-path-evidence-sha256",
        "--configuration-path-evidence-file",
      ),
      continuityRestoreEvidenceSha256: await evidenceDigest(
        options,
        "--continuity-restore-evidence-sha256",
        "--continuity-restore-evidence-file",
      ),
      ...(createdAt ? { createdAt } : {}),
      credentialCustodyEvidenceSha256: await evidenceDigest(
        options,
        "--credential-custody-evidence-sha256",
        "--credential-custody-evidence-file",
      ),
      deviceInventoryEvidenceSha256: await evidenceDigest(
        options,
        "--device-inventory-evidence-sha256",
        "--device-inventory-evidence-file",
      ),
      endpoint: required(options, "--endpoint"),
      expectedFirmwareVersion: required(options, "--expected-firmware"),
      expectedModel: required(options, "--expected-model"),
      expectedVendor: required(options, "--expected-vendor"),
      standaloneRollbackEvidenceSha256: await evidenceDigest(
        options,
        "--rollback-evidence-sha256",
        "--rollback-evidence-file",
      ),
      stationId: required(options, "--station-id"),
      transactionExportSha256: await evidenceDigest(
        options,
        "--transaction-export-sha256",
        "--transaction-export-file",
      ),
      transport: required(options, "--transport") as MigrationTargetManifestInput["transport"],
      transportValidationEvidenceSha256: await evidenceDigest(
        options,
        "--transport-validation-evidence-sha256",
        "--transport-validation-evidence-file",
      ),
    };
    const inspected = await writeMigrationTargetManifest(
      output,
      createMigrationTargetManifest(input),
    );
    writeOutput(
      JSON.stringify(
        {
          created: true,
          endpoint: inspected.manifest.target.endpoint,
          output,
          sha256: inspected.sha256,
          stationId: inspected.manifest.station.id,
          transport: inspected.manifest.target.transport,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "verify") {
    const options = parseOptions(commandArguments, VERIFY_OPTIONS);
    const manifestPath = required(options, "--manifest");
    const inspected = inspectMigrationTargetManifest(
      await readFile(manifestPath, "utf8"),
      options.get("--expected-sha256"),
    );
    writeOutput(
      JSON.stringify(
        {
          endpoint: inspected.manifest.target.endpoint,
          expectedHashMatched: options.has("--expected-sha256") ? true : null,
          manifest: manifestPath,
          sha256: inspected.sha256,
          stationId: inspected.manifest.station.id,
          transport: inspected.manifest.target.transport,
          verified: true,
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error("Unknown command. Use --help for usage.");
}

function parseOptions(
  arguments_: readonly string[],
  allowed: readonly string[],
): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name || !allowed.includes(name) || !value || value.startsWith("--")) {
      throw new Error(`Invalid option near ${name ?? "end of command"}`);
    }
    if (options.has(name)) throw new Error(`Duplicate option ${name}`);
    options.set(name, value);
  }
  return options;
}

function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function evidenceDigest(
  options: ReadonlyMap<string, string>,
  hashOption: string,
  fileOption: string,
): Promise<string> {
  const hash = options.get(hashOption);
  const file = options.get(fileOption);
  if ((!hash && !file) || (hash && file)) {
    throw new Error(`Exactly one of ${fileOption} or ${hashOption} is required`);
  }
  return file ? hashEvidenceFile(file) : hash!;
}

function help(): string {
  return `chargeOS canonical migration target manifest

Usage:
  migration-manifest create \\
    --output <target.json> \\
    --station-id <charge-point-id> \\
    --expected-vendor <vendor> --expected-model <model> --expected-firmware <version> \\
    --endpoint <wss://host/path/station-id|ws://private-ip/path/station-id> \\
    --transport <internet-wss|isolated-lan-ws> \\
    --configuration-path <supported exact-device path> \\
    --device-inventory-evidence-file <file> \\
    --configuration-path-evidence-file <file> \\
    --configuration-backup-file <file> \\
    --transaction-export-file <file> \\
    --rollback-evidence-file <file> \\
    --credential-custody-evidence-file <file> \\
    --transport-validation-evidence-file <file> \\
    --continuity-restore-evidence-file <file> [--created-at <ISO timestamp>]

  migration-manifest verify --manifest <target.json> [--expected-sha256 <authorized sha256>]

Each evidence input requires exactly one --*-file or matching --*-sha256 option. File inputs
must be non-empty regular non-symlinks and are hashed directly without entering the manifest.
Never use a raw credential, RFID value, SIM secret, or recovery passphrase as evidence input.
The manifest contains no charger secret, owner token, RFID, address, Wi-Fi, or SIM credential.
The printed SHA-256 covers canonical validated JSON and is the value authorized in chargeOS.`;
}
