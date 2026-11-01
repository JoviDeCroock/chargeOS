import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DeploymentError, repositoryRoot } from "./deployment.mjs";

const execute = promisify(execFile);
export function deploymentDockerEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith("COMPOSE_") && !["DOCKER_HOST", "DOCKER_CONTEXT"].includes(key),
    ),
  );
}
export async function inspectLocalDocker(environment = process.env, run = execute) {
  if (environment.DOCKER_HOST)
    throw new DeploymentError(
      "Remove the DOCKER_HOST override and choose a local Docker context. Remote Docker file transfer is not supported by setup.",
    );
  try {
    const options = { env: environment, timeout: 10000, maxBuffer: 16384 };
    const context = (await run("docker", ["context", "show"], options)).stdout.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context)) throw new Error("Context name");
    const endpoint = JSON.parse(
      (
        await run(
          "docker",
          ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"],
          options,
        )
      ).stdout,
    );
    const url = new URL(endpoint);
    if (
      typeof endpoint !== "string" ||
      endpoint.length > 4096 ||
      !endpoint.startsWith("unix:///") ||
      endpoint.startsWith("unix:////") ||
      url.hostname ||
      /[\0\r\n]/.test(endpoint)
    )
      throw new Error("Remote Docker endpoint");
    return { context, endpoint };
  } catch {
    throw new DeploymentError(
      "Setup needs local Docker on Linux or Docker Desktop on macOS with a local Unix socket. SSH/TCP/remote contexts cannot mount this computer's private files. Choose a local context before continuing.",
    );
  }
}
/** Before generating real credentials, prove this daemon sees a fresh local
 * bind file. This also rejects a Unix socket forwarding to a remote daemon. */
export async function proveLocalDocker(destination, run = execute) {
  const directory = await mkdtemp(join(tmpdir(), "chargeos-docker-path-"));
  try {
    const image = (await readFile(join(repositoryRoot, "Dockerfile.company"), "utf8")).match(
      /^FROM (node:[^\s]+@sha256:[a-f0-9]{64}) AS build/m,
    )?.[1];
    if (!image) throw new Error("Missing pinned probe image");
    const value = randomBytes(32).toString("hex"),
      file = join(directory, "probe");
    await writeFile(file, value, { mode: 0o444, flag: "wx" });
    const result = await run(
      "docker",
      [
        "--context",
        destination.context,
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--user",
        "1000:1000",
        "--mount",
        `type=bind,source=${file},target=/probe,readonly`,
        "--entrypoint",
        "node",
        image,
        "-e",
        "process.stdout.write(require('node:fs').readFileSync('/probe','utf8'))",
      ],
      { env: deploymentDockerEnvironment(), timeout: 180000, maxBuffer: 1024 },
    );
    if (result.stdout !== value) throw new Error("Bind path mismatch");
  } catch {
    throw new DeploymentError(
      "Docker could not read a fresh file from this computer. Start local Docker, check file sharing and image access, and select the intended local context. No installation credentials or deployment containers were created.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
