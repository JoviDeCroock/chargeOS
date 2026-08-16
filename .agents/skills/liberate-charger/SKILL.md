---
name: liberate-charger
description: Investigate, plan, implement, and verify owner-controlled EV charger migrations. Use for charger compatibility research, OCPP endpoint changes, local authorization and offline-continuity work, model/firmware Freedom Matrix updates, migration runbooks, continuity bundles, or claims that a charger remains usable without its vendor cloud.
---

# Liberate Charger

Make charger freedom a versioned evidence claim and a real energy-delivery test, never an inference from an OCPP logo.

## Start

1. Read the repository `AGENTS.md`, `VISION.md`, `docs/offline-invariants.md`, and `docs/security-model.md`.
2. Read `references/evidence-schema.md` before researching or changing a compatibility row.
3. Identify exact model/article number, hardware revision, firmware, country, connectivity, current operator, owner/admin credential custody, and contractual constraints.
4. Separate sourced fact, observed field evidence, product decision, inference, and unresolved uncertainty.

## Choose the workflow

- For desk research or matrix updates, follow **Research compatibility**.
- For a real charger, follow **Plan a reversible migration** and then **Run the Freedom Test**.
- For architecture/code, follow **Protect the invariant**.
- For commercial or legal claims, follow **Bound the claim**.

## Research compatibility

1. Search current manufacturer manuals, service knowledge bases, firmware notes, and protocol/certification records. Prefer primary sources.
2. Verify each capability independently: neutral endpoint, protocol/security profile, local admin/recovery, persistent offline authorization, unknown-tag policy, session/meter buffering, configuration/data export, and rollback.
3. Record exact configuration paths and permission dependencies. Vendor-cloud-mediated OCPP is grade C, not direct owner control.
4. Treat missing evidence as unknown. Never lift a field result from one model/firmware to a vendor family.
5. Add verification date, URLs, limitations, and confidence to `docs/charger-freedom-matrix.md`. Put important primary sources in `docs/source-register.md`.

## Plan a reversible migration

Read `GET /api/v1/genesis-plan` or the owner snapshot when a live edge is available. Use its stable next-action IDs to select the current phase, but verify the underlying migration/Freedom evidence and follow the canonical runbook. Never execute an `external-manual` action as if the plan itself authorized or proved it.

Before changing the endpoint:

- prove ownership/authority and identify employer, lease, reimbursement, warranty, and meter constraints;
- record the exact expected OCPP vendor, model, and firmware from supported local/current-backend evidence before switching, retain that evidence separately, and hash it;
- obtain supported local admin credentials and a competent installer for physical work;
- export configuration and transactions and checksum the backup;
- document current network/SIM ownership and the standalone rollback;
- synchronize the owner's credential locally and prove standalone/offline charging when the device permits;
- pre-provision the exact station identity and unique secret on the new gateway;
- export an encrypted owner continuity bundle, keep its passphrase separately, and restore it onto a fresh path before relying on it;
- if rotating recovery custody, rewrap into a new non-overwriting bundle, inspect it with the new passphrase, and repeat the fresh-path restore drill before retiring the old pair;
- stop if any rollback or essential-use precondition is missing.

Use the owner console migration dossier to record each canonical prerequisite as confirmed or blocked with a SHA-256 reference to evidence kept elsewhere. Readiness is not authorization. Build the separately held target with `pnpm migration-manifest create`; prefer one direct `--*-file` input per final evidence artifact so chargeOS hashes the exact stable non-symlinked bytes, and use the matching `--*-sha256` only for an already-custodied digest. Never hash a raw credential, RFID, or recovery passphrase or place evidence content/path in the target. Require the owner to select that file for a 15-minute-to-24-hour authorization; the API must match it to the exact inventory, checkpoint hashes, and transport and persist only its canonical hash. Run `pnpm migration-manifest verify --expected-sha256 ...` immediately before the endpoint change. Keep endpoint values and secrets outside the ledger. Any changed prerequisite invalidates that authorization. Protocol evidence counts only after a new Boot arrives inside the authorized window.

Never instruct enclosure opening, SIM changes, or electrical work while energized.

Do not make migration authorization depend on a chargeOS `BootNotification` that can only arrive after the endpoint change. Use the evidenced pre-switch inventory for readiness, then require the first Boot inside the owner-authorized window to match vendor, model, and firmware exactly. Treat missing values or any mismatch as a stop condition; preserve the event, investigate, amend inventory only with new evidence, and require a new authorization.

## Run the Freedom Test

Follow `docs/freedom-test.md` exactly. A pass requires actual energy delivery:

1. online charge and start/meter/stop evidence;
2. owner charge after WAN/backend loss;
3. unknown-tag rejection;
4. station restart while isolated and a second owner charge;
5. local-edge loss test where applicable;
6. reconnect, buffered-event replay, and deduplication;
7. successful rollback or independent restore from the continuity bundle.

Redact raw RFID, secrets, address, public IP, Wi-Fi, and personal meter/session details. Publish model/firmware/environment and limitations.

Use the owner console to start an explicitly confirmed field run only after the exact authorized Boot and all automatic online checks pass. The run must bind the device-inventory, migration-authorization, and authorized-Boot evidence events; every witnessed step must name that active run and a SHA-256 digest of separately held evidence. A changed inventory or authorization baseline makes the old run stale and requires fresh witnessed outcomes. Never let legacy or foreign-run observations carry forward. `evidence-complete-unreviewed` means the record is ready for review, not that the charger is certified or liberated. Review the exact device/environment before changing a Freedom Matrix grade.

Export the redacted field review pack for handoff and run `pnpm field-pack verify --pack <file>` before review. Internal artifact hashes and matching chain anchors detect pack mutation but do not verify the owner, time, external evidence, physical behavior, or grade. Keep the encrypted continuity bundle separate because the review pack cannot recover the edge.

When a qualified installer needs software visibility, issue an expiring installer capability from the owner console. Never share the owner API token. The installer token is read-only, its secret is displayed once, and it must be revoked after the witnessed work. A delegate capability never authorizes electrical work, endpoint changes, firmware, RFID synchronization, or a Freedom grade.

## Protect the invariant

For code or architecture changes:

- keep the owner as immutable root and delegates scoped, expiring, and auditable;
- reject unknown stations and tags by default;
- for a fleet, resolve every API, delegate, protocol, tag, migration, and evidence operation to one provisioned station before acting; use a unique station credential and tag registry, keep one socket per identity, test sibling-station isolation, and never describe one shared owner token as tenant isolation;
- refuse incomplete recovery artifacts: the current continuity bundle is single-station, so multi-station mode must remain visibly unrecoverable until a versioned fleet format restores every current station secret/tag set and ledger boundary on a fresh edge;
- separate desired state from station-acknowledged state;
- pair local-list results to exact command revisions, advance observed tags only on `Accepted`, and keep pending additions and stale-access revocations visible without persisting raw RFID;
- manage runtime owner tags only through the owner-authenticated desired-state workflow; never expose raw identifiers, remove the final desired credential, auto-synchronize after a change, or claim a revocation reached the charger before its replacement full list is accepted;
- preserve local owner authorization during cloud, DNS, WAN, and edge failure;
- use a replaceable protocol adapter; do not leak engine schemas into the owner domain;
- preserve and verify the evidence hash chain, and test encrypted recovery on a replacement edge without overwriting existing state;
- for evidence rollover, stop the edge, require an exact matching pre-archive bundle and explicit owner confirmation, atomically move the active bytes into a contiguous content-addressed owner-only segment, append a linked archive audit, create/inspect a schema-3 post-archive bundle, and restart from the combined chain; never delete historical segments or claim rollover reduces total storage;
- for finite edge storage, compact only from an authenticated full bundle that remains off-edge, require the exact custody/fresh-edge confirmation, create a non-overwriting schema-4 `compacted-operational` bundle with exact source-byte digest and explicit carry-forward hashes, verify the referenced source, restore/install into a fresh path and empty volume, and prove replay/projections on the replacement before traffic moves; never mutate the live ledger, erase the old edge, discard referenced bundles, or present the compacted ledger as complete historical evidence;
- version safety-relevant recovery configuration, preserve explicit OCPP resource and evidence-capacity limits, and boot the recovery test from the generated environment; reset forwarded-address trust to off because a replacement host must revalidate its proxy topology before enabling it, and expose any legacy defaults in the restore manifest;
- prove the hardened production deployment can export its encrypted bundle using the compiled in-container CLI without placing the recovery passphrase in arguments, environment, layers, files, or the edge volume; authenticate the emitted envelope outside the container before treating that path as operable;
- drill production recovery into a new owner-private package and empty persistent data target: require fresh DNS/ACME inputs, retain an explicit unvalidated proxy-topology gate, keep secrets as read-only mounts, verify the chain before and after a flushed non-root create-only install, refuse merge/overwrite, and boot a replacement container from the installed state;
- bind Accepted/Invalid authorization into transaction starts, retain raw retries, deduplicate exact retries in projections, and expose conflicting stops without rewriting the first projected energy result;
- when preparing owner continuity, require exact owner confirmation and a complete preflight before mutation; only move the three canonical OCPP local-authorization settings toward the invariant when explicitly writable, audit every command/result, keep tag synchronization and restart separate, and require a later authenticated Boot plus reinspection after `RebootRequired`;
- state effects on every failure row in `docs/offline-invariants.md`;
- add simulator tests, but never substitute them for a field Freedom Test.

For deployment-boundary changes, also:

- keep the default Compose file explicitly lab-only and keep production application ports off the host;
- terminate OCPP WSS and owner HTTPS on separate hostnames while retaining application-level station and owner authentication;
- keep forwarded-address trust default-off and enable it only behind the machine-checked single-proxy topology;
- keep OCPP payload, connection, malformed-message, and valid-call bounds explicit; tune from captured exact-device behavior and treat a limit-triggered disconnect as backend loss in the Freedom Test;
- preserve the narrow `ocpp-rpc` private-schema URN normalization while advisory-fixed AJV/fast-uri require valid identifiers; never rewrite wire method names, and remove the patch only after equivalent upstream behavior passes protocol, replay, audit, and production-runtime gates;
- keep evidence storage hard-bounded and append-atomic; capacity exhaustion must preserve the previous chain, degrade health, and fall back to charger-local authorization rather than truncating evidence;
- use an owner-held Ed25519 checkpoint when a third party needs to verify a selected chain head without the continuity secret; keep the private key off the edge and distinguish signature validity from identity, timestamp, and physical evidence truth;
- inject station, owner-token, and owner-tag material through mutually exclusive read-only secret files into the non-root container;
- validate the resolved Compose model, proxy configuration, non-root boot, health route, identity-bound authorized Boot, capability inspection, local-list acknowledgement, and online start/meter/stop path in CI;
- regenerate the deployed-image SBOM after dependency or base-image changes and state what it does not attest;
- for stable container releases, bind the exact SemVer tag to the source version, use full-SHA actions and least privilege, fail on current production advisories, test the registry candidate by immutable digest, attach build-provenance and CycloneDX attestations, refuse version overwrite, and promote only after every gate; deploy by digest and never present point-in-time supply-chain evidence as charger or Freedom Test evidence;
- leave volumetric DDoS, evidence-integrity, and physical-test gaps visible instead of calling the stack production-certified.

## Bound the claim

- OCPP support does not prove a selectable endpoint or local authorization.
- The EU Data Act supports access to readily available data, not admin credentials or firmware.
- EPBD interoperability/data language is scoped by building and transposition conditions.
- AFIR primarily governs public charging.
- A charger session is not automatically fiscal- or reimbursement-grade.
- "Survives company failure" means essential owner charging; name which management functions degrade.

Update the relevant canonical repository doc in the same change as behavior or a public claim.
