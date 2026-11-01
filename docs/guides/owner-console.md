# Use the owner console

The owner console is the web page where the charger's owner manages chargeOS. It shows the charger's connection, owner cards, sessions and evidence. It is separate from the employer workspace at `/service`.

## Sign in

1. Open your console address, for example `https://charge.company.be`. For a local source trial started with `pnpm dev` it is `http://127.0.0.1:5173`.
2. Paste the owner API token into **Owner API token**. For a setup-wizard installation it is `ownerToken` in the private `credentials.json` file. It is at least 32 characters.
3. Click **Open owner console**.

The token is the root authority for your chargers. Keep it in your password manager and never send it to an installer, employer or support person. The console keeps it only in the current browser tab. Closing the tab or clicking **Lock console** removes it from the browser.

If the console reports that the token is not valid, paste it again without extra spaces. After 10 failed attempts within a minute, chargeOS refuses further attempts until that minute has passed. Wait and try again rather than guessing. The **Setup and help guides** link works without a token.

## Choose a charger

With one charger, the console opens that charger's **Overview** directly. With several chargers, it opens **All chargers**, the fleet overview. Each row shows connection, owner-card state, offline readiness and anything that needs attention. Click **Manage** to open one charger, or use the **Charger** menu in the sidebar to switch. The bar at the top of every page names the selected charger and shows whether it is connected.

Every action applies only to the charger you selected. Check the name before adding a card or exporting evidence. The fleet view is a convenience; each charger keeps its own identity, password, card list and evidence.

Several chargers on one installation need a private stations file. The setup wizard does not create it. Your administrator copies `config/stations.example.json`, gives every charger a unique identity, password and owner-card list, and points `CHARGEOS_STATIONS_FILE` at it; see the [fleet configuration](../owner-edge-operations.md). The current encrypted recovery bundle covers one charger only, so use one charger per installation where recovery matters. See [Several chargers and brands](brands.md).

## Find your way around

The sidebar lists the pages for the selected charger. On a phone it becomes a row you can swipe sideways. A small dot next to a page means it has something to look at: amber for pending changes, red for a stop condition or failure.

- **Overview** answers the main question first. **Offline readiness** shows whether the charger reported the settings needed for offline owner charging, as a ring with one segment per check. **Software prerequisites pass** is not a physical test. **At a glance** summarizes every other page; click a row to open it. **Station** shows the hardware, firmware and each connector's status. The **Genesis plan** lists the next safe action first, the remaining ones below it, and the six migration phases with the current one highlighted. It is guidance; it never performs work and is not evidence that a step happened. **Stop condition** means keep the evidence and resolve the problem before continuing.
- **Charging** shows whether a session is in progress, the **Charger controls** for remote commands (see below), and **Energy history**, the list of sessions.
- **Owner cards** manages owner cards and the **Guarded actions** that inspect and synchronize them; see [Add or remove an RFID card](rfid.md).
- **Liberate my charger** and **Freedom Test** record migration and field-test evidence; see [Connect a charging station](connect-a-charger.md).
- **Delegated access** gives someone temporary read access; see below.
- **Evidence** shows **Latest owner ledger events**, recent records from the evidence ledger, the tamper-evident log chargeOS keeps.
- **AI troubleshooting** lets you ask your own AI provider about this charger; see [Use your own AI key](ai-help.md).

Each page has its own address, so the browser's back button and bookmarks work.

## Control the charger remotely

The **Charger controls** panel on the **Charging** page works only while the charger shows **Connected**, and only you (the owner) can use it.

- **Start remotely**: pick a connector and one of your owner cards (shown by its pseudonym, never the card number). The charger starts a session as if that card had been presented.
- **Stop session #…**: appears for each session that is currently charging.
- **Make connector … available**: asks the charger to accept sessions again, for example after a previous provider disabled it. chargeOS never switches a charger off. Chargers remember "off" even after a restart, so if chargeOS stopped running you could be locked out.
- **Unlock** releases the cable. Type the exact phrase shown first, and only do this when you are at the charger.
- **Restart** restarts the charger. **Soft** lets it end sessions cleanly; **Hard** is immediate. Type the exact phrase shown first.

Each command appears in the history with the charger's answer and, separately, what the charger reported afterwards:

- **accepted** means the charger said yes. It is not proof; wait for **Observed afterwards** to show, for example, "Session #7 started".
- **rejected** means the charger said no. **failed** means the command was not carried out; often this charger doesn't support it.
- **uncertain** means chargeOS got no clear answer (a timeout or lost connection). The charger may or may not have acted. Check its status or the charger itself before trying again.

None of these commands changes your owner card list or the settings that let you charge offline.

## Give someone temporary read access

Use this when an installer, employer or energy provider needs to see information about one charger. They get a limited, expiring read-only secret. They cannot change cards, settings or the charger, and they do not become an owner.

1. Select the right charger.
2. Open **Delegated access** in the sidebar and choose a **Delegate role**. **Installer** can read station status, diagnostics, the migration dossier and unreviewed Freedom Test evidence. **Employer reimbursement** can read session times and energy only, without card identities. **Energy provider** can read station and connector status only.
3. Choose **Expires after**: 1, 7, 30 or 90 days. Pick the shortest period that covers the work.
4. Click **Issue one-time secret**. Copy it immediately and send it privately to that one person. chargeOS cannot show it again.
5. Click **Dismiss secret** when you have copied it.

The secret does not open the owner console. The recipient uses it with the chargeOS delegate API; the [technical reference](../owner-edge-operations.md) lists the addresses. Click **Revoke** in the list when the work is finished. Revoking takes effect on their next request and does not affect your charging cards.

## Export evidence

Each export downloads a file for the selected charger. None of them is a recovery backup.

- **Export redacted continuity evidence** (on the **Evidence** page): a support file without secrets or raw card identifiers. Its name ends in `-continuity.json`, but it cannot restore anything.
- **Export migration dossier** (on the **Liberate my charger** page): the recorded migration checkpoints.
- **Export unreviewed report** (on the **Freedom Test** page): the recorded field-test results.
- **Export field review pack** (on the **Freedom Test** page): the migration dossier, Freedom Test report and redacted evidence in one file for an independent reviewer.

A reviewer can check that a field review pack is internally consistent with `pnpm field-pack verify --pack <file>`. That check needs no token. It does not prove who made the pack, when, or that the separately held photos and backups are true.

These files use pseudonyms instead of card identifiers. Still share them only with people who need them. For the encrypted backup that can restore your service, see [Back up and recover](recovery.md).

## If the console does not load

If it says **Opening the owner ledger…** for a long time or shows an error, click **Use another token** and try again. If the page itself does not open, check that DNS points to your server and that HTTPS has a valid certificate; see [Deploy chargeOS](deploy.md). chargeOS is designed so that previously synchronized owner cards keep working at the charger while the console is unavailable. Only a witnessed test on your exact charger proves that it does.
