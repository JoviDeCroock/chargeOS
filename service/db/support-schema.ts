import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { organization, user } from "./schema.js";
import { reimbursementStatement } from "./reimbursement-schema.js";

export const supportCase = sqliteTable(
  "support_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => user.id),
    subject: text("subject").notNull(),
    topic: text("topic", {
      enum: ["statement-amount", "missing-session", "eligibility", "account", "other"],
    }).notNull(),
    statementId: text("statement_id").references(() => reimbursementStatement.id),
    statementSha256: text("statement_sha256"),
    status: text("status", {
      enum: ["open", "waiting-for-reporter", "resolved", "closed"],
    }).notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("support_case_organization").on(table.organizationId, table.createdAt, table.id),
    index("support_case_reporter").on(
      table.organizationId,
      table.reporterId,
      table.createdAt,
      table.id,
    ),
    check(
      "support_statement_reference",
      sql`(${table.statementId} IS NULL AND ${table.statementSha256} IS NULL) OR (${table.statementId} IS NOT NULL AND ${table.statementSha256} IS NOT NULL AND length(${table.statementSha256})=64)`,
    ),
    check("support_revision", sql`${table.revision} >= 1`),
  ],
);

export const supportEvent = sqliteTable(
  "support_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    caseId: text("case_id")
      .notNull()
      .references(() => supportCase.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorRole: text("actor_role", { enum: ["admin", "finance", "driver"] }).notNull(),
    revision: integer("revision").notNull(),
    action: text("action", {
      enum: ["created", "reply", "assign", "request-information", "resolve", "close", "reopen"],
    }).notNull(),
    payloadJson: text("payload_json").notNull(),
    requestSha256: text("request_sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("support_event_revision").on(table.caseId, table.revision),
    index("support_event_organization").on(table.organizationId, table.caseId),
  ],
);
