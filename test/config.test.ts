import { chmodSync, copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  configuredStations,
  loadConfig,
  stationSecretInteroperabilityAdvisories,
} from "../server/config.js";

describe("loadConfig", () => {
  it("requires explicit station and owner credentials", () => {
    expect(() => loadConfig({})).toThrow("CHARGEOS_STATION_ID is required");
  });

  it("rejects weak station secrets", () => {
    expect(() =>
      loadConfig({
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_OWNER_TAGS: "owner",
        CHARGEOS_STATION_ID: "station",
        CHARGEOS_STATION_SECRET: "short",
      }),
    ).toThrow("at least 16 characters");
  });

  it("warns, without revealing the secret, when a charger password breaks the OCPP security shape", () => {
    const base = {
      CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
      CHARGEOS_OWNER_TAGS: "owner",
      CHARGEOS_STATION_ID: "station",
    };
    const conforming = loadConfig({ ...base, CHARGEOS_STATION_SECRET: "a".repeat(40) });
    expect(stationSecretInteroperabilityAdvisories(conforming)).toEqual([]);
    const legacySecret = "legacy_base64url-secret-that-is-48-characters-xx";
    const legacy = loadConfig({ ...base, CHARGEOS_STATION_SECRET: legacySecret });
    const advisories = stationSecretInteroperabilityAdvisories(legacy);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toContain("Station station");
    expect(advisories.join(" ")).not.toContain(legacySecret);
    expect(
      stationSecretInteroperabilityAdvisories(
        loadConfig({ ...base, CHARGEOS_STATION_SECRET: "0123456789abcdef0123456789abcdef0" }),
      ),
    ).toEqual([]);
  });

  it("loads a fail-closed provision", () => {
    const config = loadConfig({
      CHARGEOS_EVENT_LOG: "/tmp/test.ndjson",
      CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
      CHARGEOS_OWNER_TAGS: "owner-a, owner-b",
      CHARGEOS_PORT: "9100",
      CHARGEOS_STATION_ID: "station",
      CHARGEOS_STATION_SECRET: "correct-horse-battery-staple",
      CHARGEOS_TRUST_PROXY_HEADERS: "true",
    });

    expect(config.port).toBe(9100);
    expect(config.ownerTags).toEqual(new Set(["owner-a", "owner-b"]));
    expect(config.eventLogMaxBytes).toBe(268_435_456);
    expect(config.ocppMaxConnections).toBe(8);
    expect(config.ocppMaxPayloadBytes).toBe(1_048_576);
    expect(config.ocppMessageBurst).toBe(60);
    expect(config.ocppMessagesPerMinute).toBe(600);
    expect(config.trustProxyHeaders).toBe(true);
  });

  it("loads independent secrets from owner-only files", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const stationSecretFile = writeSecret(directory, "station", "correct-horse-battery-staple\n");
      const ownerTokenFile = writeSecret(
        directory,
        "owner-token",
        "owner-token-at-least-thirty-two-characters\n",
      );
      const ownerTagsFile = writeSecret(directory, "owner-tags", "owner-a\nowner-b,owner-c\n");

      const config = loadConfig({
        CHARGEOS_OWNER_API_TOKEN_FILE: ownerTokenFile,
        CHARGEOS_OWNER_TAGS_FILE: ownerTagsFile,
        CHARGEOS_STATION_ID: "station",
        CHARGEOS_STATION_SECRET_FILE: stationSecretFile,
      });

      expect(config.stationSecret).toBe("correct-horse-battery-staple");
      expect(config.ownerTags).toEqual(new Set(["owner-a", "owner-b", "owner-c"]));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("loads a strict owner-private multi-charger registry", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const stationsFile = writeSecret(
        directory,
        "stations.json",
        JSON.stringify({
          schemaVersion: 1,
          stations: [
            {
              id: "HOME_1",
              label: "Driveway",
              ownerTags: ["home-owner"],
              secret: "home-station-secret-strong",
              site: "Home",
            },
            {
              id: "OFFICE_1",
              label: "Office bay 1",
              ownerTags: ["office-owner"],
              secret: "office-station-secret-strong",
              site: "Brussels office",
            },
          ],
        }),
      );
      const config = loadConfig({
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_STATIONS_FILE: stationsFile,
      });

      expect(config.stationId).toBe("HOME_1");
      expect(configuredStations(config)).toMatchObject([
        { id: "HOME_1", label: "Driveway", site: "Home" },
        { id: "OFFICE_1", label: "Office bay 1", site: "Brussels office" },
      ]);
      expect(configuredStations(config)[1]?.ownerTags).toEqual(new Set(["office-owner"]));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps the checked-in multi-charger example loadable", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const stationsFile = join(directory, "stations.json");
      copyFileSync(join(process.cwd(), "config/stations.example.json"), stationsFile);
      chmodSync(stationsFile, 0o600);

      const config = loadConfig({
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_STATIONS_FILE: stationsFile,
      });

      expect(configuredStations(config)).toHaveLength(2);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects duplicate fleet identities and legacy/fleet ambiguity", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const station = {
        id: "DUPLICATE",
        label: "Charger",
        ownerTags: ["owner"],
        secret: "station-secret-at-least-sixteen",
        site: "Site",
      };
      const stationsFile = writeSecret(
        directory,
        "stations.json",
        JSON.stringify({ schemaVersion: 1, stations: [station, station] }),
      );
      expect(() =>
        loadConfig({
          CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
          CHARGEOS_STATIONS_FILE: stationsFile,
        }),
      ).toThrow("station IDs must be unique");
      expect(() =>
        loadConfig({
          CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
          CHARGEOS_STATIONS_FILE: stationsFile,
          CHARGEOS_STATION_ID: "legacy",
        }),
      ).toThrow("mutually exclusive");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects ambiguous inline and file-backed secret configuration", () => {
    expect(() =>
      loadConfig({
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_OWNER_TAGS: "owner",
        CHARGEOS_STATION_ID: "station",
        CHARGEOS_STATION_SECRET: "correct-horse-battery-staple",
        CHARGEOS_STATION_SECRET_FILE: "/run/secrets/station-secret",
      }),
    ).toThrow("mutually exclusive");
  });

  it("rejects ambiguous proxy trust settings", () => {
    expect(() =>
      loadConfig({
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_OWNER_TAGS: "owner",
        CHARGEOS_STATION_ID: "station",
        CHARGEOS_STATION_SECRET: "correct-horse-battery-staple",
        CHARGEOS_TRUST_PROXY_HEADERS: "yes",
      }),
    ).toThrow("must be true or false");
  });

  it("rejects an OCPP burst larger than its sustained limit", () => {
    expect(() =>
      loadConfig({
        CHARGEOS_OCPP_MESSAGE_BURST: "61",
        CHARGEOS_OCPP_MESSAGES_PER_MINUTE: "60",
        CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
        CHARGEOS_OWNER_TAGS: "owner",
        CHARGEOS_STATION_ID: "station",
        CHARGEOS_STATION_SECRET: "correct-horse-battery-staple",
      }),
    ).toThrow("must not exceed the per-minute limit");
  });

  it("rejects host secret files accessible to other users", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const stationSecretFile = writeSecret(directory, "station", "correct-horse-battery-staple");
      chmodSync(stationSecretFile, 0o644);

      expect(() =>
        loadConfig({
          CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
          CHARGEOS_OWNER_TAGS: "owner",
          CHARGEOS_STATION_ID: "station",
          CHARGEOS_STATION_SECRET_FILE: stationSecretFile,
        }),
      ).toThrow("must not be accessible by group or other users");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects symlinked secret files", () => {
    const directory = mkdtempSync(join(tmpdir(), "chargeos-config-"));
    try {
      const target = writeSecret(directory, "target", "correct-horse-battery-staple");
      const link = join(directory, "station");
      symlinkSync(target, link);

      expect(() =>
        loadConfig({
          CHARGEOS_OWNER_API_TOKEN: "owner-token-at-least-thirty-two-characters",
          CHARGEOS_OWNER_TAGS: "owner",
          CHARGEOS_STATION_ID: "station",
          CHARGEOS_STATION_SECRET_FILE: link,
        }),
      ).toThrow("regular, non-symlinked file");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

function writeSecret(directory: string, name: string, value: string): string {
  const path = join(directory, name);
  writeFileSync(path, value, { mode: 0o600 });
  return path;
}
