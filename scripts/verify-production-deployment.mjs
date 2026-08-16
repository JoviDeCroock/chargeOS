import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rendered = execFileSync(
  "docker",
  [
    "compose",
    "--project-directory",
    root,
    "--env-file",
    join(root, ".env.production.example"),
    "--file",
    join(root, "compose.production.yaml"),
    "config",
    "--format",
    "json",
  ],
  { cwd: root, encoding: "utf8" },
);

const model = JSON.parse(rendered);
const chargeos = model.services?.chargeos;
const caddy = model.services?.caddy;
const dockerIgnore = new Set(
  readFileSync(join(root, ".dockerignore"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean),
);
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

assert(chargeos && caddy, "production model must contain chargeos and caddy services");
assert(dockerIgnore.has(".env*"), "Docker build context must exclude every environment file");
assert(dockerIgnore.has("secrets"), "Docker build context must exclude the secrets directory");
assert(
  /^FROM node:22\.23\.1-alpine3\.24@sha256:[a-f0-9]{64} AS base$/mu.test(dockerfile),
  "Node base image must keep its exact version and multi-platform digest",
);
const patchCopyIndex = dockerfile.indexOf("COPY patches ./patches");
const installIndex = dockerfile.indexOf("RUN pnpm install --frozen-lockfile");
assert(
  patchCopyIndex >= 0 && installIndex > patchCopyIndex,
  "Docker build must copy locked dependency patches before installation",
);
assert(!chargeos.ports, "chargeos must not publish host ports");
assertSameMembers(chargeos.expose, ["9000", "9080"], "chargeos internal ports");
assertSameMembers(Object.keys(chargeos.networks ?? {}), ["chargeos-internal"], "chargeos networks");
assert(
  model.networks?.["chargeos-internal"]?.internal === true,
  "chargeos network must be internal",
);
assert(chargeos.read_only === true, "chargeos root filesystem must be read-only");
assert(
  chargeos.volumes?.length === 1 &&
    chargeos.volumes[0]?.type === "volume" &&
    chargeos.volumes[0]?.source === "chargeos-data" &&
    chargeos.volumes[0]?.target === "/data",
  "production chargeos must persist evidence in the chargeos-data volume",
);
assert(
  chargeos.environment?.CHARGEOS_TRUST_PROXY_HEADERS === "true",
  "production chargeos must trust the sole internal Caddy peer for client rate-limit keys",
);
assert(
  chargeos.environment?.CHARGEOS_OCPP_MAX_CONNECTIONS ===
    caddy.environment?.CHARGEOS_OCPP_MAX_CONNECTIONS,
  "chargeOS and Caddy must share one OCPP connection limit",
);
assert(
  chargeos.security_opt?.includes("no-new-privileges:true"),
  "chargeos must disable privilege escalation",
);

const expectedSecretEnvironment = {
  CHARGEOS_OWNER_API_TOKEN_FILE: "/run/secrets/owner_api_token",
  CHARGEOS_OWNER_TAGS_FILE: "/run/secrets/owner_tags",
  CHARGEOS_STATION_SECRET_FILE: "/run/secrets/station_secret",
};
for (const [name, value] of Object.entries(expectedSecretEnvironment)) {
  assert(chargeos.environment?.[name] === value, `${name} must use its read-only secret mount`);
  assert(!(name.slice(0, -5) in chargeos.environment), `${name.slice(0, -5)} must not be inline`);
}
assert(
  chargeos.secrets?.every(
    (secret) => typeof secret.target === "string" && secret.target.startsWith("/run/secrets/"),
  ),
  "every chargeos secret must target /run/secrets",
);

assertSameMembers(
  Object.keys(caddy.networks ?? {}),
  ["chargeos-edge", "chargeos-internal"],
  "Caddy networks",
);
assert(caddy.read_only === true, "Caddy root filesystem must be read-only");
assert(
  /^caddy:2\.11\.4-alpine@sha256:[a-f0-9]{64}$/u.test(caddy.image),
  "Caddy image must keep its exact version and multi-platform digest",
);
assert(caddy.cap_drop?.includes("ALL"), "Caddy must drop ambient capabilities");
assert(
  caddy.cap_add?.length === 1 && caddy.cap_add[0] === "NET_BIND_SERVICE",
  "Caddy may add only NET_BIND_SERVICE",
);
assert(
  caddy.security_opt?.includes("no-new-privileges:true"),
  "Caddy must disable privilege escalation",
);
assertSameMembers(
  caddy.ports?.map(({ published, protocol, target }) => `${published}:${target}/${protocol}`),
  ["80:80/tcp", "443:443/tcp", "443:443/udp"],
  "Caddy host ports",
);
assert(
  caddy.environment?.CHARGEOS_OCPP_DOMAIN !== caddy.environment?.CHARGEOS_OWNER_DOMAIN,
  "OCPP and owner TLS hostnames must be distinct",
);

const fleetModel = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      root,
      "--env-file",
      join(root, ".env.fleet.production.example"),
      "--file",
      join(root, "compose.fleet.production.yaml"),
      "config",
      "--format",
      "json",
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const fleetChargeos = fleetModel.services?.chargeos;
const fleetCaddy = fleetModel.services?.caddy;
assert(fleetChargeos && fleetCaddy, "fleet model must contain chargeos and caddy services");
assert(!fleetChargeos.ports, "fleet chargeos must not publish host ports");
assertSameMembers(fleetChargeos.expose, ["9000", "9080"], "fleet chargeos internal ports");
assertSameMembers(
  Object.keys(fleetChargeos.networks ?? {}),
  ["chargeos-internal"],
  "fleet chargeos networks",
);
assert(fleetChargeos.read_only === true, "fleet chargeos root filesystem must be read-only");
assert(
  fleetChargeos.environment?.CHARGEOS_STATIONS_FILE === "/run/secrets/stations_registry",
  "fleet station registry must use its read-only secret mount",
);
assert(
  fleetChargeos.environment?.CHARGEOS_OWNER_API_TOKEN_FILE === "/run/secrets/owner_api_token",
  "fleet owner token must use its read-only secret mount",
);
for (const forbidden of [
  "CHARGEOS_STATION_ID",
  "CHARGEOS_STATION_SECRET",
  "CHARGEOS_STATION_SECRET_FILE",
  "CHARGEOS_OWNER_TAGS",
  "CHARGEOS_OWNER_TAGS_FILE",
]) {
  assert(
    !(forbidden in (fleetChargeos.environment ?? {})),
    `${forbidden} must not enter fleet mode`,
  );
}
assert(
  fleetChargeos.secrets?.every(
    (secret) => typeof secret.target === "string" && secret.target.startsWith("/run/secrets/"),
  ),
  "every fleet chargeos secret must target /run/secrets",
);
assert(
  fleetChargeos.environment?.CHARGEOS_OCPP_MAX_CONNECTIONS ===
    fleetCaddy.environment?.CHARGEOS_OCPP_MAX_CONNECTIONS,
  "fleet chargeOS and Caddy must share one OCPP connection limit",
);
assert(
  fleetModel.networks?.["chargeos-internal"]?.internal === true,
  "fleet chargeos network must be internal",
);

console.log("Production deployment trust boundary is valid");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSameMembers(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be a list`);
  assert(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} must contain exactly ${expected.join(", ")}`,
  );
}
