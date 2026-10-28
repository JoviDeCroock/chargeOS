import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";

import type {
  DeclaredAmountComparison,
  ObservationCsv,
  ObservationPolicyInput,
  ObservationSource,
  ReimbursementObservation,
  SessionColumnMapping,
} from "../../shared/contracts.js";
import {
  calculateReimbursementObservation,
  compareDeclaredAmount,
  fingerprintObservationSource,
  mapObservationSessions,
  OBSERVATION_MAX_BYTES,
  ObservationInputError,
  parseObservationCsv,
} from "../../shared/observation-engine.js";
import { energy, euro } from "../product/data.js";
import "../product/style.css";
import "./style.css";

const emptyMapping: SessionColumnMapping = {
  sessionId: "",
  stationId: "",
  startedAt: "",
  endedAt: "",
  energy: "",
  driverAlias: null,
  energyUnit: "kWh",
  decimalSeparator: ".",
};
const initialPolicy: ObservationPolicyInput = {
  policyId: "local-observation",
  version: "v1",
  driverAlias: "",
  stationId: "",
  effectiveFrom: "2026-10-01T00:00:00+02:00",
  effectiveUntil: "2026-11-01T00:00:00+01:00",
  rateEurPerKwh: "",
};
const examplePolicy: ObservationPolicyInput = {
  ...initialPolicy,
  driverAlias: "employee-demo-1",
  stationId: "DEMO-HOME-01",
  rateEurPerKwh: "0.3222",
};
const example = [
  "session_id,station_id,driver_alias,started_at,ended_at,energy_kwh",
  "demo-1,DEMO-HOME-01,employee-demo-1,2026-10-26T19:00:00+01:00,2026-10-26T23:00:00+01:00,34.600",
  "demo-2,DEMO-HOME-01,employee-demo-1,2026-10-27T19:00:00+01:00,2026-10-27T23:00:00+01:00,45.800",
  "demo-3,DEMO-HOME-01,employee-demo-1,2026-10-28T07:00:00+01:00,2026-10-28T11:00:00+01:00,31.200",
  "demo-1,DEMO-HOME-01,employee-demo-1,2026-10-26T19:00:00+01:00,2026-10-26T23:00:00+01:00,34.600",
  "demo-review,DEMO-HOME-01,employee-demo-1,2026-10-31T23:40:00+01:00,2026-11-01T00:15:00+01:00,3.100",
].join("\n");

export function ObservationWorkspace() {
  const csv = useSignal<ObservationCsv | null>(null);
  const source = useSignal<ObservationSource | null>(null);
  const mapping = useSignal<SessionColumnMapping>(emptyMapping);
  const policy = useSignal<ObservationPolicyInput>(initialPolicy);
  const declaredDriver = useSignal("");
  const result = useSignal<ReimbursementObservation | null>(null);
  const comparison = useSignal<DeclaredAmountComparison | null>(null);
  const reported = useSignal("");
  const error = useSignal("");
  const busy = useSignal(false);
  const sourceKind = useSignal<"example" | "local" | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  function invalidate() {
    result.value = null;
    comparison.value = null;
    error.value = "";
  }
  async function load(bytes: Uint8Array, kind: "example" | "local", run = ++generation.current) {
    if (run !== generation.current) return;
    invalidate();
    csv.value = null;
    source.value = null;
    sourceKind.value = null;
    busy.value = true;
    try {
      if (bytes.byteLength > OBSERVATION_MAX_BYTES)
        throw new ObservationInputError("Choose a CSV no larger than 4 MiB.");
      const sha256 = await fingerprintObservationSource(bytes);
      const parsed = parseObservationCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (run !== generation.current) return;
      const column = (name: string) =>
        parsed.headers.find((heading) => heading.toLowerCase() === name) ?? "";
      csv.value = parsed;
      source.value = {
        sha256,
        format: "csv",
        label: kind === "example" ? "Fictional example CSV" : "Owner-supplied local CSV",
      };
      sourceKind.value = kind;
      mapping.value = {
        sessionId: column("session_id"),
        stationId: column("station_id"),
        startedAt: column("started_at"),
        endedAt: column("ended_at"),
        energy: column("energy_kwh") || column("energy_wh"),
        driverAlias: column("driver_alias") || null,
        energyUnit: column("energy_kwh") ? "kWh" : column("energy_wh") ? "Wh" : "kWh",
        decimalSeparator: ".",
      };
      policy.value = kind === "example" ? examplePolicy : { ...initialPolicy };
      declaredDriver.value = "";
      reported.value = "";
    } catch (cause) {
      if (run !== generation.current) return;
      error.value =
        cause instanceof ObservationInputError
          ? cause.message
          : "The file could not be read as a supported UTF-8 CSV.";
    } finally {
      if (run === generation.current) busy.value = false;
    }
  }
  function calculate() {
    invalidate();
    try {
      if (!csv.value || !source.value)
        throw new ObservationInputError("Choose a session CSV first.");
      const imported = mapObservationSessions(
        csv.value,
        mapping.value,
        source.value,
        declaredDriver.value,
      );
      result.value = calculateReimbursementObservation([imported], policy.value);
    } catch (cause) {
      error.value =
        cause instanceof ObservationInputError
          ? cause.message
          : "This source could not be analyzed. Check the mapping and explicit policy inputs.";
    }
  }
  const current = result.value;
  const mappingFields = [
    ["sessionId", "Session identifier"],
    ["stationId", "Station identifier"],
    ["startedAt", "Session start"],
    ["endedAt", "Session end"],
    ["energy", "Energy value"],
  ] as const;
  const policyFields = [
    ["policyId", "Policy identifier"],
    ["version", "Policy version"],
    ["driverAlias", "Eligible employee alias"],
    ["stationId", "Assigned station identifier"],
    ["effectiveFrom", "Effective from (inclusive)"],
    ["effectiveUntil", "Effective until (exclusive)"],
    ["rateEurPerKwh", "Declared rate · EUR / kWh"],
  ] as const;
  return (
    <div class="product-shell observation-shell">
      <div class="pv-preview-bar">
        <span>
          <span class="pv-preview-dot" />
          Local observation · draft analysis
        </span>
        <span>Files stay in this browser. No upload, charger control or payments.</span>
        <a href="/preview">Product preview ↗</a>
      </div>
      <header class="obs-header">
        <a class="pv-brand" href="/preview">
          <span class="pv-brand-symbol" aria-hidden="true">
            ϟ
          </span>
          chargeOS
        </a>
        <a href="/">Owner console ↗</a>
      </header>
      <main class="obs-main">
        <div class="pv-page-heading">
          <div>
            <p class="pv-eyebrow">OBSERVE WITHOUT SWITCHING</p>
            <h1>Start with the records.</h1>
            <p>
              Reconstruct an expected home reimbursement using your own session export and an
              explicit policy.
            </p>
          </div>
          <button
            class="pv-button secondary"
            type="button"
            onClick={() => {
              generation.current++;
              csv.value = null;
              source.value = null;
              sourceKind.value = null;
              mapping.value = emptyMapping;
              policy.value = initialPolicy;
              declaredDriver.value = "";
              reported.value = "";
              busy.value = false;
              invalidate();
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            Clear local analysis
          </button>
        </div>
        <div class="pv-note">
          <b>Your current management connection stays as it is.</b>
          <span>
            This tool processes exports in memory. It does not connect to ThreeForce or your
            charger, approve a policy, issue an invoice or verify a bank settlement. Keep the
            original source export separately.
          </span>
        </div>
        {error.value && (
          <div class="obs-error" role="alert">
            <strong>Check this input</strong>
            <p>{error.value}</p>
          </div>
        )}
        <div class="obs-setup-grid">
          <section class="pv-panel">
            <div class="pv-section-title">
              <div>
                <p class="pv-overline">01 · SOURCE EVIDENCE</p>
                <h2>Choose a local CSV.</h2>
              </div>
              {sourceKind.value && (
                <span class="pv-badge neutral">
                  {sourceKind.value === "example" ? "Fictional example" : "Your local export"}
                </span>
              )}
            </div>
            <label class="obs-upload">
              Session CSV
              <input
                ref={fileInput}
                aria-label="Session CSV"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  const selectedRun = ++generation.current;
                  invalidate();
                  csv.value = null;
                  source.value = null;
                  sourceKind.value = null;
                  if (file.size > OBSERVATION_MAX_BYTES) {
                    busy.value = false;
                    error.value = "Choose a CSV no larger than 4 MiB.";
                    return;
                  }
                  busy.value = true;
                  void file
                    .arrayBuffer()
                    .then((bytes) => load(new Uint8Array(bytes), "local", selectedRun))
                    .catch(() => {
                      if (selectedRun !== generation.current) return;
                      busy.value = false;
                      error.value = "The local file could not be read.";
                    });
                }}
              />
              <span>UTF-8 · comma or semicolon · up to 4 MiB / 20,000 records</span>
            </label>
            <button
              class="pv-button secondary"
              type="button"
              disabled={busy.value}
              onClick={() => {
                void load(new TextEncoder().encode(example), "example");
              }}
            >
              Load fictional example
            </button>
            {busy.value && (
              <p role="status" class="pv-fine">
                Reading and fingerprinting local source…
              </p>
            )}
            {csv.value && source.value && (
              <>
                <div class="obs-source">
                  <strong>
                    {csv.value.rows.length} source records · {csv.value.headers.length} columns
                  </strong>
                  <small>Original-file SHA-256</small>
                  <code>{source.value.sha256}</code>
                  <p>
                    Record numbers count CSV records, including blank records; quoted line breaks
                    remain within one record.
                  </p>
                </div>
                <div class="obs-mapping">
                  {mappingFields.map(([key, label]) => (
                    <label class="pv-field" key={key}>
                      {label}
                      <select
                        aria-label={label}
                        value={mapping.value[key]}
                        onChange={(event) => {
                          mapping.value = { ...mapping.value, [key]: event.currentTarget.value };
                          invalidate();
                        }}
                      >
                        <option value="">Choose a column</option>
                        {csv.value!.headers.map((heading) => (
                          <option key={heading} value={heading}>
                            {heading}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label class="pv-field">
                    Energy unit
                    <select
                      aria-label="Energy unit"
                      value={mapping.value.energyUnit}
                      onChange={(event) => {
                        mapping.value = {
                          ...mapping.value,
                          energyUnit: event.currentTarget.value as "kWh" | "Wh",
                        };
                        invalidate();
                      }}
                    >
                      <option>kWh</option>
                      <option>Wh</option>
                    </select>
                  </label>
                  <label class="pv-field">
                    CSV decimal separator
                    <select
                      aria-label="CSV decimal separator"
                      value={mapping.value.decimalSeparator}
                      onChange={(event) => {
                        mapping.value = {
                          ...mapping.value,
                          decimalSeparator: event.currentTarget.value as "." | ",",
                        };
                        invalidate();
                      }}
                    >
                      <option value=".">Dot · 34.600</option>
                      <option value=",">Comma · 34,600</option>
                    </select>
                  </label>
                  <label class="pv-field">
                    Employee alias source
                    <select
                      aria-label="Employee alias source"
                      value={mapping.value.driverAlias ?? ""}
                      onChange={(event) => {
                        mapping.value = {
                          ...mapping.value,
                          driverAlias: event.currentTarget.value || null,
                        };
                        invalidate();
                      }}
                    >
                      <option value="">Declare one alias for this import</option>
                      {csv.value.headers
                        .filter((h) => !/card|rfid|tag|token|badge|pasnummer/i.test(h))
                        .map((heading) => (
                          <option key={heading} value={heading}>
                            {heading}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!mapping.value.driverAlias && (
                    <label class="pv-field">
                      Alias assigned to every imported record
                      <input
                        value={declaredDriver.value}
                        onInput={(event) => {
                          declaredDriver.value = event.currentTarget.value;
                          invalidate();
                        }}
                        placeholder="employee-001 · never a raw card ID"
                      />
                    </label>
                  )}
                </div>
                <p class="pv-fine">
                  Map non-secret identifiers. Unselected columns, including raw card/token fields,
                  are never copied into the analysis export. Timestamps require seconds and an
                  explicit UTC offset; local times are not guessed.
                </p>
              </>
            )}
          </section>
          <section class="pv-panel">
            <div class="pv-section-title">
              <div>
                <p class="pv-overline">02 · EXPLICIT ASSUMPTIONS</p>
                <h2>Use the agreed policy.</h2>
              </div>
            </div>
            <p class="obs-intro">
              Enter the actual policy inputs you want to check. These declarations are not employer
              approval. Use a dot for rate decimals. No regional or tax rate is automatically
              assumed.
            </p>
            <div class="obs-policy-fields">
              {policyFields.map(([key, label]) => (
                <label class="pv-field" key={key}>
                  {label}
                  <input
                    aria-label={label}
                    value={policy.value[key]}
                    placeholder={
                      key === "rateEurPerKwh"
                        ? "Enter the actual agreed rate · use a dot"
                        : key === "driverAlias"
                          ? "employee-001"
                          : key === "stationId"
                            ? "Your normalized station identifier"
                            : undefined
                    }
                    onInput={(event) => {
                      policy.value = { ...policy.value, [key]: event.currentTarget.value };
                      invalidate();
                    }}
                  />
                </label>
              ))}
            </div>
            <p class="pv-fine">
              EUR amounts use exact integer arithmetic and half-up rounding to cents per session.
              Sessions crossing policy boundaries, conflicting identities and invalid records stay
              outside the included total.
            </p>
            <button
              class="pv-button primary"
              type="button"
              disabled={!csv.value || busy.value}
              onClick={calculate}
            >
              Calculate local draft ↗
            </button>
          </section>
        </div>
        {current && (
          <section aria-label="Observation results">
            <div class="pv-stats">
              <section class="pv-metric">
                <p>Expected amount · unapproved draft</p>
                <strong>{euro(current.expectedAmountCents)}</strong>
                <small>{energy(current.includedEnergyWh)} included</small>
              </section>
              <section class="pv-metric">
                <p>Included / repeated records</p>
                <strong>
                  {current.counts.included} / {current.counts.duplicate}
                </strong>
                <small>Repeated records never add money</small>
              </section>
              <section class="pv-metric">
                <p>Held / invalid / excluded</p>
                <strong>
                  {current.counts.held} / {current.issues.length} / {current.counts.excluded}
                </strong>
                <small>Not silently included in the total</small>
              </section>
            </div>
            <div class="pv-panel">
              <div class="pv-section-title">
                <div>
                  <p class="pv-overline">03 · REPRODUCIBLE DECISIONS</p>
                  <h2>Follow every record to the result.</h2>
                </div>
                <button
                  type="button"
                  class="pv-button secondary"
                  onClick={() => downloadObservation(current, comparison.value)}
                >
                  Download draft evidence JSON ↓
                </button>
              </div>
              <div class="pv-table-wrap">
                <table class="pv-table obs-decisions">
                  <thead>
                    <tr>
                      <th>Record / session</th>
                      <th>Energy</th>
                      <th>Decision</th>
                      <th>Draft amount</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.decisions.map((decision, index) => (
                      <tr
                        key={`${decision.session.sourceSha256}:${decision.session.sourceRecord}:${index}`}
                      >
                        <td>
                          <div>
                            <strong>{decision.session.sessionId}</strong>
                            <small>Source record {decision.session.sourceRecord}</small>
                          </div>
                        </td>
                        <td>{energy(decision.session.energyWh)}</td>
                        <td>
                          <span
                            class={`pv-badge ${decision.status === "included" ? "green" : decision.status === "held" ? "amber" : "neutral"}`}
                          >
                            {decision.status}
                          </span>
                        </td>
                        <td>{euro(decision.amountCents)}</td>
                        <td>{decision.reason}</td>
                      </tr>
                    ))}
                    {current.issues.map((issue, index) => (
                      <tr key={`issue:${index}`}>
                        <td>Source record {issue.sourceRecord}</td>
                        <td>—</td>
                        <td>
                          <span class="pv-badge amber">invalid</span>
                        </td>
                        <td>Not included</td>
                        <td>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p class="pv-fine">
                Source hash and normalized decision inputs are included in the draft export. A hash
                links back to source bytes; it does not establish the source’s truth, approval,
                completeness or independent authenticity.
              </p>
            </div>
            <div class="pv-panel obs-comparison">
              <div>
                <p class="pv-overline">04 · OPTIONAL AMOUNT CHECK</p>
                <h2>Compare a declared statement amount.</h2>
                <p>
                  Use a dot for amount decimals. This checks arithmetic against a number you enter.
                  It does not authenticate a statement, inspect your bank or prove payment.
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  comparison.value = null;
                  error.value = "";
                  try {
                    comparison.value = compareDeclaredAmount(current, reported.value);
                  } catch (cause) {
                    error.value =
                      cause instanceof ObservationInputError
                        ? cause.message
                        : "The amount could not be compared.";
                  }
                }}
              >
                <label class="pv-field">
                  Reported total · EUR
                  <input
                    aria-label="Reported total · EUR"
                    inputMode="decimal"
                    value={reported.value}
                    placeholder="e.g. 35.96"
                    onInput={(event) => {
                      reported.value = event.currentTarget.value;
                      comparison.value = null;
                    }}
                  />
                </label>
                <button class="pv-button secondary" type="submit">
                  Compare declared amount
                </button>
              </form>
              {comparison.value && (
                <div
                  class={`obs-comparison-result ${comparison.value.differenceCents === 0 ? "match" : "difference"}`}
                  role="status"
                >
                  <strong>
                    {comparison.value.outcome === "difference-to-investigate"
                      ? "Difference to investigate"
                      : comparison.value.outcome === "matches-known-amount-with-unresolved-records"
                        ? "Known amount matches; unresolved records remain"
                        : "Matches the declared amount"}
                  </strong>
                  <p>
                    Expected minus reported: {euro(comparison.value.differenceCents)}. This is not
                    settlement confirmation.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
        <footer class="pv-footer">
          <span>chargeOS · Read-only local observation</span>
          <span>No original source file is changed. Reload clears this analysis.</span>
        </footer>
      </main>
    </div>
  );
}

function downloadObservation(
  result: ReimbursementObservation,
  comparison: DeclaredAmountComparison | null,
) {
  const file = {
    ...result,
    declaredAmountComparison: comparison,
    notice:
      "Unapproved local analysis. Not an invoice, employer approval, payment instruction or settlement proof.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2) + "\n"], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "chargeos-local-observation-draft.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
