# chargeOS

chargeOS is an open, owner-controlled operating layer for privately owned EV chargers.

The commercial target is a complete charging-management replacement for home, workplace and public use, with polished driver/employer experiences, traceable reimbursement and independent service delivery. The current code combines the owner-edge foundation with local commercial account and reimbursement workflows. See the [replacement plan](docs/product-parity.md) and [feature register](docs/product-parity.json) for the gaps and customer switching gates.

Its non-negotiable promise is narrow and testable:

> If every company involved disappears, a previously authorized owner can still charge.

The first target is an Alfen Eve Single S/Pro line charger in Belgium. The first milestone is not a polished SaaS: it is a reversible migration to owner-controlled OCPP 1.6J infrastructure, durable local RFID authorization, captured sessions and meter values, and a witnessed offline charging test.

## Start here

- [Plain-language help](docs/guides/README.md) — installation, deployment, charger connections, AI keys/search, brands, people, RFID cards, reimbursements and recovery. Also available in the app at `/help`.
- Run `node scripts/deploy.mjs` for the guided Docker or Coolify Cloud setup. See [deployment boundaries and prerequisites](docs/deployment-setup.md).

- [Replacement plan and feature parity](docs/product-parity.md) — current product direction, UX brief, delivery boundaries, acceptance criteria and switching gates.
- [Founder report](docs/founder-report.md) — verdict, market, product, economics, and 90-day plan.
- [Architecture](docs/architecture.md) — owner root, local edge, hosted control plane, and protocol boundaries.
- [Offline invariants](docs/offline-invariants.md) — exactly what must work during each failure mode.
- [Alfen Genesis runbook](docs/alfen-genesis-runbook.md) — the safe, reversible first-device procedure.
- [Charger Freedom Matrix](docs/charger-freedom-matrix.md) — model/firmware evidence, not vendor marketing.
- [European stack and standards](docs/market-and-standards.md) — roles, lock-in points, and protocol capability boundaries.
- [Documentation index](docs/README.md) — routing for agents and contributors.

## Local product preview

Run `pnpm dev:web` and open `/preview` to explore the fictional driver, employer/finance and operator/support workspaces. The preview is isolated from live charger APIs; it sends no charger commands, support messages or payments. See [the product experience](docs/product-design.md) for implemented interactions, domain boundaries and limitations. The existing authenticated owner console remains at `/`.

## Read-only local observation

Open `/observe` to map an authorized session CSV, fingerprint its original bytes, apply an explicit policy and inspect an exact unapproved reimbursement draft. The tool processes files in browser memory and sends no upload, charger command or payment. See [Local observation](docs/local-observation.md) for supported formats, rounding, provenance, privacy and limitations.

## Local commercial accounts

The same accounts and reimbursement service can now run directly on the tested Node 22.22.x runtime and private SQLite: `pnpm service:setup`, then `pnpm service:native` alongside `pnpm dev:web`. Newer Node releases must pass the built-in SQLite capability check. This local alternative needs no Cloudflare/Wrangler runtime. See [the service guide](docs/commercial-service.md#native-sqlite-runtime) for operator-only delivery, persistent state, adapter parity and the remaining encrypted-recovery/public-deployment gates.

The real `/service` workspace adds persistent verified-email accounts, authenticator MFA, password recovery, organizations and expiring role invitations in a separate locally runnable Cloudflare Worker with D1/SQLite. Start with `pnpm service:setup`, `pnpm service:migrate` and `pnpm service:dev`, then run the web app. Local delivery uses an operator-only database outbox and sends no email. See [Commercial service](docs/commercial-service.md) for the exact origin, verification flow, isolation and remaining deployment gates. This service has no charger or payment authority.

## Local reimbursement review

The `/service` finance workspace now connects immutable policy versions, dated employee/vehicle/card-alias/cost-center assignments, explicit CSV imports, server-calculated statements and a different reviewer’s fresh-MFA approval. Approved corrections now append linked adjustment receipts, preserve prior snapshots and session reservations, and project a driver-scoped journal and current balance. Full cancellation needs a separate reviewer. Statements remain visibly unpaid; no payment or bank operation is implemented. Driver views and evidence downloads are scoped to their own records. See [Reimbursement statements](docs/reimbursement-statements.md) for source/rounding rules, offboarding, duplicate prevention and remaining financial gaps.

## Working owner-edge MVP

The owner console includes [bring-your-own-key AI troubleshooting](docs/ai-troubleshooting.md) with OpenAI or Anthropic and optional internet search. Review the minimized diagnostic preview before sending it; the assistant explains evidence and has no charger-command or payment tools.

The repository now contains a self-hostable owner-edge vertical slice:

- a strict, payload- and rate-bounded OCPP 1.6J gateway that accepts one authenticated connection per explicitly provisioned charge point;
- a real owner-fleet web app with aggregate connection, charging, energy, readiness, authorization, migration-attention, and evidence-conflict views plus charger-scoped drill-down management;
- an owner-authenticated, HMAC-protected durable RFID desired-state registry with atomic add/revoke, pseudonym-only audit, final-credential protection, and current-state continuity recovery;
- capability inspection and full local-list synchronization guarded by offline-readiness checks;
- crash-safe desired-versus-acknowledged owner-tag reconciliation with visible pending additions and stale-access revocation warnings;
- owner-confirmed, one-way preparation of three explicitly writable local-continuity settings, with complete preflight, audited OCPP results, restart gating, and post-change inspection;
- replay-stable transaction IDs, authorization-bound session evidence, exact-retry reconciliation, and visible stop conflicts;
- a bearer-authenticated local owner API and Preact dashboard;
- a Freedom Test field recorder that separates protocol-derived checks from witnessed physical evidence and never self-certifies;
- a reversible migration dossier that blocks endpoint authorization until ownership, custody, backups, standalone rollback, installer safety, secure transport, and recovery evidence pass;
- a canonical, secret-free migration-target manifest with non-overwriting creation and authorized-hash verification immediately before field work;
- expiring, revocable installer, employer, and energy-provider read capabilities whose bearer secrets are shown once and never persisted;
- a redacted support export plus an encrypted, restorable owner continuity bundle;
- create-only schema-4 compacted replacement recovery that keeps full source evidence off-edge, carries replay-safe operational state with explicit provenance, and never silently claims complete history;
- a non-root container image, a production Compose boundary with automatic HTTPS/WSS and file-backed secrets, a CI-generated container SBOM, disaster-recovery simulator tests, and field runbooks.
- a machine-readable Genesis plan shared by the owner UI and API, with explicit actors, evidence classes, safety boundaries, stop conditions, and ordered next actions.

It is usable as a single-owner fleet edge for lab and migration work, but it is not yet a multi-tenant commercial CSMS and does not certify a charger. Public account delivery, station claiming, billing, remote start/stop, schedules, and smart charging remain explicit future work. The separate local commercial account service is a tested foundation, not a production multi-tenant CSMS. The physical Freedom Test remains the release gate.

```sh
pnpm install
cp .env.example .env
pnpm verify
pnpm dev
```

Use `pnpm migration-manifest --help` to hash the exact owner-held backup/evidence files directly into a secret-free target plan and verify it before authorizing an endpoint-change window.

Open `http://127.0.0.1:5173`, enter `CHARGEOS_OWNER_API_TOKEN`, and point the provisioned test charge point at `ws://127.0.0.1:9000/<CHARGEOS_STATION_ID>` using the configured Basic password. Plaintext WebSockets are local-lab only; internet-facing deployment requires TLS/WSS termination.

For multiple chargers, create an owner-only copy of [`config/stations.example.json`](config/stations.example.json), remove the legacy single-station variables, and set `CHARGEOS_STATIONS_FILE` to its absolute path. The authenticated app opens on the fleet overview when the registry contains more than one charger. Each station keeps a unique Basic secret, independent desired RFID registry, one active socket, and station-scoped API/evidence projection.

For a containerized owner edge, fill a local `.env` (mode `0600`) and run:

```sh
docker compose up --build
```

That command is the explicitly exposed lab profile. For an internet-reachable single-charger owner edge, use `compose.production.yaml`; for the owner-fleet registry use `compose.fleet.production.yaml` with `.env.fleet.production`. In both modes only Caddy publishes ports, OCPP and the owner API use distinct TLS hostnames, and chargeOS receives credentials through read-only secret mounts. Follow the exact preparation and validation steps in [Owner-edge operations](docs/owner-edge-operations.md#production-httpswss-edge).

See [Owner-edge operations](docs/owner-edge-operations.md) for API, persistence, backups, TLS, and recovery.

Create an owner-held recovery bundle after initial provisioning and every authorization change:

```sh
pnpm continuity export \
  --output chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase
```

Field reviewers can verify an exported redacted pack without any owner or recovery secret:

```sh
pnpm field-pack verify --pack /path/to/chargeos-STATION-field-pack.json
```

The passphrase is not stored in the bundle. A recovery drill must inspect and restore the bundle on a separate path before it is trusted. Schema-3 bundles preserve explicit protocol/storage limits and content-addressed archive boundaries. Schema-4 bundles preserve those limits plus a custody-linked compacted operational ledger, while omitted original evidence remains only in referenced full bundles. Restore always disables forwarded-address trust until the replacement proxy topology is revalidated, and the restore manifest flags legacy defaults.

When the active evidence segment approaches its ceiling, use the stopped-edge `archive-stdout` ceremony in [Owner-edge operations](docs/owner-edge-operations.md#roll-over-a-full-evidence-segment). It requires a matching encrypted bundle, emits a post-archive bundle, and never deletes historical evidence. It restores active headroom, not total disk capacity.

For finite replacement-edge storage, use the separate [compacted operational recovery](docs/owner-edge-operations.md#replace-a-full-edge-with-compacted-operational-recovery) ceremony. It requires exact full-bundle custody, verifies the source reference, writes a non-overwriting schema-4 bundle, and installs only to a fresh volume. Keep every referenced source bundle: the replacement can operate without those files, but it cannot reconstruct or substantiate omitted history.

Production Compose owners must use the compiled in-container `export-stdout --passphrase-stdin` ceremony documented in [Owner-edge operations](docs/owner-edge-operations.md#backup-and-recovery); this reads the real mounted ledger/credentials without copying the recovery passphrase onto the edge.

The same runbook documents `restore-production` plus the non-root `install-ledger` ceremony for a fresh Compose project. Both the recovery package and target ledger are create-only, and proxy trust remains explicitly unvalidated until the replacement topology is checked.

Stable version tags publish a `linux/amd64` GHCR image only after production dependencies pass the current advisory check and the exact registry digest passes the complete production runtime drill. The workflow attaches GitHub/Sigstore build provenance, an attested CycloneDX SBOM, and a deterministic release manifest, refuses to replace an existing version, and does not publish `latest`. Follow [Deploy a verified tagged image](docs/owner-edge-operations.md#deploy-a-verified-tagged-image) and deploy by digest; point-in-time supply-chain verification is not charger compatibility or Freedom Test evidence.

Rotate a recovery passphrase by rewrapping the already authenticated bundle into a new non-overwriting file; raw credentials are never restored to disk during rotation:

```sh
pnpm continuity rotate \
  --bundle chargeos-owner.continuity.json \
  --output chargeos-owner.rotated.continuity.json \
  --old-passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --new-passphrase-file /secure/offline/chargeos-recovery-passphrase.next
```

For an independently verifiable chain-head receipt, generate an owner-held Ed25519 key once, sign a verified continuity snapshot, and distribute only the checkpoint plus public key. The detailed ceremony and its limits are in [Owner-edge operations](docs/owner-edge-operations.md#sign-an-owner-evidence-checkpoint).

The dashboard’s Freedom Test panel records exact hardware identity and SHA-256 references to separately held field evidence. A complete checklist is reported as `evidence-complete-unreviewed`; only a reviewed exact model/firmware field record can support a Freedom Matrix grade.

The owner console can issue narrow delegate capabilities without sharing the owner token. Installer grants can read station diagnostics, the migration dossier, and unreviewed field evidence; employer grants can read a tag-free session export; energy-provider grants can read station status. Role ceilings are fixed, every grant expires within 90 days, revocation is append-only, and successful reads are audited. No delegate route can change RFID, charger configuration, firmware, endpoint, or ownership.

The **Liberate my charger** workflow stores only outcomes and SHA-256 references to separately held migration evidence. When all pre-switch checks pass, the owner can authorize a hashed target manifest for 15 minutes to 24 hours. Changing any prerequisite invalidates that authorization. Protocol events count as migrated-path evidence only when a new `BootNotification` arrives after authorization and within the window; the resulting state remains `online-path-observed-unreviewed` until the physical Freedom Test and review succeed.

## Status

**Conditional go.** The software-verifiable slice exists. A witnessed Alfen migration, WAN/backend loss, restart, known-owner charge, unknown-tag rejection, and replay recovery are still required before any “liberated” claim.
