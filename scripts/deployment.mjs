import { randomBytes } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const caddyImage =
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
export class DeploymentError extends Error {}
export function deploymentInput(value) {
  const allowed = [
    "target",
    "name",
    "stationId",
    "ownerTag",
    "ownerDomain",
    "ocppDomain",
    "email",
    "image",
    "cloudOrigin",
    "cloudToken",
    "projectId",
    "serverId",
    "destinationId",
    "environment",
    "deploy",
    "gitRepository",
    "gitBranch",
    "gitCommit",
    "githubAppId",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new DeploymentError("Unexpected setup fields.");
  const field = (name, expression, message) => {
    if (typeof value[name] !== "string" || !expression.test(value[name]))
      throw new DeploymentError(message);
    return value[name];
  };
  if (value.target !== "docker" && value.target !== "coolify")
    throw new DeploymentError("Choose Docker or Coolify Cloud.");
  if (typeof value.deploy !== "boolean")
    throw new DeploymentError("Choose whether to prepare or deploy.");
  const name = field(
    "name",
    /^[a-z][a-z0-9-]{0,39}$/,
    "Use a setup name starting with a lowercase letter, with letters, numbers or hyphens.",
  );
  const stationId = field(
    "stationId",
    /^[a-zA-Z0-9_-]{1,64}$/,
    "Use the charger's exact OCPP identity: 1–64 letters, numbers, underscores or hyphens.",
  );
  const ownerTag = field(
    "ownerTag",
    /^[a-zA-Z0-9]{1,20}$/,
    "Enter the card's actual OCPP identifier, 1–20 letters or numbers. A printed card number may differ.",
  );
  const domain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const ownerDomain = field(
    "ownerDomain",
    domain,
    "Enter a console hostname such as charge.company.be, without https:// or a path.",
  );
  const ocppDomain = field(
    "ocppDomain",
    domain,
    "Enter a charger hostname such as ocpp.company.be, without a scheme or path.",
  );
  if (ownerDomain === ocppDomain)
    throw new DeploymentError("Use separate console and charger hostnames.");
  const email = field(
    "email",
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    "Enter an email address for certificate notices.",
  );
  if (email.length > 254) throw new DeploymentError("Email address is too long.");
  const image = value.image ?? "";
  if (
    typeof image !== "string" ||
    (image && !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image))
  )
    throw new DeploymentError(
      "Use a verified image reference ending in @sha256: and its 64-character digest.",
    );
  const result = {
    target: value.target,
    name,
    stationId,
    ownerTag,
    ownerDomain,
    ocppDomain,
    email,
    image,
    deploy: value.deploy,
  };
  if (value.target === "coolify") {
    if (!image)
      throw new DeploymentError(
        "Managed deployment needs a published, verified chargeOS image digest.",
      );
    Object.assign(result, cloudDeploymentInput(value));
    result.destinationId = value.destinationId || "";
    if (!/^[a-zA-Z0-9_-]{0,128}$/.test(result.destinationId))
      throw new DeploymentError("Invalid destination ID.");
  }
  return result;
}

export function cloudDeploymentInput(value) {
  const result = {};
  const field = (name, expression, message) => {
    if (typeof value[name] !== "string" || !expression.test(value[name]))
      throw new DeploymentError(message);
    return value[name];
  };
  let origin;
  try {
    origin = new URL(value.cloudOrigin);
  } catch {
    throw new DeploymentError("Enter your trusted Coolify HTTPS address.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== value.cloudOrigin ||
    origin.username ||
    origin.password
  )
    throw new DeploymentError(
      "Use your trusted Coolify HTTPS origin without a path, for example https://app.coolify.io.",
    );
  result.cloudOrigin = origin.origin;
  result.cloudToken = field(
    "cloudToken",
    /^[\x21-\x7e]{16,512}$/,
    "Enter a Coolify API token with permission to create and deploy services.",
  );
  result.projectId = field("projectId", /^[a-zA-Z0-9_-]{1,128}$/, "Enter the Coolify project ID.");
  result.serverId = field(
    "serverId",
    /^[a-zA-Z0-9_-]{1,128}$/,
    "Enter the connected Coolify server ID.",
  );
  result.environment = field(
    "environment",
    /^[a-zA-Z0-9_-]{1,64}$/,
    "Enter the Coolify environment name.",
  );
  result.gitRepository = field(
    "gitRepository",
    /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/,
    "Enter the trusted GitHub repository HTTPS URL containing chargeOS's raw deployment template.",
  );
  result.gitBranch = field(
    "gitBranch",
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/,
    "Enter the repository branch containing the deployment template.",
  );
  result.gitCommit = field(
    "gitCommit",
    /^[a-f0-9]{40}$/,
    "Enter the reviewed 40-character repository commit SHA.",
  );
  result.githubAppId = value.githubAppId || "";
  if (!/^[a-zA-Z0-9_-]{0,128}$/.test(result.githubAppId))
    throw new DeploymentError("Invalid Coolify GitHub App ID.");
  return result;
}

export async function prepareDeployment(input, parent = join(repositoryRoot, ".chargeos-deploy")) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInfo = await lstat(parent);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory() || (parentInfo.mode & 0o077) !== 0)
    throw new DeploymentError(
      "The private setup directory must be a real directory accessible only to your account.",
    );
  const directory = resolve(parent, input.name);
  // Atomic create-only reservation also prevents retrying an uncertain cloud create.
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch {
    throw new DeploymentError(
      "A setup with this name already exists. Open its saved instructions; use a new name only for a separate deployment.",
    );
  }
  const save = (name, content, mode = 0o600) =>
    writeFile(join(directory, name), content, { flag: "wx", mode });
  const ownerToken = randomBytes(36).toString("base64url");
  // OCPP 1.6 security whitepaper (A00.FR.205): the Basic-auth password is at least 16 bytes and at
  // most 20 bytes written as up to 40 hexadecimal digits. Longer or non-hex secrets can be refused.
  const stationSecret = randomBytes(20).toString("hex");
  const installId = `${input.name}-${randomBytes(6).toString("hex")}`;
  const caddyfile = await readFile(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  const environment = {
    CHARGEOS_AI_RELAY_ORIGIN: "http://caddy:9092",
    CHARGEOS_OWNER_API_TOKEN_FILE: "/run/secrets/owner_api_token",
    CHARGEOS_OWNER_TAGS_FILE: "/run/secrets/owner_tags",
    CHARGEOS_STATION_SECRET_FILE: "/run/secrets/station_secret",
    CHARGEOS_STATION_ID: input.stationId,
    CHARGEOS_TRUST_PROXY_HEADERS: input.target === "docker" ? "true" : "false",
  };
  let model = {
    name: `chargeos-${installId}`,
    services: {
      chargeos: {
        ...(input.image
          ? { image: input.image }
          : { build: { context: repositoryRoot }, image: `chargeos-${input.name}:local` }),
        environment,
        expose: ["9000", "9080"],
        networks: ["chargeos-internal"],
        read_only: true,
        restart: "unless-stopped",
        security_opt: ["no-new-privileges:true"],
        tmpfs: ["/tmp:size=16m,mode=1777"],
        volumes: ["chargeos-data:/data"],
        secrets: ["owner_api_token", "owner_tags", "station_secret"],
      },
      caddy: {
        image: caddyImage,
        cap_add: ["NET_BIND_SERVICE"],
        cap_drop: ["ALL"],
        depends_on: ["chargeos"],
        environment: {
          CHARGEOS_ACME_EMAIL: input.email,
          CHARGEOS_OCPP_DOMAIN: input.ocppDomain,
          CHARGEOS_OWNER_DOMAIN: input.ownerDomain,
          CHARGEOS_OCPP_MAX_CONNECTIONS: "8",
        },
        networks: ["chargeos-edge", "chargeos-internal"],
        ports: ["80:80/tcp", "443:443/tcp", "443:443/udp"],
        read_only: true,
        restart: "unless-stopped",
        security_opt: ["no-new-privileges:true"],
        tmpfs: ["/tmp:size=16m,mode=1777"],
        volumes: [
          "./Caddyfile:/etc/caddy/Caddyfile:ro",
          "caddy-config:/config",
          "caddy-data:/data",
        ],
      },
    },
    networks: { "chargeos-edge": {}, "chargeos-internal": { internal: true } },
    secrets: {
      owner_api_token: { file: "./secrets/owner_api_token" },
      owner_tags: { file: "./secrets/owner_tags" },
      station_secret: { file: "./secrets/station_secret" },
    },
    volumes: { "chargeos-data": {}, "caddy-config": {}, "caddy-data": {} },
  };
  const credentials = {
    owner_api_token: ownerToken,
    owner_tags: input.ownerTag,
    station_secret: stationSecret,
  };
  if (input.target === "docker") {
    await mkdir(join(directory, "secrets"), { mode: 0o700 });
    for (const [name, value] of Object.entries(credentials))
      await save(`secrets/${name}`, value, 0o444);
    await save("Caddyfile", caddyfile, 0o444);
  } else {
    const rawTemplate = await readFile(new URL("../compose.coolify.json", import.meta.url), "utf8");
    const values = cloudEnvironment(input, { ownerToken, stationSecret, installId });
    model = JSON.parse(
      rawTemplate.replace(/\$\{([A-Z_]+)\}/g, (_match, name) => {
        if (!(name in values))
          throw new DeploymentError("The managed template contains an unknown variable.");
        return values[name];
      }),
    );
  }

  const receipt = {
    schemaVersion: 1,
    target: input.target,
    name: input.name,
    installId,
    stationId: input.stationId,
    consoleUrl: `https://${input.ownerDomain}`,
    ocppUrl: `wss://${input.ocppDomain}/${input.stationId}`,
    ownerToken,
    stationSecret,
    image: input.image || "local source build",
    status: "prepared",
    ...(input.dockerContext ? { dockerContext: input.dockerContext } : {}),
  };
  await save("compose.json", JSON.stringify(model, null, 2));
  await save("credentials.json", JSON.stringify(receipt, null, 2));
  await save(
    "START-HERE.txt",
    `chargeOS setup: ${input.name}\n\nConsole: ${receipt.consoleUrl}\nCharger endpoint: ${receipt.ocppUrl}\nPrivate credentials: credentials.json\n\nThis folder is private; keep it off shared drives and out of support messages.\nPoint both DNS names at your server. Docker: ports 80/443 must be reachable.\nManaged: Coolify supplies TLS and routes console to Caddy port 8080, OCPP to 8081.\nDeployment starts software; it never changes an existing charger's endpoint.\nFollow docs/guides/connect-a-charger.md before a charger migration.\nCreate and drill a separate encrypted continuity bundle after provisioning.\nDo not delete this deployment's data volume or create a second edge for the same live charger.\n\n${input.target === "docker" ? `Docker resume (from this folder): ${dockerComposeCommand(model.name, input.dockerContext)} up --detach --wait\nDocker stop (keeps data): ${dockerComposeCommand(model.name, input.dockerContext)} stop\n` : "Cloud: inspect the existing service in Coolify and its saved receipts before retrying any uncertain submission. Never run this cloud setup as a second local edge.\n"}`,
  );
  return { directory, model, receipt };
}

export function cloudEnvironment(input, receipt) {
  return {
    CHARGEOS_IMAGE: input.image,
    CHARGEOS_INSTALL_ID: receipt.installId,
    CHARGEOS_STATION_ID: input.stationId,
    CHARGEOS_OWNER_DOMAIN: input.ownerDomain,
    CHARGEOS_OCPP_DOMAIN: input.ocppDomain,
    CHARGEOS_BOOTSTRAP_OWNER_TOKEN: receipt.ownerToken,
    CHARGEOS_BOOTSTRAP_STATION_SECRET: receipt.stationSecret,
    CHARGEOS_BOOTSTRAP_OWNER_TAG: input.ownerTag,
  };
}

export async function deployToCoolify(input, prepared, fetcher = fetch) {
  async function request(path, method = "GET", body) {
    let response;
    try {
      response = await fetcher(`${input.cloudOrigin}/api/v1${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${input.cloudToken}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new DeploymentError(
        "Cloud submission outcome is uncertain. Inspect Coolify and saved cloud receipts before creating anything else. No automatic retry was made.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DeploymentError(
        `Coolify rejected a setup step (HTTP ${response.status}). Check the private cloud receipt, permissions and repository access. Do not recreate an existing application.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new DeploymentError(
        "Cloud response was unreadable. Inspect Coolify and your saved receipt before retrying.",
      );
    }
  }
  const body = {
    name: `chargeos-${prepared.receipt.installId}`,
    project_uuid: input.projectId,
    server_uuid: input.serverId,
    environment_name: input.environment,
    ...(input.destinationId ? { destination_uuid: input.destinationId } : {}),
    ...(input.githubAppId ? { github_app_uuid: input.githubAppId } : {}),
    git_repository: input.gitRepository,
    git_branch: input.gitBranch,
    git_commit_sha: input.gitCommit,
    build_pack: "dockercompose",
    docker_compose_location: "/compose.coolify.json",
    is_raw_compose_deployment_enabled: true,
    is_auto_deploy_enabled: false,
    is_preview_deployments_enabled: false,
    instant_deploy: false,
    force_domain_override: false,
    domains: `https://${input.ownerDomain},https://${input.ocppDomain}`,
  };
  const created = await request(
    input.githubAppId ? "/applications/private-github-app" : "/applications/public",
    "POST",
    body,
  );
  if (typeof created.uuid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(created.uuid))
    throw new DeploymentError(
      "Cloud application receipt is incomplete. Inspect Coolify before retrying.",
    );
  const receipt = {
    ...prepared.receipt,
    status: "application-created",
    serviceId: created.uuid,
    gitCommit: input.gitCommit,
  };
  const save = (step) =>
    writeFile(join(prepared.directory, `${step}.json`), JSON.stringify(receipt, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  await save("cloud-created");
  // Recheck raw mode and the pinned template revision before sending any station credentials.
  const application = await request(`/applications/${created.uuid}`);
  if (
    application.build_pack !== "dockercompose" ||
    application.settings?.is_raw_compose_deployment_enabled !== true ||
    application.git_commit_sha !== input.gitCommit ||
    application.docker_compose_location !== "/compose.coolify.json"
  )
    throw new DeploymentError(
      "Coolify did not preserve raw Compose mode and the pinned template revision. No charger credentials were sent and no deployment was started. Inspect cloud-created.json.",
    );
  const values = cloudEnvironment(input, prepared.receipt);
  await request(`/applications/${created.uuid}/envs/bulk`, "PATCH", {
    data: Object.entries(values).map(([key, value]) => ({
      key,
      value,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_shown_once: true,
    })),
  });
  receipt.status = "configured";
  await save("cloud-configured");
  await request(`/deploy?uuid=${created.uuid}`);
  receipt.status = "submitted";
  await save("cloud-receipt");
  return receipt;
}

export function dockerComposeCommand(project, context) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,100}$/.test(project) ||
    (context !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context))
  )
    throw new DeploymentError("Invalid saved Docker destination.");
  return `docker${context ? ` --context ${context}` : ""} compose --project-name ${project} --file compose.json`;
}
