# Charger evidence schema

Use this record for each distinct compatibility claim.

## Identity

- Manufacturer and product family
- Exact model/article number
- Hardware revision/platform
- Firmware version
- Expected OCPP vendor/model/firmware captured before migration and the exact post-switch Boot match result
- Country/market and installation type
- Test/evidence date

## Control path

- OCPP version/subprotocol and security profile
- Direct, installer-mediated, or vendor-cloud-mediated endpoint
- Exact endpoint configuration path
- Required account, permission, password, SIM, network, or installer
- Local admin and factory/recovery path

## Continuity

- Local authorization mechanism and capacity
- Offline known-tag and unknown-tag behavior
- Persistence after restart
- Transaction/meter buffering and observed limits
- Configuration and data export formats
- Independent standalone and rollback path

## Evidence

- Primary documentation URLs and document version
- Field test identifier and redacted frame/config hashes
- SHA-256 of the separately held pre-switch identity inventory
- Actual online/offline/post-restart energy-delivery results
- Limitations and unresolved uncertainties
- Grade A–E or U, confidence, reviewer

Do not publish credentials, raw RFID identifiers, personal meter data, addresses, or network secrets.
