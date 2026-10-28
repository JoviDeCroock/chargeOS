import type {
  CreateReimbursementVoid,
  ReimbursementStatement,
  ReimbursementWorkspaceData,
} from "../../shared/contracts.js";
import { formatEuroCents } from "../../shared/currency.js";

export function CorrectionDraftFields({
  data,
  previousId,
  onChange,
}: {
  data: ReimbursementWorkspaceData;
  previousId: string;
  onChange: (id: string, form: HTMLFormElement | null) => void;
}) {
  return (
    <>
      <label>
        Approved statement to correct
        <select
          aria-label="Approved statement to correct"
          value={previousId}
          onChange={(event) => onChange(event.currentTarget.value, event.currentTarget.form)}
        >
          <option value="">New independent statement</option>
          {data.statements
            .filter((item) => item.status === "approved" && !item.supersededBy)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.employeeName} · {formatEuroCents(item.amountCents)} · {item.id.slice(0, 8)}
              </option>
            ))}
        </select>
      </label>
      {previousId && (
        <div class="cs-money-fields">
          <label>
            Correction reason
            <select name="correctionReason" aria-label="Correction reason">
              <option value="source-issue">Source evidence corrected</option>
              <option value="eligibility">Eligibility corrected</option>
              <option value="policy-rate">Agreed policy or rate corrected</option>
              <option value="duplicate">Duplicate approval</option>
              <option value="needs-review">Reviewed adjustment</option>
            </select>
          </label>
          <label>
            Published policy for this correction
            <select
              name="correctionPolicyVersionId"
              aria-label="Published policy for this correction"
            >
              <option value="">Keep the assignment’s policy version</option>
              {data.policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name} · v{policy.version} · {policy.rateEurPerKwh} EUR/kWh
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </>
  );
}
export function CorrectionComparison({
  statement,
  onOpen,
  busy,
}: {
  statement: ReimbursementStatement;
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  const correction = statement.snapshot.correction;
  return (
    <>
      {correction && (
        <section class="cs-money-adjustment" aria-label="Adjustment comparison">
          <h3>{statement.status === "approved" ? "Approved adjustment" : "Proposed adjustment"}</h3>
          <p>
            Previous approved amount{" "}
            <strong>{formatEuroCents(correction.previousAmountCents)}</strong> → replacement{" "}
            <strong>{formatEuroCents(statement.amountCents)}</strong>. Difference{" "}
            <strong>{formatEuroCents(statement.adjustmentCents ?? 0)}</strong>.
          </p>
          <p>
            {correction.mode === "void"
              ? "Full cancellation request; no new charging source is asserted."
              : "Recalculated from the selected source and explicit published policy."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpen(correction.previousStatementId)}
          >
            Review previous statement
          </button>
          <dl class="cs-money-provenance">
            <dt>Previous snapshot SHA-256</dt>
            <dd>{correction.previousSnapshotSha256}</dd>
            {statement.adjustment && (
              <>
                <dt>Adjustment receipt SHA-256</dt>
                <dd>{statement.adjustment.sha256}</dd>
              </>
            )}
          </dl>
          {correction.selectedPolicyVersionId !== statement.snapshot.assignment.policyVersionId && (
            <p>
              This correction uses a separately selected published policy. The recorded assignment
              version is preserved.
            </p>
          )}
        </section>
      )}
      {statement.supersededBy && (
        <div class="cs-message">
          This historical statement has been replaced.{" "}
          <button type="button" disabled={busy} onClick={() => onOpen(statement.supersededBy!)}>
            Review replacement statement
          </button>
        </div>
      )}
    </>
  );
}
export function CancellationRequestForm({
  statement,
  data,
  busy,
  onRequest,
}: {
  statement: ReimbursementStatement;
  data: ReimbursementWorkspaceData;
  busy: boolean;
  onRequest: (body: CreateReimbursementVoid) => void;
}) {
  return (
    <details class="cs-money-form">
      <summary>Request full cancellation</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          onRequest({
            snapshotSha256: statement.snapshotSha256,
            reason: String(values.get("reason")) as CreateReimbursementVoid["reason"],
            revisionOf: String(values.get("revisionOf") ?? "") || null,
          });
        }}
      >
        <label>
          Cancellation reason
          <select name="reason" aria-label="Cancellation reason">
            <option value="eligibility">No reimbursement eligibility</option>
            <option value="duplicate">Duplicate reimbursement approval</option>
            <option value="source-issue">Source evidence invalidated</option>
          </select>
        </label>
        <label>
          Rejected cancellation to revise
          <select name="revisionOf" aria-label="Rejected cancellation to revise">
            <option value="">New cancellation request</option>
            {data.statements
              .filter(
                (item) =>
                  item.status === "rejected" &&
                  item.correctionOf === statement.id &&
                  item.correctionMode === "void",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
        <label class="cs-checkbox">
          <input type="checkbox" required />I intend to replace this approved amount with €0.00
        </label>
        <button type="submit" disabled={busy}>
          Create cancellation draft
        </button>
      </form>
    </details>
  );
}
