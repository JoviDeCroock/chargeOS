import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:https";
import { createHmac } from "node:crypto";
import { companyDeploymentInput } from "./company-deployment.mjs";
import { prepareCompanyRecoveryDeployment } from "./company-recovery.mjs";
import {
  inspectLocalDocker,
  proveLocalDocker,
  deploymentDockerEnvironment,
} from "./docker-destination.mjs";
import { smtpCertificates, messageText } from "../test/native/smtp-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)),
  directory = realpathSync(mkdtempSync(join(tmpdir(), "chargeos-company-recovery-"))),
  domain = "accounts.example.test",
  origin = `https://${domain}`,
  environment = deploymentDockerEnvironment();
let args = [],
  context = [],
  prepared,
  certificates,
  port,
  ca;
const cookies = new Map();
function docker(argv, input) {
  return execFileSync("docker", [...context, ...argv], {
    cwd: root,
    env: environment,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 240000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
const compose = (argv, input) => docker([...args, ...argv], input);
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
function save(name, value) {
  writeFileSync(join(directory, name), value, { mode: 0o444, flag: "wx" });
}
function browser(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        servername: domain,
        ca,
        method: body === undefined ? "GET" : "POST",
        path,
        headers: {
          Host: domain,
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          for (const cookie of res.headers["set-cookie"] ?? []) {
            const pair = cookie.split(";")[0],
              at = pair.indexOf("=");
            cookies.set(pair.slice(0, at), pair.slice(at + 1));
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Recovery HTTPS deadline")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
function totp(uri, now) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    secret = new URL(uri).searchParams.get("secret");
  let bits = "";
  for (const c of secret.replace(/=+$/, ""))
    bits += alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const mac = createHmac("sha1", bytes).update(count).digest(),
    offset = mac.at(-1) & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
try {
  const capsule = join(directory, "capsule");
  execFileSync(process.execPath, ["scripts/build-native-service.mjs"], {
    cwd: root,
    env: environment,
    stdio: "pipe",
    timeout: 120000,
  });
  execFileSync(process.execPath, ["scripts/verify-native-service.mjs"], {
    cwd: root,
    env: { ...environment, CHARGEOS_SYNTHETIC_PUBLIC_CAPSULE: capsule },
    stdio: "pipe",
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const login = JSON.parse(readFileSync(join(directory, "synthetic-login.json"), "utf8")),
    key = readFileSync(join(capsule, "auth.key"), "utf8");
  const destination = await inspectLocalDocker();
  await proveLocalDocker(destination);
  context = ["--context", destination.context];
  const input = companyDeploymentInput({
    target: "docker",
    name: "synthetic-recovery",
    companyDomain: domain,
    signupDomains: "example.test",
    email: "operator@example.test",
    smtpHost: "mail.example.test",
    smtpPort: "2525",
    smtpSecurity: "starttls",
    smtpUsername: "synthetic",
    smtpPassword: "synthetic fresh recovery SMTP password",
    smtpSender: "accounts@example.test",
    deploy: true,
  });
  input.dockerContext = destination.context;
  prepared = await prepareCompanyRecoveryDeployment(input, capsule, directory);
  const model = prepared.model;
  args = ["compose", "--project-name", model.name, "-f", join(prepared.directory, "compose.json")];
  const caddyPath = join(prepared.directory, "Caddyfile");
  chmodSync(caddyPath, 0o600);
  writeFileSync(
    caddyPath,
    readFileSync(caddyPath, "utf8").replace(
      "https://{$COMPANY_DOMAIN}:8443 {",
      "https://{$COMPANY_DOMAIN}:8443 {\n  tls internal",
    ),
  );
  chmodSync(caddyPath, 0o444);
  model.services.proxy.ports = ["127.0.0.1::8080/tcp", "127.0.0.1::8443/tcp"];
  certificates = await smtpCertificates("mail.example.test");
  save(
    "mail-certificates.json",
    JSON.stringify({ key: certificates.key, cert: certificates.cert }),
  );
  save("mail-ca.crt", certificates.cert);
  const smtpPath = join(prepared.directory, "secrets/company_smtp"),
    smtp = JSON.parse(readFileSync(smtpPath, "utf8"));
  smtp.caFile = "/run/secrets/company_smtp_ca";
  chmodSync(smtpPath, 0o600);
  writeFileSync(smtpPath, JSON.stringify(smtp));
  chmodSync(smtpPath, 0o444);
  model.secrets.company_smtp_ca = { file: join(directory, "mail-ca.crt") };
  model.services.mailer.secrets.push("company_smtp_ca");
  model.services.proxy.extra_hosts = ["mail.example.test=127.0.0.1"];
  model.services["smtp-fixture"] = {
    image: model.services.accounts.image,
    user: "1000:1000",
    network_mode: "service:proxy",
    read_only: true,
    cap_drop: ["ALL"],
    healthcheck: {
      test: [
        "CMD",
        "node",
        "-e",
        "const s=require('net').connect(2525,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1))",
      ],
      interval: "1s",
      timeout: "2s",
      retries: 20,
      start_period: "1s",
    },
    volumes: [
      "smtp-fixture:/data",
      `${join(root, "test/native/smtp-fixture.mjs")}:/fixture.mjs:ro`,
      `${join(directory, "mail-certificates.json")}:/certificates.json:ro`,
    ],
    command: [
      "node",
      "--input-type=module",
      "-e",
      "import{readFileSync,writeFileSync}from'node:fs';import{syntheticSmtp}from'/fixture.mjs';const s=await syntheticSmtp(JSON.parse(readFileSync('/certificates.json','utf8')),{starttls:true,port:2525});setInterval(()=>writeFileSync('/data/messages.json',JSON.stringify(s.messages),{mode:0o600}),50);",
    ],
  };
  model.volumes["smtp-fixture"] = {};
  model.services.mailer.depends_on["smtp-fixture"] = { condition: "service_started" };
  writeFileSync(join(prepared.directory, "compose.json"), JSON.stringify(model));
  try {
    execFileSync(process.execPath, ["scripts/resume-company.mjs", "--start", prepared.directory], {
      cwd: root,
      env: { ...environment, DOCKER_CONTEXT: destination.context },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    throw new Error("Synthetic recovery deployment failed: " + compose(["logs", "--no-color"]));
  }
  const installId = compose(["ps", "--all", "-q", "recovery-install"]).trim(),
    install = JSON.parse(docker(["inspect", installId]))[0];
  assert(
    install.Config.User === "1000:1000" &&
      install.HostConfig.NetworkMode === "none" &&
      install.HostConfig.ReadonlyRootfs,
    "Recovery initializer escaped its network-free non-root read-only boundary",
  );
  port = Number(compose(["port", "proxy", "8443"]).trim().split(":").at(-1));
  ca = compose(["exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt"]);
  assert(
    (await browser("/service/api/v1/health")).status === 200,
    "Recovered HTTPS service is unavailable",
  );
  assert(
    (
      await browser("/service/api/v1/me", undefined, {
        Cookie: login.oldCookies.map(([k, v]) => `${k}=${v}`).join("; "),
      })
    ).status === 401,
    "Old local session reopened recovered public access",
  );
  const signedIn = await browser("/service/api/auth/sign-in/email", {
    email: login.email,
    password: login.password,
  });
  assert(
    signedIn.status === 200 && JSON.parse(signedIn.body).twoFactorRedirect === true,
    "Fresh recovered sign-in skipped MFA",
  );
  const now = Number(
    compose(["exec", "-T", "accounts", "node", "-e", "console.log(Date.now())"]).trim(),
  );
  const mfa = await browser("/service/api/auth/two-factor/verify-totp", {
    code: totp(login.totpURI, now),
    trustDevice: false,
  });
  assert(
    mfa.status === 200 &&
      mfa.headers["set-cookie"].some((c) => c.includes("Secure") && c.includes("HttpOnly")),
    "Fresh recovered authenticator or Secure session failed",
  );
  assert(
    (await browser("/service/api/v1/me")).status === 200,
    "Recovered verified MFA session could not access its organization",
  );
  const inode = compose([
    "exec",
    "-T",
    "accounts",
    "node",
    "-e",
    "console.log(require('fs').statSync('/data/commercial.sqlite').ino)",
  ]).trim();
  const again = compose(["run", "--rm", "--no-deps", "recovery-install"]);
  assert(
    again.includes('"status":"already-installed"'),
    "Recovery installer did not recognize its current live installation",
  );
  assert(
    compose([
      "exec",
      "-T",
      "accounts",
      "node",
      "-e",
      "console.log(require('fs').statSync('/data/commercial.sqlite').ino)",
    ]).trim() === inode,
    "Recovery restart replaced the current database",
  );
  assert(
    (
      await browser("/service/api/auth/request-password-reset", {
        email: login.email,
        redirectTo: `${origin}/service`,
      })
    ).status === 200,
    "Recovered public reset request failed",
  );
  let messages = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      messages = JSON.parse(compose(["exec", "-T", "smtp-fixture", "cat", "/data/messages.json"]));
    } catch {}
    if (messages.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const delivered =
    messages[0] &&
    messageText(messages[0])
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${origin}/service/api/auth/reset-password/`));
  assert(
    messages.length === 1 && delivered,
    "Fresh recovered SMTP did not deliver exactly the new public-origin link",
  );
  compose(["stop", "mailer"]);
  compose(["restart", "accounts"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await browser("/service/api/v1/me")).status === 200;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "Recovered data/session did not survive normal process restart");
  const phrase = "synthetic public recovery runtime passphrase!";
  compose(
    [
      "exec",
      "-T",
      "accounts",
      "node",
      "-e",
      "const f=require('fs');f.mkdirSync('/tmp/recovery-proof',{mode:448});f.writeFileSync('/tmp/recovery-proof/passphrase',f.readFileSync(0),{mode:384,flag:'wx'})",
    ],
    phrase,
  );
  const recovery = (argv) =>
    compose([
      "exec",
      "-T",
      "accounts",
      "node",
      "dist/native-service/service/node/recovery-cli.js",
      ...argv,
      "--passphrase-file",
      "/tmp/recovery-proof/passphrase",
    ]);
  recovery(["export", "--output", "/tmp/recovery-proof/public.bundle"]);
  const restored = JSON.parse(
    recovery([
      "restore",
      "--input",
      "/tmp/recovery-proof/public.bundle",
      "--target",
      "/tmp/recovery-proof/new-review",
    ]),
  );
  assert(
    restored.status === "quarantined",
    "Public-source backup did not restore into fresh quarantine",
  );
  compose([
    "exec",
    "-T",
    "accounts",
    "node",
    "--input-type=module",
    "-e",
    "import{DatabaseSync}from'node:sqlite';import{nativeConfiguration}from'./dist/native-service/service/node/configuration.js';import{spawnSync}from'node:child_process';const p='/tmp/recovery-proof/new-review',d=new DatabaseSync(p+'/data/commercial.sqlite');try{if(d.prepare(\"SELECT 1 FROM sqlite_schema WHERE name='_chargeos_native_handoff'\").get())throw Error('Active handoff survived');if(d.prepare('SELECT count(*) AS n FROM _chargeos_native_handoff_history').get().n!==1)throw Error('Handoff history lost');for(const t of ['account','session','two_factor','verification','local_outbox'])if(d.prepare('SELECT count(*) AS n FROM '+t).get().n)throw Error('Old auth survived');}finally{d.close()}const local=nativeConfiguration({SERVICE_MODE:'local',SERVICE_NATIVE_CONFIG:p+'/service.vars',SERVICE_NATIVE_DATA:p+'/data'});if(local.configuration.SERVICE_AUTH_SECRET===(await (await import('node:fs/promises')).readFile('/run/secrets/company_auth','utf8')))throw Error('Secret not rotated');const r=spawnSync(process.execPath,['dist/native-service/service/node/main.js'],{env:{...process.env,SERVICE_MODE:'local',SERVICE_NATIVE_CONFIG:p+'/service.vars',SERVICE_NATIVE_DATA:p+'/data'},encoding:'utf8',timeout:5000});if(r.status!==1||r.stdout.includes('listening on'))throw Error('Restored service reopened');",
  ]);
  const token = "synthetic-public-recovery-token-must-never-be-logged";
  compose(["stop", "accounts"]);
  assert(
    (await browser(`/service/api/auth/verify-email?token=${token}`)).status === 502,
    "Stopped recovered upstream did not fail closed",
  );
  await browser(`/service/api/auth/reset-password/${token}`);
  const logs = compose(["logs", "--no-color"]);
  for (const secret of [
    key,
    login.email,
    login.password,
    login.totpURI,
    new URL(login.totpURI).searchParams.get("secret"),
    delivered,
    token,
    phrase,
    input.smtp.password,
  ])
    assert(!logs.includes(secret), "Private recovered account material leaked into Docker logs");
  console.log(
    "Company public recovery Docker passed: compiled review/fresh enrollment/release/source retirement, exact capsule transport and network-free create-only install, HTTPS fresh MFA/Secure cookies, old session rejection, live idempotent install and restart persistence, newly activated verified STARTTLS mail, public backup restored to fresh quarantine with retained history/auth scrub, and token-free stopped-upstream logs. Synthetic evidence only; no external customer/cloud/mail provider was used.",
  );
} finally {
  if (args.length)
    try {
      compose(["down", "--volumes", "--remove-orphans"]);
    } catch {}
  if (prepared)
    for (const image of [
      prepared.model.services.accounts.image,
      prepared.model.services.proxy.image,
    ])
      try {
        docker(["image", "rm", image]);
      } catch {}
  await certificates?.close();
  chmodSync(directory, 0o700);
  rmSync(directory, { recursive: true, force: true });
}
