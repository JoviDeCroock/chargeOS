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

The current owner-edge encrypted recovery format is single-station. Use one station per recoverable edge when you depend on this guarantee. A complete multi-station bundle remains separate unfinished work.

Charging during a server outage still depends on the card list already stored in the charger and its tested offline behavior. A recovery file, software test or AI answer does not prove that physical behavior; see [Connect a charging station](connect-a-charger.md).

## Back up employer accounts and reimbursements

The local employer workspace has a separate backup. The charger recovery bundle above does not contain its accounts or reimbursement records.

Ask your administrator to use the [native commercial backup commands](../commercial-service.md#encrypted-native-backup-and-quarantined-restore). They need a private backup folder and a separate passphrase file. Keep the encrypted file and passphrase in different places, away from the server. Keep the matching chargeOS software revision too. The current procedure covers the native Node/SQLite service, up to 64 MiB; it does not import the alternative Cloudflare/Wrangler database.

1. Your administrator creates the encrypted backup and runs **inspect** to check it.
2. They test **restore** into a new private folder. It refuses an existing folder.
3. They keep the original backup and separately held membership, session and financial records needed to check what changed afterward.

A restored copy is **quarantined**: chargeOS refuses to start it as a working employer service. Old passwords, login sessions, email links, invitations and authenticator credentials cannot be used. This prevents an old backup from silently restoring access that somebody later revoked. People will need fresh identity checks and credentials before access can resume.

The process to reconcile current access and financial records and reopen the restored service is still being built. Do not remove the quarantine marker or assume the backup date proves today's balance. Use this procedure to preserve and test recovery of local records; it is not yet a complete employer-service disaster-recovery procedure. It sends no payment and changes no charger card list.

## Check current access and money records

Your administrator can now prepare a [recovery review](../commercial-service.md#prepare-a-current-recovery-review) for a quarantined copy. It lists every employer and member so old access cannot silently return.

Before a failure, keep a financial checkpoint made after the matching encrypted backup. Keep separately held membership and financial records current too. A checkpoint only records fingerprints; it cannot restore missing records.

After restoring, your administrator checks current identity and employer access, decides who stays or leaves, checks each departing person's eligibility dates, compares the financial checkpoint and records that the previous employer service is stopped and cannot restart. If any financial record differs or is missing, the review stops. The tool does not invent a balance or ignore the difference.

The resulting report is private and says **reviewed, not enrolled**. It does not reopen the service. People still need fresh credentials and authenticator setup, and the final reopening process is still being built. A review hash records which documents were checked; it cannot verify that those documents are true. Charging-station access remains separate throughout.
