import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configForStation, type GatewayConfig } from "../server/config.js";
import { evidenceEvent, type EvidenceEvent } from "../server/events.js";
import {
  hasStationRegistryHistory,
  STATION_REGISTRY_AUDIT,
  STATION_REGISTRY_RECONCILED,
  StationRegistry,
  StationRegistryConflictError,
  StationRegistryInputError,
  StationRegistryStateError,
  stationRegistryPath,
} from "../server/station-registry.js";
import { retirementPhrase, type AddStationInput } from "../shared/stations.js";
import { MemoryEvidenceStore } from "./helpers/memory-evidence.js";

const PRIMARY_SECRET = "0123456789abcdef0123456789abcdef01234567";

function input(overrides: Partial<AddStationInput> = {}): AddStationInput {
  return {
    driverPersonId: null,
    expected: null,
    id: null,
    label: "Driveway",
    ownership: "employee",
    site: "Sam's home",
    ...overrides,
  };
}

describe("console-managed charger registry", () => {
  let directory: string;
  let config: GatewayConfig;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "chargeos-stations-"));
    config = {
      apiHost: "127.0.0.1",
      apiPort: 0,
      eventLogPath: join(directory, "events.ndjson"),
      eventLogMaxBytes: 268_435_456,
      heartbeatSeconds: 60,
      ocppHost: "127.0.0.1",
      ocppMaxConnections: 8,
      ocppMaxPayloadBytes: 1_048_576,
      ocppMessageBurst: 60,
      ocppMessagesPerMinute: 600,
      ownerApiToken: "owner-token-at-least-thirty-two-characters",
      ownerTags: new Set(["owner-card"]),
      port: 0,
      stationId: "OFFICE-1",
      stationSecret: PRIMARY_SECRET,
      trustProxyHeaders: false,
      uiDirectory: "dist/ui",
    };
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  const audits = (events: readonly EvidenceEvent[]) =>
    events.filter(({ message }) => message === STATION_REGISTRY_AUDIT);

  it("adds a charger with its own password, persisted before its audit", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const live = registry.bind(config);
    const first = await registry.add(evidence, input());
    const second = await registry.add(evidence, input({ id: "garage-2", ownership: "company" }));

    expect(first.secret).toMatch(/^[0-9a-f]{40}$/u);
    expect(second.secret).toMatch(/^[0-9a-f]{40}$/u);
    expect(new Set([PRIMARY_SECRET, first.secret, second.secret]).size).toBe(3);
    expect(first.station.id).toMatch(/^cos-[0-9a-f]{8}$/u);
    // The bound config sees the new chargers without a restart.
    expect(configForStation(live, "garage-2").stationSecret).toBe(second.secret);
    expect(registry.ownership("garage-2")).toBe("company");
    expect(registry.isManaged("garage-2")).toBe(true);
    expect(registry.isManaged("OFFICE-1")).toBe(false);

    const stored = await readFile(stationRegistryPath(config.eventLogPath), "utf8");
    expect(stored).toContain(second.secret);
    const recorded = audits(evidence.events);
    expect(recorded).toHaveLength(2);
    expect(recorded.at(-1)).toMatchObject({
      payload: { action: "added", ownership: "company", registryVersion: 2 },
      stationId: "garage-2",
    });
    // The ledger holds a digest of the state, never a charger password.
    const ledger = JSON.stringify(evidence.events);
    expect(ledger).not.toContain(first.secret);
    expect(ledger).not.toContain(second.secret);
    expect(hasStationRegistryHistory(evidence.events)).toBe(true);
  });

  it("rejects malformed and reused charger names, including retired ones, in any letter case", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    await expect(registry.add(evidence, input({ id: "bad name!" }))).rejects.toBeInstanceOf(
      StationRegistryInputError,
    );
    await expect(registry.add(evidence, input({ id: "office-1" }))).rejects.toBeInstanceOf(
      StationRegistryConflictError,
    );
    await registry.add(evidence, input({ id: "garage-2" }));
    await registry.retire(config, evidence, "garage-2", retirementPhrase("garage-2"));
    await expect(registry.add(evidence, input({ id: "GARAGE-2" }))).rejects.toBeInstanceOf(
      StationRegistryConflictError,
    );
    await expect(
      registry.add(evidence, input({ ownership: "landlord" as never })),
    ).rejects.toBeInstanceOf(StationRegistryInputError);
    // A charger once in the stations file and later dropped from it left ledger history (and
    // possibly employee links); its name never goes to a different charger.
    await evidence.append(
      evidenceEvent("old-garage", "station-to-csms", "BootNotification", {
        chargePointModel: "M",
        chargePointVendor: "V",
      }),
    );
    await expect(registry.add(evidence, input({ id: "Old-Garage" }))).rejects.toBeInstanceOf(
      StationRegistryConflictError,
    );
  });

  it("retires only an existing non-primary charger with its exact phrase", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const live = registry.bind(config);
    await registry.add(evidence, input({ id: "garage-2" }));

    await expect(
      registry.retire(config, evidence, "garage-2", "RETIRE garage"),
    ).rejects.toBeInstanceOf(StationRegistryInputError);
    await expect(
      registry.retire(config, evidence, "OFFICE-1", retirementPhrase("OFFICE-1")),
    ).rejects.toThrow("cannot be retired");
    await expect(
      registry.retire(config, evidence, "nowhere", retirementPhrase("nowhere")),
    ).rejects.toThrow("Unknown charge point");

    await registry.retire(config, evidence, "garage-2", retirementPhrase("garage-2"));
    // A retired charger no longer resolves, so it can no longer authenticate or be addressed.
    expect(() => configForStation(live, "garage-2")).toThrow("Unknown charge point");
    expect(registry.isRetired("garage-2")).toBe(true);
    expect(registry.project(config).retired.map(({ id }) => id)).toEqual(["garage-2"]);
    await expect(
      registry.retire(config, evidence, "garage-2", retirementPhrase("garage-2")),
    ).rejects.toThrow("Unknown charge point");
  });

  it("reissues a password only for an added charger without history", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const live = registry.bind(config);
    const { secret } = await registry.add(evidence, input({ id: "garage-2" }));
    await expect(registry.reissueSecret(evidence, "OFFICE-1", false)).rejects.toBeInstanceOf(
      StationRegistryConflictError,
    );
    await expect(registry.reissueSecret(evidence, "garage-2", true)).rejects.toBeInstanceOf(
      StationRegistryConflictError,
    );
    const reissued = await registry.reissueSecret(evidence, "garage-2", false);
    expect(reissued.secret).not.toBe(secret);
    expect(configForStation(live, "garage-2").stationSecret).toBe(reissued.secret);
  });

  it("rolls back the file when the audit cannot be written", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const live = registry.bind(config);
    evidence.append = async () => {
      throw new Error("ledger full");
    };
    await expect(registry.add(evidence, input({ id: "garage-2" }))).rejects.toThrow("ledger full");
    expect(() => configForStation(live, "garage-2")).toThrow("Unknown charge point");
    const stored = JSON.parse(await readFile(stationRegistryPath(config.eventLogPath), "utf8"));
    expect(stored).toMatchObject({ added: [], version: 0 });
  });

  it("restarts from a file that matches the ledger and reconciles a crash between the two writes", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    await registry.add(evidence, input({ id: "garage-2" }));

    const reopened = await StationRegistry.open(config, evidence);
    expect(reopened.stations.map(({ id }) => id)).toEqual(["OFFICE-1", "garage-2"]);

    // The file is written, then the process stops before the ledger audit.
    const path = stationRegistryPath(config.eventLogPath);
    const crashed = new MemoryEvidenceStore();
    crashed.events.push(...evidence.events);
    const writer = await StationRegistry.open(config, crashed);
    const lost = crashed.events.length;
    await writer.add(crashed, input({ id: "garage-3" }));
    crashed.events.splice(lost);
    const aheadByOne = await readFile(path, "utf8");

    const recovered = await StationRegistry.open(config, crashed);
    expect(recovered.stations.map(({ id }) => id)).toContain("garage-3");
    expect(crashed.events.at(-1)).toMatchObject({
      message: STATION_REGISTRY_RECONCILED,
      payload: { registryVersion: 2 },
    });
    expect(await readFile(path, "utf8")).toBe(aheadByOne);
  });

  it("refuses to start from a missing, stale, tampered or too-far-ahead file", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const path = stationRegistryPath(config.eventLogPath);
    await registry.add(evidence, input({ id: "garage-2" }));
    const versionOne = await readFile(path, "utf8");
    await registry.retire(config, evidence, "garage-2", retirementPhrase("garage-2"));
    const versionTwo = await readFile(path, "utf8");

    // Missing: a retired charger would come back, an added one would be forgotten.
    await rm(path);
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow("missing");

    // Stale: an older copy would resurrect the retired charger.
    await writeFile(path, versionOne, { mode: 0o600 });
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow("older than or differs");

    // Same version, different content.
    await writeFile(path, versionTwo.replace("Driveway", "Carport"), { mode: 0o600 });
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow("older than or differs");

    // Two changes ahead of the ledger.
    const ahead = JSON.parse(versionTwo) as { version: number };
    await writeFile(path, JSON.stringify({ ...ahead, version: ahead.version + 2 }), {
      mode: 0o600,
    });
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow("more than one change");

    await writeFile(path, versionTwo, { mode: 0o600 });
    await expect(StationRegistry.open(config, evidence)).resolves.toBeInstanceOf(StationRegistry);
  });

  it("refuses an insecure, symlinked, malformed or conflicting registry file", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    const path = stationRegistryPath(config.eventLogPath);
    const { secret } = await registry.add(evidence, input({ id: "garage-2" }));
    const valid = await readFile(path, "utf8");

    await chmod(path, 0o644);
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow(
      "must not be accessible by group or other users",
    );

    await rm(path);
    const target = join(directory, "elsewhere.json");
    await writeFile(target, valid, { mode: 0o600 });
    await symlink(target, path);
    await expect(StationRegistry.open(config, evidence)).rejects.toThrow("non-symlinked");

    await rm(path);
    await writeFile(path, "{not json", { mode: 0o600 });
    await expect(StationRegistry.open(config, evidence)).rejects.toBeInstanceOf(
      StationRegistryStateError,
    );

    // A file entry may not shadow a stations-file charger or reuse its password.
    await writeFile(path, valid.replace('"id":"garage-2"', '"id":"OFFICE-1"'), { mode: 0o600 });
    await expect(StationRegistry.open(config, new MemoryEvidenceStore())).rejects.toThrow(
      "in both the stations file",
    );
    await writeFile(path, valid.replace(secret, PRIMARY_SECRET), { mode: 0o600 });
    await expect(StationRegistry.open(config, new MemoryEvidenceStore())).rejects.toThrow(
      "must be unique",
    );
  });

  it("ignores no ledger history: a fresh edge starts empty without a file", async () => {
    const evidence = new MemoryEvidenceStore();
    const registry = await StationRegistry.open(config, evidence);
    expect(registry.stations.map(({ id }) => id)).toEqual(["OFFICE-1"]);
    expect(registry.hasChanges).toBe(false);
    expect(hasStationRegistryHistory(evidence.events)).toBe(false);
  });
});
