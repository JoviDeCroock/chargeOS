# ADR 0002: OCPP 1.6J first, behind a replaceable engine boundary

- Status: accepted
- Date: 2026-08-14

## Context

OCPP 1.6J has the widest relevant installed base and contains the Genesis needs: boot/status, authorization, transactions, meter values, local authorization lists, configuration, and smart-charging profiles. OCPP 2.0.1 improves security, device modelling, transactions, and ISO 15118 integration, but supporting it first would not prove the ownership invariant.

CitrineOS is a capable Apache-2.0 TypeScript CSMS for OCPP 1.6 and 2.0.1, but its RabbitMQ, Redis, PostgreSQL/PostGIS, object storage, Hasura, and UI stack is disproportionate for one home charger and complicates a small local edge.

## Decision

Build the Genesis gateway with `ocpp-rpc`, using its strict OCPP schemas and security-profile support rather than implementing WebSocket framing. Keep transport messages behind a small domain event/command adapter. Do not expose `ocpp-rpc` or a future CitrineOS schema as the public chargeOS model.

Evaluate CitrineOS or SteVe after the real Alfen test when multi-tenant operations, certification, and device-management breadth justify them. Add OCPP 2.0.1 through a second adapter; treat OCPP 2.1, ISO 15118 Plug & Charge, OCPI roaming, payments, and bidirectional charging as later layers.

## Consequences

- The spike is not a production CSMS.
- Protocol validation and simulation are delegated to maintained OSS.
- Domain events remain stable when the protocol engine changes.
- The first release can be self-hosted without a message broker or control-plane dependency.
