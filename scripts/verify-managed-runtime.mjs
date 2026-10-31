import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RPCClient } from "ocpp-rpc";
import { deploymentInput, prepareDeployment } from "./deployment.mjs";

const directory = await mkdtemp(join(tmpdir(), "chargeos-managed-smoke-"));
const run = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const input = deploymentInput({
  target: "coolify",
  name: "runtime-smoke",
  stationId: "MANAGED_SMOKE",
  ownerTag: "SYNTHETICCARD",
  ownerDomain: "owner.example.test",
  ocppDomain: "ocpp.example.test",
  email: "synthetic@example.test",
  image: `ghcr.io/example/chargeos@sha256:${"a".repeat(64)}`,
  deploy: false,
  cloudOrigin: "https://app.coolify.io",
  cloudToken: "synthetic-cloud-token",
  projectId: "unused",
  serverId: "unused",
  environment: "production",
  gitRepository: "https://github.com/JoviDeCroock/chargeOS",
  gitBranch: "main",
  gitCommit: "b".repeat(40),
});
let prepared;
let client;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
try {
  prepared = await prepareDeployment(input, directory);
  const model = prepared.model;
  // Replace the external platform network and ingress by a disposable synthetic
  // network and loopback ports. No existing Coolify network/account is touched.
  model.networks.coolify = { name: `${prepared.receipt.installId}-proxy-proof` };
  for (const name of ["chargeos", "credentials", "proxy-config"])
    model.services[name].image = "chargeos:local";
  model.services.caddy.ports = ["127.0.0.1::8080", "127.0.0.1::8081"];
  delete model.services.caddy.labels;
  const compose = join(prepared.directory, "compose.json");
  await writeFile(compose, JSON.stringify(model));
  try {
    run(["compose", "-f", compose, "up", "--detach", "--wait", "--wait-timeout", "90"]);
  } catch (error) {
    console.error(
      run(["compose", "-f", compose, "logs", "--no-color", "credentials", "proxy-config"]),
    );
    throw error;
  }
  const id = run(["compose", "-f", compose, "ps", "--quiet", "chargeos"]).trim();
  const caddyId = run(["compose", "-f", compose, "ps", "--quiet", "caddy"]).trim();
  const inspect = JSON.parse(run(["inspect", id]))[0];
  assert(
    Object.keys(inspect.NetworkSettings.Networks).length === 1,
    "Managed edge escaped its private network",
  );
  assert(
    !inspect.HostConfig.PortBindings || Object.keys(inspect.HostConfig.PortBindings).length === 0,
    "Managed edge published a port",
  );
  assert(inspect.Config.User === "chargeos", "Managed edge is not non-root");
  assert(inspect.HostConfig.ReadonlyRootfs, "Managed edge root is writable");
  const env = inspect.Config.Env.join("\n");
  assert(
    !env.includes(prepared.receipt.ownerToken) &&
      !env.includes(prepared.receipt.stationSecret) &&
      !env.includes(input.ownerTag),
    "Bootstrap secret leaked into application environment",
  );
  for (const name of ["owner_api_token", "owner_tags", "station_secret"]) {
    const mode = run([
      "exec",
      id,
      "node",
      "-e",
      `console.log((require('fs').statSync('/run/secrets/${name}').mode & 511).toString(8))`,
    ]).trim();
    assert(mode === "444", "Managed credential mount is not read-only mode 0444");
  }
  const port = (internal) =>
    run(["port", caddyId, `${internal}/tcp`])
      .trim()
      .split(":")
      .at(-1);
  const base = `http://127.0.0.1:${port(8080)}`;
  const headers = { Authorization: `Bearer ${prepared.receipt.ownerToken}` };
  assert(
    (await fetch(`${base}/api/v1/fleet`)).status === 401,
    "Managed owner route lacks authentication",
  );
  assert(
    (await fetch(`${base}/api/v1/fleet`, { headers })).status === 200,
    "Managed owner API did not boot with config-file credentials",
  );
  assert(
    [404, 405].includes((await fetch(`${base}/anthropic`, { method: "POST" })).status),
    "Managed public route exposed AI relay",
  );
  client = new RPCClient({
    endpoint: `ws://127.0.0.1:${port(8081)}`,
    identity: input.stationId,
    protocols: ["ocpp1.6"],
    password: prepared.receipt.stationSecret,
    strictMode: true,
  });
  await client.connect();
  assert(
    (
      await client.call("BootNotification", {
        chargePointVendor: "Synthetic",
        chargePointModel: "Managed proof",
      })
    ).status === "Accepted",
    "Managed OCPP proxy did not accept the exact provisioned station",
  );
  await client.close();
  client = undefined;
  const preview = await (
    await fetch(`${base}/api/v1/stations/${input.stationId}/troubleshooting/preview`, { headers })
  ).text();
  assert(
    !preview.includes(input.stationId) && !preview.includes(input.ownerTag),
    "Managed AI preview exposed identity",
  );
  const before = await (await fetch(`${base}/api/v1/snapshot`, { headers })).json();
  run(["compose", "-f", compose, "restart", "chargeos"]);
  let after;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/api/v1/snapshot`, { headers });
      if (response.ok) {
        after = await response.json();
        break;
      }
    } catch {
      /* Restart disconnects are expected. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(
    after?.station.boot?.model === before.station.boot?.model,
    "Managed evidence did not survive restart",
  );
  const file = await readFile(join(prepared.directory, "credentials.json"), "utf8");
  assert(!file.includes(input.cloudToken), "Cloud API token persisted in private receipt");
  console.log(
    "Managed raw-template runtime passed: non-root/private edge, 0444 config credentials, authenticated console, OCPP proxy, unpublished relay and durable restart. Platform TLS/labels remain a live-cloud gate.",
  );
} finally {
  await client?.close().catch(() => {});
  if (prepared) {
    try {
      run([
        "compose",
        "-f",
        join(prepared.directory, "compose.json"),
        "down",
        "--volumes",
        "--remove-orphans",
      ]);
    } catch {
      /* Only this synthetic project's resources are removed. */
    }
  }
  await rm(directory, { recursive: true, force: true });
}
