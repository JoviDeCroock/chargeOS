import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  companyDeploymentInput,
  prepareCompanyDeployment,
} from "../scripts/company-deployment.mjs";
import { deployCompanyToCoolify } from "../scripts/company-cloud.mjs";
import { createSetupServer } from "../scripts/deploy.mjs";

const raw = (extra = {}) => ({
  target: "coolify",
  name: "synthetic-company-cloud",
  companyDomain: "accounts.example.be",
  signupDomains: "example.be",
  email: "operator@example.test",
  smtpHost: "mail.example.test",
  smtpPort: "587",
  smtpSecurity: "starttls",
  smtpUsername: "synthetic SMTP user",
  smtpPassword: "private $() ' \" SMTP password",
  smtpSender: "accounts@example.test",
  cloudOrigin: "https://app.coolify.io",
  cloudToken: "private-synthetic-cloud-token",
  projectId: "project-1",
  serverId: "server-1",
  environment: "production",
  gitRepository: "https://github.com/example/chargeOS",
  gitBranch: "main",
  gitCommit: "a".repeat(40),
  image: `ghcr.io/example/company@sha256:${"b".repeat(64)}`,
  proxyImage: `ghcr.io/example/company-proxy@sha256:${"c".repeat(64)}`,
  cloudPrivacyConfirmed: true,
  deploy: true,
  ...extra,
});
const directories = [];
let setup;
afterEach(async () => {
  await setup?.close();
  setup = undefined;
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "chargeos-cloud-test-"));
  directories.push(parent);
  const input = companyDeploymentInput(raw()),
    prepared = await prepareCompanyDeployment(input, parent),
    network = `chargeos-company-${prepared.receipt.installId}`;
  const destination = {
    uuid: "fresh-destination",
    network,
    server_uuid: input.serverId,
    type: "standalone",
    is_primary: true,
  };
  const app = {
    build_pack: "dockercompose",
    git_commit_sha: input.gitCommit,
    docker_compose_location: "/compose.company.coolify.json",
    settings: {
      is_raw_compose_deployment_enabled: true,
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      connect_to_docker_network: false,
      redact_all_env_values_in_logs: true,
    },
  };
  function fetcher(changes = {}) {
    return vi.fn(async (url, init) => {
      const path = new URL(url).pathname.replace("/api/v1", "");
      let value;
      if (path === `/servers/${input.serverId}`)
        value = {
          uuid: input.serverId,
          proxy: { type: "TRAEFIK" },
          settings: {
            is_cloudflare_tunnel: false,
            is_swarm_manager: false,
            is_swarm_worker: false,
            is_traffic_analytics_enabled: false,
          },
        };
      else if (
        path === `/servers/${input.serverId}/destinations` ||
        path === "/destinations/fresh-destination"
      )
        value = destination;
      else if (path === "/applications/public" || path === "/applications/private-github-app")
        value = { uuid: "fresh-app" };
      else if (path === "/applications/fresh-app") value = app;
      else if (path === "/applications/fresh-app/destinations") value = [destination];
      else if (path === "/applications/fresh-app/envs/bulk" || path === "/deploy")
        value = { message: "accepted" };
      else throw new Error("Unexpected API path");
      return changes[path] ? changes[path](value, init) : Response.json(value);
    });
  }
  return { input, prepared, destination, app, fetcher };
}
it("requires a verified runtime/proxy digest, explicit platform privacy and closed cloud settings", () => {
  for (const change of [
    { image: "company:latest" },
    { proxyImage: "" },
    { cloudPrivacyConfirmed: false },
    { cloudOrigin: "http://app.coolify.io" },
    { destinationId: "shared" },
    { gitCommit: "main" },
    { target: "other" },
    { target: "docker" },
  ])
    expect(() => companyDeploymentInput(raw(change))).toThrow();
});
it("prepares an isolated raw model with no inline credentials or shared ingress", async () => {
  const { input, prepared } = await fixture(),
    s = prepared.model.services;
  expect(prepared.receipt.target).toBe("coolify");
  expect(s.proxy.networks).toEqual(["company-ingress"]);
  expect(s.proxy.ports).toBeUndefined();
  expect(s.credentials.network_mode).toBe("none");
  expect(s.credentials.environment.COMPANY_BOOTSTRAP_AUTH).toBe("${COMPANY_BOOTSTRAP_AUTH}");
  for (const name of ["accounts", "mailer"]) {
    expect(s[name].network_mode).toBe("service:proxy");
    expect(s[name].environment.COMPANY_BOOTSTRAP_AUTH).toBeUndefined();
    expect(s[name].volumes[1]).toMatchObject({
      target: "/run/secrets/auth",
      read_only: true,
      volume: { nocopy: true },
    });
  }
  expect(JSON.stringify(prepared.model)).not.toContain(input.smtp.password);
  expect(JSON.stringify(prepared.receipt)).not.toContain(input.cloudToken);
  expect(await readFile(join(prepared.directory, "START-HERE.txt"), "utf8")).toContain(
    "not health",
  );
});
it("creates and reads back an isolated destination and pinned Raw application before sharing runtime-only secrets", async () => {
  const { input, prepared, fetcher, destination } = await fixture(),
    fetch = fetcher();
  expect(await deployCompanyToCoolify(input, prepared, fetch)).toMatchObject({
    status: "submitted",
    destinationId: destination.uuid,
    serviceId: "fresh-app",
  });
  expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${new URL(url).pathname}`)).toEqual([
    "GET /api/v1/servers/server-1",
    "POST /api/v1/servers/server-1/destinations",
    "GET /api/v1/destinations/fresh-destination",
    "POST /api/v1/applications/public",
    "GET /api/v1/applications/fresh-app",
    "GET /api/v1/applications/fresh-app/destinations",
    "PATCH /api/v1/applications/fresh-app/envs/bulk",
    "GET /api/v1/deploy",
  ]);
  const create = JSON.parse(fetch.mock.calls[3][1].body);
  expect(create).toMatchObject({
    destination_uuid: destination.uuid,
    instant_deploy: false,
    connect_to_docker_network: false,
    redact_all_env_values_in_logs: true,
  });
  const values = JSON.parse(fetch.mock.calls[6][1].body).data;
  for (const v of values)
    expect(v).toMatchObject({
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_shown_once: true,
    });
  expect(values.find((v) => v.key === "COMPANY_BOOTSTRAP_SMTP").value).toBe(
    JSON.stringify(input.smtp),
  );
  expect(fetch.mock.calls.every(([, init]) => init.redirect === "error")).toBe(true);
  for (const name of await readdir(prepared.directory))
    if (name.startsWith("cloud-")) {
      const text = await readFile(join(prepared.directory, name), "utf8");
      expect(text).not.toContain(input.cloudToken);
      expect(text).not.toContain(input.smtp.password);
      expect(text).not.toContain(
        await readFile(join(prepared.directory, "secrets/company_auth"), "utf8"),
      );
    }
  const before = fetch.mock.calls.length;
  await expect(deployCompanyToCoolify(input, prepared, fetch)).rejects.toThrow();
  expect(fetch.mock.calls.length).toBe(before);
});
it("fails before credentials for changed proxy, tunnel, destination, raw settings, source or additional deployment destinations", async () => {
  for (const [path, change] of [
    ["/servers/server-1", (v) => ({ ...v, proxy: { type: "CADDY" } })],
    [
      "/servers/server-1",
      (v) => ({ ...v, settings: { ...v.settings, is_cloudflare_tunnel: true } }),
    ],
    ["/destinations/fresh-destination", (v) => ({ ...v, network: "coolify" })],
    ["/applications/fresh-app", (v) => ({ ...v, git_commit_sha: "d".repeat(40) })],
    [
      "/applications/fresh-app",
      (v) => ({ ...v, settings: { ...v.settings, connect_to_docker_network: true } }),
    ],
    [
      "/applications/fresh-app",
      (v) => ({ ...v, settings: { ...v.settings, redact_all_env_values_in_logs: false } }),
    ],
    ["/applications/fresh-app/destinations", (v) => [...v, { ...v[0], uuid: "additional" }]],
  ]) {
    const { input, prepared, fetcher } = await fixture(),
      fetch = fetcher({ [path]: (v) => Response.json(change(v)) });
    await expect(deployCompanyToCoolify(input, prepared, fetch)).rejects.toThrow();
    expect(fetch.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(false);
  }
});
it("keeps uncertain mutations single-shot and errors bounded without reflecting provider bodies", async () => {
  for (const failure of [
    async () => {
      throw new Error("private-provider-echo");
    },
    async () => new Response("private-provider-echo", { status: 409 }),
    async () => new Response("x".repeat(262145)),
    async () => new Response("{bad private-provider-echo"),
  ]) {
    const { input, prepared, fetcher } = await fixture(),
      fetch = fetcher({ "/servers/server-1/destinations": failure });
    await expect(deployCompanyToCoolify(input, prepared, fetch)).rejects.toThrow(/Inspect Coolify/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(join(prepared.directory, "cloud-intent.json"), "utf8")).toContain(
      "chargeos-company-",
    );
  }
});
it("runs managed company submission without requiring local Docker and prepare-only calls no cloud API", async () => {
  const { input, prepared } = await fixture(),
    companyCloud = vi.fn(async () => ({ ...prepared.receipt, status: "submitted" })),
    dockerDestination = vi.fn(async () => {
      throw new Error("Local Docker must not run");
    });
  setup = createSetupServer({
    companyPrepare: async () => prepared,
    companyCloud,
    dockerDestination,
  });
  const { origin, url } = await setup.listen();
  for (const deploy of [false, true]) {
    const r = await fetch(`${origin}/deploy/company`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Setup-Token": new URL(url).hash.slice(1),
      },
      body: JSON.stringify(raw({ deploy })),
    });
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).not.toContain(input.smtp.password);
    expect(companyCloud).toHaveBeenCalledTimes(deploy ? 1 : 0);
  }
  expect(dockerDestination).not.toHaveBeenCalled();
});
