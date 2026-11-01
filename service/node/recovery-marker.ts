import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { exactObject, canonicalRecoveryJson } from "./recovery-crypto.js";

export const NATIVE_RECOVERY_QUARANTINE_SQL =
  "CREATE TABLE _chargeos_native_recovery (id INTEGER PRIMARY KEY CHECK(id=1), provenance_json TEXT NOT NULL)";
export const NATIVE_RECOVERY_RELEASE_SQL =
  "CREATE TABLE _chargeos_native_release (id INTEGER PRIMARY KEY CHECK(id=1), receipt_json TEXT NOT NULL)";
export const NATIVE_RECOVERY_HISTORY_SQL =
  "CREATE TABLE _chargeos_native_release_history (release_id TEXT PRIMARY KEY NOT NULL, receipt_json TEXT NOT NULL)";
export interface NativeReleaseReceipt {
  format: "chargeos-native-recovery-release";
  schemaVersion: 1;
  releaseId: string;
  restoreId: string;
  enrollmentEpoch: string;
  releasedAt: string;
  origin: string;
  provenanceSha256: string;
  reviewSha256: string;
  enrollmentSha256: string;
  beforeBusinessSha256: string;
  afterBusinessSha256: string;
  decisionsSha256: string;
  priorHistorySha256: string;
  decisions: unknown[];
  organizations: number;
  selectedUsers: number;
  removedMemberships: number;
  operatorAttestation: string;
}
export const RECOVERY_RELEASE_CONFIRMATION =
  "I authorize reopening this reviewed replacement after retiring the previous service";
export const recoveryDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function recoveryHistoryDigest(records: [string, string][]): string {
  return recoveryDigest(
    JSON.stringify([...records].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}
function mac(secret: string, receipt: NativeReleaseReceipt): string {
  return createHmac("sha256", secret)
    .update("chargeos-native-recovery-release:1\0")
    .update(JSON.stringify(receipt))
    .digest("hex");
}
export function sealNativeRelease(receipt: NativeReleaseReceipt, secret: string): string {
  return JSON.stringify({ receipt, mac: mac(secret, receipt) });
}
function parseReceipt(
  serialized: string,
  secret?: string,
  historical = false,
): NativeReleaseReceipt {
  if (Buffer.byteLength(serialized) > 4 * 1024 * 1024)
    throw new Error("Recovery receipt exceeds its boundary");
  const value: unknown = JSON.parse(serialized);
  exactObject(value, ["receipt", "mac"]);
  const r = value.receipt;
  exactObject(r, [
    "format",
    "schemaVersion",
    "releaseId",
    "restoreId",
    "enrollmentEpoch",
    "releasedAt",
    "origin",
    "provenanceSha256",
    "reviewSha256",
    "enrollmentSha256",
    "beforeBusinessSha256",
    "afterBusinessSha256",
    "decisionsSha256",
    "priorHistorySha256",
    "decisions",
    "organizations",
    "selectedUsers",
    "removedMemberships",
    "operatorAttestation",
  ]);
  if (
    r.format !== "chargeos-native-recovery-release" ||
    r.schemaVersion !== 1 ||
    r.operatorAttestation !== RECOVERY_RELEASE_CONFIRMATION
  )
    throw new Error("Invalid recovery release receipt");
  for (const key of ["releaseId", "restoreId", "enrollmentEpoch", "origin", "releasedAt"])
    if (typeof r[key] !== "string" || !r[key].length || r[key].length > 4096)
      throw new Error("Invalid recovery release binding");
  if (
    !Number.isFinite(Date.parse(r.releasedAt as string)) ||
    new Date(r.releasedAt as string).toISOString() !== r.releasedAt
  )
    throw new Error("Invalid recovery release time");
  for (const key of [
    "provenanceSha256",
    "reviewSha256",
    "enrollmentSha256",
    "beforeBusinessSha256",
    "afterBusinessSha256",
    "decisionsSha256",
    "priorHistorySha256",
  ])
    if (typeof r[key] !== "string" || !/^[a-f0-9]{64}$/.test(r[key]))
      throw new Error("Invalid recovery release digest");
  for (const key of ["organizations", "selectedUsers", "removedMemberships"])
    if (
      typeof r[key] !== "number" ||
      !Number.isSafeInteger(r[key]) ||
      r[key] < 0 ||
      r[key] > 10000000
    )
      throw new Error("Invalid recovery release count");
  if (typeof value.mac !== "string" || !/^[a-f0-9]{64}$/.test(value.mac))
    throw new Error("Invalid recovery release authenticator");
  const receipt = r as unknown as NativeReleaseReceipt;
  if (
    !Array.isArray(r.decisions) ||
    r.decisions.length > 1000 ||
    r.decisions.length !== r.organizations ||
    recoveryDigest(JSON.stringify(r.decisions)) !== r.decisionsSha256
  )
    throw new Error("Invalid recovery release decisions");
  if (
    !historical &&
    (!secret ||
      !timingSafeEqual(Buffer.from(value.mac, "hex"), Buffer.from(mac(secret, receipt), "hex")))
  )
    throw new Error("Recovery release authentication failed");
  return receipt;
}

/** Historical inspection is only for an already authenticated backup snapshot;
 * it never authorizes a live listener or outbox without the current secret. */
export function nativeRecoveryState(
  database: DatabaseSync,
  secret?: string,
  historical = false,
): "ordinary" | "quarantined" | "released" {
  const q = database
      .prepare("SELECT type,sql FROM sqlite_schema WHERE name='_chargeos_native_recovery'")
      .get(),
    release = database
      .prepare("SELECT type,sql FROM sqlite_schema WHERE name='_chargeos_native_release'")
      .get();
  const historySchema = database
    .prepare("SELECT type,sql FROM sqlite_schema WHERE name='_chargeos_native_release_history'")
    .get();
  const history = new Map<string, string>();
  if (historySchema) {
    if (historySchema.type !== "table" || historySchema.sql !== NATIVE_RECOVERY_HISTORY_SQL)
      throw new Error("Invalid recovery history schema");
    const rows = database
      .prepare("SELECT release_id,receipt_json FROM _chargeos_native_release_history")
      .all();
    if (rows.length > 1000) throw new Error("Recovery history exceeds its boundary");
    for (const row of rows) {
      if (typeof row.release_id !== "string" || typeof row.receipt_json !== "string")
        throw new Error("Invalid recovery history");
      const receipt = parseReceipt(row.receipt_json, undefined, true);
      if (receipt.releaseId !== row.release_id)
        throw new Error("Invalid recovery history identity");
      history.set(row.release_id, row.receipt_json);
    }
  }
  if (!q && !release && !historySchema) return "ordinary";
  if (!q || q.type !== "table" || q.sql !== NATIVE_RECOVERY_QUARANTINE_SQL)
    throw new Error("Invalid recovery quarantine schema");
  if (!release) return "quarantined";
  if (release.type !== "table" || release.sql !== NATIVE_RECOVERY_RELEASE_SQL)
    throw new Error("Invalid recovery release schema");
  const roots = database.prepare("SELECT id,provenance_json FROM _chargeos_native_recovery").all(),
    receipts = database.prepare("SELECT id,receipt_json FROM _chargeos_native_release").all();
  if (
    roots.length !== 1 ||
    roots[0]?.id !== 1 ||
    typeof roots[0].provenance_json !== "string" ||
    roots[0].provenance_json.length > 8192 ||
    receipts.length !== 1 ||
    receipts[0]?.id !== 1 ||
    typeof receipts[0].receipt_json !== "string"
  )
    throw new Error("Recovery release provenance is unavailable");
  const root = JSON.parse(roots[0].provenance_json) as { restoreId?: unknown; status?: unknown };
  const receipt = parseReceipt(receipts[0].receipt_json, secret, historical);
  if (
    receipt.priorHistorySha256 !==
    recoveryHistoryDigest([...history].filter(([id]) => id !== receipt.releaseId))
  )
    throw new Error("Recovery release history changed");
  if (history.get(receipt.releaseId) !== receipts[0].receipt_json)
    throw new Error("Recovery release history is unavailable");
  if (
    root.status !== "quarantined" ||
    receipt.restoreId !== root.restoreId ||
    receipt.provenanceSha256 !== recoveryDigest(canonicalRecoveryJson(root))
  )
    throw new Error("Recovery receipt belongs to another restore");
  return "released";
}
