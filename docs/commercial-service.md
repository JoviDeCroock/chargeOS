# Local commercial account service

Implemented 2026-10-28. This is a real local account/organization service with persistent SQLite/D1 records. It remains separate from the fictional `/preview`, browser-memory `/observe` and physical owner console `/`. [ADR 0003](decisions/0003-separate-commercial-worker.md) records the hosting/storage boundary.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm service:setup
pnpm service:migrate
pnpm service:dev
```

In another terminal run `pnpm dev:web`, then open `http://127.0.0.1:5173/service`. If Vite uses a different port, pass its exact origin to the initial setup, for example `pnpm service:setup http://127.0.0.1:5176`. Setup creates `service/.dev.vars` with a random secret and refuses overwrite; edit its origin deliberately if needed. Use the same hostname and origin throughout verification and login. The Worker listens on `127.0.0.1:9091`; Vite proxies `/service/api` to it. No Cloudflare account, deployed database or charger is required.

Only the explicit loopback development profile runs. Public hostnames, missing secrets and production mode return 503. `pnpm service:build` bundles the Worker with `--dry-run`; it creates no cloud resources. The Node owner build and production Compose boundary do not run this service.

## Native SQLite runtime

The same account, organization and financial handlers can now run on Node.js **22.22.x** (the tested release line), using `node:sqlite` and the checked-in SQL migrations. Newer releases must provide the required SQLite APIs: before touching commercial state, an in-memory probe checks ordered array results, column metadata, foreign keys and the configured lock timeout. Version numbers alone do not establish compatibility because these APIs were backported unevenly. No Cloudflare account, Wrangler process or proprietary canonical storage is required for this local runtime. Node 22 currently labels SQLite experimental; the native entrypoint checks its minimum version before importing that module. This remains an explicitly loopback-only development profile, with the same private operator outbox and no public email delivery. It does not enable production hosting or complete commercial self-host parity.

After `pnpm service:setup`, run `pnpm service:native` instead of Wrangler. It applies verified migrations and listens on `127.0.0.1:9091`, so the existing Vite `/service/api` proxy and `/service` workspace continue to work. Do not run both backends on that port. For compiled execution, run `pnpm service:native:build` and `pnpm service:native:start`; the build includes its exact SQL files under `dist/native-service/service/migrations` separately from the Worker bundle. `SERVICE_NATIVE_CONFIG` selects an owner-private configuration file; `SERVICE_NATIVE_DATA` selects a real owner-private data directory (default `.chargeos/commercial-service`). `SERVICE_NATIVE_PORT` defaults to 9091; zero is reserved for ephemeral test listeners. Public origins and other service modes are still rejected before any listener binds.

The native database is `commercial.sqlite`, created with mode 0600 inside a mode-0700 directory. Final symlinks, hardlinks and group/world-readable database/configuration files or existing SQLite sidecars are rejected. SQLite uses full synchronization, DELETE journaling, foreign keys and startup integrity checks. Private local storage is plaintext; access to this directory and the separate auth secret remains a trusted operator responsibility. Do not commit, share or attach either to support requests. Native state and Wrangler/D1 state are distinct databases; switching runtimes does not import existing accounts.

Retrieve one intended recipient's current local delivery link with `pnpm service:native:outbox --recipient person@example.test --kind verify-email` (or `reset-password` / `invitation`). This is deliberate operator-only secret output; it has no HTTP equivalent and must not be captured in support logs or screenshots. The command checks the exact email, kind, expiry and configured origin. It never sends email or proves ownership of a real mailbox.

The adapter implements the D1 statement/batch surface consumed by Drizzle and this service. Bindings are immutable. Raw joined rows retain column order, including duplicate column names. Batches run synchronously inside one `BEGIN IMMEDIATE` transaction with no await before commit/rollback; metadata queries do not disturb business `changes()` gates. Raw async transaction control and multi-statement prepared queries are rejected. Replica bookmarks and public database dumps are unsupported. Scan/size statistics in compatibility metadata are unavailable and marked accordingly, not operational measurements.

Each migration is bound to its ordinal, name and SHA-256. Startup verifies the complete applied prefix, rejects unknown/changed history, and commits each migration's schema statements and hash together. Existing generated SQL remains authoritative; the runtime does not invent a different commercial schema. Native HTTP preserves separate authentication cookies, rejects foreign Host/Origin and absolute-form targets, bounds uploads/responses and assigns auth rate-limit identity from the actual socket peer rather than caller proxy headers. Neither runtime grants charger authority.

`pnpm test:service:native` runs all existing account/MFA/organization, reimbursement and correction tests against actual file-backed SQLite, plus adapter, migration, file-custody, HTTP and configuration regressions. `pnpm verify:service-native-runtime` boots the compiled service, uses local verification and scoped-cookie login, persists an organization/session through a clean process restart, and checks outbox isolation and secret-free runtime output. `pnpm verify` includes these checks and both builds.

An encrypted, authenticated commercial backup/restore with financial cut-off and credential-revocation semantics is still required. Copying a live SQLite main file is not a supported recovery procedure. Restoring an older database can resurrect sessions, invitations, recovery links or previously consumed MFA backup codes and can roll back offboarding or financial decisions; a native runtime alone does not resolve that recovery boundary.

Primary adapter references checked 2026-10-31: [Node.js 22.22 SQLite API](https://nodejs.org/download/release/v22.22.0/docs/api/sqlite.html) and [Cloudflare D1 statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). The pinned Drizzle/Better Auth implementations and the complete existing integration suites establish the exercised compatibility surface.

Native verification on 2026-11-01 passed all 26 existing account/financial tests plus ten adapter, migration, configuration and real-HTTP regressions. The compiled boot/restart drill also passed. Adversarial review identified leading-semicolon transaction-control bypass and uneven Node SQLite API availability; both were fixed with regressions before promotion. The owner/UI suite (131 tests), Worker suite (26 tests) and production Docker continuity/redaction drill passed locally. GitHub CI could not start because the repository account's billing/spending-limit gate rejected the job; these are local results, not a CI success claim.

## Account lifecycle and local delivery

Create a synthetic account with a password of at least 12 characters. Sign-in requires verification. Verification, reset and invitation links are written to `local_outbox`; no external message is sent. Inspect the local operator outbox with:

```sh
pnpm exec wrangler d1 execute chargeos-commercial-local --local --config service/wrangler.jsonc --command "SELECT kind, recipient, url, expires_at FROM local_outbox ORDER BY created_at DESC LIMIT 20"
```

These URLs are secrets. Open only the intended synthetic recipient's link. The local database, ignored `.dev.vars`, local developer tooling and any terminal output containing links belong to the trusted developer boundary. Do not add them to commits, logs, screenshots or exports. This delivery mechanism does not prove real mailbox ownership. Expired links are unusable but outbox rows remain until explicitly purged; use `DELETE FROM local_outbox` through the same local command after a development exercise. A public delivery/retention implementation is still required.

The UI supports registration, verified sign-in, sign-out, password reset, authenticator enrollment, MFA login and single-use recovery-code login. Enrollment requires a correct authenticator code before MFA becomes enabled. Store recovery codes separately; setup material is transient UI state and is cleared after enrollment/sign-out. Resetting a password revokes previous sessions. Session cookies are HttpOnly, SameSite=Lax and scoped to `/service/api`. Secure cookies are intentionally disabled only for this loopback HTTP profile. There is no session cookie cache, so session deletion and expiry apply on the next request. Auth attempts use database-backed rate limits. Better Auth telemetry is explicitly disabled.

## Organization authority

A verified account can create an organization and becomes its administrator. The creator cannot be removed through the membership endpoint. Administrators can invite driver or finance members, revoke pending invitations, remove other members and inspect the last 100 organization audit events. The current implementation does not invite additional administrators or implement administrator succession.

Invitations contain 256-bit random bearer tokens, stored as SHA-256 verifiers in invitation records and as secret delivery links only in the local outbox. They expire after 72 hours, require the exact verified account email and are consumed once. Membership insertion and acceptance/audit commit as a D1 batch; concurrent replays cannot create duplicate memberships. Removing membership takes effect at the next organization request without requiring account sign-out. Pending invitations do not grant access.

Each organization route resolves membership against its explicit organization ID. Unrelated accounts receive 404. Drivers see their own reimbursement records. Finance members can publish policies and review organization reimbursement records; people lists, invitations, membership mutations and account audit require administrator access. Tenant scope is rechecked inside privileged mutation statements. Invitation delivery and audit commit with creation. Audit records contain actor/resource IDs and closed action names, never passwords, invitation tokens, RFID or owner secrets. These records are not an externally anchored or tamper-proof ledger.

Organization administration does not grant physical charger ownership. The [reimbursement workflow](reimbursement-statements.md) adds immutable policy versions, dated employee/vehicle/card-alias/cost-center assignments, server-calculated CSV drafts and separate-reviewer statement approval with a current authenticator code. Membership removal now closes future business eligibility atomically and preserves financial history. There are no station claim, charging command, payment or support-case endpoints; household grants, statutory credit documents, post-settlement accounting and settlement remain required work. [Approved corrections and journal](reimbursement-corrections.md) now provide reviewed changes to unpaid approvals, explicit cancellation and exact current balances.

## Schema, portability and verification

`service/db/schema.ts` is authoritative for SQL tables. Use `pnpm service:generate` to generate migrations; do not hand-write migration SQL. Apply only with `pnpm service:migrate` during local work. Local D1 state under `service/.wrangler` and `.dev.vars` are ignored by Git. SQLite is not encrypted by this implementation; account/session, MFA and delivery state require trusted local storage. Better Auth encrypts MFA secrets/recovery codes using its configured secret; retain that secret with a future authenticated backup.

`pnpm test:service` runs Worker/D1 integration tests covering verified accounts, cookie boundaries, session expiry/revocation, one-use password recovery, MFA enrollment/challenge/recovery-code reuse, SQL rate limits, tenant isolation, role restrictions, protected creator, invitation expiry/revocation and concurrent acceptance. `pnpm verify` includes the owner/UI, Worker and native suites, both commercial builds and the compiled native runtime drill. The owner test suite remains separate because the existing Node filesystem/recovery tests have known Windows failures. Focused UI regressions cover same-tab invitation links, MFA challenge gating, and clearing stale account views after session expiry.

Chrome validation additionally exercises real registration/verification, organization persistence, invitation acceptance in a second browser context, driver restrictions, removal, authenticator enrollment/login and phone layout. It uses synthetic accounts and confirms no owner API requests. These tests establish local behavior only. Public deployment, real mailbox ownership, commercial restore, data-retention/deletion operations, household/station isolation and end-to-end money workflows remain unproven.
