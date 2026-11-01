import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { smtpCertificates, syntheticSmtp, messageText } from "../test/native/smtp-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)),
  directory = await mkdtemp(join(tmpdir(), "chargeos-compiled-mail-")),
  configuration = join(directory, "service.vars"),
  smtpFile = join(directory, "smtp.json"),
  origin = "http://127.0.0.1:5173";
const authSecret = "synthetic compiled SMTP auth secret!",
  smtpOptions = { starttls: true, holdData: false };
const certificates = await smtpCertificates(),
  smtp = await syntheticSmtp(certificates, smtpOptions),
  children = new Set();
const environment = {
  ...process.env,
  SERVICE_NATIVE_CONFIG: configuration,
  SERVICE_NATIVE_DATA: join(directory, "data"),
  SERVICE_NATIVE_PORT: "0",
};
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
function child(args) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    diagnostics = "";
  process.stdout.on("data", (part) => {
    output += part;
  });
  process.stderr.on("data", (part) => {
    diagnostics += part;
  });
  const exited = once(process, "exit");
  children.add(process);
  process.once("exit", () => children.delete(process));
  return { process, exited, output: () => output, diagnostics: () => output + diagnostics };
}
async function result(command) {
  const timer = setTimeout(() => command.process.kill("SIGKILL"), 40000);
  try {
    const [code, signal] = await command.exited;
    assert(code === 0 && !signal, "Compiled mail command failed");
    return command.output();
  } finally {
    clearTimeout(timer);
  }
}
async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Compiled mail runtime condition timed out");
}
async function writeConfiguration(delivery) {
  await writeFile(
    configuration,
    `SERVICE_MODE=local\nSERVICE_ORIGIN=${origin}\nSERVICE_AUTH_SECRET=${authSecret}\nSERVICE_DELIVERY=${delivery}\n`,
    { mode: 0o600 },
  );
}
let web, base;
const cookies = new Map();
async function start() {
  web = child(["dist/native-service/service/node/main.js"]);
  await until(() => /listening on (http:\/\/127.0.0.1:\d+)/.test(web.output()));
  base = web.output().match(/listening on (http:\/\/127.0.0.1:\d+)/)[1];
}
async function stop() {
  if (web) {
    web.process.kill("SIGTERM");
    await result(web);
    web = undefined;
  }
}
async function request(path, body) {
  const url = new URL(path, origin),
    response = await fetch(base + url.pathname + url.search, {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";"),
      at = pair.indexOf("="),
      key = pair.slice(0, at),
      value = pair.slice(at + 1);
    if (value) cookies.set(key, value);
    else cookies.delete(key);
  }
  return response;
}
const queue = () => {
  const db = new DatabaseSync(join(directory, "data/commercial.sqlite"));
  try {
    return db
      .prepare("SELECT channel,status,recipient FROM local_outbox ORDER BY created_at,id")
      .all();
  } finally {
    db.close();
  }
};
try {
  await writeConfiguration("local");
  await start();
  assert(
    (
      await request("/service/api/auth/sign-up/email", {
        email: "old-local@example.test",
        name: "Old local account",
        password: "synthetic old SMTP password!",
        callbackURL: `${origin}/service`,
      })
    ).ok,
    "Compiled local signup failed",
  );
  await stop();
  await writeConfiguration("smtp");
  await start();
  await result(
    child(["dist/native-service/service/node/mail-cli.js", "template", "--output", smtpFile]),
  );
  const settings = JSON.parse(await readFile(smtpFile, "utf8"));
  Object.assign(settings, {
    host: smtp.config.host,
    port: smtp.port,
    security: "starttls",
    username: smtp.config.username,
    password: smtp.config.password,
    sender: smtp.config.sender,
    caFile: certificates.caFile,
  });
  await writeFile(smtpFile, JSON.stringify(settings));
  const command = () =>
    child(["dist/native-service/service/node/mail-cli.js", "once", "--smtp-config", smtpFile]);
  assert(
    JSON.parse(await result(command())).accepted === 0 && smtp.messages.length === 0,
    "SMTP opt-in dispatched historical local links",
  );
  const email = "fresh-smtp@example.test",
    password = "synthetic fresh SMTP password!";
  assert(
    (
      await request("/service/api/auth/sign-up/email", {
        email,
        name: "Fresh SMTP account",
        password,
        callbackURL: `${origin}/service`,
      })
    ).ok,
    "Compiled SMTP signup failed",
  );
  const output = await result(command());
  assert(JSON.parse(output).accepted === 1, "Compiled SMTP delivery failed");
  const link = messageText(smtp.messages[0]).match(/Open this private link:\n([^\n]+)/)[1];
  assert([200, 302].includes((await request(link)).status), "Delivered verification link failed");
  assert(
    (await request("/service/api/auth/sign-in/email", { email, password })).ok,
    "Delivered verification did not permit normal sign-in",
  );
  assert((await request("/service/api/v1/me")).ok, "Compiled verified account unavailable");
  assert(
    !queue().some((row) => row.channel === "smtp"),
    "SMTP acceptance retained a private payload",
  );

  smtpOptions.holdData = true;
  assert(
    (
      await request("/service/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin}/service`,
      })
    ).ok,
    "Compiled reset queue failed",
  );
  const runner = child([
    "dist/native-service/service/node/mail-cli.js",
    "run",
    "--smtp-config",
    smtpFile,
  ]);
  await until(() => smtp.releases.length === 1);
  runner.process.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(runner.process.exitCode === null, "Mailer released custody before active DATA settled");
  smtp.releases.shift()();
  const stopped = await result(runner);
  assert(JSON.parse(stopped).accepted === 1, "Graceful SMTP shutdown lost durable acknowledgement");
  const reset = messageText(smtp.messages[1]).match(/Open this private link:\n([^\n]+)/)[1],
    token = new URL(reset).pathname.split("/").pop();
  assert(
    (
      await request("/service/api/auth/reset-password", {
        token,
        newPassword: "synthetic replaced SMTP password!",
      })
    ).ok,
    "Delivered compiled reset link failed",
  );
  assert(
    (await request("/service/api/v1/me")).status === 401,
    "Password reset kept an old session alive",
  );
  const allOutput = output + stopped + web.diagnostics();
  for (const secret of [authSecret, smtp.config.password, email, password, link, reset])
    assert(!allOutput.includes(secret), "Compiled mail runtime logged private material");
  console.log(
    "Native SMTP runtime passed: compiled opt-in and historical-local isolation, verified STARTTLS delivery, real verification/reset links, session revocation, accepted-payload deletion, and SIGTERM draining through socket close and durable acknowledgement, with no private-link/address/credential logs.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.allSettled([...children].map((child) => once(child, "exit")));
  await smtp.close();
  await certificates.close();
  await rm(directory, { recursive: true, force: true });
}
