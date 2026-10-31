# Install the software

chargeOS runs on a computer or server that stays on. Your charging station connects to that server. You do not install chargeOS inside the charger or replace its firmware.

## Before you start

For a company deployment, ask the person responsible for your server to help with the first setup. You will need a supported computer or server, Docker with Compose, and Node.js 22 or newer. For a managed server, you will also need your hosting account and a connected server. Hosting and optional AI usage are paid directly to those providers.

For an internet-facing installation, choose two addresses such as `charge.company.be` for people and `ocpp.company.be` for charging stations. Your administrator must point both addresses to the correct server. The server needs reachable HTTPS; the Docker setup uses ports 80 and 443 to obtain certificates.

## Open setup

1. Download or clone the chargeOS repository onto the computer that will run setup. Keep the folder in a private location.
2. Open a terminal in that folder. Your administrator can do this once for you.
3. Run `node scripts/deploy.mjs`.
4. Your browser opens a private setup page. If it does not, open the full local address printed in the terminal. Keep that address private and keep the terminal open.
5. Follow [Deploy chargeOS](deploy.md). Use **Prepare files only** if you want your administrator to review the setup before starting anything.

The setup tool uses Node's built-in features, so it does not need a separate package installation. Docker builds the application when you choose a local source build.

## Try the employer workspace locally

The current employer workspace is a separate local development service. It is not started by the owner-edge deployment wizard.

Ask your administrator to follow [Local commercial service](../commercial-service.md). Once it is running, open `/service` on the local web app. Verification and invitation links are collected locally; the software does not send email yet. Use synthetic test accounts while evaluating it.

## If setup does not open

If your terminal says Node was not found, install Node.js or ask your administrator to do so. If it says Docker could not start, install and start Docker with Compose. If the browser says the setup tab is not authorized, use the full fresh link printed by the running setup tool. Refreshing a link after its private authorization fragment has been removed requires opening that original link again.
