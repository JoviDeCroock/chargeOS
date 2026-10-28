import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../service/index.js";
import type {
  OrganizationWorkspace,
  ServiceAccount,
  ServiceOrganization,
} from "../../shared/contracts.js";

const origin = "http://127.0.0.1:5173";
const api = "/service/api/v1";
const auth = "/service/api/auth";
const password = "synthetic long password 48!";
let serial = 0;

class Browser {
  cookies = new Map<string, string>();
  ip = `192.0.2.${++serial}`;
  async request(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    extra: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = {
      origin,
      "cf-connecting-ip": this.ip,
      cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      ...extra,
    };
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    const response = await SELF.fetch(new URL(path, origin).href, init);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const index = pair.indexOf("=");
      if (pair.slice(index + 1)) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      else this.cookies.delete(pair.slice(0, index));
    }
    return response;
  }
}
async function outbox(email: string, kind: string) {
  const row = await env.SERVICE_DB.prepare(
    "SELECT url FROM local_outbox WHERE recipient = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, kind)
    .first<{ url: string }>();
  expect(row).not.toBeNull();
  return row!.url;
}
async function registered() {
  const browser = new Browser();
  const email = `person-${crypto.randomUUID()}@example.test`;
  const response = await browser.request(`${auth}/sign-up/email`, {
    email,
    name: "Test Person",
    password,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return { browser, email };
}
async function signedIn() {
  const result = await registered();
  const link = await outbox(result.email, "verify-email");
  const verify = await result.browser.request(link);
  expect([200, 302]).toContain(verify.status);
  const login = await result.browser.request(`${auth}/sign-in/email`, {
    email: result.email,
    password,
  });
  expect(login.status, await login.clone().text()).toBe(200);
  return result;
}
async function createOrganization(browser: Browser, name: string) {
  const response = await browser.request(`${api}/organizations`, { name });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<ServiceOrganization>();
}
async function invite(browser: Browser, org: ServiceOrganization, email: string, role = "finance") {
  const response = await browser.request(`${api}/organizations/${org.id}/invitations`, {
    email,
    role,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const offer = await response.json<{ id: string }>();
  const link = new URL(await outbox(email, "invitation"));
  const token = new URLSearchParams(link.hash.slice(1)).get("invite")!;
  return { ...offer, token };
}

async function totp(uri: string): Promise<string> {
  const secret = new URL(uri).searchParams.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, ""))
    bits += alphabet.indexOf(char.toUpperCase()).toString(2).padStart(5, "0");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
  const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1]! & 15;
  const binary = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return (binary % 1000000).toString().padStart(6, "0");
}

describe("local account service", () => {
  it("fails closed outside the explicit local profile and never accepts owner bearer credentials", async () => {
    const response = await worker.fetch(new Request(`${origin}${api}/health`), {
      ...env,
      SERVICE_MODE: "production",
    });
    expect(response.status).toBe(503);
    const publicHost = await worker.fetch(
      new Request(`https://chargeos.example${api}/health`),
      env,
    );
    expect(publicHost.status).toBe(503);
    expect(
      (
        await new Browser().request(`${api}/me`, undefined, "GET", {
          authorization: `Bearer ${"owner-secret".repeat(5)}`,
        })
      ).status,
    ).toBe(401);
    expect((await new Browser().request(`${api}/local-outbox`)).status).toBe(401);
  });
  it("requires verification, uses scoped HttpOnly cookies, and revokes signed-out sessions immediately", async () => {
    const { browser, email } = await registered();
    expect((await browser.request(`${auth}/sign-in/email`, { email, password })).status).toBe(403);
    expect((await browser.request(`${api}/organizations`, { name: "Unverified" })).status).toBe(
      401,
    );
    await browser.request(await outbox(email, "verify-email"));
    const login = await browser.request(`${auth}/sign-in/email`, { email, password });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().join(";");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/service/api");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    const stolen = new Map(browser.cookies);
    expect((await browser.request(`${api}/me`)).status).toBe(200);
    expect((await browser.request(`${auth}/sign-out`, {})).status).toBe(200);
    browser.cookies = stolen;
    expect((await browser.request(`${api}/me`)).status).toBe(401);
  });
  it("rejects foreign and missing origins, large bodies, and ambiguous organization payloads", async () => {
    const { browser } = await signedIn();
    expect(
      (
        await browser.request(`${api}/organizations`, { name: "No" }, "POST", {
          origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await browser.request(`${api}/organizations`, { name: "No" }, "POST", { origin: "" }))
        .status,
    ).toBe(403);
    expect(
      (await browser.request(`${api}/organizations`, { name: "X".repeat(40000) })).status,
    ).toBe(413);
    expect(
      (await browser.request(`${api}/organizations`, { name: "No", ownerToken: "untrusted" }))
        .status,
    ).toBe(400);
  });
  it("rejects expired sessions without relying on client cookie expiry", async () => {
    const { browser } = await signedIn();
    const me = await (await browser.request(`${api}/me`)).json<ServiceAccount>();
    await env.SERVICE_DB.prepare("UPDATE session SET expires_at = 1 WHERE user_id = ?")
      .bind(me.user.id)
      .run();
    expect((await browser.request(`${api}/me`)).status).toBe(401);
  });
  it("recovers a password once and invalidates all previous sessions", async () => {
    const { browser, email } = await signedIn();
    const oldCookies = new Map(browser.cookies);
    expect(
      (
        await browser.request(`${auth}/request-password-reset`, {
          email,
          redirectTo: `${origin}/service`,
        })
      ).status,
    ).toBe(200);
    const redirect = await browser.request(await outbox(email, "reset-password"));
    expect(redirect.status).toBe(302);
    const resetUrl = new URL(redirect.headers.get("location")!);
    const token = resetUrl.searchParams.get("token");
    expect(token).toBeTruthy();
    const newPassword = "replacement synthetic password 52!";
    expect((await browser.request(`${auth}/reset-password`, { token, newPassword })).status).toBe(
      200,
    );
    browser.cookies = oldCookies;
    expect((await browser.request(`${api}/me`)).status).toBe(401);
    expect(
      (await browser.request(`${auth}/reset-password`, { token, newPassword: password })).status,
    ).not.toBe(200);
    expect(
      (await browser.request(`${auth}/sign-in/email`, { email, password: newPassword })).status,
    ).toBe(200);
  });
  it("rate limits repeated password guesses in SQL storage", async () => {
    const browser = new Browser();
    const statuses: number[] = [];
    for (let index = 0; index < 7; index++)
      statuses.push(
        (await browser.request(`${auth}/sign-in/email`, { email: "absent@example.test", password }))
          .status,
      );
    expect(statuses).toContain(429);
    const counters = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM rate_limit",
    ).first<{ count: number }>();
    expect(counters!.count).toBeGreaterThan(0);
  }, 20000);
  it("requires authenticator proof before enabling MFA and consumes recovery codes only once", async () => {
    const { browser, email } = await signedIn();
    const response = await browser.request(`${auth}/two-factor/enable`, {
      password,
      method: "totp",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const enrollment = await response.json<{ totpURI: string; backupCodes: string[] }>();
    expect(
      (await (await browser.request(`${api}/me`)).json<ServiceAccount>()).user.twoFactorEnabled,
    ).toBe(false);
    expect(
      (
        await browser.request(`${auth}/two-factor/verify-totp`, {
          code: await totp(enrollment.totpURI),
          trustDevice: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await browser.request(`${api}/me`)).json<ServiceAccount>()).user.twoFactorEnabled,
    ).toBe(true);
    await browser.request(`${auth}/sign-out`, {});
    const challenge = await (
      await browser.request(`${auth}/sign-in/email`, { email, password })
    ).json<{ twoFactorRedirect: boolean }>();
    expect(challenge.twoFactorRedirect).toBe(true);
    expect((await browser.request(`${api}/me`)).status).toBe(401);
    expect(
      (
        await browser.request(`${auth}/two-factor/verify-totp`, {
          code: "bad-code",
          trustDevice: false,
        })
      ).status,
    ).not.toBe(200);
    const recoveryCode = enrollment.backupCodes[0]!;
    expect(
      (
        await browser.request(`${auth}/two-factor/verify-backup-code`, {
          code: recoveryCode,
          trustDevice: false,
        })
      ).status,
    ).toBe(200);
    expect((await browser.request(`${api}/me`)).status).toBe(200);
    await browser.request(`${auth}/sign-out`, {});
    await browser.request(`${auth}/sign-in/email`, { email, password });
    expect(
      (
        await browser.request(`${auth}/two-factor/verify-backup-code`, {
          code: recoveryCode,
          trustDevice: false,
        })
      ).status,
    ).not.toBe(200);
    expect((await browser.request(`${api}/me`)).status).toBe(401);
    expect(
      (
        await browser.request(`${auth}/two-factor/verify-totp`, {
          code: await totp(enrollment.totpURI),
          trustDevice: false,
        })
      ).status,
    ).toBe(200);
  });
});

describe("organization boundary", () => {
  it("persists organizations and refuses unrelated tenant reads, writes, audit, and guessed resource IDs", async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const org = await createOrganization(owner.browser, "Employer One");
    const account = await (await owner.browser.request(`${api}/me`)).json<ServiceAccount>();
    expect(account.organizations).toEqual([org]);
    for (const path of ["", "/audit"])
      expect((await stranger.browser.request(`${api}/organizations/${org.id}${path}`)).status).toBe(
        404,
      );
    expect(
      (
        await stranger.browser.request(`${api}/organizations/${org.id}/invitations`, {
          email: stranger.email,
          role: "finance",
        })
      ).status,
    ).toBe(404);
    expect((await owner.browser.request(`${api}/organizations/not-an-organization`)).status).toBe(
      404,
    );
    const workspace = await (
      await owner.browser.request(`${api}/organizations/${org.id}`)
    ).json<OrganizationWorkspace>();
    expect(workspace.members).toHaveLength(1);
    expect(workspace.members[0]?.role).toBe("admin");
  });
  it("binds single-use invitations to verified email, restricts roles, and removes access immediately", async () => {
    const admin = await signedIn();
    const finance = await signedIn();
    const wrongPerson = await signedIn();
    const org = await createOrganization(admin.browser, "Employer Two");
    expect(
      (
        await admin.browser.request(`${api}/organizations/${org.id}/invitations`, {
          email: finance.email,
          role: "admin",
        })
      ).status,
    ).toBe(400);
    const offer = await invite(admin.browser, org, finance.email);
    expect(
      (await wrongPerson.browser.request(`${api}/invitations/accept`, { token: offer.token }))
        .status,
    ).toBe(400);
    expect(
      (await finance.browser.request(`${api}/invitations/accept`, { token: offer.token })).status,
    ).toBe(200);
    expect(
      (await finance.browser.request(`${api}/invitations/accept`, { token: offer.token })).status,
    ).toBe(400);
    const view = await (
      await finance.browser.request(`${api}/organizations/${org.id}`)
    ).json<OrganizationWorkspace>();
    expect(view.organization.role).toBe("finance");
    expect(view.members).toEqual([]);
    expect(view.invitations).toEqual([]);
    expect(
      (
        await finance.browser.request(`${api}/organizations/${org.id}/invitations`, {
          email: wrongPerson.email,
          role: "driver",
        })
      ).status,
    ).toBe(403);
    expect((await finance.browser.request(`${api}/organizations/${org.id}/audit`)).status).toBe(
      403,
    );
    const workspace = await (
      await admin.browser.request(`${api}/organizations/${org.id}`)
    ).json<OrganizationWorkspace>();
    const member = workspace.members.find((entry) => entry.email === finance.email)!;
    const creator = workspace.members.find((entry) => entry.email === admin.email)!;
    expect(
      (
        await admin.browser.request(
          `${api}/organizations/${org.id}/members/${creator.id}`,
          {},
          "DELETE",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await admin.browser.request(
          `${api}/organizations/${org.id}/members/${member.id}`,
          {},
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect((await finance.browser.request(`${api}/organizations/${org.id}`)).status).toBe(404);
    const audit = await (
      await admin.browser.request(`${api}/organizations/${org.id}/audit`)
    ).text();
    expect(audit).toContain("invitation.accepted");
    expect(audit).toContain("membership.removed");
    expect(audit).not.toContain(offer.token);
    const stored = await env.SERVICE_DB.prepare("SELECT token_hash FROM invitation WHERE id = ?")
      .bind(offer.id)
      .first<{ token_hash: string }>();
    expect(stored!.token_hash).not.toBe(offer.token);
  });
  it("rejects revoked, expired, and concurrent invitation replays", async () => {
    const admin = await signedIn();
    const person = await signedIn();
    const org = await createOrganization(admin.browser, "Employer Three");
    const revoked = await invite(admin.browser, org, person.email);
    expect(
      (
        await admin.browser.request(
          `${api}/organizations/${org.id}/invitations/${revoked.id}`,
          {},
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (await person.browser.request(`${api}/invitations/accept`, { token: revoked.token })).status,
    ).toBe(400);
    const expired = await invite(admin.browser, org, person.email);
    await env.SERVICE_DB.prepare("UPDATE invitation SET expires_at = 1 WHERE id = ?")
      .bind(expired.id)
      .run();
    expect(
      (await person.browser.request(`${api}/invitations/accept`, { token: expired.token })).status,
    ).toBe(400);
    const valid = await invite(admin.browser, org, person.email, "driver");
    const attempts = await Promise.all([
      person.browser.request(`${api}/invitations/accept`, { token: valid.token }),
      person.browser.request(`${api}/invitations/accept`, { token: valid.token }),
    ]);
    expect(attempts.map((entry) => entry.status).sort()).toEqual([200, 400]);
    const rows = await env.SERVICE_DB.prepare(
      "SELECT count(*) AS count FROM membership WHERE organization_id = ?",
    )
      .bind(org.id)
      .first<{ count: number }>();
    expect(rows!.count).toBe(2);
  });
});
