import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runMigrationManifestCli } from "../server/migration-manifest-cli.js";
import { inspectMigrationTargetManifest } from "../server/migration-manifest.js";

describe("migration manifest evidence-file CLI", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { force: true, recursive: true });
    directory = undefined;
  });

  it("hashes exact evidence files into a secret-free canonical target", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-manifest-cli-"));
    const artifacts = await createArtifacts(directory);
    const output = join(directory, "target.json");
    let stdout = "";
    await runMigrationManifestCli(["create", ...baseArguments(output, artifacts)], (value) => {
      stdout = value;
    });
    const result = JSON.parse(stdout);
    const serialized = await readFile(output, "utf8");
    const inspected = inspectMigrationTargetManifest(serialized, result.sha256);

    expect(inspected.manifest.evidence).toEqual({
      configurationBackupSha256: digest("configuration-backup"),
      configurationPathEvidenceSha256: digest("configuration-path"),
      continuityRestoreEvidenceSha256: digest("continuity-restore"),
      credentialCustodyEvidenceSha256: digest("credential-custody"),
      deviceInventoryEvidenceSha256: digest("device-inventory"),
      standaloneRollbackEvidenceSha256: digest("standalone-rollback"),
      transactionExportSha256: digest("transaction-export"),
      transportValidationEvidenceSha256: digest("transport-validation"),
    });
    for (const path of Object.values(artifacts)) expect(serialized).not.toContain(path);
  });

  it("rejects ambiguous file and caller-supplied digest inputs", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-manifest-cli-"));
    const artifacts = await createArtifacts(directory);
    const output = join(directory, "target.json");

    await expect(
      runMigrationManifestCli([
        "create",
        ...baseArguments(output, artifacts),
        "--configuration-backup-sha256",
        "a".repeat(64),
      ]),
    ).rejects.toThrow(
      "Exactly one of --configuration-backup-file or --configuration-backup-sha256",
    );
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains explicit digests for evidence already held elsewhere", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-manifest-cli-"));
    const output = join(directory, "target.json");
    await runMigrationManifestCli(["create", ...baseHashArguments(output)], () => {});

    const inspected = inspectMigrationTargetManifest(await readFile(output, "utf8"));
    expect(inspected.manifest.evidence).toEqual({
      configurationBackupSha256: "1".repeat(64),
      configurationPathEvidenceSha256: "2".repeat(64),
      continuityRestoreEvidenceSha256: "3".repeat(64),
      credentialCustodyEvidenceSha256: "4".repeat(64),
      deviceInventoryEvidenceSha256: "5".repeat(64),
      standaloneRollbackEvidenceSha256: "6".repeat(64),
      transactionExportSha256: "7".repeat(64),
      transportValidationEvidenceSha256: "8".repeat(64),
    });
  });
});

async function createArtifacts(directory: string): Promise<Record<string, string>> {
  const artifacts: Record<string, string> = {};
  for (const name of [
    "configuration-backup",
    "configuration-path",
    "continuity-restore",
    "credential-custody",
    "device-inventory",
    "standalone-rollback",
    "transaction-export",
    "transport-validation",
  ]) {
    const path = join(directory, `${name}.evidence`);
    await writeFile(path, name, { mode: 0o600 });
    artifacts[name] = path;
  }
  return artifacts;
}

function baseArguments(output: string, artifacts: Record<string, string>): string[] {
  return [
    ...commonArguments(output),
    "--device-inventory-evidence-file",
    artifacts["device-inventory"]!,
    "--configuration-path-evidence-file",
    artifacts["configuration-path"]!,
    "--configuration-backup-file",
    artifacts["configuration-backup"]!,
    "--transaction-export-file",
    artifacts["transaction-export"]!,
    "--rollback-evidence-file",
    artifacts["standalone-rollback"]!,
    "--credential-custody-evidence-file",
    artifacts["credential-custody"]!,
    "--transport-validation-evidence-file",
    artifacts["transport-validation"]!,
    "--continuity-restore-evidence-file",
    artifacts["continuity-restore"]!,
    "--created-at",
    "2026-08-15T12:00:00.000Z",
  ];
}

function digest(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function baseHashArguments(output: string): string[] {
  return [
    ...commonArguments(output),
    "--configuration-backup-sha256",
    "1".repeat(64),
    "--configuration-path-evidence-sha256",
    "2".repeat(64),
    "--continuity-restore-evidence-sha256",
    "3".repeat(64),
    "--credential-custody-evidence-sha256",
    "4".repeat(64),
    "--device-inventory-evidence-sha256",
    "5".repeat(64),
    "--rollback-evidence-sha256",
    "6".repeat(64),
    "--transaction-export-sha256",
    "7".repeat(64),
    "--transport-validation-evidence-sha256",
    "8".repeat(64),
    "--created-at",
    "2026-08-15T12:00:00.000Z",
  ];
}

function commonArguments(output: string): string[] {
  return [
    "--output",
    output,
    "--station-id",
    "ALFEN_GENESIS",
    "--expected-vendor",
    "Alfen",
    "--expected-model",
    "Eve Single S-line",
    "--expected-firmware",
    "7.1.0",
    "--endpoint",
    "wss://ocpp.example.eu/ocpp/ALFEN_GENESIS",
    "--transport",
    "internet-wss",
    "--configuration-path",
    "ACE Service Installer > Connectivity > Backoffice",
  ];
}
