import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { localConfiguration, type ServiceEnv } from "../auth.js";
import { financialJournal, readFinancialData } from "../reimbursement-journal.js";
import { exactObject, MAX_COMMERCIAL_DATABASE_BYTES } from "./recovery-crypto.js";
import { readPrivateRecoveryFile, writePrivateRecoveryFile } from "./recovery-files.js";
import { inspectNativeCommercialDatabase } from "./recovery.js";
import { NativeCommercialDatabase } from "./sqlite.js";

const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const DAY = 86400000;
export const RECOVERY_REVIEW_CONFIRMATION =
  "I reviewed current identities, employer access, financial records and retirement of the previous service";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function iso(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Use a complete ISO timestamp for recovery review");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 4096 || /[\0\r\n]/u.test(value))
    throw new Error("Invalid recovery review text");
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid recovery digest");
  return value;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error("Recovery review list exceeds its boundary");
  return value;
}
export async function withNativeRecoveryCustody<T>(
  directory: string,
  run: () => Promise<T>,
): Promise<T> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Recovery custody requires an existing private directory");
  const lock = join(directory, ".recovery-lifecycle");
  await mkdir(lock, { mode: 0o700 });
  const created = await lstat(lock);
  try {
    await writePrivateRecoveryFile(
      join(lock, "operator.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await run();
  } finally {
    const current = await lstat(lock).catch(() => null);
    if (
      current?.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === created.dev &&
      current.ino === created.ino
    )
      await rm(lock, { recursive: true, force: true });
  }
}
export async function requirePersistentRecoveryOutput(
  directory: string,
  output: string,
): Promise<void> {
  const lock = await realpath(join(directory, ".recovery-lifecycle")),
    parent = await realpath(dirname(output));
  const path = relative(lock, parent);
  if (path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)))
    throw new Error("Recovery review output must remain outside the temporary lifecycle directory");
}
interface RecoveryProvenance {
  restoreId: string;
  backupCompletedAt: string;
  financialSha256: string;
  snapshotSha256: string;
  provenanceSha256: string;
}
async function provenance(database: NativeCommercialDatabase): Promise<RecoveryProvenance> {
  const records = await database
    .prepare("SELECT id,provenance_json FROM _chargeos_native_recovery")
    .all<{ id: number; provenance_json: string }>();
  if (
    records.results.length !== 1 ||
    records.results[0]!.id !== 1 ||
    records.results[0]!.provenance_json.length > 8192
  )
    throw new Error("Recovery quarantine provenance is unavailable");
  const value: unknown = JSON.parse(records.results[0]!.provenance_json);
  exactObject(value, [
    "restoreId",
    "sourceBundleSha256",
    "snapshotSha256",
    "sourceOrigin",
    "backupCompletedAt",
    "restoredAt",
    "financialSha256",
    "schemaVersion",
    "status",
    "financialState",
    "credentials",
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.status !== "quarantined" ||
    value.financialState !== "snapshot-only-unreconciled" ||
    value.credentials !== "removed-reenrollment-required" ||
    !localConfiguration({
      SERVICE_MODE: "local",
      SERVICE_ORIGIN: text(value.sourceOrigin),
      SERVICE_AUTH_SECRET: "recovery-origin-validation-only-secret",
    })
  )
    throw new Error("Recovery is not an unreconciled quarantined snapshot");
  hash(value.sourceBundleSha256);
  iso(value.restoredAt);
  return {
    restoreId: text(value.restoreId),
    backupCompletedAt: iso(value.backupCompletedAt),
    financialSha256: hash(value.financialSha256),
    snapshotSha256: hash(value.snapshotSha256),
    provenanceSha256: sha(canonical(value)),
  };
}
async function rows(
  database: NativeCommercialDatabase,
  sql: string,
  ...bindings: string[]
): Promise<string[]> {
  return (
    await database
      .prepare(sql)
      .bind(...bindings)
      .raw()
  )
    .map((row) => JSON.stringify(row))
    .sort();
}
async function financialFingerprints(database: NativeCommercialDatabase) {
  const organizations = await database
    .prepare("SELECT id FROM organization ORDER BY id")
    .all<{ id: string }>();
  if (organizations.results.length > 1000)
    throw new Error("Recovery review supports at most 1000 organizations");
  const tables = (
    await database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'reimbursement_*' ORDER BY name",
      )
      .all<{ name: string }>()
  ).results;
  const result: { id: string; financialSha256: string }[] = [];
  for (const org of organizations.results) {
    financialJournal(await readFinancialData({ SERVICE_DB: database }, org.id, "", true));
    const digest = createHash("sha256");
    for (const table of tables) {
      const sql =
        table.name === "reimbursement_assignment_end"
          ? "SELECT e.* FROM reimbursement_assignment_end e JOIN reimbursement_assignment a ON a.id=e.assignment_id WHERE a.organization_id=?"
          : `SELECT * FROM "${table.name}" WHERE organization_id=?`;
      digest.update(JSON.stringify([table.name, await rows(database, sql, org.id)]));
    }
    result.push({ id: org.id, financialSha256: digest.digest("hex") });
  }
  return result;
}
async function businessFingerprint(database: NativeCommercialDatabase): Promise<string> {
  const digest = createHash("sha256");
  const tables = (
    await database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_chargeos_*' ORDER BY name",
      )
      .all<{ name: string }>()
  ).results;
  const authTables = new Set([
    "account",
    "session",
    "verification",
    "two_factor",
    "rate_limit",
    "local_outbox",
  ]);
  for (const table of tables) {
    if (authTables.has(table.name)) continue;
    const sql =
      table.name === "user"
        ? "SELECT id,name,email,image,created_at FROM user"
        : `SELECT * FROM "${table.name}"`;
    digest.update(JSON.stringify([table.name, await rows(database, sql)]));
  }
  return digest.digest("hex");
}
async function inspectQuarantine(directory: string) {
  await lstat(join(directory, "commercial.sqlite"));
  const database = new NativeCommercialDatabase(directory, { recoveryInspection: true });
  try {
    const pages = (await database.prepare("PRAGMA page_count").first<number>("page_count"))!,
      pageSize = (await database.prepare("PRAGMA page_size").first<number>("page_size"))!;
    if (pages * pageSize > MAX_COMMERCIAL_DATABASE_BYTES)
      throw new Error("Quarantined database exceeds the recovery size boundary");
    const summary = await inspectNativeCommercialDatabase(database, true),
      root = await provenance(database);
    if (summary.financialSha256 !== root.financialSha256)
      throw new Error("Financial records changed after restore");
    return {
      database,
      root,
      businessSha256: await businessFingerprint(database),
      organizations: await financialFingerprints(database),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
export async function checkpointNativeCommercial(
  configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET">,
  directory: string,
  output: string,
) {
  if (!localConfiguration(configuration))
    throw new Error("Use a configured native commercial source");
  await lstat(join(directory, "commercial.sqlite"));
  const staging = await mkdtemp(join(tmpdir(), "chargeos-commercial-checkpoint-"));
  let source: NativeCommercialDatabase | undefined, copy: NativeCommercialDatabase | undefined;
  try {
    source = new NativeCommercialDatabase(directory);
    const pages = (await source.prepare("PRAGMA page_count").first<number>("page_count"))!,
      pageSize = (await source.prepare("PRAGMA page_size").first<number>("page_size"))!;
    if (pages * pageSize > MAX_COMMERCIAL_DATABASE_BYTES)
      throw new Error("Commercial checkpoint exceeds supported snapshot size");
    await source.snapshotTo(staging);
    source.close();
    source = undefined;
    copy = new NativeCommercialDatabase(staging);
    await inspectNativeCommercialDatabase(copy);
    const checkpoint = {
      format: "chargeos-commercial-financial-checkpoint",
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      organizations: await financialFingerprints(copy),
    };
    await writePrivateRecoveryFile(output, JSON.stringify(checkpoint, null, 2) + "\n");
    return {
      organizations: checkpoint.organizations.length,
      capturedAt: checkpoint.capturedAt,
      status: "checkpoint-created",
    };
  } finally {
    source?.close();
    copy?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
export async function createNativeRecoveryReviewTemplate(directory: string, output: string) {
  return withNativeRecoveryCustody(directory, async () => {
    await requirePersistentRecoveryOutput(directory, output);
    const current = await inspectQuarantine(directory);
    try {
      const orgs = await current.database
        .prepare("SELECT id,name,created_by FROM organization ORDER BY id")
        .all<{ id: string; name: string; created_by: string }>();
      const organizations = [];
      for (const org of orgs.results) {
        const members = (
          await current.database
            .prepare(
              "SELECT m.user_id,u.email,m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY m.user_id",
            )
            .bind(org.id)
            .all()
        ).results;
        const assignments = (
          await current.database
            .prepare(
              "SELECT a.id,a.employee_id,a.effective_from,a.effective_until,e.effective_until AS existing_until FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id=a.id WHERE a.organization_id=? ORDER BY a.id",
            )
            .bind(org.id)
            .all<{
              id: string;
              employee_id: string;
              effective_from: number;
              effective_until: number;
              existing_until: number | null;
            }>()
        ).results;
        organizations.push({
          id: org.id,
          financialEvidenceFile: "",
          rosterEvidenceFile: "",
          members: members.map((member) => ({
            userId: member.user_id,
            email: member.email,
            role: member.role,
            decision: "unreviewed",
            identityEvidenceFile: "",
          })),
          eligibilityEnds: [],
          reference: {
            organizationName: org.name,
            protectedCreatorId: org.created_by,
            assignments: assignments.map((assignment) => ({
              id: assignment.id,
              employeeId: assignment.employee_id,
              effectiveFrom: new Date(assignment.effective_from).toISOString(),
              effectiveUntil: new Date(assignment.effective_until).toISOString(),
              existingEnd:
                assignment.existing_until === null
                  ? null
                  : new Date(assignment.existing_until).toISOString(),
            })),
          },
        });
      }
      const manifest = {
        format: "chargeos-commercial-recovery-review",
        schemaVersion: 1,
        restoreId: current.root.restoreId,
        businessSha256: current.businessSha256,
        provenanceSha256: current.root.provenanceSha256,
        reviewedThrough: null,
        confirmation: "",
        sourceRetirementEvidenceFile: "",
        financialCheckpointFile: "",
        organizations,
      };
      const serialized = JSON.stringify(manifest, null, 2) + "\n";
      if (Buffer.byteLength(serialized) > MAX_REVIEW_BYTES)
        throw new Error("Recovery review template exceeds its size boundary");
      await writePrivateRecoveryFile(output, serialized);
      return {
        status: "unreviewed-template",
        organizations: orgs.results.length,
        reopeningAllowed: false,
      };
    } finally {
      current.database.close();
    }
  });
}

async function evidence(path: unknown): Promise<string> {
  const bytes = await readPrivateRecoveryFile(text(path), MAX_EVIDENCE_BYTES);
  if (!bytes.length) throw new Error("Recovery evidence must not be empty");
  return sha(bytes);
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b)))
      : item,
  );
}
/** Caller must retain lifecycle custody until it has consumed this evaluation. */
export async function evaluateNativeRecoveryReview(
  directory: string,
  manifestFile: string,
  now = new Date(),
) {
  const bytes = await readPrivateRecoveryFile(manifestFile, MAX_REVIEW_BYTES),
    manifest: unknown = JSON.parse(bytes.toString("utf8"));
  exactObject(manifest, [
    "format",
    "schemaVersion",
    "restoreId",
    "businessSha256",
    "provenanceSha256",
    "reviewedThrough",
    "confirmation",
    "sourceRetirementEvidenceFile",
    "financialCheckpointFile",
    "organizations",
  ]);
  if (
    manifest.format !== "chargeos-commercial-recovery-review" ||
    manifest.schemaVersion !== 1 ||
    manifest.confirmation !== RECOVERY_REVIEW_CONFIRMATION
  )
    throw new Error("Complete the recovery review and its exact confirmation");
  const reviewedThrough = iso(manifest.reviewedThrough),
    reviewedAt = Date.parse(reviewedThrough);
  if (
    !Number.isFinite(now.getTime()) ||
    reviewedAt > now.getTime() ||
    now.getTime() - reviewedAt >= DAY
  )
    throw new Error("Recovery review must cover a current time within the last 24 hours");
  const current = await inspectQuarantine(directory);
  try {
    if (
      manifest.restoreId !== current.root.restoreId ||
      manifest.provenanceSha256 !== current.root.provenanceSha256 ||
      manifest.businessSha256 !== current.businessSha256
    )
      throw new Error(
        "Recovery review does not match the restored identities and business records",
      );
    const checkpointBytes = await readPrivateRecoveryFile(
      text(manifest.financialCheckpointFile),
      MAX_REVIEW_BYTES,
    );
    const checkpoint: unknown = JSON.parse(checkpointBytes.toString("utf8"));
    exactObject(checkpoint, ["format", "schemaVersion", "capturedAt", "organizations"]);
    if (
      checkpoint.format !== "chargeos-commercial-financial-checkpoint" ||
      checkpoint.schemaVersion !== 1 ||
      Date.parse(iso(checkpoint.capturedAt)) < Date.parse(current.root.backupCompletedAt) ||
      Date.parse(iso(checkpoint.capturedAt)) > reviewedAt
    )
      throw new Error(
        "Use a financial checkpoint captured after the backup and before the reviewed cut-off",
      );
    const checkpointOrgs = list(checkpoint.organizations, 1000)
      .map((org) => {
        exactObject(org, ["id", "financialSha256"]);
        return { id: text(org.id), financialSha256: hash(org.financialSha256) };
      })
      .sort((a, b) => compare(a.id, b.id));
    if (
      canonical(checkpointOrgs) !==
      canonical([...current.organizations].sort((a, b) => compare(a.id, b.id)))
    )
      throw new Error(
        "Financial checkpoint differs from this snapshot; reconcile missing or changed records before continuing",
      );
    const sourceRetirementEvidenceSha256 = await evidence(manifest.sourceRetirementEvidenceFile);
    const orgs = await current.database
      .prepare("SELECT id,name,created_by FROM organization ORDER BY id")
      .all<{ id: string; name: string; created_by: string }>();
    const suppliedOrgs = list(manifest.organizations, 1000),
      seen = new Set<string>(),
      normalized = [];
    let selected = 0,
      removed = 0;
    if (suppliedOrgs.length !== orgs.results.length)
      throw new Error("Review every restored organization");
    for (const supplied of suppliedOrgs) {
      exactObject(supplied, [
        "id",
        "financialEvidenceFile",
        "rosterEvidenceFile",
        "members",
        "eligibilityEnds",
        "reference",
      ]);
      const org = orgs.results.find((item) => item.id === supplied.id);
      if (!org || seen.has(org.id))
        throw new Error("Duplicate or foreign organization in recovery review");
      seen.add(org.id);
      const members = (
        await current.database
          .prepare(
            "SELECT m.user_id,u.email,m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY m.user_id",
          )
          .bind(org.id)
          .all<{ user_id: string; email: string; role: string }>()
      ).results;
      const assignments = (
        await current.database
          .prepare(
            "SELECT a.id,a.employee_id,a.effective_from,a.effective_until,e.effective_until AS existing_until FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id=a.id WHERE a.organization_id=? ORDER BY a.id",
          )
          .bind(org.id)
          .all<{
            id: string;
            employee_id: string;
            effective_from: number;
            effective_until: number;
            existing_until: number | null;
          }>()
      ).results;
      const reference = {
        organizationName: org.name,
        protectedCreatorId: org.created_by,
        assignments: assignments.map((assignment) => ({
          id: assignment.id,
          employeeId: assignment.employee_id,
          effectiveFrom: new Date(assignment.effective_from).toISOString(),
          effectiveUntil: new Date(assignment.effective_until).toISOString(),
          existingEnd:
            assignment.existing_until === null
              ? null
              : new Date(assignment.existing_until).toISOString(),
        })),
      };
      if (canonical(supplied.reference) !== canonical(reference))
        throw new Error("Recovery reference information changed");
      const suppliedMembers = list(supplied.members, 10000),
        memberIds = new Set<string>(),
        normalizedMembers = [],
        removedIds = new Set<string>();
      if (suppliedMembers.length !== members.length)
        throw new Error("Decide every existing membership explicitly");
      for (const item of suppliedMembers) {
        exactObject(item, ["userId", "email", "role", "decision", "identityEvidenceFile"]);
        const member = members.find((row) => row.user_id === item.userId);
        if (
          !member ||
          memberIds.has(member.user_id) ||
          member.email !== item.email ||
          !["keep", "remove"].includes(String(item.decision))
        )
          throw new Error("Recovery membership must match the immutable reviewed identity");
        memberIds.add(member.user_id);
        const role = text(item.role);
        if (member.user_id === org.created_by && (item.decision !== "keep" || role !== "admin"))
          throw new Error(
            "Current recovery requires the original organization creator to remain its protected administrator",
          );
        if (item.decision === "keep") {
          if (member.user_id !== org.created_by && !["finance", "driver"].includes(role))
            throw new Error("Unsupported recovered administrator succession");
          const identityEvidenceSha256 = await evidence(item.identityEvidenceFile);
          normalizedMembers.push({
            userId: member.user_id,
            email: member.email,
            role,
            decision: "keep",
            identityEvidenceSha256,
          });
          selected++;
        } else {
          if (role !== member.role || item.identityEvidenceFile !== "")
            throw new Error(
              "Removed membership must retain its recorded role and have no enrollment evidence",
            );
          normalizedMembers.push({
            userId: member.user_id,
            email: member.email,
            role,
            decision: "remove",
            identityEvidenceSha256: null,
          });
          removedIds.add(member.user_id);
          removed++;
        }
      }
      if (
        !normalizedMembers.some(
          (member) =>
            member.userId === org.created_by &&
            member.role === "admin" &&
            member.decision === "keep",
        )
      )
        throw new Error("Recovery requires a current protected organization creator");
      const expectedEnds = assignments.filter((assignment) =>
          removedIds.has(assignment.employee_id),
        ),
        suppliedEnds = list(supplied.eligibilityEnds, 10000),
        endIds = new Set<string>(),
        normalizedEnds = [];
      if (suppliedEnds.length !== expectedEnds.length)
        throw new Error("Reconcile every removed employee assignment explicitly");
      for (const end of suppliedEnds) {
        exactObject(end, ["assignmentId", "expectedExistingUntil", "effectiveUntil"]);
        const assignment = expectedEnds.find((row) => row.id === end.assignmentId);
        if (!assignment || endIds.has(assignment.id))
          throw new Error("Duplicate or foreign eligibility end");
        endIds.add(assignment.id);
        const existing =
            assignment.existing_until === null
              ? null
              : new Date(assignment.existing_until).toISOString(),
          effectiveUntil = iso(end.effectiveUntil),
          time = Date.parse(effectiveUntil);
        if (
          end.expectedExistingUntil !== existing ||
          (existing !== null && effectiveUntil !== existing)
        )
          throw new Error("Immutable eligibility end conflicts with the recovery decision");
        if (
          time < assignment.effective_from ||
          time > assignment.effective_until ||
          (time > reviewedAt && time !== assignment.effective_from)
        )
          throw new Error("Eligibility end is outside the reviewed assignment interval");
        normalizedEnds.push({
          assignmentId: assignment.id,
          expectedExistingUntil: existing,
          effectiveUntil,
        });
      }
      normalized.push({
        organizationId: org.id,
        financialSha256: current.organizations.find((row) => row.id === org.id)!.financialSha256,
        financialEvidenceSha256: await evidence(supplied.financialEvidenceFile),
        rosterEvidenceSha256: await evidence(supplied.rosterEvidenceFile),
        members: normalizedMembers.sort((a, b) => compare(a.userId, b.userId)),
        eligibilityEnds: normalizedEnds.sort((a, b) => compare(a.assignmentId, b.assignmentId)),
      });
    }
    const report = {
      format: "chargeos-commercial-validated-recovery-review",
      schemaVersion: 1,
      restoreId: current.root.restoreId,
      snapshotSha256: current.root.snapshotSha256,
      businessSha256: current.businessSha256,
      provenanceSha256: current.root.provenanceSha256,
      manifestSha256: sha(bytes),
      financialCheckpointSha256: sha(checkpointBytes),
      sourceRetirementEvidenceSha256,
      reviewedThrough,
      expiresAt: new Date(reviewedAt + DAY).toISOString(),
      operatorAttestation: RECOVERY_REVIEW_CONFIRMATION,
      organizations: normalized.sort((a, b) => compare(a.organizationId, b.organizationId)),
      status: "reviewed-not-enrolled",
      reopeningAllowed: false,
    };
    if (
      (await provenance(current.database)).provenanceSha256 !== current.root.provenanceSha256 ||
      (await businessFingerprint(current.database)) !== current.businessSha256
    )
      throw new Error("Recovery records changed during review validation");
    const serialized = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > MAX_REVIEW_BYTES)
      throw new Error("Validated recovery review exceeds its size boundary");
    return {
      report,
      status: report.status,
      restoreId: report.restoreId,
      reviewSha256: sha(canonical(report)),
      selectedMemberships: selected,
      removedMemberships: removed,
      reopeningAllowed: false,
    };
  } finally {
    current.database.close();
  }
}

export async function validateNativeRecoveryReview(
  directory: string,
  manifestFile: string,
  output: string,
  now = new Date(),
) {
  return withNativeRecoveryCustody(directory, async () => {
    await requirePersistentRecoveryOutput(directory, output);
    const { report, ...summary } = await evaluateNativeRecoveryReview(directory, manifestFile, now);
    await writePrivateRecoveryFile(output, JSON.stringify(report, null, 2) + "\n");
    return summary;
  });
}

export type EvaluatedNativeRecoveryReview = Awaited<
  ReturnType<typeof evaluateNativeRecoveryReview>
>;
