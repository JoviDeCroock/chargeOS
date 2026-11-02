# Owner-edge operations

This document covers the software MVP. It does not authorize electrical work, enclosure opening, SIM removal, firmware changes, or a compatibility claim. Use the model/firmware-specific runbook and Freedom Test for a real charger.

## Configure

Use Node 22+ and pnpm 11. Copy `.env.example` to a local `.env`, restrict it to the owner account, and replace every placeholder:

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 20   # CHARGEOS_STATION_SECRET (charger password)
openssl rand -hex 32   # CHARGEOS_OWNER_API_TOKEN
```

`CHARGEOS_STATION_SECRET` authenticates the charge point. Use 32-40 hexadecimal digits: the [OCPP 1.6 security whitepaper](https://openchargealliance.org/ocpp-info-whitepapers/ocpp-1-6-security-whitepaper-4th-edition/) (edition 4, A00.FR.205) stores the Basic-auth password in `AuthorizationKey` as 16-20 bytes written as up to 40 hexadecimal digits, and conforming chargers may refuse anything else. chargeOS still accepts any secret of at least 16 characters (so existing deployments keep working) but prints a startup warning for each station whose password does not have that shape. Rotating a password means changing it on the charger too, so plan it as a maintenance step. `CHARGEOS_OWNER_API_TOKEN` authenticates the owner console. They must be independent. `CHARGEOS_OWNER_TAGS` contains comma-separated OCPP 1.6 tag values, seeds the durable desired set on first boot, and never belongs in source control or screenshots.

Every sensitive setting also accepts an exclusive `_FILE` form: `CHARGEOS_STATION_SECRET_FILE`, `CHARGEOS_OWNER_API_TOKEN_FILE`, and `CHARGEOS_OWNER_TAGS_FILE`. Setting both forms is an error. Host secret files must be regular non-symlinks with no group/other access. Files mounted under `/run/secrets` must be read-only; this narrow rule supports Compose file secrets without making arbitrary host files permissive. Station and API secrets are exactly one line. Owner tags may be comma- or newline-separated.

For a single-owner multi-charger process, do not repeat or mix those legacy station settings. Copy `config/stations.example.json` outside the repository, replace every placeholder with unique per-station values, set the file to mode `0600`, and use only `CHARGEOS_STATIONS_FILE=/absolute/path/to/stations.json` plus the independent owner API token. The closed schema accepts 1 through 1,000 unique stations with `id`, `label`, `site`, `secret`, a non-empty `ownerTags` array, and an optional `driver`. Unknown fields, duplicate IDs, unsafe path characters, weak secrets, empty tag sets, symlinks, or permissive host modes stop startup. `label`, `site` and `driver` are owner-console metadata; they do not prove physical identity or ownership.

### Console profile and drivers

`CHARGEOS_PROFILE` is `personal` (default) or `company`; any other value stops startup. It arranges the owner console only: `personal` hides the switching, shared-access, records and AI tabs of **Station settings** by default, and `company` adds the all-charger **Usage** page grouped by person, labels people **Employees**, and shows shared access and records by default. Owners can override the optional tabs per browser under **Preferences**. Hiding a tab removes no API route, owner card, readiness check or evidence, and a hidden tab is shown again while a delegate grant is active or a switching/Freedom Test step is open, stopped or stale. The overview always shows a stopped Genesis plan. The console is translated into English, Dutch and French; the switching, Freedom Test and AI sections and all typed confirmation phrases stay in reviewed English.

`driver` in the stations file, or `CHARGEOS_STATION_DRIVER` for a single legacy station, is a 1-120 character printable name. Together with `label` and `site` it only seeds the owner directory below.

### Owner directory

The owner names chargers, people and cards in the console. The names live in `directory.json` beside the evidence ledger (`/data/directory.json` in the containers): a closed-schema, mode-`0600`, at most 1 MiB file holding each station's label, site and person, the people, and each card's name and holder keyed by its station-scoped pseudonym. It never holds raw RFID values or secrets. On first start, chargeOS creates an entry for every configured station from its `label`, `site` and `driver`; later configuration edits do not overwrite an existing entry. Names are 1–80 characters after Unicode NFC normalization and whitespace folding; control, format, private-use and surrogate characters are refused. At most 500 people can be named.

The directory is presentation data for the owner only. It feeds the owner snapshot, fleet overview and usage report, but is never added to the evidence ledger, redacted exports, field packs, AI troubleshooting payloads or delegate projections. A card can be named only while it is in that station's desired owner set. Revoking a card deletes its name (and those of any letter-case variants removed with it), a re-added card starts unnamed, and names of chargers no longer configured are dropped. An edit that would grow the file past 1 MiB is refused with `400`, and a failed save returns `503` while keeping the last saved names. Writes use a unique owner-only temporary file, `fsync`, atomic rename and directory `fsync`; startup removes temporary copies abandoned by a crash. If the file is a symlink, readable by group or others, oversized or malformed, chargeOS starts with the configured names, refuses edits with `503 directory_unavailable` and leaves the file untouched. Charging, owner cards and every other route keep working. Startup and edit warnings are closed messages without names or paths.

The directory is not part of an encrypted continuity bundle. Back up `directory.json` with the rest of the data volume, or rename chargers, people and cards again on a replacement edge.

`GET /api/v1/usage?month=YYYY-MM&timeZone=Area/City` is an owner-only, read-only projection of already recorded sessions across every provisioned station. A session belongs to the month in which it started in the requested IANA time zone (the console sends the browser's). The start time is the charger's reported `StartTransaction` timestamp, so a charger with a wrong clock is reported on its own clock. Open sessions count with no energy, and evidence conflicts keep the first stop value and are flagged. The console's CSV export lists card pseudonyms, never raw RFID values, quotes every cell (so neither a comma nor a semicolon-locale separator can split one), neutralizes formula-like cells, and uses a `charger:transaction` `session_id` that the reimbursement import accepts. It is a usage report, not an approved statement or payment.

On first boot, chargeOS writes the primary station's seed tags into `owner-tags.json` beside the evidence ledger (`/data/owner-tags.json` in the containers). Additional fleet stations use station-ID-digest filenames under `/data/owner-tags/`. Every mode-`0600` state becomes canonical independently. Later bootstrap edits do not overwrite it; use the selected charger in the authenticated owner console/API. Each state contains raw identifiers and is HMAC-authenticated with that station's secret, so protect the owner account and data volume. Authentication detects tampering but is not encryption. Startup refuses state at or below the last audited version in the ledger unless it holds exactly the last audited tag set. Putting back an earlier backup or the first-boot `owner-tags.json`, or deleting it so a stale deployment seed is used, could otherwise silently re-desire revoked tags. A continuity restore, which seeds the audited set, continues the version sequence instead. If startup reports this, restore the latest state file or recover through a continuity bundle.

Adding or revoking a tag changes desired state only. It does not prove the charger's persisted list changed and never triggers automatic synchronization. The owner console compares desired pseudonyms with the last exact revision acknowledged `Accepted`, shows pending additions, and raises a stale-access warning for pending removals. A removed tag is rejected by the online gateway after mutation but may continue to authorize locally during an outage until a fresh capability inspection and complete-list synchronization succeeds. If a command has no recorded result, keep it unacknowledged and investigate before retrying; never edit the ledger or owner-tag state to manufacture a result.

Loopback is the default. Set `CHARGEOS_OCPP_HOST=0.0.0.0` only on a controlled charger LAN or behind a WSS reverse proxy. Set `CHARGEOS_API_HOST=0.0.0.0` only behind an authenticated TLS boundary or on a trusted owner network. The bearer token does not make plaintext internet transport safe.

The OCPP listener defaults to eight TCP connections, one authenticated socket per provisioned station identity, a 1 MiB complete-message limit, 600 valid RPC messages per minute per peer, and a burst of 60. Malformed RPC messages retain the separate three-strike protocol close. Set the global connection ceiling high enough for the measured fleet plus bounded reconnect headroom. Tune only from exact model/firmware traffic evidence; a low limit can disconnect online management, while a high limit weakens resource protection. A disconnect never changes that station's already-acknowledged local owner list.

`CHARGEOS_EVENT_LOG_MAX_BYTES` defaults to 256 MiB per active segment. The process verifies every archived segment plus the active file as one chain before opening either listener and refuses any append whose complete sealed line would exceed the active ceiling. It never truncates or rotates evidence implicitly. Public health changes from `200 ok` to `503 degraded` when less than one maximum OCPP message plus sealing headroom remains. Monitor both the active file and total volume usage; archive rollover resets active headroom but retains every historical byte on the edge. The separate compacted-replacement workflow can move full history to owner-controlled offline custody, but it never deletes the old edge or source bundle for the owner.

## Run from source

```sh
pnpm install
pnpm verify
pnpm dev
```

The development UI is at `http://127.0.0.1:5173`; Vite proxies `/api` to port 9080. The OCPP endpoint is `ws://127.0.0.1:9000/<station-id>` for a local simulator. Production builds use `pnpm build && pnpm start` and serve the UI/API together on port 9080.

## Run as a container

```sh
docker compose up --build
```

The default Compose file persists `/data/events.ndjson`, its archives, and `/data/owner-tags.json` in the `chargeos-data` volume and exposes OCPP port 9000 plus owner UI/API port 9080. It is a lab profile, not an internet deployment.

## Production HTTPS/WSS edge

The production Compose model gives Caddy the only host ports (80 and 443). chargeOS joins an internal-only network and exposes ports 9000 and 9080 to Caddy, not the host. OCPP and the owner console use separate DNS names so a routing mistake cannot turn a station identity into an API path. Caddy terminates HTTPS/WSS and forwards WebSocket upgrades; chargeOS still performs station allowlisting and Basic-secret verification. Caddy runs as the unprivileged `1000:1000` user. Before every start, the short-lived `caddy-volumes` service sets that user as owner of the certificate volumes and exits. On an upgrade it converts existing root-owned volumes in place, so certificates are kept. If that step fails, Caddy does not start; check `docker compose logs caddy-volumes`.

`compose.production.yaml` is the single-station recovery-capable deployment. `compose.fleet.production.yaml` is the single-owner fleet variant and mounts only `owner_api_token` plus the strict `stations_registry`; validate it with `.env.fleet.production`. The fleet UI and station-scoped controls are operable, but the current encrypted continuity schema is single-station and deliberately refuses fleet export. Until a versioned fleet bundle is implemented and drilled, use one station per edge wherever independent replacement recovery is part of the claim. A backed-up fleet registry is not a substitute for current desired-tag state after runtime changes.

Prerequisites:

1. Point public DNS A/AAAA records for two owner-controlled names at the edge host. Ports 80 and 443 must reach that host for certificate issuance and renewal.
2. Copy `.env.production.example` to `.env.production` and set the station ID, both DNS names, and an ACME contact address. The checked-in Node and Caddy defaults pair exact versions with verified multi-platform digests. Refresh a version and its digest together after reviewing upstream; pin any remotely published `CHARGEOS_IMAGE` by digest before unattended use.
3. Create the ignored `secrets/` directory with mode `0700`. Put exactly one secret in each configured file and set the files to mode `0444`. The owner-tag file is a first-boot seed; runtime changes live in the protected data volume and current continuity bundle. Compose file secrets are bind-mounted and chargeOS runs non-root, so the files must be readable inside the single-purpose container; the non-traversable host directory protects them from other unprivileged host users. Never reuse a vendor, personal, or recovery password.
4. Keep the owner domain private where practical. The bearer token is still required over HTTPS; TLS does not replace owner authentication.

Validate the fully resolved model before starting it:

```sh
docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  config --quiet

docker run --rm \
  --env CHARGEOS_ACME_EMAIL=owner@example.net \
  --env CHARGEOS_OCPP_DOMAIN=ocpp.example.net \
  --env CHARGEOS_OCPP_MAX_CONNECTIONS=8 \
  --env CHARGEOS_OWNER_DOMAIN=charge.example.net \
  --volume "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

With Docker running, exercise the built image and the pinned Caddy edge end to end:

```sh
pnpm verify:runtime
```

The command creates only synthetic credentials and an isolated disposable Compose project. It replaces the production evidence volume with a 16 MiB tmpfs for the smoke run; `pnpm verify:deployment` separately requires the production `chargeos-data` volume at `/data`. It verifies the non-root, read-only, internal-only application container; starts Caddy with separate edge and internal interfaces; records an evidenced synthetic pre-switch inventory and owner authorization; then checks HTTPS security headers, an exact authorized Boot identity match, connector status, capability inspection, full local-list acknowledgement, an owner-authorized energy-increasing start/meter/stop session, online unknown-tag rejection, automatic migration/Freedom projections, disconnect/reconnect handling, exact start/meter/stop retry reconciliation into one non-conflicting session, authenticated snapshot redaction, field-pack export/verification, sealed-evidence redaction, and log redaction over OCPP 1.6 WSS. It removes its containers, ephemeral evidence, and temporary credentials even on failure. The retry sequence is a software rehearsal, not evidence that a charger buffered during an outage. It does not disconnect a physical charger, prove durable volume recovery, prove persistent local authorization, measure buffering, or produce a Freedom grade.

### Deploy a verified tagged image

The public tag workflow accepts only an exact stable SemVer tag matching `package.json`. It rejects any current production dependency advisory, builds a commit-specific GHCR candidate, runs the complete production runtime drill against that registry digest, generates a CycloneDX SBOM and GitHub/Sigstore build-provenance attestations, uploads a deterministic release manifest, and only then creates the version and commit tags. It refuses an existing version tag and never publishes `latest`. The initial artifact is `linux/amd64` only.

Resolve and verify the immutable digest before an unattended deployment. Substitute the actual public repository and released version:

```sh
REPOSITORY=owner/chargeos
IMAGE=ghcr.io/owner/chargeos
VERSION=0.1.0
DIGEST="$(docker buildx imagetools inspect "$IMAGE:$VERSION" --format '{{json .Manifest}}' | jq -r '.digest')"

gh attestation verify "oci://$IMAGE@$DIGEST" --repo "$REPOSITORY"
docker pull "$IMAGE@$DIGEST"
```

Compare the digest with the workflow's `chargeos-<version>.manifest.json`, and retain that manifest and its matching CycloneDX file with the owner's deployment record. A valid attestation proves that GitHub's tag workflow produced those bytes from the named revision; it does not prove maintainer identity outside the GitHub trust root, vulnerability absence, correct field configuration, charger compatibility, or a Freedom Test.

Deploy by digest without `--build`, after exporting a current continuity bundle and preserving the previously working digest for rollback:

```sh
CHARGEOS_IMAGE="$IMAGE@$DIGEST" docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  up --detach
```

An image change is a planned local-edge outage. The charger-local acknowledged owner list must carry essential charging while the container is replaced. If health, WSS reconnection, identity, or capability inspection fails, restore the prior digest; never delete or rewrite the evidence volume to make an update boot.

Then start and inspect it:

```sh
docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  up --detach --build

docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  ps
```

The charger endpoint is `wss://<ocpp-domain>/<station-id>`. The owner console is `https://<owner-domain>/`. Production Compose enables `CHARGEOS_TRUST_PROXY_HEADERS` so failed-authentication limits use the client address Caddy supplies instead of one shared container address. This is safe only while Caddy is the sole peer on the internal network and chargeOS has no host port. Never enable it on an exposed listener or join an untrusted container to that network. Do not add a CDN or second proxy until its forwarding and trust chain are explicitly configured and tested. Confirm certificate validation on the exact charger before authorizing a migration. Back up the chargeOS data volume through the continuity workflow; treat the Caddy data volume as sensitive because it contains certificate private material.

The deployment applies the same accepted-connection ceiling at Caddy and Node, caps complete WebSocket messages before OCPP parsing, token-buckets valid RPC calls, drops dangling peers through keep-alive, and closes after repeated malformed messages. These are resource bounds, not volumetric denial-of-service absorption: restrict exposure with the host firewall and monitor CPU, memory, rejected upgrades, `ProtocolRateLimitExceeded`, `ProtocolMessageRejected`, and reconnect behavior. A `ProtocolMessageRejected` event names the OCPP method and the first failing JSON path (for example `StartTransaction` at `/timestamp`) without storing payload values. Repeated rejections of a transaction message mean the charger's firmware does not conform to the OCPP 1.6J schema for that field. Record it in the device's Freedom Matrix evidence; do not loosen validation.

## Guarded operating sequence

1. Confirm the configured station connects and sends the expected model/firmware in `BootNotification`.
2. In the owner console, run **Inspect offline capabilities**.
3. Read every observed check. Missing or unsafe evidence leaves readiness unknown or blocked.
4. If the three required settings are unsafe but all are explicitly reported writable, type the displayed confirmation phrase and run **Prepare owner continuity**. The edge performs a complete preflight, changes only those unsafe settings in the safe direction, and re-inspects. Missing, read-only, malformed, or ambiguous keys require the supported device/configuration path instead; do not bypass the block.
5. If the charger returns `RebootRequired`, use the documented exact-model safe restart procedure, wait for a new authenticated `BootNotification`, and inspect or prepare again. chargeOS never restarts the station automatically.
6. Review the desired cards on **RFID cards**. Add a credential through **Add card** if needed. Removing a credential requires acknowledging that it may keep authorizing locally until the next accepted list (the console then sends the server's exact stale-access confirmation) and is disabled for the final credential. These actions persist desired state only.
7. Only after all checks pass, confirm **Send to charger**. This replaces the local list with exactly the current desired tags and a new monotonic revision.
8. On a one-station edge, export a new encrypted continuity bundle and inspect it; redacted evidence alone cannot recover current tags. Fleet mode stops here until each charger is moved to a recovery-capable edge or the fleet continuity format exists.
9. Perform the witnessed physical Freedom Test. Software readiness is not certification.

## HTTP surface

`GET /api/v1/health` is public and contains no owner state. It returns `503 degraded` when evidence capacity lacks one maximum-message headroom. Owner endpoints require `Authorization: Bearer <owner-token>`:

- `GET /api/v1/fleet`
- `GET /api/v1/directory` (owner directory names for every station; not station-scoped)
- `POST /api/v1/people`, `POST /api/v1/people/:personId`, `POST /api/v1/people/:personId/remove` (not station-scoped)
- `POST /api/v1/profile` (`{ "label", "site", "driverPersonId" }` for the station)
- `POST /api/v1/cards/:tagPseudonym` (`{ "name", "holderPersonId" }`; the pseudonym must be in that station's desired set)
- `GET /api/v1/snapshot`
- `GET /api/v1/genesis-plan`
- `GET /api/v1/continuity-export`
- `GET /api/v1/field-pack`
- `POST /api/v1/owner-tags`
- `POST /api/v1/owner-tags/:tagPseudonym/revoke`
- `GET /api/v1/freedom-test/report`
- `POST /api/v1/freedom-test/device`
- `POST /api/v1/freedom-test/runs`
- `POST /api/v1/freedom-test/observations/:stepId`
- `GET /api/v1/migration/report`
- `POST /api/v1/migration/checkpoints/:stepId`
- `POST /api/v1/migration/authorize`
- `GET|POST /api/v1/delegations`
- `POST /api/v1/delegations/:grantId/revoke`
- `POST /api/v1/stations/:stationId/inspect`
- `POST /api/v1/stations/:stationId/prepare-owner-continuity`
- `POST /api/v1/stations/:stationId/sync-authorizations`
- `POST /api/v1/stations/:stationId/commands` (station-scoped only; no unscoped alias)

Every legacy owner and delegate path above is also available below `/api/v1/stations/:stationId/` (for example, `GET /api/v1/stations/:stationId/snapshot`, `POST /api/v1/stations/:stationId/owner-tags`, and `GET /api/v1/stations/:stationId/delegate/sessions`). The unscoped aliases address only the first configured station. The fleet web app uses scoped paths exclusively; unknown station IDs return a not-found response after owner authentication.

Delegate endpoints require a separately issued bearer token and the named read scope:

- `GET /api/v1/delegate/station-status` — `station-status:read`
- `GET /api/v1/delegate/diagnostics` — `diagnostics:read`
- `GET /api/v1/delegate/sessions` — `sessions:read`
- `GET /api/v1/delegate/freedom-test` — `freedom-test:read`
- `GET /api/v1/delegate/migration` — `migration:read`

The preparation route fails closed before mutation unless every required change is explicitly reported writable. Its request must contain the exact phrase `I authorize only the documented owner-continuity settings`; it can only enable the two known-owner local authorization settings and disable unknown-tag offline authorization. It does not synchronize tags or reboot the charger. The synchronization route separately fails closed if the station is offline or any required capability is failed/unknown.

`POST /api/v1/owner-tags` accepts `{ "tag": "..." }` over loopback or the production TLS boundary, persists it, and returns only its pseudonym and state metadata. The revoke route addresses that pseudonym and requires `{ "confirmation": "I understand this tag may remain usable until the charger accepts the replacement owner list" }`. It refuses the last desired credential. Neither response, ledger record, snapshot, nor ordinary log contains the raw tag. After either mutation, explicitly inspect and synchronize the complete list, verify `Accepted`, and export a fresh encrypted continuity bundle.

### Remote charger commands

`POST /api/v1/stations/:stationId/commands` sends one owner-only command to a connected charger. Delegates have no route to it. The body is a closed object; unknown fields are refused:

- `{ "type": "RemoteStartTransaction", "connectorId": 1, "tagPseudonym": "tag_…" }` starts a session with a current desired owner card chosen by pseudonym. chargeOS resolves the raw identifier internally. The request, response and ledger never contain it. It is refused when a session is already active on that connector.
- `{ "type": "RemoteStopTransaction", "transactionId": 7 }` stops a session that is active on this charger. Completed, unknown or other-station sessions are refused.
- `{ "type": "Reset", "resetType": "Soft" | "Hard", "confirmation": "I understand this restarts the charger and may end a session" }`.
- `{ "type": "UnlockConnector", "connectorId": 1, "confirmation": "I am at the charger and the cable is safe to release" }`.
- `{ "type": "ChangeAvailability", "connectorId": 0-99, "availability": "Operative" }`. `Inoperative` is refused. OCPP persists it across restarts, so a charger disabled through chargeOS would stay disabled if chargeOS disappeared.

Commands for one charger run one at a time. chargeOS records `StationCommandRequested` before sending, so if that append fails nothing is sent. It then records the OCPP request (with any card pseudonymized), followed by `StationCommandResult` with the charger's literal status, or `StationCommandFailed`. Snapshot `commands` (latest 20) shows each command's state and a separate observed outcome derived only from later charger messages:

- **`accepted` / `rejected`** is the charger's explicit answer.
- **`failed`** means it was not carried out: the charger answered with an OCPP error such as `NotImplemented`.
- **`uncertain`** covers a 30-second timeout, a lost connection, an unreadable reply, or no recorded answer after 60 seconds (for example after an edge crash). The charger may or may not have acted. Check the observed state before trying again.
- **Observed outcome** is a matching `StartTransaction`, `StopTransaction`, `BootNotification` or `StatusNotification`.

An accepted command is not proof of the outcome, and none of these commands changes the local owner list or offline settings.

## Read the machine-readable Genesis plan

The authenticated snapshot and `GET /api/v1/genesis-plan` expose the same schema-1 plan shown at the top of the owner console. This is the canonical answer for an operator or agent asking what can safely happen next. Each action has a stable ID, actor, execution boundary, evidence class, safety class, and optional migration/Freedom step ID. `stop` means preserve the failed evidence and resolve the exact condition; `waiting-for-station` is observation, not permission to improvise; `ready-for-review` still requires independent review.

The plan is read-only guidance derived from the ledger. It never proves that an instruction was performed and never executes ACE, endpoint, enclosure, SIM, power, restart, or real-energy work. Agents may use it to select the next documented workflow, but must still enforce the runbook, exact-device procedure, owner confirmations, and competent-installer boundary.

## Delegate without surrendering ownership

Use **Station settings › Shared access** in the owner console to select an installer, employer reimbursement, or energy-provider role and a lifetime of at most 90 days. Copy the returned bearer secret immediately over an appropriate secure channel; chargeOS cannot show it again. The ledger retains only a verifier and short hint.

Give delegates only the corresponding `/api/v1/delegate/*` route. An installer token can read the redacted migration dossier but cannot record checkpoints, authorize a window, synchronize RFID, or call owner APIs. Employer exports omit the RFID pseudonym and household-wide data; they are session observations, not an automatic reimbursement or fiscal-grade assertion. Revoking a grant invalidates it on the next request and does not touch charger-local authorization. Review `DelegateCapabilityUsed` events in the owner ledger to see successful access.

## Build the reversible migration dossier

Use **Station settings › Switching provider** before changing any endpoint. Each owner-recorded checkpoint requires the SHA-256 digest of evidence kept encrypted outside chargeOS. Record **blocked** whenever authority, contract, credentials, network/SIM custody, installer safety, configuration backup, transaction export, standalone rollback, standalone owner charging, station pre-provisioning, continuity recovery, or transport evidence is missing. Do not manufacture readiness with a brochure, OCPP logo, or simulator.

Exact pre-switch device readiness comes from the Freedom Test inventory: label/hardware fields plus the expected OCPP vendor, model, and firmware strings obtained through supported ACE/current-backend evidence, with a SHA-256 reference to that separately held artifact. It intentionally does not require a prior chargeOS Boot. Once every pre-switch step passes:

1. Place each final inventory, configuration-path, configuration-backup, transaction-export, rollback, credential-custody, transport-validation, and continuity-restore artifact in encrypted owner custody. These must be evidence artifacts, not raw station/API credentials, RFID values, SIM credentials, or recovery passphrases; hashing a low-entropy secret would expose a guessable verifier.
2. Create a canonical, owner-private target manifest directly from those exact files. Replace the uppercase placeholders and neutral `/secure/evidence/...` paths. The command reads and hashes the bytes without copying file contents or paths into the manifest:

```sh
pnpm migration-manifest create \
  --output alfen-genesis.migration-target.json \
  --station-id STATION_ID \
  --expected-vendor Alfen \
  --expected-model "EXACT_MODEL" \
  --expected-firmware "EXACT_FIRMWARE" \
  --endpoint "wss://OCPP_HOST/ocpp/STATION_ID" \
  --transport internet-wss \
  --configuration-path "EXACT_SUPPORTED_ACE_PATH" \
  --device-inventory-evidence-file /secure/evidence/device-inventory.json \
  --configuration-path-evidence-file /secure/evidence/configuration-path.pdf \
  --configuration-backup-file /secure/evidence/configuration.exml \
  --transaction-export-file /secure/evidence/transactions.csv \
  --rollback-evidence-file /secure/evidence/standalone-rollback.pdf \
  --credential-custody-evidence-file /secure/evidence/credential-custody.pdf \
  --transport-validation-evidence-file /secure/evidence/transport-validation.json \
  --continuity-restore-evidence-file /secure/evidence/continuity-restore.json
```

Each evidence input requires exactly one `--*-file` or matching `--*-sha256` option. Use the digest form only when the exact artifact was already hashed and separately custodied. File inputs must be non-empty regular non-symlinks; the CLI opens without following a final symlink and rejects replacement or metadata mutation during hashing. It refuses to overwrite the target, writes mode `0600`, validates endpoint transport and the exact station path, fixes OCPP 1.6J/unique Basic authentication/owner custody/safety fields, rejects extra fields and likely embedded credentials, and prints the canonical SHA-256. For an isolated plaintext migration, use `--transport isolated-lan-ws` and a non-loopback private-IP `ws://` endpoint; public or named plaintext endpoints are rejected.

3. In the owner console, select the canonical manifest file, select the same transport class, choose an authorization window of 15 minutes to 24 hours, and type the exact owner confirmation phrase. The API strictly re-validates the file, requires its station identity and configuration path to match the evidenced inventory, requires every bound evidence digest to match its corresponding dossier checkpoint, and requires its transport to match the selected class. Only the resulting canonical SHA-256—not the endpoint or manifest contents—is persisted.
4. Immediately before the endpoint change, copy the authorized hash from the migration report and prove that the separately held file still matches:

```sh
pnpm migration-manifest verify \
  --manifest alfen-genesis.migration-target.json \
  --expected-sha256 AUTHORIZED_TARGET_MANIFEST_SHA256
```

5. Have the competent installer follow only the verified exact-model/firmware manifest and runbook. Any electrical, enclosure, or SIM work occurs with power isolated.

The hash covers canonical validated JSON, so harmless key order or whitespace changes do not create a different semantic plan. Any endpoint, identity, evidence digest, configuration path, transport, or safety change does. The manifest remains separately held and device-specific; its structural validity does not prove the evidence, credentials, endpoint reachability, installer authority, or charger compatibility.

Changing any prerequisite record invalidates the authorization. A Boot counts only after authorization and within its window, and its vendor, model, and firmware must exactly match the pre-switch inventory. A mismatch records a failed stop condition; investigate and re-authorize rather than editing the inventory under an existing authorization. Connector status, capability inspection, owner-list acknowledgement, and an energy-increasing online session must occur after a matching Boot. `online-path-observed-unreviewed` proves only that the planned software path produced bounded protocol evidence; it is not a Freedom grade or permission to skip rollback and offline tests.

## Record the physical Freedom Test

In the dashboard, record the exact article number and hardware revision from the device label, country, connectivity path, prior operator, exact supported endpoint-configuration path, and expected OCPP vendor/model/firmware from supported pre-switch evidence. The first Boot in the authorized window must match those three strings exactly; missing or mismatched Boot data prevents evidence completeness.

Three steps are derived automatically from the ledger: accepted owner authorization synchronization, an online start/meter/stop sequence with positive energy, and online unknown-tag rejection. Every other step is a witnessed physical observation. Hash the separately held evidence before recording pass or failure:

```sh
shasum -a 256 field-evidence-file
```

Keep the original file encrypted and outside chargeOS. The dashboard records its digest, the observation time, and the outcome. Recording a later result supersedes the projected state without deleting history. A failure makes the overall record failed; there is no “skip” that can manufacture completeness.

Exporting the report yields a redacted JSON record with the evidence-chain head. `evidence-complete-unreviewed` means every required item exists and is ready for human review. It is not permission to publish a grade or say the charger is liberated.

## Backup and recovery

Create a high-entropy passphrase file on separate owner-controlled media. The CLI rejects files readable by group or others:

```sh
openssl rand -base64 32 > /secure/offline/chargeos-recovery-passphrase
chmod 600 /secure/offline/chargeos-recovery-passphrase
```

For the hardened production Compose deployment, export through the already-running non-root container. The built image contains the compiled continuity CLI, already has read-only access to the runtime credentials and owner ledger, and accepts the recovery passphrase only on redirected standard input. It emits only the encrypted envelope on standard output:

```sh
umask 077
docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  exec -T chargeos \
  node dist/server/continuity-cli.js export-stdout --passphrase-stdin \
  < /secure/offline/chargeos-recovery-passphrase \
  > /secure/offline/chargeos-owner.continuity.json
```

Do not omit either redirection: interactive entry is rejected, and printing an encrypted recovery envelope into terminal history is unnecessary exposure. `umask 077` makes the newly redirected bundle owner-private. The passphrase never enters an argument, environment variable, container layer, edge volume, or container filesystem. The production runtime smoke test performs this exact in-container export, authenticates it outside the container, and checks that the envelope contains no plaintext runtime secret.

Export without stopping the service; the ledger reader waits for queued appends and verifies the complete evidence chain:

```sh
pnpm continuity export \
  --output /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase
```

Use the `pnpm continuity export` form for a source deployment whose `.env` directly describes the running edge. Do not point it at `.env.production`: that file contains Compose host paths and metadata rather than the container's resolved `_FILE` settings or `/data/events.ndjson`.

Inspecting decrypts and authenticates the bundle but prints only station ID, export time, tag count, event count, and last record hash:

```sh
pnpm continuity inspect \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase
```

Perform a recovery drill into a path that does not exist. Restore refuses to merge with or overwrite any target:

```sh
pnpm continuity restore \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --target /srv/chargeos-recovery
```

The target contains a mode-`0600` `.env`, verified `events.ndjson`, and redacted restore manifest. Current bundles preserve the configured evidence ceiling plus OCPP connection, complete-message, valid-call, and burst limits. The manifest reports the payload schema, whether an older bundle required current safe defaults, and the source/restored proxy-trust state.

Every restore forces `CHARGEOS_TRUST_PROXY_HEADERS=false`, even when the source edge used the production Caddy topology. Proxy trust belongs to the new network boundary, not to credential recovery. Inspect `restore-manifest.json`, validate the replacement proxy/host-port/network model with the production deployment checks, and only then enable trust in the production Compose path. DNS names, certificate issuance, Caddy state, and external routing are not reconstructed by this bundle; keep the migration target manifest and deployment custody records separately.

From a fresh checkout/build, start the replacement edge with:

```sh
CHARGEOS_ENV_FILE=/srv/chargeos-recovery/.env pnpm start
```

For a production replacement, create a separate package at a path that does not exist. Supply the replacement host's two owner-controlled DNS names and ACME contact explicitly; topology and certificate custody are intentionally not inherited from the failed machine:

```sh
pnpm continuity restore-production \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --target /srv/chargeos-production-recovery \
  --ocpp-domain ocpp.example.net \
  --owner-domain charge.example.net \
  --acme-email owner@example.net
```

The command authenticates the envelope and chain, rejects an existing target, requires distinct non-IP DNS hostnames, and creates a mode-`0700` package. It contains a verified read-only ledger transfer, a metadata-only `.env.production`, a restore manifest that still says `proxyTopologyValidated: false`, and a non-traversable `secrets/` directory whose read-only files can be mounted into the non-root container. The package is recovery authority: keep it on owner-controlled storage and remove it under the owner's retention policy after the replacement and a new bundle have been drilled.

On the fresh host, validate the checked-in production boundary and the resolved replacement model before installing anything. Use one explicit project name throughout so the later `up` command addresses the same new volume:

```sh
pnpm verify:deployment

docker compose \
  --project-name chargeos-owner \
  --env-file /srv/chargeos-production-recovery/.env.production \
  --file compose.production.yaml \
  config --quiet

docker compose \
  --project-name chargeos-owner \
  --env-file /srv/chargeos-production-recovery/.env.production \
  --file compose.production.yaml \
  build chargeos
```

Install the authenticated ledger into that project's empty `chargeos-data` volume with the compiled non-root CLI:

```sh
docker compose \
  --project-name chargeos-owner \
  --env-file /srv/chargeos-production-recovery/.env.production \
  --file compose.production.yaml \
  run --rm --no-deps \
  --volume /srv/chargeos-production-recovery/events.ndjson:/recovery/events.ndjson:ro \
  --volume /srv/chargeos-production-recovery/events.ndjson.archives:/recovery/events.ndjson.archives:ro \
  --entrypoint node \
  chargeos \
  dist/server/continuity-cli.js install-ledger \
  --source /recovery/events.ndjson
```

Installation verifies the source chain, every archive boundary, and configured capacity; creates archived segments mode `0400` plus `/data/events.ndjson` mode `0600`; flushes them; verifies the installed copy; and refuses an existing target or archive directory. A failed write removes only the partial paths it created; it never merges, truncates, or replaces a ledger. If the command reports existing evidence, stop and resolve the project/volume identity rather than deleting it.

Only after DNS, host ports, the single-Caddy-peer network, and certificate issuance are validated should the normal production `up --detach` command re-enable proxy-header trust. The runtime smoke drills encrypted export, production package creation, verified installation into a fresh persistent data mount, and a second non-root container boot from that state. It still does not prove ownership, external DNS control, real charger behavior, or the physical Freedom Test.

The first replacement boot materializes canonical owner-tag state from the recovered secret and may append a reconciliation event. Its state version continues past the restored ledger's last audited version, so no older state file can later look newer than the ledger. The source bundle therefore becomes a historical recovery input rather than a checkpoint of the now-running ledger. Immediately export and inspect a new encrypted continuity bundle from the replacement before rollover, compaction, or another recovery operation; those ceremonies must continue rejecting the stale source bundle.

### Roll over a full evidence segment

Rollover is an offline owner-custody operation, never an automatic response to capacity. First export and inspect a current encrypted continuity bundle as described above. Keep that pre-archive bundle separately, then stop chargeOS; Caddy may remain up but will temporarily return an unavailable backend:

```sh
docker compose \
  --project-name chargeos-owner \
  --env-file .env.production \
  --file compose.production.yaml \
  stop chargeos

docker compose \
  --project-name chargeos-owner \
  --env-file .env.production \
  --file compose.production.yaml \
  ps --status running chargeos
```

Do not continue if the second command still lists the application container. With the edge stopped, create a post-archive bundle directly on owner-controlled media:

```sh
umask 077
docker compose \
  --project-name chargeos-owner \
  --env-file .env.production \
  --file compose.production.yaml \
  run --rm --no-deps -T \
  --volume /secure/offline/chargeos-owner.continuity.json:/recovery/pre-archive.continuity.json:ro \
  --entrypoint node \
  chargeos \
  dist/server/continuity-cli.js archive-stdout \
  --bundle /recovery/pre-archive.continuity.json \
  --passphrase-stdin \
  --confirmation "I confirm chargeOS is stopped and the matching continuity bundle is held separately" \
  < /secure/offline/chargeos-recovery-passphrase \
  > /secure/offline/chargeos-owner.post-archive.continuity.json
```

The command decrypts and compares every event and archive boundary with the stopped edge before mutation. It rejects a wrong key, stale/mismatched bundle, changed archive, non-exact confirmation, or empty active segment. The active file is atomically renamed to the next owner-only `events.ndjson.archives/segment-<sequence>-<sha256>.ndjson`; the new active segment begins with an `EvidenceSegmentArchived` audit record linked to that archived head. Segment filenames are contiguous and content-addressed. Startup fails for a gap, unexpected file, digest mismatch, or broken cross-segment chain.

Inspect the post-archive bundle before restart. Its `archiveSegmentCount` must increment, `currentEventCount` includes the archive audit, and its event count/head must match the stopped edge:

```sh
pnpm continuity inspect \
  --bundle /secure/offline/chargeos-owner.post-archive.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase

docker compose \
  --project-name chargeos-owner \
  --env-file .env.production \
  --file compose.production.yaml \
  up --detach chargeos
```

Do not delete or rename archived segments on this edge. Projections, transaction replay, audits, field packs, checkpoints, and recovery still read the complete logical chain. The post-archive schema-3 bundle preserves exact segment boundaries on source and production restore. If output delivery fails after the atomic rename, keep the edge stopped and rerun `export-stdout` to produce the required current bundle before relying on recovery.

Rollover prevents the active-file ceiling from becoming permanent backend loss; it does not reduce total disk usage or provide retention deletion. Expand owner-controlled storage before the volume fills, or use the create-only compacted replacement below while there is still enough working space to export and verify the full bundle.

### Replace a full edge with compacted operational recovery

Compaction deliberately creates a new recovery artifact; it never edits or deletes the current ledger. The exact full source bundle becomes the evidence authority for records omitted from the replacement. Keep its passphrase separately and keep the bundle on owner-controlled media with the normal backup policy. From a trusted host with the repository and dependencies installed:

```sh
umask 077
pnpm continuity compact \
  --bundle /secure/offline/chargeos-owner.post-archive.continuity.json \
  --output /secure/offline/chargeos-owner.compacted.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --confirmation "I confirm the full source bundle remains separately held and the compacted ledger will be installed only into a new empty edge"

pnpm continuity verify-custody \
  --bundle /secure/offline/chargeos-owner.compacted.continuity.json \
  --source-bundle /secure/offline/chargeos-owner.post-archive.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase

pnpm continuity inspect \
  --bundle /secure/offline/chargeos-owner.compacted.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase
```

Stop if inspection does not report payload schema 4, history mode `compacted-operational`, at least one custody bundle, zero local archive segments, and enough configured capacity for the retained ledger plus append headroom. `verify-custody` hashes and authenticates the exact encrypted source file, compares its chain metadata, deterministically rebuilds the expected retained projection, and requires every carried record to match. Reformatting or rewrapping that source creates different bytes and therefore needs a new compaction/custody record.

The compacted ledger carries every start fingerprint and transaction ID, aggregated replay counts, one meter sample per transaction, the first two distinct stops needed to preserve outcome/conflict, all authorization and safety state, current connector state, migration/Freedom evidence, delegate grants/revocations, recent bounded delegate-use/rate audits, and unknown future events. Heartbeats, redundant meter/stop frames, older connector states, archive audit records, and older bounded operational audits remain only in the full source bundle. Each copied record exposes `carriedFromRecordHash`; it is not the original complete chain. A redacted export reports schema 2 with history mode `compacted-operational`.

Use `restore-production` with fresh DNS/ACME metadata, install its ledger into a new empty volume, and boot a second edge exactly as in the recovery procedure above. Reinspect owner-list acknowledgement, pending revocations, active/completed sessions, delegates, migration/Freedom state, health, WSS identity, and capability readiness before changing traffic. A duplicate `StartTransaction` from the custodied period must reuse its retained transaction ID. If any check fails, stop the replacement and return traffic to the untouched old edge.

Only after that drill may the owner retire the old edge according to their storage policy. chargeOS supplies no erase command. Never discard a source bundle referenced by the schema-4 custody list: the compacted edge can operate without it, but omitted historical evidence can no longer be reviewed. Repeated compactions add custody records for newly omitted periods; preserve every referenced bundle. This workflow reduces edge-resident bytes but does not promise mathematically constant storage forever—the retained replay/state index still grows and compaction fails closed if it cannot fit with append reserve.

To rotate a suspected, aging, or procedurally scheduled recovery passphrase, create a different mode-`0600` passphrase file on separate owner media and rewrap the authenticated bundle:

```sh
pnpm continuity rotate \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --output /secure/offline/chargeos-owner.rotated.continuity.json \
  --old-passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --new-passphrase-file /secure/offline/chargeos-recovery-passphrase.next
```

Rotation authenticates the old bundle and evidence chain, requires a different strong passphrase, generates fresh salt/IV/authentication material, preserves the original snapshot timestamp and payload, rejects symlinked or group-readable passphrase files, and refuses to overwrite the output. Inspect the new bundle with the new passphrase, perform a fresh-path restore drill, then retire old bundle/passphrase copies according to the owner's policy. Rotation does not update the snapshot with newer ledger events; export again after material changes.

## Export and verify a field review pack

After recording migration and Freedom Test evidence, select **Export field review pack**. The owner-authenticated endpoint creates one redacted JSON pack containing the migration report, Freedom Test report, and the edge-resident redacted continuity evidence. On a schema-4 replacement, that evidence is explicitly `compacted-operational`; a reviewer needs every referenced full source bundle for omitted history. Each embedded artifact has a canonical SHA-256 digest, and all three must agree on station ID, evidence-chain head, and evidence-record count.

Verify a received pack without an owner token or recovery secret:

```sh
pnpm field-pack verify \
  --pack /secure/review/chargeos-ALFEN-field-pack.json
```

Verification detects changed embedded artifacts and inconsistent chain anchors. It does not establish who created the pack, independently timestamp it, validate separately held photos/configuration/backups, prove actual energy delivery, or make it a recovery bundle. Use an owner checkpoint and an external publication/timestamp when identity or chronology matters; use the encrypted continuity bundle for recovery.

## Sign an owner evidence checkpoint

A continuity bundle authenticates and checkpoints its own encrypted contents. To give an installer, auditor, or public archive a small receipt that can be verified without the bundle secret, create a separate owner-held Ed25519 signing key. Keep its passphrase separate from both the private key and continuity materials:

```sh
pnpm continuity keygen \
  --target /secure/offline/chargeos-evidence-signing \
  --passphrase-file /secure/offline/chargeos-signing-passphrase
```

The target must not exist. chargeOS creates a mode-`0700` directory containing an encrypted mode-`0600` PKCS#8 private key, an SPKI public key, and a public manifest with the SHA-256 public-key fingerprint. It never overwrites a key target.

Sign a previously verified continuity snapshot into a new file:

```sh
pnpm continuity checkpoint \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase \
  --private-key /secure/offline/chargeos-evidence-signing/private-key.pem \
  --key-passphrase-file /secure/offline/chargeos-signing-passphrase \
  --output /secure/offline/chargeos-evidence.checkpoint.json
```

The signature covers the station ID, continuity export timestamp, event count, last record hash, checkpoint creation time, algorithm, schema, and public-key fingerprint. It contains no raw RFID, station/API secret, bundle passphrase, or private key. A recipient can verify the signature with only the checkpoint and public key:

```sh
pnpm continuity verify-checkpoint \
  --checkpoint /secure/offline/chargeos-evidence.checkpoint.json \
  --public-key /secure/offline/chargeos-evidence-signing/public-key.pem
```

The owner can additionally prove that the receipt matches a particular encrypted snapshot:

```sh
pnpm continuity verify-checkpoint \
  --checkpoint /secure/offline/chargeos-evidence.checkpoint.json \
  --public-key /secure/offline/chargeos-evidence-signing/public-key.pem \
  --bundle /secure/offline/chargeos-owner.continuity.json \
  --passphrase-file /secure/offline/chargeos-recovery-passphrase
```

This proves that the holder of the encrypted private key signed those exact checkpoint fields and that an optional bundle matches them. It does **not** prove real-world identity, key-custody quality, checkpoint creation time, charger behavior, or physical Freedom Test truth. Keep a checkpoint copy outside the edge and publish or timestamp its digest independently when chronology matters. Never keep the private signing key only on the chargeOS data volume.

Keep the encrypted bundle and passphrase on separate media. The bundle contains station credentials and raw owner tags inside authenticated encryption; possession of both is equivalent to recovery authority. Export a new bundle after tag, credential, endpoint, or material ledger changes and destroy superseded copies according to the owner's retention policy.

The export endpoint is safe for support/evidence sharing but is not sufficient for recovery because it intentionally omits secrets and raw owner tags. The device configuration and transaction exports in the Alfen runbook remain separate evidence.

## Known limits

- one configured station and one owner root;
- OCPP 1.6J only;
- NDJSON is single-process and hard-capped per active segment; verified rollover preserves a complete segmented chain, while schema-4 replacement compaction reduces edge-resident history only when full bundles remain separately custodied. The retained operational index still grows, custody retention is manual, and neither chain is an independent signature;
- owner remote start/stop, restart, unlock and make-available exist, but there are no schedules, tariffs, billing, firmware updates, load limits, write-capable delegation, or cloud dependency; employer session reads are observations only;
- the production edge has automatic HTTPS/WSS, file-backed secrets, and explicit single-station protocol resource limits, but no volumetric DDoS service or multi-node failover;
- continuity restores application credentials, verified evidence, and safety limits, not DNS control, certificate material, Caddy state, or an inherited trusted-proxy topology;
- continuity passphrases can be rewrapped without plaintext restore, and owner Ed25519 checkpoints authenticate a selected chain head; external timestamp anchors remain future work;
- tagged `linux/amd64` images receive GitHub/Sigstore build-provenance and CycloneDX attestations only after the exact registry digest passes the production drill; protected/signed Git tags, independent rebuilds, vulnerability-clearance claims, additional architectures, and a non-GitHub trust root remain future work;
- no hardware/firmware combination is certified until the Freedom Test is witnessed and recorded.
