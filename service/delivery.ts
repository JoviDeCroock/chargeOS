import type { ServiceEnv } from "./auth.js";
import { serviceConfiguration } from "./configuration.js";
export const MAX_PENDING_ACCOUNT_MAIL = 1000;
export const MAIL_PER_MINUTE = 20;
export const MAX_PUBLIC_RATE_ROWS = 4096;
export const PUBLIC_REQUESTS_PER_MINUTE = 1200;
const window = 60000;
export async function deliveryAdmission(
  env: ServiceEnv,
  kind: string,
  recipient: string,
  now: number,
) {
  const config = serviceConfiguration(env);
  if (!config) throw new Error("Delivery is not configured");
  if (config.mode !== "self-hosted")
    return {
      before: [] as D1PreparedStatement[],
      condition: "1",
      bindings: [] as (string | number)[],
    };
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(config.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  const verifier = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`chargeos-mail-admission:1:${kind}:${recipient.toLowerCase()}`),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const recipientKey = `mail-recipient:${verifier}`,
    globalKey = "mail-global",
    cutoff = now - window;
  const pending = `(SELECT count(*) FROM local_outbox WHERE channel='smtp' AND status='pending')<${MAX_PENDING_ACCOUNT_MAIL}`;
  const recipientReady =
    "EXISTS(SELECT 1 FROM rate_limit WHERE key=? AND count=1 AND last_request>?)";
  const before = [
    env.SERVICE_DB.prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END",
    ).bind(crypto.randomUUID(), recipientKey, now, cutoff, cutoff, now),
    env.SERVICE_DB.prepare(
      `INSERT INTO rate_limit(id,key,count,last_request) SELECT ?,?,1,? WHERE ${recipientReady} AND ${pending} ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END`,
    ).bind(crypto.randomUUID(), globalKey, now, recipientKey, cutoff, cutoff, cutoff, now),
  ];
  return {
    before,
    condition: `${recipientReady} AND EXISTS(SELECT 1 FROM rate_limit WHERE key=? AND count<=${MAIL_PER_MINUTE} AND last_request>?) AND ${pending}`,
    bindings: [recipientKey, cutoff, globalKey, cutoff] as (string | number)[],
  };
}
/** The initial verification reserves a real future SMTP row before password work.
 * Its empty payload cannot be claimed before expiry; only this request's opaque
 * capability can complete it. A crashed request expires without being sent. */
export async function publicSignupAdmission(
  env: ServiceEnv,
  email: string,
): Promise<string | null> {
  const now = Date.now(),
    cutoff = now - window,
    id = crypto.randomUUID();
  const admission = await deliveryAdmission(env, "verify-email", email, now);
  const results = await env.SERVICE_DB.batch([
    ...admission.before,
    env.SERVICE_DB.prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,'public-signup',1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END",
    ).bind(crypto.randomUUID(), now, cutoff, cutoff, now),
    env.SERVICE_DB.prepare(
      `INSERT INTO local_outbox(id,kind,recipient,url,created_at,expires_at,channel,next_attempt_at) SELECT ?,'verify-email',?,'',?,?,'smtp',? WHERE EXISTS(SELECT 1 FROM rate_limit WHERE key='public-signup' AND count<=10 AND last_request>?) AND ${admission.condition}`,
    ).bind(id, email, now, now + 300000, now + 300000, cutoff, ...admission.bindings),
  ]);
  return results.at(-1)?.meta.changes === 1 ? id : null;
}
export async function publicRequestAdmission(env: ServiceEnv, ip: string): Promise<boolean> {
  const now = Date.now(),
    cutoff = now - window;
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const peerKey = `public-peer:${digest}`;
  const results = await env.SERVICE_DB.batch([
    // All configured auth rules use a 60-second window. Purge a bounded chunk
    // across auth and public counters, retaining every active window.
    env.SERVICE_DB.prepare(
      "DELETE FROM rate_limit WHERE id IN(SELECT id FROM rate_limit WHERE last_request<=? LIMIT 100)",
    ).bind(cutoff),
    env.SERVICE_DB.prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES(?,'public-requests',1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END",
    ).bind(crypto.randomUUID(), now, cutoff, cutoff, now),
    env.SERVICE_DB.prepare(
      `INSERT INTO rate_limit(id,key,count,last_request) SELECT ?,?,1,? WHERE EXISTS(SELECT 1 FROM rate_limit WHERE key='public-requests' AND count<=${PUBLIC_REQUESTS_PER_MINUTE} AND last_request>?) AND ((SELECT count(*) FROM rate_limit)<${MAX_PUBLIC_RATE_ROWS} OR EXISTS(SELECT 1 FROM rate_limit WHERE key=?)) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_request<=? THEN 1 ELSE count+1 END,last_request=CASE WHEN last_request<=? THEN ? ELSE last_request END RETURNING count`,
    ).bind(crypto.randomUUID(), peerKey, now, cutoff, peerKey, cutoff, cutoff, now),
  ]);
  const row = results.at(-1)?.results[0] as { count: number } | undefined;
  return !!row && row.count <= 120;
}
