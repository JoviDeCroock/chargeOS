import { randomBytes } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DeploymentError, repositoryRoot, dockerComposeCommand } from "./deployment.mjs";

const dns = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domain = (value) =>
  typeof value === "string" && dns.test(value) && !/(?:^|\.)(local|localhost)$/.test(value);
const email =
  /^[A-Za-z0-9._+-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
export function companyDeploymentInput(value) {
  const allowed = [
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
    name: value.name,
    companyDomain: value.companyDomain,
    signupDomains,
    email: value.email,
    smtp,
    deploy: value.deploy,
  };
}

/** Fresh deployments only. Never turns a backup or released local copy public. */
export async function prepareCompanyDeployment(
  input,
  parent = join(repositoryRoot, ".chargeos-deploy"),
) {
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
  const model = JSON.parse(await readFile(join(repositoryRoot, "compose.company.json"), "utf8"));
  const values = {
    COMPANY_DOMAIN: input.companyDomain,
    COMPANY_ACME_EMAIL: input.email,
    COMPANY_SIGNUP_DOMAINS: input.signupDomains.join(","),
    COMPANY_AUTH_FILE: "./secrets/company_auth",
    COMPANY_SMTP_FILE: "./secrets/company_smtp",
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
  for (const service of ["proxy", "accounts"])
    prepared.services[service].build.context = repositoryRoot;
  prepared.services.proxy.image = `chargeos-company-proxy-${installId}:local`;
  prepared.services.accounts.image = `chargeos-company-${installId}:local`;
  prepared.services.mailer.image = prepared.services.accounts.image;
  prepared.services.proxy.volumes[0] = "./Caddyfile:/etc/caddy/Caddyfile:ro";
  await mkdir(join(directory, "secrets"), { mode: 0o700 });
  await save("secrets/company_auth", randomBytes(48).toString("base64url"), 0o444);
  await save("secrets/company_smtp", JSON.stringify(input.smtp), 0o444);
  await save(
    "Caddyfile",
    await readFile(join(repositoryRoot, "deploy/Caddyfile.company"), "utf8"),
    0o444,
  );
  await save("compose.json", JSON.stringify(prepared, null, 2));
  const receipt = {
    schemaVersion: 1,
    workspace: "company",
    target: "docker",
    name: input.name,
    installId,
    companyUrl: `https://${input.companyDomain}/service`,
    status: "prepared",
    ...(input.dockerContext ? { dockerContext: input.dockerContext } : {}),
  };
  await save("setup.json", JSON.stringify(receipt, null, 2));
  await save(
    "START-HERE.txt",
    `chargeOS company account setup: ${input.name}\n\nWorkspace: ${receipt.companyUrl}\n\nThis synthetic HTTPS pilot has its own account database, secure entrance and email worker. It does not connect to a charger. Point the hostname at this Docker server and allow ports 80/443. Use a dedicated public entrance, without an extra proxy or CDN.\n\nPrivate mail settings and the generated service key are in secrets/. Keep this entire folder private, off shared drives and out of support messages. Create synthetic accounts with approved work emails, open their verification mail, then sign in and invite colleagues. Provider acceptance is not inbox delivery.\n\nResume (from this folder): ${dockerComposeCommand(prepared.name, input.dockerContext)} up --detach --build --wait --wait-timeout 180\nStop without deleting records: ${dockerComposeCommand(prepared.name, input.dockerContext)} stop\nStatus: ${dockerComposeCommand(prepared.name, input.dockerContext)} ps\nNever use down --volumes for retained company data. Stop/recreate all services together when replacing the proxy.\n\nDo not retry an uncertain deployment under a different name or copy a live database into another installation. A restored backup must remain quarantined through current review and fresh credentials; public recovery/resumption is not yet verified.\n\nRead the in-app Help at /help, especially Share the company workspace and Send account emails. Node/Docker, DNS and mail-provider access are prerequisites. Managed-cloud company setup and public recovery/resumption remain pending.\n`,
  );
  return { directory, model: prepared, receipt };
}
