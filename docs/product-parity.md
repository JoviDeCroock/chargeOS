# Charging-service replacement and feature parity

Decision date: 2026-10-28. Baseline: `c840ef894c5a029e6c0942bd9a988e11068f0662`. Direction set by the founder: replace 50five, ThreeForce/Last Mile Solutions and D’Ieteren Energy with a polished charging service. Preserve owner authority and charger-local continuity.

## Product target

The target spans driver experience, employer administration, charger operations, home reimbursement, billing/settlement, workplace/guest use, public charging/roaming, migration and support. A session viewer or reconciliation-only product does not satisfy this target. G0/G1 are development milestones; they do not reduce the G2 replacement scope.

The canonical feature register is [product-parity.json](product-parity.json). It contains 46 requirements, provider-specific evidence, current-code status, delivery approach, milestone and acceptance outcome. Update its rows when behavior or commercial delivery changes. Do not maintain a separate competing checklist.

ThreeForce is the legal/platform layer trading as LMS. D’Ieteren’s charging terms identify LMS for transactions, roaming and financial flows; 50five Belgium identifies Threeforce for payments. This is a layered service replacement, not three independent UI comparisons. Provider statements establish published scope, not service quality, customer entitlement or hands-on correctness. See the dated sources in the register and [source register](source-register.md).

## What parity means

Count a requirement as proven only when the complete customer outcome works: permissions, device response, recorded evidence, financial consequences, error recovery and support. A design, simulator, marketing claim or unsigned partner discussion is insufficient. The baseline contains foundations and missing outcomes; no row is called production parity.

Evidence levels progress from design reviewed, to implemented, simulator verified, external/device tested, commercially operable, and accepted for the declared customer contract. Track these separately when implementation begins. A customer may require native mobile behavior, a particular external card, payment timing, supported firmware or installer response that differs from another customer’s package.

For example, 50five Belgium promotes app start/stop but its FAQ restricts that function for a migrated-card cohort. Record that as a restricted/contradictory claim and verify the actual account. Do not turn a general product page into a universal capability checkmark.

## Product experience

The implemented fictional preview is available at `/preview`; see [Product experience](product-design.md) for current interactions, isolation, domain design and verification. This is prototype evidence only; it does not close financial, identity, hardware or operational parity requirements.

Design and build the following workspaces together around the same real domain model:

1. **Driver:** Home shows charging state, current session, next schedule and a useful action. Charger handles credentials, authorized controls and recovery. Activity combines home/work/public sessions with clear location and business/private classification. Money explains sessions, rates, approval and payment. Help starts with the affected session, charger or payment and shows an accountable case owner.
2. **Employer/finance:** Overview, drivers/cards, sites, policies, reimbursements, billing and reports. Lead with items needing action; totals must reconcile to statements and settlement. Joining/leaving and cost centers are first-class workflows.
3. **Operator/support:** Charger health, command history, incidents, money exceptions, migrations and installer appointments. Show acknowledged device state and permission boundaries; make pending/failed operations actionable.

Use restrained typography, clear monetary hierarchy and consistent navigation. A mobile layout must be deliberately designed, not a compressed operations table. Critical actions need honest states: loading, no data, offline, pending, rejected, timed out, conflicting evidence, partial service and recovered. Localized money/dates, keyboard and screen-reader access belong in acceptance. Demonstration values and unavailable integrations must be visibly identified.

The desired reimbursement timeline is sessions recorded → eligibility/rate checked → finance approved → funding confirmed → payment submitted → settlement confirmed. These are separate records; never derive Paid from a generated statement or an estimated date. An exception shows its owner, cause, next action and update time.

## Delivery boundaries

Own the product experience, owner/employee permissions, station/session evidence, tariff/policy logic, financial records, reconciliation, support accountability and export/exit contract. An independent payment provider may execute collections/payouts; an independent roaming partner may supply network agreements and card operations; installers and an urgent-support partner may supply physical work and coverage. Their integration must be real, exercised and commercially arranged before counting parity.

Because the ambition includes replacing ThreeForce, an LMS white-label front end is not completion. Any interim dependency on a company being replaced must be explicit, time-bounded and removable; it is not independent parity. A map does not create roaming agreements, an IBAN field does not execute payouts, and a support button does not provide staffed coverage.

## Delivery sequence and switching gates

### G0: Design and observation

Polished role-based prototype and read-only historical reconciliation. ThreeForce remains the live manager. G0 proves product understanding and data handling, not replacement readiness.

### G1: Home/employer service

Customer/employee accounts, charging, money, support, privacy and recovery work end to end. This is an engineering milestone; it does not authorize switching a customer who also needs G2 features.

### G2: Home, workplace and public replacement

All applicable G1 and G2 features are proven, independent roaming/payment/installer arrangements exist, and the actual customer’s contract has a signed-off parity manifest. This is the broad charging-service replacement target.

### G3: Full platform and energy expansion

Reseller platform, broad AC/DC/depot capability and additional energy products. Keep these in the register; include them in a customer’s gate whenever their existing service depends on them.

Build in vertical slices: one approved employee and charger → authentic session → applied policy → issued statement → funded payout → bank match → resolved exception. Then expand that same chain to guests, workplace sites and public roaming. Design the complete navigation and failure paths at G0 so architecture and UX do not grow around a disconnected single screen.

Before a switch, maintain a customer-specific parity manifest listing the current provider, contracted features, exact hardware/firmware, cards/networks, tariffs, financial cut-off, support coverage and evidence for each applicable register row. Require all applicable rows to pass; any remaining exception must be explicitly accepted by that customer. Do not redefine missing functions as optional without that agreement.

## Protect the existing ThreeForce connection

The functional `/observe` workspace now implements local CSV mapping, original-byte fingerprints, explicit-policy calculations, duplicate/conflict handling, draft export and declared-amount comparison. See [Local observation](local-observation.md). Vendor-specific format adapters, true statement/bank imports and commercial approval remain open.

During G0, use authorized configuration/session exports, statements and payment records, plus an isolated simulated charger. P38 now has a generic local import foundation; an exact provider-format adapter still requires actual export evidence. No OCPP endpoint/profile, APN, SIM, firmware, RFID list, charging schedule or electrical setting changes belong in observation mode. A proxy insertion also changes the live path and is not read-only verification.

Run the final exact-device migration/offline test only in an explicitly authorized maintenance window with saved configuration, historical transactions, financial cut-off and verified rollback, or use a separate representative charger. Broader commercial parity does not eliminate the physical Freedom Test.

## Architecture and current blockers

The current fleet is one owner domain; it is not a multi-tenant service. Current continuity is single-station. Add transactional customer and financial storage, scoped identity, a durable command lifecycle and versioned integrations while preserving [contracts](../shared/contracts.ts), [evidence](../server/events.ts), [security](security-model.md) and [offline invariants](offline-invariants.md).

A real local account/organization service now runs as a separate Cloudflare Worker with D1/SQLite. [ADR 0003](decisions/0003-separate-commercial-worker.md) limits it to commercial records and keeps owner-edge state separate. [The service guide](commercial-service.md) records verified local workflows and remaining public delivery, station authority, financial and portable-restore gaps.

Cloudflare remains a hosting candidate for the full service, not a readiness result. A Worker/static app and EU-jurisdiction station Durable Objects need explicit transport/storage adapters and portable restore evidence. A persistent Linux backend is the lowest-change field-test path. The original architecture decision about proprietary canonical state must be reviewed before any hosted-state replacement; this document does not approve that runtime change.

Baseline checks from 2026-10-28: formatting, lint, TypeScript and app build pass; Windows tests are 66 passed/21 failed with filesystem/recovery assumptions, and release validation fails on a POSIX mode assertion. Historical Linux CI passed all 87 tests but failed its Caddy capability runtime check. The original production audit reported ten fast-uri advisories. The local override has since been updated from 3.1.5 to 3.1.9; the 2026-10-28 production audit now reports zero advisories. The full updated-dependency suite has 85 passes and the same 21 recorded Windows failures. After the local commercial account slice, the owner suite has 88 passes and those same 21 failure titles; 10 additional Worker/D1 tests and three focused account UI regressions pass. Chrome verifies registration, organization/invitation/offboarding and authenticator sign-in. Release validation now pins fast-uri 3.1.9 correctly, then reaches its existing Windows manifest-mode failure. The runtime attempt stops at its POSIX `/tmp` assumption; Docker is also unavailable. The fresh Linux/Docker runtime and Caddy capability check remain unresolved before public deployment. These are current observations, not new test results from this documentation change.

## Current local reimbursement implementation

The `/service` account boundary now includes [dated assignments, immutable policies and frozen statements](reimbursement-statements.md). Current service validation is 18 passing Worker/D1 tests plus the inspected three-account Chrome workflow; the earlier account-only result above remains historical. The server recalculates explicit CSV inputs, minimizes unrelated data and requires another finance reviewer’s current authenticator code for exact-snapshot approval. Unique session reservations prevent duplicate approval within one organization; ending eligibility flags old drafts/approved records without rewriting history. Rejected snapshots support linked revisions. [Approved corrections and journal](reimbursement-corrections.md) now preserve original snapshots, append reviewed adjustment receipts and retain original-root session reservations; full cancellation and current balances are implemented locally. No payment, bank confirmation, tax invoice, statutory credit note, post-settlement reversal or physical owner grant is implied. Chrome and Worker/D1 proof use synthetic sources and local accounts; actual customer/provider/contract acceptance is still required.

## Next implementation packages

1. **Account/domain design and polished complete prototype:** agreed personas, entity/permission boundaries, route map and failure-state designs across all three workspaces; clearly mocked external functions.
2. **Observation/import and money kernel:** provenance-preserving import, policy versions, employee eligibility, decimal/rounding rules, draft/approved statements, exception workflow and independently checked example month.
3. **Commercial service foundation:** tenant/account isolation, charger claiming, command lifecycle, notifications, support, portable multi-station recovery and production baseline repair.
4. **Independent financial delivery:** invoicing, collection/funding, payout confirmation, corrections, reconciliation, subscriptions and customer accounting handoff.
5. **Workplace/public ecosystem:** guest tariffs, safe energy integrations, roaming both ways, map/card/app flows, ad-hoc payment and real support/installer arrangements.

Each package requires implementation evidence and partner dependencies before a delivery estimate. No percentage-ready claim or launch date follows from a count of checklist rows.
