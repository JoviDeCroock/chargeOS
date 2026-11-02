import { randomBytes } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const caddyImage =
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
export class DeploymentError extends Error {}
/** Used when the owner does not know the charger's name yet; the console can adopt the real one. */
export const DEFAULT_STATION_ID = "HOME-1";
export function deploymentInput(value) {
  const allowed = [
    "target",
    "name",
    "stationId",
    "ownerTag",
    "profile",
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
  // Both are optional on Docker: the console can adopt the name a charger already uses (after it
  // proves the station password) and add the first card when the owner taps it at the charger.
  const stationId =
    value.stationId === undefined || value.stationId === ""
      ? DEFAULT_STATION_ID
      : field(
          "stationId",
          /^[a-zA-Z0-9_-]{1,64}$/,
          "Use the charger's exact OCPP identity: 1–64 letters, numbers, underscores or hyphens. Leave it blank to use HOME-1.",
        );
  const ownerTag =
    value.ownerTag === undefined || value.ownerTag === ""
      ? ""
      : field(
          "ownerTag",
          /^[a-zA-Z0-9]{1,20}$/,
          "Enter the card's actual OCPP identifier, 1–20 letters or numbers, or leave it blank and tap the card in the console later. A printed card number may differ.",
        );
  if (!ownerTag && value.target === "coolify")
    throw new DeploymentError(
      "Managed deployment still needs the owner card identifier; tap-to-add is available for Docker setups.",
    );
  const profile = value.profile ?? "personal";
  if (profile !== "personal" && profile !== "company")
    throw new DeploymentError("Choose a personal or company console.");
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
    profile,
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
  const seedsOwnerTag = Boolean(input.ownerTag);
  const environment = {
    CHARGEOS_AI_RELAY_ORIGIN: "http://caddy:9092",
    CHARGEOS_OCPP_PUBLIC_URL: `wss://${input.ocppDomain}/`,
    CHARGEOS_OWNER_API_TOKEN_FILE: "/run/secrets/owner_api_token",
    // Without a card the edge starts with none and the owner taps the first one in the console.
    ...(seedsOwnerTag ? { CHARGEOS_OWNER_TAGS_FILE: "/run/secrets/owner_tags" } : {}),
    CHARGEOS_PROFILE: input.profile ?? "personal",
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
        secrets: seedsOwnerTag
          ? ["owner_api_token", "owner_tags", "station_secret"]
          : ["owner_api_token", "station_secret"],
      },
      caddy: {
        image: caddyImage,
        cap_add: ["NET_BIND_SERVICE"],
        cap_drop: ["ALL"],
        depends_on: {
          "caddy-volumes": { condition: "service_completed_successfully" },
          chargeos: { condition: "service_started" },
        },
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
        user: "1000:1000",
        volumes: [
          "./Caddyfile:/etc/caddy/Caddyfile:ro",
          "caddy-config:/config",
          "caddy-data:/data",
        ],
      },
      "caddy-volumes": caddyVolumeOwnership(caddyImage),
    },
    networks: { "chargeos-edge": {}, "chargeos-internal": { internal: true } },
    secrets: {
      owner_api_token: { file: "./secrets/owner_api_token" },
      ...(seedsOwnerTag ? { owner_tags: { file: "./secrets/owner_tags" } } : {}),
      station_secret: { file: "./secrets/station_secret" },
    },
    volumes: { "chargeos-data": {}, "caddy-config": {}, "caddy-data": {} },
  };
  const credentials = {
    owner_api_token: ownerToken,
    ...(seedsOwnerTag ? { owner_tags: input.ownerTag } : {}),
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
  await save("START-HERE.txt", startHere(input, receipt, model));
  await save("INSTALLER-SHEET.txt", installerSheet(input, receipt));
  return { directory, model, receipt };
}

function startHere(input, receipt, model) {
  const compose =
    input.target === "docker" ? dockerComposeCommand(model.name, input.dockerContext) : null;
  return `chargeOS setup: ${input.name}

Console: ${receipt.consoleUrl}
Charger address: wss://${input.ocppDomain}/
Charger name: ${receipt.stationId}
Private credentials: credentials.json (ownerToken signs you in; stationSecret is the charger password)
Installer settings: INSTALLER-SHEET.txt

This folder is private; keep it off shared drives and out of support messages.

Next steps
1. Point both DNS names at your server. ${input.target === "docker" ? "Ports 80 and 443 must be reachable." : "Coolify supplies TLS and routes console to Caddy port 8080, OCPP to 8081."}
2. Open the console. The setup page's "Open my console" button signs you in once; otherwise paste ownerToken from credentials.json.
3. Give INSTALLER-SHEET.txt to your installer. The console's "Connect your charger" panel turns green when the charger connects and explains any refusal. If the charger uses another name, the console offers to accept it.
4. ${input.ownerTag ? "Your card is already on the list." : "Open RFID cards and tap your own card at the charger to add it. Until then every card is refused."} Then send the card list to the charger.
5. Create an encrypted recovery bundle and keep it off this server (docs/guides/recovery.md). It needs at least one owner card.

Deployment starts software; it never changes an existing charger's endpoint.
Follow docs/guides/connect-a-charger.md before a charger migration.
Do not delete this deployment's data volume or create a second edge for the same live charger.

${compose ? `Docker resume (from this folder): ${compose} up --detach --wait\nDocker stop (keeps data): ${compose} stop\n` : "Cloud: inspect the existing service in Coolify and its saved receipts before retrying any uncertain submission. Never run this cloud setup as a second local edge.\n"}`;
}

/** What the installer types into the charger's own configuration tool. Contains the password. */
function installerSheet(input, receipt) {
  return `chargeOS charger settings: ${input.name}
PRIVATE: this sheet contains the charger password. Destroy it after use.

Enter these in the charger's supported configuration tool:

  Back-office (OCPP) address:  wss://${input.ocppDomain}/
  Charger name (identity):     ${receipt.stationId}
                               (some tools take the name separately; otherwise the full
                                address is wss://${input.ocppDomain}/${receipt.stationId})
  Password:                    ${receipt.stationSecret}
  Protocol:                    OCPP 1.6 JSON (OCPP-J)
  Security:                    the profile that sends the password (Basic authentication)

Before changing anything:
  - Export the charger configuration and transactions, and record the current back-office
    address and settings, so you can restore them.
  - Use only the manufacturer's supported tool and procedure for this exact model and firmware.
  - Opening the enclosure, wiring or SIM changes are installer work with the power isolated.

After saving the settings, the owner console's "Connect your charger" panel shows whether the
charger connected or why it was refused. If the charger keeps its own name, the owner can accept
that name in the console instead of changing it here.
`;
}

/** One-shot, network-less step giving the unprivileged Caddy user its certificate volumes. */
export function caddyVolumeOwnership(image) {
  return {
    image,
    cap_add: ["CHOWN", "DAC_READ_SEARCH", "FOWNER"],
    cap_drop: ["ALL"],
    entrypoint: ["/bin/sh", "-c", "chown -R 1000:1000 /data /config && chmod 0700 /data /config"],
    network_mode: "none",
    read_only: true,
    restart: "no",
    security_opt: ["no-new-privileges:true"],
    user: "0:0",
    volumes: ["caddy-config:/config", "caddy-data:/data"],
  };
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
