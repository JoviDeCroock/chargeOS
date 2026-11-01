# Several chargers and brands

chargeOS uses OCPP 1.6J, a communication protocol for charging stations. Manufacturers implement it differently, and two chargers with the same badge can need different setup steps. An OCPP connection alone does not prove that a charger will work without its vendor's cloud.

## Check one exact charger

Ask your installer for its brand, full model/article number, hardware revision, firmware version, administrator access method and network/SIM ownership. Find the matching family in the [Charger Freedom Matrix](../charger-freedom-matrix.md), then check the source date and limitations. The existing matrix is desk research; its provisional rows are not a field-tested brand-wide support list.

The matrix includes research rows for Alfen, ABB, Easee, Zaptec, Smappee, Wallbox, Mennekes, Schneider, KEBA, Peblar, go-e, Webasto, EVBox, Tesla and open charger platforms. Those rows document different evidence and uncertainty. Inclusion does not mean your particular device is supported or safe to migrate.

The first physical target is an Alfen Eve Single S/Pro line charger in Belgium. A witnessed exact-device migration and offline test remain required. For another brand, obtain a supported manufacturer procedure and prove the same owner charging and recovery behavior before using it in service.

## How chargeOS copes with differences between chargers

Manufacturers interpret the protocol slightly differently. chargeOS handles the common differences that are safe to handle, and shows you the rest so you don't miss them:

- **Card numbers in upper or lower case.** The protocol treats card identifiers as case-insensitive, so `04A1B2C3` and `04a1b2c3` count as the same card. chargeOS won't let you add two cards that differ only in letter case.
- **Manufacturer-specific messages.** Some chargers send private `DataTransfer` messages, firmware or diagnostics status, or security events. chargeOS acknowledges them so the charger doesn't keep retrying, and records only the message type. It does not store private manufacturer data or free-text device logs.
- **Messages that break the protocol rules.** If a charger sends a message that doesn't follow the OCPP 1.6J format (for example a start time in an unrecognized format), chargeOS refuses it and records a `ProtocolMessageRejected` event naming the message and the field. It never stores the contents. Repeated rejections of start, meter or stop messages mean that firmware can lose session records. Note it as evidence for your exact device and ask the manufacturer or your installer about a firmware fix. Don't use that charger for reimbursed sessions until the rejections stop.
- **Settings the charger doesn't have.** The readiness check asks for the local card-list settings and both list sizes (`SendLocalListMaxLength` and `LocalAuthListMaxLength`). If the charger says it doesn't support one of them, the check shows "not supported by this charger" and card synchronization stays blocked. A charger without a working local card list can't keep charging for you when the internet or chargeOS is down.

These behaviours are tested with simulated chargers that reproduce each difference. The simulations are named after the behaviour, not a brand, and passing them says nothing about whether a particular model works.

## Use a fleet

One chargeOS edge can show several provisioned chargers belonging to the same owner. The fleet view lets you pick a charger and inspect its own connection, cards, sessions and migration evidence. Chargers may have different brands if each exact device has been independently validated.

An administrator currently provisions this registry in a private stations file using the [fleet operations guide](../owner-edge-operations.md). Each charger needs its own identity, password and desired owner-card list. A company account does not automatically claim a charger; employer membership and physical ownership are separate.

The encrypted recovery format currently restores one station at a time. For deployments that need the complete owner-recovery guarantee, use one station per recoverable edge until fleet recovery has been implemented and tested. A fleet screen is not a substitute for a working backup.

## If your device is not listed

Keep the current provider connection. Gather the exact device information and supported manufacturer documentation. The AI helper can search public manuals with your permission, but it cannot establish ownership, obtain a withheld password or prove offline behavior. Share redacted evidence with your operator, never a raw card identifier, administrator password or recovery bundle.
