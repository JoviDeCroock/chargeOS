import { execFileSync } from "node:child_process";
import { companyDeploymentInput, prepareCompanyDeployment } from "./company-deployment.mjs";
import { runDocker } from "./deploy.mjs";
import { inspectLocalDocker, proveLocalDocker } from "./docker-destination.mjs";
import { smtpCertificates, messageText } from "../test/native/smtp-fixture.mjs";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  linkSync,
  symlinkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "chargeos-company-runtime-"));
let project = `chargeos-company-drill-${process.pid}-${Date.now()}`;
const domain = "accounts.example.test",
  origin = `https://${domain}`;
let authSecret, runtimeImage, proxyImage;
let sentinelProject, sentinelFile, certificates;
const environment = { ...process.env };
const args = [];
function docker(argv, input) {
  return execFileSync("docker", argv, {
    cwd: root,
    env: environment,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
}
function compose(argv) {
  return docker([...args, ...argv]);
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function save(name, content, mode = 0o444) {
  writeFileSync(join(directory, name), content, { mode });
}
let port, httpPort, ca;
const cookies = new Map();
function browser(path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const secure = options.secure !== false;
    const req = (secure ? request : httpRequest)(
      {
        hostname: "127.0.0.1",
        port: secure ? port : httpPort,
        method: body === undefined ? "GET" : "POST",
        path,
        ...(secure ? { servername: domain, ca } : {}),
        headers: {
          Host: domain,
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...options.headers,
        },
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("error", reject);
        r.on("end", () => {
          for (const cookie of r.headers["set-cookie"] ?? []) {
            const pair = cookie.split(";")[0],
              at = pair.indexOf("=");
            cookies.set(pair.slice(0, at), pair.slice(at + 1));
          }
          resolve({
            status: r.statusCode,
            headers: r.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Runtime request deadline")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
function sql(query) {
  return compose([
    "exec",
    "-T",
    "accounts",
    "node",
    "--input-type=module",
    "-e",
    `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/data/commercial.sqlite');try{console.log(JSON.stringify(d.prepare(${JSON.stringify(query)}).all()))}finally{d.close()}`,
  ]);
}
try {
  const destination = await inspectLocalDocker();
  await proveLocalDocker(destination);
  const prepared = await prepareCompanyDeployment(
    companyDeploymentInput({
      name: "synthetic-guided-company",
      companyDomain: domain,
      signupDomains: "example.test",
      email: "operator@example.test",
      smtpHost: "mail.example.test",
      smtpPort: "2525",
      smtpSecurity: "starttls",
      smtpUsername: "synthetic",
      smtpPassword: "synthetic SMTP password",
      smtpSender: "accounts@example.test",
      deploy: false,
    }),
    directory,
  );
  project = prepared.model.name;
  authSecret = readFileSync(join(prepared.directory, "secrets/company_auth"), "utf8");
  runtimeImage = prepared.model.services.accounts.image;
  proxyImage = prepared.model.services.proxy.image;
  args.push(
    "compose",
    "--project-name",
    project,
    "--project-directory",
    prepared.directory,
    "-f",
    join(prepared.directory, "compose.json"),
    "-f",
    join(directory, "override.yaml"),
  );
  save("auth", authSecret);
  const caddy = readFileSync(join(prepared.directory, "Caddyfile"), "utf8").replace(
    "https://{$COMPANY_DOMAIN}:8443 {",
    "https://{$COMPANY_DOMAIN}:8443 {\n  tls internal",
  );
  save("Caddyfile", caddy, lstatSync(join(prepared.directory, "Caddyfile")).mode & 0o777);
  // Compose's YAML reset removes the production port list before ephemeral binds.
  save(
    "override.yaml",
    `services:\n  proxy:\n    ports: !override\n      - "127.0.0.1::8080/tcp"\n      - "127.0.0.1::8443/tcp"\n    volumes:\n      - ${JSON.stringify(join(directory, "Caddyfile") + ":/etc/caddy/Caddyfile:ro")}\n`,
  );
  compose(["build", "proxy", "accounts"]);
  certificates = await smtpCertificates("mail.example.test");
  save(
    "smtp-fixture-certificates.json",
    JSON.stringify({ key: certificates.key, cert: certificates.cert }),
  );
  save("smtp-fixture-ca.pem", certificates.cert);
  const smtpPath = join(prepared.directory, "secrets/company_smtp");
  const smtpSettings = JSON.parse(readFileSync(smtpPath, "utf8"));
  smtpSettings.caFile = "/run/secrets/company_smtp_ca";
  chmodSync(smtpPath, 0o600);
  writeFileSync(smtpPath, JSON.stringify(smtpSettings));
  chmodSync(smtpPath, 0o444);
  function secretProbe(mounts, path, accepted, image = runtimeImage) {
    const code = `import {readRuntimeFile} from './dist/native-service/service/node/runtime-files.js';let accepted=false;try{readRuntimeFile(${JSON.stringify(path)},4096,true);accepted=true}catch{}process.exit(accepted===${accepted}?0:1)`;
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--user",
      "1000:1000",
      "--cap-drop",
      "ALL",
      ...mounts.flatMap((m) => ["--mount", m]),
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "-e",
      code,
    ]);
  }
  save(
    "Dockerfile.secret-fixture",
    `FROM ${runtimeImage}\nCOPY --chmod=0444 auth /run/secrets/baked\n`,
  );
  docker([
    "build",
    "--network=none",
    "-t",
    `${project}:secret-fixture`,
    "-f",
    join(directory, "Dockerfile.secret-fixture"),
    directory,
  ]);
  secretProbe([], "/run/secrets/baked", false, `${project}:secret-fixture`);
  const fileMount = (target, ro = true) =>
    `type=bind,src=${join(directory, "auth")},dst=${target}${ro ? ",readonly" : ""}`;
  secretProbe([fileMount("/run/secrets/company_auth")], "/run/secrets/company_auth", true);
  secretProbe([fileMount("/run/secrets/company_auth", false)], "/run/secrets/company_auth", false);
  secretProbe(
    [fileMount("/run/secrets-lookalike/company_auth")],
    "/run/secrets-lookalike/company_auth",
    false,
  );
  mkdirSync(join(directory, "aliases"), { mode: 0o755 });
  mkdirSync(join(directory, "aliases/actual"), { mode: 0o755 });
  save("aliases/actual/auth", authSecret);
  symlinkSync("actual", join(directory, "aliases/alias"));
  symlinkSync("actual/auth", join(directory, "aliases/final"));
  linkSync(join(directory, "aliases/actual/auth"), join(directory, "aliases/hard"));
  const aliasMount = `type=bind,src=${join(directory, "aliases")},dst=/run/secrets,readonly`;
  secretProbe([aliasMount], "/run/secrets/alias/auth", false);
  secretProbe([aliasMount], "/run/secrets/final", false);
  secretProbe([aliasMount], "/run/secrets/hard", false);

  const model = JSON.parse(compose(["config", "--format", "json"]));
  for (const service of ["accounts", "mailer"]) {
    const config = model.services[service];
    assert(
      config.network_mode === "service:proxy" &&
        !config.ports &&
        !config.networks &&
        config.read_only &&
        config.user === "1000:1000",
      "Company service network/user boundary changed",
    );
  }
  // Test-only MTA in the same private loopback namespace. Its real verified
  // STARTTLS exchange exercises the generated SMTP configuration without an
  // external provider, and captures private links only in a disposable volume.
  model.services["smtp-fixture"] = {
    image: runtimeImage,
    network_mode: "service:proxy",
    depends_on: { proxy: { condition: "service_started" } },
    user: "1000:1000",
    cap_drop: ["ALL"],
    read_only: true,
    security_opt: ["no-new-privileges:true"],
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
      "company-smtp-fixture:/data",
      `${join(root, "test/native/smtp-fixture.mjs")}:/fixture.mjs:ro`,
      `${join(directory, "smtp-fixture-certificates.json")}:/certificates.json:ro`,
    ],
    command: [
      "node",
      "--input-type=module",
      "-e",
      "import{readFileSync,writeFileSync}from'node:fs';import{syntheticSmtp}from'/fixture.mjs';const s=await syntheticSmtp(JSON.parse(readFileSync('/certificates.json','utf8')),{starttls:true,port:2525});setInterval(()=>writeFileSync('/data/messages.json',JSON.stringify(s.messages),{mode:0o600}),50);",
    ],
  };
  model.volumes["company-smtp-fixture"] = {};
  model.secrets.company_smtp_ca = { file: join(directory, "smtp-fixture-ca.pem") };
  model.services.mailer.secrets.push({ source: "company_smtp_ca", target: "company_smtp_ca" });
  model.services.proxy.extra_hosts = ["mail.example.test=127.0.0.1"];
  model.services.mailer.depends_on["smtp-fixture"] = {
    condition: "service_started",
    required: true,
  };
  writeFileSync(join(prepared.directory, "compose.json"), JSON.stringify(model, null, 2));
  // From here the production runner sees exactly the same one-file package
  // shape as the wizard. Only loopback ports, test certificates and MTA differ.
  args.splice(args.length - 2, 2);
  sentinelProject = `${project}-sentinel`;
  sentinelFile = join(directory, "sentinel.json");
  writeFileSync(
    sentinelFile,
    JSON.stringify({
      services: {
        accounts: {
          image: runtimeImage,
          network_mode: "none",
          healthcheck: { disable: true },
          read_only: true,
          user: "1000:1000",
          cap_drop: ["ALL"],
          volumes: ["company-data:/data"],
          command: [
            "node",
            "-e",
            "require('fs').writeFileSync('/data/sentinel','synthetic-sentinel',{mode:0o600});setInterval(()=>{},1000)",
          ],
        },
      },
      volumes: { "company-data": {} },
    }),
  );
  const sentinelArgs = ["compose", "--project-name", sentinelProject, "-f", sentinelFile];
  docker([...sentinelArgs, "up", "--detach"]);
  const sentinelId = docker([...sentinelArgs, "ps", "-q", "accounts"]).trim();
  const priorProject = process.env.COMPOSE_PROJECT_NAME;
  process.env.COMPOSE_PROJECT_NAME = sentinelProject;
  try {
    await runDocker(prepared.directory, { project, context: destination.context });
  } catch {
    throw new Error("Synthetic company startup failed: " + compose(["logs", "--no-color"]));
  } finally {
    if (priorProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = priorProject;
  }
  assert(
    docker([...sentinelArgs, "ps", "-q", "accounts"]).trim() === sentinelId,
    "Inherited Compose project replaced the sentinel container",
  );
  const sentinelState = docker([
    ...sentinelArgs,
    "exec",
    "-T",
    "accounts",
    "node",
    "-e",
    "console.log(JSON.stringify(require('fs').readdirSync('/data')))",
  ]).trim();
  assert(
    sentinelState === '["sentinel"]',
    "Company deployment touched an existing sentinel volume",
  );
  port = Number(compose(["port", "proxy", "8443"]).trim().split(":").at(-1));
  httpPort = Number(compose(["port", "proxy", "8080"]).trim().split(":").at(-1));
  ca = compose(["exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt"]);
  assert((await browser("/service/api/v1/health")).status === 200, "Hosted HTTPS health failed");
  const redirect = await browser("/service?private=synthetic", undefined, { secure: false });
  assert(
    redirect.status === 308 && redirect.headers.location === `${origin}/service?private=synthetic`,
    "HTTP redirect leaked the internal TLS port",
  );
  for (const path of [
    "/api/v1/fleet",
    "/preview",
    "/observe",
    "/service/recovery",
    "/service/api/recovery/enrollment/start",
  ])
    assert(
      (await browser(path)).status === 404,
      "Public route crossed an owner/enrollment boundary",
    );
  const page = await browser("/service");
  assert(!page.headers["alt-svc"], "TCP-only profile advertised an unmapped HTTP/3 port");
  assert(
    page.status === 200 &&
      page.body.includes('data-commercial-hosting="production"') &&
      page.headers["content-security-policy"].includes("frame-ancestors 'none'"),
    "Hosted UI boundary failed",
  );
  assert(
    (
      await browser("/service/api/auth/sign-up/email", {
        email: "outside@evil.test",
        name: "Outsider",
        password: "synthetic hosted password!",
      })
    ).status === 400,
    "Public signup domain gate failed",
  );
  const email = "employee@example.test",
    password = "synthetic hosted password!";
  assert(
    (
      await browser("/service/api/auth/sign-up/email", {
        email,
        name: "Synthetic Employee",
        password,
        callbackURL: `${origin}/service`,
      })
    ).status === 200,
    "Hosted signup failed",
  );
  let messages = [];
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      messages = JSON.parse(compose(["exec", "-T", "smtp-fixture", "cat", "/data/messages.json"]));
    } catch {}
    if (messages.length) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const delivered =
    messages[0] &&
    messageText(messages[0])
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${origin}/service/api/auth/verify-email?`));
  const rows = delivered ? [{ url: delivered, channel: "smtp" }] : [];
  assert(
    rows.length === 1 &&
      rows[0].channel === "smtp" &&
      rows[0].url.startsWith(`${origin}/service/api/auth/verify-email?`),
    "Generated SMTP configuration did not deliver a verified public-origin account link",
  );
  const link = new URL(rows[0].url);
  assert(
    [200, 302].includes((await browser(link.pathname + link.search)).status),
    "Hosted verification failed",
  );
  const login = await browser("/service/api/auth/sign-in/email", { email, password });
  assert(
    login.status === 200 &&
      login.headers["set-cookie"].some(
        (c) => c.includes("Secure") && c.includes("HttpOnly") && c.includes("Path=/service/api"),
      ),
    "Hosted secure session failed",
  );
  assert(
    (await browser("/service/api/v1/me")).status === 200,
    "Hosted session did not authenticate",
  );
  compose(["stop", "mailer"]);
  assert(
    JSON.parse(sql("SELECT count(*) AS n FROM local_outbox"))[0].n === 0,
    "Accepted account mail was not durably removed",
  );
  const backupPassphrase = "synthetic-public-recovery-" + randomBytes(24).toString("hex");
  const recoveryProof = docker(
    [
      ...args,
      "exec",
      "-T",
      "accounts",
      "node",
      "--input-type=module",
      "-e",
      `
    import {readFileSync,mkdirSync} from 'node:fs';
    import {nativeConfiguration} from './dist/native-service/service/node/configuration.js';
    import {exportCommercialRecovery,restoreCommercialRecovery} from './dist/native-service/service/node/recovery.js';
    import {checkpointNativeCommercial} from './dist/native-service/service/node/recovery-review.js';
    import {NativeCommercialDatabase} from './dist/native-service/service/node/sqlite.js';
    const p=readFileSync(0,'utf8').trim(); const c=nativeConfiguration();mkdirSync('/tmp/recovery-proof',{mode:0o700});
    const large=new NativeCommercialDatabase(c.directory,{recoverySecret:c.configuration.SERVICE_AUTH_SECRET});try{await large.prepare("UPDATE user SET image=hex(zeroblob(30*1024*1024))").run();const pages=await large.prepare('PRAGMA page_count').first('page_count'),size=await large.prepare('PRAGMA page_size').first('page_size');if(pages*size<60*1024*1024||pages*size>64*1024*1024)throw Error('Near-limit fixture size')}finally{large.close()}
    await checkpointNativeCommercial(c.configuration,c.directory,'/tmp/recovery-proof/current-checkpoint.json');
    await exportCommercialRecovery(c.configuration,c.directory,'/tmp/recovery-proof/public.bundle',p);
    await restoreCommercialRecovery('/tmp/recovery-proof/public.bundle','/tmp/recovery-proof/restored',p);
    const local=nativeConfiguration({SERVICE_NATIVE_CONFIG:'/tmp/recovery-proof/restored/service.vars'});
    if(local.configuration.SERVICE_MODE!=='local'||local.configuration.SERVICE_ORIGIN!=='http://127.0.0.1:5173'||local.configuration.SERVICE_AUTH_SECRET===c.configuration.SERVICE_AUTH_SECRET)throw Error('Restore configuration');
    let refused=false;try{new NativeCommercialDatabase('/tmp/recovery-proof/restored/data',{recoverySecret:local.configuration.SERVICE_AUTH_SECRET})}catch{refused=true}if(!refused)throw Error('Restore reopened');
    const d=new NativeCommercialDatabase('/tmp/recovery-proof/restored/data',{recoveryInspection:true});try{
      const meta=JSON.parse(await d.prepare('SELECT provenance_json FROM _chargeos_native_recovery').first('provenance_json'));
      if(meta.sourceOrigin!==c.configuration.SERVICE_ORIGIN)throw Error('Lost provenance');
      for(const table of ['session','verification','account','two_factor','local_outbox','rate_limit'])if(await d.prepare('SELECT count(*) AS n FROM '+table).first('n')!==0)throw Error('Stale auth');
    }finally{d.close()}console.log('public-backup-local-quarantine-verified');
  `,
    ],
    backupPassphrase + "\n",
  );
  assert(
    recoveryProof.trim() === "public-backup-local-quarantine-verified",
    "Compiled hosted backup did not restore into fresh local quarantine",
  );
  const id = compose(["ps", "-q", "proxy"]).trim();
  const inspect = JSON.parse(docker(["inspect", id]))[0];
  const network = Object.keys(inspect.NetworkSettings.Networks)[0],
    ip = inspect.NetworkSettings.Networks[network].IPAddress;
  const isolated = docker([
    "run",
    "--rm",
    "--network",
    network,
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--entrypoint",
    "node",
    runtimeImage,
    "-e",
    `const s=require('net').connect({host:${JSON.stringify(ip)},port:9091});s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),2000)`,
  ]);
  assert(isolated === "", "Unexpected isolation probe output");
  // Failed upstream requests must not expose URL tokens in proxy error logs.
  compose(["stop", "accounts"]);
  const token = "synthetic-query-token-" + randomBytes(16).toString("hex");
  assert(
    (await browser(`/service/api/auth/verify-email?token=${token}`)).status === 502,
    "Expected stopped-upstream failure",
  );
  assert(
    (await browser(`/service/api/auth/reset-password/${token}`)).status === 502,
    "Expected stopped-upstream path failure",
  );
  const logs = compose(["logs", "--no-color"]);
  docker(["image", "tag", runtimeImage, "chargeos-company:local"]);
  docker(["image", "tag", proxyImage, "chargeos-company-proxy:local"]);
  for (const secret of [
    token,
    authSecret,
    email,
    rows[0].url,
    password,
    backupPassphrase,
    "synthetic SMTP password",
  ])
    assert(!logs.includes(secret), "Private account material leaked into container logs");
  console.log(
    "Guided company Docker drill passed: real local bind proof, pinned unique project despite inherited override, untouched sentinel volume, generated private SMTP settings and verified STARTTLS email, HTTPS signup and Secure session, isolated owner/enrollment routes, canonical redirect, secret-free logs and near-limit compiled backup/local quarantine. No external mail sent.",
  );
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } finally {
    if (sentinelProject && sentinelFile) {
      try {
        docker([
          "compose",
          "--project-name",
          sentinelProject,
          "-f",
          sentinelFile,
          "down",
          "--volumes",
        ]);
      } catch {}
    }
    await certificates?.close();
    try {
      docker(["image", "rm", `${project}:secret-fixture`]);
    } catch {}
    for (const image of [runtimeImage, proxyImage].filter(Boolean)) {
      try {
        docker(["image", "rm", image]);
      } catch {}
    }
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
}
