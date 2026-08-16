import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isIP } from "node:net";

const FORMAT = "chargeos-migration-target" as const;
const SCHEMA_VERSION = 1 as const;
const MAX_SERIALIZED_BYTES = 6 * 1024;

export type MigrationTargetTransport = "internet-wss" | "isolated-lan-ws";

export interface MigrationTargetManifestInput {
  readonly configurationBackupSha256: string;
  readonly configurationPath: string;
  readonly configurationPathEvidenceSha256: string;
  readonly continuityRestoreEvidenceSha256: string;
  readonly createdAt?: string;
  readonly credentialCustodyEvidenceSha256: string;
  readonly deviceInventoryEvidenceSha256: string;
  readonly endpoint: string;
  readonly expectedFirmwareVersion: string;
  readonly expectedModel: string;
  readonly expectedVendor: string;
  readonly standaloneRollbackEvidenceSha256: string;
  readonly stationId: string;
  readonly transactionExportSha256: string;
  readonly transport: MigrationTargetTransport;
  readonly transportValidationEvidenceSha256: string;
}

export interface MigrationTargetManifest {
  readonly createdAt: string;
  readonly evidence: {
    readonly configurationBackupSha256: string;
    readonly configurationPathEvidenceSha256: string;
    readonly continuityRestoreEvidenceSha256: string;
    readonly credentialCustodyEvidenceSha256: string;
    readonly deviceInventoryEvidenceSha256: string;
    readonly standaloneRollbackEvidenceSha256: string;
    readonly transactionExportSha256: string;
    readonly transportValidationEvidenceSha256: string;
  };
  readonly format: typeof FORMAT;
  readonly procedure: {
    readonly configurationPath: string;
    readonly physicalWork: "qualified-installer-power-isolated";
  };
  readonly safety: {
    readonly containsSecrets: false;
    readonly endpointChangeAuthorizedSeparately: true;
    readonly localOwnerAuthorizationMustRemainEnabled: true;
  };
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly station: {
    readonly expectedFirmwareVersion: string;
    readonly expectedModel: string;
    readonly expectedVendor: string;
    readonly id: string;
  };
  readonly target: {
    readonly credentialCustody: "owner-held-separately";
    readonly endpoint: string;
    readonly protocol: "ocpp1.6j";
    readonly stationAuthentication: "http-basic-unique-secret";
    readonly transport: MigrationTargetTransport;
    readonly transportValidation: "isolated-owner-lan-only" | "public-ca-hostname-validated";
  };
}

export interface VerifiedMigrationTargetManifest {
  readonly manifest: MigrationTargetManifest;
  readonly serialized: string;
  readonly sha256: string;
}

export class MigrationTargetManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationTargetManifestError";
  }
}

export function createMigrationTargetManifest(
  input: MigrationTargetManifestInput,
  now = new Date(),
): MigrationTargetManifest {
  const stationId = boundedText(input.stationId, "stationId", 64, /^[A-Za-z0-9._:-]+$/u);
  const transport = migrationTargetTransport(input.transport);
  return {
    createdAt: input.createdAt ? exactTimestamp(input.createdAt) : now.toISOString(),
    evidence: {
      configurationBackupSha256: sha256(
        input.configurationBackupSha256,
        "configurationBackupSha256",
      ),
      configurationPathEvidenceSha256: sha256(
        input.configurationPathEvidenceSha256,
        "configurationPathEvidenceSha256",
      ),
      continuityRestoreEvidenceSha256: sha256(
        input.continuityRestoreEvidenceSha256,
        "continuityRestoreEvidenceSha256",
      ),
      credentialCustodyEvidenceSha256: sha256(
        input.credentialCustodyEvidenceSha256,
        "credentialCustodyEvidenceSha256",
      ),
      deviceInventoryEvidenceSha256: sha256(
        input.deviceInventoryEvidenceSha256,
        "deviceInventoryEvidenceSha256",
      ),
      standaloneRollbackEvidenceSha256: sha256(
        input.standaloneRollbackEvidenceSha256,
        "standaloneRollbackEvidenceSha256",
      ),
      transactionExportSha256: sha256(input.transactionExportSha256, "transactionExportSha256"),
      transportValidationEvidenceSha256: sha256(
        input.transportValidationEvidenceSha256,
        "transportValidationEvidenceSha256",
      ),
    },
    format: FORMAT,
    procedure: {
      configurationPath: secretFreeText(input.configurationPath, "configurationPath", 500),
      physicalWork: "qualified-installer-power-isolated",
    },
    safety: {
      containsSecrets: false,
      endpointChangeAuthorizedSeparately: true,
      localOwnerAuthorizationMustRemainEnabled: true,
    },
    schemaVersion: SCHEMA_VERSION,
    station: {
      expectedFirmwareVersion: boundedText(
        input.expectedFirmwareVersion,
        "expectedFirmwareVersion",
        100,
      ),
      expectedModel: boundedText(input.expectedModel, "expectedModel", 200),
      expectedVendor: boundedText(input.expectedVendor, "expectedVendor", 200),
      id: stationId,
    },
    target: {
      credentialCustody: "owner-held-separately",
      endpoint: endpoint(input.endpoint, transport, stationId),
      protocol: "ocpp1.6j",
      stationAuthentication: "http-basic-unique-secret",
      transport,
      transportValidation:
        transport === "internet-wss" ? "public-ca-hostname-validated" : "isolated-owner-lan-only",
    },
  };
}

export function serializeMigrationTargetManifest(manifest: MigrationTargetManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function inspectMigrationTargetManifest(
  serialized: string,
  expectedSha256?: string,
): VerifiedMigrationTargetManifest {
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) {
    throw new MigrationTargetManifestError("Migration target manifest exceeds 6 KiB");
  }
  const manifest = parseMigrationTargetManifest(serialized);
  const canonical = serializeMigrationTargetManifest(manifest);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (expectedSha256 !== undefined && digest !== sha256(expectedSha256, "expectedSha256")) {
    throw new MigrationTargetManifestError("Migration target manifest hash does not match");
  }
  return { manifest, serialized: canonical, sha256: digest };
}

export async function writeMigrationTargetManifest(
  path: string,
  manifest: MigrationTargetManifest,
): Promise<VerifiedMigrationTargetManifest> {
  const inspected = inspectMigrationTargetManifest(serializeMigrationTargetManifest(manifest));
  await writeFile(path, inspected.serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return inspected;
}

function parseMigrationTargetManifest(serialized: string): MigrationTargetManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new MigrationTargetManifestError("Migration target manifest is not valid JSON");
  }
  const root = exactRecord(parsed, "manifest", [
    "createdAt",
    "evidence",
    "format",
    "procedure",
    "safety",
    "schemaVersion",
    "station",
    "target",
  ]);
  if (root.format !== FORMAT || root.schemaVersion !== SCHEMA_VERSION) {
    throw new MigrationTargetManifestError("Unsupported migration target manifest format");
  }
  const evidence = exactRecord(root.evidence, "evidence", [
    "configurationBackupSha256",
    "configurationPathEvidenceSha256",
    "continuityRestoreEvidenceSha256",
    "credentialCustodyEvidenceSha256",
    "deviceInventoryEvidenceSha256",
    "standaloneRollbackEvidenceSha256",
    "transactionExportSha256",
    "transportValidationEvidenceSha256",
  ]);
  const procedure = exactRecord(root.procedure, "procedure", ["configurationPath", "physicalWork"]);
  const safety = exactRecord(root.safety, "safety", [
    "containsSecrets",
    "endpointChangeAuthorizedSeparately",
    "localOwnerAuthorizationMustRemainEnabled",
  ]);
  const station = exactRecord(root.station, "station", [
    "expectedFirmwareVersion",
    "expectedModel",
    "expectedVendor",
    "id",
  ]);
  const target = exactRecord(root.target, "target", [
    "credentialCustody",
    "endpoint",
    "protocol",
    "stationAuthentication",
    "transport",
    "transportValidation",
  ]);
  if (
    procedure.physicalWork !== "qualified-installer-power-isolated" ||
    safety.containsSecrets !== false ||
    safety.endpointChangeAuthorizedSeparately !== true ||
    safety.localOwnerAuthorizationMustRemainEnabled !== true ||
    target.credentialCustody !== "owner-held-separately" ||
    target.protocol !== "ocpp1.6j" ||
    target.stationAuthentication !== "http-basic-unique-secret"
  ) {
    throw new MigrationTargetManifestError("Migration target safety boundary was changed");
  }
  const transport = migrationTargetTransport(target.transport);
  const expectedTransportValidation =
    transport === "internet-wss" ? "public-ca-hostname-validated" : "isolated-owner-lan-only";
  if (target.transportValidation !== expectedTransportValidation) {
    throw new MigrationTargetManifestError("Transport validation does not match transport class");
  }
  return createMigrationTargetManifest({
    configurationBackupSha256: stringValue(
      evidence.configurationBackupSha256,
      "configurationBackupSha256",
    ),
    configurationPath: stringValue(procedure.configurationPath, "configurationPath"),
    configurationPathEvidenceSha256: stringValue(
      evidence.configurationPathEvidenceSha256,
      "configurationPathEvidenceSha256",
    ),
    continuityRestoreEvidenceSha256: stringValue(
      evidence.continuityRestoreEvidenceSha256,
      "continuityRestoreEvidenceSha256",
    ),
    createdAt: stringValue(root.createdAt, "createdAt"),
    credentialCustodyEvidenceSha256: stringValue(
      evidence.credentialCustodyEvidenceSha256,
      "credentialCustodyEvidenceSha256",
    ),
    deviceInventoryEvidenceSha256: stringValue(
      evidence.deviceInventoryEvidenceSha256,
      "deviceInventoryEvidenceSha256",
    ),
    endpoint: stringValue(target.endpoint, "endpoint"),
    expectedFirmwareVersion: stringValue(
      station.expectedFirmwareVersion,
      "expectedFirmwareVersion",
    ),
    expectedModel: stringValue(station.expectedModel, "expectedModel"),
    expectedVendor: stringValue(station.expectedVendor, "expectedVendor"),
    standaloneRollbackEvidenceSha256: stringValue(
      evidence.standaloneRollbackEvidenceSha256,
      "standaloneRollbackEvidenceSha256",
    ),
    stationId: stringValue(station.id, "station.id"),
    transactionExportSha256: stringValue(
      evidence.transactionExportSha256,
      "transactionExportSha256",
    ),
    transport,
    transportValidationEvidenceSha256: stringValue(
      evidence.transportValidationEvidenceSha256,
      "transportValidationEvidenceSha256",
    ),
  });
}

function endpoint(value: string, transport: MigrationTargetTransport, stationId: string): string {
  const text = boundedText(value, "endpoint", 2048);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new MigrationTargetManifestError("endpoint must be a valid absolute URL");
  }
  const expectedProtocol = transport === "internet-wss" ? "wss:" : "ws:";
  if (parsed.protocol !== expectedProtocol) {
    throw new MigrationTargetManifestError(`endpoint must use ${expectedProtocol.slice(0, -1)}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new MigrationTargetManifestError(
      "endpoint must not embed credentials, query parameters, or a fragment",
    );
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  let endpointStationId = "";
  try {
    endpointStationId = decodeURIComponent(segments.at(-1) ?? "");
  } catch {
    throw new MigrationTargetManifestError("endpoint station path is not valid encoding");
  }
  if (endpointStationId !== stationId) {
    throw new MigrationTargetManifestError("endpoint path must end with the exact stationId");
  }
  if (transport === "isolated-lan-ws" && !isPrivateLanAddress(parsed.hostname)) {
    throw new MigrationTargetManifestError(
      "isolated-lan-ws endpoint must use a non-loopback private IP address",
    );
  }
  return parsed.toString();
}

function isPrivateLanAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
    );
  }
  if (version === 6) {
    return /^(?:fc|fd|fe[89ab])/u.test(host);
  }
  return false;
}

function migrationTargetTransport(value: unknown): MigrationTargetTransport {
  if (value === "internet-wss" || value === "isolated-lan-ws") return value;
  throw new MigrationTargetManifestError("transport must be internet-wss or isolated-lan-ws");
}

function boundedText(value: unknown, name: string, maximum: number, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maximum ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    (pattern && !pattern.test(value))
  ) {
    throw new MigrationTargetManifestError(`${name} is invalid`);
  }
  return value;
}

function secretFreeText(value: unknown, name: string, maximum: number): string {
  const text = boundedText(value, name, maximum);
  if (/(?:password|passwd|secret|token|api[-_ ]?key|rfid|wi-?fi|sim\s*pin)\s*[:=]/iu.test(text)) {
    throw new MigrationTargetManifestError(`${name} appears to contain a credential`);
  }
  return text;
}

function exactTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new MigrationTargetManifestError("createdAt must be an exact ISO timestamp");
  }
  return value;
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new MigrationTargetManifestError(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new MigrationTargetManifestError(`${name} must be a string`);
  }
  return value;
}

function exactRecord(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MigrationTargetManifestError(`${name} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new MigrationTargetManifestError(`${name} contains missing or unexpected fields`);
  }
  return record;
}
