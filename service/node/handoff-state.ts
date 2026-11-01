import { createHash } from "node:crypto";
import type { NativeCommercialDatabase } from "./sqlite.js";
import { parseNativeHandoff } from "./handoff-marker.js";

/** Exact logical state with only this handoff's new authority excluded. Retired
 * source rows synthesize their still-authenticated original R from history so
 * post-fence retries can detect any change to source credentials/business. */
export async function handoffStateDigest(
  database: NativeCommercialDatabase,
  handoffId: string,
): Promise<string> {
  const schemas = (
    await database
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
      )
      .all<{ type: string; name: string; tbl_name: string; sql: string }>()
  ).results;
  let retiredRelease: string | undefined;
  if (schemas.some((s) => s.name === "_chargeos_native_handoff")) {
    const serialized = await database
      .prepare("SELECT receipt_json FROM _chargeos_native_handoff WHERE id=1")
      .first<string>("receipt_json");
    if (serialized) {
      const h = parseNativeHandoff(serialized, undefined, true);
      if (h.handoffId === handoffId && h.role === "source-retired")
        retiredRelease =
          (await database
            .prepare("SELECT receipt_json FROM _chargeos_native_release_history WHERE release_id=?")
            .bind(h.releaseId)
            .first<string>("receipt_json")) ?? undefined;
    }
  }
  const hash = createHash("sha256");
  for (const row of schemas) {
    if (row.name === "_chargeos_native_handoff") continue;
    let records: unknown[][] | undefined;
    if (row.name === "_chargeos_native_handoff_history") {
      records = await database
        .prepare("SELECT * FROM _chargeos_native_handoff_history WHERE handoff_id != ?")
        .bind(handoffId)
        .raw();
      if (!records.length) continue;
    }
    hash.update(JSON.stringify(row));
    if (row.type === "table") {
      const name = row.name.replaceAll('"', '""');
      records ??= await database.prepare(`SELECT * FROM "${name}"`).raw();
      if (row.name === "_chargeos_native_release" && retiredRelease) {
        if (records.length) throw new Error("Retired source kept active release authority");
        records = [[1, retiredRelease]];
      }
      hash.update(JSON.stringify(records.map((record) => JSON.stringify(record)).sort()));
    }
  }
  return hash.digest("hex");
}
