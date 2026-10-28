# Vision and founder constraints

## The promise

Privately owned charging hardware must not become unusable because an employer, fleet operator, installer, cloud vendor, or charge-point management company changes terms or disappears.

chargeOS makes ownership operational, not rhetorical. Owners receive:

1. essential local charging that survives cloud and company failure;
2. an explicit, transferable administration path;
3. portable session, meter, identity, and configuration data;
4. replaceable hosted or self-hosted control software;
5. evidence showing which promises were actually tested on their model and firmware.

## Charging-service replacement target

Direction updated 2026-10-28: replace the charging-management services supplied by 50five, ThreeForce/Last Mile Solutions and D’Ieteren Energy with a polished product covering home, workplace and public charging.

The target includes driver and employer experiences, station operations, reimbursement, billing and settlement, guest access, roaming, support and migration. Owner root, portable recovery and independent essential charging remain product constraints. Independent payment, roaming, installer and support partners may deliver parts of the service; a new interface still dependent on a provider being replaced is not independent parity.

[Charging-service replacement and feature parity](docs/product-parity.md) defines the current scope, experience brief and switching gates. [The feature register](docs/product-parity.json) is the canonical requirement and evidence list. A customer switches only after every applicable feature in their existing package is implemented, externally proven and operationally supported, or they explicitly accept a recorded exception.

Design and observation happen while the current provider remains connected. Engineering milestones do not reduce the replacement target or authorize a charger change.

## Genesis engineering proof

Liberate one privately owned Alfen Eve Single S/Pro line charger in Belgium from its existing Fifty5/TheeMileSolutions management path without impairing electrical safety or reimbursement evidence.

Success means:

- configuration and transaction backups exist;
- the charge point connects to an owner-controlled OCPP 1.6J endpoint;
- an owner RFID tag authorizes and a session produces start, meter, and stop records;
- the same owner can charge after backend/WAN loss and after a charge-point restart;
- buffered events reconcile after reconnection;
- rollback steps are documented and tested;
- the owner has a continuity bundle that another competent operator can use.

## What chargeOS is not

- Not a promise that all vendor-locked chargers can be liberated.
- Not a new electrical safety controller or charger firmware.
- Not a roaming network, payment acquirer, or public CPO in the first phase.
- Not generic OCPP hosting differentiated only by a dashboard.
- Not a claim that OCPP support automatically includes local authorization, endpoint choice, or usable admin credentials.

## Product principles

- Local essential use, cloud optionality.
- Owner root, delegated services.
- Open core, exportable state, documented recovery.
- Versioned evidence over compatibility marketing.
- Fail closed for identity, administration, and unknown users; remain available for the pre-authorized owner.
- Prove one real migration before abstracting fifteen brands.
