import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, lstat, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  caddyVolumeOwnership,
  deploymentInput,
  prepareDeployment,
  deployToCoolify,
} from "../scripts/deployment.mjs";
import { createSetupServer } from "../scripts/deploy.mjs";

const raw = (extra = {}) => ({
  target: "docker",
  name: "synthetic-company",
  stationId: "TEST_1",
  ownerTag: "AABBCCDD",
  ownerDomain: "charge.example.be",
  ocppDomain: "ocpp.example.be",
  email: "operator@example.test",
  deploy: false,
  ...extra,
});
const managed = (extra = {}) =>
  deploymentInput(
    raw({
      target: "coolify",
      image: `ghcr.io/example/chargeos@sha256:${"a".repeat(64)}`,
      cloudOrigin: "https://app.coolify.io",
      cloudToken: "synthetic-cloud-token-only",
      projectId: "project-1",
      serverId: "server-1",
      environment: "production",
      gitRepository: "https://github.com/example/chargeOS",
      gitBranch: "main",
      gitCommit: "b".repeat(40),
      ...extra,
    }),
  );
const directories = [];
let server;
afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "chargeos-deploy-test-"));
  directories.push(dir);
  return dir;
}

it("validates identities, domains, immutable image references and explicit deployment intent", () => {
  for (const extra of [
    { name: "../escape" },
    { name: "$(touch nope)" },
    { stationId: "../other" },
    { ownerTag: "${SECRET}" },
    { ownerDomain: "https://company.be" },
    { ocppDomain: "charge.example.be" },
    { email: "line\noperator@example.test" },
    { image: "registry/chargeos:latest" },
    { target: ["docker"] },
    { deploy: "true" },
    { command: "rm -rf /" },
  ])
    expect(() => deploymentInput(raw(extra))).toThrow();
  expect(() => managed({ cloudOrigin: "http://app.coolify.io" })).toThrow();
  expect(() => managed({ cloudOrigin: "https://token:secret@app.coolify.io" })).toThrow();
  expect(() => managed({ image: "" })).toThrow();
  expect(deploymentInput(raw()).stationId).toBe("TEST_1");
});
it("creates private non-overwriting Docker files with unique credentials, file-secret mounts and isolated networking", async () => {
  const parent = await temp();
  const prepared = await prepareDeployment(deploymentInput(raw()), parent);
  const { model, receipt, directory } = prepared;
  expect((await lstat(directory)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(directory, "credentials.json"))).mode & 0o777).toBe(0o600);
  expect((await lstat(join(directory, "Caddyfile"))).mode & 0o777).toBe(0o444);
  expect((await lstat(join(directory, "secrets/owner_tags"))).mode & 0o777).toBe(0o444);
  expect(await readFile(join(directory, "secrets/owner_tags"), "utf8")).toBe("AABBCCDD");
  expect(receipt.ownerToken.length).toBeGreaterThanOrEqual(32);
  expect(receipt.stationSecret).not.toBe(receipt.ownerToken);
  expect(receipt.stationSecret).toMatch(/^[0-9a-f]{40}$/);
  expect(model.services.chargeos.networks).toEqual(["chargeos-internal"]);
  expect(model.services.chargeos.ports).toBeUndefined();
  expect(model.services.caddy.user).toBe("1000:1000");
  expect(model.services["caddy-volumes"]).toEqual(caddyVolumeOwnership(model.services.caddy.image));
  expect(model.networks["chargeos-internal"].internal).toBe(true);
  expect(model.services.chargeos.environment.CHARGEOS_OWNER_API_TOKEN).toBeUndefined();
  expect(model.services.chargeos.environment.CHARGEOS_OWNER_API_TOKEN_FILE).toBe(
    "/run/secrets/owner_api_token",
  );
  expect(JSON.stringify(model)).not.toContain("AABBCCDD");
  await expect(prepareDeployment(deploymentInput(raw()), parent)).rejects.toThrow(/already exists/);
  expect(await readFile(join(directory, "secrets/station_secret"), "utf8")).toBe(
    receipt.stationSecret,
  );
});
it("pins owner prepare-only instructions to a validated local context without starting a probe or deployment", async () => {
  const parent = await temp(),
    docker = vi.fn(),
    dockerProbe = vi.fn();
  const destination = { context: "verified-local", endpoint: "unix:///synthetic/docker.sock" };
  server = createSetupServer({
    prepare: (input) => prepareDeployment(input, parent),
    docker,
    dockerProbe,
    dockerDestination: async () => destination,
  });
  const { origin, url } = await server.listen();
  const response = await fetch(`${origin}/deploy`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Setup-Token": new URL(url).hash.slice(1),
    },
    body: JSON.stringify(raw()),
  });
  expect(response.status).toBe(200);
  expect(docker).not.toHaveBeenCalled();
  expect(dockerProbe).not.toHaveBeenCalled();
  const result = await response.json(),
    model = JSON.parse(await readFile(join(result.directory, "compose.json"), "utf8"));
  const guide = await readFile(join(result.directory, "START-HERE.txt"), "utf8");
  expect(guide).toContain(
    `docker --context verified-local compose --project-name ${model.name} --file compose.json`,
  );
});
it("rejects remote owner prepare-only destinations before package creation", async () => {
  const prepare = vi.fn();
  const { DeploymentError } = await import("../scripts/deployment.mjs");
  server = createSetupServer({
    prepare,
    dockerDestination: async () => {
      throw new DeploymentError("Choose local Docker");
    },
  });
  const { origin, url } = await server.listen();
  const response = await fetch(`${origin}/deploy`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Setup-Token": new URL(url).hash.slice(1),
    },
    body: JSON.stringify(raw()),
  });
  expect(response.status).toBe(400);
  expect(prepare).not.toHaveBeenCalled();
});
it("refuses symlinked or shared setup roots before creating credentials", async () => {
  const directory = await temp();
  const shared = join(directory, "shared");
  await mkdir(shared, { mode: 0o755 });
  await expect(prepareDeployment(deploymentInput(raw()), shared)).rejects.toThrow(
    /private setup directory/,
  );
  const link = join(directory, "link");
  await symlink(directory, link);
  await expect(prepareDeployment(deploymentInput(raw()), link)).rejects.toThrow(
    /private setup directory/,
  );
});
it("uses different stable Docker project IDs for equal labels in different checkouts", async () => {
  const first = await prepareDeployment(deploymentInput(raw()), await temp());
  const second = await prepareDeployment(deploymentInput(raw()), await temp());
  expect(first.model.name).not.toBe(second.model.name);
  expect(first.receipt.installId).not.toBe(second.receipt.installId);
  expect(JSON.parse(await readFile(join(first.directory, "compose.json"), "utf8")).name).toBe(
    first.model.name,
  );
});
it("builds a managed template with immutable images, read-only credential files, separate domains and no forwarded-header trust", async () => {
  const input = managed();
  const prepared = await prepareDeployment(input, await temp());
  expect(prepared.model.services.chargeos.build).toBeUndefined();
  expect(prepared.model.services.caddy.ports).toBeUndefined();
  expect(prepared.model.services.chargeos.environment.CHARGEOS_TRUST_PROXY_HEADERS).toBe("false");
  expect(prepared.model.services.credentials.network_mode).toBe("none");
  expect(prepared.model.services.credentials.read_only).toBe(true);
  expect(prepared.model.services.chargeos.volumes).toContainEqual({
    type: "volume",
    source: "chargeos-credentials",
    target: "/run/secrets",
    read_only: true,
    volume: { nocopy: true },
  });
  expect(prepared.model.services.caddy.volumes).toContainEqual({
    type: "volume",
    source: "chargeos-proxy-config",
    target: "/etc/caddy",
    read_only: true,
    volume: { nocopy: true },
  });
  expect(prepared.model.services["proxy-config"].environment.CHARGEOS_SEED_Caddyfile).toContain(
    "max_conns_per_host 8",
  );
  expect(prepared.model.services.chargeos.networks).toEqual(["chargeos-internal"]);
  expect(prepared.model.services.caddy.networks).toEqual(["coolify", "chargeos-internal"]);
  expect(prepared.model.services.caddy.user).toBe("1000:1000");
  expect(prepared.model.services["caddy-volumes"]).toEqual(
    caddyVolumeOwnership(prepared.model.services.caddy.image),
  );
  expect(prepared.model.services.caddy.depends_on["caddy-volumes"]).toEqual({
    condition: "service_completed_successfully",
  });
  const fetcher = vi.fn(async (_url, init) => {
    if (init.method === "POST") return Response.json({ uuid: "cloud-service-1" }, { status: 201 });
    if (_url.includes("/applications/cloud-service-1") && init.method === "GET")
      return Response.json({
        build_pack: "dockercompose",
        settings: { is_raw_compose_deployment_enabled: true },
        git_commit_sha: input.gitCommit,
        docker_compose_location: "/compose.coolify.json",
      });
    return Response.json({ ok: true });
  });
  const result = await deployToCoolify(input, prepared, fetcher);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://app.coolify.io/api/v1/applications/public");
  expect(init.redirect).toBe("error");
  const body = JSON.parse(init.body);
  expect(body.force_domain_override).toBe(false);
  expect(body.is_raw_compose_deployment_enabled).toBe(true);
  expect(body.instant_deploy).toBe(false);
  expect(body.git_commit_sha).toBe(input.gitCommit);
  expect(JSON.stringify(body)).not.toContain(input.ownerTag);
  const envCall = fetcher.mock.calls.find((call) => call[1].method === "PATCH");
  expect(
    JSON.parse(envCall[1].body).data.every(
      (entry) => entry.is_shown_once && entry.is_literal && !entry.is_buildtime,
    ),
  ).toBe(true);
  expect(fetcher.mock.calls.at(-1)[0]).toContain("/deploy?uuid=cloud-service-1");
  expect(result.status).toBe("submitted");
  expect(await readFile(join(prepared.directory, "cloud-receipt.json"), "utf8")).not.toContain(
    input.cloudToken,
  );
  expect(await readFile(join(prepared.directory, "compose.json"), "utf8")).not.toContain(
    input.cloudToken,
  );
});
it("does not retry ambiguous cloud creates or reflect provider error bodies", async () => {
  const prepared = await prepareDeployment(managed(), await temp());
  const fetcher = vi.fn(async () => {
    throw new Error("synthetic-secret-echo");
  });
  await expect(deployToCoolify(managed(), prepared, fetcher)).rejects.toThrow(
    /outcome is uncertain/,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    deployToCoolify(
      managed(),
      prepared,
      async () => new Response("synthetic-secret-echo", { status: 409 }),
    ),
  ).rejects.not.toThrow("synthetic-secret-echo");
});
it("stops before sharing credentials if raw mode or the reviewed Git revision was changed", async () => {
  for (const change of [
    { settings: { is_raw_compose_deployment_enabled: false } },
    { git_commit_sha: "c".repeat(40) },
  ]) {
    const input = managed();
    const prepared = await prepareDeployment(input, await temp());
    const fetcher = vi.fn(async (_url, init) =>
      Response.json(
        init.method === "POST"
          ? { uuid: "created-app" }
          : {
              build_pack: "dockercompose",
              settings: { is_raw_compose_deployment_enabled: true },
              git_commit_sha: input.gitCommit,
              docker_compose_location: "/compose.coolify.json",
              ...change,
            },
      ),
    );
    await expect(deployToCoolify(input, prepared, fetcher)).rejects.toThrow(
      /No charger credentials were sent/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init.method !== "PATCH")).toBe(true);
    expect(await readFile(join(prepared.directory, "cloud-created.json"), "utf8")).toContain(
      "created-app",
    );
  }
});
it("protects deployment from foreign origins, forged hosts and missing nonces; prepare-only never starts software", async () => {
  const prepare = vi.fn(async () => ({
    directory: "/private/setup",
    receipt: {
      status: "prepared",
      ownerToken: "never-return-this",
      stationSecret: "nor-this",
      consoleUrl: "https://example.test",
    },
  }));
  const docker = vi.fn();
  const cloud = vi.fn();
  server = createSetupServer({
    prepare,
    docker,
    cloud,
    dockerDestination: async () => ({
      context: "synthetic-local",
      endpoint: "unix:///synthetic/docker.sock",
    }),
  });
  const { origin, url } = await server.listen();
  const nonce = new URL(url).hash.slice(1);
  const headers = { "Content-Type": "application/json", Origin: origin, "X-Setup-Token": nonce };
  expect(
    (
      await fetch(`${origin}/deploy`, {
        method: "POST",
        headers: { ...headers, Origin: "https://attacker.test" },
        body: JSON.stringify(raw()),
      })
    ).status,
  ).toBe(403);
  const forgedHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${origin}/deploy`,
      { method: "POST", headers: { ...headers, Host: "attacker.test" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(raw()));
  });
  expect(forgedHost).toBe(403);
  expect(
    (
      await fetch(`${origin}/deploy`, {
        method: "POST",
        headers: { ...headers, "X-Setup-Token": "0".repeat(64) },
        body: JSON.stringify(raw()),
      })
    ).status,
  ).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
  const response = await fetch(`${origin}/deploy`, {
    method: "POST",
    headers,
    body: JSON.stringify(raw()),
  });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("never-return-this");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(docker).not.toHaveBeenCalled();
  expect(cloud).not.toHaveBeenCalled();
});
