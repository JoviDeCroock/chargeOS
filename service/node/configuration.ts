import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { localConfiguration, type ServiceEnv } from "../auth.js";

export function requireNativeRuntime(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major! < 22 || (major === 22 && minor! < 22))
    throw new Error("Native commercial service requires Node.js 22.22 or newer");
}

export function nativeConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  requireNativeRuntime();
  const path = resolve(environment.SERVICE_NATIVE_CONFIG ?? "service/.dev.vars");
  const original = lstatSync(path);
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let settings: ReturnType<typeof parseEnv>;
  try {
    const info = fstatSync(descriptor);
    if (
      !info.isFile() ||
      original.isSymbolicLink() ||
      info.dev !== original.dev ||
      info.ino !== original.ino ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.size > 8192
    )
      throw new Error("Native configuration must be a bounded owner-private regular file");
    settings = parseEnv(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
  const configuration: Pick<ServiceEnv, "SERVICE_MODE" | "SERVICE_ORIGIN" | "SERVICE_AUTH_SECRET"> =
    {
      SERVICE_MODE: settings.SERVICE_MODE ?? "",
      SERVICE_ORIGIN: settings.SERVICE_ORIGIN ?? "",
      SERVICE_AUTH_SECRET: settings.SERVICE_AUTH_SECRET ?? "",
    };
  if (!localConfiguration(configuration))
    throw new Error("Use the explicit local service configuration created by service:setup");
  const port = Number(environment.SERVICE_NATIVE_PORT ?? "9091");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Native service port must be 0 through 65535");
  return {
    configuration,
    directory: resolve(environment.SERVICE_NATIVE_DATA ?? ".chargeos/commercial-service"),
    port,
  };
}
