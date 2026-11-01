import { randomBytes } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DeploymentError, repositoryRoot, dockerComposeCommand } from "./deployment.mjs";
import { companyCloudFields, companyCloudInput } from "./company-cloud.mjs";

const dns = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domain = (value) =>
  typeof value === "string" && dns.test(value) && !/(?:^|\.)(local|localhost)$/.test(value);
const email =
  /^[A-Za-z0-9._+-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
export function companyDeploymentInput(value) {
  const allowed = [
    "target",
    ...companyCloudFields,
    "name",
    "companyDomain",
    "signupDomains",
    "email",
    "smtpHost",
    "smtpPort",
    "smtpSecurity",
    "smtpUsername",
    "smtpPassword",
    "smtpSender",
    "deploy",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new DeploymentError("Unexpected company setup fields.");
  if (typeof value.name !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(value.name))
    throw new DeploymentError(
      "Use an installation name starting with a lowercase letter, followed by letters, numbers or hyphens.",
    );
  if (typeof value.deploy !== "boolean")
    throw new DeploymentError("Choose whether to prepare or deploy.");
  const target = value.target ?? "docker";
  if (!["docker", "coolify"].includes(target))
    throw new DeploymentError("Choose local Docker or managed Coolify deployment.");
  if (target === "docker" && companyCloudFields.some((name) => value[name] !== undefined))
    throw new DeploymentError("Cloud settings require the managed Coolify destination.");
  const cloud = target === "coolify" ? companyCloudInput(value) : {};
  if (!domain(value.companyDomain))
    throw new DeploymentError(
      "Enter the company accounts hostname, such as accounts.company.be, without https:// or a path.",
    );
  if (typeof value.signupDomains !== "string" || value.signupDomains.length > 5080)
    throw new DeploymentError("Enter up to 20 work email domains, separated by commas.");
  const signupDomains = [
    ...new Set(value.signupDomains.split(",").map((item) => item.trim().toLowerCase())),
  ];
  if (
    !signupDomains.length ||
    signupDomains.length > 20 ||
    signupDomains.some((item) => !domain(item))
  )
    throw new DeploymentError(
      "Use exact work email domains, such as company.be. Do not include @, a wildcard or a web address.",
    );
  for (const key of ["email", "smtpSender"])
    if (typeof value[key] !== "string" || value[key].length > 254 || !email.test(value[key]))
      throw new DeploymentError(
        "Use single certificate-contact and sender email addresses, without display names or spaces.",
      );
  if (!domain(value.smtpHost))
    throw new DeploymentError(
      "Enter your mail provider's SMTP hostname, without a protocol or path.",
    );
  if (
    typeof value.smtpPort !== "string" ||
    !/^[0-9]{1,5}$/.test(value.smtpPort) ||
    +value.smtpPort < 1 ||
    +value.smtpPort > 65535
  )
    throw new DeploymentError(
      "Enter the SMTP port supplied by your provider, between 1 and 65535.",
    );
  if (!["starttls", "implicit-tls"].includes(value.smtpSecurity))
    throw new DeploymentError(
      "Choose required STARTTLS or TLS from the start. Unencrypted email is not supported.",
    );
  for (const key of ["smtpUsername", "smtpPassword"])
    if (
      typeof value[key] !== "string" ||
      !value[key].length ||
      value[key].length > 2048 ||
      /[\0\r\n]/.test(value[key])
    )
      throw new DeploymentError("Enter bounded SMTP credentials without line breaks.");
  const smtp = {
    format: "chargeos-smtp",
    schemaVersion: 1,
    host: value.smtpHost,
    port: +value.smtpPort,
    security: value.smtpSecurity,
    username: value.smtpUsername,
    password: value.smtpPassword,
    sender: value.smtpSender,
    caFile: null,
  };
  if (Buffer.byteLength(JSON.stringify(smtp)) > 16384)
    throw new DeploymentError(
      "The email settings are too large. Ask your administrator for supported SMTP credentials.",
    );
  return {
    ...cloud,
    target,
    name: value.name,
    companyDomain: value.companyDomain,
    signupDomains,
    email: value.email,
    smtp,
    deploy: value.deploy,
  };
}

/** Fresh deployments only. Never turns a backup or released local copy public. */
const shellArgument = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

export async function prepareCompanyDeployment(
  input,
  parent = join(repositoryRoot, ".chargeos-deploy"),
  recovery,
) {
  if (recovery && input.target !== "docker")
    throw new DeploymentError(
      "Reviewed recovery capsules currently require the local Docker adapter.",
    );
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new DeploymentError(
      "The private setup directory must be a real directory accessible only to your account.",
    );
  const directory = resolve(parent, input.name);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new DeploymentError(
      "A setup with this name already exists. Read its saved instructions; use a new name only for a separate deployment.",
    );
  }
  const save = (name, content, mode = 0o600) =>
    writeFile(join(directory, name), content, { mode, flag: "wx" });
  const installId = `${input.name}-${randomBytes(6).toString("hex")}`;
  const managed = input.target === "coolify";
  const model = JSON.parse(
    await readFile(
      join(repositoryRoot, managed ? "compose.company.coolify.json" : "compose.company.json"),
      "utf8",
    ),
  );
  const values = {
    COMPANY_DOMAIN: input.companyDomain,
    COMPANY_ACME_EMAIL: input.email,
    COMPANY_SIGNUP_DOMAINS: input.signupDomains.join(","),
    COMPANY_AUTH_FILE: "./secrets/company_auth",
    COMPANY_SMTP_FILE: "./secrets/company_smtp",
    COMPANY_INSTALL_ID: installId,
    COMPANY_INGRESS_NETWORK: `chargeos-company-${installId}`,
    COMPANY_IMAGE: input.image,
    COMPANY_PROXY_IMAGE: input.proxyImage,
    // Kept as runtime placeholders in saved Compose; actual secrets stay in
    // private files and are sent only after cloud resource readback.
    COMPANY_BOOTSTRAP_AUTH: "${COMPANY_BOOTSTRAP_AUTH}",
    COMPANY_BOOTSTRAP_SMTP: "${COMPANY_BOOTSTRAP_SMTP}",
  };
  function expand(item) {
    if (typeof item === "string")
      return item.replace(/\$\{([A-Z_]+)(?::\?[^}]*)?\}/g, (_match, name) => {
        if (!(name in values))
          throw new DeploymentError("The company template contains an unknown setting.");
        return values[name];
      });
    if (Array.isArray(item)) return item.map(expand);
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, expand(value)]));
    return item;
  }
  const prepared = expand(model);
  prepared.name = `chargeos-company-${installId}`;
  if (!managed) {
    for (const service of ["proxy", "accounts"])
      prepared.services[service].build.context = repositoryRoot;
    prepared.services.proxy.image = `chargeos-company-proxy-${installId}:local`;
    prepared.services.accounts.image = `chargeos-company-${installId}:local`;
    prepared.services.mailer.image = prepared.services.accounts.image;
    prepared.services.proxy.volumes[0] = "./Caddyfile:/etc/caddy/Caddyfile:ro";
  }
  await mkdir(join(directory, "secrets"), { mode: 0o700 });
  await save(
    "secrets/company_auth",
    recovery?.authSecret ?? randomBytes(48).toString("base64url"),
    0o444,
  );
  await save("secrets/company_smtp", JSON.stringify(input.smtp), 0o444);
  if (recovery) {
    await save("secrets/company_database", recovery.database, 0o444);
    await save("secrets/company_install", recovery.manifest, 0o444);
    prepared.secrets.company_database = { file: "./secrets/company_database" };
    prepared.secrets.company_install = { file: "./secrets/company_install" };
    prepared.services["recovery-install"] = {
      image: prepared.services.accounts.image,
      user: "1000:1000",
      network_mode: "none",
      read_only: true,
      restart: "no",
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      healthcheck: { disable: true },
      tmpfs: ["/tmp:size=256m,mode=1777"],
      volumes: ["company-data:/data"],
      secrets: ["company_auth", "company_database", "company_install"],
      command: [
        "node",
        "dist/native-service/service/node/public-handoff-cli.js",
        "install",
        "--database",
        "/run/secrets/company_database",
        "--auth",
        "/run/secrets/company_auth",
        "--manifest",
        "/run/secrets/company_install",
        "--data",
        "/data",
        "--origin",
        `https://${input.companyDomain}`,
      ],
    };
    prepared.services.accounts.depends_on["recovery-install"] = {
      condition: "service_completed_successfully",
    };
  }
  await save(
    "Caddyfile",
    await readFile(
      join(
        repositoryRoot,
        managed ? "deploy/Caddyfile.company-managed" : "deploy/Caddyfile.company",
      ),
      "utf8",
    ),
    0o444,
  );
  await save("compose.json", JSON.stringify(prepared, null, 2));
  const receipt = {
    schemaVersion: 1,
    workspace: "company",
    target: managed ? "coolify" : "docker",
    name: input.name,
    installId,
    companyUrl: `https://${input.companyDomain}/service`,
    status: "prepared",
    ...(recovery ? { recoveryHandoffId: recovery.handoffId } : {}),
    ...(input.dockerContext ? { dockerContext: input.dockerContext } : {}),
  };
  await save("setup.json", JSON.stringify(receipt, null, 2));
  if (recovery) {
    await save(
      "START-HERE.txt",
      `chargeOS reviewed public recovery: ${input.name}\n\nWorkspace: ${receipt.companyUrl}\nHandoff: ${recovery.handoffId}\n\nThis package is for the exact stopped-source reviewed handoff only. It is not a fresh workspace, an arbitrary SQLite import or a source of charger ownership. Keep all prior service copies stopped. A capsule and key can be cloned by their holder; signed receipts and local inode custody are not proof that no other installation exists.\n\nThe network-free non-root recovery-install service authenticates the capsule, current key, financial integrity, exact schema and HTTPS origin before creating the new data file. It never overwrites a different database. On a restart it recognizes only its own signed installation. Accounts and mail start afterward; only newly queued account mail uses the explicitly supplied SMTP settings.\n\nResume with destination verification: node ${shellArgument(join(repositoryRoot, "scripts/resume-company.mjs"))} --start ${shellArgument(directory)}\nStop while retaining records: ${dockerComposeCommand(prepared.name, input.dockerContext)} stop\nStatus: ${dockerComposeCommand(prepared.name, input.dockerContext)} ps\nNever use down --volumes on retained company data. Inspect this same project, volume and capsule after any uncertain result. Never choose a new name or parallel server to bypass a refused installation. A stale runtime/lifecycle or incomplete-install marker needs an actual stopped-process audit; do not delete it blindly.\n\nKeep the source capsule and this folder private, off shared drives and out of support messages. The fresh recovery auth key remains unchanged because it protects freshly enrolled authenticators and the reviewed receipt. Retain the same reviewed software revision. After DNS/TLS are ready, use the new recovery password and authenticator on /service; old sessions/links/invitations do not return. Check real mailbox delivery, persistence and current external retirement evidence with IT.\n\nRead /help recovery and company-hosting guides. This is synthetic Docker workflow support, not customer/field or managed-cloud recovery acceptance.\n`,
    );
    return { directory, model: prepared, receipt };
  }
  if (managed) {
    await save(
      "START-HERE.txt",
      `chargeOS managed company setup: ${input.name}\n\nWorkspace: ${receipt.companyUrl}\nInstallation: ${installId}\n\nSynthetic pilot only. This fresh company workspace never connects a charger or opens recovered data.\n\nDeploy through the local wizard once. It creates a fresh standalone Coolify destination, then a pinned Git Raw Compose application. Prepare-only files are review/export artifacts, not a resumable cloud installation. If the wizard explicitly returned prepared and this folder has no cloud-intent.json, no cloud request was made: retain these review files, reopen the full terminal setup link and submit the reviewed values with a new installation name. Once any cloud intent/submission exists, this exception does not apply; inspect existing resources before any next action. No deployment is submitted in prepare-only mode; no cloud API token is saved. Inspect cloud-*.json and the existing Coolify resources after any uncertain result. Never repeat a create or choose a new name to bypass a failure. Do not run this cloud package as a second local installation.\n\nYour operator must use Traefik, keep request/access/error URL logging and traffic analytics off, and leave ONLY the platform proxy and this company proxy on its dedicated ingress network. No shared coolify network, HTTP account router, extra proxy/CDN, Cloudflare Tunnel or additional workload/destination is supported. A destination receipt does not prove actual proxy attachment. Confirm public HTTPS, actual network membership, secret-free logs, verified signup/email/login and persistent records before evaluating test accounts.\n\nThe two image digests must come from this reviewed source revision and pass the company runtime drills. Coolify/registry access, DNS, provider TLS and retention/backup policy are operator prerequisites. Cloud submitted means API acknowledgement, not health or delivery.\n\nPrivate settings: secrets/. Keep this folder off shared drives and out of support messages. SMTP credentials and the generated key are also retained in trusted Coolify environment/configuration and initializer container metadata; clearing the process environment does not erase them there. Never change bootstrap credentials to rotate a live installation: exact existing files are preserved and mismatches stop. Only the initializer receives inline credentials, with no network; account/mail workers use read-only files.\n\nUse Coolify to inspect/start/stop the SAME application and all its services together. Stopping keeps volumes; never delete data/credential volumes for a retained company. Never copy a live database, import it here or enable restored accounts. Managed-cloud recovery remains unavailable: restore into fresh local quarantine, complete current review/new credentials and use the separate reviewed owned-Docker handoff if appropriate.\n\nManaged rate limits identify the platform proxy, not individual users: only a small synthetic pilot is supported. Read /help (Share the company workspace and Send account emails) and docs/company-hosting.md.\n`,
    );
    return { directory, model: prepared, receipt };
  }
  await save(
    "START-HERE.txt",
    `chargeOS company account setup: ${input.name}\n\nWorkspace: ${receipt.companyUrl}\n\nThis synthetic HTTPS pilot has its own account database, secure entrance and email worker. It does not connect to a charger. Point the hostname at this Docker server and allow ports 80/443. Use a dedicated public entrance, without an extra proxy or CDN.\n\nPrivate mail settings and the generated service key are in secrets/. Keep this entire folder private, off shared drives and out of support messages. Create synthetic accounts with approved work emails, open their verification mail, then sign in and invite colleagues. Provider acceptance is not inbox delivery.\n\nResume (from this folder): ${dockerComposeCommand(prepared.name, input.dockerContext)} up --detach --build --wait --wait-timeout 180\nStop without deleting records: ${dockerComposeCommand(prepared.name, input.dockerContext)} stop\nStatus: ${dockerComposeCommand(prepared.name, input.dockerContext)} ps\nNever use down --volumes for retained company data. Stop/recreate all services together when replacing the proxy.\n\nDo not retry an uncertain deployment under a different name or copy a live database into another installation. A restored backup must remain quarantined through current review and fresh credentials; use the separate reviewed public recovery command after that work; this fresh-install wizard never imports a database.\n\nRead the in-app Help at /help, especially Share the company workspace and Send account emails. Node/Docker, DNS and mail-provider access are prerequisites. Reviewed owned-Docker public recovery has synthetic proof; live managed-platform acceptance and managed recovery remain pending.\n`,
  );
  return { directory, model: prepared, receipt };
}
