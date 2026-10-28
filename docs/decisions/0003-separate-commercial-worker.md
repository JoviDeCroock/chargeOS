# ADR 0003: Separate commercial accounts from the owner edge

- Status: accepted for local implementation; public deployment is not approved by this ADR
- Date: 2026-10-28

## Context

The replacement target needs unrelated customer accounts, employer roles and financial workflows. The existing OCPP process represents one immutable physical owner domain. A fleet view does not establish commercial tenant isolation. Cloudflare hosting is desirable, while portable state and essential owner charging remain product constraints.

## Decision

Add a separate TypeScript Worker in `service/`, with Better Auth for password/session, verified-email, recovery and authenticator/backup-code flows, and Drizzle over D1/SQLite for commercial account and organization records. The Preact workspace is `/service`; cookies and API routes are confined to `/service/api`. Existing owner APIs retain bearer authentication. Neither credential authenticates the other service.

Organization administrators control membership in their organization. They cannot become a physical station owner, claim a station by CPID, issue an OCPP command, read the edge ledger or change local owner authorization. Household/station claiming and explicit owner grants remain separate work.

D1 stores commercial records only. It does not replace the canonical OCPP evidence store, owner-tag registry or encrypted continuity format. Schema and generated SQL migrations are checked in. D1-specific access stays in the service adapter; typed API contracts remain in `shared/contracts.ts`. A supported non-Cloudflare commercial adapter and tested export/restore are required before claiming self-host parity for the commercial service. Ordinary SQLite-compatible tables alone are insufficient proof of a portable operating service.

## Current delivery boundary

Only explicit local development configuration is accepted. The configured origin and request hostname must be loopback HTTP. Missing configuration and other deployment modes fail closed. Wrangler's configuration has no deployed database identifier, public worker URL or production secret. Build verification uses `deploy --dry-run`, not deployment.

Local verification, password-reset and invitation links go into the operator-only database outbox. No email is sent. This lets synthetic account workflows run without a mail provider, but does not establish real mailbox ownership. There is no application HTTP route to the outbox; local Wrangler tools and anyone with the local database can read it. It is secret development state, not a tenant export. A reviewed mail adapter, TLS/cookie configuration, abuse controls, retention, durable recovery and operating procedures are required before any public use.

## Consequences

Account and organization isolation can be tested in the actual local Workers/D1 runtime without moving the charger connection. This is evidence for the local commercial service, not production Cloudflare, OCPP transport, device compatibility, tax/payment correctness or complete provider parity. Existing Docker/Linux runtime and physical Freedom Test gates remain unchanged.

## Primary references checked 2026-10-28

- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth password authentication](https://better-auth.com/docs/authentication/email-password)
- [Better Auth two-factor authentication](https://better-auth.com/docs/plugins/2fa)
- [Cloudflare Worker integration testing](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
