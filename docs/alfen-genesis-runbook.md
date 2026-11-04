# Alfen Genesis migration runbook

This runbook applies provisionally to an Alfen Eve Single S/Pro line charger in Belgium. Exact hardware and firmware must be recorded before use. Alfen documents OCPP 1.6/2.0.1 support on relevant NG-series models, manual backend selection, configuration/transaction export, and standalone local-RFID operation. The likely practical blockers are installer credentials, the charger password, Windows-only ACE Service Installer access, and ownership of a provider SIM—not OCPP itself.

The owner console's **Genesis plan** and `GET /api/v1/genesis-plan` provide the current machine-readable next action. Use them to prevent phase skipping, but treat this runbook and the exact-device supported procedure as authoritative for external work. A plan action is guidance, never proof or permission for physical work.

## Stop conditions

Stop and escalate rather than improvise if:

- the owner cannot prove authority over the charger or contractual constraints are unclear;
- exact model, firmware, configuration backup, charger password, or rollback path is unavailable;
- changing backend would destroy required reimbursement/fiscal records without an export;
- enclosure opening, wiring, or SIM work would occur energized or without a competent installer;
- local authorization cannot be configured and proven before endpoint migration;
- the existing operator will not provide credentials/data and no supported local recovery path exists.

## Phase 0: inventory and custody

Open **Station settings › Switching provider** in the owner console (turn on **Switching provider** under **Preferences › Extra sections** if the tab is missing). Keep original documents outside chargeOS and record only their SHA-256 digests. A blocked checkpoint is a stop condition, not a task to bypass.

Record without changing anything:

- ownership invoice/transfer and current employer/lease/reimbursement obligations;
- label photos, model/article number, NG/AHP platform, hardware and firmware;
- current CPID, backend/provider, Ethernet/Wi-Fi/cellular path, and SIM owner;
- the exact OCPP vendor, model, and firmware identity shown by ACE, a current-backend export, or other supported local diagnostics, with a SHA-256 digest of that separately retained inventory evidence;
- charger admin password availability and ACE installer account;
- Windows laptop, Ethernet access, same-LAN/static-IP plan, owner RFID tags;
- current session/meter export requirements and billing cut-off date.

Alfen's ACE Service Installer is Windows-only. Account creation and charger passwords are separate; obtain both before scheduling physical work.

## Phase 1: preserve and prove standalone

1. Isolate physical work safely; do not open an energized enclosure.
2. Connect locally using the documented ACE path.
3. Export the complete configuration (`.exml`) and transactions (`.csv`); checksum and copy them off the laptop.
4. Photograph/export relevant backoffice, authorization, network, meter, and firmware settings.
5. Add the owner's RFID to the whitelist.
6. Select the documented standalone backend and offline action that accepts known valid tags.
7. If a provider-owned cellular SIM must be removed/replaced, have a competent installer do it with power isolated.
8. Test the owner tag, actual energy flow, an unknown tag, and a charger restart while no backend is present.

Do not continue if standalone essential charging fails. Restore the saved configuration and resolve the device-specific problem first.

Record the configuration export, transaction export, independent standalone rollback, and witnessed standalone owner-charge/unknown-tag evidence in the migration dossier. The backups themselves remain encrypted outside chargeOS.

## Phase 2: prepare the owner endpoint

1. Start the chargeOS gateway on an isolated LAN or EU test host.
2. Pre-provision the exact CPID and a unique secret; unknown CPIDs remain rejected.
3. For LAN discovery only, a temporary `ws://` endpoint is acceptable on an isolated network. For internet transport require `wss://` and validate certificates.
4. Start evidence capture with secrets and raw tag IDs redacted.
5. Keep the saved Alfen configuration and standalone settings ready for rollback.

Record exact station/secret pre-provisioning, the separate continuity restore drill, and the transport plan in the dossier. The exact-device form must contain the pre-switch vendor, model, and firmware strings from supported local/current-backend evidence; it does not require a prior chargeOS Boot. After every pre-switch checkpoint passes, use `pnpm migration-manifest create` as documented in [Owner-edge operations](owner-edge-operations.md#build-the-reversible-migration-dossier). Prefer the direct `--*-file` inputs for the final `.exml`, `.csv`, inventory, rollback, custody, transport, and restore evidence so the CLI computes the exact digests without manual copying; never pass a raw credential, RFID, or passphrase as evidence. Bind the exact `ocppCsmsUrl`, station identity, protocol, credential custody, supported ACE path, transport class, backup/export evidence, rollback, and restore drill into its canonical hash without putting any credential, evidence content, or evidence path in the manifest. The owner—not the installer token—must select that file in the console and create a time-bounded authorization window. The API rejects a file whose inventory, checkpoint hashes, or transport do not match the dossier and persists only its canonical hash.

## Phase 3: migrate to OCPP 1.6J

Only during an active owner-authorized window, first run `pnpm migration-manifest verify --manifest MANIFEST --expected-sha256 AUTHORIZED_SHA256`. Then, in ACE Service Installer on supported firmware, choose manual backend settings, select OCPP 1.6, and enter the `ocppCsmsUrl` from that verified separately held manifest. A hash mismatch is a stop condition. Older firmware and cellular/provider configurations have different steps; use the exact Alfen article for the detected version. The dossier never operates ACE or authorizes physical work.

Expected sequence:

1. `BootNotification` accepted with heartbeat interval and an exact vendor/model/firmware match against the evidenced pre-switch inventory;
2. `StatusNotification` for connectors;
3. `GetConfiguration` for local auth, authorization cache, offline unknown-tag, meter and buffer capabilities;
4. if any of `LocalAuthListEnabled`, `LocalAuthorizeOffline`, or `AllowOfflineTxForUnknownId` is unsafe, an owner-confirmed, complete preflight followed only by the corresponding safe-direction `ChangeConfiguration` commands and fresh inspection;
5. review the durable desired owner-tag pseudonyms, add the intended raw credential through the owner-only console if needed, and send the complete current set with `SendLocalList`; only an `Accepted` result for its exact revision establishes charger acknowledgement;
6. online `Authorize`, `StartTransaction`, `MeterValues`, and `StopTransaction` persisted once.

The dossier derives this sequence only from events following a `BootNotification` received after authorization and inside its window. A pre-existing connection or session cannot satisfy the post-switch proof. A missing or mismatched vendor, model, or firmware value is a stop condition: preserve the unexpected Boot, restore the safe path if necessary, investigate the exact device/configuration, amend the evidenced inventory, and create a new authorization window. Never reinterpret a mismatch as equivalent.

Adding or revoking desired RFID state never synchronizes the charger automatically. A new tag remains unusable locally and a removed tag may remain usable from stale charger storage until a fresh inspection and complete replacement list are accepted. Do not claim revocation from the owner-state mutation alone. Export and inspect a new encrypted continuity bundle after the accepted list change.

Use only documented, reported writable keys. A missing, read-only, malformed, or ambiguous required key is a stop condition and must be resolved through the supported exact-model ACE/configuration path. If a change reports `RebootRequired`, perform only the documented safe restart, wait for a later authenticated Boot, and re-inspect before tag synchronization. chargeOS does not restart the charger or treat the response as ready. Never enable unknown-tag offline charging to make a test pass.

## Phase 4: Freedom Test

Before starting, confirm that the saved exact device identity matches the authorized post-switch Boot and that all three automatic online checks pass. Type the displayed phrase to start a witnessed field run bound to that exact inventory, migration authorization, and Boot. Record every witnessed result against the displayed run UUID; if the console reports `baseline-stale`, stop and start a new run only after the amended inventory and migration path are authorized and observed again. Never reuse old outcomes for changed hardware or firmware. For every witnessed step, hash the separately stored evidence file and record the digest plus pass/failure. Keep the external evidence encrypted and free of unnecessary household details. The console's final state remains unreviewed until the complete exact-device record is examined.

1. Verify a real online charge and session/meter record.
2. Disconnect WAN/backend while leaving charger mains and vehicle path intact.
3. Start and complete a real charge with the owner RFID.
4. Confirm an unknown RFID is rejected.
5. Restart the charger while it remains isolated.
6. Start a second real owner charge.
7. Restore connectivity.
8. Confirm buffered events replay, deduplicate, and close sessions correctly.
9. Export the hash-chained redacted test record and encrypted continuity bundle. Do not call the record independently signed until an external signature/anchor exists.

Also power off the optional local edge and repeat the essential charge test; otherwise only cloud loss was proven.

## Rollback

If endpoint connection or offline behavior is unsafe/uncertain:

1. stop remote commands;
2. restore the saved configuration or documented standalone backend locally;
3. restore the owner whitelist and known-tag offline action;
4. verify real owner charging and unknown-tag rejection;
5. retain failed evidence and mark the exact model/firmware uncertified.

Restoring the old commercial backend requires that provider's cooperation and SIM/connectivity. Standalone is the independent safety rollback.

## Continuity bundle

Deliver to the owner:

- redacted device inventory and compatibility row;
- encrypted configuration backup and checksum;
- transaction export and provenance;
- owner authorization/list revision proof;
- endpoint and local recovery instructions;
- deployable chargeOS version and data export;
- Freedom Test result and limitations;
- custody record for passwords/keys without embedding secrets in ordinary documents.
