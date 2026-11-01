import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { smtpCertificates, syntheticSmtp, messageText } from "./smtp-fixture.mjs";
import { sendAccountMail, readSmtpConfiguration } from "../../service/node/smtp.ts";
import { deliverNativeAccountMail } from "../../service/node/mail.ts";
import { env } from "./env.mjs";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import { withNativeRecoveryCustody } from "../../service/node/recovery-review.ts";
import { enrollmentFixture } from "./enrollment-fixture.mjs";
import { Browser, signedIn, createOrganization, invite } from "../service/helpers.ts";
import { migrateNativeDatabase, readNativeMigrations } from "../../service/node/migrations.ts";
import { fileURLToPath } from "node:url";

let certificates, wrongCertificates;
const servers = [],
  directories = [];
const origin = env.SERVICE_ORIGIN,
  password = "synthetic smtp account password!";
const configuration = () => ({ ...env, SERVICE_DELIVERY: "smtp" });
const deliver = (smtp) =>
  deliverNativeAccountMail(configuration(), dirname(env.SERVICE_DB.path), smtp.config);
async function server(options = {}) {
  const smtp = await syntheticSmtp(options.wrong ? wrongCertificates : certificates, options);
  servers.push(smtp);
  return smtp;
}
async function signup(channel = "smtp") {
  env.SERVICE_DELIVERY = channel;
  const browser = new Browser(),
    email = `smtp-${crypto.randomUUID()}@example.test`;
  const response = await browser.request("/service/api/auth/sign-up/email", {
    email,
    name: "Synthetic Mail User",
    password,
    callbackURL: `${origin}/service`,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const row = await env.SERVICE_DB.prepare(
    "SELECT * FROM local_outbox WHERE recipient=? AND kind='verify-email' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email)
    .first();
  return { browser, email, row };
}
const sample = () => ({
  id: "synthetic-one",
  kind: "verify-email",
  recipient: "person@example.test",
  url: `${origin}/service/api/auth/verify-email?token=${"a".repeat(64)}`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60000,
});
beforeAll(async () => {
  certificates = await smtpCertificates();
  wrongCertificates = await smtpCertificates("wrong.example.test");
});
afterEach(async () => {
  delete env.SERVICE_DELIVERY;
  vi.restoreAllMocks();
  await env.SERVICE_DB.prepare("DELETE FROM local_outbox").run();
  await env.SERVICE_DB.prepare("DELETE FROM rate_limit").run();
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
afterAll(async () => {
  await certificates?.close();
  await wrongCertificates?.close();
});

it("delivers a real fresh verification link over authenticated TLS and deletes its accepted private queue payload", async () => {
  const smtp = await server(),
    person = await signup();
  expect(person.row.channel).toBe("smtp");
  expect(await deliver(smtp)).toMatchObject({ accepted: 1, failed: 0 });
  expect(smtp.counts).toMatchObject({ auth: 1, data: 1 });
  expect(messageText(smtp.messages[0])).toContain(person.row.url);
  expect(
    await env.SERVICE_DB.prepare("SELECT 1 FROM local_outbox WHERE id=?")
      .bind(person.row.id)
      .first(),
  ).toBeNull();
  expect([200, 302]).toContain((await person.browser.request(person.row.url)).status);
  expect(
    (
      await person.browser.request("/service/api/auth/sign-in/email", {
        email: person.email,
        password,
      })
    ).status,
  ).toBe(200);
});
it("requires a successful STARTTLS upgrade before authentication and data", async () => {
  const smtp = await server({ starttls: true });
  await sendAccountMail(smtp.config, sample());
  expect(smtp.counts).toMatchObject({ auth: 1, data: 1 });
});

it("delivers a real password reset link that changes the password and revokes the old sign-in", async () => {
  const smtp = await server(),
    person = await signup();
  await deliver(smtp);
  await person.browser.request(person.row.url);
  await person.browser.request("/service/api/auth/sign-in/email", {
    email: person.email,
    password,
  });
  expect(
    (
      await person.browser.request("/service/api/auth/request-password-reset", {
        email: person.email,
        redirectTo: `${origin}/service`,
      })
    ).status,
  ).toBe(200);
  const reset = await env.SERVICE_DB.prepare(
    "SELECT * FROM local_outbox WHERE recipient=? AND kind='reset-password'",
  )
    .bind(person.email)
    .first();
  expect(reset.channel).toBe("smtp");
  expect(await deliver(smtp)).toMatchObject({ accepted: 1 });
  expect(messageText(smtp.messages[1])).toContain(reset.url);
  const token = new URL(reset.url).pathname.split("/").pop(),
    newPassword = "a second synthetic SMTP password!";
  expect(
    (await person.browser.request("/service/api/auth/reset-password", { token, newPassword }))
      .status,
  ).toBe(200);
  expect((await person.browser.request("/service/api/v1/me")).status).toBe(401);
  expect(
    (
      await person.browser.request("/service/api/auth/sign-in/email", {
        email: person.email,
        password: newPassword,
      })
    ).status,
  ).toBe(200);
});

it("delivers real organization invitations and suppresses a revoked invitation", async () => {
  env.SERVICE_DELIVERY = "smtp";
  const smtp = await server(),
    admin = await signedIn(),
    person = await signedIn(),
    org = await createOrganization(admin.browser, "SMTP company");
  await env.SERVICE_DB.prepare("DELETE FROM local_outbox").run();
  const invitation = await invite(admin.browser, org, person.email);
  const queued = await env.SERVICE_DB.prepare(
    "SELECT * FROM local_outbox WHERE kind='invitation' AND recipient=?",
  )
    .bind(person.email)
    .first();
  expect(queued.channel).toBe("smtp");
  expect(await deliver(smtp)).toMatchObject({ accepted: 1 });
  expect(messageText(smtp.messages[0])).toContain(queued.url);
  expect(
    (
      await person.browser.request("/service/api/v1/invitations/accept", {
        token: invitation.token,
      })
    ).status,
  ).toBe(200);
  const revoked = await invite(admin.browser, org, "revoked-smtp@example.test");
  expect(
    (
      await admin.browser.request(
        `/service/api/v1/organizations/${org.id}/invitations/${revoked.id}`,
        {},
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, failed: 1 });
  expect(smtp.messages.length).toBe(1);
});
it("refuses missing and rejected STARTTLS with no credentials or message transmitted", async () => {
  for (const options of [
    { starttls: true, advertiseStarttls: false },
    { starttls: true, rejectStarttls: true },
  ]) {
    const smtp = await server(options);
    await expect(sendAccountMail(smtp.config, sample())).rejects.toThrow("Email transport failed");
    expect(smtp.counts).toMatchObject({ auth: 0, data: 0 });
  }
});
it("rejects untrusted and wrong-host certificates before SMTP authentication", async () => {
  const untrusted = await server(),
    wrong = await server({ wrong: true });
  await expect(sendAccountMail({ ...untrusted.config, ca: undefined }, sample())).rejects.toThrow();
  await expect(sendAccountMail(wrong.config, sample())).rejects.toMatchObject({
    reason: "smtp-tls",
    retryable: false,
  });
  expect(
    untrusted.counts.auth + untrusted.counts.data + wrong.counts.auth + wrong.counts.data,
  ).toBe(0);
});

it("retries temporary SMTP authentication refusal but scrubs permanent authentication failures", async () => {
  const temporary = await server({ authReply: "454 Temporary authentication problem\r\n" }),
    first = await signup();
  expect(await deliver(temporary)).toMatchObject({ retrying: 1, failed: 0 });
  expect(
    await env.SERVICE_DB.prepare(
      "SELECT status,last_failure,recipient FROM local_outbox WHERE id=?",
    )
      .bind(first.row.id)
      .first(),
  ).toEqual({ status: "pending", last_failure: "smtp-auth", recipient: first.email });
  const permanent = await server({
      authReply: "535 Invalid credentials, private provider echo\r\n",
    }),
    second = await signup();
  expect(await deliver(permanent)).toMatchObject({ retrying: 0, failed: 1 });
  expect(
    await env.SERVICE_DB.prepare(
      "SELECT status,last_failure,recipient,url FROM local_outbox WHERE id=?",
    )
      .bind(second.row.id)
      .first(),
  ).toEqual({ status: "failed", last_failure: "smtp-auth", recipient: "", url: "" });
  expect(temporary.counts.data + permanent.counts.data).toBe(0);
});

it("does not claim active leases and scrubs an exhausted lease only after it expires", async () => {
  const smtp = await server(),
    person = await signup();
  await env.SERVICE_DB.prepare(
    "UPDATE local_outbox SET attempts=8,lease_token='other-worker',lease_expires_at=? WHERE id=?",
  )
    .bind(Date.now() + 60000, person.row.id)
    .run();
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, failed: 0 });
  await env.SERVICE_DB.prepare("UPDATE local_outbox SET lease_expires_at=0 WHERE id=?")
    .bind(person.row.id)
    .run();
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, failed: 1 });
  expect(
    await env.SERVICE_DB.prepare(
      "SELECT recipient,url,status,last_failure FROM local_outbox WHERE id=?",
    )
      .bind(person.row.id)
      .first(),
  ).toEqual({ recipient: "", url: "", status: "failed", last_failure: "attempts-exhausted" });
  expect(smtp.counts.connections).toBe(0);
});

it("retains an ambiguous accepted delivery lease after a failed acknowledgement and retries with the same message ID", async () => {
  const smtp = await server(),
    person = await signup(),
    execute = NativeCommercialDatabase.prototype.execute;
  let fail = true;
  vi.spyOn(NativeCommercialDatabase.prototype, "execute").mockImplementation(function (
    query,
    values,
    ...rest
  ) {
    if (fail && query === "DELETE FROM local_outbox WHERE id=? AND lease_token=?") {
      fail = false;
      throw new Error("synthetic acknowledgement storage failure");
    }
    return execute.call(this, query, values, ...rest);
  });
  await expect(deliver(smtp)).rejects.toThrow(/acknowledgement storage/);
  const pending = await env.SERVICE_DB.prepare(
    "SELECT attempts,lease_token,lease_expires_at FROM local_outbox WHERE id=?",
  )
    .bind(person.row.id)
    .first();
  expect(pending.attempts).toBe(1);
  expect(pending.lease_token).toBeTruthy();
  expect(await deliver(smtp)).toMatchObject({ accepted: 0 });
  expect(smtp.messages.length).toBe(1);
  await env.SERVICE_DB.prepare("UPDATE local_outbox SET lease_expires_at=0 WHERE id=?")
    .bind(person.row.id)
    .run();
  expect(await deliver(smtp)).toMatchObject({ accepted: 1 });
  expect(smtp.messages[0].match(/Message-ID: (.*)/)[1]).toBe(
    smtp.messages[1].match(/Message-ID: (.*)/)[1],
  );
});
it("does not dispatch historical or new operator-only rows after SMTP activation", async () => {
  const smtp = await server();
  const old = await signup("local");
  env.SERVICE_DELIVERY = "smtp";
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, failed: 0 });
  expect(smtp.counts.connections).toBe(0);
  expect(
    (
      await env.SERVICE_DB.prepare("SELECT channel FROM local_outbox WHERE id=?")
        .bind(old.row.id)
        .first()
    ).channel,
  ).toBe("local");
});
it("backs off temporary failures using a durable owned lease and a stable message ID on retry", async () => {
  const smtp = await server({ finalReply: "451 Synthetic retry echo private-token\r\n" }),
    person = await signup();
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, retrying: 1 });
  const failed = await env.SERVICE_DB.prepare("SELECT * FROM local_outbox WHERE id=?")
    .bind(person.row.id)
    .first();
  expect(failed).toMatchObject({
    attempts: 1,
    lease_token: null,
    last_failure: "smtp-temporary",
    status: "pending",
  });
  expect(failed.next_attempt_at).toBeGreaterThan(Date.now());
  expect(await deliver(smtp)).toMatchObject({ accepted: 0, retrying: 0 });
  const retry = await server();
  await env.SERVICE_DB.prepare("UPDATE local_outbox SET next_attempt_at=0 WHERE id=?")
    .bind(person.row.id)
    .run();
  expect(await deliver(retry)).toMatchObject({ accepted: 1 });
  expect(smtp.messages[0].match(/Message-ID: (.*)/)[1]).toBe(
    retry.messages[0].match(/Message-ID: (.*)/)[1],
  );
});
it("scrubs failed private payloads and never stores a provider's echoed secret", async () => {
  const smtp = await server({ recipientReply: "550 synthetic echoed secret, never persist\r\n" }),
    person = await signup();
  expect(await deliver(smtp)).toMatchObject({ failed: 1, retrying: 0 });
  const row = await env.SERVICE_DB.prepare("SELECT * FROM local_outbox WHERE id=?")
    .bind(person.row.id)
    .first();
  expect(row).toMatchObject({
    recipient: "",
    url: "",
    status: "failed",
    last_failure: "smtp-permanent",
    lease_token: null,
  });
  expect(JSON.stringify(row)).not.toContain("echoed secret");
});
it("skips expired, malformed, callback-host-swapped and already verified mail without SMTP", async () => {
  const smtp = await server(),
    person = await signup();
  await env.SERVICE_DB.prepare("UPDATE local_outbox SET expires_at=0 WHERE id=?")
    .bind(person.row.id)
    .run();
  expect(await deliver(smtp)).toMatchObject({ discarded: 1 });
  for (const url of [
    "https://attacker.example/service",
    `${origin}/service/api/auth/verify-email?token=${"a".repeat(32)}&callbackURL=https://attacker.example/`,
    `${origin}/service#invite=invalid`,
  ]) {
    const person = await signup();
    await env.SERVICE_DB.prepare("UPDATE local_outbox SET url=? WHERE id=?")
      .bind(url, person.row.id)
      .run();
    expect(await deliver(smtp)).toMatchObject({ failed: 1 });
  }
  const verified = await signup();
  await verified.browser.request(verified.row.url);
  expect(await deliver(smtp)).toMatchObject({ failed: 1 });
  expect(smtp.counts.connections).toBe(0);
});
it("holds recovery custody through stalled DATA until physical socket close and durable failure update", async () => {
  const smtp = await server({ holdData: true, holdClose: true }),
    person = await signup();
  await env.SERVICE_DB.prepare("UPDATE local_outbox SET expires_at=? WHERE id=?")
    .bind(Date.now() + 500, person.row.id)
    .run();
  const pending = deliver(smtp);
  await vi.waitFor(() => expect(smtp.messages.length).toBe(1));
  await expect(
    withNativeRecoveryCustody(dirname(env.SERVICE_DB.path), async () => {}),
  ).rejects.toThrow(/EEXIST/);
  expect(await pending).toMatchObject({ failed: 1 });
  const row = await env.SERVICE_DB.prepare("SELECT status,lease_token FROM local_outbox WHERE id=?")
    .bind(person.row.id)
    .first();
  expect(row).toEqual({ status: "failed", lease_token: null });
  await withNativeRecoveryCustody(dirname(env.SERVICE_DB.path), async () => {});
});
it("requires explicit activation and refuses quarantined commercial copies before network I/O", async () => {
  const smtp = await server();
  await expect(
    deliverNativeAccountMail(env, dirname(env.SERVICE_DB.path), smtp.config),
  ).rejects.toThrow(/activation/);
  const f = await enrollmentFixture();
  directories.push(f.directory);
  await expect(
    deliverNativeAccountMail({ ...f.configuration, SERVICE_DELIVERY: "smtp" }, f.data, smtp.config),
  ).rejects.toThrow(/quarantined/);
  expect(smtp.counts.connections).toBe(0);
});
it("validates private SMTP configuration and refuses insecure or linked settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-mail-settings-"));
  directories.push(directory);
  const path = join(directory, "smtp.json"),
    settings = {
      format: "chargeos-smtp",
      schemaVersion: 1,
      host: "localhost",
      port: 465,
      security: "implicit-tls",
      username: "synthetic",
      password: "private-password",
      sender: "accounts@example.test",
      caFile: certificates.caFile,
    };
  await writeFile(path, JSON.stringify(settings), { mode: 0o600 });
  expect(await readSmtpConfiguration(path)).toMatchObject({
    host: "localhost",
    port: 465,
    ca: certificates.cert,
  });
  await chmod(path, 0o644);
  await expect(readSmtpConfiguration(path)).rejects.toThrow();
  await chmod(path, 0o600);
  const link = join(directory, "link.json");
  await symlink(path, link);
  await expect(readSmtpConfiguration(link)).rejects.toThrow();
  for (const delta of [
    { security: "none" },
    { security: ["starttls"] },
    { security: {} },
    { rejectUnauthorized: false },
    { host: "127.0.0.1" },
    { sender: "person@example.test\r\nBcc: steal@example.test" },
  ]) {
    await writeFile(path, JSON.stringify({ ...settings, ...delta }));
    await expect(readSmtpConfiguration(path)).rejects.toThrow();
  }
});
it("preserves operator-only channel defaults when upgrading existing outbox rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-mail-upgrade-"));
  directories.push(directory);
  const db = new NativeCommercialDatabase(directory),
    migrations = readNativeMigrations(
      fileURLToPath(new URL("../../service/migrations", import.meta.url)),
    );
  try {
    const smtpMigration = migrations.findIndex(
      (migration) => migration.name === "0005_lyrical_carmella_unuscione",
    );
    expect(smtpMigration).toBeGreaterThan(0);
    await migrateNativeDatabase(db, migrations.slice(0, smtpMigration));
    await db
      .prepare(
        "INSERT INTO local_outbox VALUES('historical','verify-email','person@example.test','http://127.0.0.1:5173/service',1,9999999999999)",
      )
      .run();
    await migrateNativeDatabase(db, migrations);
    expect(await db.prepare("SELECT channel,status,attempts FROM local_outbox").first()).toEqual({
      channel: "local",
      status: "pending",
      attempts: 0,
    });
  } finally {
    db.close();
  }
});
