import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
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
const project = `chargeos-company-drill-${process.pid}-${Date.now()}`;
const domain = "accounts.example.test",
  origin = `https://${domain}`;
const authSecret = randomBytes(48).toString("base64url");
const environment = {
  ...process.env,
  COMPANY_DOMAIN: domain,
  COMPANY_ACME_EMAIL: "operator@example.test",
  COMPANY_SIGNUP_DOMAINS: "example.test",
  COMPANY_AUTH_FILE: join(directory, "auth"),
  COMPANY_SMTP_FILE: join(directory, "smtp"),
};
const args = [
  "compose",
  "--project-name",
  project,
  "--project-directory",
  root,
  "-f",
  join(root, "compose.company.yaml"),
  "-f",
  join(directory, "override.yaml"),
];
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
  save("auth", authSecret);
  save(
    "smtp",
    JSON.stringify({
      format: "chargeos-smtp",
      schemaVersion: 1,
      host: "smtp.example.test",
      port: 465,
      security: "implicit-tls",
      username: "synthetic",
      password: "synthetic SMTP password",
      sender: "accounts@example.test",
      caFile: null,
    }),
  );
  const caddy = readFileSync(join(root, "deploy/Caddyfile.company"), "utf8").replace(
    "https://{$COMPANY_DOMAIN}:8443 {",
    "https://{$COMPANY_DOMAIN}:8443 {\n  tls internal",
  );
  save("Caddyfile", caddy);
  // Compose's YAML reset removes the production port list before ephemeral binds.
  save(
    "override.yaml",
    `services:\n  proxy:\n    ports: !override\n      - "127.0.0.1::8080/tcp"\n      - "127.0.0.1::8443/tcp"\n    volumes:\n      - ${JSON.stringify(join(directory, "Caddyfile") + ":/etc/caddy/Caddyfile:ro")}\n`,
  );
  compose(["build", "proxy", "accounts"]);
  function secretProbe(mounts, path, accepted, image = "chargeos-company:local") {
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
    "FROM chargeos-company:local\nCOPY --chmod=0444 auth /run/secrets/baked\n",
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
  try {
    compose(["up", "--detach", "--wait", "--wait-timeout", "90", "accounts"]);
  } catch {
    throw new Error("Synthetic company startup failed: " + compose(["logs", "--no-color"]));
  }
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
  const rows = JSON.parse(sql("SELECT url,channel FROM local_outbox WHERE kind='verify-email'"));
  assert(
    rows.length === 1 &&
      rows[0].channel === "smtp" &&
      rows[0].url.startsWith(`${origin}/service/api/auth/verify-email?`),
    "Signup lost its private public-origin SMTP reservation",
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
  const discarded = JSON.parse(
    compose([
      "run",
      "--rm",
      "--no-deps",
      "mailer",
      "node",
      "dist/native-service/service/node/mail-cli.js",
      "once",
      "--smtp-config",
      "/run/secrets/company_smtp",
    ]),
  );
  assert(
    discarded.accepted === 0 && discarded.failed === 1,
    "Hosted mailer did not safely discard an already verified link",
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
    "chargeos-company:local",
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
  for (const secret of [token, authSecret, email, rows[0].url, password, backupPassphrase])
    assert(!logs.includes(secret), "Private account material leaked into container logs");
  console.log(
    "Company Docker drill passed: non-root/read-only images, sole loopback proxy, verified HTTPS signup and Secure session, isolated owner/enrollment routes, canonical redirect and secret-free error logs. Read-only secret mount negatives, hosted mailer loading and near-limit compiled backup/local quarantine passed. No external mail sent.",
  );
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } finally {
    try {
      docker(["image", "rm", `${project}:secret-fixture`]);
    } catch {}
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
}
