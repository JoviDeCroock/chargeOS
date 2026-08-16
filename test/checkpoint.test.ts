import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareEvidenceCheckpoint,
  createEvidenceCheckpoint,
  verifyEvidenceCheckpoint,
  writeEvidenceSigningKeyPair,
} from "../server/checkpoint.js";
import type { GatewayConfig } from "../server/config.js";
import { createContinuityBundle, openContinuityBundle } from "../server/continuity.js";
import { evidenceEvent, NdjsonEvidenceStore } from "../server/events.js";

const BUNDLE_PASSPHRASE = "synthetic-bundle-passphrase";
const KEY_PASSPHRASE = "synthetic-signing-key-passphrase";

describe("owner evidence checkpoint", () => {
  it("signs a continuity chain head and verifies it independently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-checkpoint-"));
    const ledgerPath = join(directory, "events.ndjson");
    const keyDirectory = join(directory, "signing-key");
    const otherKeyDirectory = join(directory, "other-signing-key");

    try {
      const store = new NdjsonEvidenceStore(ledgerPath);
      await store.append(evidenceEvent("STATION_1", "system", "Checkpoint", { safe: true }));
      const bundle = await createContinuityBundle(
        config(ledgerPath),
        await store.readEvents(),
        BUNDLE_PASSPHRASE,
      );
      const payload = await openContinuityBundle(JSON.stringify(bundle), BUNDLE_PASSPHRASE);
      const manifest = await writeEvidenceSigningKeyPair(keyDirectory, KEY_PASSPHRASE);
      const privateKey = await readFile(join(keyDirectory, manifest.privateKeyFile), "utf8");
      const publicKey = await readFile(join(keyDirectory, manifest.publicKeyFile), "utf8");
      const checkpoint = createEvidenceCheckpoint(payload, privateKey, KEY_PASSPHRASE);

      const verified = verifyEvidenceCheckpoint(JSON.stringify(checkpoint), publicKey);
      expect(() => compareEvidenceCheckpoint(verified, payload)).not.toThrow();
      expect(verified.publicKeySha256).toBe(manifest.publicKeySha256);
      expect(JSON.stringify(checkpoint)).not.toContain("synthetic-owner-tag");
      expect((await stat(join(keyDirectory, "private-key.pem"))).mode & 0o777).toBe(0o600);
      expect((await stat(keyDirectory)).mode & 0o777).toBe(0o700);

      const tampered = { ...checkpoint, eventCount: checkpoint.eventCount + 1 };
      expect(() => verifyEvidenceCheckpoint(JSON.stringify(tampered), publicKey)).toThrow(
        "signature is invalid",
      );
      expect(() =>
        createEvidenceCheckpoint(payload, privateKey, "incorrect-signing-key-passphrase"),
      ).toThrow("could not be opened");
      const otherManifest = await writeEvidenceSigningKeyPair(otherKeyDirectory, KEY_PASSPHRASE);
      const otherPublicKey = await readFile(
        join(otherKeyDirectory, otherManifest.publicKeyFile),
        "utf8",
      );
      expect(() => verifyEvidenceCheckpoint(JSON.stringify(checkpoint), otherPublicKey)).toThrow(
        "fingerprint does not match",
      );
      await expect(writeEvidenceSigningKeyPair(keyDirectory, KEY_PASSPHRASE)).rejects.toThrow(
        "already exists",
      );
      const danglingTarget = join(directory, "dangling-signing-key");
      await symlink(join(directory, "missing-key-target"), danglingTarget);
      await expect(writeEvidenceSigningKeyPair(danglingTarget, KEY_PASSPHRASE)).rejects.toThrow(
        "already exists",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function config(eventLogPath: string): GatewayConfig {
  return {
    apiHost: "127.0.0.1",
    apiPort: 9080,
    eventLogMaxBytes: 268_435_456,
    eventLogPath,
    heartbeatSeconds: 60,
    ocppHost: "127.0.0.1",
    ocppMaxConnections: 8,
    ocppMaxPayloadBytes: 1_048_576,
    ocppMessageBurst: 60,
    ocppMessagesPerMinute: 600,
    ownerApiToken: "owner-api-token-with-at-least-thirty-two-characters",
    ownerTags: new Set(["synthetic-owner-tag"]),
    port: 9000,
    stationId: "STATION_1",
    stationSecret: "synthetic-station-secret-at-least-sixteen",
    trustProxyHeaders: false,
    uiDirectory: "dist/ui",
  };
}
