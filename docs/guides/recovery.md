# Back up and recover

Keep a recovery copy away from the charging server. A backup on the same disk will not help if that disk fails.

## Know the two exports

The console's **redacted support export** helps another person inspect an issue without receiving charger secrets. It is not enough to restore your charger service.

An **encrypted owner continuity bundle** contains the configuration and evidence needed for supported recovery. It needs a separate passphrase, which chargeOS does not store inside the bundle. Keep both privately and in separate locations. Never send this bundle or its passphrase as a support attachment.

## Make a useful backup

1. Ask your administrator to create the encrypted bundle using the [owner-edge backup procedure](../owner-edge-operations.md).
2. Make a fresh bundle after initial provisioning and every owner-card authorization change.
3. Keep it off the server and record which charger and date it covers.
4. Have a competent operator inspect and restore a copy to a separate empty location. A file that has never been restored is an untested backup.
5. Retain any older full bundles referenced by a compacted recovery bundle. The newer file cannot recreate omitted history by itself.

Your AI provider key is not in the bundle and is not needed to restore charging software. Your cloud login is not a substitute for owner-held recovery material.

## Move to a replacement server

Use the documented create-only restore procedure. It refuses to overwrite an existing ledger. The replacement needs fresh DNS and certificate settings, and its proxy arrangement must be rechecked. Do not point two independently running edges at the same charger during the move.

The current encrypted recovery format is single-station. Use one station per recoverable edge when you depend on this guarantee. Commercial account/reimbursement disaster recovery and a complete multi-station bundle remain separate unfinished work.

Charging during a server outage still depends on the card list already stored in the charger and its tested offline behavior. A recovery file, software test or AI answer does not prove that physical behavior; see [Connect a charging station](connect-a-charger.md).
