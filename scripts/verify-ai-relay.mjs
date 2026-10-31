import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A deterministic upstream failure exercises Caddy error logs without sending
// a real key, prompt or paid request to a provider.
const source = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
const relay = source
  .slice(source.indexOf("http://:9092"))
  .replaceAll("https://api.openai.com", "http://127.0.0.1:1")
  .replaceAll("https://api.anthropic.com", "http://127.0.0.1:1");
if (!relay.startsWith("http://:9092")) throw new Error("Missing production AI relay");
const directory = mkdtempSync(join(tmpdir(), "chargeos-ai-relay-"));
const name = `chargeos-ai-relay-${process.pid}-${Date.now()}`;
const image =
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
const run = (args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
writeFileSync(
  join(directory, "Caddyfile"),
  `{
  admin off
}
${relay}`,
);
try {
  run([
    "run",
    "--detach",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--cap-add=NET_BIND_SERVICE",
    "--security-opt=no-new-privileges:true",
    "--publish",
    "127.0.0.1::9092",
    "--volume",
    `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
    image,
  ]);
  const port = run(["port", name, "9092/tcp"]).trim().split(":").at(-1);
  const secrets = [];
  for (const provider of ["openai", "anthropic"]) {
    const secret = `synthetic-${provider}-key-MUST-NOT-APPEAR-${process.pid}`;
    secrets.push(secret);
    let response;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/${provider}`, {
          method: "POST",
          headers: {
            Authorization: provider === "openai" ? `Bearer ${secret}` : secret,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(1000),
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (response?.status !== 502)
      throw new Error("Synthetic relay did not fail at the upstream boundary");
  }
  const captured = execFileSync("docker", ["logs", name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Docker's stdout/stderr split matters: Caddy writes JSON logs to stderr.
  const { spawnSync } = await import("node:child_process");
  const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
  if (logs.status !== 0) throw new Error("Could not inspect relay logs");
  const bytes = captured + logs.stdout + logs.stderr;
  if (!bytes.includes("connection refused") || !bytes.includes("REDACTED"))
    throw new Error("Expected redacted failing-upstream evidence is missing");
  if (secrets.some((secret) => bytes.includes(secret)))
    throw new Error("Provider credential appeared in relay logs");
  console.log(
    "AI relay verified: both failed upstreams logged redacted credentials; no external provider call.",
  );
} finally {
  try {
    run(["rm", "--force", "--volumes", name]);
  } catch {
    /* A failed start may leave no container. */
  }
  rmSync(directory, { recursive: true, force: true });
}
