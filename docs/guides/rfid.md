# Add or remove an RFID card

An RFID card is the physical card or tag you hold against the charger. chargeOS needs the identifier that the charger actually reads. It may differ from the number printed on the card; ask your installer if you are unsure.

## Add a card

1. Open the owner console and choose the correct charger.
2. Find the owner authorization controls and enter the card's actual OCPP identifier. Treat it as private information.
3. Click **Add desired tag**. This saves your intention; it does not yet update the charger.
4. Click **Inspect offline capabilities**. Resolve any missing or failed offline-authorization checks before synchronizing.
5. Click **Synchronize owner tags** while the charger is connected.
6. Check for the exact **Accepted** result and the acknowledged list revision. A pending or rejected result does not make the card usable at the charger.
7. Test the actual card and create a fresh encrypted recovery bundle after the authorization change.

The console uses a private pseudonym when showing a card. It does not display the original identifier in operational evidence. Confirm which pseudonym belongs to a physical card before removing it.

## Remove a card

1. Choose the card's displayed pseudonym in the correct charger's owner list.
2. Read and enter the requested confirmation about possible stale access.
3. Click **Revoke desired tag**, then inspect and synchronize the full list.
4. Check that the charger accepted the new revision, and keep a new recovery bundle.

An offline charger can still accept its previously stored copy of a removed card until the updated list reaches it. Removing a card from chargeOS is not an immediate offline revocation. For a lost card, tell the owner or installer so they can decide how to handle access until reconnection.

chargeOS will not remove the final desired owner credential. Keep a working owner card so essential charging remains possible during an internet or cloud outage.

## If a card does not work

Check the charger selection, the actual identifier, the latest inspection and the acknowledged revision. If the charger is offline, the new card remains pending. If inspection says a restart is required, follow the supported owner/installer procedure and inspect again after the charger reconnects. Do not enable unknown-card charging to work around a failed card.

For explanations of configuration checks, use [AI help](ai-help.md). For technical details, see [Owner-edge operations](../owner-edge-operations.md).
