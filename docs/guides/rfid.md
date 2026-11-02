# Add or remove an RFID card

An RFID card is the physical card or key fob you hold against the charger. chargeOS needs the identifier that the charger actually reads. It may differ from the number printed on the card; ask your installer if you are unsure.

## Add a card

1. Open the owner console and check the charger name at the top of the page. With several chargers, choose the correct one in the **Charger** menu in the sidebar.
2. Open **RFID cards** and click **Add card**.
3. Type the card's actual identifier into **Card number**. It can be up to 20 characters. Treat it as private information. The field hides what you type, and the console never shows the number again.
4. Optionally give the card a **Card name**, such as "Blue key fob", and choose **Who uses it**. Choose **Someone new…** to add a person at the same time. Names are labels in the console only; see [Name chargers, people and cards](owner-console.md#name-chargers-people-and-cards).
5. Click **Add card**. The card is now on the list as **Waiting to be sent**. It does not work at the charger yet.
6. The banner at the top of the page says changes are waiting. If it offers **Send to charger**, click it while the charger is connected and confirm. Otherwise click **Check offline charging**. On **Station settings › Offline charging**, click **Check the charger** and fix anything that is not ready. Then click **Send to charger**. Sending stays disabled until every check passes.
7. Check that the banner says **All cards are on the charger** and that the card shows **On the charger**. **Station settings › Offline charging** shows the version the charger accepted under **Card list version on charger**. A card still waiting, or a list the charger refused, does not work at the charger.
8. Test the actual card. Then ask your administrator for a fresh encrypted recovery bundle; see [Back up and recover](recovery.md).

While the checks have not passed, **Station settings › Offline charging** shows **Turn on offline charging**. Use it only when the failed checks are the charger's offline settings. It asks the charger to keep a local card list, accept those cards without internet, and refuse unknown cards without internet. Type the displayed phrase to use it. It changes nothing else, never sends cards and never restarts the charger. If a setting is missing or read-only, it stops without changing anything; use the supported manufacturer procedure instead.

The console shows a card by the name you gave it, or by a short anonymous reference such as **Card 3f9a1c**. The tamper-evident record and every download use only an anonymous reference, never the card number or its name. Confirm which card is which before removing one.

## Remove a card

1. Open **RFID cards** for the correct charger and click **Remove** next to the card.
2. Read the warning. Tick the box confirming you understand that the card may keep working at the charger until the charger accepts the new card list. Then click **Remove card**.
3. Send the new card list to the charger as in step 6 above.
4. Check that the charger accepted the new list, and ask for a new recovery bundle.

The removed card's name is deleted at the same time. An offline charger can still accept its previously stored copy of a removed card until the updated list reaches it. Removing a card from chargeOS is not an immediate offline revocation. For a lost card, tell the owner or installer so they can decide how to handle access until reconnection.

Until the charger accepts the new list, the page warns that a removed card may still work at the charger. chargeOS will not remove the last card of a charger, so **Remove** stays disabled. Keep a working card so essential charging remains possible during an internet or cloud outage.

## If a card does not work

Check the charger selection, the actual identifier, the latest check on **Station settings › Offline charging**, and the card list version the charger accepted. If the charger is offline, the new card stays waiting. If the check says a restart is required, follow the supported owner or installer procedure and check again after the charger reconnects. Do not enable charging for unknown cards to work around a failed card.

For explanations of configuration checks, use [AI help](ai-help.md). For technical details, see [Owner-edge operations](../owner-edge-operations.md).
