import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

import { loadConfig, type GatewayConfig } from "../server/config.js";
import {
  assertEvidenceCustodyIncludesBundle,
  compactContinuityBundle,
  ContinuityBundleError,
  createContinuityBundle,
  EVIDENCE_COMPACTION_CONFIRMATION,
  installRecoveredLedger,
  inspectContinuityPayload,
  openContinuityBundle,
  readPassphraseFile,
  readPassphraseStream,
  rewrapContinuityBundle,
  restoreContinuityPayload,
  restoreProductionContinuityPayload,
  verifyEvidenceCustodySource,
} from "../server/continuity.js";
import { evidenceEvent, NdjsonEvidenceStore, rechainEvidenceEvents } from "../server/events.js";
import { buildOwnerSnapshot, buildRedactedContinuityExport } from "../server/projections.js";

const PASSPHRASE = "synthetic-recovery-passphrase";
const OWNER_TAG = "test-owner-tag";
const STATION_SECRET = "synthetic-station-secret-1234";

describe("owner continuity bundle", () => {
  it("refuses to emit an incomplete single-station bundle for a fleet edge", async () => {
    const primary = config("unused.ndjson");
    const fleetConfig: GatewayConfig = {
      ...primary,
      stations: [
        {
          id: primary.stationId,
          label: "Home",
          ownerTags: primary.ownerTags,
          secret: primary.stationSecret,
          site: "Home",
        },
        {
          id: "OFFICE_1",
          label: "Office",
          ownerTags: new Set(["office-owner"]),
          secret: "office-station-secret-strong",
          site: "Office",
        },
      ],
    };

    await expect(createContinuityBundle(fleetConfig, [], PASSPHRASE)).rejects.toThrow(
      "fleet mode must not emit an incomplete recovery artifact",
    );
  });

  it("creates a custody-linked compacted replacement ledger without losing operational state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-compact-"));
    const sourcePath = join(directory, "source.ndjson");
    const restoredTarget = join(directory, "compacted-edge");

    try {
      const source = new NdjsonEvidenceStore(sourcePath);
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "BootNotification", {
          chargePointModel: "Eve Single Pro-line",
          chargePointVendor: "Alfen",
          firmwareVersion: "7.0",
        }),
      );
      await source.append(
        evidenceEvent("STATION_1", "csms-to-station", "SendLocalList", {
          listVersion: 4,
          localAuthorizationList: [{ idTag: "tag_owner" }],
        }),
      );
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "SendLocalListResult", {
          listVersion: 4,
          status: "Accepted",
        }),
      );
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
          authorizationStatus: "Accepted",
          connectorId: 1,
          idTag: "tag_owner",
          meterStart: 100,
          timestamp: "2026-08-15T10:00:00.000Z",
          transactionFingerprint: "start-fingerprint",
          transactionId: 7,
        }),
      );
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "StartTransactionReplay", {
          transactionId: 7,
        }),
      );
      const meter = evidenceEvent("STATION_1", "station-to-csms", "MeterValues", {
        transactionId: 7,
      });
      await source.append(meter);
      await source.append({ ...meter, eventId: "meter-replay" });
      const stop = evidenceEvent("STATION_1", "station-to-csms", "StopTransaction", {
        meterStop: 250,
        timestamp: "2026-08-15T11:00:00.000Z",
        transactionId: 7,
      });
      await source.append(stop);
      await source.append({ ...stop, eventId: "stop-replay" });
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "StatusNotification", {
          connectorId: 1,
          errorCode: "NoError",
          status: "Preparing",
        }),
      );
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "StatusNotification", {
          connectorId: 1,
          errorCode: "NoError",
          status: "Available",
        }),
      );
      for (let index = 0; index < 20; index += 1) {
        await source.append(evidenceEvent("STATION_1", "station-to-csms", "Heartbeat", {}));
      }
      await source.archiveCurrentSegment();
      await source.append(evidenceEvent("STATION_1", "system", "EvidenceSegmentArchived", {}));

      const sourceSnapshot = await source.readSnapshot();
      const fullBundle = await createContinuityBundle(
        config(sourcePath),
        sourceSnapshot.events,
        PASSPHRASE,
        sourceSnapshot.archives,
      );
      const serializedFullBundle = `${JSON.stringify(fullBundle, null, 2)}\n`;
      const compactedBundle = await compactContinuityBundle(
        serializedFullBundle,
        PASSPHRASE,
        new Date("2026-08-15T12:00:00.000Z"),
      );
      const compactedPayload = await openContinuityBundle(
        JSON.stringify(compactedBundle),
        PASSPHRASE,
      );
      await expect(
        compactContinuityBundle(serializedFullBundle, "wrong-compaction-passphrase"),
      ).rejects.toThrow("authentication failed");

      expect(compactedPayload.schemaVersion).toBe(4);
      expect(compactedPayload.evidenceArchives).toEqual([]);
      expect(compactedPayload.evidence.length).toBeLessThan(sourceSnapshot.events.length);
      expect(compactedPayload.evidence.at(-1)?.message).toBe("EvidenceHistoryCompacted");
      expect(
        compactedPayload.evidence
          .slice(0, -1)
          .every((event) => typeof event.carriedFromRecordHash === "string"),
      ).toBe(true);
      expect(inspectContinuityPayload(compactedPayload)).toMatchObject({
        archiveSegmentCount: 0,
        evidenceHistory: {
          custodyBundleCount: 1,
          custodiedEventCount: sourceSnapshot.events.length,
          mode: "compacted-operational",
        },
        payloadSchemaVersion: 4,
      });
      await expect(
        verifyEvidenceCustodySource(compactedPayload, serializedFullBundle, PASSPHRASE),
      ).resolves.toMatchObject({ eventCount: sourceSnapshot.events.length });
      const forgedCarryForward = {
        ...compactedPayload,
        evidence: rechainEvidenceEvents(
          compactedPayload.evidence.map((event, index) =>
            index === 0 ? { ...event, payload: { forged: true } } : event,
          ),
        ),
      };
      await expect(
        verifyEvidenceCustodySource(forgedCarryForward, serializedFullBundle, PASSPHRASE),
      ).rejects.toThrow("carry-forward records do not match");
      expect(() =>
        assertEvidenceCustodyIncludesBundle(compactedPayload, serializedFullBundle.trim()),
      ).toThrow("not referenced");

      await restoreContinuityPayload(compactedPayload, restoredTarget);
      const restored = new NdjsonEvidenceStore(join(restoredTarget, "events.ndjson"));
      await expect(
        restored.recordTransactionStart("STATION_1", "start-fingerprint", () => {
          throw new Error("custodied retry must reuse its retained transaction ID");
        }),
      ).resolves.toEqual({ replayed: true, transactionId: 7 });
      const restoredEvents = await restored.readEvents();
      const snapshot = buildOwnerSnapshot(
        config(join(restoredTarget, "events.ndjson")),
        { getRuntime: () => ({ connected: false, connectedAt: null }) },
        restoredEvents,
      );
      expect(snapshot.station.boot).toMatchObject({ model: "Eve Single Pro-line" });
      expect(snapshot.station.connectors).toMatchObject([{ status: "Available" }]);
      expect(snapshot.sessions).toMatchObject([
        { energyWh: 150, replayedMessageCount: 3, status: "complete", transactionId: 7 },
      ]);
      expect(buildRedactedContinuityExport(config(sourcePath), restoredEvents).history).toEqual({
        custodyBundleCount: 1,
        custodiedEventCount: sourceSnapshot.events.length,
        mode: "compacted-operational",
      });

      const replacementBundle = await createContinuityBundle(
        config(join(restoredTarget, "events.ndjson")),
        restoredEvents,
        PASSPHRASE,
      );
      const replacementPayload = await openContinuityBundle(
        JSON.stringify(replacementBundle),
        PASSPHRASE,
      );
      expect(replacementPayload.schemaVersion).toBe(4);
      expect(replacementPayload.evidenceHistory).toEqual(compactedPayload.evidenceHistory);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses to overwrite a compacted continuity output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-compact-output-"));
    const bundlePath = join(directory, "source.json");
    const outputPath = join(directory, "existing.json");
    const passphrasePath = join(directory, "passphrase");

    try {
      const eventPath = join(directory, "events.ndjson");
      const store = new NdjsonEvidenceStore(eventPath);
      await store.append(evidenceEvent("STATION_1", "system", "Checkpoint", { safe: true }));
      const bundle = await createContinuityBundle(
        config(eventPath),
        await store.readEvents(),
        PASSPHRASE,
      );
      await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
      await writeFile(passphrasePath, `${PASSPHRASE}\n`, { mode: 0o600 });
      await writeFile(outputPath, "owner data\n", { mode: 0o600 });
      const result = spawnSync(
        join(process.cwd(), "node_modules/.bin/tsx"),
        [
          join(process.cwd(), "server/continuity-cli.ts"),
          "compact",
          "--bundle",
          bundlePath,
          "--output",
          outputPath,
          "--passphrase-file",
          passphrasePath,
          "--confirmation",
          EVIDENCE_COMPACTION_CONFIRMATION,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EEXIST");
      await expect(readFile(outputPath, "utf8")).resolves.toBe("owner data\n");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("encrypts secrets and restores a verified ledger onto a fresh edge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-"));
    const sourcePath = join(directory, "source.ndjson");
    const target = join(directory, "restored-edge");

    try {
      const source = new NdjsonEvidenceStore(sourcePath);
      await source.append(
        evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
          transactionFingerprint: "fingerprint-1",
          transactionId: 7,
        }),
      );
      await source.append(evidenceEvent("STATION_1", "system", "Checkpoint", { safe: true }));
      const bundle = await createContinuityBundle(
        config(sourcePath),
        await source.readEvents(),
        PASSPHRASE,
      );
      const serialized = JSON.stringify(bundle);

      expect(serialized).not.toContain(OWNER_TAG);
      expect(serialized).not.toContain(STATION_SECRET);
      expect(serialized).not.toContain("owner-api-token-with-at-least-thirty-two-characters");

      const payload = await openContinuityBundle(serialized, PASSPHRASE);
      expect(inspectContinuityPayload(payload)).toMatchObject({
        eventCount: 2,
        ownerTagCount: 1,
        archiveSegmentCount: 0,
        currentEventCount: 2,
        payloadSchemaVersion: 3,
        recoveryPolicy: {
          legacySafetyDefaultsApplied: false,
          proxyTrustRequiresTopologyReview: true,
          sourceTrustedProxyHeaders: true,
          restoredTrustProxyHeaders: false,
        },
        stationId: "STATION_1",
      });

      await restoreContinuityPayload(payload, target);
      const restoredStore = new NdjsonEvidenceStore(join(target, "events.ndjson"));
      await expect(restoredStore.readEvents()).resolves.toHaveLength(2);
      await expect(
        restoredStore.recordTransactionStart("STATION_1", "fingerprint-1", () => {
          throw new Error("replay must not create another start record");
        }),
      ).resolves.toEqual({ replayed: true, transactionId: 7 });
      await expect(
        restoredStore.recordTransactionStart("STATION_1", "fingerprint-2", (transactionId) =>
          evidenceEvent("STATION_1", "station-to-csms", "StartTransaction", {
            transactionFingerprint: "fingerprint-2",
            transactionId,
          }),
        ),
      ).resolves.toEqual({ replayed: false, transactionId: 8 });

      const restoredEnvironment = await readFile(join(target, ".env"), "utf8");
      expect(restoredEnvironment).toContain(OWNER_TAG);
      expect(restoredEnvironment).toContain(STATION_SECRET);
      expect(loadConfig(parseEnv(restoredEnvironment))).toMatchObject({
        eventLogMaxBytes: 268_435_456,
        ocppMaxConnections: 3,
        ocppMaxPayloadBytes: 262_144,
        ocppMessageBurst: 17,
        ocppMessagesPerMinute: 123,
        trustProxyHeaders: false,
      });
      expect((await stat(join(target, ".env"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(target, "events.ndjson"))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("restores legacy bundles with explicit safe defaults and a visible warning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-legacy-"));
    const sourcePath = join(directory, "source.ndjson");
    const target = join(directory, "restored-edge");

    try {
      const bundle = await createContinuityBundle(config(sourcePath), [], PASSPHRASE);
      const current = await openContinuityBundle(JSON.stringify(bundle), PASSPHRASE);
      const legacyConfiguration = {
        apiHost: current.configuration.apiHost,
        apiPort: current.configuration.apiPort,
        eventLogMaxBytes: current.configuration.eventLogMaxBytes ?? 268_435_456,
        heartbeatSeconds: current.configuration.heartbeatSeconds,
        ocppHost: current.configuration.ocppHost,
        ownerApiToken: current.configuration.ownerApiToken,
        ownerTags: current.configuration.ownerTags,
        port: current.configuration.port,
        stationId: current.configuration.stationId,
        stationSecret: current.configuration.stationSecret,
        uiDirectory: current.configuration.uiDirectory,
      };
      const legacy = {
        ...current,
        configuration: legacyConfiguration,
        schemaVersion: 1 as const,
      };

      await restoreContinuityPayload(legacy, target);
      const restoredEnvironment = await readFile(join(target, ".env"), "utf8");
      expect(loadConfig(parseEnv(restoredEnvironment))).toMatchObject({
        ocppMaxConnections: 8,
        ocppMaxPayloadBytes: 1_048_576,
        ocppMessageBurst: 60,
        ocppMessagesPerMinute: 600,
        trustProxyHeaders: false,
      });
      await expect(readFile(join(target, "restore-manifest.json"), "utf8")).resolves.toContain(
        '"legacySafetyDefaultsApplied": true',
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("creates a non-overwriting production package and installs only its verified ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-production-recovery-"));
    const sourcePath = join(directory, "source.ndjson");
    const target = join(directory, "production-package");
    const installedPath = join(directory, "installed.ndjson");

    try {
      const source = new NdjsonEvidenceStore(sourcePath);
      await source.append(evidenceEvent("STATION_1", "system", "Checkpoint", { safe: true }));
      await source.archiveCurrentSegment();
      await source.append(evidenceEvent("STATION_1", "system", "Active", { safe: true }));
      const sourceSnapshot = await source.readSnapshot();
      const bundle = await createContinuityBundle(
        config(sourcePath),
        sourceSnapshot.events,
        PASSPHRASE,
        sourceSnapshot.archives,
      );
      const payload = await openContinuityBundle(JSON.stringify(bundle), PASSPHRASE);
      await restoreProductionContinuityPayload(payload, target, {
        acmeEmail: "Owner@Example.net",
        ocppDomain: "OCPP.EXAMPLE.NET",
        ownerDomain: "owner.example.net",
      });

      const environment = await readFile(join(target, ".env.production"), "utf8");
      expect(environment).toContain('CHARGEOS_OCPP_DOMAIN="ocpp.example.net"');
      expect(environment).toContain('CHARGEOS_OWNER_DOMAIN="owner.example.net"');
      expect(environment).toContain('CHARGEOS_OCPP_MAX_CONNECTIONS="3"');
      expect(environment).not.toContain(STATION_SECRET);
      expect(environment).not.toContain(OWNER_TAG);
      expect((await stat(join(target, "secrets"))).mode & 0o777).toBe(0o700);
      expect((await stat(join(target, "events.ndjson.archives"))).mode & 0o777).toBe(0o755);
      expect((await stat(join(target, "secrets", "station-secret"))).mode & 0o777).toBe(0o444);
      await expect(readFile(join(target, "restore-manifest.json"), "utf8")).resolves.toContain(
        '"proxyTopologyValidated": false',
      );
      expect(await readdir(`${join(target, "events.ndjson")}.archives`)).toHaveLength(1);
      await expect(
        restoreProductionContinuityPayload(payload, target, {
          acmeEmail: "owner@example.net",
          ocppDomain: "ocpp.example.net",
          ownerDomain: "owner.example.net",
        }),
      ).rejects.toThrow("already exists");
      await expect(
        restoreProductionContinuityPayload(payload, join(directory, "unsafe-domains"), {
          acmeEmail: "owner@example.net",
          ocppDomain: "owner.example.net",
          ownerDomain: "owner.example.net",
        }),
      ).rejects.toThrow("separate OCPP and owner domains");

      await expect(
        installRecoveredLedger(join(target, "events.ndjson"), installedPath, 268_435_456),
      ).resolves.toBe(2);
      const installedSnapshot = await new NdjsonEvidenceStore(installedPath).readSnapshot();
      expect(installedSnapshot.archives).toHaveLength(1);
      expect(installedSnapshot.currentEventCount).toBe(1);
      expect(installedSnapshot.events).toHaveLength(2);
      await expect(
        installRecoveredLedger(join(target, "events.ndjson"), installedPath, 268_435_456),
      ).rejects.toThrow("already exists");
      const tamperedPath = join(directory, "tampered.ndjson");
      const [event] = await source.readEvents();
      await writeFile(tamperedPath, `${JSON.stringify({ ...event, message: "Changed" })}\n`);
      await expect(
        installRecoveredLedger(
          tamperedPath,
          join(directory, "tampered-target.ndjson"),
          268_435_456,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects the wrong passphrase, ciphertext changes, and existing restore targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-fail-"));
    const sourcePath = join(directory, "source.ndjson");

    try {
      const source = new NdjsonEvidenceStore(sourcePath);
      await source.append(evidenceEvent("STATION_1", "system", "Checkpoint", {}));
      const bundle = await createContinuityBundle(
        config(sourcePath),
        await source.readEvents(),
        PASSPHRASE,
      );
      const serialized = JSON.stringify(bundle);

      await expect(openContinuityBundle(serialized, "incorrect-passphrase-123")).rejects.toThrow(
        "authentication failed",
      );
      const tampered = {
        ...bundle,
        encryption: {
          ...bundle.encryption,
          ciphertext: `${bundle.encryption.ciphertext.slice(0, -4)}AAAA`,
        },
      };
      await expect(openContinuityBundle(JSON.stringify(tampered), PASSPHRASE)).rejects.toThrow(
        "authentication failed",
      );

      const payload = await openContinuityBundle(serialized, PASSPHRASE);
      await expect(restoreContinuityPayload(payload, directory)).rejects.toBeInstanceOf(
        ContinuityBundleError,
      );
      const danglingTarget = join(directory, "dangling-restore-target");
      await symlink(join(directory, "missing-restore-target"), danglingTarget);
      await expect(restoreContinuityPayload(payload, danglingTarget)).rejects.toThrow(
        "already exists",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rewraps a verified bundle without exposing or changing its recovery payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-rotate-"));
    const sourcePath = join(directory, "source.ndjson");
    const newPassphrase = "different-synthetic-recovery-passphrase";

    try {
      const source = new NdjsonEvidenceStore(sourcePath);
      await source.append(evidenceEvent("STATION_1", "system", "Checkpoint", { safe: true }));
      const original = await createContinuityBundle(
        config(sourcePath),
        await source.readEvents(),
        PASSPHRASE,
      );
      const rotated = await rewrapContinuityBundle(
        JSON.stringify(original),
        PASSPHRASE,
        newPassphrase,
      );

      expect(rotated.encryption.ciphertext).not.toBe(original.encryption.ciphertext);
      await expect(openContinuityBundle(JSON.stringify(rotated), PASSPHRASE)).rejects.toThrow(
        "authentication failed",
      );
      const payload = await openContinuityBundle(JSON.stringify(rotated), newPassphrase);
      expect(inspectContinuityPayload(payload)).toMatchObject({
        eventCount: 1,
        exportedAt: original.createdAt,
        stationId: "STATION_1",
      });
      expect(JSON.stringify(rotated)).not.toContain(OWNER_TAG);
      await expect(
        rewrapContinuityBundle(JSON.stringify(rotated), newPassphrase, newPassphrase),
      ).rejects.toThrow("must be different");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reads only owner-private, non-symlinked passphrase files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-continuity-passphrase-"));
    const passphrasePath = join(directory, "passphrase");
    const linkPath = join(directory, "passphrase-link");

    try {
      await writeFile(passphrasePath, `${PASSPHRASE}\n`, { mode: 0o600 });
      await expect(readPassphraseFile(passphrasePath)).resolves.toBe(PASSPHRASE);
      await symlink(passphrasePath, linkPath);
      await expect(readPassphraseFile(linkPath)).rejects.toThrow("non-symlinked");
      await chmod(passphrasePath, 0o644);
      await expect(readPassphraseFile(passphrasePath)).rejects.toThrow("group or others");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("accepts one bounded passphrase line from a production command stream", async () => {
    await expect(readPassphraseStream(Readable.from([`${PASSPHRASE}\n`]))).resolves.toBe(
      PASSPHRASE,
    );
    await expect(
      readPassphraseStream(Readable.from([`${PASSPHRASE}\nsecond-line`])),
    ).rejects.toThrow("exactly one line");
    await expect(readPassphraseStream(Readable.from(["x".repeat(4_097)]))).rejects.toThrow(
      "too large",
    );
  });
});

function config(eventLogPath: string): GatewayConfig {
  return {
    apiHost: "127.0.0.1",
    apiPort: 9080,
    eventLogPath,
    eventLogMaxBytes: 268_435_456,
    heartbeatSeconds: 60,
    ocppHost: "127.0.0.1",
    ocppMaxConnections: 3,
    ocppMaxPayloadBytes: 262_144,
    ocppMessageBurst: 17,
    ocppMessagesPerMinute: 123,
    ownerApiToken: "owner-api-token-with-at-least-thirty-two-characters",
    ownerTags: new Set([OWNER_TAG]),
    port: 9000,
    stationId: "STATION_1",
    stationSecret: STATION_SECRET,
    trustProxyHeaders: true,
    uiDirectory: "dist/ui",
  };
}
