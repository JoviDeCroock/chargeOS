import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organization, user } from "./schema.js";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
export const reimbursementPolicy = sqliteTable(
  "reimbursement_policy",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    key: text("key").notNull(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    effectiveUntil: timestamp("effective_until").notNull(),
    rateEurPerKwh: text("rate_eur_per_kwh").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("reimbursement_policy_version").on(table.organizationId, table.key, table.version),
  ],
);

export const reimbursementAssignment = sqliteTable(
  "reimbursement_assignment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => user.id),
    driverAlias: text("driver_alias").notNull(),
    stationAlias: text("station_alias").notNull(),
    vehicleAlias: text("vehicle_alias").notNull(),
    cardAlias: text("card_alias").notNull(),
    costCenter: text("cost_center").notNull(),
    policyVersionId: text("policy_version_id")
      .notNull()
      .references(() => reimbursementPolicy.id),
    effectiveFrom: timestamp("effective_from").notNull(),
    effectiveUntil: timestamp("effective_until").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("reimbursement_assignment_organization").on(table.organizationId, table.employeeId),
  ],
);

export const reimbursementAssignmentEnd = sqliteTable("reimbursement_assignment_end", {
  assignmentId: text("assignment_id")
    .primaryKey()
    .references(() => reimbursementAssignment.id),
  effectiveUntil: timestamp("effective_until").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").notNull(),
});

export const reimbursementStatement = sqliteTable(
  "reimbursement_statement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => user.id),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => reimbursementAssignment.id),
    draftKey: text("draft_key").notNull(),
    periodFrom: timestamp("period_from").notNull(),
    periodUntil: timestamp("period_until").notNull(),
    assignmentUntil: timestamp("assignment_until").notNull(),
    status: text("status", { enum: ["draft", "approved", "rejected"] })
      .notNull()
      .default("draft"),
    snapshotJson: text("snapshot_json").notNull(),
    snapshotSha256: text("snapshot_sha256").notNull(),
    amountCents: integer("amount_cents").notNull(),
    energyWh: integer("energy_wh").notNull(),
    includedRecords: integer("included_records").notNull(),
    heldRecords: integer("held_records").notNull(),
    invalidRecords: integer("invalid_records").notNull(),
    revisionOf: text("revision_of"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    rejectionReason: text("rejection_reason", {
      enum: ["source-issue", "eligibility", "policy-rate", "duplicate", "needs-review"],
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("reimbursement_statement_draft").on(table.organizationId, table.draftKey),
    index("reimbursement_statement_employee").on(table.organizationId, table.employeeId),
  ],
);

export const reimbursementClaim = sqliteTable(
  "reimbursement_claim",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    stationAlias: text("station_alias").notNull(),
    sessionId: text("session_id").notNull(),
    statementId: text("statement_id")
      .notNull()
      .references(() => reimbursementStatement.id),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.stationAlias, table.sessionId] })],
);
