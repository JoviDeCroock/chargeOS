# Add or remove an RFID card

An RFID card is the physical card or key fob you hold against the charger. chargeOS needs the identifier that the charger actually reads. That is often not the number printed on the card, so the easiest way to add a card is to tap it at the charger.

## Add a card by tapping it

The charger must be connected; the bar at the top of the console says **Charger connected**.

1. Open the owner console and check the charger name at the top of the page. With several chargers, choose the correct one in the **Charger** menu in the sidebar.
2. Open **RFID cards** and click **Add card**, or **Tap a card at the charger** when the charger has no card yet. Then click **Tap a card at the charger** in the window that opens.
3. Within two minutes, hold one card against the charger's card reader. The charger refuses this tap, as it refuses every card it does not know yet. That is expected.
4. The window says **Card found** with a short reference. If it says that more than one different card was tapped, nothing was added: click **Listen again** and tap only your card. If it says the card is already one of this charger's cards, nothing changed.
5. Optionally give the card a **Card name** and choose **Who uses it**, then click **Add this card** within five minutes. After that, chargeOS forgets the tapped card and you tap it again.
6. Continue with step 6 under **Type a card number** below to send the card list to the charger.

chargeOS listens only for the charger you chose and only while the window says it is listening. It keeps the tapped card's value in memory until you add it or it expires, and never shows or records it. A tap is still refused at the charger; adding the card is a separate step you confirm.

## Type a card number

1. Open **RFID cards** for the correct charger, click **Add card**, then **Type the card number instead**.
2. Type the card's actual identifier into **Card number**. It can be up to 20 characters. Treat it as private information. The field hides what you type, and the console never shows the number again.
3. Optionally give the card a **Card name**, such as "Blue key fob", and choose **Who uses it**. Choose **Someone new…** to add a person at the same time. Names are labels in the console only; see [Name chargers, people and cards](owner-console.md#name-chargers-people-and-cards).
4. Click **Add card**. The card is now on the list as **Waiting to be sent**. It does not work at the charger yet.
5. The banner at the top of the page says changes are waiting. If it offers **Send to charger**, click it while the charger is connected and confirm. Otherwise click **Check offline charging**. On **Station settings › Offline charging**, click **Check the charger** and fix anything that is not ready. Then click **Send to charger**. Sending stays disabled until every check passes.
6. Check that the banner says **All cards are on the charger** and that the card shows **On the charger**. **Station settings › Offline charging** shows the version the charger accepted under **Card list version on charger**. A card still waiting, or a list the charger refused, does not work at the charger.
7. Test the actual card. Then ask your administrator for a fresh encrypted recovery bundle; see [Back up and recover](recovery.md).

## Before the first card

A setup can start without any card. Until you add one, chargeOS refuses every card, the **Overview** and **RFID cards** pages ask you to add your first card, the offline check reports that no owner card is set up, nothing is sent to the charger, and no recovery bundle can be made. Add your own card first, by tapping it.

While the checks have not passed, **Station settings › Offline charging** shows **Turn on offline charging**. Use it only when the failed checks are the charger's offline settings. It asks the charger to keep a local card list, accept those cards without internet, and refuse unknown cards without internet. Type the displayed phrase to use it. It changes nothing else, never sends cards and never restarts the charger. If a setting is missing or read-only, it stops without changing anything; use the supported manufacturer procedure instead.

The console shows a card by the name you gave it, or by a short anonymous reference such as **Card 3f9a1c**. The tamper-evident record and every download use only an anonymous reference, never the card number or its name. Confirm which card is which before removing one.

## Remove a card

1. Open **RFID cards** for the correct charger and click **Remove** next to the card.
2. Read the warning. Tick the box confirming you understand that the card may keep working at the charger until the charger accepts the new card list. Then click **Remove card**.
3. Send the new card list to the charger as in step 6 of **Type a card number** above.
4. Check that the charger accepted the new list, and ask for a new recovery bundle.

The removed card's name is deleted at the same time. An offline charger can still accept its previously stored copy of a removed card until the updated list reaches it. Removing a card from chargeOS is not an immediate offline revocation. For a lost card, tell the owner or installer so they can decide how to handle access until reconnection.

Until the charger accepts the new list, the page warns that a removed card may still work at the charger. chargeOS will not remove the last card of a charger, so **Remove** stays disabled. Keep a working card so essential charging remains possible during an internet or cloud outage.

## If a card does not work

Check the charger selection, the actual identifier, the latest check on **Station settings › Offline charging**, and the card list version the charger accepted. If the charger is offline, the new card stays waiting. If the check says a restart is required, follow the supported owner or installer procedure and check again after the charger reconnects. Do not enable charging for unknown cards to work around a failed card.

For explanations of configuration checks, use [AI help](ai-help.md). For technical details, see [Owner-edge operations](../owner-edge-operations.md).
