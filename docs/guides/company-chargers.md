# Run company and employee chargers

With the `company` profile, one chargeOS server can look after every charger your company is responsible for: chargers at the office, and chargers at employees' homes, whether the company or the employee bought them. You add chargers and cards from the console, give each employee a personal page for their own charger, and give your reimbursement service a read-only monthly feed.

Before you start:

- Whoever holds this server's owner token controls every charger on it, including chargers your employees bought. If an employee would rather keep control of their own charger, they run their own server and give you **Shared access** instead; see [Set up for yourself or for a company](personal-or-company.md#who-controls-the-chargers).
- Employees can only open their page if this server is reachable from their phone over HTTPS. That is the production deployment in [Deploy chargeOS](deploy.md). A server that listens only on its own computer cannot serve employees.
- Opening a charger, changing its wiring and removing or changing a SIM card is installer work, done with the power switched off. The console never asks you to do any of it.

## Add a charger

1. Open **Chargers** and click **Add charger**.
2. Give it a **Name** and **Location**, optionally choose the **Person** who uses it, and answer **Who owns the charger?** (company-owned or employee-owned). The owner label helps you plan what happens when someone leaves. It does not change who controls the charger.
3. Optional: open **Charger ID and identity check**. Some chargers have a fixed ID, often their serial number; enter it under **Charger ID**. Otherwise chargeOS chooses one. Fill in **Make**, **Model** and, if you know it, **Firmware** to have chargeOS check that the right charger connects.
4. Click **Create charger**. A **Setup sheet** appears with the server address, charger ID, password and protocol. Copy it to the installer now; the password is shown only once. If it gets lost before the charger first connects, open the charger and click **Make a new password**. After the charger has connected or has a card, the password can no longer be replaced here.
5. The installer enters those values in the charger's own setup tool. How to do that depends on the charger model and is not verified by chargeOS; follow the manufacturer's procedure. See [Connect a charging station](connect-a-charger.md) for the careful, reversible way to move a charger from another provider.

Open the new charger. Its **Overview** shows **Set up offline charging** with **Step N of 7**. chargeOS ticks each of the first six steps only when it has seen it happen:

1. **Connect the charger**: the charger connects with its setup sheet.
2. **Receive the charger’s details**: the make, model and firmware it reports match what you entered. If they do not match, setup stops. Check with the installer before going on.
3. **Register a card**: see the next section.
4. **Check offline settings**: click **Check offline settings**. This only reads the charger's settings. If a setting is not ready, open **Station settings › Offline charging**; see [Add or remove an RFID card](rfid.md#before-the-first-card).
5. **Send the cards to the charger**: click **Send to charger**.
6. **Try a charge while connected**: with the internet still connected, charge once with the registered card.
7. **Test offline charging**: at the charger, with chargeOS and the internet unavailable, charge with the card. **How to test** opens the field test guide.

chargeOS never ticks step 7. When the first six steps have passed, the console says **Setup complete for …**. That means chargeOS saw each step online. It does not prove the charger keeps working with the internet unplugged. Only a real test does that; see the [Freedom Test](connect-a-charger.md). Opening the charger, electrical work and SIM work stay with the installer, with the power isolated.

The setup page refreshes on its own every few seconds while you wait.

## Register a card by tapping it, and classify it

1. On the charger's setup steps click **Register a card**, or open **Cards** and click **Add card**, then **Tap a card at the charger**. The charger must be online.
2. Hold the card against that charger within two minutes. The charger refuses the card this time; that is expected.
3. When the console says **Card found**, choose **Who owns the card**:
   - **Company card**: only you can change or remove it.
   - **Personal card**: the employee can remove it from their own page, for example a partner's card.
4. Choose whether **Charging with this card is** **Business** (sessions can be reimbursed) or **Private** (sessions are never reimbursed and never sent to finance).
5. Click **Add this card**, then send the card list as in step 5 above.

The same physical card has one classification on every charger. To change it later, open **Cards**, click **Classify or remove** next to the card and choose **Company or personal…**. A card nobody classified shows **Not classified**. Its sessions reach the finance feed marked as unclassified, so someone has to decide before they are paid. A classification counts from the moment you set it: changing it later, or removing the card, does not change how earlier sessions are reported.

Card details are covered in [Add or remove an RFID card](rfid.md).

## Use one card at several chargers

An employee who charges at home and at the office can use one card at both.

1. In **Cards**, click **Classify or remove** next to the card, then **Use on other chargers…**.
2. Tick the chargers and confirm. The card number stays on the server and is never retyped.
3. On **Chargers**, click **Review card sync**. Check which chargers will receive their full list, the additions and removals, and why any charger is skipped. Confirm the send, then check each charger’s result.

The card row then says **Also works at** with the other chargers.

## When a card is lost

1. In **Cards**, click **Classify or remove** next to the card, then **Card lost: remove everywhere**.
2. The window lists the chargers it will be removed from. If it is the only card on a charger, that charger keeps it, because chargeOS never leaves a charger without a card. Add another card there first, then remove the lost one.
3. Click **Remove everywhere**, then go to **Chargers › Review card sync**. Confirm the eligible sends and check which chargers accepted the replacement list.

Until a charger has accepted its new list, it keeps accepting the lost card without internet. Removing a card is not an instant block.

## Give an employee their own page

1. Open **Employees**, then click **Employee page** next to the person. The person must be the **Person** on a charger.
2. Check what the page allows: see whether their charger is online and charging, see their sessions since their first current link was created, and add or remove their own personal cards. It never lets them change company cards or any other charger.
3. Click **Create link**. Send the link to the employee privately. It is shown once and works for 90 days. Anyone who has the link can open the page.

On their page the employee can click **Add a personal card**, tap it at their charger and add it. Such a card is always personal and private, so its sessions are never reimbursed. While you are adding a card at the same charger, their page asks them to try again later. The first card on a charger is always yours to add. If you have already checked offline charging on that charger, they can also send the card list themselves. To end a page early, open **Station settings › Shared access** for that charger and revoke it.

## When an employee leaves

1. Open **Employees** and click **Leaves the company** next to the person.
2. Choose what happens to their charger:
   - **The company keeps the charger**: their company cards, any personal or unclassified card on their charger (including cards they added from their own page; a card that is also used elsewhere is removed from their charger only) and their employee page are removed, and the charger is unassigned so you can give it to someone else. **Also remove their personal cards** is ticked by default.
   - **(Name) takes the charger**: company cards are removed and the employee page ends. Their personal cards keep working on their own charger (they are removed from any other charger), and the charger is marked employee-owned.
3. Read **What will happen**, then click **Apply**. Each step shows its own result. A step that could not be done says why; the others still run.
4. Open **Chargers › Review card sync** and confirm the eligible sends. Removed cards may still work at any charger that has not accepted the new list.
5. If the employee takes the charger, their installer later moves it to its new system. After that, click **Retire** in the same window, or open **Chargers**, click **More actions** next to the charger and choose **Retire charger…**. Type the phrase shown. A retired charger can no longer connect; its history stays and its ID is never reused. Cards already stored in the charger keep working there.

Reimbursement ends on the leaving date in the reimbursement service. Nothing here changes statements; see [Add a person](people.md#when-someone-leaves).

## Give finance the monthly feed

1. Open **Usage**. Under **Reimbursement feed**, click **Create finance access**.
2. Give the secret to your reimbursement service. It is shown once and lasts 90 days.
3. Before it ends, click **Renew for 90 days**. Renewing creates a new secret and ends the old one, so update the service at the same time.

The feed lists each month's business charging per charger, with anonymous card references and energy. It never contains names or card numbers. Sessions with a private card are left out and only counted. Sessions with an unclassified card are included and marked unclassified for review.

**Usage** also shows the private part of each employee's charging, and the CSV download has a `card_use` column.

## Current limits

- **No recovery bundle yet.** Once you have added, retired or marked a charger from the console, chargeOS refuses to create an encrypted recovery bundle. The bundle cannot yet carry console-added chargers, so it would restore an incomplete server. If you depend on recovery after losing this server, keep one charger per server for now; see [Back up and recover](recovery.md). Every charger still keeps charging its accepted cards without chargeOS.
- **Card classifications are only partly backed up.** After any recovery, cards show **Not classified** in the console until you classify them again. Reports for past months keep the classifications that were recorded at the time.
- **Tap registration needs a charger that reports taps.** chargeOS sees a tap only if the charger asks the server about an unknown card. Whether a given model does this is not verified for any device yet. If nothing happens, use **Other ways to add a card** and type the card number.
- **Settings check passed** describes the reported settings. **Field test** shows the separately recorded results for the exact charger.
