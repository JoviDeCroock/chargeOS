import type { ServiceEnv } from "./auth.js";
import type {
  ServiceOrganization,
  SupportCaseSummary,
  SupportCaseDetail,
  SupportWorkspaceData,
  SupportAction,
  OrganizationRole,
} from "../shared/contracts.js";
import { hashBytes, HttpError, input, json, objectInput } from "./http.js";
import {
  supportFingerprint,
  supportId,
  supportPayload,
  supportTransition,
} from "./support-domain.js";

const pageSize = 50;
const uuid = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  )
    throw new HttpError(400, "Use a fresh case update identifier");
  return value;
};
interface CaseRow {
  id: string;
  organization_id: string;
  reporter_id: string;
  assignee_id: string;
  subject: string;
  topic: SupportCaseSummary["topic"];
  statement_id: string | null;
  statement_sha256: string | null;
  status: SupportCaseSummary["status"];
  revision: number;
  created_at: number;
  updated_at: number;
  reporter_name: string;
  assignee_name: string;
  available: number;
  actor_role: OrganizationRole;
}
interface EventRow {
  id: string;
  case_id: string;
  actor_id: string;
  actor_role: OrganizationRole;
  actor_name: string;
  revision: number;
  action: SupportAction;
  payload_json: string;
  request_sha256: string;
  created_at: number;
}
const visibility =
  "EXISTS(SELECT 1 FROM membership viewer WHERE viewer.organization_id=c.organization_id AND viewer.user_id=? AND (viewer.role IN('admin','finance') OR c.reporter_id=viewer.user_id))";
const caseSelect = `SELECT c.*,r.name AS reporter_name,a.name AS assignee_name,EXISTS(SELECT 1 FROM membership am WHERE am.organization_id=c.organization_id AND am.user_id=c.assignee_id AND am.role IN('admin','finance')) AS available,(SELECT role FROM membership WHERE organization_id=c.organization_id AND user_id=?) AS actor_role FROM support_case c JOIN user r ON r.id=c.reporter_id JOIN user a ON a.id=c.assignee_id`;
const summary = (row: CaseRow): SupportCaseSummary => ({
  id: row.id,
  subject: row.subject,
  topic: row.topic,
  status: row.status,
  revision: row.revision,
  reporter: { id: row.reporter_id, name: row.reporter_name },
  assignee: { id: row.assignee_id, name: row.assignee_name, available: !!row.available },
  statement: row.statement_id
    ? { id: row.statement_id, snapshotSha256: row.statement_sha256! }
    : null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function handleSupport(
  request: Request,
  env: ServiceEnv,
  organization: ServiceOrganization,
  actorId: string,
  child: string,
): Promise<Response> {
  const db = env.SERVICE_DB,
    org = organization.id,
    url = new URL(request.url);
  async function detail(id: string): Promise<SupportCaseDetail> {
    const beforeText = url.searchParams.get("eventsBefore"),
      before = beforeText === null ? 2147483647 : Number(beforeText);
    if (!Number.isSafeInteger(before) || before < 1 || before > 2147483647)
      throw new HttpError(400, "Invalid case history page");
    const [cases, events] = await db.batch([
      db
        .prepare(`${caseSelect} WHERE c.id=? AND c.organization_id=? AND ${visibility}`)
        .bind(actorId, id, org, actorId),
      db
        .prepare(
          `SELECT e.*,u.name AS actor_name FROM support_event e JOIN support_case c ON c.id=e.case_id JOIN user u ON u.id=e.actor_id WHERE c.id=? AND c.organization_id=? AND e.organization_id=c.organization_id AND e.revision<? AND ${visibility} ORDER BY e.revision DESC LIMIT 51`,
        )
        .bind(id, org, before, actorId),
    ]);
    const c = cases!.results[0] as unknown as CaseRow | undefined;
    if (!c) throw new HttpError(404, "Case not found or access ended");
    const rows = events!.results.slice(0, pageSize) as unknown as EventRow[];
    return {
      case: summary(c),
      events: rows.reverse().map((e) => {
        const p = supportPayload(e.action, JSON.parse(e.payload_json));
        return {
          id: e.id,
          revision: e.revision,
          action: e.action,
          actor: { id: e.actor_id, name: e.actor_name, role: e.actor_role },
          message: p.message ?? null,
          assigneeId: p.assigneeId ?? null,
          resolution: (p.resolution ?? null) as SupportCaseDetail["events"][number]["resolution"],
          createdAt: new Date(e.created_at).toISOString(),
        };
      }),
      olderBefore: events!.results.length > pageSize ? rows[0]!.revision : null,
    };
  }
  if (!child && request.method === "GET") {
    const beforeTime = url.searchParams.get("beforeTime"),
      beforeId = url.searchParams.get("beforeId");
    if ((beforeTime === null) !== (beforeId === null))
      throw new HttpError(400, "Use a complete case page cursor");
    const before = beforeTime === null ? Number.MAX_SAFE_INTEGER : Number(beforeTime);
    if (!Number.isSafeInteger(before) || before < 0) throw new HttpError(400, "Invalid case page");
    if (beforeId !== null) supportId(beforeId);
    const [cases, assignees] = await db.batch([
      db
        .prepare(
          `${caseSelect} WHERE c.organization_id=? AND (c.created_at<? OR (c.created_at=? AND c.id<?)) AND ${visibility} ORDER BY c.created_at DESC,c.id DESC LIMIT 51`,
        )
        .bind(actorId, org, before, before, beforeId ?? "", actorId),
      db
        .prepare(
          "SELECT u.id,u.name FROM membership m JOIN user u ON u.id=m.user_id WHERE m.organization_id=? AND m.role IN('admin','finance') AND EXISTS(SELECT 1 FROM membership viewer WHERE viewer.organization_id=m.organization_id AND viewer.user_id=? AND viewer.role IN('admin','finance')) ORDER BY u.name,u.id",
        )
        .bind(org, actorId),
    ]);
    const rows = cases!.results.slice(0, pageSize) as unknown as CaseRow[],
      last = rows.at(-1);
    return json({
      cases: rows.map(summary),
      nextBefore:
        cases!.results.length > pageSize && last
          ? { createdAt: last.created_at, id: last.id }
          : null,
      assignees: assignees!.results as unknown as SupportWorkspaceData["assignees"],
    } satisfies SupportWorkspaceData);
  }
  const match = child.match(
    /^([a-zA-Z0-9_-]+)(?:\/(reply|assign|request-information|resolve|close|reopen))?$/,
  );
  if (match && !match[2] && request.method === "GET") return json(await detail(match[1]!));
  if (request.method !== "POST" || (child && !match?.[2]))
    throw new HttpError(404, "Case action not found");
  const action = (child ? match![2] : "created") as SupportAction,
    caseId = child ? match![1]! : crypto.randomUUID();
  const body = await input(request, [
    "mutationId",
    "expectedRevision",
    "subject",
    "topic",
    "statementId",
    "message",
    "assigneeId",
    "resolution",
    "confirmation",
  ]);
  const mutationId = uuid(body.mutationId);
  const expected = action === "created" ? 0 : body.expectedRevision;
  if (
    !Number.isSafeInteger(expected) ||
    Number(expected) < 0 ||
    Number(expected) >= 2147483646 ||
    (action !== "created" && Number(expected) < 1)
  )
    throw new HttpError(400, "Reload the case before updating it");
  const supplied = { ...body };
  delete supplied.mutationId;
  delete supplied.expectedRevision;
  if (action === "created" && body.expectedRevision !== undefined)
    throw new HttpError(400, "Unexpected case revision");
  let payload: Record<string, string | null>;
  if (action === "created") {
    // The client cannot nominate a reporter, initial owner or snapshot hash.
    objectInput(supplied, ["subject", "topic", "statementId", "message"]);
    if (Object.keys(supplied).length !== 4) throw new HttpError(400, "Complete all case fields");
    payload = supportPayload(action, {
      ...supplied,
      statementSha256: body.statementId === null ? null : "0".repeat(64),
      assigneeId: actorId,
    });
  } else payload = supportPayload(action, supplied);
  const fingerprint = await supportFingerprint(
    org,
    actorId,
    caseId,
    action,
    Number(expected),
    payload,
  );
  const existing = await db
    .prepare(
      `SELECT e.case_id,e.request_sha256 FROM support_event e JOIN support_case c ON c.id=e.case_id WHERE e.id=? AND e.organization_id=? AND e.actor_id=? AND ${visibility}`,
    )
    .bind(mutationId, org, actorId, actorId)
    .first<{ case_id: string; request_sha256: string }>();
  if (existing) {
    if (existing.request_sha256 !== fingerprint)
      throw new HttpError(409, "This update identifier belongs to different case details");
    return json(await detail(existing.case_id));
  }
  let current: CaseRow | null = null;
  let role: OrganizationRole,
    reporterId = actorId,
    status: CaseRow["status"] = "open",
    assigned: string;
  if (action === "created") {
    const owner = await db
      .prepare(
        "SELECT m.role,o.created_by AS assignee FROM membership m JOIN organization o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND EXISTS(SELECT 1 FROM membership responsible WHERE responsible.organization_id=o.id AND responsible.user_id=o.created_by AND responsible.role='admin')",
      )
      .bind(org, actorId)
      .first<{ role: OrganizationRole; assignee: string }>();
    if (!owner) throw new HttpError(404, "Organization access ended");
    role = owner.role;
    assigned = owner.assignee;
    let sha: string | null = null;
    if (payload.statementId) {
      const s = await db
        .prepare(
          "SELECT snapshot_json,snapshot_sha256 FROM reimbursement_statement WHERE id=? AND organization_id=? AND employee_id=? AND EXISTS(SELECT 1 FROM membership WHERE organization_id=? AND user_id=?)",
        )
        .bind(payload.statementId, org, actorId, org, actorId)
        .first<{ snapshot_json: string; snapshot_sha256: string }>();
      if (!s) throw new HttpError(404, "Your statement was not found");
      if ((await hashBytes(new TextEncoder().encode(s.snapshot_json))) !== s.snapshot_sha256)
        throw new HttpError(409, "Statement integrity check failed");
      sha = s.snapshot_sha256;
    }
    payload = { ...payload, assigneeId: assigned, statementSha256: sha };
  } else {
    current = await db
      .prepare(`${caseSelect} WHERE c.id=? AND c.organization_id=? AND ${visibility}`)
      .bind(actorId, caseId, org, actorId)
      .first<CaseRow>();
    if (!current) throw new HttpError(404, "Case not found or access ended");
    if (current.revision !== expected)
      throw new HttpError(409, "This case changed. Reload it and review the latest update");
    role = current.actor_role;
    reporterId = current.reporter_id;
    const next = supportTransition(
      { status: current.status, assigneeId: current.assignee_id, reporterId },
      action,
      actorId,
      role,
      payload,
    );
    status = next.status;
    assigned = next.assigneeId;
  }
  const now = Date.now(),
    cutoff = now - 60000,
    rateKey = `support:${action === "created" ? "create" : "update"}:${org}:${actorId}`,
    maximum = action === "created" ? 5 : 20;
  const eventTime = Math.max(now, current?.updated_at ?? now);
  const payloadJson = JSON.stringify(payload),
    bytes = new TextEncoder().encode(payloadJson).length;
  // Bounded durable text for the pilot; refuse new content rather than deleting
  // history or silently exceeding the operational recovery contract.
  // Drivers get a personal quota and may not use the staff reserve, so one member cannot
  // exhaust the organization's pilot capacity and block staff from answering or closing cases.
  const driverQuota =
    role === "driver"
      ? " AND (SELECT count(*) FROM support_event WHERE organization_id=? AND actor_role='driver')<3072 AND (SELECT coalesce(sum(length(CAST(payload_json AS BLOB))),0) FROM support_event WHERE organization_id=? AND actor_role='driver') + ? <= 1572864 AND (SELECT count(*) FROM support_event WHERE organization_id=? AND actor_id=?)<512 AND (SELECT coalesce(sum(length(CAST(payload_json AS BLOB))),0) FROM support_event WHERE organization_id=? AND actor_id=?) + ? <= 262144"
      : "";
  const capacity = `(SELECT count(*) FROM support_event WHERE organization_id=?)<4096 AND (SELECT coalesce(sum(length(CAST(payload_json AS BLOB))),0) FROM support_event WHERE organization_id=?) + ? <= 2097152${driverQuota}`;
  const gate = `EXISTS(SELECT 1 FROM membership WHERE organization_id=? AND user_id=? AND role=?) AND EXISTS(SELECT 1 FROM rate_limit WHERE key=? AND count<=${maximum} AND last_request>?) AND ${capacity} AND NOT EXISTS(SELECT 1 FROM support_event WHERE id=?)`;
  const gateArgs = [
    org,
    actorId,
    role,
    rateKey,
    cutoff,
    org,
    org,
    bytes,
    ...(role === "driver" ? [org, org, bytes, org, actorId, org, actorId, bytes] : []),
    mutationId,
  ];
  const writes = [
    db
      .prepare(
        "DELETE FROM rate_limit WHERE id IN(SELECT id FROM rate_limit WHERE last_request<=? LIMIT 100)",
      )
      .bind(cutoff),
    db
      .prepare(
        "INSERT INTO rate_limit(id,key,count,last_request) SELECT ?,?,1,? WHERE EXISTS(SELECT 1 FROM membership WHERE organization_id=? AND user_id=?) AND ((SELECT count(*) FROM rate_limit)<4096 OR EXISTS(SELECT 1 FROM rate_limit WHERE key=?)) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END",
      )
      .bind(crypto.randomUUID(), rateKey, now, org, actorId, rateKey, cutoff, cutoff, now),
  ];
  if (action === "created") {
    writes.push(
      db
        .prepare(
          `INSERT INTO support_case(id,organization_id,reporter_id,assignee_id,subject,topic,statement_id,statement_sha256,status,revision,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'open',1,?,? WHERE ${gate} AND EXISTS(SELECT 1 FROM membership WHERE organization_id=? AND user_id=? AND role='admin') AND (? IS NULL OR EXISTS(SELECT 1 FROM reimbursement_statement WHERE id=? AND organization_id=? AND employee_id=? AND snapshot_sha256=?))`,
        )
        .bind(
          caseId,
          org,
          actorId,
          assigned,
          payload.subject,
          payload.topic,
          payload.statementId,
          payload.statementSha256,
          eventTime,
          eventTime,
          ...gateArgs,
          org,
          assigned,
          payload.statementId,
          payload.statementId,
          org,
          actorId,
          payload.statementSha256,
        ),
    );
    writes.push(
      db
        .prepare(
          "INSERT INTO support_event(id,organization_id,case_id,actor_id,actor_role,revision,action,payload_json,request_sha256,created_at) SELECT ?,?,?,?, ?,1,'created',?,?,? WHERE EXISTS(SELECT 1 FROM support_case WHERE id=? AND organization_id=? AND revision=1)",
        )
        .bind(mutationId, org, caseId, actorId, role, payloadJson, fingerprint, now, caseId, org),
    );
  } else {
    writes.push(
      db
        .prepare(
          `INSERT INTO support_event(id,organization_id,case_id,actor_id,actor_role,revision,action,payload_json,request_sha256,created_at) SELECT ?,?,?,?, ?,?,?,?,?,? FROM support_case c WHERE c.id=? AND c.organization_id=? AND c.revision=? AND c.status=? AND c.assignee_id=? AND ${gate} AND ${visibility} AND (?!='assign' OR EXISTS(SELECT 1 FROM membership WHERE organization_id=? AND user_id=? AND role IN('admin','finance')))`,
        )
        .bind(
          mutationId,
          org,
          caseId,
          actorId,
          role,
          Number(expected) + 1,
          action,
          payloadJson,
          fingerprint,
          eventTime,
          caseId,
          org,
          expected,
          current!.status,
          current!.assignee_id,
          ...gateArgs,
          actorId,
          action,
          org,
          assigned,
        ),
    );
    writes.push(
      db
        .prepare(
          "UPDATE support_case SET status=?,assignee_id=?,revision=revision+1,updated_at=? WHERE id=? AND organization_id=? AND revision=? AND EXISTS(SELECT 1 FROM support_event WHERE id=? AND case_id=? AND revision=?)",
        )
        .bind(
          status,
          assigned,
          eventTime,
          caseId,
          org,
          expected,
          mutationId,
          caseId,
          Number(expected) + 1,
        ),
    );
  }
  writes.push(
    db
      .prepare(
        "INSERT OR IGNORE INTO service_audit(id,organization_id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_event WHERE id=? AND case_id=? AND request_sha256=?)",
      )
      .bind(
        `support-${mutationId}`,
        org,
        actorId,
        `support.${action}`,
        caseId,
        eventTime,
        mutationId,
        caseId,
        fingerprint,
      ),
  );
  const results = await db.batch(writes);
  if (results[action === "created" ? 3 : 2]?.meta.changes !== 1) {
    // A concurrent exact retry may have won; never repeat its event or audit.
    const winner = await db
      .prepare(
        `SELECT e.case_id,e.request_sha256 FROM support_event e JOIN support_case c ON c.id=e.case_id WHERE e.id=? AND e.organization_id=? AND e.actor_id=? AND ${visibility}`,
      )
      .bind(mutationId, org, actorId, actorId)
      .first<{ case_id: string; request_sha256: string }>();
    if (winner?.request_sha256 === fingerprint) return json(await detail(winner.case_id));
    throw new HttpError(
      409,
      "Case update was not applied. Reload the case and check access, assignment and pilot limits before retrying",
    );
  }
  return json(await detail(caseId), action === "created" ? 201 : 200);
}
