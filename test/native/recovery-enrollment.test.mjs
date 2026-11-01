import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { enrollmentFixture } from "./enrollment-fixture.mjs";
import { totp } from "../service/helpers.ts";
import { withNativeRecoveryCustody } from "../../service/node/recovery-review.ts";
import {
  issueNativeRecoveryEnrollment,
  reissueNativeRecoveryEnrollmentUser,
  readEnrollmentState,
} from "../../service/node/recovery-enrollment-state.ts";
import { createNativeRecoveryEnrollment } from "../../service/node/recovery-enrollment.ts";
import { createNativeCommercialServer } from "../../service/node/http.ts";
import { NativeCommercialDatabase } from "../../service/node/sqlite.ts";

const api = "/service/api/recovery/enrollment",
  newPassword = "a new synthetic recovery password!";
let f, links, initialState, adminUri, financeUri;
beforeAll(async () => {
  f = await enrollmentFixture();
  const output = join(f.directory, "private-links.json");
  expect(
    await issueNativeRecoveryEnrollment(f.configuration, f.data, f.manifest, output),
  ).toMatchObject({ users: 2, reopeningAllowed: false });
  links = JSON.parse(await readFile(output, "utf8")).links;
  initialState = await readFile(join(f.data, ".recovery-enrollment.json"), "utf8");
}, 60000);
afterAll(async () => {
  await rm(f.directory, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  const database = new NativeCommercialDatabase(f.data, { recoveryInspection: true });
  try {
    await database.prepare("DELETE FROM rate_limit").run();
  } finally {
    database.close();
  }
});
class Browser {
  cookies = new Map();
  constructor(base) {
    this.base = base;
  }
  async request(path, body, extra = {}) {
    const response = await fetch(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: f.configuration.SERVICE_ORIGIN,
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0],
        at = pair.indexOf("=");
      if (pair.slice(at + 1)) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
      else this.cookies.delete(pair.slice(0, at));
    }
    return response;
  }
}
const token = (email) =>
  new URLSearchParams(new URL(links.find((link) => link.email === email).url).hash.slice(1)).get(
    "enroll",
  );
async function server(run) {
  return withNativeRecoveryCustody(f.data, async () => {
    const enrollment = await createNativeRecoveryEnrollment(f.data, f.manifest, f.configuration),
      http = createNativeCommercialServer(
        { ...f.configuration, SERVICE_DB: enrollment.database },
        enrollment.handler,
      ),
      port = await http.listen(0);
    try {
      return await run(new Browser(`http://127.0.0.1:${port}`), enrollment);
    } finally {
      await http.close();
      enrollment.close();
    }
  });
}

it("sets a fresh password and verifies a new authenticator with scoped cookies, then signs in again with fresh MFA while quarantine remains closed", async () => {
  await server(async (browser) => {
    const started = await browser.request(`${api}/start`, {
      token: token(f.company.admin.email),
      newPassword,
    });
    expect(started.status, await started.clone().text()).toBe(200);
    expect((await started.json()).challengeRequired).toBe(false);
    expect(
      [...browser.cookies.keys()].some((name) => name === "chargeos-recovery.session_token"),
    ).toBe(true);
    expect((await (await browser.request(`${api}/status`)).json()).phase).toBe("set-authenticator");
    const response = await browser.request(`${api}/authenticator`, { password: newPassword });
    expect(response.status, await response.clone().text()).toBe(200);
    const setup = await response.json();
    adminUri = setup.totpURI;
    expect(setup.backupCodes.length).toBeGreaterThan(0);
    const verified = await browser.request(`${api}/verify`, { code: await totp(setup.totpURI) });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(await (await browser.request(`${api}/status`)).json()).toMatchObject({
      phase: "ready",
      user: { email: f.company.admin.email },
      reopeningAllowed: false,
    });
    expect((await browser.request(`${api}/sign-out`, {})).status).toBe(200);
    const login = await browser.request(`${api}/sign-in`, {
      email: f.company.admin.email,
      password: newPassword,
    });
    expect(login.status, await login.clone().text()).toBe(200);
    expect((await login.json()).challengeRequired).toBe(true);
    expect((await browser.request(`${api}/status`)).status).toBe(401);
    expect(
      (await browser.request(`${api}/verify`, { code: await totp(setup.totpURI) })).status,
    ).toBe(200);
    expect((await (await browser.request(`${api}/status`)).json()).phase).toBe("ready");
    expect([...browser.cookies.keys()].some((name) => name.includes("trust_device"))).toBe(false);
  });
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
  const state = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  expect(state.users.find((user) => user.email === f.company.admin.email)).toMatchObject({
    phase: "ready",
    tokenSha256: null,
  });
  expect(JSON.stringify(state)).not.toContain(newPassword);
  expect(JSON.stringify(state)).not.toContain(token(f.company.admin.email));
});

it("rejects replay, browser-selected identities, old passwords, foreign origins and every ordinary auth/business route", async () => {
  await server(async (browser) => {
    expect(
      (await browser.request(`${api}/start`, { token: token(f.company.admin.email), newPassword }))
        .status,
    ).toBe(401);
    expect(
      (
        await browser.request(`${api}/start`, {
          token: token(f.company.finance.email),
          newPassword,
          userId: "another-user",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await browser.request(`${api}/sign-in`, {
          email: f.company.driver.email,
          password: newPassword,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser.request(`${api}/sign-in`, {
          email: f.company.admin.email,
          password: "old synthetic original password",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser.request(
          `${api}/start`,
          { token: token(f.company.finance.email), newPassword },
          { Origin: "https://attacker.example" },
        )
      ).status,
    ).toBe(403);
    for (const route of [
      "/service/api/auth/sign-up/email",
      "/service/api/auth/sign-in/email",
      "/service/api/auth/request-password-reset",
      "/service/api/auth/two-factor/disable",
      "/service/api/auth/two-factor/verify-backup-code",
      "/service/api/v1/organizations",
      `${f.company.root}/statements`,
    ])
      expect((await browser.request(route, {})).status).toBe(404);
    expect((await browser.request(`${api}/info?token=forbidden`)).status).toBe(404);
    const denied = await browser.request(`${api}/start`, { token: "a".repeat(64), newPassword });
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(denied.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

it("serializes duplicate claims and never accepts trusted-device or alternate authenticator options", async () => {
  await server(async (browser) => {
    const results = await Promise.all([
      browser.request(`${api}/start`, { token: token(f.company.finance.email), newPassword }),
      browser.request(`${api}/start`, { token: token(f.company.finance.email), newPassword }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 429]);
    const enabled = await browser.request(`${api}/authenticator`, { password: newPassword });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const setup = await enabled.json();
    financeUri = setup.totpURI;
    expect(
      (
        await browser.request(`${api}/verify`, {
          code: await totp(setup.totpURI),
          trustDevice: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (await browser.request(`${api}/authenticator`, { password: newPassword, method: "otp" }))
        .status,
    ).toBe(400);
    expect(
      (await browser.request(`${api}/verify`, { code: await totp(setup.totpURI) })).status,
    ).toBe(200);
  });
});

it("authenticates progress and refuses an older valid issued state when credentials already exist", async () => {
  const path = join(f.data, ".recovery-enrollment.json"),
    current = await readFile(path, "utf8");
  const changed = JSON.parse(current);
  changed.state.users[0].email = "unreviewed@example.test";
  await writeFile(path, JSON.stringify(changed));
  await expect(server(async () => {})).rejects.toThrow(/authentication/);
  await writeFile(path, initialState);
  await server(async (browser) => {
    const response = await browser.request(`${api}/start`, {
      token: token(f.company.admin.email),
      newPassword,
    });
    expect(response.status).toBe(409);
  });
  await writeFile(path, current);
});

it("binds pre-session challenges to one reviewed user and exact factor cookie", async () => {
  await server(async (alice) => {
    const bob = new Browser(alice.base);
    expect(
      (
        await alice.request(`${api}/sign-in`, {
          email: f.company.admin.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await bob.request(`${api}/sign-in`, {
          email: f.company.finance.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    const ownFactor = alice.cookies.get("chargeos-recovery.two_factor");
    const ambiguous = [
      `chargeos-recovery.two_factor=${bob.cookies.get("chargeos-recovery.two_factor")}`,
      ...[...alice.cookies]
        .filter(([name]) => name !== "chargeos-recovery.two_factor")
        .map(([name, value]) => `${name}=${value}`),
      `chargeos-recovery.two_factor=${ownFactor}`,
    ].join("; ");
    expect(
      (
        await alice.request(
          `${api}/verify`,
          { code: await totp(financeUri) },
          { Cookie: ambiguous },
        )
      ).status,
    ).toBe(401);
    alice.cookies.set(
      "chargeos-recovery.two_factor",
      bob.cookies.get("chargeos-recovery.two_factor"),
    );
    expect((await alice.request(`${api}/verify`, { code: await totp(financeUri) })).status).toBe(
      401,
    );
    alice.cookies.set("chargeos-recovery.two_factor", ownFactor);
    expect((await alice.request(`${api}/verify`, { code: await totp(adminUri) })).status).toBe(200);
    expect((await bob.request(`${api}/verify`, { code: await totp(financeUri) })).status).toBe(200);
  });
});

it("reissues one reviewed person's link without clearing another person's verified setup, and reserves occupied outputs before credential changes", async () => {
  const before = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  const admin = before.users.find((user) => user.email === f.company.admin.email);
  const existing = join(f.directory, "occupied-links.json");
  await writeFile(existing, "keep", { mode: 0o600 });
  await expect(
    reissueNativeRecoveryEnrollmentUser(
      f.configuration,
      f.data,
      f.manifest,
      f.company.finance.email,
      existing,
    ),
  ).rejects.toThrow();
  expect((await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state).toEqual(
    before,
  );
  const output = join(f.directory, "replacement-finance-link.json");
  await reissueNativeRecoveryEnrollmentUser(
    f.configuration,
    f.data,
    f.manifest,
    f.company.finance.email,
    output,
  );
  const replacement = JSON.parse(await readFile(output, "utf8")).links[0];
  const current = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  expect(current.users.find((user) => user.email === f.company.admin.email)).toEqual(admin);
  expect(current.users.find((user) => user.email === f.company.finance.email)).toMatchObject({
    phase: "issued",
    readySha256: null,
    passwordSha256: null,
    totpSha256: null,
  });
  await server(async (browser) => {
    expect(
      (
        await browser.request(`${api}/start`, {
          token: token(f.company.finance.email),
          newPassword,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser.request(`${api}/sign-in`, {
          email: f.company.finance.email,
          password: newPassword,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser.request(`${api}/sign-in`, {
          email: f.company.admin.email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
  });
  links = links.map((link) => (link.email === replacement.email ? replacement : link));
});

it("fails closed when credential commit succeeds but authenticated progress cannot be persisted", async () => {
  const handle = await (
      await import("node:fs/promises")
    ).open(join(f.data, ".recovery-enrollment.json"), "r"),
    prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const original = prototype.writeFile;
  const spy = vi.spyOn(prototype, "writeFile").mockImplementation(async function (
    bytes,
    ...options
  ) {
    if (typeof bytes === "string" && bytes.includes('"phase":"password-set"'))
      throw new Error("synthetic state write failure");
    return original.call(this, bytes, ...options);
  });
  try {
    await server(async (browser) => {
      const response = await browser.request(`${api}/start`, {
        token: token(f.company.finance.email),
        newPassword,
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(newPassword);
      expect((await browser.request(`${api}/info`)).status).toBe(503);
    });
  } finally {
    spy.mockRestore();
  }
  const progress = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  expect(progress.users.find((user) => user.email === f.company.finance.email).phase).toBe(
    "failed",
  );
  await server(async (browser) => {
    expect(
      (
        await browser.request(`${api}/sign-in`, {
          email: f.company.finance.email,
          password: newPassword,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await browser.request(`${api}/start`, {
          token: token(f.company.finance.email),
          newPassword,
        })
      ).status,
    ).toBe(401);
  });
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
});

it("applies password and verification rate limits to the real peer despite spoofed proxy headers", async () => {
  await server(async (browser) => {
    for (let index = 0; index < 5; index++)
      expect(
        (
          await browser.request(
            `${api}/sign-in`,
            { email: "not-reviewed@example.test", password: newPassword },
            { "cf-connecting-ip": `192.0.2.${index}`, "x-forwarded-for": `198.51.100.${index}` },
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await browser.request(
          `${api}/sign-in`,
          { email: f.company.admin.email, password: newPassword },
          { "cf-connecting-ip": "203.0.113.99" },
        )
      ).status,
    ).toBe(429);
    for (let index = 0; index < 5; index++)
      expect(
        (
          await browser.request(
            `${api}/verify`,
            { code: "000000" },
            { "cf-connecting-ip": `192.0.2.${index}` },
          )
        ).status,
      ).toBe(401);
    const denied = await browser.request(`${api}/verify`, { code: "000000" });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("cache-control")).toBe("no-store");
  });
});

it("starts a new reviewed epoch by clearing every prior credential, including a previously enrolled person no longer kept", async () => {
  const manifest = JSON.parse(await readFile(f.manifest, "utf8"));
  for (const organization of manifest.organizations) {
    const removed = organization.members.find((member) => member.email === f.company.finance.email);
    if (removed) {
      removed.decision = "remove";
      removed.identityEvidenceFile = "";
    }
  }
  const path = join(f.directory, "changed-review.json"),
    output = join(f.directory, "new-epoch-links.json");
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
  const previous = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  expect(
    await issueNativeRecoveryEnrollment(f.configuration, f.data, path, output, true),
  ).toMatchObject({ users: 1, reopeningAllowed: false });
  const next = (await readEnrollmentState(f.data, f.configuration.SERVICE_AUTH_SECRET)).state;
  expect(next.epoch).not.toBe(previous.epoch);
  expect(next.users).toHaveLength(1);
  expect(next.users[0]).toMatchObject({
    email: f.company.admin.email,
    phase: "issued",
    readySha256: null,
  });
  const database = new NativeCommercialDatabase(f.data, { recoveryInspection: true });
  try {
    expect(await database.prepare("SELECT count(*) AS total FROM account").first("total")).toBe(0);
    expect(await database.prepare("SELECT count(*) AS total FROM two_factor").first("total")).toBe(
      0,
    );
    expect(
      await database
        .prepare(
          "SELECT count(*) AS total FROM user WHERE email_verified!=0 OR two_factor_enabled!=0",
        )
        .first("total"),
    ).toBe(0);
  } finally {
    database.close();
  }
  expect(() => new NativeCommercialDatabase(f.data)).toThrow(/quarantined/);
});
