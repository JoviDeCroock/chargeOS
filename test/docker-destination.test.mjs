import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  inspectLocalDocker,
  proveLocalDocker,
  deploymentDockerEnvironment,
} from "../scripts/docker-destination.mjs";
import { runDocker } from "../scripts/deploy.mjs";
import { dockerComposeCommand } from "../scripts/deployment.mjs";

it("rejects remote contexts and environment host overrides before any bind file or deployment", async () => {
  const run = vi.fn();
  await expect(
    inspectLocalDocker({ DOCKER_HOST: "tcp://remote.example.test:2376" }, run),
  ).rejects.toThrow(/DOCKER_HOST/);
  expect(run).not.toHaveBeenCalled();
  for (const host of [
    "ssh://operator@example.test",
    "tcp://127.0.0.1:2375",
    "npipe:////./pipe/docker_engine",
    "unix://remote/docker.sock",
    "unix:////remote/docker.sock",
  ]) {
    const inspect = vi.fn(async (_command, args) => ({
      stdout: args[1] === "show" ? "synthetic-local\n" : JSON.stringify(host),
    }));
    await expect(inspectLocalDocker({}, inspect)).rejects.toThrow(/local Docker/);
  }
  const local = vi.fn(async (_command, args) => ({
    stdout: args[1] === "show" ? "desktop-linux\n" : '"unix:///var/run/docker.sock"',
  }));
  expect(await inspectLocalDocker({}, local)).toEqual({
    context: "desktop-linux",
    endpoint: "unix:///var/run/docker.sock",
  });
});

it("proves actual bind-file visibility with no credential or writable host mount and cleans up its canary", async () => {
  let source;
  const run = vi.fn(async (command, args, options) => {
    expect(command).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["--context", "verified-local", "run"]);
    expect(args).toContain("--read-only");
    expect(args).toContain("none");
    const mount = args[args.indexOf("--mount") + 1];
    expect(mount).toMatch(/,readonly$/);
    source = mount.split(",source=")[1].split(",target=")[0];
    expect(options.env.COMPOSE_PROJECT_NAME).toBeUndefined();
    return { stdout: await readFile(source, "utf8") };
  });
  await proveLocalDocker({ context: "verified-local" }, run);
  expect(run).toHaveBeenCalledOnce();
  await expect(readFile(source)).rejects.toThrow();
});

it("fails closed if a local-looking forwarded socket sees a different filesystem", async () => {
  const run = vi.fn(async () => ({ stdout: "different file" }));
  await expect(proveLocalDocker({ context: "forwarded-local" }, run)).rejects.toThrow(
    /could not read a fresh file/,
  );
});

it("pins the validated context and unique project despite hostile inherited Compose controls", async () => {
  const start = vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  });
  await runDocker(
    "/private/installation",
    { project: "chargeos-synthetic-unique", context: "verified-local" },
    start,
  );
  const [command, args, options] = start.mock.calls[0];
  expect(command).toBe("docker");
  expect(args.slice(0, 5)).toEqual([
    "--context",
    "verified-local",
    "compose",
    "--project-name",
    "chargeos-synthetic-unique",
  ]);
  expect(args).toContain("compose.json");
  expect(options.shell).toBe(false);
  expect(
    deploymentDockerEnvironment({
      PATH: "/usr/bin",
      COMPOSE_PROJECT_NAME: "sentinel",
      COMPOSE_FILE: "other.json",
      COMPOSE_ENV_FILES: "other.env",
      DOCKER_HOST: "ssh://remote",
      DOCKER_CONTEXT: "remote",
    }),
  ).toEqual({ PATH: "/usr/bin" });
  expect(Object.keys(options.env).some((k) => k.startsWith("COMPOSE_"))).toBe(false);
  expect(dockerComposeCommand("chargeos-synthetic-unique", "verified-local")).toBe(
    "docker --context verified-local compose --project-name chargeos-synthetic-unique --file compose.json",
  );
});
