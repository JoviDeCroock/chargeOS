import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { user } from "./db/schema.js";
import {
  reimbursementStatement as statements,
  reimbursementAssignmentEnd as ends,
} from "./db/reimbursement-schema.js";
import { reimbursementAdjustment as adjustments } from "./db/correction-schema.js";
import { hashBytes, HttpError } from "./http.js";
import type { ServiceEnv } from "./auth.js";
import type {
  ReimbursementAdjustment,
  ReimbursementAdjustmentReceipt,
  ReimbursementApprovedBalance,
  ReimbursementJournalEntry,
  ReimbursementSnapshot,
  ReimbursementStatement,
  ReimbursementStatementSummary,
} from "../shared/contracts.js";

export interface FinancialRow {
  record: typeof statements.$inferSelect;
  employeeName: string;
  currentUntil: Date | null;
  snapshot: ReimbursementSnapshot;
}
export interface FinancialData {
  rows: FinancialRow[];
  adjustments: (typeof adjustments.$inferSelect & ReimbursementAdjustment)[];
}
const failure = () => new HttpError(409, "Financial snapshot or adjustment integrity check failed");

export async function readFinancialData(
  env: ServiceEnv,
  organizationId: string,
  actorId: string,
  finance: boolean,
): Promise<FinancialData> {
  const db = drizzle(env.SERVICE_DB);
  // A single read batch prevents a concurrent approval being seen half before/half after commit.
  const [statementRows, adjustmentRows] = await db.batch([
    db
      .select({ record: statements, employeeName: user.name, currentUntil: ends.effectiveUntil })
      .from(statements)
      .innerJoin(user, eq(statements.employeeId, user.id))
      .leftJoin(ends, eq(statements.assignmentId, ends.assignmentId))
      .where(
        finance
          ? eq(statements.organizationId, organizationId)
          : and(eq(statements.organizationId, organizationId), eq(statements.employeeId, actorId)),
      ),
    db
      .select()
      .from(adjustments)
      .where(
        finance
          ? eq(adjustments.organizationId, organizationId)
          : and(
              eq(adjustments.organizationId, organizationId),
              eq(adjustments.employeeId, actorId),
            ),
      ),
  ]);
  const rows: FinancialRow[] = [];
  for (const row of statementRows) {
    if (
      (await hashBytes(new TextEncoder().encode(row.record.snapshotJson))) !==
      row.record.snapshotSha256
    )
      throw failure();
    const snapshot = JSON.parse(row.record.snapshotJson) as ReimbursementSnapshot;
    if (
      snapshot.expectedAmountCents !== row.record.amountCents ||
      snapshot.includedEnergyWh !== row.record.energyWh ||
      snapshot.counts.included !== row.record.includedRecords ||
      snapshot.counts.held !== row.record.heldRecords ||
      snapshot.issues.length !== row.record.invalidRecords ||
      snapshot.assignment.id !== row.record.assignmentId ||
      snapshot.assignment.employeeId !== row.record.employeeId ||
      Date.parse(snapshot.assignment.effectiveUntil) !== row.record.assignmentUntil.getTime() ||
      snapshot.period.from !== row.record.periodFrom.toISOString() ||
      snapshot.period.until !== row.record.periodUntil.toISOString()
    )
      throw failure();
    rows.push({ ...row, snapshot });
  }
  const receipts: FinancialData["adjustments"] = [];
  for (const row of adjustmentRows) {
    if ((await hashBytes(new TextEncoder().encode(row.receiptJson))) !== row.receiptSha256)
      throw failure();
    const receipt = JSON.parse(row.receiptJson) as ReimbursementAdjustmentReceipt;
    if (
      receipt.id !== row.id ||
      receipt.rootStatementId !== row.rootStatementId ||
      receipt.previousStatementId !== row.previousStatementId ||
      receipt.replacementStatementId !== row.replacementStatementId ||
      receipt.differenceCents !== row.differenceCents ||
      receipt.approvedBy !== row.createdBy ||
      receipt.approvedAt !== row.createdAt.toISOString()
    )
      throw failure();
    receipts.push({ ...row, receipt, sha256: row.receiptSha256 });
  }
  const byId = new Map(rows.map((row) => [row.record.id, row]));
  for (const adjustment of receipts) {
    const receipt = adjustment.receipt,
      previous = byId.get(receipt.previousStatementId),
      replacement = byId.get(receipt.replacementStatementId),
      root = byId.get(receipt.rootStatementId);
    const parentReceipt = receipts.find(
      (item) => item.replacementStatementId === receipt.previousStatementId,
    );
    const context = replacement?.snapshot.correction;
    if (
      !previous ||
      !replacement ||
      !root ||
      root.snapshot.correction ||
      root.record.status !== "approved" ||
      previous.record.status !== "approved" ||
      replacement.record.status !== "approved" ||
      previous.record.employeeId !== adjustment.employeeId ||
      replacement.record.employeeId !== adjustment.employeeId ||
      root.record.employeeId !== adjustment.employeeId ||
      receipt.previousSnapshotSha256 !== previous.record.snapshotSha256 ||
      receipt.replacementSnapshotSha256 !== replacement.record.snapshotSha256 ||
      receipt.previousAmountCents !== previous.record.amountCents ||
      receipt.replacementAmountCents !== replacement.record.amountCents ||
      BigInt(receipt.differenceCents) !==
        BigInt(replacement.record.amountCents) - BigInt(previous.record.amountCents) ||
      receipt.previousAdjustmentSha256 !== (parentReceipt?.sha256 ?? null) ||
      !context ||
      context.previousStatementId !== previous.record.id ||
      context.rootStatementId !== root.record.id ||
      context.previousSnapshotSha256 !== previous.record.snapshotSha256 ||
      context.previousAdjustmentSha256 !== (parentReceipt?.sha256 ?? null) ||
      context.previousAmountCents !== receipt.previousAmountCents ||
      context.reason !== receipt.reason ||
      context.mode !== receipt.mode ||
      replacement.record.reviewedBy !== receipt.approvedBy ||
      replacement.record.reviewedAt?.toISOString() !== receipt.approvedAt
    )
      throw failure();
  }
  for (const row of rows)
    if (
      row.record.status === "approved" &&
      row.snapshot.correction &&
      !receipts.some((item) => item.replacementStatementId === row.record.id)
    )
      throw failure();
  return { rows, adjustments: receipts };
}

export function financialSummary(
  row: FinancialRow,
  data: FinancialData,
): ReimbursementStatementSummary {
  const r = row.record,
    correction = row.snapshot.correction;
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: row.employeeName,
    assignmentId: r.assignmentId,
    periodFrom: r.periodFrom.toISOString(),
    periodUntil: r.periodUntil.toISOString(),
    status: r.status,
    amountCents: r.amountCents,
    energyWh: r.energyWh,
    heldRecords: r.heldRecords,
    invalidRecords: r.invalidRecords,
    eligibilityChanged:
      row.currentUntil !== null && row.currentUntil.getTime() !== r.assignmentUntil.getTime(),
    paymentStatus: "not-instructed",
    snapshotSha256: r.snapshotSha256,
    revisionOf: r.revisionOf,
    createdBy: r.createdBy,
    rootStatementId: correction?.rootStatementId ?? r.id,
    correctionOf: correction?.previousStatementId ?? null,
    correctionMode: correction?.mode ?? null,
    supersededBy:
      data.adjustments.find((item) => item.previousStatementId === r.id)?.replacementStatementId ??
      null,
    adjustmentCents: correction
      ? Number(BigInt(r.amountCents) - BigInt(correction.previousAmountCents))
      : null,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
  };
}
export function financialStatement(id: string, data: FinancialData): ReimbursementStatement {
  const row = data.rows.find((item) => item.record.id === id);
  if (!row) throw new HttpError(404, "Statement not found");
  const adjustment = data.adjustments.find((item) => item.replacementStatementId === id);
  return {
    ...financialSummary(row, data),
    snapshot: row.snapshot,
    adjustment: adjustment ? { sha256: adjustment.sha256, receipt: adjustment.receipt } : null,
  };
}
export function financialJournal(data: FinancialData): {
  journal: ReimbursementJournalEntry[];
  balances: ReimbursementApprovedBalance[];
} {
  const journal: ReimbursementJournalEntry[] = [];
  for (const row of data.rows) {
    const r = row.record;
    if (r.status !== "approved" || row.snapshot.correction) continue;
    if (!r.reviewedBy || !r.reviewedAt) throw failure();
    journal.push({
      id: `approval:${r.id}`,
      kind: "statement-approval",
      rootStatementId: r.id,
      statementId: r.id,
      previousStatementId: null,
      employeeId: r.employeeId,
      employeeName: row.employeeName,
      differenceCents: r.amountCents,
      resultingAmountCents: r.amountCents,
      reason: null,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt.toISOString(),
      snapshotSha256: r.snapshotSha256,
      adjustmentSha256: null,
    });
  }
  for (const entry of data.adjustments) {
    const replacement = data.rows.find((row) => row.record.id === entry.replacementStatementId)!;
    journal.push({
      id: entry.id,
      kind: "adjustment",
      rootStatementId: entry.rootStatementId,
      statementId: entry.replacementStatementId,
      previousStatementId: entry.previousStatementId,
      employeeId: entry.employeeId,
      employeeName: replacement.employeeName,
      differenceCents: entry.differenceCents,
      resultingAmountCents: entry.receipt.replacementAmountCents,
      reason: entry.receipt.reason,
      reviewedBy: entry.createdBy,
      reviewedAt: entry.createdAt.toISOString(),
      snapshotSha256: entry.receipt.replacementSnapshotSha256,
      adjustmentSha256: entry.sha256,
    });
  }
  journal.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.id.localeCompare(b.id));
  const balances: ReimbursementApprovedBalance[] = [];
  for (const employeeId of new Set(journal.map((item) => item.employeeId))) {
    const entries = journal.filter((item) => item.employeeId === employeeId);
    const heads = data.rows.filter(
      (row) =>
        row.record.employeeId === employeeId &&
        row.record.status === "approved" &&
        !data.adjustments.some((item) => item.previousStatementId === row.record.id),
    );
    const amount = heads.reduce((sum, row) => sum + BigInt(row.record.amountCents), 0n);
    const journalAmount = entries.reduce((sum, entry) => sum + BigInt(entry.differenceCents), 0n);
    const held = heads
      .filter((row) => financialSummary(row, data).eligibilityChanged)
      .reduce((sum, row) => sum + BigInt(row.record.amountCents), 0n);
    if (amount !== journalAmount || amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
      throw failure();
    balances.push({
      employeeId,
      employeeName: entries[0]!.employeeName,
      approvedAmountCents: Number(amount),
      needsReviewAmountCents: Number(held),
      currentStatements: heads.length,
      paymentStatus: "not-instructed",
    });
  }
  return { journal, balances };
}
