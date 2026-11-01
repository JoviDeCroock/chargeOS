import { nativeHosting } from "../configuration.js";
import { readRuntimeFile } from "./runtime-files.js";
import {
  constants,
  existsSync,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { localConfiguration, serviceConfiguration, type ServiceEnv } from "../auth.js";

export function requireNativeRuntime(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major! < 22 || (major === 22 && minor! < 22))
    throw new Error("Native commercial service requires Node.js 22.22 or newer");
}

export function nativeConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  requireNativeRuntime();
  if (environment.SERVICE_MODE === "production") {
    if (
      process.platform !== "linux" ||
      !existsSync("/.dockerenv") ||
      environment.SERVICE_NATIVE_CONFIG ||
      environment.SERVICE_AUTH_SECRET ||
      environment.SERVICE_PROXY_ONLY !== "loopback" ||
      !environment.SERVICE_AUTH_SECRET_FILE ||
      !process.getuid ||
      process.getuid() === 0
    )
      throw new Error(
        "Production requires the non-root Docker single loopback TLS proxy and file-only auth secret",
      );
    const secret = readRuntimeFile(environment.SERVICE_AUTH_SECRET_FILE, 4096, true).replace(
      /\r?\n$/,
      "",
    );
    const configuration: ServiceEnvWithoutDatabase = {
      SERVICE_MODE: "production",
      SERVICE_ORIGIN: environment.SERVICE_ORIGIN ?? "",
      SERVICE_AUTH_SECRET: secret,
      SERVICE_DELIVERY: environment.SERVICE_DELIVERY ?? "",
      SERVICE_SIGNUP_DOMAINS: environment.SERVICE_SIGNUP_DOMAINS ?? "",
      [nativeHosting]: true,
    };
    if (!serviceConfiguration(configuration))
      throw new Error(
        "Use an exact HTTPS company origin, approved signup domains and SMTP delivery",
      );
    return {
      configuration,
      directory: resolve(environment.SERVICE_NATIVE_DATA ?? "/data"),
      port: portNumber(environment.SERVICE_NATIVE_PORT),
    };
  }
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
  const configuration: ServiceEnvWithoutDatabase = {
    SERVICE_MODE: settings.SERVICE_MODE ?? "",
    SERVICE_ORIGIN: settings.SERVICE_ORIGIN ?? "",
    SERVICE_AUTH_SECRET: settings.SERVICE_AUTH_SECRET ?? "",
    SERVICE_DELIVERY: settings.SERVICE_DELIVERY ?? "local",
  };
  if (!localConfiguration(configuration))
    throw new Error("Use the explicit local service configuration created by service:setup");
  const port = portNumber(environment.SERVICE_NATIVE_PORT);
  return {
    configuration,
    directory: resolve(environment.SERVICE_NATIVE_DATA ?? ".chargeos/commercial-service"),
    port,
  };
}

type ServiceEnvWithoutDatabase = Omit<ServiceEnv, "SERVICE_DB">;
function portNumber(value: string | undefined): number {
  const port = Number(value ?? "9091");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Native service port must be 0 through 65535");
  return port;
}
