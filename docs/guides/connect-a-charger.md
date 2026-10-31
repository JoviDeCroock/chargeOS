# Connect a charging station

Your charging station runs its manufacturer's software. chargeOS runs on your server. Connecting them means changing the station's back-office connection through a supported manufacturer tool. This is not a firmware installation.

## Check that you can move it

Before changing anything, confirm that you own the charger or have permission from its owner, and that your existing charging-service agreement permits the handover. You need the exact model, hardware revision, firmware version and local administrator access. Ask who owns the SIM and network connection too.

Use [Several chargers and brands](brands.md) to find the evidence for your exact device. A brand name or an OCPP logo alone does not establish compatibility.

## Prepare a way back

1. Keep the current provider connected while you prepare.
2. Export and save the charger configuration and historical transactions. Agree a reimbursement cut-off with your employer so sessions are not lost or paid twice.
3. Keep the current connection settings and a supported rollback procedure outside the charger.
4. Check your chargeOS console and its HTTPS certificate. Keep the new OCPP identity, WSS address and unique station password ready.
5. Arrange an explicitly authorized maintenance window with the owner and installer before any standalone-mode changes, network isolation, restart or live connection change. Preparation before that window uses read-only exports and inspection.
6. During that window, with your installer, verify that your owner RFID card can charge locally without the provider. Check that an unknown card is rejected and that the owner card still works after a restart. Restore the current path if the test fails; do not proceed to migration.

## Make the connection

For the first Alfen target, the exact procedure is in the [Alfen migration runbook](../alfen-genesis-runbook.md). Use the supported manufacturer tool and the instructions matching your firmware. Other models require their own documented procedure; do not copy Alfen setting names into another charger.

Before the switch, follow the console's Genesis plan and migration dossier. Record the existing device identity, prerequisite evidence and backups while the current provider remains connected. Have your operator prepare the exact target manifest, then have the owner authorize that target and its maintenance window in chargeOS. The installer switches only while that authorization is active. The [runbook](../alfen-genesis-runbook.md) gives the full sequence.

The installer then enters the new back-office address and credentials. chargeOS should show a connection and the expected hardware identity. Stop and investigate if the identity differs, configuration cannot be backed up, owner authorization fails, or rollback is uncertain.

Opening the enclosure, touching wiring or changing a SIM is installer work with the power isolated. A web page or AI answer does not authorize that work.

## Check charging after the move

Use the console's migration and Freedom Test panels to record the actual result. Run a real owner-card charge and check start, energy and stop evidence. Then witness charging during internet/backend loss, a restart while isolated, rejection of an unknown card and recovery after reconnection. Only physical evidence can establish these outcomes.

Finally, create an encrypted recovery bundle and keep a copy away from the server. See [Back up and recover](recovery.md). A green software check or successful AI answer is not a completed charger migration.
