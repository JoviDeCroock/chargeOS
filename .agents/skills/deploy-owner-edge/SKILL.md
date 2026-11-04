---
name: deploy-owner-edge
description: Plan, deploy, inspect, upgrade, or back up a chargeOS owner edge for one owner (a household, or one owner with a few chargers). Use for the setup wizard, Docker production Compose, a native user-space home-lab install, HTTPS/WSS hostnames, owner console access, secrets, continuity backup, or deciding where an owner edge should run.
---

# Deploy an owner edge

An owner edge is the chargeOS server (`server/`) that one owner root controls: OCPP gateway, evidence ledger, owner console and API. It is not the employer workspace (`service/`); for that, or for a company running chargers for employees, use the `deploy-company` skill. Connecting the charger itself is the `configure-charger` skill.

The deployment exists to serve the core invariant: an already-authorized owner card keeps charging when chargeOS, the network and every vendor cloud are down. The server can be lost; the charger's accepted local list carries charging. Never trade that away for convenience.

## Start

1. Read `AGENTS.md`, `docs/security-model.md` and `docs/offline-invariants.md`.
2. Read the guides the owner will follow: `docs/guides/install.md`, `docs/guides/deploy.md`, `docs/guides/owner-console.md` and `docs/guides/recovery.md`. Operator detail is in `docs/owner-edge-operations.md` (**Configure**, **Production HTTPS/WSS edge**, **Guarded operating sequence**, **Backup and recovery**) and `docs/deployment-setup.md`.
3. Establish facts before advising, on the actual host when one exists:
   - OS, CPU architecture, free disk, whether Docker with Compose is installed and usable without sudo, and whether the operator has root;
   - which ports are free and which other services, agents or tunnels already run there (do not stop, reconfigure or read the credentials of unrelated services);
   - whether the charger will reach the edge over the same LAN or over the internet;
   - whether the host can receive inbound 80/443 (public IPv4 or IPv6, router forwarding, DNS control);
   - who holds the owner token and who will keep the recovery bundle.
4. Read-only inspection is the default. Install, restart, firewall, DNS, router and tunnel changes need the owner's explicit go-ahead for that host.

## Choose a profile

| Situation                                                                                 | Profile                                                                                                                | Status                                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owner with a server that has Docker and inbound 80/443                                    | Setup wizard (`node scripts/deploy.mjs`), Docker target                                                                | Production HTTPS/WSS boundary; generated `compose.json` package tested, not the runtime drill |
| Operator who wants the files directly                                                     | `compose.production.yaml` + `.env.production`                                                                          | Same boundary, single station, recovery-capable; `pnpm verify:runtime` drills this file       |
| Owner with several chargers under one root                                                | `compose.fleet.production.yaml` + stations file                                                                        | Operable, but no continuity bundle (see below)                                                |
| Managed hosting with an existing Coolify account                                          | Wizard, Coolify target (`compose.coolify.json`)                                                                        | Mock-tested only; no documented owner backup path yet                                         |
| Trial against a real charger on the owner's LAN, no Docker/sudo                           | Native user-space install (see the `liberate-charger` skill, **Run a reversible home-lab trial**)                      | Lab only: plaintext `ws://` on the LAN, never internet-facing                                 |
| Private HTTPS console for the owner on a source/native edge, owner already uses Tailscale | Tailscale Serve in front of a loopback API (`docs/owner-edge-operations.md`, **Private owner console over Tailscale**) | Untested convenience; console only, tailnet only                                              |
| Software evaluation without a charger                                                     | `pnpm dev` + `pnpm simulate`, or `compose.yaml`                                                                        | Lab only                                                                                      |

Product decision: recovery-grade deployments use one station per edge. The encrypted continuity format is single-station and fails closed for a fleet, and export is refused once a charger was added, retired or marked from the console. Tell the owner this before they add a second charger.

## Wizard or production Compose

1. Choose two owner-controlled hostnames: one for the console (`charge.example.net`) and a different one for chargers (`ocpp.example.net`). Never route OCPP and the console through one name.
2. Point A/AAAA records at the host and make sure 80 and 443 reach it for ACME. No CDN, tunnel or second proxy in front: production Compose trusts forwarded addresses only because Caddy is the sole peer.
3. Wizard: run `node scripts/deploy.mjs` on the Docker host itself (remote Docker contexts are refused), choose Docker, Home or Company console, then **Prepare files only** for review or **Deploy chargeOS**. The private folder `.chargeos-deploy/<name>/` holds `START-HERE.txt`, `INSTALLER-SHEET.txt` and `credentials.json`.
4. Manual Compose: follow **Production HTTPS/WSS edge** exactly. Secrets go in a mode-`0700` `secrets/` directory as mode-`0444` files; validate with `docker compose ... config --quiet` and the pinned `caddy validate` before `up`.
5. If a stable release tag exists, deploy that image by verified digest (**Deploy a verified tagged image**), never `latest`. Until then, build from source at a reviewed commit and record that commit. Never invent a digest. Keep the previous working image or commit for rollback.
6. After DNS and the certificate are valid, sign in (wizard **Open my console**, or paste `ownerToken`). Then hand off to `configure-charger`.

Run `pnpm verify:runtime` when you change the image, proxy, secret mounts, network boundary, OCPP transport, authentication or redaction. It is synthetic proof only.

## Native install without Docker

Use this only for a LAN trial or a host where the owner accepts that it is outside the tested production boundary.

- Follow the `liberate-charger` home-lab steps: verified Node 22 tarball in user space, `pnpm install --frozen-lockfile && pnpm build`, a user systemd unit with `CHARGEOS_ENV_FILE`, every secret through a `_FILE` path in an owner-only directory, and linger enabled.
- Bind `CHARGEOS_OCPP_HOST` to the LAN interface address, never `0.0.0.0` or an overlay address. Default `CHARGEOS_API_HOST` to loopback. Binding it to an encrypted overlay address such as a tailnet IP is the "trusted owner network" case in `docs/owner-edge-operations.md` (**Configure**), which the owner must accept; no canonical doc describes an overlay deployment. The bearer token does not make plaintext internet transport safe.
- Keep `CHARGEOS_TRUST_PROXY_HEADERS=false` unless a single declared proxy is provably the only peer. On a shared host, other local processes are also loopback peers.
- Run chargeOS as a user that no other agent or service shares. Any process running as the same user can read the owner token, station secret and raw owner tags.
- A third-party TLS-terminating tunnel or CDN in front of the console or OCPP is unsupported: it sees the owner token and charger password and breaks the proxy-trust model. Stop and escalate instead.

## Private console over Tailscale

Offer this when the owner wants HTTPS for their own console on a source or native edge and already uses Tailscale. Follow **Private owner console over Tailscale** in `docs/owner-edge-operations.md`; the owner-facing text is in `docs/guides/deploy.md`.

1. Check first, read-only: `tailscale status --self --json` (MagicDNS name, whether the tailnet has HTTPS certificates), `tailscale serve status`, and whether the user is root or an operator. Report what is missing.
2. The owner enables MagicDNS and **HTTPS Certificates** in the admin console. Warn them that the machine's `*.ts.net` name goes into public Certificate Transparency logs.
3. The owner runs `sudo tailscale set --operator=<user>` once, or runs the `serve` commands with `sudo`. That Linux needs this is an unverified inference; report what actually happened.
4. Set `CHARGEOS_API_HOST=127.0.0.1`, keep `CHARGEOS_TRUST_PROXY_HEADERS=false`, restart, then `tailscale serve --bg --https=443 http://127.0.0.1:<api-port>`.
5. Verify `https://<machine>.<tailnet>.ts.net/api/v1/health` and an owner sign-in from another tailnet device. Undo by repeating the serve command with `off` appended, confirm with `tailscale serve status`, and restore the previous bind.

Don't route OCPP through Tailscale (chargers can't join a tailnet), don't use Funnel, and don't present this as the production boundary or as a way to serve employees. Every tailnet peer and local process shares one failed-authentication bucket. Delegate and employee links are built from the address the console is opened on, so never issue them from the `ts.net` address.

## Secrets and console access

- Generate the station secret (`openssl rand -hex 20`, 40 hex digits) and owner token (`openssl rand -hex 32`) on the host. Never print them into the conversation; the owner reads them there.
- Raw owner RFID values go only into the owner-tag file or the console's tap-to-add. Never log, echo or hash them into shareable artifacts.
- Sensitive settings use exactly one inline or `_FILE` form. Host files are regular non-symlinks without group/other access, except read-only `/run/secrets` mounts.
- Never share the owner token. Professionals get an expiring delegate from **Station settings › Shared access**.

## After deployment

1. Check `/api/v1/health`, the console, and **Connect your charger** for the address and identity. Process start is not DNS, certificate, charger, migration or Freedom Test proof; report the actual state reached.
2. Hand over to `configure-charger` for the connection, offline-readiness checks and card list.
3. On a one-station edge with at least one accepted owner card, export an encrypted continuity bundle (**Backup and recovery** in `docs/owner-edge-operations.md`). In production Compose, use `docker compose ... exec -T chargeos node dist/server/continuity-cli.js export-stdout --passphrase-stdin` with both redirections, so the passphrase never enters an argument, environment variable or the container. For a wizard package, run the same command from its private folder with `-f compose.json`; that variant is not separately drilled. On a source or native install, `pnpm continuity export --output <file> --passphrase-file <file>` reads only `./.env` and the process environment, not `CHARGEOS_ENV_FILE`. Load the running edge's env file into the environment first (for example `set -a; . <env-file>; set +a`), make sure no different `./.env` is present, and check that `inspect` reports the expected station ID and event count. This native variant is not drilled either. Inspect the bundle off the host and restore it to a fresh empty path; an unrestored bundle is untested. Keep bundle and passphrase apart and off the edge. Back up `directory.json` separately; names are not in the bundle.
4. Upgrades are planned local-edge outages: export a fresh bundle first, deploy the reviewed image or commit, check health, WSS reconnection, Boot identity and capability inspection, and roll back to the prior image or commit on failure. Never delete or rewrite the evidence volume to make an update boot.

## Stop and escalate

- The host can't keep the owner token away from other agents or users.
- The charger would reach the edge over the internet without `wss://` and a certificate the exact charger validates.
- The owner needs recovery but already has, or plans, several chargers on one edge.
- A step needs `down --volumes`, ledger edits or overwriting an existing installation.
- Anyone presents a running container, a green console or an AI answer as proof that offline charging works. Only the Freedom Test shows that.

Update the matching guide in `docs/guides/` and `docs/owner-edge-operations.md` in the same change as any deployment behavior.
