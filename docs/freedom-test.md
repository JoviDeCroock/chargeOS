# Freedom Test

The Freedom Test is an open, reproducible certification protocol for a precise charger model, hardware revision, firmware version, connectivity path, and configuration. It does not certify a vendor family by association.

OCA certification establishes OCPP protocol conformance and optional profile support; it does not certify owner-accessible endpoint changes, admin credential custody, cloud independence, factory recovery, or post-company essential use. No widely adopted European consumer label covering this complete owner-control bundle was found in the research cut-off. The Freedom Test should complement, never impersonate, electrical safety, MID, radio/cybersecurity, or OCPP certification.

## Evidence record

Capture:

- device label, model/article number, hardware and firmware versions;
- the pre-switch expected OCPP vendor/model/firmware identity, its external evidence digest, and the exact post-switch Boot match result;
- protocol/subprotocol and endpoint configuration path;
- owner/local admin and factory-recovery path;
- local authorization capacity, key values, list revision, and persistence;
- configuration backup checksum and rollback result;
- timestamps and hashes for relevant OCPP frames;
- actual energy delivered online, offline, and after restart;
- buffered-event replay count and deduplication result;
- unknown-tag results;
- tester, date, environment, observed limitations, and evidence confidence.

Redact credentials, raw RFID identifiers, home address, public IP, Wi-Fi details, and personal meter/session values before publication.

## Implemented recorder

The owner console binds exact device identity and ten versioned steps into the integrity-checked ledger. Before the endpoint change, the owner records vendor, model, and firmware strings from supported label/ACE/current-backend evidence plus its SHA-256 digest. This inventory can satisfy migration identity readiness without requiring an impossible pre-switch chargeOS Boot. It cannot complete the Freedom record: the authorized post-switch `BootNotification` must match all three strings exactly. Missing or different values leave the field record incomplete and stop the migration proof.

Automatically derived only from protocol evidence at or after the matching Boot inside the owner-authorized endpoint-change window:

1. owner authorization list acknowledged;
2. an owner-authorized online `StartTransaction`, `MeterValues`, and `StopTransaction` with positive delivered energy;
3. unknown tag rejected online.

After those three automatic checks pass, the owner must start an explicit witnessed field run by typing the console phrase. The resulting schema-3 run record binds one UUID to the exact device-inventory event, migration-authorization event, and matching authorized Boot event. Every witnessed observation must name that active UUID. A new inventory, new migration authorization, or different authorized Boot makes the old run `baseline-stale`; its outcomes remain auditable but cannot satisfy the current device. Legacy observations without a run UUID remain visible in the ledger but never project as passes.

Witnessed with a SHA-256 digest of separately held evidence:

1. owner energy delivery while WAN/backend are unavailable;
2. owner energy delivery while the local edge is powered off;
3. owner energy delivery after an isolated charge-point restart;
4. unknown tag rejected while offline;
5. buffered events reconcile exactly once;
6. standalone rollback or independent endpoint restore succeeds;
7. the owner continuity bundle starts a replacement edge.

The recorder stores no uploaded photo/video, address, free-form note, raw RFID, or secret. A later observation for the same active run supersedes the projected state while the append-only history remains. A stale or unknown run UUID, invalid automatic-step submission, or malformed evidence digest is rejected.

The session table exposes exact protocol retries and stop-record conflicts. Exact retries are retained as raw evidence but collapse into one session; a conflicting later stop never overwrites the first projected energy result. These diagnostics prove chargeOS reconciliation behavior only. They do not prove that a charger buffered traffic during a physical outage, so the buffered-replay Freedom step remains witnessed external evidence.

Possible overall states are `not-started`, `in-progress`, `baseline-stale`, `failed`, and `evidence-complete-unreviewed`. There is intentionally no automatic `certified` state. The exported report includes its schema-3 run baseline and ledger-chain head and remains unreviewed until the exact device, environment, and external artifacts are examined.

## Grades

- **A — Owner sovereign:** arbitrary documented endpoint, local admin/recovery, persistent owner auth, self-hostable path, full test passes.
- **B — Owner operable:** full test passes but installer/vendor onboarding or model constraints add friction.
- **C — Cloud mediated:** OCPP exists but vendor cloud, permission, or proxy remains in the control path.
- **D — Data only/partial:** useful local API/export but no owner-selectable neutral CSMS or proven offline owner auth.
- **E — Captive:** no supported portable endpoint or essential-use recovery path.
- **U — Unknown:** evidence is insufficient. Unknown is not failure and must not be guessed upward.

## Publication rule

Manufacturer documentation can establish a provisional capability. Only a reviewed field test can establish A/B and only for the tested version. Recorder completeness alone is insufficient. Re-run after firmware changes that affect networking, authorization, storage, metering, or security.

Export the redacted field review pack when handing evidence to a reviewer. Its canonical artifact digests and cross-artifact chain checks make accidental or selective mutation visible, but the pack contains only chargeOS records and hashes of separately held evidence. Verify it with `pnpm field-pack verify --pack <file>`, then review the external artifacts and exact physical environment before assigning any grade.
