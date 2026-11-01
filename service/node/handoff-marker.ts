import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { localConfiguration, publicServiceOrigin } from "../configuration.js";
import { exactObject, canonicalRecoveryJson } from "./recovery-crypto.js";
import type { NativeReleaseReceipt } from "./recovery-marker.js";

export const NATIVE_HANDOFF_SQL =
  "CREATE TABLE _chargeos_native_handoff (id INTEGER PRIMARY KEY CHECK(id=1), receipt_json TEXT NOT NULL)";
export const NATIVE_HANDOFF_HISTORY_SQL =
  "CREATE TABLE _chargeos_native_handoff_history (handoff_id TEXT PRIMARY KEY NOT NULL, receipt_json TEXT NOT NULL)";
export const PUBLIC_HANDOFF_CONFIRMATION =
  "I authorize this reviewed recovery at the exact HTTPS address after stopping all previous service copies";
export interface NativeHandoffReceipt {
  format: "chargeos-native-public-handoff";
  schemaVersion: 1;
  handoffId: string;
  role: "source-retired" | "public-install";
  restoreId: string;
  releaseId: string;
  releaseSha256: string;
  sourceOrigin: string;
  targetOrigin: string;
  packagePath: string;
  packageDevice: string;
  packageInode: string;
  preparedAt: string;
  sourceStateSha256: string;
  candidateStateSha256: string;
  priorHistorySha256: string;
  reviewSha256: string;
  enrollmentSha256: string;
  sourceRetirement: string | null;
  operatorAttestation: string;
}
export const handoffDigest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function handoffHistoryDigest(records: [string, string][]): string {
  return handoffDigest(
    JSON.stringify([...records].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}
function mac(receipt: NativeHandoffReceipt, secret: string): string {
  return createHmac("sha256", secret)
    .update("chargeos-native-public-handoff:1\0")
    .update(JSON.stringify(receipt))
    .digest("hex");
}
export function sealNativeHandoff(receipt: NativeHandoffReceipt, secret: string): string {
  return JSON.stringify({ receipt, mac: mac(receipt, secret) });
}
function common(receipt: NativeHandoffReceipt): string {
  return canonicalRecoveryJson({ ...receipt, role: "source-retired", sourceRetirement: null });
}
export function parseNativeHandoff(
  serialized: string,
  secret?: string,
  historical = false,
  sourceOnly = false,
): NativeHandoffReceipt {
  if (Buffer.byteLength(serialized) > 32768)
    throw new Error("Public handoff receipt exceeds its boundary");
  const value: unknown = JSON.parse(serialized);
  exactObject(value, ["receipt", "mac"]);
  const r = value.receipt;
  exactObject(r, [
    "format",
    "schemaVersion",
    "handoffId",
    "role",
    "restoreId",
    "releaseId",
    "releaseSha256",
    "sourceOrigin",
    "targetOrigin",
    "packagePath",
    "packageDevice",
    "packageInode",
    "preparedAt",
    "sourceStateSha256",
    "candidateStateSha256",
    "priorHistorySha256",
    "reviewSha256",
    "enrollmentSha256",
    "sourceRetirement",
    "operatorAttestation",
  ]);
  if (
    r.format !== "chargeos-native-public-handoff" ||
    r.schemaVersion !== 1 ||
    r.operatorAttestation !== PUBLIC_HANDOFF_CONFIRMATION ||
    !["source-retired", "public-install"].includes(r.role as string) ||
    (sourceOnly && r.role !== "source-retired")
  )
    throw new Error("Invalid public handoff role");
  for (const key of ["handoffId", "restoreId", "releaseId"])
    if (
      typeof r[key] !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r[key])
    )
      throw new Error("Invalid public handoff identity");
  for (const key of ["packageDevice", "packageInode"])
    if (typeof r[key] !== "string" || !/^(?:0|[1-9][0-9]{0,31})$/.test(r[key]))
      throw new Error("Invalid private package identity");
  for (const key of [
    "releaseSha256",
    "sourceStateSha256",
    "candidateStateSha256",
    "priorHistorySha256",
    "reviewSha256",
    "enrollmentSha256",
  ])
    if (typeof r[key] !== "string" || !/^[a-f0-9]{64}$/.test(r[key]))
      throw new Error("Invalid public handoff binding");
  if (
    typeof r.sourceOrigin !== "string" ||
    !localConfiguration({
      SERVICE_MODE: "local",
      SERVICE_ORIGIN: r.sourceOrigin,
      SERVICE_AUTH_SECRET: "public-handoff-origin-validation-only",
    }) ||
    !publicServiceOrigin(r.targetOrigin) ||
    typeof r.packagePath !== "string" ||
    r.packagePath.length > 4096 ||
    /[\0\r\n]/.test(r.packagePath) ||
    !isAbsolute(r.packagePath) ||
    resolve(r.packagePath) !== r.packagePath ||
    typeof r.preparedAt !== "string" ||
    !Number.isFinite(Date.parse(r.preparedAt)) ||
    new Date(r.preparedAt).toISOString() !== r.preparedAt
  )
    throw new Error("Invalid public handoff destination");
  if (typeof value.mac !== "string" || !/^[a-f0-9]{64}$/.test(value.mac))
    throw new Error("Invalid public handoff authenticator");
  const receipt = r as unknown as NativeHandoffReceipt;
  if (
    !historical &&
    (!secret ||
      !timingSafeEqual(Buffer.from(value.mac, "hex"), Buffer.from(mac(receipt, secret), "hex")))
  )
    throw new Error("Public handoff authentication failed");
  if (receipt.role === "source-retired") {
    if (receipt.sourceRetirement !== null) throw new Error("Invalid retired-source receipt");
  } else {
    if (typeof receipt.sourceRetirement !== "string")
      throw new Error("Public installation needs its authenticated source retirement");
    const source = parseNativeHandoff(receipt.sourceRetirement, secret, historical, true);
    if (common(source) !== common(receipt))
      throw new Error("Public installation belongs to another source retirement");
  }
  return receipt;
}
/** Historical rows remain structural evidence under an authenticated backup.
 * Only the current active receipt is authenticated with the current secret. */
export function readNativeHandoffs(database: DatabaseSync, secret?: string, historical = false) {
  const activeSchema = database
    .prepare("SELECT type,sql FROM sqlite_schema WHERE name='_chargeos_native_handoff'")
    .get();
  const historySchema = database
    .prepare("SELECT type,sql FROM sqlite_schema WHERE name='_chargeos_native_handoff_history'")
    .get();
  const history = new Map<string, string>();
  if (historySchema) {
    if (historySchema.type !== "table" || historySchema.sql !== NATIVE_HANDOFF_HISTORY_SQL)
      throw new Error("Invalid public handoff history schema");
    const rows = database
      .prepare("SELECT handoff_id,receipt_json FROM _chargeos_native_handoff_history")
      .all();
    if (rows.length > 1000) throw new Error("Public handoff history exceeds its boundary");
    for (const row of rows) {
      if (typeof row.handoff_id !== "string" || typeof row.receipt_json !== "string")
        throw new Error("Invalid public handoff history");
      const receipt = parseNativeHandoff(row.receipt_json, undefined, true);
      if (receipt.handoffId !== row.handoff_id)
        throw new Error("Public handoff history identity mismatch");
      history.set(row.handoff_id, row.receipt_json);
    }
  }
  let active: NativeHandoffReceipt | null = null,
    serialized: string | null = null;
  if (activeSchema) {
    if (activeSchema.type !== "table" || activeSchema.sql !== NATIVE_HANDOFF_SQL || !historySchema)
      throw new Error("Invalid active public handoff schema");
    const rows = database.prepare("SELECT id,receipt_json FROM _chargeos_native_handoff").all();
    if (rows.length !== 1 || rows[0]?.id !== 1 || typeof rows[0].receipt_json !== "string")
      throw new Error("Public handoff authority is incomplete");
    serialized = rows[0].receipt_json;
    active = parseNativeHandoff(serialized, secret, historical);
    const handoffId = active.handoffId;
    if (
      history.get(active.handoffId) !== serialized ||
      handoffHistoryDigest([...history].filter(([id]) => id !== handoffId)) !==
        active.priorHistorySha256
    )
      throw new Error("Public handoff history changed");
  }
  return { active, serialized, history, hasHistory: !!historySchema };
}
export function bindNativeHandoff(
  receipt: NativeHandoffReceipt,
  release: NativeReleaseReceipt,
  serializedRelease: string,
): void {
  if (
    release.schemaVersion !== 2 ||
    release.restoreId !== receipt.restoreId ||
    release.releaseId !== receipt.releaseId ||
    release.origin !== receipt.sourceOrigin ||
    release.reviewSha256 !== receipt.reviewSha256 ||
    release.enrollmentSha256 !== receipt.enrollmentSha256 ||
    handoffDigest(serializedRelease) !== receipt.releaseSha256 ||
    release.handoffHistorySha256 !== receipt.priorHistorySha256
  )
    throw new Error("Public handoff belongs to another reviewed release");
}
