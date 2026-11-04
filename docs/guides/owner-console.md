# Use the owner console

The owner console is the web page where the charger's owner manages chargeOS: chargers, the people who charge, their RFID cards and usage. It is separate from the employer workspace at `/service`.

The console is available in English, Dutch (Nederlands) and French (Français). Pick a language under **Preferences**, or at the foot of the sign-in page. The choice is saved in that browser only. Without a choice, the console follows the browser's preferred language. These help guides, the **Switching provider**, **Freedom Test** and **AI help** sections, and the typed confirmation phrases are in English for now. Their safety wording has to be reviewed before it is translated. Those sections say so in your language.

## Sign in

1. Open your console address, for example `https://charge.company.be`. For a local source trial started with `pnpm dev`, it is `http://127.0.0.1:5173`. The page says **Your chargeOS console**.
2. Paste the owner token into **Owner token**: the token you were given when chargeOS was installed. If you don't have it, ask whoever installed it. For a setup-wizard installation, it is `ownerToken` in the private `credentials.json` file. It is at least 32 characters. Right after setup you can skip this: **Open my console** on the setup page signs you in directly.
3. Click **Open console**.

The token is the root authority for your chargers. Keep it in your password manager and never send it to an installer, employer or support person. The console keeps it only in the current browser tab. Closing the tab or clicking **Lock console** removes it from the browser.

If the console reports that the token is not valid, paste it again without extra spaces. After 10 failed attempts within a minute, chargeOS refuses further attempts until that minute has passed. Wait and try again rather than guessing. **Help finding your token**, beside the field, opens this guide and works without a token. The language picker sits at the foot of the sign-in card.

## Find your way around

The sidebar has the same everyday pages for everyone:

- **Overview**: the selected charger at a glance. While the charger is being set up, it leads with the setup steps; see [Follow the setup steps](owner-console.md#follow-the-setup-steps). Afterwards, start with **What chargeOS knows**. It shows the charger’s latest charging report, whether the charger accepted the card list, and whether offline charging has been checked in a field test. **Your charging** shows this month's energy in kWh and number of sessions, then **Last session …**. It says **Measured by your charger’s own meter. Not a bill.** **How this is counted** explains the counting, and **See all sessions** opens **Sessions**. From the second month with charging, it also compares months and shows a chart. A charge in progress counts towards this month: the figures say **incl. … charging now**, and the chart marks this month's column with a pulsing top you can hover or focus for the energy so far. Screen readers hear each column as a sentence, including the energy charging now. With a price set, the totals also show **≈ … at your price**.
- **Chargers**: every charger as a card, with its name, location, connection, charging status, cards, energy, last session and next step. Use the next action on a charger card or open its overview. With one charger that is still being set up, the card says **Setup not finished** under its name and offers **Continue setup** and **Name charger**. **Person** appears when someone is linked to the charger, and for every charger once you have several. In fleet mode, **Review card sync** shows which chargers can receive their lists and why others are skipped. Confirm the send and check each charger’s result.
- **People** (**Employees** with the company profile): everyone who charges, with their charger and cards. See [Name chargers, people and cards](owner-console.md#name-chargers-people-and-cards).
- **Cards**: the cards that may start charging at the selected charger. See [Add or remove an RFID card](rfid.md).
- **Sessions**: every charging session on the selected charger, newest first. See [See your charging sessions](owner-console.md#see-your-charging-sessions).
- **Usage** (company profile, or several chargers): energy per person and per charger for a month, with a CSV download. See [Set up for yourself or for a company](personal-or-company.md).
- **Station settings**: the technical tools for the selected charger (see below).

Below the pages are **Preferences**, **Help guides** and **Lock console**. With several chargers, a **Charger** menu at the top of the sidebar switches the selected charger, and the bar at the top of every page names that charger and shows whether it is connected. With one charger, each page shows the charger's status itself. A small dot next to a page means it has something to look at: amber for changes waiting, red for a stop condition or failure. On a phone the page list is folded away: tap **Menu** to open it and **Close menu** to fold it again.

With one charger, the console opens on **Overview**. With several, it opens on **Chargers**. Every action applies only to the selected charger, so check its name before adding a card or downloading a record. Each charger keeps its own identity, password, card list and records. The overview of all chargers is a convenience.

Several chargers on one installation need a private stations file. The setup wizard does not create it. Your administrator copies `config/stations.example.json`, gives every charger a unique identity, password and owner-card list, and points `CHARGEOS_STATIONS_FILE` at it; see the [fleet configuration](../owner-edge-operations.md). The current encrypted recovery bundle covers one charger only, so use one charger per installation where recovery matters. See [Several chargers and brands](brands.md).

Each page has its own address, so the browser's back button and bookmarks work.

### Follow the setup steps

While a charger is being set up, the **Overview** header says **Your charger** until you name it, with three separate facts:

- **Connection**: for example **Connected to chargeOS**.
- **Right now**: **Not charging**, or **Unknown** without a current report. While the charger reports charging, or something needs your attention, the overview shows its full status instead.
- **Offline charging**: **Not tested yet**. It never says that offline charging works: only your own test at the charger can show that.

Below it, the setup card says **Step N of 7** and **Set up offline charging**. Once a card is registered and the charger is connected, it explains that your cards already work while the charger is connected to chargeOS, and that charging without that connection still needs these steps and your own test. The steps are:

1. **Connect the charger**, so chargeOS can reach it.
2. **Receive the charger’s details**, so you know it's the right charger.
3. **Register a card**, so your card can start a charge.
4. **Check offline settings**. This only reads the charger's settings and changes nothing.
5. **Send the cards to the charger**, so the charger knows your cards without internet.
6. **Try a charge while connected**: with the internet still connected, start and finish a charge with your card, after sending it. This does not test charging without internet.
7. **Test offline charging**: at the charger, with chargeOS and the internet unavailable, charge with your card. **How to test** opens the [field test guide](connect-a-charger.md#check-charging-after-the-move).

chargeOS ticks steps 1 to 6 only when it has seen them happen. It never ticks step 7. That step is your own test, and software cannot check it for you. Never open the charger for this test: electrical work, opening the enclosure and SIM work are for your installer, with the power isolated.

Finished steps fold into one line, **Steps 1–N done**; click it to see them. The current step is highlighted and has the one button you need. Upcoming steps show their title and a short reason; on a phone, only the title. If the charger has not connected yet, the overview shows a folded **Set up this charger** with its progress. If setup stops, the card says **Set up this charger** and **Stopped**; check with your installer before going on. When steps 1 to 6 have passed, the setup card is replaced for a day by **Setup complete for …**, which says that one real test with the internet unplugged is still the only proof. Step 7 is then still yours to do.

While setup runs, the overview header has no naming button. Name the charger with **Name charger** on **Chargers** or under **Station settings › Details**. After setup, the overview header shows **Name charger** or **Edit names**.

### See your charging sessions

**Sessions** lists every charging session on the selected charger, newest first. Above the list are this month's energy and number of sessions. Each row shows when the session started, the card, how long it lasted, the energy and its status. **Charging speed** shows the session's speed line and its average once the charger has sent enough meter readings. With a price set (see [Electricity price and notifications](owner-console.md#electricity-price-and-notifications)), **Est. cost** shows the estimated cost of each session. A **Connector** column appears only when sessions used more than one connector. A finished session reads **Finished** in plain text; a session still charging says **charging**, with the energy so far. **Repeated messages** means the charger sent the same session report more than once; it is counted once. **Conflicting data** means two different stop values arrived; the first one is kept. The note inside the list says that energy comes from the charger’s own meter and is final once a session stops. The old address `#/advanced/sessions` opens this page.

### Read the charger status

- **Charging right now**: the console uses connector reports from the current connection. It shows **Unknown** when the charger is disconnected, a current report is missing, or the console can’t refresh. An open session in the records can outlast a connection. Use **Refresh status** to request the latest report from chargeOS.
- **Energy so far**: while a session is open, the overview and the session list show the energy since the session started, from the charger’s latest meter reading, and when that reading was taken. Many chargers report only every 15 minutes, so the number trails the car. While the charger reports charging, the overview refreshes once a minute. The final figure comes from the charger when the session stops. If chargeOS restarts or reconnects during a charge, the energy so far stays visible; **Stop charging** returns once the charger sends a new meter reading on the new connection.
- **Charging speed**: after a few minutes of charging, the overview shows **about … kW on average**: the energy so far divided by the time since the session started. It leaves out stretches in which the meter barely moved, such as a pause after the battery is full, so it reads as the speed while charging. It is what the car actually took, not the charger’s maximum, so a car or charger limit (for example a 3 kW comfort setting) shows here. Once the charger has sent two meter readings, a small line shows the speed over each reading interval; a dip is a pause or a lower limit. Screen readers announce it as **Charging speed during this session, between … and …**. With a regular reading interval, the overview also says when the next reading is expected; on very long sessions it stops guessing.
- **Paused by the car** or **Paused by the charger**: the charger reports that a session is open but not drawing power. **By the car** usually means the battery is full, a charging schedule or limit in the car, or the car waiting. **By the charger** means the charger is holding back power, for example a schedule, load balancing or a limit set on the charger. chargeOS shows who paused, not why; the energy so far stays visible and the overview keeps refreshing.
- **Cards on the charger**: registering a card adds it to chargeOS. The charger confirms delivery separately by accepting the list. Until it accepts the updated list, removed cards may still work at the charger.
- **Charging without internet**: a settings check can tell you what the charger reports. It does not prove offline charging. Test at the charger using the [field test guide](connect-a-charger.md#check-charging-after-the-move). Recorded field results still need review, and results from an outdated test do not carry forward.

### Electricity price and notifications

Both are under **Preferences** and are saved in this browser only.

- **Electricity price**: enter your price per kWh and currency, then **Save price**. A comma or a point works as the decimal separator. Prices above 10 per kWh are refused as a likely typo (for example cents entered as euros). The console then shows estimated costs for the charge in progress, each session, this month and each month in the chart. These are estimates from the charger’s meter and one price: not a bill, and they leave out time-of-day tariffs, fixed fees and anything else your price doesn’t include. **Remove price** hides the estimates again. The price is not sent to chargeOS, so other browsers and shared links don’t see it.
- **Notifications**: **Turn on** asks the browser for permission. You then get a notification when a charge finishes (with its energy, and its estimated cost if you set a price), pauses or resumes, or when the charger reports a fault. Notifications come only from a console tab that is open on this device, only for the charger open in it, and only while you’re not looking at it. In a background tab, the console checks the charger once a minute during a charge and every five minutes otherwise. Notifications show the charger’s name, also on a locked screen. chargeOS sends no push messages, and nothing changes on the charger. Browsers only allow notifications on a secure (HTTPS) address or on the computer running chargeOS itself. On a plain `http://` address, the console says so instead of offering **Turn on**; open it over HTTPS, for example with Tailscale Serve. If the browser blocks notifications, allow them in its site settings.

## Name chargers, people and cards

Names make the console readable: "Sofie's driveway" instead of a charge point ID, and "Blue fob" instead of an anonymous card reference.

- **Charger**: on **Chargers**, click **Name charger** (or **Edit names** once it has a name). The same button is under **Station settings › Details**, and on **Overview** once setup is finished. Set **Name**, **Location** and **Person**. Usage on that charger is reported under that person. The charge point ID the charger connects with cannot be changed here.
- **Person**: on **People**, click **Add person**. People are optional: with nobody added yet, the page says **No people yet** and that adding the people who charge here shows whose card started each session. Use **Rename** or **Remove** on a person's card. Removing someone keeps their chargers and cards, now without a name attached. Charging is not affected.
- **Card**: on **Cards**, click **Name card** (or **Edit** once it has a name) next to a card to set **Card name** and **Who uses it**. You can also name a card while adding it.

Names are labels in this console only. They stay on your chargeOS server and are not sent to the charger. They never appear in the tamper-evident record, the shareable record download, field review packs, shared read access or AI help. Those keep using anonymous card references. A name is 1–80 characters of ordinary text.

The names are stored in `directory.json` beside the records. They are not part of the encrypted recovery bundle, so your administrator backs that file up separately or you enter the names again after a recovery. If the file cannot be read, the console shows the configured names, switches editing off and leaves the file untouched for your administrator to fix. Charging and cards keep working.

## Station settings

**Station settings** holds the technical tools for the selected charger, as tabs:

- **Offline charging**: whether the charger has the settings it needs to accept your cards without internet, shown as a ring with one segment per check. Until the charger has been checked, the tab is titled **Check settings for offline charging**. **Check offline settings** only reads settings. **Send to charger** replaces the charger's card list. **Turn on offline charging** appears while a setting is missing. Two rows keep the software check and your own test apart: **Offline settings** (**Passed**, **Needs fixing** or **Not checked**) and **Test offline charging** (**Not done** until a field result is recorded). During setup, the tab also says which setup step this is. See [Add or remove an RFID card](rfid.md).
- **Remote control**: start a charge or restart the charger without going to it, and the command history (see below).
- **Details**: the charger's name, location and person, its charge point ID, model, firmware and when it connected, with each connector as a row in the same list. **Name charger** or **Edit names** changes the names. Connection help appears here until the charger has connected and reported.
- **Shared access** (optional): temporary read access for someone else (see below).
- **Records** (optional): the latest entries in the tamper-evident record and the shareable download.
- **Switching provider** and **Freedom Test** (optional section **Switching provider** under **Preferences › Extra sections**): record migration and field-test evidence. See [Connect a charging station](connect-a-charger.md). The plan there lists the next safe action. It is guidance; it never performs work and is not evidence that a step happened. **Stop condition** means keep the evidence and resolve the problem before continuing. The overview shows a red **Stop** banner whenever that happens.
- **AI help** (optional): ask your own AI provider about this charger; see [Use your own AI key](ai-help.md).

Turn the optional tabs on or off under **Preferences**. A hidden tab comes back on its own while it needs you; see [Set up for yourself or for a company](personal-or-company.md).

**Settings check passed** describes the charger’s reported settings. The separate **Test offline charging** row shows your own test, which software cannot do for you. Wait for the charger to accept its current card list, then follow the field test guide.

## Control the charger remotely

**Station settings › Remote control** lets you start a charge or restart the charger without going to it. It works only while the charger shows **Connected**, and only you (the owner) can use it. **Stop charging** on the **Overview** does the same as **Stop session** here.

- **Start charging**: pick one of your cards, and a connector when the charger has more than one (the button then says **Start on connector …**). The charger starts a session as if that card had been presented. Plug in the car first.
- **Stop session #…**: appears for each session that is currently charging.
- **Connector availability**: use **Make connector … available** to ask the charger to accept sessions again, for example after a previous provider disabled it. With several connectors, choose the connector first. With one connector that is already available, this section is hidden because there is nothing to change. chargeOS never switches a charger off. Chargers remember "off" even after a restart, so if chargeOS stopped running you could be locked out.
- **Unlock**, under **Restart and maintenance**, releases the cable. Type the exact phrase shown first, and only do this when you are at the charger.
- **Restart**, under **Restart and maintenance**, restarts the charger. **Soft** ends charging cleanly first; **Hard** is immediate. Type the exact phrase shown first.

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
