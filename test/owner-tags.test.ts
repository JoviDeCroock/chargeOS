import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { configForStation, type GatewayConfig } from "../server/config.js";
import type { EvidenceEvent, EvidenceStore } from "../server/events.js";
import {
  ownerTagStatePath,
  openOwnerTagRegistries,
  OwnerTagRegistry,
  OwnerTagStateError,
  stationOwnerTagStatePath,
  withOwnerTagRegistries,
  withOwnerTagRegistry,
} from "../server/owner-tags.js";
import { OWNER_TAG_REVOCATION_CONFIRMATION } from "../shared/owner-tags.js";

class MemoryEvidenceStore implements EvidenceStore {
  readonly events: EvidenceEvent[] = [];
  failAppend = false;

  async allocateAuthorizationRevision(): Promise<number> {
    return 1;
  }

  async recordTransactionStart(): Promise<{ replayed: boolean; transactionId: number }> {
    return { replayed: false, transactionId: 1 };
  }

  async append(event: EvidenceEvent): Promise<void> {
    if (this.failAppend) throw new Error("synthetic evidence failure");
    this.events.push(event);
  }

  async readEvents(): Promise<readonly EvidenceEvent[]> {
    return this.events;
  }
}

describe("owner-custodied RFID desired state", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it("persists owner tags across restart while auditing pseudonyms only", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const evidence = new MemoryEvidenceStore();
    const registry = await OwnerTagRegistry.open(bootstrap);
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);

    const added = await registry.add(liveConfig, evidence, "second-owner-tag");
    expect(added).toMatchObject({ stateVersion: 2, tagCount: 2 });
    expect(liveConfig.ownerTags.has("second-owner-tag")).toBe(true);
    expect(JSON.stringify(evidence.events)).not.toContain("second-owner-tag");
    expect((await stat(ownerTagStatePath(bootstrap.eventLogPath))).mode & 0o777).toBe(0o600);

    const restartedBootstrap = { ...bootstrap, ownerTags: new Set(["stale-bootstrap-tag"]) };
    const restarted = await OwnerTagRegistry.open(restartedBootstrap);
    expect(restarted.tags).toEqual(new Set(["first-owner-tag", "second-owner-tag"]));
    await restarted.revoke(
      withOwnerTagRegistry(restartedBootstrap, restarted),
      evidence,
      added.tagPseudonym,
      { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
    );
    expect(restarted.tags).toEqual(new Set(["first-owner-tag"]));
    expect(JSON.stringify(evidence.events)).not.toContain("second-owner-tag");
  });

  it("persists independent desired tag registries for every fleet station", async () => {
    const directory = await temporaryDirectory(directories);
    const primary = config(join(directory, "events.ndjson"));
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
          ownerTags: new Set(["office-owner-tag"]),
          secret: "office-station-secret-strong",
          site: "Office",
        },
      ],
    };
    const registries = await openOwnerTagRegistries(fleetConfig);
    const liveConfig = withOwnerTagRegistries(fleetConfig, registries);
    const office = registries.get("OFFICE_1")!;
    await office.add(
      configForStation(liveConfig, "OFFICE_1"),
      new MemoryEvidenceStore(),
      "second-office-tag",
    );

    expect(registries.get(primary.stationId)?.tags).toEqual(new Set(["first-owner-tag"]));
    expect(office.tags).toEqual(new Set(["office-owner-tag", "second-office-tag"]));
    expect((await stat(ownerTagStatePath(primary.eventLogPath))).mode & 0o777).toBe(0o600);
    expect(
      (await stat(stationOwnerTagStatePath(primary.eventLogPath, "OFFICE_1"))).mode & 0o777,
    ).toBe(0o600);

    const restarted = await openOwnerTagRegistries(fleetConfig);
    expect(restarted.get(primary.stationId)?.tags).toEqual(new Set(["first-owner-tag"]));
    expect(restarted.get("OFFICE_1")?.tags).toEqual(
      new Set(["office-owner-tag", "second-office-tag"]),
    );
  });

  it("authenticates the state and rejects tampering, the wrong station secret, and symlinks", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    await OwnerTagRegistry.open(bootstrap);
    const statePath = ownerTagStatePath(bootstrap.eventLogPath);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.tags = ["forged-owner-tag"];
    await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await expect(OwnerTagRegistry.open(bootstrap)).rejects.toThrow(/authentication failed/);

    const otherDirectory = await temporaryDirectory(directories);
    const other = config(join(otherDirectory, "events.ndjson"));
    await OwnerTagRegistry.open(other);
    await expect(
      OwnerTagRegistry.open({ ...other, stationSecret: "different-station-secret-value" }),
    ).rejects.toThrow(/authentication failed/);

    const noncanonicalDirectory = await temporaryDirectory(directories);
    const noncanonicalConfig = config(join(noncanonicalDirectory, "events.ndjson"));
    const noncanonicalRegistry = await OwnerTagRegistry.open(noncanonicalConfig);
    await noncanonicalRegistry.add(
      withOwnerTagRegistry(noncanonicalConfig, noncanonicalRegistry),
      new MemoryEvidenceStore(),
      "second-owner-tag",
    );
    const noncanonicalPath = ownerTagStatePath(noncanonicalConfig.eventLogPath);
    const noncanonicalState = JSON.parse(await readFile(noncanonicalPath, "utf8"));
    noncanonicalState.tags.reverse();
    await writeFile(noncanonicalPath, `${JSON.stringify(noncanonicalState)}\n`, { mode: 0o600 });
    await expect(OwnerTagRegistry.open(noncanonicalConfig)).rejects.toThrow(
      /canonical tag ordering/,
    );

    const symlinkDirectory = await temporaryDirectory(directories);
    const symlinkConfig = config(join(symlinkDirectory, "events.ndjson"));
    const target = join(symlinkDirectory, "target.json");
    await writeFile(target, "{}", { mode: 0o600 });
    await symlink(target, ownerTagStatePath(symlinkConfig.eventLogPath));
    await expect(OwnerTagRegistry.open(symlinkConfig)).rejects.toBeInstanceOf(OwnerTagStateError);
  });

  it("rolls state back when the immutable audit append fails", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    evidence.failAppend = true;

    await expect(
      registry.add(withOwnerTagRegistry(bootstrap, registry), evidence, "second-owner-tag"),
    ).rejects.toThrow("synthetic evidence failure");
    expect(registry.tags).toEqual(new Set(["first-owner-tag"]));
    const restarted = await OwnerTagRegistry.open(bootstrap);
    expect(restarted.tags).toEqual(new Set(["first-owner-tag"]));
  });

  it("refuses to revoke the final owner credential", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);
    const [tagPseudonym] = [...registry.tags].map((tag) =>
      createTagPseudonym(tag, bootstrap.stationSecret),
    );

    await expect(
      registry.revoke(liveConfig, evidence, tagPseudonym!, {
        confirmation: OWNER_TAG_REVOCATION_CONFIRMATION,
      }),
    ).rejects.toThrow(/one desired owner tag must remain/i);
    expect(registry.tags).toEqual(new Set(["first-owner-tag"]));
  });

  it("refuses a tag that differs from a desired tag only in letter case", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);

    await expect(registry.add(liveConfig, evidence, "FIRST-OWNER-TAG")).rejects.toThrow(
      /differs only in letter case/i,
    );
    expect(registry.tags).toEqual(new Set(["first-owner-tag"]));
    expect(evidence.events).toEqual([]);
  });

  it("revokes every legacy letter-case variant together so none stays accepted online", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = {
      ...config(join(directory, "events.ndjson")),
      ownerTags: new Set(["ABCD1234", "abcd1234", "other-owner-tag"]),
    };
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);

    const result = await registry.revoke(
      liveConfig,
      evidence,
      createTagPseudonym("abcd1234", bootstrap.stationSecret),
      { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
    );
    expect(result.tagCount).toBe(1);
    expect(registry.tags).toEqual(new Set(["other-owner-tag"]));
    expect(evidence.events.at(-1)?.payload).toMatchObject({ caseVariantsRemoved: 1 });
  });

  it("refuses a revocation whose case variants would remove the final owner credential", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = {
      ...config(join(directory, "events.ndjson")),
      ownerTags: new Set(["ABCD1234", "abcd1234"]),
    };
    const registry = await OwnerTagRegistry.open(bootstrap);
    await expect(
      registry.revoke(
        withOwnerTagRegistry(bootstrap, registry),
        new MemoryEvidenceStore(),
        createTagPseudonym("ABCD1234", bootstrap.stationSecret),
        { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
      ),
    ).rejects.toThrow(/one desired owner tag must remain/i);
    expect(registry.tags.size).toBe(2);
  });

  it("reconciles a durable state whose audit was interrupted before startup", async () => {
    const directory = await temporaryDirectory(directories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);

    await registry.reconcile(liveConfig, evidence);
    expect(evidence.events.at(-1)).toMatchObject({ message: "OwnerTagDesiredStateReconciled" });
    expect(JSON.stringify(evidence.events)).not.toContain("first-owner-tag");
    const eventCount = evidence.events.length;
    await registry.reconcile(liveConfig, evidence);
    expect(evidence.events).toHaveLength(eventCount);
  });
});

async function temporaryDirectory(directories: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-owner-tags-"));
  directories.push(directory);
  return directory;
}

function createTagPseudonym(tag: string, stationSecret: string): string {
  return `tag_${createHmac("sha256", stationSecret).update(tag).digest("hex").slice(0, 24)}`;
}

function config(eventLogPath: string): GatewayConfig {
  return {
    apiHost: "127.0.0.1",
    apiPort: 9080,
    eventLogPath,
    eventLogMaxBytes: 268_435_456,
    heartbeatSeconds: 60,
    ocppHost: "127.0.0.1",
    ocppMaxConnections: 8,
    ocppMaxPayloadBytes: 1_048_576,
    ocppMessageBurst: 60,
    ocppMessagesPerMinute: 600,
    ownerApiToken: "owner-token-at-least-thirty-two-characters",
    ownerTags: new Set(["first-owner-tag"]),
    port: 9000,
    stationId: "STATION_1",
    stationSecret: "station-secret-at-least-sixteen",
    trustProxyHeaders: false,
    uiDirectory: "dist/ui",
  };
}

describe("owner tag rollback detection", () => {
  const rollbackDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      rollbackDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
  });

  it("refuses a state file rolled back behind its last audited version", async () => {
    const directory = await temporaryDirectory(rollbackDirectories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const statePath = ownerTagStatePath(bootstrap.eventLogPath);
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);
    await registry.reconcile(liveConfig, evidence);
    await registry.add(liveConfig, evidence, "later-owner-tag");
    const beforeRevocation = await readFile(statePath, "utf8");
    await registry.revoke(
      liveConfig,
      evidence,
      createTagPseudonym("later-owner-tag", bootstrap.stationSecret),
      { confirmation: OWNER_TAG_REVOCATION_CONFIRMATION },
    );

    // Putting back the pre-revocation file would silently re-desire the revoked tag.
    await writeFile(statePath, beforeRevocation, { mode: 0o600 });
    const rolledBack = await OwnerTagRegistry.open(bootstrap);
    const eventCount = evidence.events.length;
    await expect(
      rolledBack.reconcile(withOwnerTagRegistry(bootstrap, rolledBack), evidence),
    ).rejects.toThrow(/older than or differs from its last audited version/);
    expect(evidence.events).toHaveLength(eventCount);
  });

  it("continues the audited version sequence when state is reseeded from deployment input", async () => {
    const directory = await temporaryDirectory(rollbackDirectories);
    const bootstrap = config(join(directory, "events.ndjson"));
    const statePath = ownerTagStatePath(bootstrap.eventLogPath);
    const registry = await OwnerTagRegistry.open(bootstrap);
    const evidence = new MemoryEvidenceStore();
    const liveConfig = withOwnerTagRegistry(bootstrap, registry);
    await registry.reconcile(liveConfig, evidence);
    await registry.add(liveConfig, evidence, "later-owner-tag");
    await registry.add(liveConfig, evidence, "third-owner-tag");

    // A continuity restore boots a fresh state from the recovered seed against the old ledger.
    await rm(statePath);
    const reseeded = await OwnerTagRegistry.open(bootstrap);
    await reseeded.reconcile(withOwnerTagRegistry(bootstrap, reseeded), evidence);
    expect(evidence.events.at(-1)).toMatchObject({
      message: "OwnerTagDesiredStateReconciled",
      payload: { stateVersion: 4 },
    });
    const restarted = await OwnerTagRegistry.open(bootstrap);
    const eventCount = evidence.events.length;
    await restarted.reconcile(withOwnerTagRegistry(bootstrap, restarted), evidence);
    expect(evidence.events).toHaveLength(eventCount);
  });
});
