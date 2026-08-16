# Contributing to chargeOS

chargeOS welcomes changes that increase owner control without weakening offline essential charging. Read `VISION.md`, `AGENTS.md`, and `docs/README.md` before changing behavior or public claims.

## Development

```sh
pnpm install
pnpm verify
```

Keep a change narrow and update the canonical document with its behavior. Charger-facing behavior needs a simulator test and an explicit review against every failure in `docs/offline-invariants.md`. Compatibility evidence must name the exact model, hardware revision, firmware, configuration path, date, source, and confidence.

Never put charger secrets, API tokens, raw RFID values, personal session data, or proprietary configuration exports in an issue, fixture, commit, or log. Use synthetic identifiers in tests.

The `ocpp-rpc` dependency currently needs the narrow patch in `patches/ocpp-rpc@2.2.1.patch` because its private schema IDs are not valid URNs under advisory-fixed AJV/fast-uri. Keep the patch and workspace overrides together. An upstream upgrade may remove them only after the full OCPP, API, recovery-replay, production audit, and container runtime gates pass.

## Pull requests

Explain the owner outcome, trust-boundary effect, offline failure-mode effect, verification performed, and unresolved field evidence. A green simulator suite is not permission to call a charger liberated. That claim requires the witnessed Freedom Test.

## Releases

Stable container publication is tag-driven and create-only. Update `package.json`, merge the fully verified source, then create an exact `vMAJOR.MINOR.PATCH` tag on that revision. Do not move or reuse a released tag and do not publish a mutable `latest` image. The workflow must reject current production advisories and test the exact GHCR candidate digest before provenance/SBOM attestation and final version promotion. A release failure is investigated from the candidate and workflow evidence; never bypass the gates with a manual version-tag overwrite.
