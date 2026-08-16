# European charging stack and standards

## Who does what

| Layer/actor                             | Normal role                                                                                        | Where control or lock-in appears                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Charge point / EVSE                     | Physical equipment, contactor, protection, cable/socket, meter, network module                     | Installer password, vendor firmware, closed local UI, provider SIM, cloud-only commissioning                      |
| Charger firmware                        | Electrical state machine, authorization behavior, protocol client, local storage                   | Signed but vendor-only updates; undocumented keys; local-list/buffer behavior varies by firmware                  |
| CSMS/OCPP backend                       | Receives station connections; authorization, configuration, transactions, commands, smart charging | Endpoint may be hidden/permissioned; operator holds credentials/data and can remain root after ownership transfer |
| CPO                                     | Operates charge points and sets access/service policy                                              | Often owns the CSMS relationship even when homeowner owns hardware                                                |
| eMSP                                    | Driver account/app/RFID, tariffs, roaming access                                                   | User identity and RFID may not be portable; mostly public-charging concern                                        |
| Roaming hub/network                     | Connects CPOs and eMSPs, commonly through OCPI/OICP                                                | Commercial contracts and identifiers; not required for one private charger                                        |
| Installer                               | Commissions electrical/network/backend settings                                                    | May retain the only local/admin credential; essential migration channel                                           |
| Energy supplier/aggregator              | Electricity contract, dynamic tariff, flexibility commands                                         | Smart-charging integration can become a second control root if permissions are broad                              |
| Employer/leasing/reimbursement provider | Funds hardware or reimburses home energy based on sessions/meter evidence                          | Contract/account may outlive employment; hardware ownership and backend administration diverge                    |
| RFID                                    | Presents a simple identifier to the station/backend                                                | Raw IDs are clonable/personal data; cloud-only authorization fails without local list/cache                       |
| Plug & Charge                           | ISO 15118 vehicle/certificate authorization                                                        | Certificate/contract ecosystem can lock identity to an eMSP; does not solve CSMS portability                      |
| Smart charging                          | CSMS/station schedules or limits charging                                                          | Proprietary cloud and energy API dependencies; safety limits stay in EVSE                                         |
| MID metering                            | Regulated measurement/conformity basis for commercial use                                          | Meter presence does not make every backend record settlement-grade; national reimbursement rules remain           |
| Solar/battery/HEMS                      | Measures local generation/load and optimizes charging                                              | Closed inverter/HEMS APIs; should be a delegated optimization layer, not owner root                               |

The technical controller after installation is whoever can authenticate to the local charger and change its endpoint/authorization settings, plus whoever operates the configured CSMS. That may not be the legal hardware owner. chargeOS treats credential and recovery custody as part of ownership transfer.

## Protocol boundaries

- **OCPP:** charge point to CSMS. It enables interoperability but does not require owner-accessible configuration or every optional behavior.
- **OCPI:** CPO/eMSP exchange for locations, credentials, tariffs, sessions, commands, and roaming. It is not the charger connection.
- **ISO 15118:** EV-to-EVSE communication, including Plug & Charge and later bidirectional functions. It complements rather than replaces OCPP.
- **MID:** metrology conformity, not a communications protocol.

## Capability map

| Capability               | OCPP permits                                       | Typical implementation risk                                        | Genesis requirement                             |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Boot/status/heartbeat    | Core 1.6J messages                                 | Vendor-specific status timing/errors                               | Required and persisted                          |
| Online `Authorize`       | Backend accepts/blocks ID tag                      | Some stations start directly from cache/list                       | Required, unknown tags rejected                 |
| Local authorization list | `SendLocalList` / list version                     | Optional capacity, persistence, and configuration                  | Required and behaviorally tested                |
| Authorization cache      | Cache previously returned decisions                | Expiry/eviction unclear; cached revocation risk                    | Useful, never substitute for owner local list   |
| Offline transactions     | Station may start locally and queue messages       | Buffer depth/order/restart persistence varies                      | Required, capacity measured per firmware        |
| Meter values             | Periodic/sampled values and transaction boundaries | Units/measurands/clock/fiscal provenance vary                      | Energy register plus raw evidence               |
| Remote start/stop        | CSMS command in 1.6J                               | Availability and authorization semantics vary                      | Later convenience, not essential-use dependency |
| Configuration            | `Get/ChangeConfiguration`                          | Keys are implementation-specific/read-only                         | Discover first; change only documented keys     |
| Smart charging           | Profiles and limits                                | Optional profile/purpose/stack-level support                       | Later; owner bounds always dominate             |
| Firmware update          | Remote URL/retrieve/install/status                 | Supply-chain, rollback, downtime, vendor signature                 | Owner-only later; not Genesis                   |
| Diagnostics              | Upload logs/status                                 | May leak secrets/personal data                                     | Later with redaction and owner consent          |
| TLS/certificates         | OCA security profiles/extensions                   | 1.6 devices often support only Basic over TLS; certificate UX poor | WSS + unique secret; mTLS when proven           |
| Plug & Charge            | Native integration is stronger in 2.0.1            | Charger/vehicle/PKI/certificate-contract dependencies              | Not MVP                                         |

## Version choice

OCPP 1.6J is the MVP target because the installed base is broad and every Genesis capability exists. OCPP 2.0.1 should be a separate adapter: its device model, transaction handling, security, smart charging, and ISO 15118 integration are better, but its Local Authorization List remains an optional certification profile. OCPP 2.1 and ISO 15118-20 are later bidirectional/DER work. OCPI is needed only when chargeOS becomes an operator/reimbursement/roaming participant.

## What remains local versus remote

Electrical protection, the contactor state machine, cached/local authorization, configured schedules/limits, and buffered observations can remain local if the firmware implements them. New identities, revocations, remote commands, dynamic tariffs, employer reporting, cross-site analytics, roaming, and most certificate lifecycle operations require a connected service. A product claim must name which layer is local and which service is replaceable.
