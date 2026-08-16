import { createHash } from "node:crypto";

import type { FieldEvidenceArtifact, FieldEvidencePack } from "../shared/field-pack.js";
import type { GatewayConfig } from "./config.js";
import type { EvidenceEvent } from "./events.js";
import { buildFreedomTestReport } from "./freedom-test.js";
import { buildMigrationReport } from "./migration.js";
import { buildRedactedContinuityExport } from "./projections.js";

const DISCLAIMER =
  "This redacted pack binds chargeOS artifacts for review. Digest validity is not signer identity, trustworthy chronology, physical evidence truth, a recovery bundle, or a Freedom grade.";

export class FieldEvidencePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEvidencePackError";
  }
}

export function createFieldEvidencePack(
  config: GatewayConfig,
  events: readonly EvidenceEvent[],
  now = new Date(),
): FieldEvidencePack {
  const stationEvents = events.filter((event) => event.stationId === config.stationId);
  const continuity = buildRedactedContinuityExport(config, stationEvents, now);
  const freedomTest = buildFreedomTestReport(config, stationEvents, now);
  const migration = buildMigrationReport(config, stationEvents, now);
  return {
    artifacts: {
      continuity: artifact(continuity),
      freedomTest: artifact(freedomTest),
      migration: artifact(migration),
    },
    disclaimer: DISCLAIMER,
    generatedAt: now.toISOString(),
    reviewState: "unreviewed",
    schemaVersion: 1,
    stationId: config.stationId,
  };
}

export function verifyFieldEvidencePack(value: string | unknown): FieldEvidencePack {
  const pack = typeof value === "string" ? parsePack(value) : value;
  if (!pack || typeof pack !== "object") throw new FieldEvidencePackError("Pack must be an object");
  const candidate = pack as Partial<FieldEvidencePack>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.reviewState !== "unreviewed" ||
    typeof candidate.stationId !== "string" ||
    !candidate.stationId ||
    typeof candidate.generatedAt !== "string" ||
    !normalizedIso(candidate.generatedAt) ||
    candidate.disclaimer !== DISCLAIMER ||
    !candidate.artifacts
  ) {
    throw new FieldEvidencePackError("Pack envelope is invalid");
  }

  const continuity = verifiedArtifact(candidate.artifacts.continuity, "continuity");
  const freedomTest = verifiedArtifact(candidate.artifacts.freedomTest, "freedomTest");
  const migration = verifiedArtifact(candidate.artifacts.migration, "migration");
  if (
    !continuity ||
    typeof continuity !== "object" ||
    !Array.isArray(continuity.evidence) ||
    !freedomTest ||
    typeof freedomTest !== "object" ||
    !migration ||
    typeof migration !== "object" ||
    !validChainSummary(freedomTest.evidenceChainHead, freedomTest.evidenceRecordCount) ||
    !validChainSummary(migration.evidenceChainHead, migration.evidenceRecordCount)
  ) {
    throw new FieldEvidencePackError("Artifact payload structure is invalid");
  }
  if (
    continuity.stationId !== candidate.stationId ||
    freedomTest.stationId !== candidate.stationId ||
    migration.stationId !== candidate.stationId
  ) {
    throw new FieldEvidencePackError("Artifact station identities do not match the pack");
  }

  if (
    continuity.exportedAt !== candidate.generatedAt ||
    freedomTest.generatedAt !== candidate.generatedAt ||
    migration.exportedAt !== candidate.generatedAt
  ) {
    throw new FieldEvidencePackError("Artifact snapshot times do not match the pack");
  }

  const continuityHead = continuity.evidence.at(0)?.recordHash ?? null;
  if (
    continuity.evidence.length > 0 &&
    (typeof continuityHead !== "string" || !/^[a-f0-9]{64}$/.test(continuityHead))
  ) {
    throw new FieldEvidencePackError("Continuity artifact has no valid chain head");
  }
  if (
    freedomTest.evidenceChainHead !== continuityHead ||
    migration.evidenceChainHead !== continuityHead
  ) {
    throw new FieldEvidencePackError("Artifact evidence-chain heads do not match");
  }
  if (
    freedomTest.evidenceRecordCount !== continuity.evidence.length ||
    migration.evidenceRecordCount !== continuity.evidence.length
  ) {
    throw new FieldEvidencePackError("Artifact evidence-record counts do not match");
  }
  return candidate as FieldEvidencePack;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function artifact<T>(value: T): FieldEvidenceArtifact<T> {
  return { sha256: canonicalSha256(value), value };
}

function verifiedArtifact<T>(artifactValue: FieldEvidenceArtifact<T> | undefined, name: string): T {
  if (
    !artifactValue ||
    typeof artifactValue !== "object" ||
    typeof artifactValue.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifactValue.sha256) ||
    !("value" in artifactValue)
  ) {
    throw new FieldEvidencePackError(`${name} artifact envelope is invalid`);
  }
  if (canonicalSha256(artifactValue.value) !== artifactValue.sha256) {
    throw new FieldEvidencePackError(`${name} artifact digest does not match`);
  }
  return artifactValue.value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FieldEvidencePackError("Non-finite number in artifact");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  throw new FieldEvidencePackError("Unsupported value in artifact");
}

function parsePack(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new FieldEvidencePackError("Pack is not valid JSON");
  }
}

function normalizedIso(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validChainSummary(head: unknown, count: unknown): boolean {
  return (
    (head === null || (typeof head === "string" && /^[a-f0-9]{64}$/.test(head))) &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 0
  );
}
