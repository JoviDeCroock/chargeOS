# Deploy chargeOS

Deployment starts the server software. It does not change your charging station's settings, move an existing provider connection, or start a payment.

This guide deploys the **owner edge** through the wizard, with separate console and charger hostnames. For the separate employee/company account workspace, choose the local trial in [Install the software](install.md) or the IT-managed synthetic [HTTPS company pilot](company-hosting.md), which uses one company account hostname. The same setup tool has a separate company form for local Docker or an isolated Coolify pilot; follow that company guide for its prerequisites.

## Docker on your own server

1. Open setup as described in [Install the software](install.md).
2. Choose **Docker on this computer or server**. Docker must run locally on the computer running setup. Remote SSH/TCP Docker contexts are refused. Confirm that this is the intended computer; setup checks shared file visibility before starting.
3. Name the installation. Use a new name only for a separate installation; an existing setup is never overwritten.
4. Enter the charger's exact OCPP identity (its name on the back-office connection) and the actual RFID identifier of one owner card. Your installer can find these. A serial number or the number printed on a card may be different. The setup form accepts identities made of letters, numbers, hyphens and underscores, up to 64 characters.
5. Enter the two hostnames and the email address for certificate notices.
6. Leave the image field blank to build this source version, or paste a verified image digest supplied by your operator.
7. Tick the box confirming that you control this server and these addresses, then click **Deploy chargeOS**. Keep the terminal open while Docker builds and starts the containers.
8. When you have finished, press Ctrl+C in the terminal to stop the setup tool. This does not stop chargeOS.

Each start first runs a short `caddy-volumes` step, which lets the HTTPS proxy run without administrator rights. It then exits; seeing it as "exited" is normal. If the proxy does not start after an update, look at that step's log with `docker compose logs caddy-volumes`. Your certificates are kept.

You can instead click **Prepare files only**. This creates the private deployment folder without starting a container or contacting a cloud account.

## Find your console and credentials

The result shows the **Console** address, the **Charger endpoint** and the **Private setup folder**. The folder is `.chargeos-deploy/<installation name>` inside your chargeOS folder. Open `START-HERE.txt` there for restart instructions. Open `credentials.json` privately: `ownerToken` is your owner-console token and `stationSecret` is the charger's separate password. Put both in your password manager. Keep this folder away from shared drives and support messages.

Open your console address after DNS is ready and HTTPS has a valid certificate, then sign in with the owner-console token; see [Use the owner console](owner-console.md). Save the charger endpoint, OCPP identity and password for the separate [charger connection procedure](connect-a-charger.md).

The setup wizard creates one charger per installation. Several chargers on one installation need an administrator-managed stations file; see [Use the owner console](owner-console.md).

## Managed hosting

Choose **Managed server through Coolify Cloud** if your administrator has connected a server to that account. Enter a Coolify API token that can create and deploy services, the project, server and environment IDs (and a destination ID if the server has several), a trusted repository and the reviewed commit containing the deployment template. The token stays in memory and is not saved. For a private repository, enter its connected Coolify GitHub App ID too. Your operator supplies the published image digest and reviewed template commit. These are a one-time infrastructure setup, not values to guess.

Click **Deploy chargeOS** after reviewing the destination. The wizard creates a Raw Compose application, checks that the platform kept that mode, configures private credentials and submits deployment. Raw Compose preserves the private gateway network; Coolify's ordinary service parser can rewrite it. If a step fails, inspect the saved receipt and the existing cloud application instead of creating another one.

Use the standard Coolify Traefik proxy setup described in [Deployment setup](../deployment-setup.md). Hosting, DNS, an accessible repository and a verified published image are prerequisites; chargeOS does not purchase them for you. The managed adapter has simulated test coverage, but a real hosted deployment still needs its topology, certificates and recovery checked before live use.

## What the status means

**Your setup files are ready** means nothing has started. **Your containers have started** means Docker reported the software running; you still need to check DNS and HTTPS. **Submitted to Coolify** means the cloud platform accepted a request, not that the software or a physical charger works.

If deployment fails, keep the private folder and read `START-HERE.txt`. Do not repeatedly create new installations for the same charger. An interrupted cloud request might already have created a service; inspect your cloud project before trying again. Stopping the software keeps its data volume. Removing a volume deletes stored state and is not an ordinary restart.
