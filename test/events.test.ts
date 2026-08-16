import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evidenceEvent,
  EvidenceArchiveError,
  EvidenceCapacityError,
  EvidenceIntegrityError,
  NdjsonEvidenceStore,
} from "../server/events.js";

describe("NdjsonEvidenceStore", () => {
  it("keeps transaction IDs monotonic across process restarts and protects the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-"));
    const path = join(directory, "events.ndjson");

    try {
      const firstStore = new NdjsonEvidenceStore(path);
      const first = await firstStore.recordTransactionStart(
        "station",
        "fingerprint-1",
        (transactionId) =>
          evidenceEvent("station", "station-to-csms", "StartTransaction", {
            transactionFingerprint: "fingerprint-1",
            transactionId,
          }),
      );
      expect(first).toEqual({ replayed: false, transactionId: 1 });
      await firstStore.append(evidenceEvent("station", "system", "Checkpoint", { safe: true }));

      const persisted = await firstStore.readEvents();
      expect(persisted[0]?.previousRecordHash).toBeNull();
      expect(persisted[0]?.recordHash).toMatch(/^[a-f0-9]{64}$/);
      expect(persisted[1]?.previousRecordHash).toBe(persisted[0]?.recordHash);

      const restartedStore = new NdjsonEvidenceStore(path);
      await expect(
        restartedStore.recordTransactionStart("station", "fingerprint-1", () => {
          throw new Error("replay must not create another start record");
        }),
      ).resolves.toEqual({ replayed: true, transactionId: 1 });
      await expect(
        restartedStore.recordTransactionStart("station", "fingerprint-2", (transactionId) =>
          evidenceEvent("station", "station-to-csms", "StartTransaction", {
            transactionFingerprint: "fingerprint-2",
            transactionId,
          }),
        ),
      ).resolves.toEqual({ replayed: false, transactionId: 2 });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("detects changes to an existing evidence record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-tamper-"));
    const path = join(directory, "events.ndjson");

    try {
      const store = new NdjsonEvidenceStore(path);
      await store.append(evidenceEvent("station", "system", "Checkpoint", { safe: true }));
      const content = await readFile(path, "utf8");
      await writeFile(path, content.replace('"safe":true', '"safe":false'), "utf8");

      await expect(new NdjsonEvidenceStore(path).readEvents()).rejects.toBeInstanceOf(
        EvidenceIntegrityError,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("commits one transaction start before concurrent retries receive its ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-concurrent-"));
    const path = join(directory, "events.ndjson");

    try {
      const store = new NdjsonEvidenceStore(path);
      const record = () =>
        store.recordTransactionStart("station", "same-fingerprint", (transactionId) =>
          evidenceEvent("station", "station-to-csms", "StartTransaction", {
            transactionFingerprint: "same-fingerprint",
            transactionId,
          }),
        );
      const results = await Promise.all([record(), record()]);

      expect(results).toEqual([
        { replayed: false, transactionId: 1 },
        { replayed: true, transactionId: 1 },
      ]);
      expect(
        (await store.readEvents()).filter((event) => event.message === "StartTransaction"),
      ).toHaveLength(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses an append that would exceed the configured evidence ceiling", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-capacity-"));
    const path = join(directory, "events.ndjson");

    try {
      const store = new NdjsonEvidenceStore(path, 800);
      await store.append(evidenceEvent("station", "system", "Checkpoint", { safe: true }));
      const before = await readFile(path, "utf8");

      await expect(
        store.append(evidenceEvent("station", "system", "Oversized", { value: "x".repeat(2_000) })),
      ).rejects.toBeInstanceOf(EvidenceCapacityError);
      expect(await readFile(path, "utf8")).toBe(before);
      await expect(store.readEvents()).resolves.toHaveLength(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("archives the current segment atomically and continues one verified logical chain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-archive-"));
    const path = join(directory, "events.ndjson");
    const archiveDirectory = `${path}.archives`;

    try {
      const store = new NdjsonEvidenceStore(path, 2_000);
      await store.append(evidenceEvent("station", "system", "First", { order: 1 }));
      await store.append(evidenceEvent("station", "system", "Second", { order: 2 }));
      const archived = await store.archiveCurrentSegment();
      expect(archived).toMatchObject({ eventCount: 2, sequence: 1 });
      expect(archived.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect((await store.getCapacity()).usedBytes).toBe(0);
      expect((await stat(archiveDirectory)).mode & 0o777).toBe(0o700);
      const [archiveName] = await readdir(archiveDirectory);
      expect(archiveName).toBe(`segment-00000001-${archived.sha256}.ndjson`);
      expect((await stat(join(archiveDirectory, archiveName!))).mode & 0o777).toBe(0o400);

      await store.append(evidenceEvent("station", "system", "Third", { order: 3 }));
      const snapshot = await store.readSnapshot();
      expect(snapshot.archives).toEqual([archived]);
      expect(snapshot.currentEventCount).toBe(1);
      expect(snapshot.events.map((event) => event.message)).toEqual(["First", "Second", "Third"]);
      expect(snapshot.events[2]?.previousRecordHash).toBe(snapshot.events[1]?.recordHash);

      const restarted = new NdjsonEvidenceStore(path, 2_000);
      await expect(restarted.readEvents()).resolves.toHaveLength(3);
      const second = await restarted.archiveCurrentSegment();
      expect(second).toMatchObject({ eventCount: 1, sequence: 2 });
      await expect(restarted.archiveCurrentSegment()).rejects.toThrow("segment is empty");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails closed when an archived segment is changed or the archive directory is ambiguous", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-evidence-archive-tamper-"));
    const path = join(directory, "events.ndjson");
    const archiveDirectory = `${path}.archives`;

    try {
      const store = new NdjsonEvidenceStore(path);
      await store.append(evidenceEvent("station", "system", "Archived", { safe: true }));
      await store.archiveCurrentSegment();
      const [archiveName] = await readdir(archiveDirectory);
      const archivePath = join(archiveDirectory, archiveName!);
      await chmod(archivePath, 0o600);
      const content = await readFile(archivePath, "utf8");
      await writeFile(archivePath, content.replace('"safe":true', '"safe":false'));
      await expect(new NdjsonEvidenceStore(path).readEvents()).rejects.toBeInstanceOf(
        EvidenceArchiveError,
      );

      await rm(archivePath);
      await writeFile(join(archiveDirectory, "notes.txt"), "unexpected");
      await expect(new NdjsonEvidenceStore(path).readEvents()).rejects.toThrow(
        "Unexpected evidence archive entry",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
