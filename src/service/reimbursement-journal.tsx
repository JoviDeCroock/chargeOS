import type { ReimbursementWorkspaceData } from "../../shared/contracts.js";
import { formatEuroCents } from "../../shared/currency.js";

export function ApprovedBalances({ data }: { data: ReimbursementWorkspaceData }) {
  if (!data.balances.length) return null;
  return (
    <section class="cs-money-balances" aria-label="Approved reimbursement balances">
      {data.balances.map((item) => (
        <div class="cs-money-balance" key={item.employeeId}>
          <p class="cs-eyebrow">{item.employeeName} · approved and unpaid</p>
          <strong>{formatEuroCents(item.approvedAmountCents)}</strong>
          <p>
            {item.currentStatements} current{" "}
            {item.currentStatements === 1 ? "statement" : "statements"} · no payment instructed
          </p>
          {item.needsReviewAmountCents > 0 && (
            <p class="cs-money-warning">
              {formatEuroCents(item.needsReviewAmountCents)} needs eligibility review.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
export function ReimbursementJournal({
  data,
  onOpen,
  busy,
}: {
  data: ReimbursementWorkspaceData;
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section aria-label="Reimbursement journal">
      <h3>Approval and adjustment history</h3>
      <p class="cs-muted">
        Original approvals and later adjustments add up to the current approved amount. Replaced
        statements stay in the history. No entry represents a bank transfer.
      </p>
      <ApprovedBalances data={data} />
      {!data.journal.length && <p>No approved financial entries yet.</p>}
      <ul class="cs-money-records">
        {data.journal.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>
                {entry.employeeName} ·{" "}
                {entry.kind === "adjustment" ? "Adjustment" : "Original approval"}
              </strong>
              <p>
                {new Date(entry.reviewedAt).toLocaleString("en-BE", { timeZone: "UTC" })} UTC
                {entry.reason ? ` · ${entry.reason}` : ""}
              </p>
              <small>
                Resulting statement amount: {formatEuroCents(entry.resultingAmountCents)} · root{" "}
                {entry.rootStatementId.slice(0, 8)}
              </small>
              <p class="cs-money-hash">{entry.adjustmentSha256 ?? entry.snapshotSha256}</p>
            </div>
            <div class="cs-money-amount">
              <strong>
                {entry.differenceCents > 0 ? "+" : ""}
                {formatEuroCents(entry.differenceCents)}
              </strong>
              <button type="button" disabled={busy} onClick={() => onOpen(entry.statementId)}>
                Review journal statement {entry.statementId.slice(0, 8)}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
