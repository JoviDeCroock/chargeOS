# Connect a charging station

Your charging station runs its manufacturer's software. chargeOS runs on your server. Connecting them means changing the station's back-office connection through a supported manufacturer tool. This is not a firmware installation.

## Check that you can move it

Before changing anything, confirm that you own the charger or have permission from its owner, and that your existing charging-service agreement permits the handover. You need the exact model, hardware revision, firmware version and local administrator access. Ask who owns the SIM and network connection too.

Use [Several chargers and brands](brands.md) to find the evidence for your exact device. A brand name or an OCPP logo alone does not establish compatibility.

## Prepare a way back

1. Keep the current provider connected while you prepare.
2. Export and save the charger configuration and historical transactions. Agree a reimbursement cut-off with your employer so sessions are not lost or paid twice.
3. Keep the current connection settings and a supported rollback procedure outside the charger.
4. Check your chargeOS console and its HTTPS certificate. Keep the charger endpoint (the `wss://` address), the OCPP identity and the unique station password ready. A setup-wizard installation keeps them in `START-HERE.txt` and `credentials.json`.
5. Arrange an explicitly authorized maintenance window with the owner and installer before any standalone-mode changes, network isolation, restart or live connection change. Preparation before that window uses read-only exports and inspection.
6. During that window, with your installer, verify that your owner RFID card can charge locally without the provider. Check that an unknown card is rejected and that the owner card still works after a restart. Restore the current path if the test fails; do not proceed to migration.

## Make the connection

For the first Alfen target, the exact procedure is in the [Alfen migration runbook](../alfen-genesis-runbook.md). Use the supported manufacturer tool and the instructions matching your firmware. Other models require their own documented procedure; do not copy Alfen setting names into another charger.

Before the switch, follow the console's **Genesis plan** and the **Liberate my charger** panel. Record the existing device identity, prerequisite evidence and backups while the current provider remains connected. Have your operator prepare the exact target manifest, then have the owner authorize that target and its maintenance window in chargeOS. The installer switches only while that authorization is active. The [runbook](../alfen-genesis-runbook.md) gives the full sequence.

Many steps ask for a SHA-256 digest. This is a 64-character fingerprint of a file, such as a photo or configuration export. It shows which file you mean without uploading it. On macOS, `shasum -a 256 <file>` prints it; on most Linux systems, `sha256sum <file>` does. Keep the original file privately outside chargeOS. Hash evidence files only; never hash a password, card identifier or recovery passphrase into a checkpoint.

1. In the **Freedom Test** panel, fill in **Exact device identity**: article number, hardware revision, country, the vendor, model and firmware exactly as the charger will report them, connectivity, prior operator, endpoint configuration path and the digest of your inventory evidence. Click **Save exact device identity**. The migration checks use this inventory.
2. In **Liberate my charger**, paste the digest for each owner-recorded checkpoint and click **Confirm checkpoint**, or **Record stop** if something is missing or unsafe. chargeOS fills in the other steps from the device inventory and its own records.
3. When every pre-switch checkpoint passes, select the target manifest file from your operator, choose the transport and the authorization window, and type the displayed phrase.
4. Click **Authorize documented endpoint-change window**. The panel shows when the window expires.

The installer then enters the new back-office address and credentials. chargeOS expects the OCPP identity as the user name and the station password as the password. General guidance: some charger tools only ask for the password and add the identity themselves; follow your exact device's procedure. chargeOS should show a connection and the expected hardware identity. Stop and investigate if the identity differs, configuration cannot be backed up, owner authorization fails, or rollback is uncertain.

Opening the enclosure, touching wiring or changing a SIM is installer work with the power isolated. A web page or AI answer does not authorize that work.

## Check charging after the move

The Freedom Test is the witnessed field test that shows whether owner charging survives an outage on your exact charger. Record it in the console's **Freedom Test** panel.

1. After the switch, check **Observed boot identity**. It must say it matches the authorized pre-switch inventory. A mismatch is a stop condition.
2. Synchronize the owner card, run a real owner-card charge online and present an unknown card. chargeOS marks these automatic steps from its own records.
3. When the automatic steps pass, type the displayed field-run phrase and click **Start bound field run**.
4. Witness each remaining step with your installer: owner charging with internet and back office unavailable, with the chargeOS server powered off and after an isolated charger restart; an unknown card rejected while offline; buffered records arriving once after reconnection; your rollback procedure; and a restored recovery bundle starting a replacement server. For each, paste the evidence digest and click **Record pass** or **Record failure**.

**Evidence complete — review required** means every item has been recorded. It is not a certification, and it does not mean the charger is liberated. If the device or authorization changes, the panel asks you to start a new field run; old results do not carry over. Only physical evidence can establish these outcomes.

Finally, create an encrypted recovery bundle and keep a copy away from the server. See [Back up and recover](recovery.md). A green software check or successful AI answer is not a completed charger migration.

## Troubleshoot the connection

Start in the owner console. The top bar shows **Station connected** or **Station offline**. After the charger's first start-up message (a BootNotification), the **Station** panel shows its hardware and firmware.

chargeOS does not record refused connection attempts in its evidence ledger, so a failed login only looks like **Station offline**. Your administrator can read the proxy log to see the HTTP status code. From a setup-wizard folder, the command is `docker compose -f compose.json logs caddy`. For a manual production deployment, use the same `logs caddy` command with its production file options. Logs contain addresses and charger identities, so keep them private.

### Check the address

- Use the exact **Charger endpoint** from your deployment: `wss://`, the charger hostname, a slash and the OCPP identity. For example, `wss://ocpp.company.be/HOME-1`.
- chargeOS reads the identity from the last part of the address. Do not add a slash after the identity.
- The identity must match exactly, including capital letters.
- Use the charger hostname, not the console hostname. The console address does not accept charger connections.
- Use the hostname, not the server's IP address. The certificate is issued for the hostname.
- General guidance: some chargers ask for a base address and an identity separately and join them. Check that the combined address ends with a slash and the identity.

### Error 401: wrong identity or password

chargeOS answers with HTTP 401 when the identity is unknown, the password is wrong or missing, or the user name is not the identity. It gives the same answer in each case, so the code alone cannot tell you which one is wrong.

Copy the station password again from `credentials.json` (`stationSecret`). chargeOS requires at least 16 characters, and the setup wizard creates a 48-character password. General guidance: some charger tools limit password length or characters. If yours cannot store the full password, do not shorten it. Stop and ask your operator. The same password also protects chargeOS's stored card list, so changing it is not a simple edit, and there is no guided procedure for it yet.

### Error 409: already connected

chargeOS allows one connection per charger identity. A second connection for the same identity gets HTTP 409 while the first is still open or still being set up.

This can happen when a charger reconnects before chargeOS has noticed that its old connection dropped. Wait a few minutes and let the charger retry. If it keeps happening, check that no other device uses the same identity. Never give two chargers the same identity.

### Error 400 or a dropped connection: protocol

chargeOS speaks only OCPP 1.6J: OCPP version 1.6 sent as JSON over a WebSocket. The charger must request the `ocpp1.6` WebSocket subprotocol. If the identity and password are right but the charger does not offer `ocpp1.6`, chargeOS refuses with HTTP 400. This happens, for example, when the charger is set to OCPP 2.0.1 or to OCPP 1.6 over SOAP. Choose OCPP 1.6 JSON in the charger's supported configuration tool.

chargeOS also closes a connection that sends repeated malformed messages, or more messages than its limit (by default 600 per minute, with bursts of up to 60). A rate-limit close appears as `ProtocolRateLimitExceeded` in the ledger. Ask your operator before changing a limit; that needs traffic evidence from your exact charger. By default chargeOS accepts up to 8 charger connections at once, which a larger fleet may need raised.

### Secure connection and certificate

- The setup wizard and production deployment accept charger connections only as encrypted connections on port 443. Use `wss://`, not `ws://`.
- Plain `ws://` is only for the local lab setup or an isolated private-network migration your operator has planned.
- The Docker setup gets a public certificate for the charger hostname automatically. This needs DNS pointing at the server and ports 80 and 443 reachable from the internet. On the managed path, Coolify provides the certificate.
- General guidance: the charger must trust the authority that issued the certificate and needs a roughly correct clock to check it. Older firmware may lack current root certificates. Confirm that your exact charger validates the certificate before the maintenance window.

### Clock and time zone

- chargeOS sends its current time, in UTC, when the charger starts up and in reply to each Heartbeat (the charger's regular keep-alive message). General guidance: many chargers use this to set their clock.
- chargeOS does not refuse a connection because of the charger's clock. However, session start and stop times in **Energy history** come from the charger. A wrong charger clock gives wrong session times.
- The console shows times in your browser's time zone.

### Firewall and network

- The charger opens the connection to chargeOS. chargeOS never connects to the charger, so the charger's network does not need an open incoming port or port forwarding.
- The charger's network must allow outgoing connections to the charger hostname on port 443 and must be able to look up that name in DNS.
- The server must accept incoming connections on port 443, and on port 80 for certificate issuance and renewal.
- General guidance: company networks that inspect or proxy encrypted traffic can break `wss://` connections.
- For a local source trial, chargeOS listens only on its own computer (`127.0.0.1`) by default. A charger on your network cannot reach it until your administrator changes `CHARGEOS_OCPP_HOST` on a controlled charger network; see [Owner-edge operations](../owner-edge-operations.md).

### Mobile data (SIM) and APN

This section is general guidance, not chargeOS behaviour. A charger with a SIM card connects over the mobile network. The APN (access point name) is the mobile setting that decides where the SIM's data can go. A SIM supplied by your previous provider may use a private APN that only reaches that provider's back office, or may be disconnected when the contract ends. Find out who owns the SIM before the switch.

chargeOS cannot see or change SIM or APN settings. Make any APN change through the supported configuration tool during the authorized maintenance window. Removing or swapping a SIM is installer work with the power isolated.

### If it still does not connect

Do not experiment during the maintenance window. Restore the previous connection with your rollback procedure and investigate afterwards. [AI help](ai-help.md) can explain configuration checks, but it cannot see refused connection attempts.
