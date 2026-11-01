import { randomUUID, createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serviceConfiguration, type ServiceSettings } from "../configuration.js";
import { NativeCommercialDatabase } from "./sqlite.js";
import { withNativeRecoveryCustody } from "./recovery-review.js";
import { migrateNativeDatabase, readNativeMigrations } from "./migrations.js";
import {
  mailbox,
  accountMessage,
  sendAccountMail,
  SmtpFailure,
  type AccountMail,
  type SmtpConfiguration,
} from "./smtp.js";

type Settings = ServiceSettings;
interface QueuedMail extends AccountMail {
  attempts: number;
  leaseToken: string;
}
function validateLink(mail: AccountMail, origin: string): void {
  mailbox(mail.recipient);
  if (typeof mail.url !== "string" || mail.url.length > 8192 || /[\0\r\n]/.test(mail.url))
    throw new Error("Invalid account link");
  const url = new URL(mail.url);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("Foreign account link");
  if (mail.kind === "invitation") {
    if (url.pathname !== "/service" || url.search || !/^#invite=[a-f0-9]{64}$/.test(url.hash))
      throw new Error("Invalid invitation link");
  } else {
    if (
      url.hash ||
      (mail.kind === "verify-email"
        ? url.pathname !== "/service/api/auth/verify-email" ||
          !/^[a-zA-Z0-9._~-]{16,8192}$/.test(url.searchParams.get("token") ?? "")
        : mail.kind !== "reset-password" ||
          !/^\/service\/api\/auth\/reset-password\/[a-zA-Z0-9_-]{16,256}$/.test(url.pathname))
    )
      throw new Error("Invalid account link kind");
    for (const key of url.searchParams.keys()) {
      if (!["token", "callbackURL"].includes(key) || url.searchParams.getAll(key).length !== 1)
        throw new Error("Unexpected account link fields");
    }
    const callback = url.searchParams.get("callbackURL");
    if (callback && new URL(callback, origin).origin !== origin)
      throw new Error("Foreign account callback");
  }
}

export async function deliverNativeAccountMail(
  configuration: Settings,
  directory: string,
  smtp: SmtpConfiguration,
) {
  const config = serviceConfiguration(configuration);
  if (!config || config.delivery !== "smtp")
    throw new Error("Explicit SMTP queue activation is required");
  await lstat(join(directory, "commercial.sqlite"));
  const database = new NativeCommercialDatabase(directory, {
    recoverySecret: config.secret,
    recoveryOrigin: config.origin,
  });
  try {
    return await withNativeRecoveryCustody(directory, async () => {
      if (
        !["ordinary", "released"].includes(
          database.recoveryState(config.secret, false, config.origin),
        )
      )
        throw new Error("Account delivery remains quarantined");
      await migrateNativeDatabase(
        database,
        readNativeMigrations(fileURLToPath(new URL("../migrations", import.meta.url))),
      );
      const now = Date.now(),
        lease = randomUUID();
      const expired = await database
        .prepare("DELETE FROM local_outbox WHERE channel='smtp' AND expires_at<=?")
        .bind(now)
        .run();
      const claimed = await database
        .prepare(
          "UPDATE local_outbox SET attempts=attempts+1,lease_token=?,lease_expires_at=? WHERE id=(SELECT id FROM local_outbox WHERE channel='smtp' AND status='pending' AND attempts<8 AND expires_at>? AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY created_at,id LIMIT 1) RETURNING id,kind,recipient,url,created_at AS createdAt,expires_at AS expiresAt,attempts,lease_token AS leaseToken",
        )
        .bind(lease, now + 60000, now, now, now)
        .first<QueuedMail>();
      const exhausted = await database
        .prepare(
          "UPDATE local_outbox SET status='failed',recipient='',url='',lease_token=NULL,lease_expires_at=NULL,last_failure='attempts-exhausted' WHERE channel='smtp' AND status='pending' AND attempts>=8 AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
        )
        .bind(now)
        .run();
      const counts = {
        accepted: 0,
        retrying: 0,
        failed: exhausted.meta.changes,
        discarded: expired.meta.changes,
      };
      if (!claimed) return counts;
      let invalid = false;
      try {
        validateLink(claimed, config.origin);
        accountMessage(claimed, smtp.sender);
      } catch {
        invalid = true;
      }
      if (!invalid && claimed.kind === "invitation") {
        const token = new URLSearchParams(new URL(claimed.url).hash.slice(1)).get("invite")!;
        const valid = await database
          .prepare(
            "SELECT 1 FROM invitation WHERE token_hash=? AND email=? AND status='pending' AND expires_at>?",
          )
          .bind(createHash("sha256").update(token).digest("hex"), claimed.recipient, Date.now())
          .first();
        if (!valid) invalid = true;
      }
      if (!invalid && claimed.kind === "verify-email") {
        const eligible = await database
          .prepare("SELECT 1 FROM user WHERE email=? AND email_verified=0")
          .bind(claimed.recipient)
          .first();
        if (!eligible) invalid = true;
      }
      if (invalid) {
        const result = await database
          .prepare(
            "UPDATE local_outbox SET status='failed',recipient='',url='',lease_token=NULL,lease_expires_at=NULL,last_failure='invalid-message' WHERE id=? AND lease_token=?",
          )
          .bind(claimed.id, lease)
          .run();
        if (result.meta.changes !== 1) throw new Error("Invalid delivery lost its lease");
        counts.failed++;
        return counts;
      }
      let problem: SmtpFailure | undefined;
      try {
        await sendAccountMail(smtp, claimed);
      } catch (error) {
        problem = error instanceof SmtpFailure ? error : new SmtpFailure("smtp-temporary", true);
      }
      if (!problem) {
        const result = await database
          .prepare("DELETE FROM local_outbox WHERE id=? AND lease_token=?")
          .bind(claimed.id, lease)
          .run();
        if (result.meta.changes !== 1) throw new Error("Delivery acknowledgement lost its lease");
        counts.accepted++;
        return counts;
      }
      const retry = problem.retryable && claimed.attempts < 8 && claimed.expiresAt > Date.now();
      const due = Date.now() + Math.min(600000, 10000 * 2 ** (claimed.attempts - 1));
      const result = await database
        .prepare(
          "UPDATE local_outbox SET status=?,recipient=CASE WHEN ? THEN recipient ELSE '' END,url=CASE WHEN ? THEN url ELSE '' END,next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL,last_failure=? WHERE id=? AND lease_token=?",
        )
        .bind(
          retry ? "pending" : "failed",
          retry ? 1 : 0,
          retry ? 1 : 0,
          due,
          problem.reason,
          claimed.id,
          lease,
        )
        .run();
      if (result.meta.changes !== 1) throw new Error("Delivery failure lost its lease");
      if (retry) counts.retrying++;
      else counts.failed++;
      return counts;
    });
  } finally {
    database.close();
  }
}
