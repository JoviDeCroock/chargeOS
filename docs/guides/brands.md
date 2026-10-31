# Several chargers and brands

chargeOS uses OCPP 1.6J, a communication protocol for charging stations. Manufacturers implement it differently, and two chargers with the same badge can need different setup steps. An OCPP connection alone does not prove that a charger will work without its vendor's cloud.

## Check one exact charger

Ask your installer for its brand, full model/article number, hardware revision, firmware version, administrator access method and network/SIM ownership. Find the matching family in the [Charger Freedom Matrix](../charger-freedom-matrix.md), then check the source date and limitations. The existing matrix is desk research; its provisional rows are not a field-tested brand-wide support list.

The matrix includes research rows for Alfen, ABB, Easee, Zaptec, Smappee, Wallbox, Mennekes, Schneider, KEBA, Peblar, go-e, Webasto, EVBox, Tesla and open charger platforms. Those rows document different evidence and uncertainty. Inclusion does not mean your particular device is supported or safe to migrate.

The first physical target is an Alfen Eve Single S/Pro line charger in Belgium. A witnessed exact-device migration and offline test remain required. For another brand, obtain a supported manufacturer procedure and prove the same owner charging and recovery behavior before using it in service.

## Use a fleet

One chargeOS edge can show several provisioned chargers belonging to the same owner. The fleet view lets you pick a charger and inspect its own connection, cards, sessions and migration evidence. Chargers may have different brands if each exact device has been independently validated.

An administrator currently provisions this registry in a private stations file using the [fleet operations guide](../owner-edge-operations.md). Each charger needs its own identity, password and desired owner-card list. A company account does not automatically claim a charger; employer membership and physical ownership are separate.

The encrypted recovery format currently restores one station at a time. For deployments that need the complete owner-recovery guarantee, use one station per recoverable edge until fleet recovery has been implemented and tested. A fleet screen is not a substitute for a working backup.

## If your device is not listed

Keep the current provider connection. Gather the exact device information and supported manufacturer documentation. The AI helper can search public manuals with your permission, but it cannot establish ownership, obtain a withheld password or prove offline behavior. Share redacted evidence with your operator, never a raw card identifier, administrator password or recovery bundle.
