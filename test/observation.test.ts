import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  calculateReimbursementObservation,
  compareDeclaredAmount,
  fingerprintObservationSource,
  mapObservationSessions,
  parseObservationCsv,
} from "../shared/observation-engine.js";
import type {
  ObservationImport,
  ObservationPolicyInput,
  SessionColumnMapping,
} from "../shared/observation.js";

const mapping: SessionColumnMapping = {
  sessionId: "session_id",
  stationId: "station_id",
  startedAt: "started_at",
  endedAt: "ended_at",
  energy: "energy_kwh",
  driverAlias: "driver_alias",
  energyUnit: "kWh",
  decimalSeparator: ".",
};
const policy: ObservationPolicyInput = {
  policyId: "employer-home",
  version: "v1",
  driverAlias: "employee-1",
  stationId: "HOME-1",
  effectiveFrom: "2026-10-01T00:00:00+02:00",
  effectiveUntil: "2026-11-01T00:00:00+01:00",
  rateEurPerKwh: "0.3222",
};
const header = "session_id,station_id,driver_alias,started_at,ended_at,energy_kwh";
const line = (
  id: string,
  kwh: string,
  start = "2026-10-28T08:00:00+01:00",
  end = "2026-10-28T12:00:00+01:00",
  driver = "employee-1",
) => `${id},HOME-1,${driver},${start},${end},${kwh}`;
function imported(lines: string[]): ObservationImport {
  const text = [header, ...lines].join("\n");
  return mapObservationSessions(
    parseObservationCsv(text),
    mapping,
    {
      format: "csv",
      label: "Test source",
      sha256: createHash("sha256").update(text).digest("hex"),
    },
    "",
  );
}

describe("read-only source import and reimbursement observation", () => {
  it("fingerprints the actual UTF-8 bytes and preserves source record provenance", async () => {
    const text = `${header}\r\n${line("a", "34.600")}`;
    const sha = await fingerprintObservationSource(new TextEncoder().encode(text));
    expect(sha).toBe(createHash("sha256").update(text).digest("hex"));
    const result = mapObservationSessions(
      parseObservationCsv(text),
      mapping,
      { format: "csv", label: "Local export", sha256: sha },
      "",
    );
    expect(result.sessions[0]).toMatchObject({
      energyWh: 34600,
      sourceRecord: 2,
      sourceSha256: sha,
      startedAt: "2026-10-28T07:00:00.000Z",
    });
  });

  it("handles quoted separators, escaped quotes, BOM and comma-decimal semicolon exports", () => {
    const text =
      '\uFEFFsession_id;station_id;driver_alias;started_at;ended_at;energy_kwh;note\r\na;HOME-1;employee-1;2026-10-28T08:00:00+01:00;2026-10-28T12:00:00+01:00;"34,600";"quote ""one"";\nsecond line"';
    const csv = parseObservationCsv(text);
    expect(csv.delimiter).toBe(";");
    expect(csv.rows[0]?.cells[6]).toBe('quote "one";\nsecond line');
    expect(
      mapObservationSessions(
        csv,
        { ...mapping, decimalSeparator: "," },
        { format: "csv", label: "Source", sha256: "a".repeat(64) },
        "",
      ).sessions[0]?.energyWh,
    ).toBe(34600);
    expect(
      mapObservationSessions(
        csv,
        mapping,
        { format: "csv", label: "Source", sha256: "a".repeat(64) },
        "",
      ).issues,
    ).toHaveLength(1);
  });

  it("rounds exact monetary arithmetic per session and compares without asserting settlement", () => {
    const result = calculateReimbursementObservation(
      [imported([line("a", "34.600"), line("b", "45.800"), line("c", "31.200")])],
      policy,
    );
    // Independently calculated: 11.14812 + 14.75796 + 10.05360, each rounded to cents.
    expect(result.decisions.map((item) => item.amountCents)).toEqual([1115, 1476, 1005]);
    expect(result.expectedAmountCents).toBe(3596);
    expect(result.includedEnergyWh).toBe(111600);
    expect(result.authority).toBe("unapproved-local-analysis");
    expect(compareDeclaredAmount(result, "35.95")).toMatchObject({
      differenceCents: 1,
      outcome: "difference-to-investigate",
      authority: "user-declared-amount-only",
    });
    expect(compareDeclaredAmount(result, "35,96", ",").outcome).toBe("matches-declared-amount");
    expect(() => compareDeclaredAmount(result, "35,96")).toThrow("decimal separator");
    const half = calculateReimbursementObservation([imported([line("tiny", "0.001")])], {
      ...policy,
      rateEurPerKwh: "5",
    });
    expect(half.expectedAmountCents).toBe(1);
  });

  it("does not pay duplicate records and holds every conflicting version across sources", () => {
    const a = imported([line("a", "34.6"), line("a", "34.6")]);
    expect(calculateReimbursementObservation([a], policy).counts).toEqual({
      included: 1,
      duplicate: 1,
      held: 0,
      excluded: 0,
    });
    const conflict = calculateReimbursementObservation([a, imported([line("a", "35.6")])], policy);
    expect(conflict.counts.held).toBe(3);
    expect(conflict.expectedAmountCents).toBe(0);
    expect(conflict.includedEnergyWh).toBe(0);
  });

  it("keeps foreign employees, policy crossings and zero energy out of the included amount", () => {
    const result = calculateReimbursementObservation(
      [
        imported([
          line("other", "20", undefined, undefined, "employee-2"),
          line("cross", "20", "2026-10-31T23:50:00+01:00", "2026-11-01T00:20:00+01:00"),
          line("before", "20", "2026-09-30T19:00:00+02:00", "2026-09-30T20:00:00+02:00"),
          line("zero", "0"),
        ]),
      ],
      policy,
    );
    expect(result.counts).toEqual({ included: 0, duplicate: 0, held: 2, excluded: 2 });
    expect(result.expectedAmountCents).toBe(0);
  });

  it("quarantines malformed dates, ambiguous times, negative/grouped energy and row-size mismatches", () => {
    const result = imported([
      line("date", "20", "2026-02-30T08:00:00Z", "2026-03-01T09:00:00Z"),
      line("local", "20", "2026-10-28T08:00:00", "2026-10-28T09:00:00"),
      line("negative", "-2"),
      line("exponent", "2e3"),
      line("wrong", "2") + ",extra",
    ]);
    expect(result.sessions).toHaveLength(0);
    expect(result.issues.map((item) => item.sourceRecord)).toEqual([2, 3, 4, 5, 6]);
    expect(JSON.stringify(result.issues)).not.toContain("employee-1");
  });

  it("rejects ambiguous headers, broken CSV, overlapping mappings and raw-card alias columns", () => {
    expect(() => parseObservationCsv("id,ID\na,b")).toThrow("unique");
    expect(() => parseObservationCsv('id,x\n"unterminated')).toThrow("unterminated");
    expect(() => parseObservationCsv('id,x\n"a"garbage,b')).toThrow("Unexpected");
    const csv = parseObservationCsv(`${header}\n${line("a", "2")}`);
    expect(() =>
      mapObservationSessions(
        csv,
        { ...mapping, energy: "session_id" },
        { format: "csv", label: "Source", sha256: "a".repeat(64) },
        "",
      ),
    ).toThrow("different");
    expect(() =>
      mapObservationSessions(
        csv,
        { ...mapping, driverAlias: "rfid_card" },
        { format: "csv", label: "Source", sha256: "a".repeat(64) },
        "",
      ),
    ).toThrow("non-secret employee alias");
  });

  it("handles offset changes explicitly and refuses arithmetic outside the exact range", () => {
    const row = imported([
      line("dst", "1", "2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00"),
    ]);
    expect(row.sessions[0]?.endedAt).toBe("2026-10-25T01:30:00.000Z");
    expect(calculateReimbursementObservation([row], policy).counts.included).toBe(1);
    expect(() =>
      calculateReimbursementObservation([row], { ...policy, rateEurPerKwh: "0.3222001" }),
    ).toThrow("6 fractional");
    expect(imported([line("huge", "99999999999999999")]).issues).toHaveLength(1);
    expect(() =>
      calculateReimbursementObservation([row], { ...policy, effectiveUntil: policy.effectiveFrom }),
    ).toThrow("after");
  });

  it("preserves blank-record positions and omits unselected raw-card data from draft exports", () => {
    const text = `${header},card_id\n\n${line("a", "2")},BE-PRIVATE-CARD-123`;
    const csv = parseObservationCsv(text);
    const importedSource = mapObservationSessions(
      csv,
      mapping,
      {
        format: "csv",
        label: "Local source",
        sha256: createHash("sha256").update(text).digest("hex"),
      },
      "",
    );
    expect(importedSource.sessions[0]?.sourceRecord).toBe(3);
    const result = calculateReimbursementObservation([importedSource], policy);
    expect(result.sourceMappings[0]?.mapping.decimalSeparator).toBe(".");
    expect(JSON.stringify(result)).not.toContain("BE-PRIVATE-CARD-123");
    const forged = {
      ...importedSource,
      sessions: importedSource.sessions.map((session) => ({
        ...session,
        sourceSha256: "b".repeat(64),
      })),
    };
    expect(() => calculateReimbursementObservation([forged], policy)).toThrow("does not match");
  });

  it("bounds hostile imports and never represents an incomplete zero total as a clean match", async () => {
    await expect(fingerprintObservationSource(new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toThrow(
      "4 MiB",
    );
    expect(() =>
      parseObservationCsv(Array.from({ length: 129 }, (_, index) => `c${index}`).join(",") + "\nx"),
    ).toThrow("128 columns");
    expect(() => parseObservationCsv("id\n" + "a\n".repeat(20_001))).toThrow("20,000");
    const result = calculateReimbursementObservation([imported([line("invalid", "-2")])], policy);
    expect(compareDeclaredAmount(result, "0").outcome).toBe(
      "matches-known-amount-with-unresolved-records",
    );
  });
});
