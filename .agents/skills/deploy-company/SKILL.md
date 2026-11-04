---
name: deploy-company
description: Plan or deploy chargeOS for a company that runs chargers for employees (office chargers, chargers at employees' homes, reimbursement). Use for company-profile and fleet owner edges, the employer workspace (company accounts, reimbursements, support cases), employee pages and finance feeds, ownership decisions between company and employee, hosting choices, and whether a host can serve as the central hub for employees.
---

# Deploy for a company

"Company deployment" is two separate systems. Keep them apart in every plan:

| System                 | Code       | What it does                                                                                              | Deployment                                                                                      |
| ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Company owner edge** | `server/`  | Connects chargers over OCPP, holds card lists, employee pages (`driver`), finance feed (`finance`), usage | Owner-edge profiles with `CHARGEOS_PROFILE=company`; fleet via stations file or **Add charger** |
| **Employer workspace** | `service/` | Accounts, organizations, invitations, reimbursement statements, support cases, email                      | `compose.company.json` / `compose.company.yaml`, or `compose.company.coolify.json`              |

An employer account never grants control over a charger, and no organization role implies physical station ownership. The owner edge's owner token is the root of every charger on that edge.

## Start

1. Read `AGENTS.md`, `docs/security-model.md` and `docs/offline-invariants.md`.
2. For the charger side read `docs/guides/personal-or-company.md`, `docs/guides/company-chargers.md` and `docs/guides/brands.md`, then use the `deploy-owner-edge` skill for the host and Compose mechanics.
3. For the account side read `docs/guides/company-hosting.md`, `docs/guides/people.md`, `docs/guides/reimbursements.md`, `docs/company-hosting.md` and `docs/commercial-service.md`. Recovery is `docs/guides/recovery.md` and `docs/public-company-recovery.md`.
4. State current status honestly: the owner edge is for controlled lab and migration work; the employer workspace has a local trial and a synthetic HTTPS pilot. Live managed-platform acceptance, managed recovery and payment execution are unfinished. Use synthetic accounts in the pilot.

## Decide who owns the chargers

Ask this first. It decides the topology, not the hosting.

- **Company owns the chargers:** one company owner edge with the `company` profile. Each charger has its own identity, password and card list; employees get 90-day **Employee page** links, finance gets a `finance` delegate.
- **Employee owns the charger and keeps control:** the employee runs their own `personal` owner edge (see `deploy-owner-edge`) and gives the company **Shared access** with the employer (reimbursement) role. The company never holds that owner token.
- **Employee owns it but has no server:** the company may add it to its edge marked employee-owned, by written agreement. The company then controls it fully. The **Leaves the company** plan handles offboarding.

Never put a company fleet on an edge that is also someone's personal owner root. Fleet mode is one owner security domain, not multi-tenancy.

## Hub readiness checklist

Before calling any host "the central hub for employees", check each item and report the ones that fail:

- **Public HTTPS for employees.** Employee pages (`/me`) and the employer workspace must be reachable from employees' phones over HTTPS (`docs/security-model.md`). A loopback console, or a private Tailscale Serve console (`docs/owner-edge-operations.md`, **Private owner console over Tailscale**), serves no one else. Tailscale is fine for the owner and a few administrators. Enrolling every employee into the tailnet is not a substitute for public HTTPS, and it exposes the host's other services to them unless access rules restrict it. Tailscale Funnel is unsupported.
- **Public WSS for remote chargers.** Chargers at employees' homes connect outbound over the internet, so the OCPP hostname needs `wss://` with a certificate each exact charger validates. Plain `ws://` is LAN-only lab transport.
- **No extra proxy, CDN or tunnel.** Both production profiles assume their own Caddy (or Coolify Traefik for managed company) is the only TLS terminator and proxy. A CDN or tunnel in front breaks the proxy-trust model and sees the owner token, charger passwords and account links.
- **Dedicated host and user.** The owner edge must not share a user with other agents or services. The employer workspace refuses production outside non-root Docker (`service/node/configuration.ts`) and expects a dedicated Docker host/public entrance with 80/443.
- **Separate public entrances.** The company owner edge and the employer workspace each bring their own Caddy that must own ports 80/443. Put them on separate hosts (or separate public IP entrances). Never add a shared front proxy to fit both on one machine.
- **Recovery.** A fleet edge cannot produce a continuity bundle, and console-added chargers, `owner-tags/` and `card-policy.json` live only in the data volume. No volume-restore procedure is documented or drilled, so a volume copy is not recovery. Say plainly that losing the hub loses management state for every charger on it. Charging is designed to continue from each charger's accepted local list; only the Freedom Test proves that on a given charger. Where recovery is part of the claim, use one recovery-capable edge per charger.
- **Capacity.** The OCPP listener defaults to 8 connections (16 in the fleet example). Raise it only for the measured fleet plus reconnect headroom, and treat any default change as needing exact-device traffic evidence.
- **Availability.** Home internet and power, a shared household server or a laptop are not a company hub. Say so if that is the proposal.
- **Mail.** The employer workspace needs authenticated, certificate-verified SMTP and approved work email domains.

A pilot with one or two volunteers' chargers on a properly bounded host is a reasonable first step. Label it as a pilot.

## Deploy the company owner edge

1. Follow `deploy-owner-edge` for hostnames, DNS, Docker and secrets. In the wizard choose the **Company** console; otherwise set `CHARGEOS_PROFILE=company`.
2. One charger: the wizard or `compose.production.yaml` (recovery-capable). Several chargers: `compose.fleet.production.yaml` with `.env.fleet.production` and a stations file (mode `0444` inside a mode-`0700` `secrets/` directory for the Compose secret mount; mode `0600` for a source run) built from `config/stations.example.json` (unique IDs, unique 40-hex secrets, non-empty `ownerTags`), or add chargers later from **Chargers › Add charger**. Legacy unscoped API routes address only the first station.
3. In the console: create **Employees**, assign a **Person** to each charger, classify each card (company/personal, business/private), create **Employee page** links and **Create finance access** under **Usage**. Secrets are shown once; send them privately.
4. Connect each charger with the `configure-charger` skill.
5. Offboarding uses **Leaves the company**, then **Chargers › Review card sync**. Removed cards keep working at a charger until it accepts the new list. If the employee takes the charger, get that `Accepted` revision before their installer moves it, then retire it (see `configure-charger`).

## Deploy the employer workspace

1. Evaluate locally first: `pnpm service:setup`, `pnpm service:native`, `pnpm dev:web`, then `http://127.0.0.1:5173/service`. Links go to a local outbox unless SMTP is configured.
2. Owned Docker pilot: on the dedicated Docker host run `node scripts/deploy.mjs`, choose **set up company accounts instead**, give one accounts hostname (separate from the owner-edge names), 1-20 approved signup domains, an ACME contact and SMTP settings. Prepare-only first if IT reviews the package. Manual equivalent: `compose.company.yaml` per `docs/company-hosting.md`.
3. Managed Coolify pilot: only on a fresh standalone destination with Traefik, operator-built company images pinned by digest and a reviewed commit; platform URL/request/error logs and analytics disabled. **Submitted** is API acknowledgement, not readiness.
4. Verify with a synthetic account: DNS, certificate, actual mailbox delivery, sign-in, organization creation, invitation, finance authenticator setup, and a restart that keeps records.
5. Never enable proxy access or error logging (account tokens appear in URLs), never use `down --volumes`, and never start a second public server from a copied database. Recovery goes through quarantine and the reviewed handoff only.

Run `pnpm verify:company-runtime` (and `pnpm verify:company-managed-runtime` for Coolify) after changing this boundary, plus `pnpm verify` and `pnpm verify:runtime`.

## Connect the two

There is no automatic link between the systems. Finance turns a month's owner-edge **Usage** CSV (filtered to one driver, private rows removed) or the `finance` feed into a reimbursement import in the employer workspace (`docs/guides/reimbursements.md`). Never move names, raw RFID or owner secrets into the workspace, and never give a workspace role owner-edge authority.

## Stop and escalate

- Ownership of the chargers or the employee agreement is unclear.
- The proposed host fails the hub readiness checklist and the gap is not accepted in writing as a pilot limitation.
- Someone wants one owner token shared among managers, or a workspace role to control a charger.
- Someone asks you to describe the pilot as production, certified or recovery-capable for a fleet.

Update the matching guides in `docs/guides/` and the canonical docs in the same change as any company deployment behavior.
