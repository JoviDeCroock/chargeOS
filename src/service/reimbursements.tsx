import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type {
  CreateReimbursementAssignment,
  CreateReimbursementPolicy,
  CreateReimbursementStatement,
  ReimbursementStatement,
  ReimbursementWorkspaceData,
  ServiceOrganization,
  SessionColumnMapping,
  ReimbursementCorrectionReason,
} from "../../shared/contracts.js";
import { ApprovedBalances, ReimbursementJournal } from "./reimbursement-journal.js";
import {
  CancellationRequestForm,
  CorrectionComparison,
  CorrectionDraftFields,
} from "./reimbursement-corrections.js";
import { formatEuroCents } from "../../shared/currency.js";
import { parseObservationCsv } from "../../shared/observation-engine.js";
import { ServiceRequestError, serviceRequest } from "./client.js";
import "./reimbursements.css";

interface Props {
  organization: ServiceOrganization;
  actorId: string;
  mfaEnabled: boolean;
  onSessionExpired: () => void;
}
const value = (form: FormData, key: string) => String(form.get(key) ?? "");
const displayDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-BE", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const statusText = (
  statement: ReimbursementStatement | ReimbursementWorkspaceData["statements"][number],
) =>
  statement.supersededBy
    ? "Replaced · unpaid"
    : statement.status === "approved"
      ? statement.correctionMode === "void"
        ? "Cancelled · unpaid"
        : "Approved · unpaid"
      : statement.status === "rejected"
        ? "Rejected"
        : statement.eligibilityChanged
          ? "Eligibility changed"
          : statement.heldRecords || statement.invalidRecords
            ? "On hold"
            : statement.energyWh === 0 && statement.correctionMode !== "void"
              ? "No eligible sessions"
              : statement.correctionOf
                ? "Correction awaiting review"
                : "Ready for review";

export function ReimbursementWorkspace({
  organization: org,
  actorId,
  mfaEnabled,
  onSessionExpired,
}: Props) {
  const root = `/service/api/v1/organizations/${org.id}/money`;
  const data = useSignal<ReimbursementWorkspaceData | null>(null);
  const tab = useSignal<"statements" | "assignments" | "policies" | "journal">("statements");
  const busy = useSignal(true),
    message = useSignal(""),
    error = useSignal("");
  const detail = useSignal<ReimbursementStatement | null>(null);
  const assignmentId = useSignal("");
  const correctionOfId = useSignal("");
  const fileData = useSignal<{
    base64: string;
    headers: readonly string[];
    records: number;
  } | null>(null);
  const selectedMapping = useSignal<SessionColumnMapping | null>(null);
  const generation = useSignal(0);
  const linePage = useSignal(0);
  const finance = org.role === "admin" || org.role === "finance";
  async function refresh() {
    data.value = await serviceRequest<ReimbursementWorkspaceData>(root);
  }
  async function action(work: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
      await work();
    } catch (problem) {
      if (problem instanceof ServiceRequestError && problem.status === 401) onSessionExpired();
      if (problem instanceof ServiceRequestError && problem.status === 404) {
        data.value = null;
        detail.value = null;
      }
      error.value = problem instanceof Error ? problem.message : "Please try again.";
    } finally {
      busy.value = false;
    }
  }
  useEffect(() => {
    let active = true;
    void serviceRequest<ReimbursementWorkspaceData>(root)
      .then((result) => {
        if (active) data.value = result;
      })
      .catch((problem: unknown) => {
        if (problem instanceof ServiceRequestError && problem.status === 401) onSessionExpired();
        if (active)
          error.value =
            problem instanceof Error ? problem.message : "Reimbursements are unavailable.";
      })
      .finally(() => {
        if (active) busy.value = false;
      });
    return () => {
      active = false;
      generation.value++;
      fileData.value = null;
      detail.value = null;
    };
  }, [org.id]);
  async function chooseFile(file: File | undefined) {
    const revision = ++generation.value;
    fileData.value = null;
    selectedMapping.value = null;
    error.value = "";
    if (!file) return;
    try {
      if (!file.size || file.size > 262144)
        throw new Error("Choose a non-empty CSV no larger than 256 KiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const csv = parseObservationCsv(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      );
      if (csv.rows.length > 500)
        throw new Error("A statement supports at most 500 source records.");
      if (revision !== generation.value) return;
      const column = (heading: string) => (csv.headers.includes(heading) ? heading : "");
      selectedMapping.value = {
        sessionId: column("session_id"),
        stationId: column("station_id"),
        driverAlias: column("driver_alias") || null,
        startedAt: column("started_at"),
        endedAt: column("ended_at"),
        energy: column("energy_kwh") || column("energy_wh"),
        energyUnit: csv.headers.includes("energy_kwh") ? "kWh" : "Wh",
        decimalSeparator: ".",
      };
      fileData.value = {
        base64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
        headers: csv.headers,
        records: csv.rows.length,
      };
    } catch (problem) {
      if (revision === generation.value)
        error.value = problem instanceof Error ? problem.message : "Could not read the CSV.";
    }
  }
  async function openStatement(id: string) {
    detail.value = await serviceRequest<ReimbursementStatement>(`${root}/statements/${id}`);
    linePage.value = 0;
  }
  async function review(kind: "approve" | "reject", form: HTMLFormElement) {
    if (!detail.value) return;
    const values = new FormData(form),
      current = detail.value;
    detail.value = await serviceRequest<ReimbursementStatement>(
      `${root}/statements/${current.id}/${kind}`,
      {
        snapshotSha256: current.snapshotSha256,
        ...(current.snapshot.correction
          ? { previousSnapshotSha256: current.snapshot.correction.previousSnapshotSha256 }
          : {}),
        ...(kind === "approve" ? { authenticatorCode: value(values, "authenticatorCode") } : {}),
        ...(kind === "reject" ? { reason: value(values, "reason") } : {}),
      },
    );
    await refresh();
    message.value =
      kind === "approve"
        ? current.snapshot.correction
          ? "Adjustment applied. The original statement is retained and no payment has been instructed."
          : "Statement approved. No payment has been instructed."
        : "Statement rejected. Its snapshot is retained; create a linked revision after resolving the issue.";
  }
  function downloadStatement() {
    if (!detail.value) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(detail.value, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chargeos-statement-${detail.value.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const current = data.value,
    selected = detail.value;
  const pickedAssignment = current?.assignments.find((item) => item.id === assignmentId.value);
  const pickedPolicy = current?.policies.find(
    (item) => item.id === pickedAssignment?.policyVersionId,
  );
  return (
    <section class="cs-card cs-money" aria-label="Reimbursements">
      <div class="cs-section-heading">
        <div>
          <p class="cs-eyebrow">{finance ? "Finance workspace" : "Your business charging"}</p>
          <h2>Reimbursements</h2>
        </div>
        <span class="cs-tag">Local review · EUR</span>
      </div>
      <p class="cs-muted">
        Approval records a finance decision. Payment instructions and bank settlement are still
        being built.
      </p>
      <nav class="cs-money-tabs" aria-label="Reimbursement views">
        {(["statements", "assignments", "policies", "journal"] as const).map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={tab.value === item}
            onClick={() => {
              if (tab.value === "statements" && item !== "statements") {
                generation.value++;
                fileData.value = null;
                selectedMapping.value = null;
                correctionOfId.value = "";
                assignmentId.value = "";
              }
              tab.value = item;
            }}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {busy.value && <p role="status">Loading reimbursement records…</p>}
      {message.value && (
        <div class="cs-message" role="status">
          {message.value}
        </div>
      )}
      {error.value && (
        <div class="cs-message cs-error" role="alert">
          {error.value}
        </div>
      )}
      {current && (
        <>
          {tab.value === "journal" && (
            <ReimbursementJournal
              data={current}
              busy={busy.value}
              onOpen={(id) => void action(() => openStatement(id))}
            />
          )}
          {tab.value === "policies" && (
            <div>
              <h3>Published policy versions</h3>
              <p class="cs-muted">
                Each version fixes an agreed rate, currency, rounding rule and effective period.
                Existing statements keep their original version.
              </p>
              <ul class="cs-money-records">
                {current.policies.map((policy) => (
                  <li key={policy.id}>
                    <div>
                      <strong>
                        {policy.name} · v{policy.version}
                      </strong>
                      <p>
                        {policy.rateEurPerKwh} EUR/kWh · {displayDate(policy.effectiveFrom)} –{" "}
                        {displayDate(policy.effectiveUntil)} UTC
                      </p>
                      <small>{policy.key} · half-up per session to cents</small>
                    </div>
                  </li>
                ))}
              </ul>
              {!current.policies.length && <p>No policy versions have been published.</p>}
              {finance && (
                <details class="cs-money-form">
                  <summary>Publish a policy version</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget,
                        values = new FormData(form);
                      const body: CreateReimbursementPolicy = {
                        key: value(values, "key"),
                        version: value(values, "version"),
                        name: value(values, "name"),
                        effectiveFrom: value(values, "effectiveFrom"),
                        effectiveUntil: value(values, "effectiveUntil"),
                        rateEurPerKwh: value(values, "rateEurPerKwh"),
                      };
                      void action(async () => {
                        await serviceRequest(`${root}/policies`, body);
                        form.reset();
                        await refresh();
                        message.value =
                          "Policy version published. Its rate and dates are immutable.";
                      });
                    }}
                  >
                    <div class="cs-money-fields">
                      <label>
                        Policy key
                        <input name="key" required maxLength={96} placeholder="home-energy" />
                      </label>
                      <label>
                        Version
                        <input name="version" required maxLength={96} placeholder="1" />
                      </label>
                      <label>
                        Policy name
                        <input name="name" required maxLength={120} />
                      </label>
                      <label>
                        Agreed EUR per kWh
                        <input
                          name="rateEurPerKwh"
                          required
                          inputMode="decimal"
                          placeholder="Enter the agreed rate"
                        />
                      </label>
                      <label>
                        Policy starts · ISO with zone
                        <input name="effectiveFrom" required placeholder="2026-09-01T00:00:00Z" />
                      </label>
                      <label>
                        Policy ends · ISO with zone
                        <input name="effectiveUntil" required placeholder="2026-10-01T00:00:00Z" />
                      </label>
                    </div>
                    <p class="cs-muted">
                      Use the explicitly agreed rate. No statutory or regional rate is supplied by
                      chargeOS.
                    </p>
                    <button type="submit" class="cs-primary" disabled={busy.value}>
                      Publish policy version
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
          {tab.value === "assignments" && (
            <div>
              <h3>Dated employee assignments</h3>
              <p class="cs-muted">
                Station, vehicle and card aliases are business references. They grant no access to a
                physical charger.
              </p>
              <ul class="cs-money-records">
                {current.assignments.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.employeeName} · {item.stationAlias}
                      </strong>
                      <p>
                        {item.driverAlias} · {item.vehicleAlias} · {item.cardAlias} ·{" "}
                        {item.costCenter}
                      </p>
                      <p>
                        {displayDate(item.effectiveFrom)} – {displayDate(item.effectiveUntil)} UTC ·{" "}
                        {item.ended ? "End recorded" : "Recorded eligibility period"}
                      </p>
                      <small>
                        Policy {current.policies.find((p) => p.id === item.policyVersionId)?.key} ·
                        v{current.policies.find((p) => p.id === item.policyVersionId)?.version}
                      </small>
                      {org.role === "admin" && !item.ended && (
                        <details class="cs-money-form">
                          <summary>End this assignment</summary>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const values = new FormData(event.currentTarget);
                              void action(async () => {
                                await serviceRequest(`${root}/assignments/${item.id}/end`, {
                                  effectiveUntil: value(values, "effectiveUntil"),
                                });
                                await refresh();
                                if (detail.value) await openStatement(detail.value.id);
                                message.value =
                                  "Assignment ended. Existing snapshots are retained and changed eligibility is flagged.";
                              });
                            }}
                          >
                            <label>
                              Eligibility ends · ISO with zone
                              <input
                                name="effectiveUntil"
                                required
                                placeholder="2026-10-28T00:00:00Z"
                              />
                            </label>
                            <button type="submit" disabled={busy.value}>
                              End assignment
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {!current.assignments.length && <p>No employee assignments have been recorded.</p>}
              {org.role === "admin" && (
                <details class="cs-money-form">
                  <summary>Add an employee assignment</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget,
                        values = new FormData(form);
                      const body: CreateReimbursementAssignment = {
                        employeeId: value(values, "employeeId"),
                        driverAlias: value(values, "driverAlias"),
                        stationAlias: value(values, "stationAlias"),
                        vehicleAlias: value(values, "vehicleAlias"),
                        cardAlias: value(values, "cardAlias"),
                        costCenter: value(values, "costCenter"),
                        policyVersionId: value(values, "policyVersionId"),
                        effectiveFrom: value(values, "effectiveFrom"),
                        effectiveUntil: value(values, "effectiveUntil"),
                      };
                      void action(async () => {
                        await serviceRequest(`${root}/assignments`, body);
                        form.reset();
                        await refresh();
                        message.value = "Employee assignment recorded.";
                      });
                    }}
                  >
                    <div class="cs-money-fields">
                      <label>
                        Employee
                        <select name="employeeId" required aria-label="Employee">
                          <option value="">Choose a member</option>
                          {current.employees.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Policy version
                        <select name="policyVersionId" required aria-label="Policy version">
                          <option value="">Choose a published version</option>
                          {current.policies.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · v{item.version} · {item.rateEurPerKwh} EUR/kWh
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Employee alias
                        <input
                          name="driverAlias"
                          required
                          maxLength={96}
                          placeholder="employee-001"
                        />
                      </label>
                      <label>
                        Station alias
                        <input name="stationAlias" required maxLength={96} placeholder="HOME-001" />
                      </label>
                      <label>
                        Vehicle alias
                        <input
                          name="vehicleAlias"
                          required
                          maxLength={96}
                          placeholder="vehicle-001"
                        />
                      </label>
                      <label>
                        Card alias · never raw RFID
                        <input
                          name="cardAlias"
                          required
                          maxLength={96}
                          pattern="card-.+"
                          placeholder="card-employee-001"
                        />
                      </label>
                      <label>
                        Cost center
                        <input name="costCenter" required maxLength={96} />
                      </label>
                      <label>
                        Eligibility starts · ISO with zone
                        <input name="effectiveFrom" required placeholder="2026-09-01T00:00:00Z" />
                      </label>
                      <label>
                        Eligibility ends · ISO with zone
                        <input name="effectiveUntil" required placeholder="2026-10-01T00:00:00Z" />
                      </label>
                    </div>
                    <button
                      class="cs-primary"
                      type="submit"
                      disabled={busy.value || !current.policies.length}
                    >
                      Record assignment
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
          {tab.value === "statements" && (
            <div>
              <h3>Statements</h3>
              <ApprovedBalances data={current} />
              <ul class="cs-money-records">
                {current.statements.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.employeeName}</strong>
                      <p>
                        {displayDate(item.periodFrom)} – {displayDate(item.periodUntil)} UTC
                      </p>
                      <span class="cs-tag">{statusText(item)}</span>
                      {item.eligibilityChanged &&
                        item.status === "approved" &&
                        !item.supersededBy && (
                          <p class="cs-money-warning">
                            Eligibility changed after approval. A correction review is required.
                          </p>
                        )}
                    </div>
                    <div class="cs-money-amount">
                      <strong>{formatEuroCents(item.amountCents)}</strong>
                      <button
                        type="button"
                        disabled={busy.value}
                        onClick={() => void action(() => openStatement(item.id))}
                      >
                        Review statement {item.id.slice(0, 8)}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {!current.statements.length && (
                <p>
                  No statements yet.{" "}
                  {finance
                    ? "Publish a policy, record an employee assignment, then calculate a draft from a selected export."
                    : "Your employer’s statements will appear here."}
                </p>
              )}
              {finance && (
                <details class="cs-money-form">
                  <summary>Create a statement draft</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = new FormData(event.currentTarget);
                      if (!fileData.value || !selectedMapping.value) {
                        error.value = "Choose and map a session CSV first.";
                        return;
                      }
                      const body: CreateReimbursementStatement = {
                        assignmentId: assignmentId.value,
                        periodFrom: value(values, "periodFrom"),
                        periodUntil: value(values, "periodUntil"),
                        csvBase64: fileData.value.base64,
                        mapping: selectedMapping.value,
                        revisionOf: value(values, "revisionOf") || null,
                        driverDeclarationConfirmed:
                          value(values, "driverDeclarationConfirmed") === "on",
                        correctionOf: correctionOfId.value || null,
                        correctionReason: correctionOfId.value
                          ? (value(values, "correctionReason") as ReimbursementCorrectionReason)
                          : null,
                        correctionPolicyVersionId: correctionOfId.value
                          ? value(values, "correctionPolicyVersionId") || null
                          : null,
                      };
                      void action(async () => {
                        detail.value = await serviceRequest<ReimbursementStatement>(
                          `${root}/statements`,
                          body,
                        );
                        linePage.value = 0;
                        await refresh();
                        message.value =
                          "Draft saved. Review its source, exact policy and per-session decisions before approval.";
                      });
                    }}
                  >
                    <CorrectionDraftFields
                      data={current}
                      previousId={correctionOfId.value}
                      onChange={(id, form) => {
                        correctionOfId.value = id;
                        const previous = current.statements.find((item) => item.id === id);
                        if (previous) {
                          assignmentId.value = previous.assignmentId;
                          const start = form?.elements.namedItem("periodFrom"),
                            end = form?.elements.namedItem("periodUntil");
                          if (start instanceof HTMLInputElement) start.value = previous.periodFrom;
                          if (end instanceof HTMLInputElement) end.value = previous.periodUntil;
                        }
                      }}
                    />
                    <label>
                      Assigned employee and station
                      <select
                        name="assignmentId"
                        required
                        aria-label="Assigned employee and station"
                        value={assignmentId.value}
                        onChange={(event) => {
                          assignmentId.value = event.currentTarget.value;
                        }}
                      >
                        <option value="">Choose an assignment</option>
                        {current.assignments.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.employeeName} · {item.stationAlias} · {item.driverAlias}
                          </option>
                        ))}
                      </select>
                    </label>
                    {pickedPolicy && (
                      <p class="cs-muted">
                        Fixed policy: {pickedPolicy.name} · v{pickedPolicy.version} ·{" "}
                        {pickedPolicy.rateEurPerKwh} EUR/kWh.
                      </p>
                    )}
                    <div class="cs-money-fields">
                      <label>
                        Statement starts · ISO with zone
                        <input name="periodFrom" required placeholder="2026-09-01T00:00:00Z" />
                      </label>
                      <label>
                        Statement ends · ISO with zone
                        <input name="periodUntil" required placeholder="2026-10-01T00:00:00Z" />
                      </label>
                    </div>
                    <label>
                      Authorized session CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
                      />
                    </label>
                    <p class="cs-muted">
                      The selected CSV is sent to this local account service when you create a
                      draft. Only this assignment’s relevant normalized records are retained. Keep
                      the original bytes separately.
                    </p>
                    {fileData.value && selectedMapping.value && (
                      <fieldset class="cs-money-mapping">
                        <legend>CSV mapping · {fileData.value.records} source records</legend>
                        <div class="cs-money-fields">
                          {(
                            [
                              ["sessionId", "Session ID column"],
                              ["stationId", "Station alias column"],
                              ["driverAlias", "Employee alias column"],
                              ["startedAt", "Start timestamp column"],
                              ["endedAt", "End timestamp column"],
                              ["energy", "Energy column"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <select
                                aria-label={label}
                                required={key !== "driverAlias"}
                                value={selectedMapping.value?.[key] ?? ""}
                                onChange={(event) => {
                                  if (selectedMapping.value)
                                    selectedMapping.value = {
                                      ...selectedMapping.value,
                                      [key]:
                                        event.currentTarget.value ||
                                        (key === "driverAlias" ? null : ""),
                                    };
                                }}
                              >
                                <option value="">
                                  {key === "driverAlias"
                                    ? "Declare the assignment alias for every record"
                                    : "Choose a column"}
                                </option>
                                {fileData.value?.headers.map((header) => (
                                  <option key={header} value={header}>
                                    {header}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                          <label>
                            Energy unit
                            <select
                              aria-label="Energy unit"
                              value={selectedMapping.value.energyUnit}
                              onChange={(event) => {
                                if (selectedMapping.value)
                                  selectedMapping.value = {
                                    ...selectedMapping.value,
                                    energyUnit: event.currentTarget.value as "Wh" | "kWh",
                                  };
                              }}
                            >
                              <option value="kWh">kWh</option>
                              <option value="Wh">Wh</option>
                            </select>
                          </label>
                          <label>
                            Energy decimal separator
                            <select
                              aria-label="Energy decimal separator"
                              value={selectedMapping.value.decimalSeparator}
                              onChange={(event) => {
                                if (selectedMapping.value)
                                  selectedMapping.value = {
                                    ...selectedMapping.value,
                                    decimalSeparator: event.currentTarget.value as "." | ",",
                                  };
                              }}
                            >
                              <option value=".">Dot</option>
                              <option value=",">Comma</option>
                            </select>
                          </label>
                        </div>
                      </fieldset>
                    )}
                    {selectedMapping.value && !selectedMapping.value.driverAlias && (
                      <label class="cs-checkbox">
                        <input type="checkbox" name="driverDeclarationConfirmed" required />I
                        confirm every source record belongs to the selected employee alias
                      </label>
                    )}
                    <label>
                      Revision of rejected statement
                      <select name="revisionOf" aria-label="Revision of rejected statement">
                        <option value="">New statement</option>
                        {current.statements
                          .filter(
                            (item) =>
                              item.status === "rejected" &&
                              item.assignmentId === assignmentId.value &&
                              item.correctionOf === (correctionOfId.value || null),
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.id.slice(0, 8)} · {displayDate(item.periodFrom)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      class="cs-primary"
                      type="submit"
                      disabled={busy.value || !fileData.value || !assignmentId.value}
                    >
                      Calculate and save draft
                    </button>
                  </form>
                </details>
              )}
            </div>
          )}
          {selected && (
            <section class="cs-money-review" aria-label="Statement review">
              <CorrectionComparison
                statement={selected}
                busy={busy.value}
                onOpen={(id) => void action(() => openStatement(id))}
              />
              <div class="cs-section-heading">
                <div>
                  <p class="cs-eyebrow">{selected.id}</p>
                  <h3>
                    {selected.snapshot.assignment.employeeName} · {statusText(selected)}
                  </h3>
                </div>
                <strong class="cs-money-total">{formatEuroCents(selected.amountCents)}</strong>
              </div>
              <p>
                {selected.energyWh} Wh · {selected.snapshot.policy.rateEurPerKwh} EUR/kWh ·{" "}
                {selected.snapshot.counts.included} included · {selected.snapshot.counts.duplicate}{" "}
                duplicate · {selected.heldRecords} held · {selected.invalidRecords} invalid
              </p>
              <p class="cs-muted">
                Policy {selected.snapshot.policy.policyId} · v{selected.snapshot.policy.version}.
                {selected.snapshot.sourceAuthority === "finance-void-request"
                  ? "Source: finance cancellation request; review the previous snapshot. No new meter observations are asserted."
                  : "Source: user-supplied CSV; independently verified device/meter provenance is still required."}
              </p>
              <dl class="cs-money-provenance">
                <dt>Statement snapshot SHA-256</dt>
                <dd>{selected.snapshotSha256}</dd>
                <dt>Original source SHA-256</dt>
                <dd>
                  {selected.snapshot.sources.map((item) => item.sha256).join(", ") ||
                    "No new source; the previous snapshot is referenced above."}
                </dd>
                <dt>Business assignment</dt>
                <dd>
                  {selected.snapshot.assignment.stationAlias} ·{" "}
                  {selected.snapshot.assignment.vehicleAlias} ·{" "}
                  {selected.snapshot.assignment.cardAlias} ·{" "}
                  {selected.snapshot.assignment.costCenter}
                </dd>
              </dl>
              {selected.eligibilityChanged && !selected.supersededBy && (
                <div class="cs-message cs-error">
                  Eligibility changed after this snapshot.{" "}
                  {selected.status === "approved"
                    ? "The approved record is preserved and needs correction review."
                    : "Create a fresh draft using the current assignment before approval."}
                </div>
              )}
              {selected.invalidRecords > 0 && (
                <div class="cs-message cs-error">
                  Resolve invalid source records before approval:{" "}
                  {selected.snapshot.issues
                    .map((item) => `record ${item.sourceRecord}: ${item.message}`)
                    .join("; ")}
                </div>
              )}
              <ul class="cs-money-records">
                {selected.snapshot.decisions
                  .slice(linePage.value * 20, (linePage.value + 1) * 20)
                  .map((item, index) => (
                    <li key={`${item.session.sourceRecord}-${index}`}>
                      <div>
                        <strong>
                          {item.session.sessionId} · {item.status}
                        </strong>
                        <p>
                          {item.session.energyWh} Wh · source record {item.session.sourceRecord}
                        </p>
                        <small>{item.reason}</small>
                      </div>
                      <strong>{formatEuroCents(item.amountCents)}</strong>
                    </li>
                  ))}
              </ul>
              {selected.snapshot.decisions.length > 20 && (
                <div class="cs-auth-links">
                  <button
                    type="button"
                    disabled={linePage.value === 0}
                    onClick={() => {
                      linePage.value--;
                    }}
                  >
                    Previous records
                  </button>
                  <button
                    type="button"
                    disabled={(linePage.value + 1) * 20 >= selected.snapshot.decisions.length}
                    onClick={() => {
                      linePage.value++;
                    }}
                  >
                    Next records
                  </button>
                </div>
              )}
              <button type="button" onClick={downloadStatement}>
                Download statement evidence JSON
              </button>
              {finance && selected.status === "approved" && !selected.supersededBy && (
                <CancellationRequestForm
                  statement={selected}
                  data={current}
                  busy={busy.value}
                  onRequest={(body) =>
                    void action(async () => {
                      detail.value = await serviceRequest<ReimbursementStatement>(
                        `${root}/statements/${selected.id}/void-draft`,
                        body,
                      );
                      linePage.value = 0;
                      await refresh();
                      message.value =
                        "Cancellation draft saved. Another finance reviewer must approve it before the balance changes.";
                    })
                  }
                />
              )}
              {finance && selected.status === "draft" && (
                <div class="cs-money-fields cs-money-review-actions">
                  {selected.employeeId === actorId ? (
                    <p>A different finance reviewer must review your statement.</p>
                  ) : (
                    <>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          void action(() => review("approve", form));
                        }}
                      >
                        <label class="cs-checkbox">
                          <input type="checkbox" required />
                          {selected.snapshot.correction
                            ? "I reviewed both snapshots and the adjustment"
                            : "I reviewed the exact source, policy and eligibility"}
                        </label>
                        {!mfaEnabled && (
                          <p>Enable authenticator MFA in Account security before approval.</p>
                        )}
                        <label>
                          Approval authenticator code
                          <input
                            name="authenticatorCode"
                            required
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6}"
                          />
                        </label>
                        <button
                          class="cs-primary"
                          type="submit"
                          disabled={
                            busy.value ||
                            !mfaEnabled ||
                            (Boolean(selected.snapshot.correction) &&
                              selected.createdBy === actorId) ||
                            selected.eligibilityChanged ||
                            selected.heldRecords > 0 ||
                            selected.invalidRecords > 0 ||
                            (selected.snapshot.counts.included === 0 &&
                              selected.correctionMode !== "void")
                          }
                        >
                          {selected.snapshot.correction
                            ? "Apply adjustment · no payment"
                            : "Approve statement · no payment"}
                        </button>
                        {selected.snapshot.correction && selected.createdBy === actorId && (
                          <p>Another finance reviewer must approve the correction you created.</p>
                        )}
                      </form>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          void action(() => review("reject", form));
                        }}
                      >
                        <label>
                          Rejection reason
                          <select name="reason" aria-label="Rejection reason">
                            <option value="source-issue">Source evidence needs correction</option>
                            <option value="eligibility">Eligibility needs review</option>
                            <option value="policy-rate">Policy or rate needs review</option>
                            <option value="duplicate">Duplicate request</option>
                            <option value="needs-review">Further review required</option>
                          </select>
                        </label>
                        <button type="submit" disabled={busy.value}>
                          Reject and retain snapshot
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
