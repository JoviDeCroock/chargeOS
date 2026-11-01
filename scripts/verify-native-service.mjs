import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "chargeos-native-runtime-"));
const configuration = join(directory, "service.vars");
const origin = "http://127.0.0.1:5173";
const authSecret = "synthetic-native-runtime-auth-secret-at-least-32-characters";
await writeFile(
  configuration,
  `SERVICE_MODE=local\nSERVICE_ORIGIN=${origin}\nSERVICE_AUTH_SECRET=${authSecret}\n`,
  { mode: 0o600 },
);
const environment = {
  ...process.env,
  SERVICE_NATIVE_CONFIG: configuration,
  SERVICE_NATIVE_DATA: join(directory, "data"),
  SERVICE_NATIVE_PORT: "0",
};
let child,
  captured = "";
async function start() {
  captured = "";
  child = spawn(process.execPath, ["dist/native-service/service/node/main.js"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    captured += chunk;
  });
  child.stderr.on("data", (chunk) => {
    captured += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = captured.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return match[1];
    if (child.exitCode !== null) throw new Error("Compiled native service failed startup");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Compiled native service startup timed out");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [code, signal] = await exit;
    if (code !== 0 || signal) throw new Error("Native service did not stop cleanly");
  } finally {
    clearTimeout(timer);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  let base = await start();
  const cookies = new Map();
  const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        at = pair.indexOf("=");
      if (pair.slice(at + 1)) cookies.set(pair.slice(0, at), pair.slice(at + 1));
      else cookies.delete(pair.slice(0, at));
    }
    return response;
  };
  const api = "/service/api",
    email = "synthetic-native-runtime@example.test",
    password = "synthetic native runtime password!";
  assert(
    (await request(`${api}/auth/sign-up/email`, { name: "Synthetic native user", email, password }))
      .status === 200,
    "Compiled native signup failed",
  );
  const delivery = execFileSync(
    process.execPath,
    ["dist/native-service/service/node/outbox.js", "--recipient", email, "--kind", "verify-email"],
    { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  assert(new URL(delivery).origin === origin, "Native delivery has a foreign origin");
  for (const [recipient, kind] of [
    ["other-native-user@example.test", "verify-email"],
    [email, "invitation"],
  ]) {
    let denied = false;
    try {
      execFileSync(
        process.execPath,
        ["dist/native-service/service/node/outbox.js", "--recipient", recipient, "--kind", kind],
        { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      denied = true;
      assert(
        !String(error.stdout).trim() && !String(error.stderr).includes(delivery),
        "Outbox revealed a link for the wrong recipient or kind",
      );
    }
    assert(denied, "Outbox accepted a different recipient or missing delivery kind");
  }
  const deliveryUrl = new URL(delivery);
  assert(
    [200, 302].includes((await request(`${deliveryUrl.pathname}${deliveryUrl.search}`)).status),
    "Compiled native verification failed",
  );
  assert(
    (await request(`${api}/auth/sign-in/email`, { email, password })).status === 200,
    "Compiled native login failed",
  );
  const organization = await request(`${api}/v1/organizations`, {
    name: "Synthetic native employer",
  });
  assert(organization.status === 201, "Compiled native organization creation failed");
  const saved = await organization.json();
  await stop();
  assert(
    !captured.includes(authSecret) && !captured.includes(delivery) && !captured.includes(password),
    "Native runtime logged sensitive data",
  );
  base = await start();
  const account = await request(`${api}/v1/me`);
  assert(
    account.status === 200 &&
      (await account.json()).organizations.some((row) => row.id === saved.id),
    "Native accounts, sessions or organization did not persist across restart",
  );
  const denied = await request(`${api}/v1/local-outbox`);
  assert(denied.status === 404, "Native runtime exposed the private operator outbox");
  await stop();
  assert(
    !captured.includes(authSecret) && !captured.includes(delivery),
    "Native restart logged sensitive data",
  );
  const passphrase = "synthetic native commercial recovery phrase!";
  const passphraseFile = join(directory, "recovery.passphrase");
  const bundle = join(directory, "commercial.bundle"),
    target = join(directory, "replacement");
  await writeFile(passphraseFile, passphrase + "\n", { mode: 0o600 });
  const recoveryCommand = (args, env = environment) =>
    execFileSync(
      process.execPath,
      [
        "dist/native-service/service/node/recovery-cli.js",
        ...args,
        "--passphrase-file",
        passphraseFile,
      ],
      { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const exported = JSON.parse(recoveryCommand(["export", "--output", bundle]));
  const freshHostEnvironment = {
    ...environment,
    SERVICE_NATIVE_CONFIG: join(directory, "lost-source-config"),
  };
  assert(
    JSON.parse(recoveryCommand(["inspect", "--input", bundle], freshHostEnvironment)).accounts ===
      1,
    "Compiled commercial inspection required lost source configuration or lost accounts",
  );
  const restored = JSON.parse(
    recoveryCommand(["restore", "--input", bundle, "--target", target], freshHostEnvironment),
  );
  assert(
    restored.status === "quarantined" && restored.snapshotSha256 === exported.snapshotSha256,
    "Compiled commercial restore did not retain snapshot identity/quarantine",
  );
  const failedStart = spawn(process.execPath, ["dist/native-service/service/node/main.js"], {
    cwd: root,
    env: {
      ...environment,
      SERVICE_NATIVE_CONFIG: join(target, "service.vars"),
      SERVICE_NATIVE_DATA: join(target, "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let recoveryOutput = "";
  failedStart.stdout.on("data", (chunk) => {
    recoveryOutput += chunk;
  });
  failedStart.stderr.on("data", (chunk) => {
    recoveryOutput += chunk;
  });
  const failureTimer = setTimeout(() => failedStart.kill("SIGKILL"), 5000);
  let failedCode, failedSignal;
  try {
    [failedCode, failedSignal] = await once(failedStart, "exit");
  } finally {
    clearTimeout(failureTimer);
  }
  assert(
    failedCode !== 0 &&
      !failedSignal &&
      recoveryOutput.includes("quarantined") &&
      !recoveryOutput.includes("listening on"),
    "Compiled native service did not refuse quarantined startup before listening",
  );
  assert(
    !recoveryOutput.includes(authSecret) &&
      !recoveryOutput.includes(delivery) &&
      !recoveryOutput.includes(passphrase),
    "Compiled recovery/startup exposed secret material",
  );
  console.log(
    "Native commercial runtime passed: compiled boot and migrations, local verification, scoped-cookie login, organization/session persistence, clean restart, encrypted backup/inspection without source config, fresh-path quarantined restore and startup refusal, with no HTTP outbox or secret logging.",
  );
} finally {
  await stop().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
