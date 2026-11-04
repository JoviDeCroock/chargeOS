---
name: configure-charger
description: Connect and configure a physical charger for a chargeOS owner edge or a company edge, then make offline owner charging ready. Use for charger endpoint URLs, OCPP identity and password, security profile, ws versus wss, certificates, SIM/APN, installer sheets, connection troubleshooting (401, 409, 400), Boot identity, offline-readiness checks, owner-continuity settings, card registration, local-list synchronization, and per-charger setup in a company fleet.
---

# Configure a charger

The charger keeps its manufacturer firmware. Configuring it for chargeOS means entering a back-office address, identity and password through the manufacturer's supported tool, then confirming that the charger acknowledged the owner's card list. Only the witnessed Freedom Test shows that it charges offline. chargeOS never pushes firmware, never connects to the charger, and never authorizes physical work.

Use this skill for the connection and readiness work. Use `liberate-charger` when the charger is moving away from an existing provider, for the migration dossier, compatibility research and the Freedom Test. Use `deploy-owner-edge` or `deploy-company` for the server.

## Start

1. Read `AGENTS.md`, `docs/offline-invariants.md` and `docs/security-model.md`.
2. Read `docs/guides/connect-a-charger.md`, `docs/guides/rfid.md` and `docs/guides/brands.md`. For company fleets also read `docs/guides/company-chargers.md`. Operator detail is **Guarded operating sequence** and **Remote charger commands** in `docs/owner-edge-operations.md`.
3. Identify the exact model/article number, hardware revision, firmware, configuration tool and who holds its admin credentials, network path (Ethernet, Wi-Fi or SIM, and who owns the SIM), and the current back office. Check the row in `docs/charger-freedom-matrix.md`. For Alfen, read `.agents/skills/liberate-charger/references/alfen-field-notes.md` and `docs/alfen-genesis-runbook.md`.
4. If the charger is currently connected to another provider, stop here and use `liberate-charger`. Back up configuration and transactions before any change.

Opening the enclosure, wiring and SIM removal or replacement are installer work with power isolated. Never word an instruction as if the owner may do it.

## Gather the connection values

| Value          | Owner edge (wizard or Compose)                                                          | Company edge                                                   |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Endpoint       | `wss://<ocpp-domain>/<identity>` from **Connect your charger** or `INSTALLER-SHEET.txt` | Same, from the charger's **Setup sheet** after **Add charger** |
| Identity       | `CHARGEOS_STATION_ID` (wizard default `HOME-1`)                                         | **Charger ID** chosen at **Add charger** (often the serial)    |
| Password       | `stationSecret`, 40 lowercase hex digits                                                | Shown once on the setup sheet                                  |
| Protocol       | OCPP 1.6 JSON (`ocpp1.6` subprotocol)                                                   | Same                                                           |
| Authentication | HTTP Basic: user name = identity, password = station password                           | Same                                                           |

Rules:

- **Transport.** Over the internet, only `wss://` to the OCPP hostname with a publicly trusted certificate. Plain `ws://<lan-ip>:<port>/` is only for an isolated LAN lab or a planned private-network migration. Never use the console hostname or an IP address with `wss://`. Chargers cannot join a tailnet, so never give a charger a Tailscale (`100.x`, `ts.net`) address; a Tailscale console address is for people only.
- **URL shape.** chargeOS takes the identity from the last path segment. If the tool takes a base URL and appends the identity, give the base with a trailing slash. If you write the identity yourself, add no slash after it. The identity is case-sensitive.
- **Security profile.** Pick the profile that sends the Basic-auth password. Profile 0 (no password) gets 401.
- **Password.** Never shorten or retype a password into a different shape. Passwords from before 2026-11-01 are 48 characters and some chargers refuse them; there is no guided rotation yet, so escalate.
- **Certificates and clock.** The charger must trust the issuing CA and have a roughly correct clock. Older firmware may lack current roots. Confirm this on the exact charger before the maintenance window.
- **Network.** The charger connects outbound only. It needs DNS and outbound 443 to the OCPP hostname. No port forwarding toward the charger. A provider SIM on a private APN cannot reach chargeOS; SIM and APN changes go through the supported tool or the installer.
- **Secrets.** Hand the setup sheet or `INSTALLER-SHEET.txt` over privately and destroy it after use. Never paste the password, owner token or raw card value into chat, tickets or logs.

## Connect and confirm identity

1. The installer enters the values with the manufacturer's procedure. chargeOS does not verify any vendor's configuration steps.
2. Watch **Connect your charger** (owner) or **Set up this charger** (company) for **Charger connected**.
3. If the console shows a refusal, read its closed reason: wrong or missing password, the right password under a different name, a duplicate connection, or not OCPP 1.6 JSON. HTTP 401 means unknown identity, wrong password or a user name that isn't the identity; 409 means a connection with that identity is already open, so wait and never give two chargers the same identity; 400 means the charger didn't offer `ocpp1.6`.
4. If the charger used the right password under another name, the owner may click **Use <name>** within 15 minutes. That alias is recorded as evidence and still needs that charger's own password. The migration dossier still binds the configured identity, so don't adopt an alias during a documented migration.
5. Check the reported vendor, model and firmware (**Right charger** on company setup, **Station settings › Details** otherwise). A charger that reconnects without a Boot is asked once with `TriggerMessage` after 30 seconds. A mismatch is a stop condition. If no Boot ever arrives, restart through the supported tool or **Restart** under **Station settings › Remote control**; an `Accepted` reset is not proof that it restarted.

## Make offline owner charging ready

Follow the **Guarded operating sequence** in order:

1. Click **Check the charger** on **Station settings › Offline charging** (offline-capability inspection). Read every check; missing or unsupported keys keep readiness blocked.
2. If only the three canonical settings are unsafe and all are reported writable, the owner may use **Turn on offline charging** with the exact phrase. It changes only `LocalAuthListEnabled=true`, `LocalAuthorizeOffline=true` and `AllowOfflineTxForUnknownId=false`, never sends cards and never restarts. Read-only, missing or ambiguous keys go back to the supported manufacturer tool. One narrow exception: a charger that explicitly lists `AllowOfflineTxForUnknownId` in `unknownKey`, with no entry for it in any letter case, passes as "not offered by this charger" (`docs/offline-invariants.md`). A response that simply omits it stays blocked. Unknown-card refusal while offline is still a Freedom Test step.
3. After `RebootRequired`, restart through the supported procedure, wait for a later authenticated Boot and check again. chargeOS never restarts on its own.
4. Add the owner's card by tapping it (**RFID cards › Add card › Tap a card at the charger**) or by typing the identifier the charger actually reads. Tap-to-add needs a charger that asks about unknown cards; that is unverified for every model. On a company edge, classify the card (company or personal, business or private) and let an employee add only personal cards from their own page.
5. **Send to charger** replaces the local list with exactly the desired cards under a new revision. Only `Accepted` for that exact revision counts. Check **The charger accepted the current list** and **Card list version on charger**.
6. Charge once with the owner card online and present an unknown card to see it refused.
7. On a one-station edge, have the operator export and test-restore a fresh encrypted continuity bundle (`deploy-owner-edge`). Fleets can't produce one yet; say so.

Never enable unknown-card offline charging, edit the ledger or owner-tag files, or re-send lists in a loop to make a check pass. Removing a card is not instant revocation: it keeps working offline until the charger accepts the new list, and chargeOS never removes a charger's last card.

## Company fleet specifics

- Add each charger from **Chargers › Add charger** (or the stations file), each with its own identity, password and card file. Set **Make**, **Model** and **Firmware** to enable the identity check.
- A lost password can be replaced with **Make a new password** only before the charger first connects and while it has no card.
- Use **Review card sync** for multi-charger sends and read why each charger was skipped.
- Before an employee's installer moves a charger they are taking over, get an `Accepted` list revision without the company cards (**Leaves the company**, then **Review card sync**). After the move chargeOS can no longer revoke anything there. If that isn't possible, record the company cards as stale access at that charger. Retire only after the move, with the exact per-charger phrase. Retirement sends the charger no command; its stored cards keep working there.
- **Set up this charger** turning green means each step was seen online. It is not proof of offline behavior.

## What counts as done

Report only what was observed: connected, Boot identity, check results, accepted list revision, one online charge, unknown card refused. Don't call the charger offline-capable, liberated, certified or Freedom-tested until the witnessed Freedom Test in `docs/freedom-test.md` has been recorded and reviewed (`liberate-charger`). Record exact-device behavior worth keeping in `docs/charger-freedom-matrix.md` or the field notes, labelled as fact, observation, inference or uncertainty.

## Stop and roll back

- Identity, model or firmware differs from what was expected.
- There is no configuration backup or no tested way back.
- The tool can't store the full password, or only offers a no-password profile.
- Offline settings are read-only or missing and the manufacturer path is unknown.
- During a maintenance window, the connection fails in a way you can't explain. Restore the previous settings and investigate afterwards.

A charger-facing code change needs a simulator test and a stated effect on every failure mode in `docs/offline-invariants.md`.
