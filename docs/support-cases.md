# Company support cases

The real `/service` workspace stores reimbursement/account cases in the separate Worker/D1 or native Node/SQLite database. This is a company-operated pilot, not an external helpdesk contract or emergency service. Support never changes financial approval, payment, eligibility, card lists or charger configuration. Nothing is sent to AI or search automatically.

## Workflow and access

Any verified current organization member can report a case as themselves. The organization creator is initially responsible. An optional statement reference must belong to that reporter and organization; the original ID and snapshot digest remain fixed through financial corrections. Staff cannot create cases impersonating employees.

Drivers see only their own cases. Current finance/admin members see company cases and can assign current finance/admin colleagues. The assignee or an administrator can request information or propose a resolution with explanatory text. Every reply is visible to the reporter and current company finance/admin team. There are no attachments or internal notes. A departed assignee remains in history and is visibly unavailable until reassignment. A departed reporter loses access; staff retain the case.

States are Open, Waiting for reporter, Resolved and Closed · reporter confirmed. Only the reporter can confirm the current resolution and close. A reporter reply or reopening returns the case to Open; a stale revision cannot close an earlier resolution. A departed reporter's resolved case can remain unconfirmed. Confirmation is the reporter's attestation, not an independent physical test or bank receipt. Staff reporting their own case do not imply separate-person verification.

## API and transactions

The versioned root is `/service/api/v1/organizations/:organizationId/support`. GET lists up to 50 cases with an optional complete `beforeTime`/`beforeId` cursor. GET `/:caseId` returns the current case and up to 50 events; `eventsBefore` pages earlier history. POST creates with `mutationId`, `subject`, `topic`, `statementId` (or null), and `message`. POST `/:caseId/:action` uses `reply`, `assign`, `request-information`, `resolve`, `close` or `reopen`, a UUID mutation identifier, exact `expectedRevision` and the closed action payload in `service/support-domain.ts`.

Every read, retry and mutation checks current membership in SQL. Mutations also guard role, assignment, status and revision inside the atomic batch. The identifier binds normalized input, actor, organization, case, action and expected revision. An exact retry acknowledges the existing event and returns the currently authorized case; changed reuse conflicts. Concurrent revisions have one winner. Case projection, event and one audit record commit together. Audits contain identifiers/action/time, never message text. Persisted logical event time cannot decrease during clock rollback; rate admission uses the actual clock. These are software times, not independent chronology.

The UI retains an uncertain operation only in the current component's memory. Keep the tab open and use Retry same update before writing another operation. Reload, navigation and another device do not preserve that retry identifier. No case text, pending payload or credential goes into browser storage.

## Bounds and recovery

Subjects have at most 120 characters; messages 2,000 characters/8,000 UTF-8 bytes, with only tab/newline allowed as controls. Admission is five new cases and 20 updates per member/organization/minute. Indexed history pages are bounded. The pilot permits at most 4,096 events and 2 MiB of payload per organization, refusing new content without pruning old history. Operational capacity, retention/export/deletion and notifications remain unfinished. The separate native database recovery ceiling is still 64 MiB.

Additive migration `0006_furry_vulture.sql` references durable users rather than deletable memberships. Back up with matching software before upgrade. Rollback uses that retained backup and exact version through documented quarantine/review; never drop populated support tables or edit migration/provenance hashes to downgrade. Older encrypted snapshots remain tied to their original software/schema. New snapshots retain case/event/audit history while old authentication is scrubbed and access is reviewed anew.

Native inspection replays case history and verifies request bindings, revision continuity, durable historical references, status/assignee/time projection, both directions of event/audit correspondence, statement ownership/digest and capacity. Departed actors need not remain current members. The business fingerprint includes both tables, so case changes after reviewed release invalidate a new public handoff. These checks establish internal consistency; a database administrator can rewrite related rows and hashes.

## Verification scope

Real-session checks on both adapters cover reporter/tenant isolation, current staff permissions, assignment/closure, stale revisions, concurrent/idempotent retries, financial immutability, input/admission/page bounds, tampering and clock rollback. Encrypted restore and the compiled Docker handoff retain confirmed case history; the browser exercise covers an employee statement, staff explanation, reporter phone closure and the unchanged financial snapshot. Focused UI regressions preserve displayed revision during earlier-history paging and clear statement context for a new general case. No outside operator/SLA, emergency dispatch, payment confirmation, attachment handling, automatic AI upload or legal retention workflow is claimed.
