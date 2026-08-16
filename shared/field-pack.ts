import type { RedactedContinuityExport } from "./contracts.js";
import type { FreedomTestReport } from "./freedom-test.js";
import type { MigrationReport } from "./migration.js";

export interface FieldEvidenceArtifact<T> {
  readonly sha256: string;
  readonly value: T;
}

export interface FieldEvidencePack {
  readonly artifacts: {
    readonly continuity: FieldEvidenceArtifact<RedactedContinuityExport>;
    readonly freedomTest: FieldEvidenceArtifact<FreedomTestReport>;
    readonly migration: FieldEvidenceArtifact<MigrationReport>;
  };
  readonly disclaimer: string;
  readonly generatedAt: string;
  readonly reviewState: "unreviewed";
  readonly schemaVersion: 1;
  readonly stationId: string;
}
