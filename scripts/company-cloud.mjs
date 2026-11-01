import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudDeploymentInput, DeploymentError } from "./deployment.mjs";

const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const companyCloudFields = [
  "cloudOrigin",
  "cloudToken",
  "projectId",
  "serverId",
  "environment",
  "gitRepository",
  "gitBranch",
  "gitCommit",
  "githubAppId",
  "image",
  "proxyImage",
  "cloudPrivacyConfirmed",
];
export function companyCloudInput(value) {
  const result = cloudDeploymentInput(value);
  for (const name of ["image", "proxyImage"]) {
    if (
      typeof value[name] !== "string" ||
      !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(value[name])
    )
      throw new DeploymentError(
        "Managed company setup needs verified runtime and proxy image references ending in @sha256 and their 64-character digests.",
      );
    result[name] = value[name];
  }
  if (value.cloudPrivacyConfirmed !== true)
    throw new DeploymentError(
      "Ask your operator to confirm dedicated Traefik ingress, disabled URL/request/error logging and no extra proxy or CDN before deploying accounts.",
    );
  return result;
}

/** Fresh accounts only. Every mutation is single-shot with private intent and
 * result receipts; uncertain creation must be audited, never silently retried. */
export async function deployCompanyToCoolify(input, prepared, fetcher = fetch) {
  const receipt = {
    ...prepared.receipt,
    gitCommit: input.gitCommit,
    serverId: input.serverId,
    projectId: input.projectId,
    network: `chargeos-company-${prepared.receipt.installId}`,
  };
  const save = (stage) =>
    writeFile(join(prepared.directory, `cloud-${stage}.json`), JSON.stringify(receipt, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  const refused = () =>
    new DeploymentError(
      "Cloud company deployment did not complete. Inspect Coolify, START-HERE.txt and cloud receipts before retrying; no automatic retry was made.",
    );
  async function request(path, method = "GET", body) {
    let response;
    try {
      response = await fetcher(`${input.cloudOrigin}/api/v1${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${input.cloudToken}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw refused();
      }
      const reader = response.body?.getReader();
      if (!reader) throw refused();
      let length = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 262144) throw refused();
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } finally {
        await reader.cancel();
      }
    } catch {
      throw refused();
    }
  }
  await save("intent");
  const server = await request(`/servers/${input.serverId}`);
  if (
    server.uuid !== input.serverId ||
    server.proxy?.type !== "TRAEFIK" ||
    server.settings?.is_cloudflare_tunnel !== false ||
    server.settings?.is_swarm_manager !== false ||
    server.settings?.is_swarm_worker !== false ||
    server.settings?.is_traffic_analytics_enabled !== false
  )
    throw new DeploymentError(
      "Company cloud setup requires a standalone Traefik server without Cloudflare Tunnel or traffic analytics. No company credentials were sent.",
    );
  const destination = await request(`/servers/${input.serverId}/destinations`, "POST", {
    name: receipt.network,
    network: receipt.network,
    type: "standalone",
  });
  if (!identifier(destination.uuid)) throw refused();
  receipt.destinationId = destination.uuid;
  receipt.status = "destination-created";
  await save("destination-created");
  const current = await request(`/destinations/${destination.uuid}`);
  if (
    current.uuid !== destination.uuid ||
    current.network !== receipt.network ||
    current.server_uuid !== input.serverId ||
    current.type !== "standalone"
  )
    throw new DeploymentError(
      "The fresh company destination did not match its requested network and server. No company credentials were sent; inspect the private destination receipt.",
    );
  const created = await request(
    input.githubAppId ? "/applications/private-github-app" : "/applications/public",
    "POST",
    {
      name: receipt.network,
      project_uuid: input.projectId,
      server_uuid: input.serverId,
      destination_uuid: destination.uuid,
      environment_name: input.environment,
      ...(input.githubAppId ? { github_app_uuid: input.githubAppId } : {}),
      git_repository: input.gitRepository,
      git_branch: input.gitBranch,
      git_commit_sha: input.gitCommit,
      build_pack: "dockercompose",
      docker_compose_location: "/compose.company.coolify.json",
      is_raw_compose_deployment_enabled: true,
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      instant_deploy: false,
      force_domain_override: false,
      connect_to_docker_network: false,
      autogenerate_domain: false,
      is_force_https_enabled: false,
      domains: `https://${input.companyDomain}`,
      redact_all_env_values_in_logs: true,
    },
  );
  if (!identifier(created.uuid)) throw refused();
  receipt.serviceId = created.uuid;
  receipt.status = "application-created";
  await save("application-created");
  const application = await request(`/applications/${created.uuid}`);
  const destinations = await request(`/applications/${created.uuid}/destinations`);
  if (
    application.build_pack !== "dockercompose" ||
    application.settings?.is_raw_compose_deployment_enabled !== true ||
    application.settings?.is_auto_deploy_enabled !== false ||
    application.settings?.is_preview_deployments_enabled !== false ||
    application.settings?.connect_to_docker_network !== false ||
    application.settings?.redact_all_env_values_in_logs !== true ||
    application.git_commit_sha !== input.gitCommit ||
    application.docker_compose_location !== "/compose.company.coolify.json" ||
    !Array.isArray(destinations) ||
    destinations.length !== 1 ||
    destinations[0]?.uuid !== destination.uuid ||
    destinations[0]?.network !== receipt.network ||
    destinations[0]?.server_uuid !== input.serverId ||
    destinations[0]?.is_primary !== true
  )
    throw new DeploymentError(
      "Coolify did not preserve the isolated destination, raw template or pinned revision/settings. No company credentials were sent; inspect cloud-application-created.json.",
    );
  const auth = await readFile(join(prepared.directory, "secrets/company_auth"), "utf8");
  const smtp = await readFile(join(prepared.directory, "secrets/company_smtp"), "utf8");
  const values = {
    COMPANY_INSTALL_ID: receipt.installId,
    COMPANY_INGRESS_NETWORK: receipt.network,
    COMPANY_DOMAIN: input.companyDomain,
    COMPANY_SIGNUP_DOMAINS: input.signupDomains.join(","),
    COMPANY_IMAGE: input.image,
    COMPANY_PROXY_IMAGE: input.proxyImage,
    COMPANY_BOOTSTRAP_AUTH: auth,
    COMPANY_BOOTSTRAP_SMTP: smtp,
  };
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
  await save("configured");
  await request(`/deploy?uuid=${created.uuid}`);
  receipt.status = "submitted";
  await save("receipt");
  return receipt;
}
