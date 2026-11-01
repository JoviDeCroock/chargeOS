import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

export interface GatewayConfig {
  readonly aiRelayOrigin?: string;
  readonly apiHost: string;
  readonly apiPort: number;
  readonly eventLogPath: string;
  readonly eventLogMaxBytes: number;
  readonly heartbeatSeconds: number;
  readonly ocppHost: string;
  readonly ocppMaxConnections: number;
  readonly ocppMaxPayloadBytes: number;
  readonly ocppMessageBurst: number;
  readonly ocppMessagesPerMinute: number;
  readonly ownerApiToken: string;
  readonly ownerTags: ReadonlySet<string>;
  readonly port: number;
  readonly stationId: string;
  readonly stationSecret: string;
  readonly stations?: readonly StationConfig[];
  readonly trustProxyHeaders: boolean;
  readonly uiDirectory: string;
}

export interface StationConfig {
  readonly id: string;
  readonly label: string;
  readonly ownerTags: ReadonlySet<string>;
  readonly secret: string;
  readonly site: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  if (env.CHARGEOS_AI_RELAY_ORIGIN && env.CHARGEOS_AI_RELAY_ORIGIN !== "http://caddy:9092") {
    throw new Error("CHARGEOS_AI_RELAY_ORIGIN must be the internal Caddy relay http://caddy:9092");
  }
  const stations = loadStations(env);
  const primaryStation = stations[0]!;
  const stationId = primaryStation.id;
  const stationSecret = primaryStation.secret;
  const ownerApiToken = requireSecret(env, "CHARGEOS_OWNER_API_TOKEN");
  const ownerTags = primaryStation.ownerTags;
  if (ownerApiToken.length < 32) {
    throw new Error("CHARGEOS_OWNER_API_TOKEN must be at least 32 characters");
  }

  const port = parsePort(env.CHARGEOS_PORT ?? "9000");
  const apiPort = parsePort(env.CHARGEOS_API_PORT ?? "9080");
  if (port === apiPort) {
    throw new Error("CHARGEOS_PORT and CHARGEOS_API_PORT must be different");
  }

  const ocppMessagesPerMinute = parseBoundedInteger(
    env.CHARGEOS_OCPP_MESSAGES_PER_MINUTE ?? "600",
    "CHARGEOS_OCPP_MESSAGES_PER_MINUTE",
    1,
    60_000,
  );
  const ocppMessageBurst = parseBoundedInteger(
    env.CHARGEOS_OCPP_MESSAGE_BURST ?? "60",
    "CHARGEOS_OCPP_MESSAGE_BURST",
    1,
    10_000,
  );
  if (ocppMessageBurst > ocppMessagesPerMinute) {
    throw new Error("CHARGEOS_OCPP_MESSAGE_BURST must not exceed the per-minute limit");
  }

  return {
    ...(env.CHARGEOS_AI_RELAY_ORIGIN ? { aiRelayOrigin: env.CHARGEOS_AI_RELAY_ORIGIN } : {}),
    apiHost: env.CHARGEOS_API_HOST?.trim() || "127.0.0.1",
    apiPort,
    eventLogPath: env.CHARGEOS_EVENT_LOG ?? ".chargeos/events.ndjson",
    eventLogMaxBytes: parseBoundedInteger(
      env.CHARGEOS_EVENT_LOG_MAX_BYTES ?? "268435456",
      "CHARGEOS_EVENT_LOG_MAX_BYTES",
      1_048_576,
      1_099_511_627_776,
    ),
    heartbeatSeconds: parsePositiveInteger(env.CHARGEOS_HEARTBEAT_SECONDS ?? "60"),
    ocppHost: env.CHARGEOS_OCPP_HOST?.trim() || "127.0.0.1",
    ocppMaxConnections: parseBoundedInteger(
      env.CHARGEOS_OCPP_MAX_CONNECTIONS ?? "8",
      "CHARGEOS_OCPP_MAX_CONNECTIONS",
      1,
      100,
    ),
    ocppMaxPayloadBytes: parseBoundedInteger(
      env.CHARGEOS_OCPP_MAX_PAYLOAD_BYTES ?? "1048576",
      "CHARGEOS_OCPP_MAX_PAYLOAD_BYTES",
      16_384,
      8_388_608,
    ),
    ocppMessageBurst,
    ocppMessagesPerMinute,
    ownerApiToken,
    ownerTags,
    port,
    stationId,
    stationSecret,
    stations,
    trustProxyHeaders: parseBoolean(
      env.CHARGEOS_TRUST_PROXY_HEADERS ?? "false",
      "CHARGEOS_TRUST_PROXY_HEADERS",
    ),
    uiDirectory: env.CHARGEOS_UI_DIRECTORY ?? "dist/ui",
  };
}

/**
 * The OCPP 1.6 security whitepaper (edition 4, A00.FR.205) stores the Basic-auth password in
 * `AuthorizationKey`: at least 16 bytes, at most 20 bytes, written as up to 40 hexadecimal digits.
 * Other secrets still authenticate, but conforming chargers may refuse to store them. Returns
 * station IDs only; never the secret or its length.
 */
export function stationSecretInteroperabilityAdvisories(config: GatewayConfig): readonly string[] {
  return configuredStations(config)
    .filter(({ secret }) => !/^[0-9A-Fa-f]{32,40}$/u.test(secret))
    .map(
      ({ id }) =>
        `Station ${id}: its password is not 32-40 hexadecimal digits (16-20 bytes) as the OCPP 1.6 security whitepaper requires for AuthorizationKey. Some chargers may refuse it; generate one with "openssl rand -hex 20".`,
    );
}

export function configuredStations(config: GatewayConfig): readonly StationConfig[] {
  return (
    config.stations ?? [
      {
        id: config.stationId,
        label: config.stationId,
        ownerTags: config.ownerTags,
        secret: config.stationSecret,
        site: "Primary site",
      },
    ]
  );
}

export function configForStation(config: GatewayConfig, stationId: string): GatewayConfig {
  const station = configuredStations(config).find((candidate) => candidate.id === stationId);
  if (!station) throw new UnknownStationError();
  return {
    ...config,
    ownerTags: station.ownerTags,
    stationId: station.id,
    stationSecret: station.secret,
  };
}

export class UnknownStationError extends Error {
  constructor() {
    super("Unknown charge point");
    this.name = "UnknownStationError";
  }
}

function loadStations(env: NodeJS.ProcessEnv): readonly StationConfig[] {
  const fleetFile = env.CHARGEOS_STATIONS_FILE?.trim();
  const legacyNames = ["CHARGEOS_STATION_ID", "CHARGEOS_STATION_SECRET", "CHARGEOS_OWNER_TAGS"];
  const hasLegacyStation = legacyNames.some(
    (name) => env[name] !== undefined || env[`${name}_FILE`] !== undefined,
  );
  if (fleetFile && hasLegacyStation) {
    throw new Error(
      "CHARGEOS_STATIONS_FILE is mutually exclusive with legacy single-station settings",
    );
  }
  if (fleetFile) {
    return parseStationsFile(readSecretFile(fleetFile, "CHARGEOS_STATIONS_FILE"));
  }

  const station = validateStation({
    id: requireValue(env, "CHARGEOS_STATION_ID"),
    label: env.CHARGEOS_STATION_LABEL?.trim() || requireValue(env, "CHARGEOS_STATION_ID"),
    ownerTags: parseOwnerTags(requireSecret(env, "CHARGEOS_OWNER_TAGS", true)),
    secret: requireSecret(env, "CHARGEOS_STATION_SECRET"),
    site: env.CHARGEOS_STATION_SITE?.trim() || "Primary site",
  });
  return [station];
}

function parseStationsFile(contents: string): readonly StationConfig[] {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("CHARGEOS_STATIONS_FILE must contain valid JSON");
  }
  const root = objectWithExactKeys(value, ["schemaVersion", "stations"]);
  if (!root || root.schemaVersion !== 1 || !Array.isArray(root.stations)) {
    throw new Error("CHARGEOS_STATIONS_FILE must use fleet schema version 1");
  }
  if (root.stations.length < 1 || root.stations.length > 1_000) {
    throw new Error("CHARGEOS_STATIONS_FILE must contain 1 through 1000 stations");
  }
  const stations = root.stations.map((candidate) => {
    const record = objectWithExactKeys(candidate, ["id", "label", "ownerTags", "secret", "site"]);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.label !== "string" ||
      !Array.isArray(record.ownerTags) ||
      !record.ownerTags.every((tag) => typeof tag === "string") ||
      typeof record.secret !== "string" ||
      typeof record.site !== "string"
    ) {
      throw new Error("CHARGEOS_STATIONS_FILE contains an invalid station record");
    }
    return validateStation({
      id: record.id,
      label: record.label,
      ownerTags: new Set(record.ownerTags as string[]),
      secret: record.secret,
      site: record.site,
    });
  });
  if (new Set(stations.map(({ id }) => id)).size !== stations.length) {
    throw new Error("CHARGEOS_STATIONS_FILE station IDs must be unique");
  }
  return stations;
}

function validateStation(station: StationConfig): StationConfig {
  if (
    !station.id ||
    station.id.trim() !== station.id ||
    station.id.length > 128 ||
    hasControlCharacters(station.id) ||
    station.id.includes("/")
  ) {
    throw new Error("Station IDs must be 1-128 safe path-segment characters");
  }
  for (const [name, value] of [
    ["label", station.label],
    ["site", station.site],
  ] as const) {
    if (!value || value.trim() !== value || value.length > 120 || hasControlCharacters(value)) {
      throw new Error(`Station ${name} must be 1-120 printable characters`);
    }
  }
  if (station.secret.length < 16 || hasControlCharacters(station.secret)) {
    throw new Error("Every station secret must be a single-line value of at least 16 characters");
  }
  if (station.ownerTags.size === 0) {
    throw new Error("Every station must contain at least one owner tag");
  }
  for (const tag of station.ownerTags) {
    if (!tag || tag.length > 20 || tag.trim() !== tag || hasControlCharacters(tag)) {
      throw new Error("OCPP 1.6 owner tags must be 1-20 printable characters");
    }
  }
  return station;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function objectWithExactKeys(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === [...keys].sort().join(",") ? record : null;
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requireSecret(env: NodeJS.ProcessEnv, name: string, multiline = false): string {
  const fileName = `${name}_FILE`;
  const hasInlineValue = env[name] !== undefined;
  const hasFileValue = env[fileName] !== undefined;

  if (hasInlineValue && hasFileValue) {
    throw new Error(`${name} and ${fileName} are mutually exclusive`);
  }
  if (!hasInlineValue && !hasFileValue) {
    throw new Error(`${name} or ${fileName} is required`);
  }

  const value = hasFileValue
    ? readSecretFile(requireValue(env, fileName), fileName)
    : (env[name] ?? "");
  const normalized = value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;

  if (!normalized || normalized.includes("\0")) {
    throw new Error(`${name} must contain a non-empty secret value`);
  }
  if (!multiline && /[\r\n]/u.test(normalized)) {
    throw new Error(`${name} must contain exactly one line`);
  }
  if (normalized.trim() !== normalized) {
    throw new Error(`${name} must not start or end with whitespace`);
  }
  return normalized;
}

function readSecretFile(path: string, settingName: string): string {
  let pathMetadata;
  try {
    pathMetadata = lstatSync(path);
  } catch {
    throw new Error(`${settingName} cannot be read`);
  }

  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    throw new Error(`${settingName} must reference a regular, non-symlinked file`);
  }

  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${settingName} cannot be read`);
  }

  try {
    const openedMetadata = fstatSync(descriptor);
    if (
      !openedMetadata.isFile() ||
      openedMetadata.dev !== pathMetadata.dev ||
      openedMetadata.ino !== pathMetadata.ino
    ) {
      throw new Error(`${settingName} changed while it was being opened`);
    }

    const permissionBits = openedMetadata.mode & 0o777;
    if (path.startsWith("/run/secrets/")) {
      if ((permissionBits & 0o222) !== 0) {
        throw new Error(`${settingName} Docker secret must be read-only`);
      }
    } else if ((permissionBits & 0o077) !== 0) {
      throw new Error(`${settingName} must not be accessible by group or other users`);
    }

    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function parseOwnerTags(value: string): Set<string> {
  return new Set(
    value
      .split(/[\r\n,]+/u)
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 65_535) {
    throw new Error(`Port is out of range: ${value}`);
  }
  return parsed;
}

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
