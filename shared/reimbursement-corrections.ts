import type { ReimbursementRejectionReason } from "./reimbursement.js";

export type ReimbursementCorrectionReason = ReimbursementRejectionReason;
export interface ReimbursementCorrectionContext {
  mode: "recalculate" | "void";
  reason: ReimbursementCorrectionReason;
  rootStatementId: string;
  previousStatementId: string;
  previousSnapshotSha256: string;
  previousAdjustmentSha256: string | null;
  previousAmountCents: number;
  selectedPolicyVersionId: string;
}
export interface CreateReimbursementVoid {
  snapshotSha256: string;
  reason: "source-issue" | "eligibility" | "duplicate";
  revisionOf?: string | null;
}
export interface ReimbursementAdjustmentReceipt {
  schemaVersion: 1;
  kind: "reimbursement-adjustment";
  id: string;
  rootStatementId: string;
  previousStatementId: string;
  replacementStatementId: string;
  previousSnapshotSha256: string;
  replacementSnapshotSha256: string;
  previousAdjustmentSha256: string | null;
  previousAmountCents: number;
  replacementAmountCents: number;
  differenceCents: number;
  reason: ReimbursementCorrectionReason;
  mode: "recalculate" | "void";
  approvedBy: string;
  approvedAt: string;
}
export interface ReimbursementAdjustment {
  sha256: string;
  receipt: ReimbursementAdjustmentReceipt;
}
export interface ReimbursementJournalEntry {
  id: string;
  kind: "statement-approval" | "adjustment";
  rootStatementId: string;
  statementId: string;
  previousStatementId: string | null;
  employeeId: string;
  employeeName: string;
  differenceCents: number;
  resultingAmountCents: number;
  reason: ReimbursementCorrectionReason | null;
  reviewedBy: string;
  reviewedAt: string;
  snapshotSha256: string;
  adjustmentSha256: string | null;
}
export interface ReimbursementApprovedBalance {
  employeeId: string;
  employeeName: string;
  approvedAmountCents: number;
  needsReviewAmountCents: number;
  currentStatements: number;
  paymentStatus: "not-instructed";
}
