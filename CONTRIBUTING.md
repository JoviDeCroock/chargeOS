# Contributing to chargeOS

chargeOS welcomes changes that increase owner control without weakening offline essential charging. Read `VISION.md`, `AGENTS.md`, and `docs/README.md` before changing behavior or public claims. Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js 22. The commercial SQLite runtime is tested on 22.22.x.
- pnpm 11 (`corepack enable` picks up the pinned version from `package.json`).
- Docker, only for the deployment and runtime checks (`pnpm verify:runtime`, `pnpm verify:managed-runtime`).

## Development without a charger

```sh
pnpm install
cp .env.example .env    # then replace every placeholder; keep the file mode 0600
pnpm dev                # OCPP gateway on :9000, owner API on :9080, web UI on :5173
pnpm simulate --session # in a second terminal: a synthetic charge point runs one owner charge
```

Open `http://127.0.0.1:5173` and sign in with `CHARGEOS_OWNER_API_TOKEN`. The simulator reads the station identity, password and first owner card from `.env`, stays connected, and answers configuration, local-list and reset commands, so you can exercise inspection, owner-continuity preparation and card synchronization from the console. Run `pnpm simulate --list-profiles` to see the behavior profiles (for example `unsafe-defaults`, `upper-case-uid`, `local-list-unsupported`).

Simulator profiles are named after a protocol behavior, never a brand. A profile working against chargeOS is not evidence that any real charger works.

The built-in simulator and chargeOS share one reading of the specification. To check against an independent implementation, run `pnpm interop:everest` (Docker; the EVerest image is about 16 GB on first pull). It points [EVerest](https://github.com/EVerest)'s OCPP 1.6J charge point at a throwaway edge and runs the following, which takes about five minutes:

- owner-continuity preparation and card synchronization;
- an online session;
- backend loss with an offline owner session and a refused unknown card;
- replay after chargeOS returns;
- remote start and stop;
- a remote reset followed by a restart while chargeOS is down.

Run it after changing the gateway, authorization, readiness checks or remote commands. It is interoperability evidence, not device evidence.

## Checks

Fast loop while you work:

```sh
pnpm test        # owner-edge unit, protocol-simulator and UI tests
pnpm typecheck
pnpm lint
pnpm format      # oxfmt; CI runs pnpm format:check
```

Before you propose a change, run the full gate:

```sh
pnpm verify
```

If you change the production image, proxy, secret mounts, network boundary, OCPP transport, authentication or redaction, also run `pnpm verify:runtime` (Docker). It is a disposable synthetic runtime proof, not device evidence.

Keep a change narrow and update the canonical document with its behavior. Charger-facing behavior needs a simulator test and an explicit review against every failure in `docs/offline-invariants.md`.

Never put charger secrets, API tokens, raw RFID values, personal session data, or proprietary configuration exports in an issue, fixture, commit, or log. Use synthetic identifiers in tests.

The `ocpp-rpc` dependency currently needs the narrow patch in `patches/ocpp-rpc@2.2.1.patch` because its private schema IDs are not valid URNs under advisory-fixed AJV/fast-uri. Keep the patch and workspace overrides together. An upstream upgrade may remove them only after the full OCPP, API, recovery-replay, production audit, and container runtime gates pass.

## Contributing charger evidence

Field evidence from a real device is the most valuable contribution, and also the easiest to get wrong. Use the **Charger evidence** issue form. It asks for exactly what a [Charger Freedom Matrix](docs/charger-freedom-matrix.md) row needs: model/article number, hardware revision, firmware, configuration path, observed behavior, evidence link, observation date and confidence.

- Report what you observed on one exact device. Never generalize to a brand or a product family.
- Redact before you share. Use the console's redacted export or field pack, never an encrypted continuity bundle, a password, a station secret or a raw card number.
- Opening an enclosure, touching wiring or changing a SIM is installer work with the power isolated. Don't do it to produce evidence, and don't describe it as a software step.
- A passing simulator, a successful online session or `evidence-complete-unreviewed` is not a compatibility or liberation result. Only a reviewed, witnessed Freedom Test can support a matrix grade.

## Pull requests

Explain the owner outcome, trust-boundary effect, offline failure-mode effect, verification performed, and unresolved field evidence. The pull request template prompts for each. A green simulator suite is not permission to call a charger liberated. That claim requires the witnessed Freedom Test.

## Releases

Stable container publication is tag-driven and create-only. Update `package.json`, merge the fully verified source, then create an exact `vMAJOR.MINOR.PATCH` tag on that revision. Do not move or reuse a released tag and do not publish a mutable `latest` image. The workflow must reject current production advisories and test the exact GHCR candidate digest before provenance/SBOM attestation and final version promotion. A release failure is investigated from the candidate and workflow evidence; never bypass the gates with a manual version-tag overwrite.
