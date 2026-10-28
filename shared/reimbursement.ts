import type {
  ReimbursementAdjustment,
  ReimbursementApprovedBalance,
  ReimbursementCorrectionContext,
  ReimbursementCorrectionReason,
  ReimbursementJournalEntry,
} from "./reimbursement-corrections.js";
import type {
  ObservationPolicy,
  ObservationDecision,
  ObservationImport,
  ObservationSource,
  SessionColumnMapping,
} from "./observation.js";

export interface ReimbursementPolicy {
  id: string;
  key: string;
  version: string;
  name: string;
  effectiveFrom: string;
  effectiveUntil: string;
  rateEurPerKwh: string;
  currency: "EUR";
  rounding: "per-session-half-up-to-cent";
  createdAt: string;
}
export interface ReimbursementAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  driverAlias: string;
  stationAlias: string;
  vehicleAlias: string;
  cardAlias: string;
  costCenter: string;
  policyVersionId: string;
  effectiveFrom: string;
  effectiveUntil: string;
  originalUntil: string;
  ended: boolean;
}
export interface CreateReimbursementPolicy {
  key: string;
  version: string;
  name: string;
  effectiveFrom: string;
  effectiveUntil: string;
  rateEurPerKwh: string;
}
export interface CreateReimbursementAssignment {
  employeeId: string;
  driverAlias: string;
  stationAlias: string;
  vehicleAlias: string;
  cardAlias: string;
  costCenter: string;
  policyVersionId: string;
  effectiveFrom: string;
  effectiveUntil: string;
}
export interface CreateReimbursementStatement {
  assignmentId: string;
  periodFrom: string;
  periodUntil: string;
  csvBase64: string;
  mapping: SessionColumnMapping;
  revisionOf: string | null;
  driverDeclarationConfirmed: boolean;
  correctionOf?: string | null;
  correctionReason?: ReimbursementCorrectionReason | null;
  correctionPolicyVersionId?: string | null;
}
export interface ReimbursementSnapshot {
  schemaVersion: 1;
  sourceAuthority: "user-supplied-csv" | "finance-void-request";
  correction?: ReimbursementCorrectionContext;
  assignment: ReimbursementAssignment;
  period: { from: string; until: string };
  policy: ObservationPolicy;
  sources: readonly ObservationSource[];
  mapping: SessionColumnMapping;
  decisions: readonly ObservationDecision[];
  issues: ObservationImport["issues"];
  omittedRecords: number;
  includedEnergyWh: number;
  expectedAmountCents: number;
  counts: Record<ObservationDecision["status"], number>;
}
export type ReimbursementStatementStatus = "draft" | "approved" | "rejected";
export interface ReimbursementStatementSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  assignmentId: string;
  periodFrom: string;
  periodUntil: string;
  status: ReimbursementStatementStatus;
  amountCents: number;
  energyWh: number;
  heldRecords: number;
  invalidRecords: number;
  eligibilityChanged: boolean;
  paymentStatus: "not-instructed";
  snapshotSha256: string;
  revisionOf: string | null;
  createdBy: string;
  rootStatementId: string;
  correctionOf: string | null;
  correctionMode: "recalculate" | "void" | null;
  supersededBy: string | null;
  adjustmentCents: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: ReimbursementRejectionReason | null;
  createdAt: string;
}
export type ReimbursementRejectionReason =
  | "source-issue"
  | "eligibility"
  | "policy-rate"
  | "duplicate"
  | "needs-review";
export interface ReimbursementStatement extends ReimbursementStatementSummary {
  snapshot: ReimbursementSnapshot;
  adjustment: ReimbursementAdjustment | null;
}
export interface ReimbursementWorkspaceData {
  employees: { id: string; name: string }[];
  policies: ReimbursementPolicy[];
  assignments: ReimbursementAssignment[];
  statements: ReimbursementStatementSummary[];
  journal: ReimbursementJournalEntry[];
  balances: ReimbursementApprovedBalance[];
}
