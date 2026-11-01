# ADR 0003: Separate commercial accounts from the owner edge

- Status: accepted for local implementation; public deployment is not approved by this ADR
- Date: 2026-10-28

## Context

The replacement target needs unrelated customer accounts, employer roles and financial workflows. The existing OCPP process represents one immutable physical owner domain. A fleet view does not establish commercial tenant isolation. Cloudflare hosting is desirable, while portable state and essential owner charging remain product constraints.

## Decision

Add a separate TypeScript Worker in `service/`, with Better Auth for password/session, verified-email, recovery and authenticator/backup-code flows, and Drizzle over D1/SQLite for commercial account, organization, dated eligibility and reimbursement-statement records. The Preact workspace is `/service`; cookies and API routes are confined to `/service/api`. Existing owner APIs retain bearer authentication. Neither credential authenticates the other service.

Organization administrators control membership in their organization. They cannot become a physical station owner, claim a station by CPID, issue an OCPP command, read the edge ledger or change local owner authorization. Household/station claiming and explicit owner grants remain separate work.

D1 stores commercial records only. It does not replace the canonical OCPP evidence store, owner-tag registry or encrypted continuity format. Schema and generated SQL migrations are checked in. D1-specific access stays in the service adapter; typed API contracts remain in `shared/contracts.ts`. A native Node/SQLite adapter now runs the same local account and financial handlers, with full integration parity tests and a compiled restart drill. Both adapters remain loopback-only. Tested operational recovery and public delivery are still required before claiming commercial self-host parity; ordinary SQLite-compatible tables alone are insufficient proof.

The native adapter now has authenticated encrypted export/inspection and create-only quarantined restore. Validation covers the exact finished SQLite backup, source migration/schema and every organization's financial snapshots/receipts/journal. Restore removes every old authentication credential and pending invitation, rotates the service secret and records quarantine inside the database. Normal startup/outbox refuse quarantine before handling requests. This preserves snapshot records without asserting current membership or balances. It does not complete the operational restore gate: external reconciliation, fresh identity/credential enrollment, reviewed release and D1 portability are still required. See [Commercial recovery](../commercial-service.md#encrypted-native-backup-and-quarantined-restore).

Reopening preparation now produces original-source financial checkpoints and validates private restore-bound current reviews. Every organization/member and removed-member assignment needs an explicit decision, external evidence digests and a matching checkpoint; historical creator succession or conflicting immutable eligibility ends stop the flow. The artifact binds full provenance and immutable business/identity state while excluding future authentication-enrollment changes. Exclusive lifecycle custody serializes official recovery operations. This is read-only preparation, remains `reviewed-not-enrolled`, and cannot release quarantine. Current external truth and source fencing remain operator responsibilities, never claims established by hashes.

The native adapter now has a distinct local fresh-enrollment listener for kept reviewed identities. It consumes private one-use links, creates fresh password/TOTP proofs under authenticated epoch-bound progress, and exposes no organization/financial/charger routes. Separate recovery cookies and explicit rate limits bound internal authentication calls. Lifecycle custody survives socket disconnects until every handler drains. The UI and targeted reissue support interrupted setup while retaining quarantine. This does not add a release switch or public mailbox/hosting proof; the separate finalizer now supports reviewed local release and subsequent released-state backup/recovery.

The local finalizer now applies reviewed roles/removals/eligibility and clears enrollment authentication sessions in one guarded SQLite transaction with the same-epoch release receipt. Explicit operator attribution preserves original human audits. Active receipts and prior history are checked with the current secret at ordinary startup; a future restore retains history but discards active authority and rotates into fresh quarantine. A consistent-copy preflight and in-transaction full-state/row guards protect partial failure. Public hosting and production recovery remain unproven; the exact-software-version snapshot contract remains unchanged.

The native adapter now has an optional SMTP worker for local-trial account links. Explicit activation marks only future queue entries; old/local rows never become mail implicitly. Mandatory verified TLS, fixed templates, durable opaque leases, bounded retries and physical socket drain protect delivery and recovery custody. Pending/leased mail is cleared on restore/reissue/release; provider settings and activation are not restored. This implements a delivery component, not a public-hosting exception. [SMTP operations](../commercial-service.md#native-smtp-account-delivery) records the exact contract.

## Current delivery boundary

Only explicit local development configuration is accepted. The configured origin and request hostname must be loopback HTTP. Missing configuration and other deployment modes fail closed. Wrangler's configuration has no deployed database identifier, public worker URL or production secret. Build verification uses `deploy --dry-run`, not deployment.

The native adapter is a locally runnable alternative, not a production-mode exception. It uses `node:sqlite` tested on Node 22.22.x, a private on-disk database, checked source migrations with an atomic hash journal, and a loopback HTTP bridge. An in-memory capability check rejects incompatible newer runtimes before opening commercial state. The bridge preserves independent cookies, rejects foreign Host/Origin and ignores caller-selected proxy IPs. It has no OCPP adapter, owner credential or outbox route. Delivery defaults to operator-only; the optional native SMTP worker above sends only explicitly queued future links. Storage remains plaintext. See [Commercial service](../commercial-service.md) for commands and tested boundaries.

By default, local verification, password-reset and invitation links go into the operator-only database outbox and no email is sent. This lets synthetic account workflows run without a mail provider, but does not establish real mailbox ownership. There is no application HTTP route to the outbox; local Wrangler tools and anyone with the local database can read it. It is secret development state, not a tenant export. Public TLS/cookie hosting, provider/mailbox validation, abuse controls, retention, production recovery and operating procedures remain required before public use.

## Consequences

Account and organization isolation can be tested in the actual local Workers/D1 runtime without moving the charger connection. This is evidence for the local commercial service, not production Cloudflare, OCPP transport, device compatibility, tax/payment correctness or complete provider parity. Existing Docker/Linux runtime and physical Freedom Test gates remain unchanged.

## Primary references checked 2026-10-28

- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth password authentication](https://better-auth.com/docs/authentication/email-password)
- [Better Auth two-factor authentication](https://better-auth.com/docs/plugins/2fa)
- [Cloudflare Worker integration testing](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Native HTTPS pilot update — 2026-11-01

The native Docker adapter now has an explicit symbol-gated HTTPS configuration separate from Worker bindings and local files. Its single shared proxy namespace, cookie/mail/abuse controls and recovery metadata boundary are documented in [native company hosting](../company-hosting.md). This supersedes the native local-only statement for that narrow synthetic pilot; the managed company pilot now additionally uses a fresh isolated Coolify destination and the same loopback backend. It does not approve Worker public deployment, live managed-platform acceptance or full public operational recovery.
