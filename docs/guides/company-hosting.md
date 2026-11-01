# Share the company workspace

Your company can host chargeOS accounts at its own secure web address. Employees use a browser to join the company and review reimbursement records. Your IT administrator runs the account server, its secure web entrance and its email sender.

This is a **guided Docker pilot** for synthetic evaluation. The setup tool has separate owner and company-account forms. Company accounts can now be prepared and started with one Deploy action on local Docker. Managed-cloud company deployment and a complete public recovery/resumption drill remain pending. Use synthetic accounts while evaluating this profile. The account workspace does not connect or take ownership of a charging station.

## Before IT starts

Choose a dedicated address, such as accounts.your-company.be, and the work email domains employees may use. Arrange a mail provider with SMTP access and an approved sender address. IT needs a Docker server, control of the web address, and access to ports 80 and 443. This profile needs its own public entrance; placing another web proxy or CDN in front requires a separate, reviewed configuration.

Give these details to IT through your company's private channel. The mail password is secret and is separate from your AI key, charger password and chargeOS account password.

## Start company accounts

1. On the computer or server that will host the workspace, open a terminal in the chargeOS folder and run `node scripts/deploy.mjs`. Node.js and local Docker with Compose must already be installed. Docker Desktop on macOS and a local Linux Docker engine are supported; remote SSH/TCP Docker contexts are refused.
2. Open the full private setup link printed by the terminal, then choose **set up company accounts instead**. Keep the terminal open.
3. Name the installation. Enter its one accounts hostname, approved work email domains and certificate contact email. Existing installations are never overwritten.
4. Enter the SMTP server, port, encryption mode, username, password and allowed sender supplied by your provider. STARTTLS and TLS from the start are supported; certificate checks stay on.
5. Confirm that you control the server, hostname and mail provider. Choose **Deploy company accounts**. Setup checks that Docker can read a fresh local file, creates private settings and starts the account server, secure entrance and email worker. Keep the tab open while it builds. **Prepare files only** saves the package without starting containers or sending mail.
6. Save the workspace address and private setup folder shown in the result. Open START-HERE.txt there for status, resume and stop commands. Those commands pin this installation's Docker project so other installations stay separate.
7. Check DNS, HTTPS and actual email delivery with a synthetic account. A container start does not prove inbox delivery or production readiness. Press Ctrl-C in the setup terminal when finished; this closes setup without stopping the deployed workspace.

The generated auth key and SMTP settings stay in the private secrets folder; they are not shown in the result. Do not copy that folder to a shared drive or send it to support. Advanced file preparation and the exact boundary are in the [company hosting instructions](../company-hosting.md).

## Join and invite people

1. Open the secure address supplied by your administrator. Check that it belongs to your company.
2. Choose **Create account** and use your approved work email address.
3. Open your verification email, then sign in. Allow a minute before requesting another link.
4. Create your organization if you are the designated company administrator. Invite colleagues using their exact work email address and the appropriate finance or driver role. Follow [Add people](people.md) and [Employee reimbursements](reimbursements.md).

An approved email domain allows account creation. It does not give automatic membership in an existing organization. An invitation must still be accepted by the matching verified account. Finance approval still requires the required authenticator checks.

## If setup or email fails

Ask IT to check the web address, certificate, Docker service health and mail provider. Check junk mail and your exact email address. A busy message means the account or email limits have been reached; wait a minute and try again. Receiving an invitation does not provide charger control.

IT should keep the private account data and deployment secrets off shared drives and out of support messages. Backups restore into a closed local review process. They do not automatically reopen the public workspace or resume emails. Do not start another public account server with a copied database to work around a failed recovery.
