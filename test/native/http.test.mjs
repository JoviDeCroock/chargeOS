import { request as httpRequest } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createNativeCommercialServer } from "../../service/node/http.ts";
import { env } from "./env.mjs";
import { totp } from "../service/helpers.ts";

let server;
afterEach(async () => {
  await server?.close();
  server = undefined;
});
async function open() {
  server = createNativeCommercialServer(env);
  return `http://127.0.0.1:${await server.listen(0)}`;
}
const password = "synthetic native service password!";
it("drains async handlers after a client disconnect before reporting shutdown complete", async () => {
  let enter,
    finish,
    completed = false;
  const entered = new Promise((resolve) => {
      enter = resolve;
    }),
    gate = new Promise((resolve) => {
      finish = resolve;
    });
  server = createNativeCommercialServer(env, {
    async fetch() {
      enter();
      await gate;
      await env.SERVICE_DB.prepare(
        "INSERT INTO local_outbox(id,kind,recipient,url,created_at,expires_at) VALUES('drain-test','verify-email','synthetic@example.test','http://127.0.0.1:5173/service',0,1)",
      ).run();
      completed = true;
      return Response.json({ complete: true });
    },
  });
  const port = await server.listen(0);
  const client = httpRequest({ hostname: "127.0.0.1", port, path: "/service/api/drain-test" });
  client.on("error", () => {});
  client.end();
  await entered;
  client.destroy();
  let settled = false;
  const stopped = server.close().then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(settled).toBe(false);
  expect(completed).toBe(false);
  finish();
  await stopped;
  expect(completed).toBe(true);
});
class Browser {
  cookies = new Map();
  constructor(base) {
    this.base = base;
  }
  async request(path, body, method = body === undefined ? "GET" : "POST", extra = {}) {
    const target = new URL(path, env.SERVICE_ORIGIN);
    const response = await fetch(`${this.base}${target.pathname}${target.search}`, {
      method,
      redirect: "manual",
      headers: {
        Origin: env.SERVICE_ORIGIN,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        ...extra,
      },
      ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        index = pair.indexOf("=");
      if (pair.slice(index + 1)) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      else this.cookies.delete(pair.slice(0, index));
    }
    return response;
  }
}
it("preserves the real password/verification/MFA cookie lifecycle through native HTTP", async () => {
  const browser = new Browser(await open());
  const root = "/service/api",
    email = `native-http-${crypto.randomUUID()}@example.test`;
  const signup = await browser.request(`${root}/auth/sign-up/email`, {
    email,
    name: "Synthetic Native Person",
    password,
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const delivery = await env.SERVICE_DB.prepare(
    "SELECT url FROM local_outbox WHERE recipient=? AND kind='verify-email'",
  )
    .bind(email)
    .first();
  expect([200, 302]).toContain((await browser.request(delivery.url)).status);
  const login = await browser.request(`${root}/auth/sign-in/email`, { email, password });
  expect(login.status).toBe(200);
  expect(login.headers.getSetCookie().join(";")).toContain("HttpOnly");
  expect(login.headers.getSetCookie().join(";")).toContain("Path=/service/api");
  expect((await browser.request(`${root}/v1/me`)).status).toBe(200);
  const enrollment = await browser.request(`${root}/auth/two-factor/enable`, {
    password,
    method: "totp",
  });
  expect(enrollment.status).toBe(200);
  const { totpURI } = await enrollment.json();
  expect(
    (
      await browser.request(`${root}/auth/two-factor/verify-totp`, {
        code: await totp(totpURI),
        trustDevice: false,
      })
    ).status,
  ).toBe(200);
  await browser.request(`${root}/auth/sign-out`, {});
  expect((await browser.request(`${root}/v1/me`)).status).toBe(401);
  const challenge = await browser.request(`${root}/auth/sign-in/email`, { email, password });
  expect((await challenge.json()).twoFactorRedirect).toBe(true);
  expect((await browser.request(`${root}/v1/me`)).status).toBe(401);
  expect(
    (
      await browser.request(`${root}/auth/two-factor/verify-totp`, {
        code: await totp(totpURI),
        trustDevice: false,
      })
    ).status,
  ).toBe(200);
  expect((await browser.request(`${root}/v1/me`)).status).toBe(200);
  expect((await browser.request(`${root}/v1/local-outbox`)).status).toBe(404);
  const org = await browser.request(`${root}/v1/organizations`, { name: "Native HTTP employer" });
  expect(org.status).toBe(201);
}, 20000);
it("rejects foreign Host/origin, absolute targets and oversized bodies without exposing the owner edge", async () => {
  const base = await open(),
    browser = new Browser(base);
  const send = (path, host) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(
        base,
        { method: "GET", path, headers: { Host: host } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
  expect(await send("/service/api/v1/health", "foreign.example")).toBe(403);
  expect(await send("http://foreign.example/service/api/v1/health", new URL(base).host)).toBe(404);
  expect((await browser.request("/api/v1/fleet")).status).toBe(404);
  expect(
    (
      await browser.request("/service/api/v1/organizations", { name: "forged" }, "POST", {
        Origin: "https://foreign.example",
      })
    ).status,
  ).toBe(403);
  const tooLarge = await fetch(`${base}/service/api/auth/sign-in/email`, {
    method: "POST",
    headers: { Origin: env.SERVICE_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(524289) }),
  });
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.headers.get("Cache-Control")).toBe("no-store");
});
it("uses the real socket peer for auth limits instead of caller-supplied proxy headers", async () => {
  const browser = new Browser(await open());
  const statuses = [];
  for (let attempt = 0; attempt < 7; attempt++)
    statuses.push(
      (
        await browser.request(
          "/service/api/auth/sign-in/email",
          { email: "absent@example.test", password },
          "POST",
          {
            "cf-connecting-ip": `198.51.100.${attempt}`,
            "x-forwarded-for": `203.0.113.${attempt}`,
          },
        )
      ).status,
    );
  expect(statuses).toContain(429);
  const rows = await env.SERVICE_DB.prepare("SELECT key FROM rate_limit").all();
  expect(JSON.stringify(rows.results)).not.toContain("198.51.100");
  expect(JSON.stringify(rows.results)).not.toContain("203.0.113");
}, 20000);
