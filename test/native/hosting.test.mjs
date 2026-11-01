import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nativeHosting,
  serviceConfiguration,
  localConfiguration,
  publicServiceOrigin,
  signupEmailAllowed,
} from "../../service/configuration.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";
import { migrateNativeDatabase, readNativeMigrations } from "../../service/node/migrations.ts";
import { createNativeCommercialServer } from "../../service/node/http.ts";
import { enqueueServiceDelivery } from "../../service/auth.ts";
import { MAX_PENDING_ACCOUNT_MAIL, MAIL_PER_MINUTE } from "../../service/delivery.ts";
import worker from "../../service/index.ts";

const origin = "https://accounts.example.test",
  password = "synthetic hosted account password!";
let directory,
  db,
  env,
  servers = [],
  serial = 0;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "chargeos-hosting-test-"));
  db = new NativeCommercialDatabase(directory);
  await migrateNativeDatabase(
    db,
    readNativeMigrations(fileURLToPath(new URL("../../service/migrations", import.meta.url))),
  );
  env = {
    SERVICE_DB: db,
    SERVICE_MODE: "production",
    SERVICE_ORIGIN: origin,
    SERVICE_AUTH_SECRET: "synthetic hosted auth secret at least32!",
    SERVICE_DELIVERY: "smtp",
    SERVICE_SIGNUP_DOMAINS: "example.test",
    [nativeHosting]: true,
  };
});
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  db?.close();
  await rm(directory, { recursive: true, force: true });
});
class Browser {
  cookies = new Map();
  ip = `192.0.2.${++serial}`;
  constructor(base) {
    this.base = base;
  }
  async request(path, body, extra = {}) {
    const url = new URL(path, origin),
      r = await new Promise((resolve, reject) => {
        const request = httpRequest(
          this.base + url.pathname + url.search,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Host: new URL(origin).host,
              Origin: origin,
              "X-Forwarded-Proto": "https",
              "X-ChargeOS-Client-IP": this.ip,
              Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
              "Content-Type": "application/json",
              ...extra,
            },
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => {
              const headers = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
              resolve(
                new Response(Buffer.concat(chunks), { status: response.statusCode, headers }),
              );
            });
          },
        );
        request.on("error", reject);
        request.end(body === undefined ? undefined : JSON.stringify(body));
      });
    for (const cookie of r.headers.getSetCookie()) {
      const [pair] = cookie.split(";"),
        at = pair.indexOf("="),
        key = pair.slice(0, at),
        value = pair.slice(at + 1);
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    return r;
  }
}
async function open(handler, options = {}) {
  const s = createNativeCommercialServer(env, handler, options);
  servers.push(s);
  return new Browser(`http://127.0.0.1:${await s.listen(0)}`);
}
async function account(browser, email = `hosted-${crypto.randomUUID()}@example.test`) {
  const signup = await browser.request("/service/api/auth/sign-up/email", {
    email,
    name: "Synthetic Hosted Person",
    password,
    callbackURL: `${origin}/service`,
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const link = await db
    .prepare("SELECT url FROM local_outbox WHERE recipient=? AND kind='verify-email'")
    .bind(email)
    .first("url");
  expect([200, 302]).toContain((await browser.request(link)).status);
  const login = await browser.request("/service/api/auth/sign-in/email", { email, password });
  expect(login.status, await login.clone().text()).toBe(200);
  return { email, login };
}
it("requires a native capability for public runtime while metadata validation grants no runtime authority", async () => {
  expect(serviceConfiguration(env)?.mode).toBe("self-hosted");
  expect(localConfiguration(env)).toBeNull();
  for (const invalid of [
    "http://accounts.example.test",
    "https://localhost",
    "https://127.0.0.1",
    "https://accounts.example.test/path",
    "https://accounts.example.test:8443",
    "https://person@accounts.example.test",
    "https://accounts.example.test/",
  ])
    expect(publicServiceOrigin(invalid)).toBeNull();
  const { [nativeHosting]: _capability, ...unbranded } = env;
  expect(serviceConfiguration(unbranded)).toBeNull();
  const response = await worker.fetch(new Request(`${origin}/service/api/v1/health`), {
    ...unbranded,
    nativeHosting: true,
    NATIVE_RUNTIME: true,
  });
  expect(response.status).toBe(503);
  expect(signupEmailAllowed(serviceConfiguration(env), "person@sub.example.test")).toBe(false);
  expect(signupEmailAllowed(serviceConfiguration(env), "person@example.test.evil")).toBe(false);
  expect(signupEmailAllowed(serviceConfiguration(env), "person@example.test@evil.test")).toBe(
    false,
  );
});
it("requires exact proxy metadata and strips caller-controlled forwarding before rate-limit identity", async () => {
  const browser = await open({
    async fetch(request) {
      return Response.json({
        peer: request.headers.get("cf-connecting-ip"),
        xff: request.headers.get("x-forwarded-for"),
        proto: request.headers.get("x-forwarded-proto"),
      });
    },
  });
  const response = await browser.request("/service/api/test", undefined, {
    "cf-connecting-ip": "198.51.100.2",
    "x-forwarded-for": "198.51.100.3",
  });
  expect(await response.json()).toEqual({ peer: browser.ip, xff: null, proto: null });
  for (const extra of [
    { Host: "evil.example.test" },
    { "X-Forwarded-Proto": "http" },
    { "X-ChargeOS-Client-IP": "192.0.2.1, 192.0.2.2" },
    { "X-ChargeOS-Client-IP": "" },
  ])
    expect((await browser.request("/service/api/test", undefined, extra)).status).toBe(403);
});
it("uses real verified signup and secure scoped cookies while rejecting unapproved signup domains", async () => {
  const browser = await open();
  expect((await browser.request("/service/api/v1/health")).status).toBe(200);
  expect(
    (
      await browser.request("/service/api/auth/sign-up/email", {
        email: "outsider@evil.test",
        name: "Outsider",
        password,
      })
    ).status,
  ).toBe(400);
  const person = await account(browser);
  expect(person.login.headers.getSetCookie().join(";")).toContain("Secure");
  expect(person.login.headers.getSetCookie().join(";")).toContain("HttpOnly");
  expect(person.login.headers.getSetCookie().join(";")).toContain("Path=/service/api");
  expect(person.login.headers.getSetCookie().join(";")).not.toContain("Domain=");
  expect((await browser.request("/service/api/v1/me")).status).toBe(200);
  expect(
    (
      await db
        .prepare("SELECT channel FROM local_outbox WHERE recipient=?")
        .bind(person.email)
        .first()
    ).channel,
  ).toBe("smtp");
});
it("serves only company/help/static routes with CSP and never the owner or enrollment application", async () => {
  const ui = join(directory, "ui");
  await mkdir(join(ui, "assets"), { recursive: true });
  await writeFile(
    join(ui, "index.html"),
    '<html lang="en"><head><title>chargeOS owner console</title></head><body>Company UI</body></html>',
  );
  await writeFile(join(ui, "assets/app-test.js"), "console.log('synthetic')");
  const browser = await open(undefined, { uiDirectory: ui });
  const page = await browser.request("/service");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('data-commercial-hosting="production"');
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect((await browser.request("/assets/app-test.js")).status).toBe(200);
  for (const path of [
    "/api/v1/fleet",
    "/preview",
    "/observe",
    "/service/recovery",
    "/service/api/recovery/enrollment/start",
    "/assets/../service.vars",
  ])
    expect((await browser.request(path)).status).toBe(404);
});
it("atomically enforces recipient cooldown and global admission even across concurrent queue requests", async () => {
  const send = (email) =>
    enqueueServiceDelivery(
      env,
      "reset-password",
      email,
      `${origin}/service/api/auth/reset-password/${"a".repeat(32)}`,
      new Date(Date.now() + 60000),
    );
  await Promise.all(Array.from({ length: 8 }, () => send("same@example.test")));
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox").first("n")).toBe(1);
  await Promise.all(
    Array.from({ length: MAIL_PER_MINUTE + 5 }, (_, i) => send(`different-${i}@example.test`)),
  );
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox").first("n")).toBe(
    MAIL_PER_MINUTE,
  );
  expect(
    JSON.stringify((await db.prepare("SELECT key FROM rate_limit").all()).results),
  ).not.toContain("same@example.test");
});
it("bounds pending capacity and refuses new signup before creating an undeliverable account", async () => {
  await db
    .prepare(
      "WITH RECURSIVE slots(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM slots WHERE n<?) INSERT INTO local_outbox(id,kind,recipient,url,created_at,expires_at,channel) SELECT 'full-'||n,'reset-password','synthetic@example.test','https://accounts.example.test/service',1,9999999999999,'smtp' FROM slots",
    )
    .bind(MAX_PENDING_ACCOUNT_MAIL)
    .run();
  const browser = await open();
  expect(
    (
      await browser.request("/service/api/auth/sign-up/email", {
        email: "blocked@example.test",
        name: "Blocked",
        password,
      })
    ).status,
  ).toBe(429);
  expect(await db.prepare("SELECT count(*) AS n FROM user").first("n")).toBe(0);
  await enqueueServiceDelivery(
    env,
    "verify-email",
    "another@example.test",
    `${origin}/service/api/auth/verify-email?token=${"a".repeat(32)}`,
    new Date(Date.now() + 60000),
  );
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox").first("n")).toBe(
    MAX_PENDING_ACCOUNT_MAIL,
  );
});
it("keeps invitation, mail and audit atomic when a recipient cooldown blocks another invitation", async () => {
  const browser = await open();
  await account(browser);
  const result = await browser.request("/service/api/v1/organizations", { name: "Hosted Company" });
  expect(result.status).toBe(201);
  const org = await result.json();
  const path = `/service/api/v1/organizations/${org.id}/invitations`,
    body = { email: "invited@example.test", role: "driver" };
  expect((await browser.request(path, body)).status).toBe(201);
  expect((await browser.request(path, body)).status).toBe(429);
  expect(await db.prepare("SELECT count(*) AS n FROM invitation").first("n")).toBe(1);
  expect(
    await db.prepare("SELECT count(*) AS n FROM local_outbox WHERE kind='invitation'").first("n"),
  ).toBe(1);
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM service_audit WHERE action='invitation.created'")
      .first("n"),
  ).toBe(1);
});

it("reserves the final verification slot before concurrent signup password work", async () => {
  await db
    .prepare(
      "WITH RECURSIVE slots(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM slots WHERE n<?) INSERT INTO local_outbox(id,kind,recipient,url,created_at,expires_at,channel) SELECT 'reserved-cap-'||n,'reset-password','synthetic@example.test','https://accounts.example.test/service',1,9999999999999,'smtp' FROM slots",
    )
    .bind(MAX_PENDING_ACCOUNT_MAIL - 1)
    .run();
  const browsers = await Promise.all([open(), open()]);
  const results = await Promise.all(
    browsers.map((b, i) =>
      b.request("/service/api/auth/sign-up/email", {
        email: `capacity-${i}@example.test`,
        name: "Capacity",
        password,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
  expect(await db.prepare("SELECT count(*) AS n FROM user").first("n")).toBe(1);
  expect(
    await db
      .prepare("SELECT count(*) AS n FROM local_outbox WHERE kind='verify-email' AND url<>''")
      .first("n"),
  ).toBe(1);
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox WHERE url=''").first("n")).toBe(
    0,
  );
});

it("refuses signup before account creation when the verification send budget is exhausted", async () => {
  await db
    .prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES('full-mail','mail-global',?,?)",
    )
    .bind(MAIL_PER_MINUTE, Date.now())
    .run();
  const browser = await open();
  expect(
    (
      await browser.request("/service/api/auth/sign-up/email", {
        email: "no-send@example.test",
        name: "No Send",
        password,
      })
    ).status,
  ).toBe(429);
  expect(await db.prepare("SELECT count(*) AS n FROM user").first("n")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox").first("n")).toBe(0);
});

it("bounds rotating-peer admission and purges only stale rate windows", async () => {
  const { publicRequestAdmission, PUBLIC_REQUESTS_PER_MINUTE, MAX_PUBLIC_RATE_ROWS } =
    await import("../../service/delivery.ts");
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO rate_limit(id,key,count,last_request) VALUES('active-fixture','active-fixture',119,?)",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "WITH RECURSIVE slots(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM slots WHERE n<110) INSERT INTO rate_limit(id,key,count,last_request) SELECT 'stale-'||n,'stale-'||n,1,? FROM slots",
    )
    .bind(now - 120000)
    .run();
  expect(await publicRequestAdmission(env, "192.0.2.50")).toBe(true);
  expect(
    await db.prepare("SELECT count(*) AS n FROM rate_limit WHERE key LIKE 'stale-%'").first("n"),
  ).toBe(10);
  for (let i = 1; i < PUBLIC_REQUESTS_PER_MINUTE; i++)
    expect(await publicRequestAdmission(env, `2001:db8::${i.toString(16)}`)).toBe(true);
  expect(await publicRequestAdmission(env, "2001:db8::ffff")).toBe(false);
  expect(await db.prepare("SELECT count(*) AS n FROM rate_limit").first("n")).toBeLessThan(
    MAX_PUBLIC_RATE_ROWS,
  );
  expect(
    await db.prepare("SELECT count FROM rate_limit WHERE key='active-fixture'").first("count"),
  ).toBe(119);
});

it("never sends an abandoned signup reservation and discards it when it expires", async () => {
  const { publicSignupAdmission } = await import("../../service/delivery.ts");
  const { deliverNativeAccountMail } = await import("../../service/node/mail.ts");
  const id = await publicSignupAdmission(env, "interrupted@example.test");
  expect(id).toBeTruthy();
  const queued = await db
    .prepare("SELECT url,next_attempt_at AS due,expires_at AS expiry FROM local_outbox WHERE id=?")
    .bind(id)
    .first();
  expect(queued.url).toBe("");
  expect(queued.due).toBe(queued.expiry);
  expect(queued.due).toBeGreaterThan(Date.now());
  expect((await deliverNativeAccountMail(env, directory, {})).accepted).toBe(0);
  await db
    .prepare("UPDATE local_outbox SET expires_at=?,next_attempt_at=? WHERE id=?")
    .bind(Date.now() - 1, Date.now() - 1, id)
    .run();
  const counts = await deliverNativeAccountMail(env, directory, {});
  expect(counts).toMatchObject({ accepted: 0, discarded: 1 });
  expect(await db.prepare("SELECT count(*) AS n FROM local_outbox").first("n")).toBe(0);
});
