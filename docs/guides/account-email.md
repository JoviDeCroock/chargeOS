# Send account emails

chargeOS can send verification, password-recovery and company-invitation links through a mail provider you choose. Your administrator supplies that provider's SMTP settings. SMTP is the connection used to send email; it is separate from your AI key and charging-station credentials.

This feature currently serves the **local employer-workspace trial**. Its localhost links must be opened on the computer running that trial. Enabling email does not deploy a public company portal. Use test accounts and a mail service you control while evaluating it.

## Ask your administrator to set up delivery

1. Ask your mail provider or IT team for its SMTP server name, port, username, password and allowed sender address. Ask whether it requires **STARTTLS**, usually on port 587, or **TLS from the start**, usually on port 465.
2. Have your administrator create a private settings file using `pnpm service:native:mail template --output /private/settings/smtp.json`, then fill in the provider's details. The folder must already exist and be private. The file is secret; do not attach it to a support case.
3. Your administrator adds `SERVICE_DELIVERY=smtp` to the local account-service configuration, then restarts that account service and reloads the account page. This affects newly requested links. Old links in the operator outbox are not emailed automatically.
4. Your administrator starts `pnpm service:native:mail run --smtp-config /private/settings/smtp.json` in another terminal. Keep it running to deliver new requests. The [operator instructions](../commercial-service.md#native-smtp-account-delivery) describe private file permissions and optional company certificates.
5. Create a fresh test account. The page should now tell you to check your inbox. Open only your own verification link, then sign in.

The sender never falls back to an unencrypted connection or ignores a bad certificate. If your company uses its own certificate authority, IT can supply its public certificate in a separate private file. Do not turn certificate checking off.

## Use your links

For a new account, open the verification email and then sign in. For a forgotten password, choose **Forgot password?**, request a recovery link and use the newest email. After the password changes, previous sessions are signed out. For an invitation, sign in with the exact invited, verified email address and accept it before it expires.

Verification and password-recovery links last one hour; invitations last 72 hours. Do not forward links, put them in shared notes or send screenshots of them. A delivered invitation still needs acceptance and never grants physical ownership of a charger.

## If an email does not arrive

Check junk mail and the intended address, then ask your administrator to check the sender, provider credentials, certificates and whether the delivery worker is running. The worker's **accepted** count means the mail server accepted a message; it does not confirm delivery to your inbox. Temporary failures retry for a limited time. A permanent failure or an expired link needs a new request after the problem is fixed.

A connection can fail after the provider already accepted a message. You might receive a duplicate; a duplicate is not a second invitation or extra permission. Each link still goes through the account checks; receiving a duplicate does not grant extra access.

## Stop or recover delivery

Press Ctrl-C in the mail-worker terminal and wait for it to finish. It completes or times out its current message before stopping. Stop it before other recovery operations. If a process was killed and left recovery custody behind, your administrator must verify that the process and its requests have stopped before assessing that lock; do not force an unlock while work might still be running.

Restoring a backup clears pending emails and starts with email delivery off. Quarantined accounts cannot send mail. Complete the current review, fresh sign-in setup and reviewed reopening first, then configure delivery again. Keep mail-provider credentials separately; they are not in the account backup.
