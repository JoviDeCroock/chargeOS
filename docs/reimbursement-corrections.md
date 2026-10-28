# Approved reimbursement corrections and journal

Implemented 2026-10-28. This extends [local reimbursement statements](reimbursement-statements.md) inside the separate commercial Worker/D1 service. It records reviewed changes to approved, unpaid amounts. It does not instruct a payment, refund a settled transfer, issue a statutory credit note or change a charger.

## Correct an approved statement

In **Statements → Create a statement draft**, choose the current approved statement to correct, a closed reason, an assignment and an authorized CSV. The employee and station must match the original financial record. The replacement period must fit both the original financial period and current assignment eligibility. A correction can explicitly choose another published policy version covering that period; its snapshot records that selection while preserving the assignment's original version.

The server recalculates the replacement under the existing exact integer/rounding rules. The frozen correction context records the original root, immediate predecessor, predecessor snapshot hash, predecessor adjustment hash if present, predecessor amount, reason, mode and selected policy version. Users cannot submit an arbitrary credit or total.

Both versions are shown before approval. A new correction requires a reviewer who is neither the employee nor the draft's creator, current finance/admin membership, enabled MFA and a fresh authenticator code. The request names both displayed snapshot hashes. Held/invalid rows or changed eligibility still block approval. A rejected correction remains in history and can be referenced by a revised draft.

Only the current approved version can acquire an approved successor. Competing drafts can exist, but a unique predecessor constraint and an atomic approval gate permit one winner. Repeating an already successful approval returns its existing result without another adjustment or audit. Ordinary import fingerprints remain compatible with statements created before this feature.

## Full cancellation

An authorized finance/admin user can open the current approved statement and request a cancellation draft, choosing a source, eligibility or duplicate reason and explicitly confirming a replacement amount of zero. No new CSV or meter observation is asserted: its snapshot is labelled `finance-void-request` and references the previous financial record. The original amount remains approved until another authorized reviewer approves the cancellation with both hashes and a fresh authenticator code.

A rejected cancellation can be revised with an explicit predecessor link. Approved cancellation is a zero-value replacement and a negative adjustment, not deletion. A later corrected source may establish a positive replacement through the same chain. These actions operate only on unpaid approvals; post-settlement recovery/refunds require future payment integration and accounting review.

## Immutable adjustment receipts

An approved correction appends a `reimbursement_adjustment` row; the application exposes no update/delete operation for it. Its receipt contains both statement IDs/hashes, the original financial root, the previous adjustment hash, old and new integer-cent amounts, the signed difference, closed reason, mode, reviewer and time. A SHA-256 seals the stored JSON. Original and replacement snapshots remain unchanged; `supersededBy` is a derived link to the approved successor.

Adjustment insertion, session reservations, replacement approval and audit form one D1 batch. Every privileged gate checks current membership, different creator/employee, MFA-enabled state, current eligibility, predecessor status/hash and absence of an already approved successor. The current TOTP is verified before entering the batch. No authenticator code or owner secret enters a snapshot, receipt or audit.

Session reservations remain attached to the original financial root throughout all corrections, including full cancellation. A replacement may reuse that root's sessions and reserve additional unclaimed sessions; it cannot borrow another root's reservations. Removed sessions stay reserved and may be reconsidered only through their original correction chain. Cancellation therefore cannot reopen a duplicate-reimbursement path. These reservations are organization-scoped; independent household/device authority and cross-employer duplicate detection remain future work.

## Journal and balances

**Journal** projects each original approved statement as a baseline entry and each stored adjustment as a positive/negative entry. Earlier approvals need no destructive migration or synthetic backfill. Current approved balances count only the approved head of each chain; historical amounts are never added again as payable amounts.

The server checks that each employee's journal sum equals the sum of current approved heads, using `bigint` and refusing unsafe display ranges. Eligibility changes on a current head remain visible as amounts needing review. After an approved replacement resolves the eligibility issue, the original record retains its historical flag but no longer contributes to the current review amount. Balance means approved reimbursement amount, not bank funds or settlement.

Statement and adjustment reads use one consistent SQL batch. Hashes, denormalized financial fields, predecessor links, receipt amounts and reviewer metadata are verified before balances are projected or evidence is exported. Edited snapshots/receipts or conflicting stored amounts fail closed. These internal hashes are not signatures, independent timestamps or protection against a database administrator who can replace every relevant record and hash. Supported portable backup/restore and external financial integrity anchors remain required.

Drivers receive only their own statements, adjustments and balances. Finance/admin users see their organization's records. Downloads include the frozen snapshot and its adjustment receipt when present. UI labels distinguish proposed corrections, replaced historical records, approved replacements and cancelled unpaid amounts. No Paid, refund-confirmed or bank-confirmed state exists.

## Verification

The service suite now has 26 passing Worker/D1 tests. New coverage checks decreasing and increasing amounts, explicit policy overrides, cancellation chains and rejected revisions, original snapshot retention, legacy import identity, current balances, session reservation ownership, additional sessions, competing corrections, idempotent review, creator/employee/tenant restrictions, both hashes, fresh MFA, changed eligibility and edited financial data. Existing focused UI/import checks remain passing.

Chrome exercises three real local accounts through an original €1.33 approval, a reviewed −€0.83 adjustment to €0.50, then a separately reviewed −€0.50 cancellation to €0.00. Inspected evidence downloads verify both predecessor links and receipt hashes; the driver's phone journal shows all entries without overflow or owner API requests. The inputs are synthetic and the account delivery mode remains operator-verified local development. Public deployment, authentic customer/source acceptance, statutory documents, funded payout, bank matching and post-settlement accounting remain unproven.
