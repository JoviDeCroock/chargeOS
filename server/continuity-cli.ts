import { loadEnvFile } from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import {
  compareEvidenceCheckpoint,
  createEvidenceCheckpoint,
  readEvidencePrivateKey,
  verifyEvidenceCheckpoint,
  writeEvidenceSigningKeyPair,
} from "./checkpoint.js";
import { loadConfig } from "./config.js";
import {
  assertContinuityMatchesEvidenceSnapshot,
  compactContinuityBundle,
  createContinuityBundle,
  EVIDENCE_ARCHIVE_CONFIRMATION,
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
} from "./continuity.js";
import { evidenceEvent, NdjsonEvidenceStore } from "./events.js";
import { OwnerTagRegistry, withOwnerTagRegistry } from "./owner-tags.js";

await main().catch((error: unknown) => {
  console.error(
    `chargeOS continuity: ${error instanceof Error ? error.message : "operation failed"}`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(`chargeOS owner continuity

Usage:
  continuity export --output <bundle> --passphrase-file <file>
  continuity export-stdout --passphrase-stdin
  continuity archive-stdout --bundle <pre-archive-bundle> --passphrase-stdin --confirmation <exact-phrase>
  continuity compact --bundle <full-source-bundle> --output <new-compacted-bundle> --passphrase-file <file> --confirmation <exact-phrase>
  continuity inspect --bundle <bundle> --passphrase-file <file>
  continuity keygen --target <new-directory> --passphrase-file <file>
  continuity checkpoint --bundle <bundle> --passphrase-file <file> --private-key <file> --key-passphrase-file <file> --output <checkpoint>
  continuity verify-checkpoint --checkpoint <checkpoint> --public-key <file> [--bundle <bundle> --passphrase-file <file>]
  continuity verify-custody --bundle <compacted-bundle> --source-bundle <custodied-source-bundle> --passphrase-file <file>
  continuity rotate --bundle <bundle> --output <new-bundle> --old-passphrase-file <file> --new-passphrase-file <file>
  continuity restore --bundle <bundle> --passphrase-file <file> --target <new-directory>
  continuity restore-production --bundle <bundle> --passphrase-file <file> --target <new-directory> --ocpp-domain <host> --owner-domain <host> --acme-email <email>
  continuity install-ledger --source <recovery-events>`);
    return;
  }

  if (command === "export-stdout") {
    if (!arguments_.includes("--passphrase-stdin") || process.stdin.isTTY) {
      throw new Error("export-stdout requires a redirected --passphrase-stdin");
    }
    loadLocalEnvironment();
    const passphrase = await readPassphraseStream(process.stdin);
    const config = await loadConfigWithOwnerTagState();
    const snapshot = await new NdjsonEvidenceStore(
      config.eventLogPath,
      config.eventLogMaxBytes,
    ).readSnapshot();
    const bundle = await createContinuityBundle(
      config,
      snapshot.events,
      passphrase,
      snapshot.archives,
    );
    process.stdout.write(`${JSON.stringify(bundle)}\n`);
    return;
  }

  if (command === "archive-stdout") {
    if (!arguments_.includes("--passphrase-stdin") || process.stdin.isTTY) {
      throw new Error("archive-stdout requires a redirected --passphrase-stdin");
    }
    if (requireArgument(arguments_, "--confirmation") !== EVIDENCE_ARCHIVE_CONFIRMATION) {
      throw new Error("archive-stdout requires the exact stopped-edge confirmation");
    }
    loadLocalEnvironment();
    const passphrase = await readPassphraseStream(process.stdin);
    const config = await loadConfigWithOwnerTagState();
    const store = new NdjsonEvidenceStore(config.eventLogPath, config.eventLogMaxBytes);
    const before = await store.readSnapshot();
    if (before.currentEventCount === 0) throw new Error("Current evidence segment is empty");
    const payload = await openContinuityBundle(
      await readFile(requireArgument(arguments_, "--bundle"), "utf8"),
      passphrase,
    );
    assertContinuityMatchesEvidenceSnapshot(payload, before);
    const archived = await store.archiveCurrentSegment();
    await store.append(
      evidenceEvent(config.stationId, "system", "EvidenceSegmentArchived", archived),
    );
    const after = await store.readSnapshot();
    const bundle = await createContinuityBundle(config, after.events, passphrase, after.archives);
    process.stderr.write(
      `Archived evidence segment ${archived.sequence} (${archived.eventCount} events, ${archived.sha256})\n`,
    );
    process.stdout.write(`${JSON.stringify(bundle)}\n`);
    return;
  }

  if (command === "install-ledger") {
    loadLocalEnvironment();
    const config = loadConfig();
    const eventCount = await installRecoveredLedger(
      requireArgument(arguments_, "--source"),
      config.eventLogPath,
      config.eventLogMaxBytes,
    );
    console.log(`Installed ${eventCount} verified recovery events into ${config.eventLogPath}`);
    return;
  }

  if (command === "rotate") {
    const bundlePath = requireArgument(arguments_, "--bundle");
    const output = requireArgument(arguments_, "--output");
    const currentPassphrase = await readPassphraseFile(
      requireArgument(arguments_, "--old-passphrase-file"),
    );
    const newPassphrase = await readPassphraseFile(
      requireArgument(arguments_, "--new-passphrase-file"),
    );
    const bundle = await rewrapContinuityBundle(
      await readFile(bundlePath, "utf8"),
      currentPassphrase,
      newPassphrase,
    );
    await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Rewrapped continuity bundle written to ${output}`);
    return;
  }

  if (command === "compact") {
    if (requireArgument(arguments_, "--confirmation") !== EVIDENCE_COMPACTION_CONFIRMATION) {
      throw new Error("compact requires the exact fresh-edge custody confirmation");
    }
    const bundlePath = requireArgument(arguments_, "--bundle");
    const output = requireArgument(arguments_, "--output");
    const passphrase = await readPassphraseFile(requireArgument(arguments_, "--passphrase-file"));
    const bundle = await compactContinuityBundle(await readFile(bundlePath, "utf8"), passphrase);
    await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Compacted operational continuity bundle written to ${output}`);
    return;
  }

  if (command === "keygen") {
    const passphrase = await readPassphraseFile(requireArgument(arguments_, "--passphrase-file"));
    const target = requireArgument(arguments_, "--target");
    const manifest = await writeEvidenceSigningKeyPair(target, passphrase);
    console.log(JSON.stringify({ target, ...manifest }, null, 2));
    return;
  }

  if (command === "verify-checkpoint") {
    const checkpoint = verifyEvidenceCheckpoint(
      await readFile(requireArgument(arguments_, "--checkpoint"), "utf8"),
      await readFile(requireArgument(arguments_, "--public-key"), "utf8"),
    );
    if (arguments_.includes("--bundle")) {
      const payload = await openContinuityBundle(
        await readFile(requireArgument(arguments_, "--bundle"), "utf8"),
        await readPassphraseFile(requireArgument(arguments_, "--passphrase-file")),
      );
      compareEvidenceCheckpoint(checkpoint, payload);
    }
    const { signature: _, ...inspection } = checkpoint;
    console.log(JSON.stringify({ ...inspection, verified: true }, null, 2));
    return;
  }

  if (command === "verify-custody") {
    const passphrase = await readPassphraseFile(requireArgument(arguments_, "--passphrase-file"));
    const compacted = await openContinuityBundle(
      await readFile(requireArgument(arguments_, "--bundle"), "utf8"),
      passphrase,
    );
    const sourceSerialized = await readFile(requireArgument(arguments_, "--source-bundle"), "utf8");
    const record = await verifyEvidenceCustodySource(compacted, sourceSerialized, passphrase);
    console.log(JSON.stringify({ custody: record, verified: true }, null, 2));
    return;
  }

  const passphraseFile = requireArgument(arguments_, "--passphrase-file");
  const passphrase = await readPassphraseFile(passphraseFile);

  if (command === "checkpoint") {
    const payload = await openContinuityBundle(
      await readFile(requireArgument(arguments_, "--bundle"), "utf8"),
      passphrase,
    );
    const privateKey = await readEvidencePrivateKey(requireArgument(arguments_, "--private-key"));
    const keyPassphrase = await readPassphraseFile(
      requireArgument(arguments_, "--key-passphrase-file"),
    );
    const checkpoint = createEvidenceCheckpoint(payload, privateKey, keyPassphrase);
    const output = requireArgument(arguments_, "--output");
    await writeFile(output, `${JSON.stringify(checkpoint, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Signed evidence checkpoint written to ${output}`);
    return;
  }

  if (command === "export") {
    loadLocalEnvironment();
    const output = requireArgument(arguments_, "--output");
    const config = await loadConfigWithOwnerTagState();
    const snapshot = await new NdjsonEvidenceStore(
      config.eventLogPath,
      config.eventLogMaxBytes,
    ).readSnapshot();
    const bundle = await createContinuityBundle(
      config,
      snapshot.events,
      passphrase,
      snapshot.archives,
    );
    await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Encrypted continuity bundle written to ${output}`);
    return;
  }

  const bundlePath = requireArgument(arguments_, "--bundle");
  const payload = await openContinuityBundle(await readFile(bundlePath, "utf8"), passphrase);
  if (command === "inspect") {
    console.log(JSON.stringify(inspectContinuityPayload(payload), null, 2));
    return;
  }
  if (command === "restore") {
    const target = requireArgument(arguments_, "--target");
    const restoredPath = await restoreContinuityPayload(payload, target);
    console.log(`Continuity state restored to ${restoredPath}`);
    return;
  }
  if (command === "restore-production") {
    const target = requireArgument(arguments_, "--target");
    const restoredPath = await restoreProductionContinuityPayload(payload, target, {
      acmeEmail: requireArgument(arguments_, "--acme-email"),
      ocppDomain: requireArgument(arguments_, "--ocpp-domain"),
      ownerDomain: requireArgument(arguments_, "--owner-domain"),
    });
    console.log(`Production continuity package restored to ${restoredPath}`);
    return;
  }
  throw new Error(
    "Usage: continuity <export|export-stdout|archive-stdout|compact|inspect|keygen|checkpoint|verify-checkpoint|verify-custody|rotate|restore|restore-production|install-ledger> [options]",
  );
}

function loadLocalEnvironment(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function loadConfigWithOwnerTagState(): Promise<ReturnType<typeof loadConfig>> {
  const config = loadConfig();
  const registry = await OwnerTagRegistry.open(config);
  return withOwnerTagRegistry(config, registry);
}

function requireArgument(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}
