import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until"),
  },
  (table) => [index("two_factor_user_idx").on(table.userId)],
);

export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// Private delivery queue. Local rows never become SMTP mail implicitly.
export const localOutbox = sqliteTable("local_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["verify-email", "reset-password", "invitation"] }).notNull(),
  recipient: text("recipient").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  channel: text("channel", { enum: ["local", "smtp"] })
    .notNull()
    .default("local"),
  status: text("status", { enum: ["pending", "failed"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at")
    .notNull()
    .default(sql`0`),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  lastFailure: text("last_failure"),
});

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").notNull(),
});

export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["admin", "finance", "driver"] }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("membership_organization_user").on(table.organizationId, table.userId),
    index("membership_user_idx").on(table.userId),
  ],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    email: text("email").notNull(),
    role: text("role", { enum: ["finance", "driver"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: ["pending", "accepted", "revoked"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedBy: text("accepted_by").references(() => user.id),
    acceptedAt: timestamp("accepted_at"),
  },
  (table) => [index("invitation_organization_idx").on(table.organizationId)],
);

export const serviceAudit = sqliteTable(
  "service_audit",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    actorId: text("actor_id").references(() => user.id),
    recoveryReleaseId: text("recovery_release_id"),
    action: text("action", {
      enum: [
        "organization.created",
        "invitation.created",
        "invitation.accepted",
        "invitation.revoked",
        "membership.removed",
        "policy.published",
        "assignment.created",
        "assignment.ended",
        "statement.drafted",
        "statement.approved",
        "statement.rejected",
        "statement.correction-drafted",
        "statement.adjusted",
        "recovery.released",
      ],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    check(
      "service_audit_actor",
      sql`(${table.actorId} IS NOT NULL AND ${table.recoveryReleaseId} IS NULL) OR (${table.actorId} IS NULL AND ${table.recoveryReleaseId} IS NOT NULL AND length(${table.recoveryReleaseId}) > 0)`,
    ),
  ],
);
