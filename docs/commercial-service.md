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

Native shutdown drains asynchronous handler promises independently of socket lifetime. A client disconnect cannot make shutdown report completion while password/authentication work still runs. The database and any recovery custody remain held until those handlers finish; once closing starts, new handler work is refused.

`pnpm test:service:native` runs all existing account/MFA/organization, reimbursement and correction tests against actual file-backed SQLite, plus adapter, migration, file-custody, HTTP and configuration regressions. `pnpm verify:service-native-runtime` boots the compiled service, uses local verification and scoped-cookie login, persists an organization/session through a clean process restart, and checks outbox isolation and secret-free runtime output. `pnpm verify` includes these checks and both builds.

The native runtime now supports an encrypted backup and a quarantined restore, described below. Resuming commercial operations still requires a reviewed access/financial reconciliation and fresh credential enrollment workflow. Copying a live SQLite main file is not a supported recovery procedure. An old snapshot may predate offboarding, credential replacement or financial decisions; its contents alone cannot establish current permission or balances.

Primary adapter references checked 2026-10-31: [Node.js 22.22 SQLite API](https://nodejs.org/download/release/v22.22.0/docs/api/sqlite.html) and [Cloudflare D1 statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). The pinned Drizzle/Better Auth implementations and the complete existing integration suites establish the exercised compatibility surface.

Native verification on 2026-11-01 passed all 26 existing account/financial tests plus ten adapter, migration, configuration and real-HTTP regressions. The compiled boot/restart drill also passed. Adversarial review identified leading-semicolon transaction-control bypass and uneven Node SQLite API availability; both were fixed with regressions before promotion. The owner/UI suite (131 tests), Worker suite (26 tests) and production Docker continuity/redaction drill passed locally. GitHub CI could not start because the repository account's billing/spending-limit gate rejected the job; these are local results, not a CI success claim.

## Encrypted native backup and quarantined restore

This operator-only procedure preserves local native commercial records. It does not cover Wrangler/D1, the owner-edge ledger, charger credentials or physical charger behavior. The supported SQLite snapshot is at most 64 MiB and requires the exact checked-in migration/schema version. Keep the matching software revision with the encrypted backup; a future migration or extra database object intentionally fails validation rather than guessing an import path.

Place a single passphrase of at least 20 characters in a separate private file, using a password manager or private editor. Set its permissions to 0600. Keep it outside the commercial data directory, source repository and backup storage. Do not put the passphrase in command arguments, environment variables or support messages. The commands below take only its file path. Use an existing private parent directory for all outputs; restore requires a mode-0700 parent and a completely unused destination.

```sh
pnpm service:native:recovery export --output /private/backup/commercial.bundle --passphrase-file /private/key/commercial.passphrase
pnpm service:native:recovery inspect --input /private/backup/commercial.bundle --passphrase-file /private/key/commercial.passphrase
pnpm service:native:recovery restore --input /private/backup/commercial.bundle --target /private/recovery/new-company-copy --passphrase-file /private/key/commercial.passphrase
```

Export uses the configured native source (`SERVICE_NATIVE_CONFIG` and `SERVICE_NATIVE_DATA` apply). It creates a consistent SQLite backup through SQLite's backup API, then validates that finished copy: exact schema including unexpected triggers/views, complete source-hashed migration journal, SQLite integrity/foreign keys, every organization's immutable financial snapshots/adjustment receipts and journal balances. The validated bytes and SHA-256 enter a distinct `chargeos-commercial-recovery` envelope with AES-256-GCM and fixed scrypt parameters. Format, version, encryption parameters and completion time are authenticated. Inputs, encoded data and KDF parameters are bounded before decryption. New ciphertext uses fresh salt/nonce; output is create-only, private and flushed. The source auth secret is not included; existing database credentials are present only inside the encrypted snapshot and never become restored credentials.

Inspection and restore need only this software, the bundle and passphrase; they do not require the lost source configuration. Inspection prints counts and digests, with `financialState: snapshot-only-unreconciled`. `backupCompletedAt` is an authenticated software-reported completion time, not an external timestamp or financial cut-off. Export can run while the service is active, but changes after the snapshot are absent and must be reconciled against separately held session, membership and financial records.

Restore validates before creating a new package. It atomically deletes all sessions, password/OAuth accounts, authenticator secrets and backup codes, verification/reset records, local delivery and rate-limit state; resets email/MFA flags; and revokes pending invitations. Secure deletion plus vacuum removes residual deleted values from the restored SQLite pages. It generates a new auth secret. User IDs, memberships, business assignments, policies, financial snapshots/receipts/reservations and historical audits remain snapshot records. They are not current authorization. The database itself records quarantine, source-bundle/snapshot/financial digests, source origin, restore ID and software-reported times. The package contains `data/commercial.sqlite`, private `service.vars` and `recovery.json`; plaintext restored data remains trusted operator custody.

Ordinary native startup and the outbox command refuse a database containing the quarantine marker before serving any request. Copying only the database to another configured path, or deleting its quarantine row, does not release it. There is deliberately no release flag in this slice. Do not remove the marker table or reconnect this copy as an active backend. A separate reviewed workflow must reconcile the current employer roster and all financial/session changes since the snapshot, re-prove current identity and enroll fresh credentials/MFA before operational recovery can be claimed. Neither retaining the original auth secret nor accepting old TOTP/backup codes is a recovery shortcut.

Files and directory entries are flushed before successful publication. Failures clean only outputs created by the current attempt and preserve an occupied/replaced destination. A process/power loss can leave a private incomplete package; retain the original bundle and inspect the failure before retrying at a new unused destination. Do not treat a partial directory as a completed restore.

Primary implementation reference checked 2026-11-01: [Node.js 22.22 SQLite backup API](https://nodejs.org/download/release/v22.22.0/docs/api/sqlite.html#sqlitebackupsourceDb-destination-options). Native regressions exercise wrong keys, authenticated mutations, hostile KDF/encoding, extra schema objects, altered migrations, financial snapshot/receipt/balance corruption, linked/shared inputs, non-overwrite, interrupted/replaced outputs, credential removal, moved-database quarantine and concurrent snapshot writes. The compiled runtime drill performs export/inspection without source config and a new-path restore, then proves startup refuses before listening. These are synthetic local recovery results; public delivery, D1 portability and operational release remain open.

Recovery verification on 2026-11-01 passed `pnpm verify`: 131 owner/UI, 26 Worker and 45 native tests (including nine recovery tests), release validation, web/server/Worker/native builds and the compiled recovery drill. Independent adversarial review found and verified fixes for wildcard-based schema filtering and replacement-directory cleanup. Four initial owner/UI timeouts on a busy shared host were resolved by bounding file concurrency to two workers; assertions and timeout limits were retained. The focused rerun and complete verification then passed.

## Prepare a current recovery review

Reopening begins with a private review of current identity, employer access, financial records and source retirement. These commands prepare and validate that review; they do not enroll credentials, change memberships/eligibility, release quarantine or make a payment. Their output is `reviewed-not-enrolled`, with `reopeningAllowed: false`. Fresh enrollment and final release remain unfinished.

While the original native service and its configuration remain available, create a financial checkpoint **after** the corresponding encrypted backup:

```sh
pnpm service:native:recovery-review checkpoint --output /private/backup/current-financial-checkpoint.json
```

The command uses a consistent SQLite backup and the same exact schema, migration and financial integrity checks as encrypted export. It writes a private, create-only per-organization fingerprint covering policies, assignments/ends, statement snapshots, adjustment receipts and duplicate-session reservations. It changes no source record. Keep it off-server with the matching backup and separately held current financial records. A checkpoint is not a backup: it contains fingerprints, not recoverable business rows. Its software-reported time is not an external timestamp or financial authority.

On a restored, still-quarantined copy:

```sh
pnpm service:native:recovery-review template --data /private/recovery/company/data --output /private/review/company-review.json
pnpm service:native:recovery-review validate --data /private/recovery/company/data --manifest /private/review/company-review.json --output /private/review/validated-review.json
```

Template and validation need no source auth configuration or passphrase. They inspect the private restored database, verify its exact quarantine schema/provenance and financial integrity, and bind the review to its restore epoch plus immutable identities and business records. Authentication-only fields that fresh enrollment will change are excluded from the business fingerprint; user ID, name, email, image and original creation time remain bound. Changed identities, membership, policy, eligibility, snapshots, receipts, reservations, audits or quarantine provenance invalidate an existing template.

An administrator completes the generated JSON using actual current evidence. It starts unreviewed; empty fields and `unreviewed` decisions fail validation. Do not edit its reference section or substitute evidence from the restored database for independently reviewed current records.

- Set `reviewedThrough` to the actual current review time as a complete UTC ISO timestamp. It must be no more than 24 hours old and cannot be in the future.
- Supply `financialCheckpointFile` from the original source, captured after this backup and no later than the review time. Every organization and financial fingerprint must match exactly. A mismatch or missing post-snapshot financial record blocks progress; this tool cannot reconstruct or waive lost decisions.
- Supply `sourceRetirementEvidenceFile`: an administrator-reviewed record that the previous commercial service has been stopped and fenced against restarting. An unreachable server is not proof it was retired. This fences commercial account/finance writes, never charger-local authorization.
- For every organization, provide private `financialEvidenceFile` and `rosterEvidenceFile` paths. Decide every existing member explicitly as `keep` or `remove`, retaining the exact reviewed user ID and email. A kept member needs a private `identityEvidenceFile` checked against current identity. Removed members use an empty identity-evidence path and retain their recorded role in the review.
- The original organization creator must still be a current, kept `admin`. Other kept members may be `finance` or `driver`. Administrator succession remains unsupported; changing a historical creator or silently promoting another admin is not a recovery shortcut.
- For every assignment belonging to a removed member, add one `eligibilityEnds` entry with its `assignmentId`, exact `expectedExistingUntil` (timestamp or null) and reviewed `effectiveUntil`. Use the reference intervals. Every assignment needs a decision, including an already-ended one. Existing immutable ends must match exactly; conflicting or missing dates block validation. A new end must be inside its assignment and no later than the review time, except a not-yet-started assignment may end at its start, leaving no eligible interval. No end is applied by this command.
- Set `confirmation` to `I reviewed current identities, employer access, financial records and retirement of the previous service` only after that review is complete.

Evidence files must be nonempty, private regular files without final symlinks/hardlinks, at most 16 MiB each. Review inputs/outputs are bounded to 4 MiB, with at most 1,000 organizations and 10,000 member/end decisions per organization. Do not use passwords, RFID values, auth configuration or recovery keys as evidence. Paths are consumed locally and replaced by SHA-256 digests in the normalized report. The report still contains private user IDs/emails and role decisions; it is not a shareable support export. Hashes establish which bytes the operator reviewed, not HR truth, mailbox custody, financial completeness or source retirement.

The report binds the source provenance, business state, input manifest, checkpoint, external evidence, exact roster/eligibility decisions and a 24-hour expiry. Validation rechecks immutable state before publishing, writes no business/authentication mutations, and cannot make ordinary startup accept quarantine. Final reopening must revalidate this binding, enroll fresh credentials/MFA, drain enrollment and record a reviewed release for the same epoch. Merely possessing this report does not authorize reopening.

Review commands take exclusive `.recovery-lifecycle` custody under the data directory and record their PID/time there. They refuse an existing lock and never silently reclaim one. If a process was interrupted, an administrator must verify that it and its requests have stopped before assessing/removing stale custody. Cleanup checks directory identity and preserves a replacement directory. Keep outputs outside this temporary directory, including symlink aliases; otherwise they would disappear at cleanup. Outputs are private and create-only.

The native regression suite covers complete multi-organization decisions, real approved reimbursement records, immutable eligibility conflicts, stale/divergent checkpoints, protected administrators, identity/business mutations, actual cross-restore binding, unsafe evidence, occupied/transient outputs and lifecycle contention/replacement. The compiled drill captures a checkpoint, builds and validates a review on a new restore without source configuration, then proves normal startup still refuses before listening. These are local synthetic workflow checks, not current customer evidence.

Verification on 2026-11-01 passed `pnpm verify`: 131 owner/UI, 26 Worker and 54 native tests, release validation, all four builds and the compiled checkpoint/review/recovery drill. The nine new review tests include a real oversized finished database, ensuring a source that grows during backup is bounded before schema/financial inspection. Independent adversarial review found the transient-output cleanup issue; realpath-based rejection, including symlink aliases, fixes it. The final review found no remaining blocker for this read-only stage.

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
