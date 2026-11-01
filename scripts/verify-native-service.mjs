import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createHmac } from "node:crypto";

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
async function start(
  argumentsList = ["dist/native-service/service/node/main.js"],
  runtimeEnvironment = environment,
) {
  captured = "";
  child = spawn(process.execPath, argumentsList, {
    cwd: root,
    env: runtimeEnvironment,
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
function authenticatorCode(uri) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    secret = new URL(uri).searchParams.get("secret");
  let bits = "";
  for (const character of secret.replace(/=+$/, ""))
    bits += alphabet.indexOf(character.toUpperCase()).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(),
    offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
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
  const reviewCommand = (args, env = environment) =>
    execFileSync(
      process.execPath,
      ["dist/native-service/service/node/recovery-review-cli.js", ...args],
      { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const checkpoint = join(directory, "financial-checkpoint.json");
  assert(
    JSON.parse(reviewCommand(["checkpoint", "--output", checkpoint])).status ===
      "checkpoint-created",
    "Compiled financial checkpoint failed",
  );
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
  const reviewFile = join(directory, "review.json"),
    reportFile = join(directory, "reviewed.json"),
    proof = join(directory, "operator-evidence.txt");
  assert(
    JSON.parse(
      reviewCommand(
        ["template", "--data", join(target, "data"), "--output", reviewFile],
        freshHostEnvironment,
      ),
    ).reopeningAllowed === false,
    "Compiled review template implied reopening",
  );
  const review = JSON.parse(await readFile(reviewFile, "utf8"));
  await writeFile(
    proof,
    "Synthetic current identity, employer roster, unpaid financial register and source-retirement evidence for this local drill only.",
    { mode: 0o600 },
  );
  review.confirmation =
    "I reviewed current identities, employer access, financial records and retirement of the previous service";
  review.reviewedThrough = new Date().toISOString();
  review.sourceRetirementEvidenceFile = proof;
  review.financialCheckpointFile = checkpoint;
  for (const org of review.organizations) {
    org.financialEvidenceFile = proof;
    org.rosterEvidenceFile = proof;
    for (const member of org.members) {
      member.decision = "keep";
      member.identityEvidenceFile = proof;
    }
  }
  await writeFile(reviewFile, JSON.stringify(review));
  const validated = JSON.parse(
    reviewCommand(
      [
        "validate",
        "--data",
        join(target, "data"),
        "--manifest",
        reviewFile,
        "--output",
        reportFile,
      ],
      freshHostEnvironment,
    ),
  );
  assert(
    validated.status === "reviewed-not-enrolled" &&
      validated.reopeningAllowed === false &&
      validated.selectedMemberships === 1,
    "Compiled recovery review changed enrollment or release authority",
  );
  assert(
    !(await readFile(reportFile, "utf8")).includes(authSecret),
    "Compiled review exposed the service auth secret",
  );
  const enrollmentEnvironment = {
      ...environment,
      SERVICE_NATIVE_CONFIG: join(target, "service.vars"),
      SERVICE_NATIVE_DATA: join(target, "data"),
    },
    linksFile = join(directory, "private-enrollment-links.json");
  const enrollmentCommand = (args) =>
    execFileSync(
      process.execPath,
      ["dist/native-service/service/node/recovery-enrollment-cli.js", ...args],
      {
        cwd: root,
        env: enrollmentEnvironment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  assert(
    JSON.parse(enrollmentCommand(["issue", "--manifest", reviewFile, "--output", linksFile]))
      .users === 1,
    "Compiled enrollment issuance failed",
  );
  const privateLink = JSON.parse(await readFile(linksFile, "utf8")).links[0].url,
    activationToken = new URLSearchParams(new URL(privateLink).hash.slice(1)).get("enroll"),
    newPassword = "synthetic compiled replacement password!";
  base = await start(
    [
      "dist/native-service/service/node/recovery-enrollment-cli.js",
      "serve",
      "--manifest",
      reviewFile,
    ],
    enrollmentEnvironment,
  );
  cookies.clear();
  assert(
    (
      await request("/service/api/recovery/enrollment/start", {
        token: activationToken,
        newPassword,
      })
    ).status === 200,
    "Compiled fresh password enrollment failed",
  );
  const setupResponse = await request("/service/api/recovery/enrollment/authenticator", {
    password: newPassword,
  });
  assert(setupResponse.status === 200, "Compiled authenticator setup failed");
  const authenticator = await setupResponse.json();
  assert(
    (
      await request("/service/api/recovery/enrollment/verify", {
        code: authenticatorCode(authenticator.totpURI),
      })
    ).status === 200,
    "Compiled fresh TOTP verification failed",
  );
  const enrollmentStatus = await (await request("/service/api/recovery/enrollment/status")).json();
  assert(
    enrollmentStatus.phase === "ready" && enrollmentStatus.reopeningAllowed === false,
    "Compiled enrollment bypassed quarantine",
  );
  assert(
    (await request("/service/api/v1/me")).status === 404,
    "Enrollment exposed the ordinary account API",
  );
  let locked = false;
  try {
    enrollmentCommand([
      "reissue",
      "--manifest",
      reviewFile,
      "--email",
      email,
      "--output",
      join(directory, "must-not-exist.json"),
    ]);
  } catch (error) {
    locked = true;
    assert(
      !String(error.stdout).trim() && !String(error.stderr).includes(activationToken),
      "Custody rejection exposed private enrollment material",
    );
  }
  assert(locked, "An active enrollment process did not exclude reissue");
  await stop();
  assert(
    !captured.includes(activationToken) &&
      !captured.includes(newPassword) &&
      !captured.includes(authenticator.totpURI),
    "Compiled enrollment logged private material",
  );
  async function assertQuarantined(restoredEnvironment) {
    const failedStart = spawn(process.execPath, ["dist/native-service/service/node/main.js"], {
      cwd: root,
      env: restoredEnvironment,
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
  }
  await assertQuarantined(enrollmentEnvironment);
  const releaseCommand = () =>
    execFileSync(
      process.execPath,
      [
        "dist/native-service/service/node/recovery-release-cli.js",
        "--manifest",
        reviewFile,
        "--confirm",
        "I authorize reopening this reviewed replacement after retiring the previous service",
      ],
      {
        cwd: root,
        env: enrollmentEnvironment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const released = JSON.parse(releaseCommand());
  assert(released.status === "released", "Compiled reviewed release failed");
  assert(
    JSON.parse(releaseCommand()).status === "already-released",
    "Compiled committed-release retry failed",
  );
  base = await start(undefined, enrollmentEnvironment);
  assert(
    (await request("/service/api/v1/me")).status === 401,
    "Enrollment session crossed into normal service",
  );
  const freshLogin = await request("/service/api/auth/sign-in/email", {
    email,
    password: newPassword,
  });
  assert(
    freshLogin.ok && (await freshLogin.json()).twoFactorRedirect === true,
    "Normal fresh sign-in skipped MFA after release",
  );
  assert(
    (await request("/service/api/v1/me")).status === 401,
    "Pre-MFA sign-in authorized company access",
  );
  assert(
    (
      await request("/service/api/auth/two-factor/verify-totp", {
        code: authenticatorCode(authenticator.totpURI),
        trustDevice: false,
      })
    ).ok,
    "Normal post-release MFA failed",
  );
  assert(
    (await request("/service/api/v1/me")).ok,
    "Reviewed account could not reopen company access",
  );
  await stop();
  const releasedBundle = join(directory, "released.bundle"),
    secondTarget = join(directory, "second-replacement");
  const releasedExport = JSON.parse(
    recoveryCommand(["export", "--output", releasedBundle], enrollmentEnvironment),
  );
  assert(
    JSON.parse(recoveryCommand(["inspect", "--input", releasedBundle], freshHostEnvironment))
      .accounts === 1,
    "Released-source inspection required lost config",
  );
  const secondRestore = JSON.parse(
    recoveryCommand(
      ["restore", "--input", releasedBundle, "--target", secondTarget],
      freshHostEnvironment,
    ),
  );
  assert(
    secondRestore.status === "quarantined" &&
      secondRestore.restoreId !== released.restoreId &&
      secondRestore.snapshotSha256 === releasedExport.snapshotSha256,
    "Released-source restore retained old authority",
  );
  await assertQuarantined({
    ...enrollmentEnvironment,
    SERVICE_NATIVE_CONFIG: join(secondTarget, "service.vars"),
    SERVICE_NATIVE_DATA: join(secondTarget, "data"),
  });
  console.log(
    "Native commercial runtime passed: compiled boot and migrations, local verification, scoped-cookie login, organization/session persistence, clean restart, encrypted backup/inspection without source config, financial checkpoint, fresh-path quarantined restore, restore-bound recovery review, one-time fresh password/TOTP enrollment, cross-process lifecycle exclusion, atomic reviewed release, normal fresh-MFA sign-in and released-source backup restored into fresh quarantine, with no HTTP outbox or secret logging.",
  );
} finally {
  await stop().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
