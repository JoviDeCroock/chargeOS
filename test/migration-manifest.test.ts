import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMigrationTargetManifest,
  inspectMigrationTargetManifest,
  MigrationTargetManifestError,
  serializeMigrationTargetManifest,
  writeMigrationTargetManifest,
  type MigrationTargetManifestInput,
} from "../server/migration-manifest.js";

const HASHES = {
  configurationBackupSha256: "1".repeat(64),
  configurationPathEvidenceSha256: "2".repeat(64),
  continuityRestoreEvidenceSha256: "3".repeat(64),
  credentialCustodyEvidenceSha256: "4".repeat(64),
  deviceInventoryEvidenceSha256: "5".repeat(64),
  standaloneRollbackEvidenceSha256: "6".repeat(64),
  transactionExportSha256: "7".repeat(64),
  transportValidationEvidenceSha256: "8".repeat(64),
} as const;

const BASE_INPUT: MigrationTargetManifestInput = {
  ...HASHES,
  configurationPath: "ACE Service Installer > Connectivity > Backoffice",
  createdAt: "2026-08-14T12:00:00.000Z",
  endpoint: "wss://ocpp.example.eu/ocpp/ALFEN_GENESIS",
  expectedFirmwareVersion: "7.1.0",
  expectedModel: "Eve Single S-line",
  expectedVendor: "Alfen",
  stationId: "ALFEN_GENESIS",
  transport: "internet-wss",
};

describe("migration target manifest", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { force: true, recursive: true });
    directory = undefined;
  });

  it("builds deterministic secret-free canonical bytes and verifies the authorized hash", () => {
    const manifest = createMigrationTargetManifest(BASE_INPUT);
    const first = inspectMigrationTargetManifest(serializeMigrationTargetManifest(manifest));
    const { target, ...rest } = manifest;
    const reordered = inspectMigrationTargetManifest(
      JSON.stringify({ target, ...rest }),
      first.sha256,
    );

    expect(reordered).toEqual(first);
    expect(first.manifest).toMatchObject({
      safety: {
        containsSecrets: false,
        endpointChangeAuthorizedSeparately: true,
        localOwnerAuthorizationMustRemainEnabled: true,
      },
      target: {
        credentialCustody: "owner-held-separately",
        protocol: "ocpp1.6j",
        stationAuthentication: "http-basic-unique-secret",
        transportValidation: "public-ca-hostname-validated",
      },
    });
    expect(first.serialized).not.toMatch(/password|owner-api-token|rfid|wifi|sim-secret/iu);
    expect(() => inspectMigrationTargetManifest(first.serialized, "f".repeat(64))).toThrow(
      "hash does not match",
    );
  });

  it("rejects embedded secrets, unexpected fields, transport mismatch, and wrong station paths", () => {
    expect(() =>
      createMigrationTargetManifest({
        ...BASE_INPUT,
        endpoint: "wss://station:secret@ocpp.example.eu/ocpp/ALFEN_GENESIS",
      }),
    ).toThrow("must not embed credentials");
    expect(() =>
      createMigrationTargetManifest({
        ...BASE_INPUT,
        endpoint: "ws://192.168.10.4/ocpp/ALFEN_GENESIS",
      }),
    ).toThrow("must use wss");
    expect(() =>
      createMigrationTargetManifest({
        ...BASE_INPUT,
        endpoint: "wss://ocpp.example.eu/ocpp/OTHER_STATION",
      }),
    ).toThrow("exact stationId");
    expect(() =>
      createMigrationTargetManifest({
        ...BASE_INPUT,
        configurationPath: "ACE > Backoffice > password=do-not-store-this",
      }),
    ).toThrow("appears to contain a credential");

    const manifest = createMigrationTargetManifest(BASE_INPUT);
    const withSecretField = {
      ...manifest,
      target: { ...manifest.target, password: "must-never-enter-the-manifest" },
    };
    expect(() => inspectMigrationTargetManifest(JSON.stringify(withSecretField))).toThrow(
      "missing or unexpected fields",
    );
  });

  it("accepts only non-loopback private IPs for isolated plaintext LAN migration", () => {
    const privateManifest = createMigrationTargetManifest({
      ...BASE_INPUT,
      endpoint: "ws://192.168.50.4:9000/ALFEN_GENESIS",
      transport: "isolated-lan-ws",
    });
    expect(privateManifest.target.transportValidation).toBe("isolated-owner-lan-only");

    for (const endpoint of [
      "ws://203.0.113.4:9000/ALFEN_GENESIS",
      "ws://127.0.0.1:9000/ALFEN_GENESIS",
      "ws://charger.example/ALFEN_GENESIS",
    ]) {
      expect(() =>
        createMigrationTargetManifest({ ...BASE_INPUT, endpoint, transport: "isolated-lan-ws" }),
      ).toThrow("non-loopback private IP");
    }
  });

  it("writes one owner-private manifest without overwriting an existing target", async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-migration-target-"));
    const path = join(directory, "target.json");
    const manifest = createMigrationTargetManifest(BASE_INPUT);
    const written = await writeMigrationTargetManifest(path, manifest);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe(written.serialized);
    await expect(writeMigrationTargetManifest(path, manifest)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("fails closed for malformed evidence and changed safety constants", () => {
    expect(() =>
      createMigrationTargetManifest({
        ...BASE_INPUT,
        configurationBackupSha256: "ABC",
      }),
    ).toThrow(MigrationTargetManifestError);
    const manifest = createMigrationTargetManifest(BASE_INPUT);
    expect(() =>
      inspectMigrationTargetManifest(
        JSON.stringify({
          ...manifest,
          safety: { ...manifest.safety, localOwnerAuthorizationMustRemainEnabled: false },
        }),
      ),
    ).toThrow("safety boundary was changed");
  });
});
