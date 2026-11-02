import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { membership, user } from "./db/schema.js";
import {
  reimbursementAssignment as assignmentTable,
  reimbursementAssignmentEnd as endTable,
  reimbursementPolicy as policyTable,
  reimbursementStatement as statementTable,
} from "./db/reimbursement-schema.js";
import { HttpError, hashBytes, input, json, objectInput, textValue } from "./http.js";
import {
  calculateReimbursementObservation,
  fingerprintObservationSource,
  mapObservationSessions,
  normalizeObservationPolicy,
  ObservationInputError,
  parseObservationCsv,
} from "../shared/observation-engine.js";
import type {
  ReimbursementAssignment,
  ReimbursementPolicy,
  ReimbursementSnapshot,
  ReimbursementStatement,
  ReimbursementWorkspaceData,
  ServiceOrganization,
  SessionColumnMapping,
} from "../shared/contracts.js";
import { createServiceAuth, type ServiceEnv } from "./auth.js";
import {
  financialJournal,
  financialStatement,
  financialSummary,
  readFinancialData,
  type FinancialData,
} from "./reimbursement-journal.js";
import type {
  ReimbursementCorrectionContext,
  ReimbursementCorrectionReason,
  ReimbursementAdjustmentReceipt,
} from "../shared/contracts.js";

const identifier = (value: unknown) => {
  const text = textValue(value, 96);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(text))
    throw new HttpError(
      400,
      "Use non-secret aliases containing letters, numbers, dot, underscore, colon or hyphen",
    );
  return text;
};
const iso = (value: Date) => value.toISOString();
type PolicyRow = typeof policyTable.$inferSelect;
function policyView(row: PolicyRow): ReimbursementPolicy {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    name: row.name,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveUntil: iso(row.effectiveUntil),
    rateEurPerKwh: row.rateEurPerKwh,
    currency: "EUR",
    rounding: "per-session-half-up-to-cent",
    createdAt: iso(row.createdAt),
  };
}
function interval(from: unknown, until: unknown) {
  const normalized = normalizeObservationPolicy({
    policyId: "period",
    version: "1",
    driverAlias: "period",
    stationId: "period",
    rateEurPerKwh: "1",
    effectiveFrom: textValue(from, 40),
    effectiveUntil: textValue(until, 40),
  });
  return { from: new Date(normalized.effectiveFrom), until: new Date(normalized.effectiveUntil) };
}
function columnMapping(value: unknown): SessionColumnMapping {
  const body = objectInput(value, [
    "sessionId",
    "stationId",
    "startedAt",
    "endedAt",
    "energy",
    "driverAlias",
    "energyUnit",
    "decimalSeparator",
  ]);
  if (
    !["kWh", "Wh"].includes(String(body.energyUnit)) ||
    ![".", ","].includes(String(body.decimalSeparator))
  )
    throw new HttpError(400, "Declare the CSV units and decimal separator");
  return {
    sessionId: textValue(body.sessionId, 120),
    stationId: textValue(body.stationId, 120),
    startedAt: textValue(body.startedAt, 120),
    endedAt: textValue(body.endedAt, 120),
    energy: textValue(body.energy, 120),
    driverAlias: body.driverAlias === null ? null : textValue(body.driverAlias, 120),
    energyUnit: body.energyUnit as "Wh" | "kWh",
    decimalSeparator: body.decimalSeparator as "." | ",",
  };
}

export interface ReimbursementContext {
  organization: ServiceOrganization;
  actorId: string;
  mfaEnabled: boolean;
}

const APPROVAL_TOTP_MAX_FAILURES = 10;
const APPROVAL_TOTP_LOCK_MS = 15 * 60_000;

export async function handleReimbursements(
  request: Request,
  env: ServiceEnv,
  context: ReimbursementContext,
  path: string,
): Promise<Response> {
  try {
    return await handle(request, env, context, path);
  } catch (error) {
    if (error instanceof ObservationInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

async function handle(
  request: Request,
  env: ServiceEnv,
  { organization: org, actorId, mfaEnabled }: ReimbursementContext,
  path: string,
): Promise<Response> {
  const db = drizzle(env.SERVICE_DB);
  const finance = org.role === "admin" || org.role === "finance";
  const now = new Date(),
    nowMs = now.getTime();
  const guard =
    "EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ? AND role IN ('admin','finance'))";
  const adminGuard =
    "EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ? AND role = 'admin')";
  const q = (sql: string, ...args: (string | number | null)[]) =>
    env.SERVICE_DB.prepare(sql).bind(...args);

  async function assignments(): Promise<ReimbursementAssignment[]> {
    const rows = await db
      .select({ record: assignmentTable, end: endTable.effectiveUntil, employeeName: user.name })
      .from(assignmentTable)
      .innerJoin(user, eq(assignmentTable.employeeId, user.id))
      .leftJoin(endTable, eq(endTable.assignmentId, assignmentTable.id))
      .where(
        finance
          ? eq(assignmentTable.organizationId, org.id)
          : and(
              eq(assignmentTable.organizationId, org.id),
              eq(assignmentTable.employeeId, actorId),
            ),
      );
    return rows.map(({ record, end, employeeName }) => ({
      id: record.id,
      employeeId: record.employeeId,
      employeeName,
      driverAlias: record.driverAlias,
      stationAlias: record.stationAlias,
      vehicleAlias: record.vehicleAlias,
      cardAlias: record.cardAlias,
      costCenter: record.costCenter,
      policyVersionId: record.policyVersionId,
      effectiveFrom: iso(record.effectiveFrom),
      effectiveUntil: iso(end ?? record.effectiveUntil),
      originalUntil: iso(record.effectiveUntil),
      ended: end !== null,
    }));
  }
  async function findAssignment(id: string) {
    const result = (await assignments()).find((item) => item.id === id);
    if (!result) throw new HttpError(404, "Assignment not found");
    return result;
  }
  let financialCache: Promise<FinancialData> | undefined;
  function financialData() {
    return (financialCache ??= readFinancialData(env, org.id, actorId, finance));
  }
  async function statement(id: string): Promise<ReimbursementStatement> {
    return financialStatement(id, await financialData());
  }
  function correctionReason(value: unknown): ReimbursementCorrectionReason {
    if (
      typeof value !== "string" ||
      !["source-issue", "eligibility", "policy-rate", "duplicate", "needs-review"].includes(value)
    )
      throw new HttpError(400, "Choose a correction reason");
    return value as ReimbursementCorrectionReason;
  }
  async function correctionContext(
    previousId: string,
    reason: unknown,
    selectedPolicyVersionId: string,
    mode: "recalculate" | "void",
  ): Promise<ReimbursementCorrectionContext> {
    const previous = await statement(previousId);
    if (previous.status !== "approved")
      throw new HttpError(409, "Only an approved statement can be corrected");
    return {
      mode,
      reason: correctionReason(reason),
      rootStatementId: previous.rootStatementId,
      previousStatementId: previous.id,
      previousSnapshotSha256: previous.snapshotSha256,
      previousAdjustmentSha256: previous.adjustment?.sha256 ?? null,
      previousAmountCents: previous.amountCents,
      selectedPolicyVersionId,
    };
  }
  async function auditIfCreated(
    id: string,
    action: string,
    table: "reimbursement_policy" | "reimbursement_assignment" | "reimbursement_statement",
  ) {
    return q(
      `INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,id,? FROM ${table} WHERE id = ? AND organization_id = ?`,
      crypto.randomUUID(),
      org.id,
      actorId,
      action,
      nowMs,
      id,
      org.id,
    );
  }

  if (!path && request.method === "GET") {
    const ownAssignments = await assignments();
    const policies = await db
      .select()
      .from(policyTable)
      .where(eq(policyTable.organizationId, org.id));
    const employees = finance
      ? await db
          .select({ id: user.id, name: user.name })
          .from(membership)
          .innerJoin(user, eq(membership.userId, user.id))
          .where(eq(membership.organizationId, org.id))
      : [];
    const financialModel = await financialData();
    const result: ReimbursementWorkspaceData = {
      employees,
      assignments: ownAssignments,
      policies: policies
        .filter(
          (policy) =>
            finance ||
            ownAssignments.some((item) => item.policyVersionId === policy.id) ||
            financialModel.rows.some(
              (row) => row.snapshot.correction?.selectedPolicyVersionId === policy.id,
            ),
        )
        .map(policyView),
      statements: financialModel.rows.map((row) => financialSummary(row, financialModel)),
      ...financialJournal(financialModel),
    };
    return json(result);
  }
  const read = path.match(/^statements\/([a-zA-Z0-9_-]+)$/);
  if (read?.[1] && request.method === "GET") return json(await statement(read[1]));
  if (!finance) throw new HttpError(403, "Finance or organization administrator access required");

  const voiding = path.match(/^statements\/([a-zA-Z0-9_-]+)\/void-draft$/);
  if (voiding?.[1] && request.method === "POST") {
    const body = await input(request, ["snapshotSha256", "reason", "revisionOf"]);
    const previous = await statement(voiding[1]);
    if (body.snapshotSha256 !== previous.snapshotSha256)
      throw new HttpError(409, "Review the exact approved snapshot before requesting cancellation");
    if (!["source-issue", "eligibility", "duplicate"].includes(String(body.reason)))
      throw new HttpError(400, "Choose a source, eligibility or duplicate cancellation reason");
    const record = await findAssignment(previous.assignmentId);
    const context = await correctionContext(
      previous.id,
      body.reason,
      previous.snapshot.correction?.selectedPolicyVersionId ?? record.policyVersionId,
      "void",
    );
    const rootStatement = await statement(context.rootStatementId);
    const snapshot: ReimbursementSnapshot = {
      schemaVersion: 1,
      sourceAuthority: "finance-void-request",
      assignment: record,
      period: rootStatement.snapshot.period,
      policy: previous.snapshot.policy,
      sources: [],
      mapping: previous.snapshot.mapping,
      decisions: [],
      issues: [],
      omittedRecords: 0,
      includedEnergyWh: 0,
      expectedAmountCents: 0,
      counts: { included: 0, held: 0, duplicate: 0, excluded: 0 },
      correction: context,
    };
    const snapshotJson = JSON.stringify(snapshot),
      snapshotSha256 = await hashBytes(new TextEncoder().encode(snapshotJson));
    const revisionOf = body.revisionOf == null ? null : identifier(body.revisionOf);
    if (revisionOf) {
      const rejected = await statement(revisionOf);
      if (
        rejected.status !== "rejected" ||
        rejected.correctionOf !== previous.id ||
        rejected.correctionMode !== "void"
      )
        throw new HttpError(
          409,
          "Only a rejected cancellation for this predecessor can be revised",
        );
    }
    const draftKey = await hashBytes(
      new TextEncoder().encode(
        JSON.stringify(["void", context, record.effectiveUntil, revisionOf]),
      ),
    );
    const existing = (
      await db
        .select({ id: statementTable.id })
        .from(statementTable)
        .where(
          and(eq(statementTable.organizationId, org.id), eq(statementTable.draftKey, draftKey)),
        )
    )[0];
    if (existing) return json(await statement(existing.id));
    const id = crypto.randomUUID();
    await env.SERVICE_DB.batch([
      q(
        `INSERT OR IGNORE INTO reimbursement_statement (id,organization_id,employee_id,assignment_id,draft_key,period_from,period_until,assignment_until,status,snapshot_json,snapshot_sha256,amount_cents,energy_wh,included_records,held_records,invalid_records,revision_of,created_by,created_at)
        SELECT ?,?,?,?,?,?,?,?,'draft',?,?,0,0,0,0,0,?,?,? WHERE ${guard}
        AND EXISTS (SELECT 1 FROM reimbursement_statement p WHERE p.id=? AND p.organization_id=? AND p.status='approved' AND p.snapshot_sha256=? AND NOT EXISTS (SELECT 1 FROM reimbursement_adjustment WHERE previous_statement_id=p.id))
        AND EXISTS (SELECT 1 FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id=a.id WHERE a.id=? AND a.organization_id=? AND coalesce(e.effective_until,a.effective_until)=?)`,
        id,
        org.id,
        record.employeeId,
        record.id,
        draftKey,
        Date.parse(snapshot.period.from),
        Date.parse(snapshot.period.until),
        Date.parse(record.effectiveUntil),
        snapshotJson,
        snapshotSha256,
        revisionOf,
        actorId,
        nowMs,
        org.id,
        actorId,
        previous.id,
        org.id,
        previous.snapshotSha256,
        record.id,
        org.id,
        Date.parse(record.effectiveUntil),
      ),
      await auditIfCreated(id, "statement.correction-drafted", "reimbursement_statement"),
    ]);
    financialCache = undefined;
    const saved = (
      await db
        .select({ id: statementTable.id })
        .from(statementTable)
        .where(
          and(eq(statementTable.organizationId, org.id), eq(statementTable.draftKey, draftKey)),
        )
    )[0];
    if (!saved)
      throw new HttpError(409, "Statement or eligibility changed, or finance access ended");
    return json(await statement(saved.id), saved.id === id ? 201 : 200);
  }

  if (path === "policies" && request.method === "POST") {
    const body = await input(request, [
      "key",
      "version",
      "name",
      "effectiveFrom",
      "effectiveUntil",
      "rateEurPerKwh",
    ]);
    const key = identifier(body.key),
      version = identifier(body.version),
      name = textValue(body.name, 120);
    const normalized = normalizeObservationPolicy({
      policyId: key,
      version,
      driverAlias: "policy",
      stationId: "policy",
      effectiveFrom: textValue(body.effectiveFrom, 40),
      effectiveUntil: textValue(body.effectiveUntil, 40),
      rateEurPerKwh: textValue(body.rateEurPerKwh, 24),
    });
    const id = crypto.randomUUID();
    const results = await env.SERVICE_DB.batch([
      q(
        `INSERT OR IGNORE INTO reimbursement_policy (id,organization_id,key,version,name,effective_from,effective_until,rate_eur_per_kwh,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
        id,
        org.id,
        key,
        version,
        name,
        Date.parse(normalized.effectiveFrom),
        Date.parse(normalized.effectiveUntil),
        normalized.rateEurPerKwh,
        actorId,
        nowMs,
        org.id,
        actorId,
      ),
      await auditIfCreated(id, "policy.published", "reimbursement_policy"),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(409, "Policy version already exists or finance access ended");
    return json(
      policyView((await db.select().from(policyTable).where(eq(policyTable.id, id)))[0]!),
      201,
    );
  }
  if (path === "assignments" && request.method === "POST") {
    if (org.role !== "admin")
      throw new HttpError(403, "Organization administrator access required");
    const body = await input(request, [
      "employeeId",
      "driverAlias",
      "stationAlias",
      "vehicleAlias",
      "cardAlias",
      "costCenter",
      "policyVersionId",
      "effectiveFrom",
      "effectiveUntil",
    ]);
    const employeeId = identifier(body.employeeId),
      policyVersionId = identifier(body.policyVersionId);
    const driverAlias = identifier(body.driverAlias),
      stationAlias = identifier(body.stationAlias),
      vehicleAlias = identifier(body.vehicleAlias),
      cardAlias = identifier(body.cardAlias),
      costCenter = identifier(body.costCenter);
    if (!cardAlias.startsWith("card-"))
      throw new HttpError(
        400,
        "Use a non-secret card alias beginning with card-, never a raw RFID identifier",
      );
    const period = interval(body.effectiveFrom, body.effectiveUntil);
    const id = crypto.randomUUID();
    const results = await env.SERVICE_DB.batch([
      q(
        `INSERT INTO reimbursement_assignment (id,organization_id,employee_id,driver_alias,station_alias,vehicle_alias,card_alias,cost_center,policy_version_id,effective_from,effective_until,created_by,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${adminGuard}
        AND EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ?)
        AND EXISTS (SELECT 1 FROM reimbursement_policy WHERE id = ? AND organization_id = ? AND effective_from <= ? AND effective_until >= ?)
        AND NOT EXISTS (SELECT 1 FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id = a.id WHERE a.organization_id = ? AND a.station_alias = ? AND (a.employee_id = ? OR a.driver_alias = ?) AND a.effective_from < ? AND coalesce(e.effective_until,a.effective_until) > ?)`,
        id,
        org.id,
        employeeId,
        driverAlias,
        stationAlias,
        vehicleAlias,
        cardAlias,
        costCenter,
        policyVersionId,
        period.from.getTime(),
        period.until.getTime(),
        actorId,
        nowMs,
        org.id,
        actorId,
        org.id,
        employeeId,
        policyVersionId,
        org.id,
        period.from.getTime(),
        period.until.getTime(),
        org.id,
        stationAlias,
        employeeId,
        driverAlias,
        period.until.getTime(),
        period.from.getTime(),
      ),
      await auditIfCreated(id, "assignment.created", "reimbursement_assignment"),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(
        409,
        "Member/policy unavailable, dates outside policy, assignment overlap, or administration ended",
      );
    return json(await findAssignment(id), 201);
  }
  const ending = path.match(/^assignments\/([a-zA-Z0-9_-]+)\/end$/);
  if (ending?.[1] && request.method === "POST") {
    if (org.role !== "admin")
      throw new HttpError(403, "Organization administrator access required");
    const record = await findAssignment(ending[1]);
    const body = await input(request, ["effectiveUntil"]);
    const period = interval(record.effectiveFrom, body.effectiveUntil);
    if (period.until > new Date(record.originalUntil))
      throw new HttpError(400, "Ending an assignment cannot extend its original period");
    if (record.ended) {
      if (record.effectiveUntil === iso(period.until)) return json(record);
      throw new HttpError(409, "Assignment already ended; its history is immutable");
    }
    const results = await env.SERVICE_DB.batch([
      q(
        `INSERT OR IGNORE INTO reimbursement_assignment_end (assignment_id,effective_until,created_by,created_at) SELECT ?,?,?,? WHERE ${adminGuard}`,
        record.id,
        period.until.getTime(),
        actorId,
        nowMs,
        org.id,
        actorId,
      ),
      q(
        "INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,'assignment.ended',assignment_id,? FROM reimbursement_assignment_end WHERE assignment_id = ? AND created_by = ? AND created_at = ? AND changes() = 1",
        crypto.randomUUID(),
        org.id,
        actorId,
        nowMs,
        record.id,
        actorId,
        nowMs,
      ),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(409, "Assignment changed or administration ended");
    return json(await findAssignment(record.id));
  }
  if (path === "statements" && request.method === "POST") {
    const body = await input(request, [
      "assignmentId",
      "periodFrom",
      "periodUntil",
      "csvBase64",
      "mapping",
      "revisionOf",
      "driverDeclarationConfirmed",
      "correctionOf",
      "correctionReason",
      "correctionPolicyVersionId",
    ]);
    const record = await findAssignment(identifier(body.assignmentId));
    const period = interval(body.periodFrom, body.periodUntil);
    if (period.until > now)
      throw new HttpError(400, "Choose a closed statement period ending no later than now");
    if (
      period.from < new Date(record.effectiveFrom) ||
      period.until > new Date(record.effectiveUntil)
    )
      throw new HttpError(400, "Statement period must fit the current assignment");
    const previousId =
      body.correctionOf === null || body.correctionOf === undefined
        ? null
        : identifier(body.correctionOf);
    if (!previousId && (body.correctionReason || body.correctionPolicyVersionId))
      throw new HttpError(400, "A correction policy or reason requires an approved predecessor");
    const selectedPolicyId =
      previousId && body.correctionPolicyVersionId
        ? identifier(body.correctionPolicyVersionId)
        : record.policyVersionId;
    const correction = previousId
      ? await correctionContext(previousId, body.correctionReason, selectedPolicyId, "recalculate")
      : undefined;
    if (correction) {
      const rootStatement = await statement(correction.rootStatementId);
      if (
        rootStatement.employeeId !== record.employeeId ||
        rootStatement.snapshot.assignment.stationAlias !== record.stationAlias ||
        period.from < new Date(rootStatement.periodFrom) ||
        period.until > new Date(rootStatement.periodUntil)
      )
        throw new HttpError(
          400,
          "Correction must preserve the employee/station identity and fit the original financial period",
        );
    }
    const policyRow = (
      await db
        .select()
        .from(policyTable)
        .where(and(eq(policyTable.id, selectedPolicyId), eq(policyTable.organizationId, org.id)))
    )[0];
    if (
      !policyRow ||
      period.from < policyRow.effectiveFrom ||
      period.until > policyRow.effectiveUntil
    )
      throw new HttpError(400, "The selected published policy must cover the correction period");
    const mapping = columnMapping(body.mapping);
    if (!mapping.driverAlias && body.driverDeclarationConfirmed !== true)
      throw new HttpError(
        400,
        "Explicitly confirm assignment of every source record when no employee column is mapped",
      );
    if (
      typeof body.csvBase64 !== "string" ||
      body.csvBase64.length > 350000 ||
      !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(body.csvBase64)
    )
      throw new HttpError(400, "Choose a UTF-8 CSV no larger than 256 KiB");
    const bytes = Uint8Array.from(atob(body.csvBase64), (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 262144)
      throw new HttpError(400, "Choose a non-empty CSV no larger than 256 KiB");
    const sha256 = await fingerprintObservationSource(bytes);
    let csvText: string;
    try {
      csvText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new HttpError(400, "CSV must use UTF-8");
    }
    const csv = parseObservationCsv(csvText);
    if (csv.rows.length > 500)
      throw new HttpError(400, "A statement supports at most 500 source records");
    const imported = mapObservationSessions(
      csv,
      mapping,
      { sha256, format: "csv", label: "Selected session export" },
      record.driverAlias,
    );
    const policy = normalizeObservationPolicy({
      policyId: policyRow.key,
      version: policyRow.version,
      driverAlias: record.driverAlias,
      stationId: record.stationAlias,
      effectiveFrom: iso(policyRow.effectiveFrom),
      effectiveUntil: iso(policyRow.effectiveUntil),
      rateEurPerKwh: policyRow.rateEurPerKwh,
    });
    const result = calculateReimbursementObservation([imported], {
      ...policy,
      effectiveFrom: iso(period.from),
      effectiveUntil: iso(period.until),
    });
    const decisions = result.decisions.filter(
      (item) =>
        item.session.driverAlias === record.driverAlias &&
        item.session.stationId === record.stationAlias &&
        Date.parse(item.session.endedAt) > period.from.getTime() &&
        Date.parse(item.session.startedAt) < period.until.getTime(),
    );
    const counts = { included: 0, held: 0, duplicate: 0, excluded: 0 };
    for (const decision of decisions) counts[decision.status]++;
    const snapshot: ReimbursementSnapshot = {
      schemaVersion: 1,
      sourceAuthority: "user-supplied-csv",
      assignment: record,
      period: { from: iso(period.from), until: iso(period.until) },
      policy,
      sources: result.sources,
      mapping,
      decisions,
      issues: result.issues,
      omittedRecords: result.decisions.length - decisions.length,
      includedEnergyWh: result.includedEnergyWh,
      expectedAmountCents: result.expectedAmountCents,
      counts,
      ...(correction ? { correction } : {}),
    };
    const snapshotJson = JSON.stringify(snapshot),
      snapshotSha256 = await hashBytes(new TextEncoder().encode(snapshotJson));
    const revisionOf =
      body.revisionOf === null || body.revisionOf === undefined
        ? null
        : identifier(body.revisionOf);
    if (revisionOf) {
      const old = await statement(revisionOf);
      if (
        old.status !== "rejected" ||
        old.employeeId !== record.employeeId ||
        old.assignmentId !== record.id ||
        old.correctionOf !== previousId
      )
        throw new HttpError(409, "Only a rejected statement for this assignment can be revised");
    }
    const draftKey = await hashBytes(
      new TextEncoder().encode(
        JSON.stringify([
          record.id,
          record.effectiveUntil,
          record.policyVersionId,
          iso(period.from),
          iso(period.until),
          sha256,
          mapping,
          revisionOf,
          ...(correction ? [correction] : []),
        ]),
      ),
    );
    const existing = (
      await db
        .select({ id: statementTable.id })
        .from(statementTable)
        .where(
          and(eq(statementTable.organizationId, org.id), eq(statementTable.draftKey, draftKey)),
        )
    )[0];
    if (existing) return json(await statement(existing.id));
    const id = crypto.randomUUID();
    await env.SERVICE_DB.batch([
      q(
        `INSERT OR IGNORE INTO reimbursement_statement (id,organization_id,employee_id,assignment_id,draft_key,period_from,period_until,assignment_until,status,snapshot_json,snapshot_sha256,amount_cents,energy_wh,included_records,held_records,invalid_records,revision_of,created_by,created_at)
        SELECT ?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id = a.id WHERE a.id = ? AND a.organization_id = ? AND coalesce(e.effective_until,a.effective_until) = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM reimbursement_statement p WHERE p.id=? AND p.organization_id=? AND p.status='approved' AND p.snapshot_sha256=? AND NOT EXISTS (SELECT 1 FROM reimbursement_adjustment WHERE previous_statement_id=p.id)))`,
        id,
        org.id,
        record.employeeId,
        record.id,
        draftKey,
        period.from.getTime(),
        period.until.getTime(),
        Date.parse(record.effectiveUntil),
        snapshotJson,
        snapshotSha256,
        result.expectedAmountCents,
        result.includedEnergyWh,
        counts.included,
        counts.held,
        result.issues.length,
        revisionOf,
        actorId,
        nowMs,
        org.id,
        actorId,
        record.id,
        org.id,
        Date.parse(record.effectiveUntil),
        previousId,
        previousId,
        org.id,
        correction?.previousSnapshotSha256 ?? null,
      ),
      await auditIfCreated(
        id,
        correction ? "statement.correction-drafted" : "statement.drafted",
        "reimbursement_statement",
      ),
    ]);
    financialCache = undefined;
    const saved = (
      await db
        .select({ id: statementTable.id })
        .from(statementTable)
        .where(
          and(eq(statementTable.organizationId, org.id), eq(statementTable.draftKey, draftKey)),
        )
    )[0];
    if (!saved)
      throw new HttpError(409, "Assignment changed or finance access ended; create a fresh draft");
    return json(await statement(saved.id), saved.id === id ? 201 : 200);
  }
  const review = path.match(/^statements\/([a-zA-Z0-9_-]+)\/(approve|reject)$/);
  if (review?.[1] && request.method === "POST") {
    const saved = await statement(review[1]);
    if (saved.employeeId === actorId)
      throw new HttpError(
        403,
        "A different finance reviewer must review this employee's statement",
      );
    if (review[2] === "approve") {
      const body = await input(request, [
        "snapshotSha256",
        "authenticatorCode",
        "previousSnapshotSha256",
      ]);
      if (body.snapshotSha256 !== saved.snapshotSha256)
        throw new HttpError(409, "Review the exact current statement snapshot before approval");
      if (!mfaEnabled)
        throw new HttpError(403, "Enable authenticator MFA before approving statements");
      if (saved.status === "approved") return json(saved);
      const correction = saved.snapshot.correction;
      if (saved.createdBy === actorId)
        throw new HttpError(
          403,
          correction
            ? "A different person must approve this correction draft"
            : "A different finance reviewer must approve the draft you created",
        );
      if (correction && body.previousSnapshotSha256 !== correction.previousSnapshotSha256)
        throw new HttpError(
          409,
          "Review both the original and replacement snapshot hashes before applying an adjustment",
        );
      if (typeof body.authenticatorCode !== "string" || !/^[0-9]{6}$/.test(body.authenticatorCode))
        throw new HttpError(403, "Enter a current authenticator code to approve this statement");
      // Better Auth applies its lockout only to sign-in verification, and server-side
      // auth.api calls skip its HTTP rate limiter. Reserve each step-up attempt atomically on
      // the same two_factor counter before verifying, so a stolen session cannot brute-force
      // the six-digit code: the attempt that reaches the limit sets the lock itself.
      const reserved = await q(
        `UPDATE two_factor SET
          failed_verification_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= ? THEN 1 ELSE coalesce(failed_verification_count,0) + 1 END,
          locked_until = CASE
            WHEN locked_until IS NOT NULL AND locked_until <= ? THEN NULL
            WHEN coalesce(failed_verification_count,0) + 1 >= ${APPROVAL_TOTP_MAX_FAILURES} THEN ?
            ELSE locked_until END
        WHERE user_id = ? AND verified = 1
          AND (locked_until IS NULL OR locked_until <= ?)
          AND (coalesce(failed_verification_count,0) < ${APPROVAL_TOTP_MAX_FAILURES} OR locked_until IS NOT NULL)
        RETURNING id`,
        nowMs,
        nowMs,
        nowMs + APPROVAL_TOTP_LOCK_MS,
        actorId,
        nowMs,
      ).all();
      if (reserved.results.length !== 1)
        throw new HttpError(
          429,
          "Too many authenticator attempts; wait 15 minutes before approving again",
        );
      try {
        await createServiceAuth(env).api.verifyTOTP({
          headers: request.headers,
          body: { code: body.authenticatorCode, trustDevice: false },
        });
      } catch {
        throw new HttpError(403, "Authenticator code is invalid");
      }
      await q(
        "UPDATE two_factor SET failed_verification_count = 0, locked_until = NULL WHERE user_id = ?",
        actorId,
      ).run();
      if (
        saved.status !== "draft" ||
        saved.heldRecords ||
        saved.invalidRecords ||
        saved.eligibilityChanged ||
        (saved.snapshot.counts.included === 0 && correction?.mode !== "void")
      )
        throw new HttpError(
          409,
          "Statement is not approvable: resolve holds/source issues, review eligibility, or create a fresh draft",
        );
      if (correction) {
        const previous = await statement(correction.previousStatementId);
        if (
          previous.status !== "approved" ||
          previous.supersededBy ||
          previous.snapshotSha256 !== correction.previousSnapshotSha256 ||
          (previous.adjustment?.sha256 ?? null) !== correction.previousAdjustmentSha256
        )
          throw new HttpError(
            409,
            "Correction predecessor changed; review the current approved statement",
          );
        const receipt: ReimbursementAdjustmentReceipt = {
          schemaVersion: 1,
          kind: "reimbursement-adjustment",
          id: crypto.randomUUID(),
          rootStatementId: correction.rootStatementId,
          previousStatementId: previous.id,
          replacementStatementId: saved.id,
          previousSnapshotSha256: previous.snapshotSha256,
          replacementSnapshotSha256: saved.snapshotSha256,
          previousAdjustmentSha256: correction.previousAdjustmentSha256,
          previousAmountCents: previous.amountCents,
          replacementAmountCents: saved.amountCents,
          differenceCents: Number(BigInt(saved.amountCents) - BigInt(previous.amountCents)),
          reason: correction.reason,
          mode: correction.mode,
          approvedBy: actorId,
          approvedAt: iso(now),
        };
        const receiptJson = JSON.stringify(receipt),
          receiptSha256 = await hashBytes(new TextEncoder().encode(receiptJson));
        const results = await env.SERVICE_DB.batch([
          q(
            `INSERT OR IGNORE INTO reimbursement_adjustment (id,organization_id,employee_id,root_statement_id,previous_statement_id,replacement_statement_id,receipt_json,receipt_sha256,difference_cents,created_by,created_at)
            SELECT ?,s.organization_id,s.employee_id,?,p.id,s.id,?,?,?,?,? FROM reimbursement_statement s JOIN reimbursement_statement p ON p.id=? AND p.organization_id=s.organization_id
            WHERE s.id=? AND s.organization_id=? AND s.status='draft' AND p.status='approved' AND s.employee_id=p.employee_id AND s.employee_id!=? AND s.created_by!=?
            AND p.snapshot_sha256=? AND s.snapshot_sha256=? AND p.amount_cents=? AND s.amount_cents=? AND s.held_records=0 AND s.invalid_records=0 AND (s.included_records>0 OR json_extract(s.snapshot_json,'$.correction.mode')='void')
            AND ${guard} AND EXISTS (SELECT 1 FROM user WHERE id=? AND two_factor_enabled=1)
            AND EXISTS (SELECT 1 FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id=a.id WHERE a.id=s.assignment_id AND a.organization_id=s.organization_id AND coalesce(e.effective_until,a.effective_until)=s.assignment_until)
            AND NOT EXISTS (SELECT 1 FROM reimbursement_adjustment WHERE previous_statement_id=p.id)
            AND coalesce((SELECT receipt_sha256 FROM reimbursement_adjustment WHERE replacement_statement_id=p.id),'')=?
            AND NOT EXISTS (SELECT 1 FROM reimbursement_claim c,json_each(s.snapshot_json,'$.decisions') candidate WHERE c.organization_id=s.organization_id AND c.station_alias=json_extract(candidate.value,'$.session.stationId') AND c.session_id=json_extract(candidate.value,'$.session.sessionId') AND json_extract(candidate.value,'$.status')='included' AND c.statement_id!=?)`,
            receipt.id,
            receipt.rootStatementId,
            receiptJson,
            receiptSha256,
            receipt.differenceCents,
            actorId,
            nowMs,
            previous.id,
            saved.id,
            org.id,
            actorId,
            actorId,
            previous.snapshotSha256,
            saved.snapshotSha256,
            previous.amountCents,
            saved.amountCents,
            org.id,
            actorId,
            actorId,
            correction.previousAdjustmentSha256 ?? "",
            receipt.rootStatementId,
          ),
          q(
            `INSERT INTO reimbursement_claim (organization_id,station_alias,session_id,statement_id)
            SELECT s.organization_id,json_extract(line.value,'$.session.stationId'),json_extract(line.value,'$.session.sessionId'),? FROM reimbursement_statement s,json_each(s.snapshot_json,'$.decisions') line WHERE s.id=? AND s.organization_id=? AND json_extract(line.value,'$.status')='included' AND EXISTS (SELECT 1 FROM reimbursement_adjustment WHERE id=?)
            AND NOT EXISTS (SELECT 1 FROM reimbursement_claim c WHERE c.organization_id=s.organization_id AND c.station_alias=json_extract(line.value,'$.session.stationId') AND c.session_id=json_extract(line.value,'$.session.sessionId'))`,
            receipt.rootStatementId,
            saved.id,
            org.id,
            receipt.id,
          ),
          q(
            "UPDATE reimbursement_statement SET status='approved',reviewed_by=?,reviewed_at=? WHERE id=? AND organization_id=? AND status='draft' AND EXISTS (SELECT 1 FROM reimbursement_adjustment WHERE id=?)",
            actorId,
            nowMs,
            saved.id,
            org.id,
            receipt.id,
          ),
          q(
            "INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,'statement.adjusted',replacement_statement_id,? FROM reimbursement_adjustment WHERE id=?",
            crypto.randomUUID(),
            org.id,
            actorId,
            nowMs,
            receipt.id,
          ),
        ]);
        financialCache = undefined;
        const current = await statement(saved.id);
        if (results[2]?.meta.changes !== 1 && current.status !== "approved")
          throw new HttpError(
            409,
            "Adjustment blocked by a stale predecessor, session reservation, eligibility change or ended reviewer access",
          );
        return json(current);
      }
      const eligible = `s.id = ? AND s.organization_id = ? AND s.status = 'draft' AND s.employee_id != ? AND s.created_by != ? AND s.held_records = 0 AND s.invalid_records = 0 AND s.included_records > 0 AND ${guard} AND EXISTS (SELECT 1 FROM user WHERE id = ? AND two_factor_enabled = 1) AND EXISTS (SELECT 1 FROM reimbursement_assignment a LEFT JOIN reimbursement_assignment_end e ON e.assignment_id = a.id WHERE a.id = s.assignment_id AND a.organization_id = s.organization_id AND coalesce(e.effective_until,a.effective_until) = s.assignment_until)`;
      const results = await env.SERVICE_DB.batch([
        q(
          `INSERT INTO reimbursement_claim (organization_id,station_alias,session_id,statement_id)
          SELECT s.organization_id,json_extract(line.value,'$.session.stationId'),json_extract(line.value,'$.session.sessionId'),s.id FROM reimbursement_statement s, json_each(s.snapshot_json,'$.decisions') line WHERE ${eligible} AND json_extract(line.value,'$.status') = 'included'
          AND NOT EXISTS (SELECT 1 FROM reimbursement_claim c, json_each(s.snapshot_json,'$.decisions') candidate WHERE c.organization_id = s.organization_id AND c.station_alias = json_extract(candidate.value,'$.session.stationId') AND c.session_id = json_extract(candidate.value,'$.session.sessionId') AND json_extract(candidate.value,'$.status') = 'included')`,
          saved.id,
          org.id,
          actorId,
          actorId,
          org.id,
          actorId,
          actorId,
        ),
        q(
          `UPDATE reimbursement_statement SET status = 'approved',reviewed_by = ?,reviewed_at = ? WHERE id = ? AND organization_id = ? AND status = 'draft' AND included_records = (SELECT count(*) FROM reimbursement_claim WHERE statement_id = reimbursement_statement.id) AND included_records > 0 AND ${guard}`,
          actorId,
          nowMs,
          saved.id,
          org.id,
          org.id,
          actorId,
        ),
        q(
          "INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,'statement.approved',id,? FROM reimbursement_statement WHERE id = ? AND organization_id = ? AND reviewed_by = ? AND reviewed_at = ? AND status = 'approved' AND changes() = 1",
          crypto.randomUUID(),
          org.id,
          actorId,
          nowMs,
          saved.id,
          org.id,
          actorId,
          nowMs,
        ),
      ]);
      financialCache = undefined;
      const current = await statement(saved.id);
      if (results[1]?.meta.changes !== 1 && current.status !== "approved")
        throw new HttpError(
          409,
          "Approval blocked: session already approved, eligibility changed, or reviewer access ended",
        );
      return json(current);
    }
    const body = await input(request, ["snapshotSha256", "reason"]);
    if (body.snapshotSha256 !== saved.snapshotSha256)
      throw new HttpError(409, "Review the exact current statement snapshot before rejection");
    if (
      typeof body.reason !== "string" ||
      !["source-issue", "eligibility", "policy-rate", "duplicate", "needs-review"].includes(
        body.reason,
      )
    )
      throw new HttpError(400, "Choose a rejection reason");
    const results = await env.SERVICE_DB.batch([
      q(
        `UPDATE reimbursement_statement SET status = 'rejected',reviewed_by = ?,reviewed_at = ?,rejection_reason = ? WHERE id = ? AND organization_id = ? AND status = 'draft' AND employee_id != ? AND ${guard}`,
        actorId,
        nowMs,
        body.reason,
        saved.id,
        org.id,
        actorId,
        org.id,
        actorId,
      ),
      q(
        "INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,'statement.rejected',id,? FROM reimbursement_statement WHERE id = ? AND organization_id = ? AND reviewed_by = ? AND reviewed_at = ? AND status = 'rejected' AND changes() = 1",
        crypto.randomUUID(),
        org.id,
        actorId,
        nowMs,
        saved.id,
        org.id,
        actorId,
        nowMs,
      ),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(409, "Statement already reviewed or finance access ended");
    financialCache = undefined;
    return json(await statement(saved.id));
  }
  throw new HttpError(404, "Not found");
}
