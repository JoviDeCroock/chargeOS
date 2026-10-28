# Charging-service product experience

Implementation started 2026-10-28. Current local entry: `/preview`. Scope and acceptance remain in [the replacement plan](product-parity.md) and [feature register](product-parity.json).

## Current implementation

`src/product/` implements a responsive, explicitly fictional product preview across driver, employer/finance and operator/support workspaces. Its 21 routes cover charging, activity, reimbursement, cards, public discovery, support, drivers, sites, policies, documents, reporting, incidents, migrations and integration dependencies. Normal, offline, empty, loading and error scenarios are available.

Session inspection, search/location filtering, sample CSV export, held-versus-approved money, simulated approval and in-memory support cases are interactive. Sample approval never becomes settlement. Public map locations, accounts, network availability, financial records and device state are fictional. The sample tariff is an illustrative input, not a current reimbursement recommendation.

The entry module loads the preview separately from the authenticated owner-console model. The preview neither requests the owner API nor sends charger commands, messages or payments. All demo changes are memory-only and reset on full reload. `/` still opens the existing owner console. Workspace selection demonstrates navigation, not authentication or a tenant boundary.

This completes an implemented design prototype, not commercial parity. Employer authentication, device control, policy calculation, notifications, payment execution, staffed support, roaming and integrations need the implementation/evidence levels in the feature register. The [local observation workspace](local-observation.md) now provides real read-only import and deterministic draft calculation while ThreeForce stays connected. It is separate from fictional preview values and still carries no commercial approval or payment authority.

## Experience decisions

- Use a light, quiet surface with dark ink, restrained green and a lime accent; keep the current engineering console visually separate.
- Driver navigation is phone-first: overview, charger, activity, reimbursements, public charging, cards and help. Mobile activity must preserve amounts and status without relying on a cut-off desktop table.
- Employer work centers on employee/card assignment, sites, policy versions, exceptions, approvals, statements and reporting.
- Operator work centers on charger health, incidents, money exceptions, migrations and independent integration arrangements.
- Every pending, held, rejected, timed-out, offline, stale or missing result has an explanation and next action. A successful request is not an observed device outcome or settled payment.
- Use local assets and system typography. The preview does not load external maps, fonts, network data or analytics.
- Maintain visible preview/sample labels across every route, accessible names, keyboard focus, dialog Escape/focus restoration and reduced-motion support. Language coverage, screen-reader QA and native/PWA delivery remain open work.

## Commercial domain boundaries to implement

The [commercial account workspace](commercial-service.md) at `/service` now implements real local accounts, MFA/recovery, organizations and driver/finance invitations. These records use separate Worker/D1 persistence and typed contracts, rather than preview fixtures. The [reimbursement workspace](reimbursement-statements.md) now connects dated member/vehicle/card-alias/cost-center assignments, immutable rate versions, server-calculated drafts, fresh-MFA finance review and driver-scoped evidence. Production delivery, household/station authority, statutory documents and settlement remain unfinished. [Approved corrections](reimbursement-corrections.md) now expose both snapshots, differences, separate-person MFA review, full cancellation and a driver-scoped journal without changing payment status.

| Record                                      | Authority and relationship                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Account and session                         | A real authenticated person; recovery and MFA do not follow from possession of a charger ID.                                              |
| Household owner                             | Root authority over the owned station and essential charging; employer offboarding cannot erase it.                                       |
| Organization membership                     | Role, tenant and effective dates; no unrelated organization can read the household or another employer.                                   |
| Employment/vehicle/card assignment          | Effective-dated business eligibility, with pseudonymized operational identifiers.                                                         |
| Site, station and connector                 | Exact provisioned device identity, owner, connection capability and observed state.                                                       |
| Command intent and outcome                  | Scoped caller, explicit station, revision/deadline, device acknowledgement and observed effect; these survive process loss.               |
| Session observation                         | Source provenance, event identity, timestamps, energy and conflicts; immutable evidence is separate from a derived billable decision.     |
| Policy version and decision                 | Approved rules/effective period, eligible party, rate/currency/rounding and a reproducible per-session result.                            |
| Statement and correction                    | Frozen approved monetary records; correction links to prior versions without overwriting them.                                            |
| Funding, payment instruction and settlement | Distinct lifecycle records; idempotency and reliable confirmation prevent double payment or false Paid status.                            |
| Support case and incident                   | Affected party/resource, ownership, evidence, status, next action and access audit.                                                       |
| Partner and external charge record          | Contracted capability, independent identity/reference, imported provenance, final financial record and dispute/settlement reconciliation. |

The preview fixtures are not this persistence/authentication model. Implement commercial records behind typed shared contracts and transactional storage, preserving the existing evidence and charger-local invariants.

## Verification

The interaction suite covers zero live API calls, memory-only demo actions, approval versus held money, session filtering/detail, support-case creation and recoverable error/offline states. A Chrome walkthrough covers every desktop route, representative phone routes, modal Escape, simulated approval, error recovery and continued access to the original console. These checks do not prove hardware, commercial accounts, money movement or provider parity.
