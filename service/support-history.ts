import type { ServiceEnv } from "./auth.js";
import type { SupportAction, SupportStatus } from "../shared/support.js";
import { supportFingerprint, supportPayload, supportTransition } from "./support-domain.js";

/** Internal consistency, not external truth, identity or an independent audit
 * signature. Historical actors may legitimately have left the organization. */
export async function validateSupportHistory(env: Pick<ServiceEnv, "SERVICE_DB">): Promise<void> {
  const db = env.SERVICE_DB;
  const cases = await db
    .prepare("SELECT * FROM support_case ORDER BY organization_id,id")
    .all<Record<string, unknown>>();
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const c of cases.results) {
    const events = await db
      .prepare("SELECT * FROM support_event WHERE case_id=? ORDER BY revision")
      .bind(c.id)
      .all<Record<string, unknown>>();
    if (!events.results.length || events.results.length !== c.revision)
      throw new Error("Support history revision mismatch");
    let state: { status: SupportStatus; assigneeId: string; reporterId: string } | undefined,
      previousTime = 0;
    for (let i = 0; i < events.results.length; i++) {
      const e = events.results[i]!,
        action = e.action as SupportAction;
      if (
        e.organization_id !== c.organization_id ||
        e.revision !== i + 1 ||
        !["admin", "finance", "driver"].includes(e.actor_role as string) ||
        !Number.isSafeInteger(e.created_at) ||
        Number(e.created_at) < previousTime ||
        !/^[a-f0-9]{64}$/.test(e.request_sha256 as string) ||
        ![
          "created",
          "reply",
          "assign",
          "request-information",
          "resolve",
          "close",
          "reopen",
        ].includes(action)
      )
        throw new Error("Support history event mismatch");
      const payload = supportPayload(action, JSON.parse(e.payload_json as string));
      if (
        (await supportFingerprint(
          c.organization_id as string,
          e.actor_id as string,
          c.id as string,
          action,
          i,
          payload,
        )) !== e.request_sha256
      )
        throw new Error("Support request binding mismatch");
      if (
        payload.assigneeId &&
        !(await db.prepare("SELECT 1 FROM user WHERE id=?").bind(payload.assigneeId).first())
      )
        throw new Error("Support assignee history mismatch");
      if (JSON.stringify(payload) !== e.payload_json)
        throw new Error("Noncanonical support history payload");
      if (i === 0) {
        if (
          action !== "created" ||
          e.actor_id !== c.reporter_id ||
          payload.subject !== c.subject ||
          payload.topic !== c.topic ||
          payload.statementId !== c.statement_id ||
          payload.statementSha256 !== c.statement_sha256 ||
          e.created_at !== c.created_at
        )
          throw new Error("Support case origin mismatch");
        state = {
          status: "open",
          assigneeId: payload.assigneeId!,
          reporterId: c.reporter_id as string,
        };
        if (
          !(await db
            .prepare("SELECT 1 FROM organization WHERE id=? AND created_by=?")
            .bind(c.organization_id, payload.assigneeId)
            .first())
        )
          throw new Error("Support initial assignment mismatch");
      } else
        state = supportTransition(
          state!,
          action,
          e.actor_id as string,
          e.actor_role as string,
          payload,
        );
      const audit = await db
        .prepare(
          "SELECT 1 FROM service_audit WHERE id=? AND organization_id=? AND actor_id=? AND action=? AND subject_id=? AND created_at=?",
        )
        .bind(
          `support-${e.id}`,
          c.organization_id,
          e.actor_id,
          `support.${action}`,
          c.id,
          e.created_at,
        )
        .first();
      if (!audit) throw new Error("Support audit mismatch");
      previousTime = Number(e.created_at);
      const total = totals.get(c.organization_id as string) ?? { count: 0, bytes: 0 };
      total.count++;
      total.bytes += new TextEncoder().encode(e.payload_json as string).length;
      totals.set(c.organization_id as string, total);
      if (total.count > 4096 || total.bytes > 2097152)
        throw new Error("Support history exceeds pilot capacity");
    }
    if (
      state!.status !== c.status ||
      state!.assigneeId !== c.assignee_id ||
      previousTime !== c.updated_at
    )
      throw new Error("Support case projection mismatch");
    if (c.statement_id !== null) {
      const statement = await db
        .prepare(
          "SELECT 1 FROM reimbursement_statement WHERE id=? AND organization_id=? AND employee_id=? AND snapshot_sha256=?",
        )
        .bind(c.statement_id, c.organization_id, c.reporter_id, c.statement_sha256)
        .first();
      if (!statement) throw new Error("Support statement ownership mismatch");
    }
  }
  if (
    await db
      .prepare(
        "SELECT 1 FROM support_event e LEFT JOIN support_case c ON c.id=e.case_id WHERE c.id IS NULL OR e.organization_id!=c.organization_id LIMIT 1",
      )
      .first()
  )
    throw new Error("Orphaned support history");
  if (
    await db
      .prepare(
        "SELECT 1 FROM service_audit a LEFT JOIN support_event e ON a.id='support-'||e.id WHERE a.action GLOB 'support.*' AND (e.id IS NULL OR a.organization_id!=e.organization_id OR a.actor_id IS NULL OR a.actor_id!=e.actor_id OR a.action!='support.'||e.action OR a.subject_id!=e.case_id OR a.created_at!=e.created_at) LIMIT 1",
      )
      .first()
  )
    throw new Error("Orphaned support audit");
}
