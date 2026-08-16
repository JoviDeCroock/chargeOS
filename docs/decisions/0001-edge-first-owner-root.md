# ADR 0001: Edge-first continuity with an owner root

- Status: accepted
- Date: 2026-08-14

## Context

A cloud-only CSMS can manage an OCPP charger, but it cannot honestly guarantee management after the company, domain, credentials, or network disappear. Many chargers can preserve a local authorization list, but their support and persistence vary by model and firmware.

## Decision

The owner is the immutable root principal. chargeOS has two deployable control modes sharing one domain model:

1. A local edge on owner-controlled hardware terminates OCPP and continues basic management without the chargeOS cloud.
2. A hosted gateway offers convenience but must keep a verified local authorization fallback on the charge point and provide a self-hostable continuity bundle.

The charge point's local owner authorization is the final availability layer. The local edge is the second. Hosted services are the third.

## Consequences

- A charger may be "hosted compatible" yet fail owner-continuity certification.
- Revocations and new authorizations cannot become effective while the charge point is offline; the UI must expose last-synchronized state.
- The local edge cannot depend on proprietary cloud-only databases or identity providers for essential operation.
- Energy providers, employers, and installers receive explicit capabilities, never ownership.
- Product claims must separate "charging remains possible" from "every management feature remains available."
