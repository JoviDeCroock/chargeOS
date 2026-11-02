# Set up for yourself or for a company

chargeOS runs the same way for a person with one home charger and for a company that runs chargers for its drivers. What differs is what the owner console shows first. Choose a **profile** when you start the server, then turn optional sections on or off in **Preferences**.

## Which profile fits

| You are…                                                                       | Profile    | The console opens on                                                                  |
| ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| A person with your own charger, perhaps a second one at a holiday home         | `personal` | **Your charging**: kWh this month, last month and the past 12 months, plus your cards |
| An employer, fleet manager or association running chargers for several drivers | `company`  | **Chargers**, **Employees** and **Usage** grouped by employee, with a CSV download    |

Set it with `CHARGEOS_PROFILE=personal` or `CHARGEOS_PROFILE=company` in the server's environment file and restart. Without the setting chargeOS uses `personal`. The profile only arranges the console. It does not change who can charge, what the charger stores, or any safety check.

## What is always there, and what is optional

Every profile always has:

- **Overview**: whether the charger is charging now, how much you charged, whether your cards work without internet, and the charger's status.
- **Chargers**: every charger with its name, person, cards and energy.
- **People** (**Employees** with the company profile): who charges where, with their cards; see [Use the owner console](owner-console.md#name-chargers-people-and-cards).
- **RFID cards**: add, name or remove the cards that may charge; see [Add or remove an RFID card](rfid.md).
- **Station settings**: **Offline charging**, **Remote control**, **Sessions** and **Details** for the selected charger.

These **Station settings** tabs are optional:

| Section                        | Tabs                                     | On by default for |
| ------------------------------ | ---------------------------------------- | ----------------- |
| **Switching and Freedom Test** | **Switching provider**, **Freedom Test** | nobody            |
| **Shared access**              | **Shared access**                        | company           |
| **Records**                    | **Records**                              | company           |
| **AI help**                    | **AI help**                              | nobody            |

To change them, click **Preferences** at the bottom of the sidebar and tick or untick a section. **Use profile defaults** undoes your choice. Your choice is kept in this browser only. Another browser or colleague starts from the profile defaults. **Preferences** also has the console **Language**.

Hiding a section never switches anything off. Cards keep working offline, recorded evidence stays, and the server keeps every function. A hidden tab comes back on its own when it needs you: when someone still holds shared access, or when a switching step or Freedom Test is open, stopped or stale. If you are moving a charger away from a previous provider, turn on **Switching and Freedom Test** first; see [Connect a charging station](connect-a-charger.md).

## See how much you charge

On **Overview**, **Your charging** shows:

- **This month**, the previous month and **Last 12 months**, in kWh, with the number of sessions;
- a column per month. Hover over or tab to a column for its exact value, or click **Show table**;
- **This month by card**, when more than one card charged this month. Cards appear by the name you gave them, or by a short anonymous reference, never by card number.

A session belongs to the month it started, in your browser's time zone. Energy comes from the charger's own meter. A session still in progress counts once it stops. The figures are an overview, not a bill or an approved reimbursement.

## Report usage per employee (company)

With `CHARGEOS_PROFILE=company`, or with several chargers, the sidebar has **Usage**.

1. Give every charger its person. Open **Employees** (or **People**), click **Add employee** for each person, then on **Chargers** click **Edit names** on each charger and choose the **Person**. Chargers without a person appear as **Nobody**.
2. Open **Usage** and choose a **Month**.
3. Read **Usage by person** (energy and sessions per person, across all their chargers) and **Usage by charger** below it.
4. Click **Download CSV** for a file with one row per session. It lists the month, driver, charger, a unique `session_id`, start and stop times, energy in kWh, whether the session is complete, any evidence conflict, and the card pseudonym.

An administrator can also pre-fill names before the first start. In the private stations file, `label`, `site` and `driver` give a charger's first name, location and person. For a single-charger installation, `CHARGEOS_STATION_DRIVER` sets the person. chargeOS copies them into the console names once; after that, edit them in the console. A stations file entry with a driver looks like this. The other fields are explained in the [fleet configuration](../owner-edge-operations.md):

```json
{
  "id": "HOME_ALEX",
  "label": "Alex's driveway",
  "site": "Leuven",
  "driver": "Alex Peeters",
  "secret": "output-of-openssl-rand-hex-20",
  "ownerTags": ["alex-card-identifier"]
}
```

To turn a month into a reimbursement statement in the employer workspace, filter the CSV to one driver. Then import it as described in [Review home-charging reimbursements](reimbursements.md). Map **Session ID** to `session_id`, **Station ID** to `charger_id`, start to `started_at`, end to `stopped_at` and energy to `energy_kwh` in kWh with a `.` decimal separator. Declare the employee alias for the import. Rows still in progress are refused instead of guessed.

**If a warning appears:** "still charging" means some energy is not final yet, so export again after those sessions stop. "Conflicting stop values" means the charger reported a session twice with different results. The report uses the first value and marks the row `conflict`; check that session under **Station settings › Sessions** before paying it.

## Who controls the chargers

Whoever holds the owner token for a chargeOS server controls every charger on it. That matters when an employer hosts chargers at employees' homes:

- **The company owns the chargers** (it bought or leases them): the company can run one server with every charger on it, using the `company` profile. Each charger keeps its own password and card list, and drivers' cards keep working at their charger when the server or internet is down.
- **The employee owns the charger**: the employee should run their own server, or use one they control, with the `personal` profile. They give the employer **Shared access** with the **Employer (reimbursement)** role. That role can read session times and energy only, and the employee can revoke it at any time.

Drivers cannot sign in to the owner console to see only their own usage yet. Today they see their reimbursement statements in the employer workspace. Driver accounts on the owner edge are not built.
