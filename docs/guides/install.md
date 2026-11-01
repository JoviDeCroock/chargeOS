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

For a local trial without Cloudflare or Wrangler, ask your administrator to install the tested Node.js **22.22.x** release and the locked dependencies with `pnpm install --frozen-lockfile`. Then run `pnpm service:setup` once and `pnpm service:native`. In another terminal run `pnpm dev:web`, then open `http://127.0.0.1:5173/service`. Keep those terminals open while evaluating it. The native backend creates its private database and applies migrations automatically. If a different Node release reports missing SQLite features, use the tested release before trying again; chargeOS checks those features before opening the database.

Verification and invitation links are collected locally; no email is sent yet. Your administrator can retrieve one with `pnpm service:native:outbox --recipient person@example.test --kind verify-email`, changing the email to the intended test account. The link is secret: open it privately and do not include it in screenshots or support messages. `invitation` and `reset-password` are the other supported link kinds.

Use synthetic test accounts. The running database stores local account and financial data without encryption. An [encrypted native backup](recovery.md#back-up-employer-accounts-and-reimbursements) can restore a quarantined copy of the records; reopening a restored employer service is not supported yet. Keep the private database and authentication configuration off shared drives. Do not copy a live database as a recovery procedure.

The existing Wrangler/D1 development runtime remains available as an alternative; it stores a different database. Do not run both on port 9091 or expect accounts to transfer automatically. See [Local commercial service](../commercial-service.md) for both options.

## If setup does not open

If your terminal says Node was not found, install Node.js or ask your administrator to do so. If it says Docker could not start, install and start Docker with Compose. If the browser says the setup tab is not authorized, use the full fresh link printed by the running setup tool. Refreshing a link after its private authorization fragment has been removed requires opening that original link again.
