# Share the company workspace

Your company can host chargeOS accounts at its own secure web address. Employees use a browser to join the company and review reimbursement records. Your IT administrator runs the account server, its secure web entrance and its email sender.

This is an **operator-managed Docker pilot**. The guided one-click deployment currently installs the owner console. Company-account setup still needs IT; the managed-cloud company adapter and a complete public recovery/resumption drill are pending. Use synthetic accounts while evaluating this profile. The account workspace does not connect or take ownership of a charging station.

## Before IT starts

Choose a dedicated address, such as accounts.your-company.be, and the work email domains employees may use. Arrange a mail provider with SMTP access and an approved sender address. IT needs a Docker server, control of the web address, and access to ports 80 and 443. This profile needs its own public entrance; placing another web proxy or CDN in front requires a separate, reviewed configuration.

Give these details to IT through your company's private channel. The mail password is secret and is separate from your AI key, charger password and chargeOS account password. The [company hosting instructions](../company-hosting.md) explain the files and deployment checks.

## Join and invite people

1. Open the secure address supplied by your administrator. Check that it belongs to your company.
2. Choose **Create account** and use your approved work email address.
3. Open your verification email, then sign in. Allow a minute before requesting another link.
4. Create your organization if you are the designated company administrator. Invite colleagues using their exact work email address and the appropriate finance or driver role. Follow [Add people](people.md) and [Employee reimbursements](reimbursements.md).

An approved email domain allows account creation. It does not give automatic membership in an existing organization. An invitation must still be accepted by the matching verified account. Finance approval still requires the required authenticator checks.

## If setup or email fails

Ask IT to check the web address, certificate, Docker service health and mail provider. Check junk mail and your exact email address. A busy message means the account or email limits have been reached; wait a minute and try again. Receiving an invitation does not provide charger control.

IT should keep the private account data and deployment secrets off shared drives and out of support messages. Backups restore into a closed local review process. They do not automatically reopen the public workspace or resume emails. Do not start another public account server with a copied database to work around a failed recovery.
