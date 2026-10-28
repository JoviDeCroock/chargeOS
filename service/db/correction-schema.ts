import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { organization, user } from "./schema.js";
import { reimbursementStatement } from "./reimbursement-schema.js";

export const reimbursementAdjustment = sqliteTable(
  "reimbursement_adjustment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => user.id),
    rootStatementId: text("root_statement_id")
      .notNull()
      .references(() => reimbursementStatement.id),
    previousStatementId: text("previous_statement_id")
      .notNull()
      .references(() => reimbursementStatement.id),
    replacementStatementId: text("replacement_statement_id")
      .notNull()
      .references(() => reimbursementStatement.id),
    receiptJson: text("receipt_json").notNull(),
    receiptSha256: text("receipt_sha256").notNull(),
    differenceCents: integer("difference_cents").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("reimbursement_adjustment_predecessor").on(table.previousStatementId),
    uniqueIndex("reimbursement_adjustment_replacement").on(table.replacementStatementId),
    index("reimbursement_adjustment_organization").on(table.organizationId, table.employeeId),
  ],
);
