import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { GatewayConfig } from "../server/config.js";
import { evidenceEvent, NdjsonEvidenceStore } from "../server/events.js";
import {
  canonicalSha256,
  createFieldEvidencePack,
  FieldEvidencePackError,
  verifyFieldEvidencePack,
} from "../server/field-pack.js";

describe("field evidence pack", () => {
  it("binds redacted artifacts to one station, chain head, count, and deterministic digests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chargeos-field-pack-"));
    try {
      const store = new NdjsonEvidenceStore(join(directory, "events.ndjson"));
      await store.append(evidenceEvent(config.stationId, "system", "SyntheticEvidence", {}));
      const pack = createFieldEvidencePack(
        config,
        await store.readEvents(),
        new Date("2026-08-14T20:00:00.000Z"),
      );

      expect(verifyFieldEvidencePack(JSON.stringify(pack))).toEqual(pack);
      expect(pack.generatedAt).toBe("2026-08-14T20:00:00.000Z");
      expect(pack.artifacts.continuity.value.evidence).toHaveLength(1);
      expect(JSON.stringify(pack)).not.toContain("raw-owner-tag");

      const tampered = JSON.stringify(pack).replace("SyntheticEvidence", "ChangedEvidence");
      expect(() => verifyFieldEvidencePack(tampered)).toThrow(FieldEvidencePackError);

      const changedMigration = {
        ...pack.artifacts.migration.value,
        evidenceChainHead: "0".repeat(64),
      };
      const inconsistent = {
        ...pack,
        artifacts: {
          ...pack.artifacts,
          migration: {
            sha256: canonicalSha256(changedMigration),
            value: changedMigration,
          },
        },
      };
      expect(() => verifyFieldEvidencePack(inconsistent)).toThrow(
        "Artifact evidence-chain heads do not match",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

const config: GatewayConfig = {
  apiHost: "127.0.0.1",
  apiPort: 9080,
  eventLogPath: "unused.ndjson",
  eventLogMaxBytes: 268_435_456,
  heartbeatSeconds: 60,
  ocppHost: "127.0.0.1",
  ocppMaxConnections: 8,
  ocppMaxPayloadBytes: 1_048_576,
  ocppMessageBurst: 60,
  ocppMessagesPerMinute: 600,
  ownerApiToken: "owner-token-at-least-thirty-two-characters",
  ownerTags: new Set(["raw-owner-tag"]),
  port: 9000,
  stationId: "FIELD_PACK_STATION",
  stationSecret: "station-secret-at-least-sixteen",
  trustProxyHeaders: false,
  uiDirectory: "dist/ui",
};
