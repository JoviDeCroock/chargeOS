import { HttpError, input, json, textValue } from "./http.js";
import { handleReimbursements } from "./reimbursements.js";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createServiceAuth, localConfiguration, type ServiceEnv } from "./auth.js";
import { invitation, membership, organization, user } from "./db/schema.js";
import type {
  OrganizationWorkspace,
  ServiceAccount,
  ServiceOrganization,
} from "../shared/contracts.js";

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const root = "/service/api/v1";

async function boundedBody(request: Request, limit: number): Promise<Request> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > limit) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request, { method: request.method, body: bytes });
}
async function hashToken(token: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function route(request: Request, env: ServiceEnv): Promise<Response> {
  const config = localConfiguration(env);
  const url = new URL(request.url);
  if (!config || !["127.0.0.1", "localhost"].includes(url.hostname))
    return json(
      { error: "Service is available only in its configured local development environment" },
      503,
    );
  if (!["GET", "POST", "DELETE"].includes(request.method))
    throw new HttpError(405, "Method not allowed");
  if (request.method !== "GET") {
    if (request.headers.get("origin") !== config.origin)
      throw new HttpError(403, "Use the configured service origin");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new HttpError(415, "Use application/json");
    request = await boundedBody(
      request,
      /^\/service\/api\/v1\/organizations\/[^/]+\/money\/statements$/.test(url.pathname)
        ? 524288
        : 32768,
    );
  }
  const auth = createServiceAuth(env);
  if (url.pathname.startsWith("/service/api/auth/")) return auth.handler(request);
  if (url.pathname === `${root}/health` && request.method === "GET")
    return json({
      mode: "local-development",
      delivery: "operator-only-local-outbox",
      chargerControl: false,
    });
  if (!url.pathname.startsWith(`${root}/`)) throw new HttpError(404, "Not found");
  const identity = await auth.api.getSession({ headers: request.headers });
  if (!identity) throw new HttpError(401, "Sign in to continue");
  if (!identity.user.emailVerified)
    throw new HttpError(403, "Verify your email before using an organization");
  const actorId = identity.user.id;
  const db = drizzle(env.SERVICE_DB);
  const now = new Date();
  const nowMs = now.getTime();

  async function resolveOrganization(id: string): Promise<ServiceOrganization> {
    if (!idPattern.test(id)) throw new HttpError(404, "Organization not found");
    const [row] = await db
      .select({ id: organization.id, name: organization.name, role: membership.role })
      .from(membership)
      .innerJoin(organization, eq(membership.organizationId, organization.id))
      .where(and(eq(membership.organizationId, id), eq(membership.userId, actorId)));
    if (!row) throw new HttpError(404, "Organization not found");
    return row;
  }

  if (url.pathname === `${root}/me` && request.method === "GET") {
    const organizations = await db
      .select({ id: organization.id, name: organization.name, role: membership.role })
      .from(membership)
      .innerJoin(organization, eq(membership.organizationId, organization.id))
      .where(eq(membership.userId, actorId));
    const result: ServiceAccount = {
      mode: "local-development",
      user: {
        id: actorId,
        name: identity.user.name,
        email: identity.user.email,
        emailVerified: identity.user.emailVerified,
        twoFactorEnabled: identity.user.twoFactorEnabled ?? false,
      },
      organizations,
    };
    return json(result);
  }
  if (url.pathname === `${root}/organizations` && request.method === "POST") {
    const body = await input(request, ["name"]);
    const name = textValue(body.name, 120);
    const organizationId = crypto.randomUUID();
    await env.SERVICE_DB.batch([
      env.SERVICE_DB.prepare(
        "INSERT INTO organization (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
      ).bind(organizationId, name, actorId, nowMs),
      env.SERVICE_DB.prepare(
        "INSERT INTO membership (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
      ).bind(crypto.randomUUID(), organizationId, actorId, nowMs),
      env.SERVICE_DB.prepare(
        "INSERT INTO service_audit (id, organization_id, actor_id, action, subject_id, created_at) VALUES (?, ?, ?, 'organization.created', ?, ?)",
      ).bind(crypto.randomUUID(), organizationId, actorId, organizationId, nowMs),
    ]);
    return json({ id: organizationId, name, role: "admin" } satisfies ServiceOrganization, 201);
  }
  if (url.pathname === `${root}/invitations/accept` && request.method === "POST") {
    const body = await input(request, ["token"]);
    const token = textValue(body.token, 128);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, "Invitation is unavailable");
    const tokenHash = await hashToken(token);
    const [offer] = await db.select().from(invitation).where(eq(invitation.tokenHash, tokenHash));
    if (
      !offer ||
      offer.email !== identity.user.email.toLowerCase() ||
      offer.status !== "pending" ||
      offer.expiresAt <= now
    )
      throw new HttpError(400, "Invitation is unavailable");
    const membershipId = crypto.randomUUID();
    const results = await env.SERVICE_DB.batch([
      env.SERVICE_DB.prepare(`INSERT OR IGNORE INTO membership (id, organization_id, user_id, role, created_at)
        SELECT ?, i.organization_id, ?, i.role, ? FROM invitation i
        WHERE i.token_hash = ? AND i.status = 'pending' AND i.expires_at > ? AND i.email = ?
        AND EXISTS (SELECT 1 FROM membership m WHERE m.organization_id = i.organization_id AND m.user_id = i.invited_by AND m.role = 'admin')`).bind(
        membershipId,
        actorId,
        nowMs,
        tokenHash,
        nowMs,
        identity.user.email.toLowerCase(),
      ),
      env.SERVICE_DB.prepare(`UPDATE invitation SET status = 'accepted', accepted_by = ?, accepted_at = ?
        WHERE token_hash = ? AND status = 'pending' AND expires_at > ? AND email = ?
        AND EXISTS (SELECT 1 FROM membership m WHERE m.id = ?)`).bind(
        actorId,
        nowMs,
        tokenHash,
        nowMs,
        identity.user.email.toLowerCase(),
        membershipId,
      ),
      env.SERVICE_DB.prepare(`INSERT INTO service_audit (id, organization_id, actor_id, action, subject_id, created_at)
        SELECT ?, organization_id, ?, 'invitation.accepted', id, ? FROM invitation WHERE token_hash = ? AND accepted_by = ? AND accepted_at = ? AND EXISTS (SELECT 1 FROM membership WHERE id = ?)`).bind(
        crypto.randomUUID(),
        actorId,
        nowMs,
        tokenHash,
        actorId,
        nowMs,
        membershipId,
      ),
    ]);
    if (results[1]?.meta.changes !== 1)
      throw new HttpError(400, "Invitation is unavailable or membership already exists");
    return json({ organizationId: offer.organizationId });
  }

  const match = url.pathname.match(/^\/service\/api\/v1\/organizations\/([^/]+)(?:\/(.*))?$/);
  if (!match?.[1]) throw new HttpError(404, "Not found");
  const org = await resolveOrganization(match[1]);
  const child = match[2] ?? "";
  if (child === "money" || child.startsWith("money/"))
    return handleReimbursements(
      request,
      env,
      { organization: org, actorId, mfaEnabled: identity.user.twoFactorEnabled ?? false },
      child === "money" ? "" : child.slice(6),
    );
  if (!child && request.method === "GET") {
    const members =
      org.role === "admin"
        ? await db
            .select({
              id: membership.id,
              userId: membership.userId,
              name: user.name,
              email: user.email,
              role: membership.role,
            })
            .from(membership)
            .innerJoin(user, eq(membership.userId, user.id))
            .where(eq(membership.organizationId, org.id))
        : [];
    const offers =
      org.role === "admin"
        ? await db
            .select({
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              status: invitation.status,
              expiresAt: invitation.expiresAt,
            })
            .from(invitation)
            .where(eq(invitation.organizationId, org.id))
        : [];
    const result: OrganizationWorkspace = {
      organization: org,
      members,
      invitations: offers.map((offer) => ({
        ...offer,
        status: offer.status === "pending" && offer.expiresAt <= now ? "expired" : offer.status,
        expiresAt: offer.expiresAt.toISOString(),
      })),
    };
    return json(result);
  }
  if (org.role !== "admin") throw new HttpError(403, "Organization administrator access required");
  if (child === "audit" && request.method === "GET") {
    const events = await env.SERVICE_DB.prepare(
      "SELECT id, actor_id AS actorId, action, subject_id AS subjectId, created_at AS createdAt FROM service_audit WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(org.id)
      .all();
    return json({ events: events.results });
  }
  if (child === "invitations" && request.method === "POST") {
    const body = await input(request, ["email", "role"]);
    const email = textValue(body.email, 254).toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof body.role !== "string" ||
      !["finance", "driver"].includes(body.role)
    )
      throw new HttpError(400, "Use an email address and a finance or driver role");
    const role = body.role as "finance" | "driver";
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const tokenHash = await hashToken(token);
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(nowMs + 72 * 3_600_000);
    const deliveryUrl = `${config.origin}/service#invite=${token}`;
    // All three records commit together; no invitation can exist without delivery and audit.
    const results = await env.SERVICE_DB.batch([
      env.SERVICE_DB.prepare(`INSERT INTO invitation (id, organization_id, email, role, token_hash, invited_by, status, created_at, expires_at)
        SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ? AND role = 'admin')`).bind(
        invitationId,
        org.id,
        email,
        role,
        tokenHash,
        actorId,
        nowMs,
        expiresAt.getTime(),
        org.id,
        actorId,
      ),
      env.SERVICE_DB.prepare(
        "INSERT INTO local_outbox (id, kind, recipient, url, created_at, expires_at) SELECT ?, 'invitation', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM invitation WHERE id = ?)",
      ).bind(crypto.randomUUID(), email, deliveryUrl, nowMs, expiresAt.getTime(), invitationId),
      env.SERVICE_DB.prepare(
        "INSERT INTO service_audit (id, organization_id, actor_id, action, subject_id, created_at) SELECT ?, ?, ?, 'invitation.created', ?, ? WHERE EXISTS (SELECT 1 FROM invitation WHERE id = ?)",
      ).bind(crypto.randomUUID(), org.id, actorId, invitationId, nowMs, invitationId),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(403, "Organization administrator access required");
    return json(
      { id: invitationId, email, role, status: "pending", expiresAt: expiresAt.toISOString() },
      201,
    );
  }
  const revokeMatch = child.match(/^invitations\/([a-zA-Z0-9_-]+)$/);
  if (revokeMatch?.[1] && request.method === "DELETE") {
    const offerId = revokeMatch[1];
    const auditId = crypto.randomUUID();
    const results = await env.SERVICE_DB.batch([
      env.SERVICE_DB.prepare(`INSERT INTO service_audit (id, organization_id, actor_id, action, subject_id, created_at)
        SELECT ?, ?, ?, 'invitation.revoked', ?, ? WHERE EXISTS (SELECT 1 FROM invitation WHERE id = ? AND organization_id = ? AND status = 'pending') AND EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ? AND role = 'admin')`).bind(
        auditId,
        org.id,
        actorId,
        offerId,
        nowMs,
        offerId,
        org.id,
        org.id,
        actorId,
      ),
      env.SERVICE_DB.prepare(
        "UPDATE invitation SET status = 'revoked' WHERE id = ? AND organization_id = ? AND EXISTS (SELECT 1 FROM service_audit WHERE id = ?)",
      ).bind(offerId, org.id, auditId),
    ]);
    if (results[0]?.meta.changes !== 1) throw new HttpError(404, "Pending invitation not found");
    return json({ status: "revoked" });
  }
  const memberMatch = child.match(/^members\/([a-zA-Z0-9_-]+)$/);
  if (memberMatch?.[1] && request.method === "DELETE") {
    const memberId = memberMatch[1];
    const auditId = crypto.randomUUID();
    const results = await env.SERVICE_DB.batch([
      env.SERVICE_DB.prepare(`INSERT INTO service_audit (id, organization_id, actor_id, action, subject_id, created_at)
        SELECT ?, ?, ?, 'membership.removed', ?, ? WHERE EXISTS (SELECT 1 FROM membership target INNER JOIN organization o ON o.id = target.organization_id WHERE target.id = ? AND target.organization_id = ? AND target.user_id != o.created_by) AND EXISTS (SELECT 1 FROM membership WHERE organization_id = ? AND user_id = ? AND role = 'admin')`).bind(
        auditId,
        org.id,
        actorId,
        memberId,
        nowMs,
        memberId,
        org.id,
        org.id,
        actorId,
      ),
      env.SERVICE_DB.prepare(
        "INSERT OR IGNORE INTO reimbursement_assignment_end (assignment_id,effective_until,created_by,created_at) SELECT a.id,max(a.effective_from,min(a.effective_until,?)),?,? FROM reimbursement_assignment a INNER JOIN membership m ON m.user_id = a.employee_id AND m.organization_id = a.organization_id WHERE m.id = ? AND a.organization_id = ? AND EXISTS (SELECT 1 FROM service_audit WHERE id = ?)",
      ).bind(nowMs, actorId, nowMs, memberId, org.id, auditId),
      env.SERVICE_DB.prepare(
        "INSERT INTO service_audit (id,organization_id,actor_id,action,subject_id,created_at) SELECT lower(hex(randomblob(16))),?,?,'assignment.ended',e.assignment_id,? FROM reimbursement_assignment_end e INNER JOIN reimbursement_assignment a ON a.id = e.assignment_id INNER JOIN membership m ON m.user_id = a.employee_id AND m.organization_id = a.organization_id WHERE m.id = ? AND a.organization_id = ? AND e.created_by = ? AND e.created_at = ? AND EXISTS (SELECT 1 FROM service_audit WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM service_audit previous WHERE previous.subject_id = e.assignment_id AND previous.action = 'assignment.ended')",
      ).bind(org.id, actorId, nowMs, memberId, org.id, actorId, nowMs, auditId),
      env.SERVICE_DB.prepare(
        "DELETE FROM membership WHERE id = ? AND organization_id = ? AND EXISTS (SELECT 1 FROM service_audit WHERE id = ?)",
      ).bind(memberId, org.id, auditId),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new HttpError(409, "Member unavailable or protected organization creator");
    return json({ status: "removed" });
  }
  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request: Request, env: ServiceEnv): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      response =
        error instanceof HttpError
          ? json({ error: error.message }, error.status)
          : json({ error: "Service request failed" }, 500);
    }
    const safe = new Response(response.body, response);
    safe.headers.set("Cache-Control", "no-store");
    safe.headers.set("Referrer-Policy", "no-referrer");
    safe.headers.set("X-Content-Type-Options", "nosniff");
    return safe;
  },
};
