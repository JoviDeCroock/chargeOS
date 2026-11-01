import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:https";
import { companyDeploymentInput, prepareCompanyDeployment } from "./company-deployment.mjs";
import { inspectLocalDocker } from "./docker-destination.mjs";
import { deploymentDockerEnvironment } from "./docker-destination.mjs";
import { smtpCertificates, messageText } from "../test/native/smtp-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)),
  directory = mkdtempSync(join(tmpdir(), "chargeos-company-managed-")),
  id = `chargeos-managed-company-${process.pid}-${Date.now()}`;
// Official image index resolved 2026-11-01; fixture only, never a company image.
const traefik =
  "traefik:v3.7.17@sha256:30ff62491aacdb862ceb8c9edcf2627da638d7deafdd4b6dab32fe34f8aa3e90";
const domain = "accounts.example.test",
  origin = `https://${domain}`,
  shared = `${id}-shared`;
const images = [`${id}:runtime`, `${id}:proxy`],
  env = deploymentDockerEnvironment();
let context = [],
  args = [],
  network,
  prepared,
  certificates,
  mailCertificates,
  port;
const cookies = new Map();
function docker(argv, input) {
  return execFileSync("docker", [...context, ...argv], {
    cwd: root,
    env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 240000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
const compose = (argv) => docker([...args, ...argv]);
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
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
        ca: certificates.cert,
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
    req.setTimeout(5000, () => req.destroy(new Error("Synthetic HTTPS deadline")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
try {
  const destination = await inspectLocalDocker();
  context = ["--context", destination.context];
  for (const [index, target] of ["runtime", "proxy"].entries())
    docker(["build", "--target", target, "-f", "Dockerfile.company", "-t", images[index], "."]);
  const input = companyDeploymentInput({
    target: "coolify",
    name: "synthetic-managed",
    companyDomain: domain,
    signupDomains: "example.test",
    email: "operator@example.test",
    smtpHost: "mail.example.test",
    smtpPort: "2525",
    smtpSecurity: "starttls",
    smtpUsername: "synthetic",
    smtpPassword: "synthetic managed SMTP password",
    smtpSender: "accounts@example.test",
    cloudOrigin: "https://app.coolify.io",
    cloudToken: "synthetic-unused-api-token",
    projectId: "project",
    serverId: "server",
    environment: "production",
    gitRepository: "https://github.com/JoviDeCroock/chargeOS",
    gitBranch: "main",
    gitCommit: "a".repeat(40),
    image: `ghcr.io/example/company@sha256:${"b".repeat(64)}`,
    proxyImage: `ghcr.io/example/proxy@sha256:${"c".repeat(64)}`,
    cloudPrivacyConfirmed: true,
    deploy: false,
  });
  prepared = await prepareCompanyDeployment(input, directory);
  const model = prepared.model,
    runtime = docker(["image", "inspect", images[0], "--format", "{{.Id}}"]).trim(),
    proxy = docker(["image", "inspect", images[1], "--format", "{{.Id}}"]).trim();
  for (const name of ["accounts", "mailer", "credentials"]) model.services[name].image = runtime;
  model.services.proxy.image = proxy;
  model.services.credentials.environment.COMPANY_BOOTSTRAP_AUTH = readFileSync(
    join(prepared.directory, "secrets/company_auth"),
    "utf8",
  );
  model.services.credentials.environment.COMPANY_BOOTSTRAP_SMTP = readFileSync(
    join(prepared.directory, "secrets/company_smtp"),
    "utf8",
  );
  network = model.networks["company-ingress"].name;
  docker(["network", "create", network]);
  docker(["network", "create", shared]);
  certificates = await smtpCertificates(domain);
  mailCertificates = await smtpCertificates("mail.example.test");
  save("tls.crt", certificates.cert);
  save("tls.key", certificates.key);
  save("mail-ca.crt", mailCertificates.cert);
  save(
    "mail-certificates.json",
    JSON.stringify({ key: mailCertificates.key, cert: mailCertificates.cert }),
  );
  save(
    "tls.yaml",
    "tls:\n  certificates:\n    - certFile: /fixtures/tls.crt\n      keyFile: /fixtures/tls.key\n",
  );
  // The only platform substitution is a synthetic certificate instead of ACME.
  // All routing/network labels are exercised by the real Docker provider.
  model.services.proxy.labels = model.services.proxy.labels.filter(
    (l) => !l.includes(".tls.certresolver="),
  );
  model.services.proxy.extra_hosts = ["mail.example.test=127.0.0.1"];
  model.services.platform = {
    image: traefik,
    networks: ["company-ingress", "shared-fixture"],
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    ports: ["127.0.0.1::8443/tcp"],
    command: [
      "--entrypoints.https.address=:8443",
      "--providers.docker=true",
      "--providers.docker.exposedbydefault=false",
      "--providers.file.filename=/fixtures/tls.yaml",
      "--log.level=ERROR",
      "--log.filepath=/dev/null",

      "--accesslog=false",
      "--api.dashboard=false",
    ],
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro", `${directory}:/fixtures:ro`],
  };
  model.networks["shared-fixture"] = { external: true, name: shared };
  model.services["smtp-fixture"] = {
    image: runtime,
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
  model.services.mailer.environment.NODE_EXTRA_CA_CERTS = "/run/test-mail-ca.crt";
  model.services.mailer.volumes.push(`${join(directory, "mail-ca.crt")}:/run/test-mail-ca.crt:ro`);
  model.services.mailer.depends_on["smtp-fixture"] = { condition: "service_started" };
  writeFileSync(join(prepared.directory, "compose.json"), JSON.stringify(model));
  args = ["compose", "--project-name", model.name, "-f", join(prepared.directory, "compose.json")];
  compose(["up", "--detach", "--wait", "--wait-timeout", "120"]);
  port = Number(compose(["port", "platform", "8443"]).trim().split(":").at(-1));
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      ready = (await browser("/service/api/v1/health")).status === 200;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "Platform TLS -> dedicated ingress -> company health failed");
  compose([
    "exec",
    "-T",
    "accounts",
    "node",
    "-e",
    "const f=require('fs');if(f.readdirSync('/run/secrets',{recursive:true}).some(p=>p.includes('company_smtp')))process.exit(1);try{f.readFileSync('/run/secrets/smtp/company_smtp');process.exit(1)}catch{}",
  ]);
  const seedId = compose(["ps", "--all", "-q", "credentials"]).trim(),
    seedState = JSON.parse(docker(["inspect", seedId]))[0];
  assert(
    seedState.Config.User === "1000:1000" &&
      seedState.HostConfig.ReadonlyRootfs &&
      seedState.HostConfig.NetworkMode === "none",
    "Credential initializer escaped non-root read-only/no-network custody",
  );
  const resolved = JSON.parse(compose(["config", "--format", "json"]));
  assert(
    !resolved.services.proxy.ports &&
      Object.keys(resolved.services.proxy.networks).join() === "company-ingress",
    "Company proxy exposed a host/shared network",
  );
  const proxyId = compose(["ps", "-q", "proxy"]).trim(),
    proxyState = JSON.parse(docker(["inspect", proxyId]))[0];
  assert(
    Object.keys(proxyState.NetworkSettings.Networks).join() === network,
    "Company proxy joined an unexpected runtime network",
  );
  const ip = proxyState.NetworkSettings.Networks[network].IPAddress;
  for (const targetPort of [8080, 9091]) {
    docker([
      "run",
      "--rm",
      "--network",
      shared,
      "--read-only",
      "--user",
      "1000:1000",
      "--cap-drop",
      "ALL",
      "--entrypoint",
      "node",
      runtime,
      "-e",
      `const r=require('http').get({host:${JSON.stringify(ip)},port:${targetPort},path:'/service/api/v1/health',headers:{Host:${JSON.stringify(domain)},'X-Forwarded-Proto':'https','X-ChargeOS-Client-IP':'127.0.0.1'}},()=>process.exit(1));r.on('error',()=>process.exit(0));r.setTimeout(1500,()=>{r.destroy();process.exit(0)});`,
    ]);
  }
  // A legitimate ingress peer can reach 8080, but cannot bypass Caddy to 9091.
  docker([
    "run",
    "--rm",
    "--network",
    network,
    "--read-only",
    "--entrypoint",
    "node",
    runtime,
    "-e",
    `const s=require('net').connect(9091,${JSON.stringify(ip)});s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));s.setTimeout(1500,()=>{s.destroy();process.exit(0)});`,
  ]);
  for (const path of [
    "/api/v1/fleet",
    "/preview",
    "/observe",
    "/service/recovery",
    "/service/api/recovery/enrollment/start",
  ])
    assert(
      (await browser(path)).status === 404,
      "Managed company crossed an owner/recovery route boundary",
    );
  const email = "employee@example.test",
    password = "synthetic managed account password!";
  assert(
    (
      await browser("/service/api/auth/sign-up/email", {
        email,
        name: "Synthetic Employee",
        password,
        callbackURL: `${origin}/service`,
      })
    ).status === 200,
    "Managed signup failed",
  );
  let delivered;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const messages = JSON.parse(
        compose(["exec", "-T", "smtp-fixture", "cat", "/data/messages.json"]),
      );
      delivered =
        messages[0] &&
        messageText(messages[0])
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith(`${origin}/service/api/auth/verify-email?`));
    } catch {}
    if (delivered) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(delivered, "Managed file-based SMTP did not deliver verification over trusted STARTTLS");
  const link = new URL(delivered);
  assert(
    [200, 302].includes((await browser(link.pathname + link.search)).status),
    "Managed verification failed",
  );
  const login = await browser("/service/api/auth/sign-in/email", { email, password });
  assert(
    login.status === 200 &&
      login.headers["set-cookie"].some((c) => c.includes("Secure") && c.includes("HttpOnly")),
    "Managed secure sign-in failed",
  );
  const before = compose([
    "exec",
    "-T",
    "accounts",
    "node",
    "-e",
    "console.log(require('fs').readFileSync('/run/secrets/auth/company_auth','utf8'))",
  ]).trim();
  compose(["run", "--rm", "--no-deps", "credentials"]);
  let refused = false;
  try {
    compose([
      "run",
      "--rm",
      "--no-deps",
      "-e",
      `COMPANY_BOOTSTRAP_AUTH=${"z".repeat(64)}`,
      "credentials",
    ]);
  } catch {
    refused = true;
  }
  assert(refused, "Changed bootstrap key was accepted");
  assert(
    compose([
      "exec",
      "-T",
      "accounts",
      "node",
      "-e",
      "console.log(require('fs').readFileSync('/run/secrets/auth/company_auth','utf8'))",
    ]).trim() === before,
    "Restart replaced a durable company secret",
  );
  compose(["restart", "accounts"]);
  let persisted = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      persisted = (await browser("/service/api/v1/me")).status === 200;
    } catch {}
    if (persisted) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(persisted, "Managed records/session did not survive a compiled service restart");
  const token = "synthetic-private-token-must-not-appear-in-any-log";
  for (const path of [
    `/service/api/auth/verify-email?token=${token}`,
    `/service/api/auth/reset-password/${token}`,
  ])
    await browser(path);
  compose(["stop", "mailer", "accounts"]);
  assert(
    (await browser(`/service/api/auth/verify-email?token=${token}`)).status === 502,
    "Stopped managed backend did not fail closed",
  );
  await browser(`/service/api/auth/reset-password/${token}`);
  const logs = compose(["logs", "--no-color"]);
  for (const secret of [
    token,
    before,
    email,
    password,
    delivered,
    input.smtp.password,
    input.cloudToken,
  ])
    assert(
      !logs.includes(secret),
      "Managed private account material leaked to platform/application logs",
    );
  console.log(
    "Managed company runtime passed: actual Traefik TLS/Docker labels, isolated destination numeric-IP sibling rejection, loopback-only backend, fresh-volume create-only credentials/exact restart/mismatch refusal, verified STARTTLS email, Secure session and persisted restart, owner/recovery exclusion and token-free platform/Caddy/application errors. No real cloud account or external mail was used.",
  );
} finally {
  if (args.length)
    try {
      compose(["down", "--volumes", "--remove-orphans"]);
    } catch {}
  for (const name of [network, shared].filter(Boolean))
    try {
      docker(["network", "rm", name]);
    } catch {}
  for (const image of images)
    try {
      docker(["image", "rm", image]);
    } catch {}
  await certificates?.close();
  await mailCertificates?.close();
  chmodSync(directory, 0o700);
  rmSync(directory, { recursive: true, force: true });
}
