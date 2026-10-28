# Local reimbursement policies, assignments and statements

Implemented 2026-10-28 in the real `/service` workspace. Use [the commercial service setup](commercial-service.md), including `pnpm service:migrate` after updating. This slice runs against local Worker/D1 records with synthetic-account verification. It does not establish real mailbox ownership, device provenance, a tax-compliant invoice or a settled payment.

## Workflow and authority

1. An administrator invites the employee and a separate finance reviewer to the organization.
2. An administrator or finance member publishes an immutable policy version: key/version, agreed EUR/kWh rate and effective dates.
3. An administrator records a dated assignment to that exact version, employee account, employee alias, station alias, vehicle alias, card alias and cost center. The employee must belong to the organization.
4. An administrator or finance member chooses the assignment and a closed statement period, selects an authorized CSV and declares the columns, units and decimal separator. This explicitly uploads the selected bytes to the local account service; it differs from the browser-only `/observe` workspace.
5. The server fingerprints the original bytes, parses and calculates a draft from the stored policy and assignment, and persists its immutable snapshot. A client-supplied amount or extra field is rejected.
6. A different administrator/finance member reviews the exact snapshot. Approval needs enabled MFA **and a current authenticator code for this review**, not merely an account with MFA enabled. The statement must contain eligible sessions and no unresolved source/held rows or changed eligibility.
7. Approval, unique session reservations and audit commit together. The UI and export retain `paymentStatus: not-instructed` and display **Approved · unpaid**. There is no payment instruction, bank confirmation or Paid action.

An organization role does not grant charger ownership. Station/card aliases are bookkeeping references, not device claims or real RFID provisioning. A card alias must start with `card-`; users must never paste a raw RFID secret as an alias. A prefix cannot independently prove an arbitrary value is non-secret. No OCPP or owner API is called by this workflow.

| Role          | Permitted scope                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator | Publish policies, create/end assignments, import drafts, review another employee's statements, see organization financial records                 |
| Finance       | Publish policies, import drafts, review another employee's statements, see organization financial records; cannot create/end employee assignments |
| Driver        | Read their own assignments, referenced policy versions, statements and evidence exports; no financial mutation or other employees' records        |

Every operation is under an explicit organization route. Mutations recheck the current role in SQL. An unrelated organization receives 404. Self-review is denied even if the employee has an administrator/finance role. Fresh TOTP verification uses the authentication library's verification/lockout path; codes never enter financial storage, audit or exports.

## Policy and eligibility history

Rates accept a positive explicit decimal with at most six fractional digits. chargeOS supplies no statutory or regional rate. A new rate requires a new version; publishing an existing key/version returns a conflict. Assignments always select an exact version, so later publications cannot silently reprice old records. Version periods may overlap because selection is explicit.

Assignment and policy periods are bounded zoned ISO instants. The eligibility interval is `[from, until)`; a complete session ending exactly at `until` fits, while any session crossing the boundary is held. The assignment must fit inside its policy. Overlapping employee or employee-alias assignments at the same station are rejected, including concurrent creation. Distinct employees with distinct aliases may share a station.

Original assignment fields/dates are retained. Ending an assignment appends a separate immutable end record; it cannot extend the original period or be rewritten. A later correction to recorded eligibility may be backdated, but cannot silently alter a financial snapshot. Removing a membership atomically records the cut-off for that employee's assignments: an already expired assignment keeps its original end, a current one ends now, and a future one is cancelled at its start. Account removal does not erase historical statements or physical household ownership.

A draft whose captured assignment end differs from current eligibility cannot be approved. Create a fresh draft for the current interval. An already approved record retains its original amount/snapshot and receives an **eligibility changed / correction review required** flag. Approved financial corrections and credits remain unimplemented; the flag does not repair money or imply a payment was reversed. Historical periods still valid at offboarding remain available to finance after the employee loses organization access.

## Import and calculation boundary

The service accepts a non-empty UTF-8 CSV up to 256 KiB and 500 data records per statement. Its JSON/base64 envelope is capped at 512 KiB; other account requests retain the 32 KiB cap. Parsing, zoned timestamps, explicit Wh/kWh/decimal rules, logical record numbers, duplicate/conflict handling and exact integer arithmetic use [the shared observation engine](local-observation.md). Energy is integer Wh, rates are integer micro-EUR/kWh, and half-up rounding happens once per session to integer cents. Unsafe ranges fail closed. Statement periods must already have ended.

If no employee column is mapped, the user must explicitly confirm that every record belongs to the selected assignment alias. The snapshot preserves that declared-versus-mapped distinction. Unknown, malformed or incomplete source records remain issues and block approval; a zero-energy or boundary-crossing session remains held. There is no manual override that turns a held record into a zero-value approved item.

The original file is not stored. D1 keeps its SHA-256, selected mapping, normalized relevant employee/station/period records, row issues and calculation. Obvious raw-card/RFID/token column names are rejected for selected identity mappings. Mislabelled arbitrary values cannot be universally identified as secrets. Raw unselected columns and normalized records for unrelated people/stations or wholly outside the statement period are omitted from the snapshot/export. An omitted-record count remains. Conflicting versions still participate in server validation before filtering, so filtering cannot conceal a contradictory identity. Invalid rows whose employee cannot be established conservatively block the source rather than being discarded.

Keep the exact source bytes separately. A digest links a snapshot to those bytes; it does not prove completeness, who supplied them, factual truth, meter suitability or an authentic employment relationship. No vendor-specific Alfen/LMS adapter or real customer month has been validated yet.

## Frozen records, idempotency and duplicate prevention

Draft identity binds organization, assignment/current end, policy version, period, original source hash, normalized column mapping and optional rejected predecessor. Retrying an identical import returns its existing record. A changed file can create a new draft; it cannot bypass approval reservations for the same session.

Snapshots contain the captured assignment, policy, period, source/mapping, per-session decisions and integer totals. Their stored JSON has a SHA-256 digest checked on detail reads and review. Approval/rejection must name the displayed digest. Review changes status/reviewer/time/reason without editing that JSON. Hashes and the ordinary organization audit are not externally anchored integrity or trustworthy chronology.

Approval reserves `(organization, station alias, session ID)` in a unique SQL key. The eligibility/current-role checks, all included-session reservations, approved transition and audit form one atomic batch. Two concurrent drafts containing the same session cannot both be approved. Repeating a successful approval returns the existing approved record without another audit/reservation. This assumes stable provider session identifiers; reused IDs need an explicit adapter/dispute path. It does not prevent duplicate reimbursement across unrelated organizations without future household/device authority integration.

Rejection uses a closed reason code and preserves the snapshot. A corrected draft can reference a rejected predecessor for the same employee/assignment. Approved statements cannot be replaced through that path. Invoices, approved credits/corrections, funding, payouts, bank matching, accounting/payroll handoff, retention/deletion and portable commercial restore remain required work.

## UI and verification

`/service` includes Statements, Assignments and Policies views, explicit file/mapping consent, per-session review, current-code approval, rejection/revision, assignment ending, unchanged-history flags and JSON evidence downloads. Driver views are restricted to their own records; phone layouts preserve status and amounts. A JSON download is financial review evidence, not a tax invoice, bank receipt or owner recovery backup.

The current service suite has 18 passing Worker/D1 tests; 24 focused account/owner UI, observation and preview checks also pass. The complete owner suite remains at 88 passed and the same 21 known Windows filesystem/recovery failures. Both builds and the production dependency audit pass. The required production runtime attempt stops at its POSIX `/tmp` assumption on Windows; Docker is also unavailable. No fresh Linux/Docker or field proof follows from the local results.

Worker/D1 tests use real account sessions and MFA to check independent cent values, original-byte fingerprints, omitted raw/unrelated data, immutable policies/snapshots, source declaration, role/employee/tenant scope, exact-hash review, unresolved rows, rejected revisions, concurrent duplicate approvals, dated offboarding, invalid encodings/future periods, integrity failures and assignment races. Chrome separately verifies the three-account path from policy and assignment through fresh-code approval and an inspected evidence download, then changes eligibility and confirms the historical review flag. Synthetic data passes; public deployment, real source/contract acceptance and money movement remain unproven.
