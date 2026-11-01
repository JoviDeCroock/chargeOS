# Back up and recover

Keep a recovery copy away from the charging server. A backup on the same disk will not help if that disk fails.

## Know the two exports

The console's **Export redacted continuity evidence** button downloads a redacted support file. Its name ends in `-continuity.json`, but it is not a recovery bundle. It helps another person inspect an issue without receiving charger secrets or card identifiers. It is not enough to restore your charger service.

An **encrypted owner continuity bundle** contains the configuration and evidence needed for supported recovery. It needs a separate passphrase, which chargeOS does not store inside the bundle. Keep both privately and in separate locations. Never send this bundle or its passphrase as a support attachment.

## Make a useful backup

1. Ask your administrator to create the encrypted bundle using the [owner-edge backup procedure](../owner-edge-operations.md). The owner console cannot create it; it is a command-line step.
2. Make a fresh bundle after initial provisioning and every owner-card authorization change.
3. Keep it off the server and record which charger and date it covers.
4. Have a competent operator inspect and restore a copy to a separate empty location. A file that has never been restored is an untested backup.
5. Retain any older full bundles referenced by a compacted recovery bundle. The newer file cannot recreate omitted history by itself.

For a Docker installation made by the setup wizard, your administrator runs the documented in-container export from the private setup folder, using `-f compose.json` in place of the production file options. This wizard variant has not been separately drilled, so inspect the bundle and test a restore. A documented backup procedure for the managed Coolify path does not exist yet; do not rely on that deployment for owner recovery until one is written and tested.

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

Reopening needs the separate review, fresh sign-in setup and administrator reopening steps below, which are currently a local development trial. Do not remove the quarantine marker or assume the backup date proves today's balance. This is not yet a proven production disaster-recovery procedure. It sends no payment and changes no charger card list.

## Check current access and money records

Your administrator can now prepare a [recovery review](../commercial-service.md#prepare-a-current-recovery-review) for a quarantined copy. It lists every employer and member so old access cannot silently return.

Before a failure, keep a financial checkpoint made after the matching encrypted backup. Keep separately held membership and financial records current too. A checkpoint only records fingerprints; it cannot restore missing records.

After restoring, your administrator checks current identity and employer access, decides who stays or leaves, checks each departing person's eligibility dates, compares the financial checkpoint and records that the previous employer service is stopped and cannot restart. If any financial record differs or is missing, the review stops. The tool does not invent a balance or ignore the difference.

The resulting report is private and says **reviewed, not enrolled**. It does not reopen the service. People can now complete the fresh credential setup below; the separate administrator reopening step below is now available for the local trial. A review hash records which documents were checked; it cannot verify that those documents are true. Charging-station access remains separate throughout.

## Set up your fresh recovery sign-in

The current enrollment page is a local development trial for synthetic users. It does not send email or reopen company access. Your administrator starts the [enrollment service](../commercial-service.md#fresh-recovery-credential-enrollment) on the restored computer and gives each reviewed person their own private setup link. A localhost link opens that computer's local service; it is not a public employee portal.

1. Open your own private link. The page removes its secret from the address bar. Keep the original link privately until you finish.
2. Choose a new password, enter it twice and continue. Old passwords will not work. The link can be used once.
3. In your authenticator app, add an account using the setup key shown on the page. Name the account chargeOS.
4. Save the new recovery codes in your password manager or another private place. Do not send the key or codes in a support message or screenshot.
5. Enter the current six-digit authenticator code. The page clears the setup material when verification succeeds.
6. When it says **Credential setup complete**, tell your administrator you are ready, then sign out to clear the page. Company access remains paused until the administrator completes reopening.

If you return after using the link, choose **I already chose a new password**, then sign in with that new password and authenticator. If a code fails, try the current code; wait a minute if there have been too many attempts. If you lost the link, password or unsaved setup key, ask your administrator for a replacement. They must stop enrollment and reissue your setup; the other people's completed setup can remain intact. Replacing the entire reviewed roster requires everyone to start again.

Do not save private setup links, passwords or codes in shared notes. A completed setup gives no charger, employer or payment authority. Your administrator completes the reopening step below.

## Reopen company access after the local recovery trial

Your administrator checks that everyone kept in the review has finished setup. They stop the recovery setup service, wait for it to finish, and use the [reviewed reopening command](../commercial-service.md#reopen-a-reviewed-local-recovery). An expired review, missing financial record or unfinished authenticator stops reopening; your administrator must resolve it before trying again.

After the administrator confirms reopening, open the ordinary **Company accounts** page at `/service`. Sign in with your new password and authenticator. Your recovery setup session does not carry over. People removed in the review cannot access that company, and new eligibility dates apply. Charger ownership and an already accepted owner card stay separate.

If the administrator lost the command's result during an interruption, they can retry the same command. It recognizes a completed reopening without repeating the changes. Keep the old backup and matching software. A later restore always starts a new review and fresh sign-in setup, even if its backup came from a working, reopened service. This remains a local development trial; public delivery and production recovery have not been proved.

Local reopening works only at the exact local address used during the review. It does not authorize putting the recovered database online. Do not copy it into a public deployment or change its address/key to work around a refused start. A separately verified public cutover is still required.
