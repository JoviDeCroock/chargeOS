# Share the company workspace

Your company can host chargeOS accounts at its own secure web address. Employees use a browser to join the company and review reimbursement records. Your IT administrator runs the account server, its secure web entrance and its email sender.

This is a **guided pilot** for synthetic evaluation. The setup tool has separate owner and company-account forms. Company accounts can be prepared with one Deploy action on local Docker or through Coolify. A separate [reviewed public recovery](recovery.md#bring-the-reviewed-recovery-back-to-https) has synthetic owned-Docker proof. Real managed-platform acceptance and managed recovery remain pending. Use synthetic accounts while evaluating this profile. The account workspace does not connect or take ownership of a charging station.

## Before IT starts

Choose a dedicated address, such as accounts.your-company.be, and the work email domains employees may use. Arrange a mail provider with SMTP access and an approved sender address. For owned hosting, IT needs a local Docker server and available ports 80/443. For managed hosting, IT needs an existing Coolify account and connected server. Both need control of the web address. Ask IT to prepare the secure entrance; extra proxies or CDNs are unsupported in these profiles.

Give these details to IT through your company's private channel. The mail password is secret and is separate from your AI key, charger password and chargeOS account password.

## Start on your Docker server

1. On the computer or server that will host the workspace, open a terminal in the chargeOS folder and run `node scripts/deploy.mjs`. Node.js and local Docker with Compose must already be installed. Docker Desktop on macOS and a local Linux Docker engine are supported; remote SSH/TCP Docker contexts are refused.
2. Open the full private setup link printed by the terminal, then choose **set up company accounts instead**. Keep the terminal open.
3. Leave Hosting set to **Docker on this computer or server**. Name the installation. Enter its one accounts hostname, approved work email domains and certificate contact email. Existing installations are never overwritten.
4. Enter the SMTP server, port, encryption mode, username, password and allowed sender supplied by your provider. STARTTLS and TLS from the start are supported; certificate checks stay on.
5. Confirm that you control the server, hostname and mail provider. Choose **Deploy company accounts**. Setup checks that Docker can read a fresh local file, creates private settings and starts the account server, secure entrance and email worker. Keep the tab open while it builds. **Prepare files only** saves the package without starting containers or sending mail.
6. Save the workspace address and private setup folder shown in the result. Open START-HERE.txt there for status, resume and stop commands. Those commands pin this installation's Docker project so other installations stay separate.
7. Check DNS, HTTPS and actual email delivery with a synthetic account. A container start does not prove inbox delivery or production readiness. Press Ctrl-C in the setup terminal when finished; this closes setup without stopping the deployed workspace.

The generated auth key and SMTP settings stay in the private secrets folder; they are not shown in the result. Do not copy that folder to a shared drive or send it to support. Advanced file preparation and the exact boundary are in the [company hosting instructions](../company-hosting.md).

## Start through Coolify

Ask your Coolify operator to supply the project ID, connected server ID, environment name, verified company runtime and proxy image references, and matching repository revision. The image references identify the exact software; your operator builds and publishes them first. The operator instructions are linked above. This does not buy a server or arrange DNS for you.

1. On your computer, run `node scripts/deploy.mjs` in the chargeOS folder. Node.js is required; local Docker is not needed for this route. Open the full private terminal link and choose company accounts.
2. Choose **Managed through Coolify**. Enter the hostname, approved work email domains and contact email.
3. Enter the operator's settings. Use only your trusted Coolify HTTPS address. The API token lets setup create the destination and application; it is cleared from the form and is not saved locally. A private repository also needs the operator's connected GitHub App ID.
4. Ask the operator to confirm Traefik, disabled account URL/request/error logs and traffic analytics, no extra proxy or CDN, and an exclusive fresh destination reserved for this company entrance and the platform proxy. Do not use the checkbox to skip that check.
5. Enter the SMTP settings and confirm authorization. Choose **Deploy company accounts** once. Setup creates a fresh separate destination and submits the pinned application. **Prepare files only** saves private settings without contacting Coolify or deploying. These are review files, not a resumable installation. After a confirmed prepared result with no cloud-intent.json, retain the files, reopen the full terminal setup link and submit the reviewed settings under a new name. This exception never applies after a cloud submission or an uncertain result.
6. Save the result and read START-HERE.txt. **Submitted** means Coolify accepted the request. It does not mean HTTPS, mail or the application is ready. Have the operator check the existing application, network, logs, certificate, test account and restart before evaluation. Keep the same application and its volumes for later starts/stops.

The mail password and generated service key also remain in trusted Coolify configuration and initializer container metadata. They are not erased from the platform when the form clears. Never put an AI key or charger credential into these fields. Sign-in and signup limits are shared through the platform entrance; this route supports a small test pilot. If you hit a limit, wait a minute rather than changing the security configuration.

## Join and invite people

1. Open the secure address supplied by your administrator. Check that it belongs to your company.
2. Choose **Create account** and use your approved work email address.
3. Open your verification email, then sign in. Allow a minute before requesting another link.
4. Create your organization if you are the designated company administrator. Invite colleagues using their exact work email address and the appropriate finance or driver role. Follow [Add people](people.md) and [Employee reimbursements](reimbursements.md).

An approved email domain allows account creation. It does not give automatic membership in an existing organization. An invitation must still be accepted by the matching verified account. Finance approval still requires the required authenticator checks.

## If setup or email fails

For Coolify, do not click Deploy again or choose a new installation name after an uncertain result. Ask the operator to inspect the existing destination/application and private cloud receipts first. Do not change a bootstrap key or mail password to repair a running installation: the initializer deliberately refuses mismatches. Retain the volumes and ask the operator to plan any credential rotation separately.

Ask IT to check the web address, certificate, Docker service health and mail provider. Check junk mail and your exact email address. A busy message means the account or email limits have been reached; wait a minute and try again. Receiving an invitation does not provide charger control.

IT should keep the private account data and deployment secrets off shared drives and out of support messages. Backups restore into a closed local review process. They do not automatically reopen the public workspace or resume emails. Do not start another public account server with a copied database to work around a failed recovery.
