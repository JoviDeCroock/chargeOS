# Alfen Eve field notes

Exact-device lessons for Alfen Eve Single S-line/Pro-line chargers. Each item is labelled as sourced fact, owner-session observation, code fact, or unresolved uncertainty. None of it is Freedom Test evidence or a compatibility grade; update `docs/charger-freedom-matrix.md` only from reviewed field records.

## Configuration tools

- **Sourced (verified 2026-11-02):** Alfen's Eve Install mobile app connects to the charger locally and configures the back office by selecting a provider **preset** (for example `Eve-Control_no-TLS`); see [KA-01647](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01647). Tap Electric's onboarding guide describes the same preset flow and states the app is not yet for complete/advanced configuration; it is expected to replace ACE Service Installer, with a public release expected by the end of 2026 ([Tap Electric](https://docs.tapelectric.app/en/articles/16490979-alfen-onboarding-guide-eve-install-app)).
- **Inference:** a self-hosted chargeOS endpoint is not in any preset list, so neither source documents a way to enter a custom `ws://` URL and password in Eve Install. Until an exact app version shows a manual backend form with URL, OCPP 1.6 JSON and a password, use ACE Service Installer (Windows only) **Connectivity → manual backend settings**.
- **Sourced:** neither Eve Install source documents a configuration export. Without the ACE `.exml` export, rollback depends on a provider preset or on recorded current backend values. Do not switch when neither exists.
- **Owner-session observation (2026-11-02, Eve Single Pro-line S):** ACE Service Installer on Windows connected locally and produced a configuration backup. The charge box identity on ACE's **General** tab was serial-shaped (`ACE` followed by digits). Other installations may use a provider-assigned identity; copy whatever ACE shows, case-sensitive. Do not record the real identity in shared docs.
- **Owner-session observation (2026-11-03, same unit):** after the back office was changed to chargeOS in ACE, the charger reconnected and sent no `BootNotification` until it was restarted. The charge box identity it presented was the provider-assigned name, not the serial shown elsewhere in ACE. The password matched, so it was diagnosed as an identity mismatch. Since then, chargeOS asks a silent charger with `TriggerMessage` 30 seconds after it connects. Alfen support for that request on this firmware is not yet observed. An OCPP soft `Reset` from chargeOS was answered `Accepted`, but the charger had neither disconnected nor sent a Boot seven minutes later. Don't treat `Accepted` as proof of a restart; restart through ACE if the console never shows one.
- **Unofficial:** `alfenctl` (PyPI) claims to reimplement ACE. It is not an Alfen product and has not been evaluated here; do not use it on an owner's only charger.

## Connectivity

- **Sourced:** chargers on a private APN cannot reach an outside back office ([KA-01647](https://aceservice.alfen.com/en-us/knowledgebase/article/KA-01647)). Confirm in ACE whether the back-office connection uses Ethernet/Wi-Fi or the provider's cellular SIM before targeting a LAN gateway. A SIM change is installer work with power isolated.
- **Sourced (third-party):** other providers' ACE guides use Security Profile 0 with a provider URL. **Code fact:** chargeOS always requires HTTP Basic authentication, so profile 0 (no password) is refused with 401. Select the profile that sends the station password.
- **Unresolved:** whether every Pro-line firmware accepts plain `ws://`, and whether ACE appends the charge box identity to the entered URL. See the endpoint rule in the home-lab trial section of `SKILL.md`, which works either way.

## RFID

- **Inference:** with a provider back office, cards are usually authorized online, so ACE's local whitelist may be empty. If the card is listed there, its value is the best candidate for the OCPP idTag.
- **Inference:** the number printed on a provider card is usually a contract/eMAID-style identifier, not the idTag the charger sends.
- **Unresolved:** whether a phone NFC reader's UID (colons removed) matches the Alfen idTag byte order and case. A wrong value only causes owner-card rejection in the trial; correct it through the owner console.
- **Owner-session observation:** adding the card to ACE's whitelist is a persistent charger change that survives rollback to the prior provider. Record it so it can be reviewed or removed later.
