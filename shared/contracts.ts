import type { CardCaptureProjection } from "./card-capture.js";
import type { StationCommandRecord } from "./commands.js";
import type { StationConnectionDiagnostics } from "./connection.js";
import type { FreedomTestProjection } from "./freedom-test.js";
import type { GenesisPlan } from "./genesis.js";
import type { DelegateGrantSummary } from "./delegation.js";
import type { MigrationProjection } from "./migration.js";
import type { ConsoleProfile } from "./usage.js";

export type CheckState = "pass" | "fail" | "unknown";

export interface CapabilityCheck {
  readonly id: string;
  readonly label: string;
  readonly observed: string;
  readonly state: CheckState;
}

export interface CapabilityAssessment {
  readonly checkedAt: string;
  readonly checks: readonly CapabilityCheck[];
  readonly localListVersion: number | null;
  readonly restartRequired: boolean;
  readonly state: "ready" | "blocked" | "unknown";
}

export interface ChargeSession {
  readonly authorizationStatus: "Accepted" | "Invalid" | "Unknown";
  readonly connectorId: number;
  readonly energyWh: number | null;
  readonly integrity: "consistent" | "conflict";
  readonly meterStart: number;
  readonly meterStop: number | null;
  readonly replayedMessageCount: number;
  readonly startedAt: string;
  readonly status: "active" | "complete";
  readonly stoppedAt: string | null;
  readonly tagPseudonym: string;
  readonly transactionId: number;
}

export interface ConnectorStatus {
  readonly connectorId: number;
  readonly errorCode: string;
  readonly status: string;
  readonly updatedAt: string;
}

export interface EvidenceSummary {
  readonly at: string;
  readonly carriedFromRecordHash?: string;
  readonly direction: "station-to-csms" | "csms-to-station" | "system";
  readonly eventId: string;
  readonly message: string;
  readonly payload: unknown;
  readonly previousRecordHash?: string | null;
  readonly recordHash?: string;
  readonly sourcePayloadHmac?: string;
}

export interface OwnerSnapshot {
  /** Owner-only tap-to-add state; carries a pseudonym, never a card value. */
  readonly cardCapture: CardCaptureProjection;
  readonly authorization: {
    readonly acknowledgedTagPseudonyms: readonly string[];
    readonly lastAttemptAt: string | null;
    readonly lastAttemptRevision: number | null;
    readonly lastAttemptStatus: string | null;
    readonly lastSyncAt: string | null;
    readonly lastSyncRevision: number | null;
    readonly lastSyncStatus: string | null;
    readonly pendingAdditions: readonly string[];
    readonly pendingRevocations: readonly string[];
    readonly pendingRevision: number | null;
    readonly syncState: "current" | "never-synced" | "pending";
    readonly tagCount: number;
    readonly tagPseudonyms: readonly string[];
  };
  readonly commands: readonly StationCommandRecord[];
  readonly evidence: readonly EvidenceSummary[];
  readonly evidenceHistory: {
    readonly custodyBundleCount: number;
    readonly custodiedEventCount: number;
    readonly mode: "complete" | "compacted-operational";
  };
  readonly delegations: readonly DelegateGrantSummary[];
  readonly freedomTest: FreedomTestProjection;
  readonly genesisPlan: GenesisPlan;
  readonly migration: MigrationProjection;
  readonly generatedAt: string;
  readonly readiness: CapabilityAssessment | null;
  readonly sessions: readonly ChargeSession[];
  readonly station: {
    readonly boot: {
      readonly firmwareVersion: string | null;
      readonly model: string;
      readonly vendor: string;
    } | null;
    readonly connected: boolean;
    readonly connectedAt: string | null;
    /** Owner-only, in-memory refusal diagnostics; never in delegate, export or AI projections. */
    readonly connection: StationConnectionDiagnostics;
    readonly connectors: readonly ConnectorStatus[];
    /** Person whose usage this charger is reported under; `null` when unassigned. */
    readonly driver: string | null;
    readonly id: string;
    readonly label: string;
    readonly site: string;
  };
}

export interface FleetStationSummary {
  readonly activeSessionCount: number;
  readonly attention: readonly (
    | "offline"
    | "authorization-pending"
    | "continuity-unproven"
    | "migration-action"
    | "evidence-conflict"
  )[];
  readonly authorizationState: OwnerSnapshot["authorization"]["syncState"];
  readonly boot: OwnerSnapshot["station"]["boot"];
  readonly connected: boolean;
  readonly connectedAt: string | null;
  readonly connectorCount: number;
  readonly driver: string | null;
  readonly energyWh: number;
  readonly id: string;
  readonly label: string;
  readonly lastSessionAt: string | null;
  readonly readiness: CapabilityAssessment["state"] | "not-inspected";
  readonly site: string;
}

export interface FleetSnapshot {
  /** Console arrangement chosen by the operator. Presentation only, never authority. */
  readonly console: { readonly profile: ConsoleProfile };
  readonly generatedAt: string;
  readonly stations: readonly FleetStationSummary[];
  readonly totals: {
    readonly activeSessions: number;
    readonly attentionRequired: number;
    readonly connected: number;
    readonly energyWh: number;
    readonly stations: number;
  };
}

export interface AuthorizationSyncResponse {
  readonly listVersion: number;
  readonly status: string;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface RedactedContinuityExport {
  readonly evidence: readonly EvidenceSummary[];
  readonly exportedAt: string;
  readonly history: {
    readonly custodyBundleCount: number;
    readonly custodiedEventCount: number;
    readonly mode: "complete" | "compacted-operational";
  };
  readonly ownerTagPseudonyms: readonly string[];
  readonly schemaVersion: 2;
  readonly stationId: string;
}
export type {
  FreedomTestDeviceIdentity,
  FreedomTestDeviceInput,
  FreedomTestEvidenceReference,
  FreedomTestProjection,
  FreedomTestObservationInput,
  FreedomTestReport,
  FreedomTestRun,
  FreedomTestRunInput,
  FreedomTestStepDefinition,
  FreedomTestStepId,
  FreedomTestStepResult,
  FreedomTestStepSource,
  FreedomTestStepState,
} from "./freedom-test.js";
export type {
  ConsoleProfile,
  MonthlyUsage,
  UsageReport,
  UsageReportDriver,
  UsageReportSession,
  UsageReportStation,
} from "./usage.js";
export type {
  CardCaptureConfirmInput,
  CardCaptureProjection,
  CardCaptureState,
} from "./card-capture.js";
export type {
  RefusedConnectionAttempt,
  RefusedConnectionReason,
  StationConnectionDiagnostics,
} from "./connection.js";
export type { GenesisAction, GenesisActionId, GenesisPhase, GenesisPlan } from "./genesis.js";
export type {
  StationCommandInput,
  StationCommandRecord,
  StationCommandResult,
  StationCommandState,
  StationCommandType,
} from "./commands.js";
export { STATION_RESET_PHRASE, STATION_UNLOCK_PHRASE } from "./commands.js";
export type {
  DelegateDiagnostics,
  DelegateGrantCreated,
  DelegateGrantInput,
  DelegateGrantSummary,
  DelegateRole,
  DelegateScope,
  DelegateSessionExport,
  DelegateStationStatus,
} from "./delegation.js";
export type {
  MigrationAuthorization,
  MigrationAuthorizationInput,
  MigrationEvidenceReference,
  MigrationObservationInput,
  MigrationPhase,
  MigrationProjection,
  MigrationReport,
  MigrationStepDefinition,
  MigrationStepId,
  MigrationStepResult,
  MigrationStepSource,
  MigrationStepState,
} from "./migration.js";
export type {
  OwnerTagAddInput,
  OwnerTagMutationResult,
  OwnerTagRevokeInput,
} from "./owner-tags.js";
export type { FieldEvidenceArtifact, FieldEvidencePack } from "./field-pack.js";
export {
  CONTINUITY_PREPARATION_PHRASE,
  type ContinuityPreparationChange,
  type ContinuityPreparationInput,
  type ContinuityPreparationResult,
  type ContinuitySettingKey,
} from "./continuity.js";

export type {
  ObservationSource,
  ObservationCsv,
  SessionColumnMapping,
  ObservationSession,
  ObservationImport,
  ObservationPolicyInput,
  ObservationPolicy,
  ObservationDecision,
  ReimbursementObservation,
  DeclaredAmountComparison,
} from "./observation.js";

export type * from "./service.js";
export type * from "./support.js";

export type * from "./reimbursement.js";

export type * from "./reimbursement-corrections.js";
export type * from "./troubleshooting.js";
export type {
  RecoveryEnrollmentStatus,
  RecoveryEnrollmentAuthentication,
  RecoveryEnrollmentAuthenticator,
} from "./recovery-enrollment.js";
