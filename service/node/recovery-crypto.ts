import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { requireCommercialPassphrase } from "./recovery-files.js";

export const MAX_COMMERCIAL_DATABASE_BYTES = 64 * 1024 * 1024;
export const MAX_COMMERCIAL_ENVELOPE_BYTES = 124 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 92 * 1024 * 1024;
const format = "chargeos-commercial-recovery";
const parameters = { algorithm: "aes-256-gcm", kdf: "scrypt", n: 32768, r: 8, p: 1 } as const;
interface Envelope {
  format: typeof format;
  schemaVersion: 1;
  createdAt: string;
  encryption: typeof parameters & { salt: string; iv: string; authTag: string; ciphertext: string };
}
export function exactObject(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    throw new Error("Unsupported commercial recovery structure");
}
export function decodeCommercialBase64(value: unknown, maximum: number, exact?: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(maximum / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error("Invalid bounded commercial recovery encoding");
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > maximum ||
    (exact !== undefined && bytes.length !== exact) ||
    bytes.toString("base64") !== value
  )
    throw new Error("Invalid bounded commercial recovery bytes");
  return bytes;
}
function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  requireCommercialPassphrase(passphrase);
  return new Promise((resolve, reject) =>
    scrypt(
      passphrase,
      salt,
      32,
      { N: parameters.n, r: parameters.r, p: parameters.p, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
function aad(createdAt: string): Buffer {
  return Buffer.from(JSON.stringify({ format, schemaVersion: 1, createdAt, ...parameters }));
}
export async function sealCommercialPayload(
  payload: object,
  createdAt: string,
  passphrase: string,
): Promise<string> {
  const plaintext = Buffer.from(JSON.stringify(payload));
  if (plaintext.length > MAX_PAYLOAD_BYTES)
    throw new Error("Commercial recovery payload is too large");
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = await derive(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(createdAt));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: Envelope = {
      format,
      schemaVersion: 1,
      createdAt,
      encryption: {
        ...parameters,
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      },
    };
    return JSON.stringify(envelope) + "\n";
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}
export async function openCommercialPayload(
  serialized: string,
  passphrase: string,
): Promise<{ value: unknown; createdAt: string }> {
  if (Buffer.byteLength(serialized) > MAX_COMMERCIAL_ENVELOPE_BYTES)
    throw new Error("Commercial recovery envelope is too large");
  const envelope: unknown = JSON.parse(serialized);
  exactObject(envelope, ["format", "schemaVersion", "createdAt", "encryption"]);
  if (
    envelope.format !== format ||
    envelope.schemaVersion !== 1 ||
    typeof envelope.createdAt !== "string" ||
    !Number.isFinite(Date.parse(envelope.createdAt)) ||
    new Date(envelope.createdAt).toISOString() !== envelope.createdAt
  )
    throw new Error("Unsupported commercial recovery format");
  const encryption = envelope.encryption;
  exactObject(encryption, [...Object.keys(parameters), "salt", "iv", "authTag", "ciphertext"]);
  for (const [name, expected] of Object.entries(parameters))
    if (encryption[name] !== expected)
      throw new Error("Unsupported commercial recovery encryption parameters");
  const salt = decodeCommercialBase64(encryption.salt, 16, 16),
    iv = decodeCommercialBase64(encryption.iv, 12, 12),
    tag = decodeCommercialBase64(encryption.authTag, 16, 16),
    ciphertext = decodeCommercialBase64(encryption.ciphertext, MAX_PAYLOAD_BYTES);
  const key = await derive(passphrase, salt);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(envelope.createdAt));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    plaintext = decoded;
    return { value: JSON.parse(decoded.toString("utf8")), createdAt: envelope.createdAt };
  } catch {
    throw new Error("Commercial recovery authentication failed");
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}
