# Deploy chargeOS

Deployment starts the server software. It does not change your charging station's settings, move an existing provider connection, or start a payment.

## Docker on your own server

1. Open setup as described in [Install the software](install.md).
2. Choose **Docker on this computer or server**. Docker starts on the computer running setup, using its active Docker context. Confirm that this is the intended server.
3. Name the installation. Use a new name only for a separate installation; an existing setup is never overwritten.
4. Enter the charger's exact OCPP identity and the actual RFID identifier of one owner card. Your installer can find these. A serial number or the number printed on a card may be different.
5. Enter the two hostnames and the email address for certificate notices.
6. Leave the image field blank to build this source version, or paste a verified image digest supplied by your operator.
7. Confirm the destination and click **Deploy chargeOS**. Keep the terminal open while Docker builds and starts the containers.

You can instead click **Prepare files only**. This creates the private deployment folder without starting a container or contacting a cloud account.

## Find your console and credentials

The result shows the console address, charger address and private setup folder. Open `START-HERE.txt` in that folder for restart instructions. Open `credentials.json` privately to find your owner-console token and the charger's separate password. Put them in your password manager. Keep this folder away from shared drives and support messages.

Open your console address after DNS is ready and HTTPS has a valid certificate. Enter the owner-console token. Save the charger address and password for the separate [charger connection procedure](connect-a-charger.md).

## Managed hosting

Choose **Managed server through Coolify Cloud** if your administrator has connected a server to that account. Enter its project, server and environment IDs, a trusted repository and the reviewed commit containing the deployment template. For a private repository, enter its connected Coolify GitHub App ID too. Your operator supplies the published image digest and reviewed template commit. These are a one-time infrastructure setup, not values to guess.

Click **Deploy chargeOS** after reviewing the destination. The wizard creates a Raw Compose application, checks that the platform kept that mode, configures private credentials and submits deployment. Raw Compose preserves the private gateway network; Coolify's ordinary service parser can rewrite it. If a step fails, inspect the saved receipt and the existing cloud application instead of creating another one.

Use the standard Coolify Traefik proxy setup described in [Deployment setup](../deployment-setup.md). Hosting, DNS, an accessible repository and a verified published image are prerequisites; chargeOS does not purchase them for you. The managed adapter has simulated test coverage, but a real hosted deployment still needs its topology, certificates and recovery checked before live use.

## What the status means

**Files ready** means nothing has started. **Containers started** means Docker reported the software running; you still need to check DNS and HTTPS. **Submitted** means a cloud platform accepted a request, not that the software or a physical charger works.

If deployment fails, keep the private folder and read `START-HERE.txt`. Do not repeatedly create new installations for the same charger. An interrupted cloud request might already have created a service; inspect your cloud project before trying again. Stopping the software keeps its data volume. Removing a volume deletes stored state and is not an ordinary restart.
