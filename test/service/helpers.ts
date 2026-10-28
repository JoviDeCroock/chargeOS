import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { ServiceOrganization } from "../../shared/contracts.js";
export const origin = "http://127.0.0.1:5173";
export const api = "/service/api/v1";
export const auth = "/service/api/auth";
export const password = "synthetic long password 48!";
let serial = 0;

export class Browser {
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
export async function outbox(email: string, kind: string) {
  const row = await env.SERVICE_DB.prepare(
    "SELECT url FROM local_outbox WHERE recipient = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(email, kind)
    .first<{ url: string }>();
  expect(row).not.toBeNull();
  return row!.url;
}
export async function registered() {
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
export async function signedIn() {
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
export async function createOrganization(browser: Browser, name: string) {
  const response = await browser.request(`${api}/organizations`, { name });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<ServiceOrganization>();
}
export async function invite(
  browser: Browser,
  org: ServiceOrganization,
  email: string,
  role = "finance",
) {
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

export async function totp(uri: string): Promise<string> {
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
