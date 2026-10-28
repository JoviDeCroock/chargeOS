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
}
export interface ReimbursementSnapshot {
  schemaVersion: 1;
  sourceAuthority: "user-supplied-csv";
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
}
export interface ReimbursementWorkspaceData {
  employees: { id: string; name: string }[];
  policies: ReimbursementPolicy[];
  assignments: ReimbursementAssignment[];
  statements: ReimbursementStatementSummary[];
}
