import { mkdtemp, readFile, lstat, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import {
  companyDeploymentInput,
  prepareCompanyDeployment,
} from "../scripts/company-deployment.mjs";
import { createSetupServer } from "../scripts/deploy.mjs";

const raw = (extra = {}) => ({
  name: "synthetic-accounts",
  companyDomain: "accounts.example.be",
  signupDomains: "example.be, branch.example.be",
  email: "operator@example.test",
  smtpHost: "smtp.example.test",
  smtpPort: "587",
  smtpSecurity: "starttls",
  smtpUsername: "private-synthetic-user",
  smtpPassword: "private $() ' \" synthetic password!",
  smtpSender: "accounts@example.test",
  deploy: false,
  ...extra,
});
const localDocker = { context: "synthetic-local", endpoint: "unix:///synthetic/docker.sock" };
const local = { dockerDestination: async () => localDocker, dockerProbe: async () => {} };
const directories = [];
let server;
afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function temp() {
  const path = await mkdtemp(join(tmpdir(), "chargeos-company-setup-"));
  directories.push(path);
  return path;
}

it("rejects an unsupported Docker destination before reserving a package or starting software", async () => {
  const companyPrepare = vi.fn(),
    docker = vi.fn();
  const { DeploymentError } = await import("../scripts/deployment.mjs");
  server = createSetupServer({
    companyPrepare,
    docker,
    dockerDestination: async () => {
      throw new DeploymentError("Choose a local Docker context");
    },
  });
  const { origin, url } = await server.listen();
  const response = await fetch(`${origin}/deploy/company`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Setup-Token": new URL(url).hash.slice(1),
    },
    body: JSON.stringify(raw({ deploy: true })),
  });
  expect(response.status).toBe(400);
  expect(companyPrepare).not.toHaveBeenCalled();
  expect(docker).not.toHaveBeenCalled();
});

it("accepts exact normalized work domains and required TLS without accepting owner, cloud, path or command fields", () => {
  for (const extra of [
    { name: "../escape" },
    { companyDomain: "https://accounts.be" },
    { companyDomain: "accounts.local" },
    { companyDomain: "127.0.0.1" },
    { companyDomain: "ok.be\nrespond 200" },
    { signupDomains: "*.example.be" },
    { signupDomains: "person@example.be" },
    { signupDomains: "example.be," },
    { smtpHost: "smtp.example.be/path" },
    { smtpPort: "587; touch /tmp/no" },
    { smtpPort: "0" },
    { smtpPort: "65536" },
    { smtpPort: 587 },
    { smtpSecurity: "none" },
    { smtpPassword: "line\nbreak" },
    { smtpUsername: "" },
    { email: "ops@example.be\nadmin off" },
    { smtpSender: "Team <ops@example.be>" },
    { deploy: "true" },
    { ownerTag: "unused" },
    { cloudToken: "must-never-be-accepted-here" },
    { SERVICE_AUTH_SECRET: "injected" },
  ])
    expect(() => companyDeploymentInput(raw(extra))).toThrow();
  expect(
    companyDeploymentInput(raw({ signupDomains: "EXAMPLE.BE, branch.example.be, example.be" }))
      .signupDomains,
  ).toEqual(["example.be", "branch.example.be"]);
  expect(companyDeploymentInput(raw()).smtp).toMatchObject({
    port: 587,
    caFile: null,
    security: "starttls",
  });
});

it("generates a fresh private company package from the canonical model with no credentials in Compose or receipts", async () => {
  const parent = await temp(),
    input = companyDeploymentInput(raw());
  const first = await prepareCompanyDeployment(input, parent);
  const { directory, model, receipt } = first;
  expect((await lstat(directory)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(directory, "secrets"))).mode & 0o777).toBe(0o700);
  for (const name of ["company_auth", "company_smtp"])
    expect((await lstat(join(directory, "secrets", name))).mode & 0o777).toBe(0o444);
  expect((await lstat(join(directory, "setup.json"))).mode & 0o777).toBe(0o600);
  expect((await lstat(join(directory, "Caddyfile"))).mode & 0o777).toBe(0o444);
  const secret = await readFile(join(directory, "secrets/company_auth"), "utf8");
  expect(secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(JSON.parse(await readFile(join(directory, "secrets/company_smtp"), "utf8"))).toEqual(
    input.smtp,
  );
  for (const file of ["compose.json", "setup.json", "START-HERE.txt", "Caddyfile"]) {
    const contents = await readFile(join(directory, file), "utf8");
    for (const privateValue of [secret, input.smtp.password, input.smtp.username])
      expect(contents).not.toContain(privateValue);
  }
  expect(receipt).toMatchObject({
    workspace: "company",
    status: "prepared",
    companyUrl: "https://accounts.example.be/service",
  });
  for (const name of ["accounts", "mailer"]) {
    expect(model.services[name].network_mode).toBe("service:proxy");
    expect(model.services[name].ports).toBeUndefined();
    expect(model.services[name].networks).toBeUndefined();
  }
  expect(model.services.accounts.build.dockerfile).toBe("Dockerfile.company");
  expect(model.services.accounts.image).toBe(model.services.mailer.image);
  expect(model.services.accounts.secrets).not.toContain("company_smtp");
  expect(model.services.proxy.secrets).toBeUndefined();
  expect(model.services.proxy.environment.COMPANY_DOMAIN).toBe(input.companyDomain);
  expect(model.services.accounts.environment.SERVICE_SIGNUP_DOMAINS).toBe(
    "example.be,branch.example.be",
  );
  expect(model.secrets.company_auth.file).toBe("./secrets/company_auth");
  await expect(prepareCompanyDeployment(input, parent)).rejects.toThrow(/already exists/);
  expect(await readFile(join(directory, "secrets/company_auth"), "utf8")).toBe(secret);
  const other = await prepareCompanyDeployment(input, await temp());
  expect(other.model.name).not.toBe(model.name);
  expect(other.model.services.accounts.image).not.toBe(model.services.accounts.image);
  expect(await readFile(join(other.directory, "secrets/company_auth"), "utf8")).not.toBe(secret);
});

it("refuses shared or linked package parents before creating company credentials", async () => {
  const parent = await temp(),
    shared = join(parent, "shared"),
    alias = join(parent, "alias");
  await mkdir(shared, { mode: 0o755 });
  await symlink(parent, alias);
  for (const path of [shared, alias])
    await expect(prepareCompanyDeployment(companyDeploymentInput(raw()), path)).rejects.toThrow(
      /private setup directory/,
    );
});

it("protects the company endpoint with the same Host, Origin and nonce boundary and prepare-only creates no containers", async () => {
  const docker = vi.fn(),
    owner = vi.fn(),
    parent = await temp();
  server = createSetupServer({
    ...local,
    companyPrepare: (input) => prepareCompanyDeployment(input, parent),
    prepare: owner,
    docker,
  });
  const { origin, url } = await server.listen(),
    nonce = new URL(url).hash.slice(1);
  const headers = { "Content-Type": "application/json", Origin: origin, "X-Setup-Token": nonce };
  for (const changed of [{ Origin: "https://attacker.test" }, { "X-Setup-Token": "0".repeat(64) }])
    expect(
      (
        await fetch(`${origin}/deploy/company`, {
          method: "POST",
          headers: { ...headers, ...changed },
          body: JSON.stringify(raw()),
        })
      ).status,
    ).toBe(403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${origin}/deploy/company`,
      { method: "POST", headers: { ...headers, Host: "attacker.test" } },
      (r) => {
        r.resume();
        resolve(r.statusCode);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(raw()));
  });
  expect(hostStatus).toBe(403);
  const response = await fetch(`${origin}/deploy/company`, {
    method: "POST",
    headers,
    body: JSON.stringify(raw()),
  });
  expect(response.status).toBe(200);
  const result = await response.text();
  expect(result).toContain("https://accounts.example.be/service");
  for (const secret of [
    raw().smtpUsername,
    raw().smtpPassword,
    await readFile(join(parent, raw().name, "secrets/company_auth"), "utf8"),
  ])
    expect(result).not.toContain(secret);
  expect(docker).not.toHaveBeenCalled();
  expect(owner).not.toHaveBeenCalled();
  expect((await fetch(`${origin}/company`)).status).toBe(200);
});

it("starts the generated Docker package once and returns only a public receipt", async () => {
  const parent = await temp(),
    docker = vi.fn();
  server = createSetupServer({
    ...local,
    companyPrepare: (input) => prepareCompanyDeployment(input, parent),
    docker,
  });
  const { origin, url } = await server.listen();
  const response = await fetch(`${origin}/deploy/company`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Setup-Token": new URL(url).hash.slice(1),
    },
    body: JSON.stringify(raw({ deploy: true })),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    workspace: "company",
    target: "docker",
    status: "containers-started",
  });
  expect(docker).toHaveBeenCalledExactlyOnceWith(join(parent, raw().name), {
    context: localDocker.context,
    project: JSON.parse(await readFile(join(parent, raw().name, "compose.json"), "utf8")).name,
  });
});
