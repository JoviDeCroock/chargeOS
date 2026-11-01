# Offline invariants

## The exact promise

An owner credential that was successfully synchronized before failure can start a real charge at the configured essential-use power after chargeOS, the internet, DNS, and vendor clouds become unavailable.

This does not promise remote management, immediate revocation, reimbursement processing, tariff updates, or new-user enrollment while offline.

## Certification preconditions

For OCPP 1.6J, discover and record support for the equivalent of:

- `LocalAuthListEnabled = true`;
- `LocalAuthorizeOffline = true`;
- `AllowOfflineTxForUnknownId = false`;
- a local list capacity large enough for the owner's essential credentials;
- a persisted local-list version that can be read or behaviorally verified;
- transaction and meter buffering limits.

Configuration key names and writeability vary. Absence, ambiguity, or a device that accepts unknown tags is a failed owner-continuity test, not a reason to assume success.

## Failure matrix

| Failure                               | Must continue                               | May degrade                        | Recovery evidence                                  |
| ------------------------------------- | ------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| Hosted control plane unavailable      | Pre-authorized owner charging               | Remote UI, updates, delegates      | Local start and meter/session replay               |
| WAN/DNS unavailable                   | Pre-authorized owner charging               | Any remote function                | Start while offline, then reconnect                |
| Local edge powered off                | Charge-point local owner authorization      | Local UI and immediate persistence | Start with edge off; restore edge                  |
| Charge point restarts while isolated  | Owner list and essential setting persist    | Buffered diagnostics               | Power-cycle, start a second real charge            |
| Company/domain disappears permanently | Charging plus owner-held recovery procedure | Hosted features                    | Continuity bundle deploys a replacement endpoint   |
| One week disconnected                 | Existing owner tags                         | New tags, revocations, tariffs     | Measured device buffer capacity and reconciliation |

## Effect of the owner-edge MVP

Optional BYOK AI troubleshooting is an owner-console convenience. Provider, search, relay, backend, WAN/DNS, edge, or permanent-company loss removes advice only and cannot change an acknowledged local list or essential settings. An isolated charge-point restart and week-long buffering still need exact-device evidence; AI output supplies none. Recovery does not contain provider keys or depend on an AI account. See [AI troubleshooting](ai-troubleshooting.md).

The implemented gateway, owner API, and UI do not sit in the safety-critical authorization path once a local list is acknowledged:

- hosted control-plane or WAN/DNS loss has no implemented cloud dependency;
- owner API/UI loss removes inspection and management only;
- local edge loss stops live persistence and OCPP responses, so essential charging depends entirely on the already-synchronized charger list;
- charge-point restart while isolated is not simulated as proof; list persistence still requires the physical test;
- permanent project/domain loss is covered at the software layer by source, container recipe, and an encrypted owner-held bundle that restores verified configuration and ledger state onto a fresh path; the owner must still custody the separate passphrase and perform recovery drills;
- the current recovery schema preserves explicit protocol and evidence-capacity limits, but deliberately resets forwarded-address trust to off because a replacement host has not yet proven the old proxy topology; legacy bundles substitute documented safe defaults and expose that fact in their restore manifest;
- production bundle export is a control-plane operation performed inside the running non-root edge; if the edge is already unavailable it cannot create a newer snapshot, but that does not alter the charger-local list or owner authorization, and recovery uses the most recently drilled owner-held bundle;
- replacement production recovery is create-only: it packages credentials and a verified ledger separately, refuses existing host/package and volume ledger targets, and boots a second edge only after fresh proxy/DNS/certificate validation; failure leaves charger-local authorization unchanged and requires retry on a new empty path rather than editing evidence;
- week-long buffering is model/firmware evidence and cannot be inferred from the simulator.

Fleet mode does not combine charger authority. Each configured station has a unique backend credential, one independent connection, its own desired RFID state authenticated by its own key, and charger-scoped projections/actions. A gateway, fleet UI, or sibling-station failure cannot edit any station's already-acknowledged local list; every charger falls back to its own local authorization under the same failure rows above. The aggregate fleet endpoint is projection-only. The current encrypted continuity format is intentionally blocked for a multi-station process because it cannot yet recover every current raw tag registry and station secret; operators needing the full permanent-company-loss guarantee must keep one station per recoverable edge until a versioned fleet recovery bundle passes replacement-edge drills. The owner-private stations file alone is bootstrap custody, not a current continuity bundle after runtime RFID changes.

The synchronization endpoint re-inspects the configuration and local-list version immediately before a complete list replacement. Any failed or unknown required capability blocks the command. A disconnected station returns pending/failure semantics and is never shown as synchronized.

Owner-tag management is a separate control-plane operation. Adding a tag stores it in authenticated desired state but does not make it usable at the charger until a later complete-list synchronization is accepted. Revoking a tag removes it from online chargeOS authorization immediately, but the charger may continue accepting its stale local copy until that same acknowledgement; the exact confirmation and owner view state this risk. Neither operation auto-synchronizes, neither can remove the final desired owner credential, and both are unavailable with the edge/API down. During every such failure, previously acknowledged owner credentials behave exactly as before, while additions remain unavailable and revocations remain pending. Continuity export includes the current desired set so replacement recovery does not fall back to the stale bootstrap seed.

The owner-continuity preparation endpoint is a bounded, one-way prerequisite repair. After exact owner confirmation, it completes a read-only preflight before sending any command and may request only `LocalAuthListEnabled = true`, `LocalAuthorizeOffline = true`, and `AllowOfflineTxForUnknownId = false` when each mismatched key is explicitly reported writable. Missing, malformed, read-only, or ambiguous keys block the entire operation before mutation. It never changes an endpoint, firmware, electrical setting, tag list, or restart state. Every command and charger result is evidence, and a `RebootRequired` response leaves readiness blocked until a later `BootNotification` and fresh inspection. If the edge, backend, WAN, or UI fails before or during preparation, no setting is moved in an unsafe direction; preparation and synchronization may remain unavailable, while charging continues only for credentials already persisted locally. Charge-point restart and week-long persistence remain exact-device physical-test obligations.

The Freedom Test recorder is evidence-only and cannot send charger commands or alter authorization. Automatic steps cover acknowledged local authorization, a complete energy-increasing online session with meter evidence, and online unknown-tag rejection. A witnessed run can start only after those checks pass and is immutably bound to the exact device inventory, migration authorization, and authorized Boot. Any baseline change makes it stale, and legacy or stale observations cannot satisfy a new run. WAN/backend loss, edge loss, isolated restart, offline unknown-tag rejection, replay reconciliation, rollback, and owner recovery remain witnessed physical observations with external evidence hashes. Starting, staling, or failing a recorder run changes no charger setting or local owner list; every failure-matrix row behaves exactly as before. A completed recorder remains unreviewed and does not weaken any failure-row requirement.

The Genesis next-action plan is also projection-only. Backend, UI, or plan-endpoint loss merely removes guidance; it cannot change the acknowledged owner list or prevent already-authorized local charging. A plan can describe a witnessed outage or supported installer step but cannot cause, simulate, or prove it. Failed or stale evidence produces a stop action, and the final action is independent review rather than an automatic compatibility or liberation result.

The disposable production runtime test exercises the automatic online sequence through the built non-root image and pinned HTTPS/WSS proxy: matching authorized Boot, a complete unsafe-to-safe three-key continuity preparation, connector status, capability inspection, complete owner-list acknowledgement, known/unknown authorization decisions, and start/meter/stop persistence. It deliberately cannot satisfy any failure-matrix row that depends on charger-local behavior, physical isolation, restart persistence, measured buffering, or actual energy delivery.

Delegated access is also control-plane-only. Expiry, revocation, delegate API loss, or compromise of a read token cannot remove a synchronized owner tag, change the local list, or alter the charge point. Delegate reads may be unavailable with chargeOS down; owner charging still follows the charge-point-local invariant.

The migration dossier and direct-file hashing tool are evidence and owner-consent operations only. They cannot change an endpoint, local list, electrical setting, SIM, or firmware. Hashing works without a charger or network and fails before target creation for a missing, empty, symlinked, replaced, or changing file. Pre-switch device readiness comes from an owner-recorded exact inventory with an external evidence digest; it does not circularly require the charger to have already changed endpoints. The first Boot inside the authorized window must match the inventoried vendor, model, and firmware exactly or the online path fails closed. Amending inventory invalidates the old authorization. A blocked or expired dossier prevents software authorization for the planned migration but never disables an already-synchronized owner credential. After an observed endpoint change, the full WAN, backend, edge, restart, replay, unknown-tag, and rollback rows still require the physical Freedom Test.

The production HTTPS/WSS boundary changes online transport, not charger-local authorization. Caddy, DNS, certificate, or mounted-secret failure makes the owner edge unavailable and therefore maps to the existing backend/WAN failure rows; it cannot remove an acknowledged local owner list. Ambiguous or unreadable secret configuration fails startup instead of falling back to an inline value. Recovery still requires the charger-local list during the outage and the owner-held continuity path afterward, both of which remain physical-test obligations.

Connection, payload, malformed-message, and valid-message rate limits are also online-path controls. Exceeding one closes or rejects the backend connection, records only a bounded data-free rate event where applicable, and never edits desired or acknowledged authorization state. The charger must therefore fall back to its synchronized local list exactly as in backend loss. Exact model/firmware traffic must be observed before lowering defaults, and reconnection plus replay must be included in the witnessed test.

Evidence-capacity exhaustion is another backend-loss mode. chargeOS refuses the whole append before altering the hash chain and reports degraded health; it never deletes owner evidence or rewrites authorization state to stay online. OCPP responses that require durable evidence may therefore fail, while already-synchronized owner charging must continue locally. Recovery requires verified continuity evidence and deliberately provisioned capacity, never manual truncation.

Archive rollover is a planned backend outage, not a charger command. The owner first holds a matching encrypted bundle, stops the edge, atomically rolls the active bytes into a verified segment, records the linked audit in a new active file, verifies a schema-3 post-archive bundle, and restarts. During that interval every failure-matrix row behaves like local-edge/backend loss: the synchronized owner list must continue locally, while UI, commands, and persistence degrade. Rollover never changes desired/acknowledged tags, charger settings, transaction evidence, or device behavior. It restores active-file headroom but retains all archive bytes, so total-volume exhaustion still requires more owner-controlled storage rather than deletion.

Compacted recovery is a planned replacement-edge outage and the bounded-storage escape from retained archives. The owner keeps the authenticated full bundle off-edge, creates and verifies a schema-4 operational bundle referencing those exact bytes, restores it into a new path, installs into an empty volume, boots and inspects the replacement, and only then chooses whether to retire the old edge outside chargeOS. The replacement preserves owner-list revision state, transaction IDs/start fingerprints, session outcomes/conflicts/replay counts, current station capability/status, delegate authority, and migration/Freedom projections. Omitted heartbeats, redundant meter/stop frames, prior connector states, archive audits, and older bounded access/rate audits remain available only in the referenced full bundle. Failure at any point leaves the old edge and owner-local charger authorization unchanged. If the full source bundle or passphrase is lost, the replacement can keep operating from its carried state but cannot substantiate the omitted historical evidence; no report may call that history complete. Repeated compaction remains capacity-bounded and fails before mutation when the retained operational index plus append reserve no longer fits.

A tagged image update is also a planned local-edge outage. Provenance/SBOM verification changes only the operator's confidence in the container bytes; it never changes the charge point's acknowledged owner list or proves offline behavior. Before deployment the owner retains a current continuity bundle and the prior immutable image digest. While the edge is replaced, charger-local authorization must continue exactly as in the local-edge-loss row. A failed boot, health check, WSS reconnect, identity match, or capability inspection requires rollback to the prior digest without editing the ledger. chargeOS never auto-updates itself or the charger firmware.

## Effect of local observation and the product preview

The `/observe` browser-only import/calculation workspace and fictional `/preview` product workspace have no charger-facing connection or command path. Browser/network/tool failure removes analysis or preview access only; it cannot change desired or acknowledged RFID state, a charger endpoint, power limits or essential local charging. Imported observations never enter the canonical charger ledger through this tool. Neither a successful draft calculation nor a preview interaction satisfies a physical Freedom Test.

## Availability/security trade-off

Offline authorization cannot simultaneously accept a previously authorized owner and honor an unseen cloud revocation. chargeOS chooses availability for the owner's essential credential and fail-closed behavior for unknown credentials. The UI must expose last synchronization time and pending revocations. Lost owner tags need a physical/local incident procedure; marketing must not claim immediate offline revocation.

## Synchronization invariants

- Desired state and station-acknowledged state are separate.
- Owner-tag add/revoke mutates desired state only; it never implies or triggers charger acknowledgement.
- Only an `Accepted` result paired to its exact `SendLocalList` revision advances acknowledged state. A missing response, crash between command and result, or rejected newer revision remains pending and cannot borrow an older result.
- The owner view shows desired and acknowledged pseudonyms separately. Pending removals are called revocations-at-risk because the old tag may remain usable from charger-local storage until a replacement full list is acknowledged.
- Unknown baseline means full-list replacement, never speculative differential deletion.
- An offline command is pending, not successful.
- Replay is idempotent. Duplicate meter/session messages do not double bill or duplicate reimbursement.
- Accepted authorization is bound into each newly recorded transaction start. Invalid or legacy-unknown starts remain visible but cannot satisfy automatic owner-energy evidence.
- Exact start, meter, and stop retries remain in the append-only ledger but collapse into one projected session. The first valid stop remains authoritative; a different later stop marks the session as an evidence conflict instead of rewriting delivered energy.
- A new transaction ID is not acknowledged until its start record has been flushed to durable storage; concurrent retries reuse that committed ID.
- Receipt times, a keyed fingerprint of each source payload, and a chained hash of each redacted evidence record are retained; secrets, raw protocol frames, and raw RFID values are not.
- Clock drift and out-of-order messages are visible, not silently normalized away.

## Freedom Test gate

A model/firmware combination passes only after:

1. owner credential is synchronized and acknowledged;
2. an online charge produces start, meter, and stop records;
3. WAN/backend is removed without cutting mains power;
4. owner starts and completes a real energy-delivering charge;
5. the station is restarted while still isolated;
6. owner starts another real charge;
7. connectivity returns and buffered records reconcile once;
8. an unknown tag is rejected in both online and offline states;
9. a documented rollback/continuity recovery succeeds.

## Separate commercial accounts

The local commercial Worker/D1 account service has no charger connection, owner credential, edge-ledger access or authorization-list mutation. Losing its process, database, login session, email-delivery path or an employer membership cannot change the previously acknowledged owner list or the OCPP endpoint. Its account/organization tests do not replace any offline or recovery proof above. Household grants and station claiming must preserve these boundaries when implemented; see [ADR 0003](decisions/0003-separate-commercial-worker.md).

The native Node/SQLite account runtime uses those same commercial handlers in a separate loopback process. Its process, database, local outbox, migration failure or configuration failure has the same effect in every failure row: commercial account/finance work may stop, while no owner list, charger endpoint or essential-use setting can be changed through it. It does not add any AI, WAN, cloud or employer dependency to local owner charging and does not constitute commercial disaster-recovery evidence.

Native commercial encrypted backup and quarantined restore have no owner-edge credential or charger command path. Wrong passphrase, damaged snapshot, interrupted output, quarantined startup refusal or permanent loss of this commercial process/bundle can stop account and reimbursement work only. Every failure-matrix row still depends on the previously acknowledged charger-local owner list, exact-device restart/buffering behavior and separately held owner continuity material. Commercial snapshot integrity does not prove physical charging, current financial balances or operational recovery; an unreleased restore stays quarantined until the separate reviewed local finalizer succeeds.

Original-source commercial checkpoints and current recovery-review validation are read-only business preparation. Missing evidence, stale/divergent checkpoints, an unavailable former source, review expiry or a recovery lifecycle lock blocks review only. It cannot alter an owner card list, essential setting, charger endpoint or physical owner root in any failure row. Source-retirement evidence concerns commercial writes and must never be interpreted as authority to disable a charging station or its independent owner edge.

Fresh native recovery enrollment changes commercial authentication state only. A lost setup link, reissued credential, invalidated review, unavailable enrollment listener, interrupted password/TOTP write or draining/stale custody stops setup without affecting an acknowledged local owner card list, endpoint or essential setting. Enrollment has no company, money or charger route and its ready proof cannot release quarantine. Every failure-matrix row continues to depend on the exact device's previously acknowledged offline authorization and separate owner continuity evidence.

Reviewed local commercial release mutates only commercial SQLite roles, eligibility, authentication sessions and recovery provenance. Missing/stale review, unfinished MFA, mutation conflict, release failure, ordinary account restart or a subsequent fresh quarantine cannot change an owner edge's persisted card list, endpoint or charger behavior. No finalizer route or command reaches OCPP. Every failure-matrix row retains the same exact-device proof requirements.

Reimbursement policy, assignment, approval and offboarding mutations affect only commercial SQL state. They have no OCPP command or owner-tag path. Missing account service, finance reviewer, file, MFA device or payment service cannot remove previously acknowledged owner charging access. Offboarding may end future business eligibility while the physical owner remains root.

Approved financial corrections and cancellation remain inside the commercial SQL boundary. Even a zero approved reimbursement balance or revoked employer membership cannot change charger credentials, the owner ledger, OCPP endpoint or acknowledged local authorization.
