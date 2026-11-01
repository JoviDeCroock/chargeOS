import { afterEach, expect, it } from "vitest";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeCompanyCredentials } from "../../service/node/company-bootstrap.ts";

const roots = [];
const auth = "a".repeat(64),
  smtp = JSON.stringify({
    format: "chargeos-smtp",
    schemaVersion: 1,
    host: "smtp.example.test",
    port: 587,
    security: "starttls",
    username: "synthetic-user",
    password: "synthetic-password",
    sender: "accounts@example.test",
    caFile: null,
  });
function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chargeos-bootstrap-")));
  roots.push(root);
  chmodSync(root, 0o700);
  return root;
}
function existing(root, name, value) {
  writeFileSync(join(root, name), value, { mode: 0o444, flag: "wx" });
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("creates durable read-only files and preserves their identity on exact restart", () => {
  const root = directory();
  initializeCompanyCredentials(root, auth, smtp);
  const before = lstatSync(join(root, "company_auth"));
  initializeCompanyCredentials(root, auth, smtp);
  expect(lstatSync(join(root, "company_auth")).ino).toBe(before.ino);
  for (const [name, value] of [
    ["company_auth", auth],
    ["company_smtp", smtp],
  ]) {
    expect(readFileSync(join(root, name), "utf8")).toBe(value);
    expect(lstatSync(join(root, name)).mode & 0o777).toBe(0o444);
  }
});
it("completes an interrupted pair only when every surviving file matches", () => {
  for (const [name, value] of [
    ["company_auth", auth],
    ["company_smtp", smtp],
  ]) {
    const root = directory();
    existing(root, name, value);
    initializeCompanyCredentials(root, auth, smtp);
    expect(readFileSync(join(root, "company_auth"), "utf8")).toBe(auth);
    expect(readFileSync(join(root, "company_smtp"), "utf8")).toBe(smtp);
  }
  const root = directory();
  existing(root, "company_smtp", smtp + " ");
  expect(() => initializeCompanyCredentials(root, auth, smtp)).toThrow();
  expect(() => lstatSync(join(root, "company_auth"))).toThrow();
  expect(readFileSync(join(root, "company_smtp"), "utf8")).toBe(smtp + " ");
});
it("refuses key or SMTP changes without modifying either credential", () => {
  const root = directory();
  initializeCompanyCredentials(root, auth, smtp);
  for (const [key, mail] of [
    ["b".repeat(64), smtp],
    [auth, smtp.replace("synthetic-password", "changed-password")],
  ]) {
    expect(() => initializeCompanyCredentials(root, key, mail)).toThrow();
    expect(readFileSync(join(root, "company_auth"), "utf8")).toBe(auth);
    expect(readFileSync(join(root, "company_smtp"), "utf8")).toBe(smtp);
  }
});
it("rejects writable files, links, shared directories and stale custody", () => {
  for (const kind of ["writable", "symlink", "hardlink", "directory", "lock"]) {
    const root = directory();
    if (kind === "directory") chmodSync(root, 0o755);
    else if (kind === "lock") mkdirSync(join(root, ".company-bootstrap"));
    else if (kind === "writable") writeFileSync(join(root, "company_auth"), auth, { mode: 0o600 });
    else {
      existing(root, "other", auth);
      if (kind === "symlink") symlinkSync("other", join(root, "company_auth"));
      else linkSync(join(root, "other"), join(root, "company_auth"));
    }
    expect(() => initializeCompanyCredentials(root, auth, smtp)).toThrow();
    expect(() => lstatSync(join(root, "company_smtp"))).toThrow();
  }
  const root = directory();
  symlinkSync(root, join(root, "alias"));
  expect(() => initializeCompanyCredentials(join(root, "alias"), auth, smtp)).toThrow();
});
it("validates bounded credentials and verified-TLS mail before creating files", () => {
  const value = JSON.parse(smtp);
  for (const [key, mail] of [
    ["short", smtp],
    [auth, "{"],
    [auth, JSON.stringify({ ...value, security: "plaintext" })],
    [auth, JSON.stringify({ ...value, caFile: "/private/arbitrary" })],
    [auth, JSON.stringify({ ...value, extra: true })],
    [auth, smtp + " ".repeat(16384)],
  ]) {
    const root = directory();
    expect(() => initializeCompanyCredentials(root, key, mail)).toThrow();
    expect(() => lstatSync(join(root, "company_auth"))).toThrow();
  }
});
