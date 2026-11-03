# Use the owner console

The owner console is the web page where the charger's owner manages chargeOS: chargers, the people who charge, their RFID cards and usage. It is separate from the employer workspace at `/service`.

The console is available in English, Dutch (Nederlands) and French (Français). Pick a language with **Language** at the bottom of the sidebar or on the sign-in page. The choice is saved in that browser only. Without a choice, the console follows the browser's preferred language. These help guides, the **Switching provider**, **Freedom Test** and **AI help** sections, and the typed confirmation phrases are in English for now. Their safety wording has to be reviewed before it is translated. Those sections say so in your language.

## Sign in

1. Open your console address, for example `https://charge.company.be`. For a local source trial started with `pnpm dev`, it is `http://127.0.0.1:5173`.
2. Paste the owner token into **Owner token**. For a setup-wizard installation, it is `ownerToken` in the private `credentials.json` file. It is at least 32 characters. Right after setup you can skip this: **Open my console** on the setup page signs you in directly.
3. Click **Open console**.

The token is the root authority for your chargers. Keep it in your password manager and never send it to an installer, employer or support person. The console keeps it only in the current browser tab. Closing the tab or clicking **Lock console** removes it from the browser.

If the console reports that the token is not valid, paste it again without extra spaces. After 10 failed attempts within a minute, chargeOS refuses further attempts until that minute has passed. Wait and try again rather than guessing. The **Setup and help guides** link works without a token.

## Find your way around

The sidebar has the same everyday pages for everyone:

- **Overview**: the selected charger at a glance. Start with **What chargeOS knows**. It shows the charger’s latest charging report, whether the charger accepted the card list, and whether offline charging has been checked in a field test. **Your charging** shows recorded energy in kWh per month.
- **Chargers**: every charger as a card, with its name, location, person, cards, recorded energy and anything that needs attention. Click **Open** to work on one charger, or **Edit names** to rename it.
- **People** (**Employees** with the company profile): everyone who charges, with their charger and cards. See [Name chargers, people and cards](owner-console.md#name-chargers-people-and-cards).
- **RFID cards**: the cards that may start charging at the selected charger. See [Add or remove an RFID card](rfid.md).
- **Usage** (company profile, or several chargers): energy per person and per charger for a month, with a CSV download. See [Set up for yourself or for a company](personal-or-company.md).
- **Station settings**: the technical tools for the selected charger (see below).

At the bottom of the sidebar are **Language**, **Preferences**, **Help guides** and **Lock console**. With several chargers, a **Charger** menu at the top of the sidebar switches the selected charger. The bar at the top of every page names that charger and shows whether it is connected. A small dot next to a page means it has something to look at: amber for changes waiting, red for a stop condition or failure. On a phone the sidebar becomes a row you can swipe sideways.

With one charger, the console opens on **Overview**. With several, it opens on **Chargers**. Every action applies only to the selected charger, so check its name before adding a card or downloading a record. Each charger keeps its own identity, password, card list and records. The overview of all chargers is a convenience.

Several chargers on one installation need a private stations file. The setup wizard does not create it. Your administrator copies `config/stations.example.json`, gives every charger a unique identity, password and owner-card list, and points `CHARGEOS_STATIONS_FILE` at it; see the [fleet configuration](../owner-edge-operations.md). The current encrypted recovery bundle covers one charger only, so use one charger per installation where recovery matters. See [Several chargers and brands](brands.md).

Each page has its own address, so the browser's back button and bookmarks work.

### Read the charger status

- **Charging right now**: the console uses connector reports from the current connection. It shows **Unknown** when the charger is disconnected, a current report is missing, or the console can’t refresh. An open session in the records can outlast a connection.
- **Cards on the charger**: registering a card adds it to chargeOS. The charger confirms delivery separately by accepting the list. Until it accepts the updated list, removed cards may still work at the charger.
- **Charging without internet**: a settings check can tell you what the charger reports. It does not prove offline charging. Test at the charger using the [field test guide](connect-a-charger.md#check-charging-after-the-move). Recorded field results still need review, and results from an outdated test do not carry forward.

## Name chargers, people and cards

Names make the console readable: "Sofie's driveway" instead of a charge point ID, and "Blue fob" instead of an anonymous card reference.

- **Charger**: on **Chargers** or **Overview**, click **Edit names**. Set **Name**, **Location** and **Person**. Usage on that charger is reported under that person. The charge point ID the charger connects with cannot be changed here.
- **Person**: on **People**, click **Add person**. Use **Rename** or **Remove** on a person's card. Removing someone keeps their chargers and cards, now without a name attached. Charging is not affected.
- **Card**: on **RFID cards**, click **Edit** next to a card to set **Card name** and **Who uses it**. You can also name a card while adding it.

Names are labels in this console only. They stay on the chargeOS server and are not sent to the charger. They never appear in the tamper-evident record, the shareable record download, field review packs, shared read access or AI help. Those keep using anonymous card references. A name is 1–80 characters of ordinary text.

The names are stored in `directory.json` beside the records. They are not part of the encrypted recovery bundle, so your administrator backs that file up separately or you enter the names again after a recovery. If the file cannot be read, the console shows the configured names, switches editing off and leaves the file untouched for your administrator to fix. Charging and cards keep working.

## Station settings

**Station settings** holds the technical tools for the selected charger, as tabs:

- **Offline charging**: whether the charger has the settings it needs to accept your cards without internet, shown as a ring with one segment per check. **Check the charger** only reads settings. **Send to charger** replaces the charger's card list. **Turn on offline charging** appears while a setting is missing. See [Add or remove an RFID card](rfid.md).
- **Remote control**: remote commands and their history (see below).
- **Sessions**: every charging session with card, connector, energy and status. **Repeated messages** means the charger sent the same session report more than once; it is counted once. **Conflicting data** means two different stop values arrived; the first one is kept.
- **Details**: the charge point ID, model, firmware and connectors.
- **Shared access** (optional): temporary read access for someone else (see below).
- **Records** (optional): the latest entries in the tamper-evident record and the shareable download.
- **Switching provider** and **Freedom Test** (optional module **Switching and Freedom Test**): record migration and field-test evidence. See [Connect a charging station](connect-a-charger.md). The plan there lists the next safe action. It is guidance; it never performs work and is not evidence that a step happened. **Stop condition** means keep the evidence and resolve the problem before continuing. The overview shows a red **Stop** banner whenever that happens.
- **AI help** (optional): ask your own AI provider about this charger; see [Use your own AI key](ai-help.md).

Turn the optional tabs on or off under **Preferences**. A hidden tab comes back on its own while it needs you; see [Set up for yourself or for a company](personal-or-company.md).

**Ready** on **Offline charging** means the charger reported every setting it needs. It is not a physical test. Do one real test: disconnect the internet and charge with your card.

## Control the charger remotely

**Station settings › Remote control** works only while the charger shows **Connected**, and only you (the owner) can use it. **Stop charging** on the **Overview** does the same as **Stop session** here.

- **Start remotely**: pick a connector and one of your cards. The charger starts a session as if that card had been presented.
- **Stop session #…**: appears for each session that is currently charging.
- **Make connector … available**: asks the charger to accept sessions again, for example after a previous provider disabled it. chargeOS never switches a charger off. Chargers remember "off" even after a restart, so if chargeOS stopped running you could be locked out.
- **Unlock** releases the cable. Type the exact phrase shown first, and only do this when you are at the charger.
- **Restart** restarts the charger. **Soft** ends charging cleanly first; **Hard** is immediate. Type the exact phrase shown first.

Each command appears in **Command history** with the charger's answer and, separately, **What happened afterwards**:

- **accepted** means the charger said yes. It is not proof; wait for **What happened afterwards** to show, for example, "Session #7 started".
- **refused** means the charger said no. **failed** means the command was not carried out; often this charger doesn't support it.
- **uncertain** means chargeOS got no clear answer (a timeout or lost connection). The charger may or may not have acted. Check its status or the charger itself before trying again.

None of these commands changes your card list or the settings that let you charge offline.

## Give someone temporary read access

Use this when an installer, employer or energy provider needs to see information about one charger. They get a limited, expiring read-only secret. They cannot change cards, settings or the charger, and they do not become an owner.

1. Select the right charger.
2. Open **Station settings › Shared access**. If the tab is missing, turn on **Shared access** under **Preferences**.
3. Choose **Who is it for**. **Installer** can see charger status, diagnostics, the switching record and unreviewed Freedom Test results. **Employer (reimbursement)** can see session times and energy only, without card identities. **Energy provider** can see charger and connector status only.
4. Choose **Expires after**: 1, 7, 30 or 90 days. Pick the shortest period that covers the work.
5. Click **Create access**. Copy the secret immediately and send it privately to that one person. chargeOS cannot show it again.
6. Click **I copied it** when you are done.

The secret does not open the owner console. The recipient uses it with the chargeOS delegate API; the [technical reference](../owner-edge-operations.md) lists the addresses. Click **Revoke** in **Who has access** when the work is finished. Revoking takes effect on their next request and does not affect your cards.

## Download records

Each download is a file for the selected charger. None of them is a recovery backup.

- **Download shareable record** (**Station settings › Records**): a support file without secrets or card numbers. Its name ends in `-continuity.json`, but it cannot restore anything.
- **Export migration dossier** (**Switching provider**): the recorded migration checkpoints.
- **Export unreviewed report** (**Freedom Test**): the recorded field-test results.
- **Export field review pack** (**Freedom Test**): the migration dossier, Freedom Test report and shareable record in one file for an independent reviewer.

A reviewer can check that a field review pack is internally consistent with `pnpm field-pack verify --pack <file>`. That check needs no token. It does not prove who made the pack, when, or that the separately held photos and backups are true.

These files use anonymous card references, never card numbers or the names you gave. Still share them only with people who need them. For the encrypted backup that can restore your service, see [Back up and recover](recovery.md).

## If the console does not load

If it says **Opening your console…** for a long time or shows an error, click **Use another token** and try again. If the page itself does not open, check that DNS points to your server and that HTTPS has a valid certificate; see [Deploy chargeOS](deploy.md). chargeOS is designed so that cards already on the charger keep working while the console is unavailable. Only a witnessed test on your exact charger proves that it does.
