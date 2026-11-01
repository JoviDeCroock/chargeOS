# Add or remove an RFID card

An RFID card is the physical card or tag you hold against the charger. chargeOS needs the identifier that the charger actually reads. It may differ from the number printed on the card; ask your installer if you are unsure.

## Add a card

1. Open the owner console and check the charger name at the top of the page. With several chargers, choose the correct one in the **Charger** menu in the sidebar.
2. Open **Owner cards** in the sidebar. In the **Owner authorization** panel, type the card's actual OCPP identifier into **Add owner RFID identifier**. It can be up to 20 characters. Treat it as private information.
3. Click **Add desired tag**. This saves your intention; it does not yet update the charger.
4. In **Guarded actions** on the same page, click **Inspect**. The **Overview** page shows the result as **Offline readiness**, with a ring segment and a line for each check. Resolve any missing or failed check before synchronizing.
5. Click **Synchronize owner tags** while the charger is connected, and confirm the prompt. The button stays disabled until every readiness check passes.
6. Check that the panel says **Charger list matches desired owner access** and that **Latest completed attempt** shows the new revision with **Accepted**. A pending or rejected result does not make the card usable at the charger.
7. Test the actual card. Then ask your administrator for a fresh encrypted recovery bundle; see [Back up and recover](recovery.md).

While readiness has not passed, the **Guarded actions** panel shows **Prepare owner-continuity settings**. Use it only when the failed checks are the charger's offline settings. It asks the charger to turn on its local card list and offline use of known cards, and to turn off charging for unknown cards offline. Type the displayed phrase to use it. It changes nothing else, never synchronizes cards and never restarts the charger. If a setting is missing or read-only, it stops without changing anything; use the supported manufacturer procedure instead.

The console uses a private pseudonym when showing a card. It does not display the original identifier in operational evidence. Confirm which pseudonym belongs to a physical card before removing it.

## Remove a card

1. Open **Owner cards** for the correct charger and find the card's displayed pseudonym in the **Owner authorization** list.
2. Open **Remove a card** below the list and type the displayed phrase about possible stale access into the confirmation box.
3. Click **Revoke desired tag** next to that pseudonym, then inspect and synchronize the full list.
4. Check that the charger accepted the new revision, and ask for a new recovery bundle.

An offline charger can still accept its previously stored copy of a removed card until the updated list reaches it. Removing a card from chargeOS is not an immediate offline revocation. For a lost card, tell the owner or installer so they can decide how to handle access until reconnection.

Until the charger accepts the new list, the panel warns that a removed tag may still authorize locally. chargeOS will not remove the final desired owner credential; the button stays disabled. Keep a working owner card so essential charging remains possible during an internet or cloud outage.

## If a card does not work

Check the charger selection, the actual identifier, the latest inspection and the acknowledged revision. If the charger is offline, the new card remains pending. If inspection says a restart is required, follow the supported owner/installer procedure and inspect again after the charger reconnects. Do not enable unknown-card charging to work around a failed card.

For explanations of configuration checks, use [AI help](ai-help.md). For technical details, see [Owner-edge operations](../owner-edge-operations.md).
