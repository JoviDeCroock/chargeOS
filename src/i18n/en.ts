/**
 * English owner-console messages: the reference catalog. Dutch and French must provide exactly the
 * same keys and placeholders (`{name}`); `test/i18n.test.ts` enforces that.
 *
 * Write for a charger owner, not an engineer: say what happens at the charger, keep protocol names
 * out of ordinary pages, and never present a software result as a physical test.
 */
import { fleetEn } from "./fleet.en.js";

export const en = {
  "advanced.englishOnly":
    "This section is only available in English for now, because its safety wording must be reviewed before it is translated.",
  "advanced.lede":
    "Technical tools for this charger. You only need these to set up offline charging, control the charger remotely or review records.",
  "advanced.tabs": "Station settings sections",

  "app.charger": "Charger",
  "app.chargerCount.one": "{count} charger",
  "app.chargerCount.other": "{count} chargers",
  "app.connectedCount": "{connected} of {total} connected",
  "app.footer": "Open source. Local first. You stay in control.",
  "app.help": "Help guides",
  "app.lock": "Lock console",
  "app.opening": "Opening your console…",
  "app.otherToken": "Use another token",
  "app.sections": "Console sections",
  "app.skip": "Skip to content",
  "app.snapshot": "Updated {date}",
  "app.updated": "Updated",

  "attention.authorization-pending": "Cards waiting to be sent",
  "attention.continuity-unproven": "Offline charging not checked",
  "attention.evidence-conflict": "Conflicting session data",
  "attention.migration-action": "Switching step open",
  "attention.offline": "Offline",
  "attention.no-cards": "No card yet",

  "board.freedomDetail": "Witnessed test at the charger",
  "board.sharingActive.one": "{count} person has read access",
  "board.sharingActive.other": "{count} people have read access",
  "board.sharingDetail": "Temporary read-only access",
  "board.sharingNone": "Nobody else has access",
  "board.switchingDetail": "Moving away from a previous provider",
  "board.title": "At a glance",

  "cards.add": "Add card",
  "cards.addHint":
    "The card works at the charger once the charger accepts the new card list. Until then, it waits here.",
  "cards.addTitle": "Add a card to {station}",
  "cards.adding": "Adding…",
  "cards.count.one": "{count} card",
  "cards.count.other": "{count} cards",
  "cards.editTitle": "Edit card",
  "cards.field.holder": "Who uses it",
  "cards.field.name": "Card name",
  "cards.field.namePlaceholder": "For example: blue key fob",
  "cards.field.newPerson": "Someone new…",
  "cards.field.number": "Card number",
  "cards.field.numberHint":
    "The value the charger reads from the card. It is often not the number printed on it, so tapping the card at the charger is easier. chargeOS keeps it only on this server and never shows it again.",
  "cards.field.reference": "Card reference:",
  "cards.first.body":
    "No card can charge here yet: chargeOS refuses every card until you add one. Tap your own card at the charger to add it.",
  "cards.first.title": "Add your first card",

  "cards.keepOne": "A charger always keeps at least one card, so you can never lock yourself out.",
  "cards.lede":
    "Cards that can start charging at {station}. Once a card is on the charger, it also works without internet.",
  "cards.onCharger": "On the charger",
  "cards.privacy":
    "Names are only shown in this console. Exports, shared access and AI help use anonymous card references instead.",
  "cards.removeAcknowledge":
    "I understand this card may keep working at the charger until the charger accepts the new card list.",
  "cards.removeBody":
    "The card is removed from the list straight away. The charger itself only forgets it once it accepts the new card list, so send the list afterwards.",
  "cards.removeConfirm": "Remove card",
  "cards.removeTitle": "Remove {name}?",
  "cards.staleBody":
    "The charger has not received the new list yet. During an internet outage it may still accept them. Send the card list to the charger to finish removing them.",
  "cards.staleTitle.one": "{count} removed card may still work at the charger",
  "cards.staleTitle.other": "{count} removed cards may still work at the charger",
  "cards.sync.checkFirst":
    "Before sending, check that the charger has the settings needed for charging without internet.",
  "cards.sync.confirm": "Replace the card list on the charger with the cards shown here?",
  "cards.sync.current": "All cards are on the charger",
  "cards.sync.currentLong": "The charger accepted the current list",
  "cards.sync.never": "Cards not sent yet",
  "cards.sync.neverLong": "The charger hasn’t confirmed receipt of a card list.",
  "cards.sync.offline": "The charger is disconnected. You can send the list when it reconnects.",
  "cards.sync.openOffline": "Check offline charging",
  "cards.sync.pending": "Changes waiting for the charger",
  "cards.sync.pendingLong.one": "{count} change is waiting to be sent to the charger",
  "cards.sync.pendingLong.other": "{count} changes are waiting to be sent to the charger",
  "cards.sync.readyHint": "Send the list so the charger knows exactly these cards.",
  "cards.sync.send": "Send to charger",
  "cards.sync.sending": "Sending…",
  "cards.tap.add": "Add this card",
  "cards.tap.again": "Listen again",
  "cards.tap.captured": "Card found",
  "cards.tap.capturedBody":
    "A card was tapped at {time} (reference {reference}). The charger refused it this time, as expected. Add it, and it works here from now on.",
  "cards.tap.expired":
    "No card reached chargeOS. Check that the charger is connected and listen again, or type the card number instead.",
  "cards.tap.intro":
    "Tap your card at the charger and chargeOS adds it, so you never need to know its number. The charger refuses this one tap; that is expected.",
  "cards.tap.known": "That card is already one of this charger's cards. Nothing changed.",
  "cards.tap.listening": "Tap your card at the charger now",
  "cards.tap.listeningBody":
    "Hold one card against the charger's card reader. Only this charger is listening, and only for a short while.",
  "cards.tap.offline":
    "The charger is offline. chargeOS can only see a tap while the charger is connected.",
  "cards.tap.several":
    "More than one different card was tapped, so none was added. Listen again and tap only your card.",
  "cards.tap.start": "Tap a card at the charger",
  "cards.tap.typeInstead": "Type the card number instead",
  "cards.tap.until": "Listening until {time}.",

  "cards.title": "RFID cards",
  "cards.unnamed": "Unnamed card",
  "cards.unnamedShort": "Card {id}",
  "cards.waiting": "Waiting to be sent",

  "command.message.accepted":
    "{name}: the charger said yes. Check what happened afterwards below; a yes alone is not proof.",
  "command.message.failed": "{name}: not carried out ({status}). This charger may not support it.",
  "command.message.pending": "{name}: sent, waiting for the charger.",
  "command.message.rejected": "{name}: the charger said no ({status}). Nothing changed.",
  "command.message.uncertain":
    "{name}: no clear answer ({status}). The charger may or may not have acted; check it before trying again.",
  "command.state.accepted": "accepted",
  "command.state.failed": "failed",
  "command.state.pending": "waiting",
  "command.state.rejected": "refused",
  "command.state.uncertain": "uncertain",
  "command.type.ChangeAvailability": "Make available",
  "command.type.RemoteStartTransaction": "Remote start",
  "command.type.RemoteStopTransaction": "Remote stop",
  "command.type.Reset": "Restart",
  "command.type.UnlockConnector": "Unlock cable",

  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.edit": "Edit",
  "common.remove": "Remove",
  "common.save": "Save",
  "common.typePhrase": "Type this exact phrase to confirm",

  "connect.address": "Charger address",
  "connect.addressUnknown":
    "The charger address from your setup (START-HERE.txt), followed by the charger name",
  "connect.alias.accept": "Use {presented}",
  "connect.alias.accepting": "Saving…",
  "connect.alias.offer":
    "Or keep the charger as it is: chargeOS can accept {presented} as this charger's name, because the charger proved it knows this charger's password. The charger then connects on its next try.",

  "connect.awaitingBootBody":
    "The charger is connected. Waiting for its first start-up message, which tells chargeOS the model and firmware. This usually takes less than a minute.",
  "connect.identity": "Charger name (identity)",
  "connect.identityHint":
    "Copy the charger name exactly, including capital letters. Some charger tools ask for the address and the name separately; then the address ends with a slash.",
  "connect.identityWithAlias": "{id}, or {alias} (the name your charger already uses)",

  "connect.installerNote":
    "Your installer enters these settings in the charger's own configuration tool. chargeOS never changes the charger's settings itself.",
  "connect.intro":
    "Enter these settings in your charger's configuration tool. This page updates on its own when the charger connects.",
  "connect.password": "Password",
  "connect.passwordWhere":
    "The charger password (stationSecret) in credentials.json from your setup. It is never shown here.",
  "connect.protocol": "Protocol",
  "connect.protocolValue": "OCPP 1.6 JSON (sometimes called OCPP-J)",
  "connect.refused.anyDevice":
    "Any device that uses this charger name can cause this message, so it explains the last attempt rather than proving where it came from.",

  "connect.refused.duplicate": "Another connection with this charger name is already open",
  "connect.refused.duplicateFix":
    "Wait a few minutes and let the charger try again. If it keeps happening, make sure no other device uses the name {expected}.",
  "connect.refused.identity": "Your charger used a different name",
  "connect.refused.identityBody":
    "It sent this charger's password but called itself {presented}. chargeOS expects {expected}.",
  "connect.refused.identityFix": "Change the charger name in the charger tool to {expected}.",
  "connect.refused.identityUnprintable":
    "It sent this charger's password but with a name chargeOS cannot use. chargeOS expects {expected}.",
  "connect.refused.noPassword": "Your charger connected without a password",
  "connect.refused.noPasswordFix":
    "In the charger tool, choose the security setting that sends a password (Basic authentication) and enter the charger password. If it asks for a user name, use {expected}.",
  "connect.refused.protocol": "Your charger is not using OCPP 1.6 JSON",
  "connect.refused.protocolBody": "It offered {offered}.",
  "connect.refused.protocolFix":
    "Choose OCPP 1.6 with JSON in the charger tool. chargeOS does not support other versions yet.",
  "connect.refused.when": "Last attempt at {time}.",
  "connect.refused.wrongPassword": "Your charger sent the wrong password",
  "connect.refused.wrongPasswordFix":
    "Copy the password again from credentials.json (stationSecret). Use all of it; do not shorten it. If the tool cannot store it, stop and ask your installer.",
  "connect.security": "Security",
  "connect.securityValue": "The setting that sends a password (Basic authentication)",
  "connect.state.awaitingBoot": "Connected, waiting",
  "connect.state.connected": "Connected",
  "connect.state.waiting": "Waiting for the charger",
  "connect.title": "Connect your charger",
  "connect.unmatched.one":
    "{count} connection attempt used an unknown charger name and password (last at {time}). If that was your charger, check both.",
  "connect.unmatched.other":
    "{count} connection attempts used an unknown charger name and password (last at {time}). If one was your charger, check both.",

  "connector.Available": "Available",
  "connector.Charging": "Charging",
  "connector.Faulted": "Fault",
  "connector.Finishing": "Finishing",
  "connector.Preparing": "Getting ready",
  "connector.Reserved": "Reserved",
  "connector.SuspendedEV": "Paused by the car",
  "connector.SuspendedEVSE": "Paused by the charger",
  "connector.Unavailable": "Unavailable",

  "controls.card": "Card",
  "controls.col.answer": "Charger answer",
  "controls.col.command": "Command",
  "controls.col.observed": "What happened afterwards",
  "controls.col.requested": "Sent",
  "controls.connector": "Connector",
  "controls.hard": "Hard (immediately)",
  "controls.history": "Command history",
  "controls.historyEmpty": "No remote commands sent yet.",
  "controls.intro":
    "Only you can send these, and only while the charger is connected. A charger can say yes and still not do it, so each command shows its answer and what actually happened afterwards. chargeOS never switches a charger off, because a charger remembers that even if chargeOS disappears.",
  "controls.makeAvailable": "Make connector {connector} available",
  "controls.noSession": "Nothing is charging.",
  "controls.notObserved": "Not seen yet",
  "controls.offline": "The charger is offline, so remote commands are unavailable.",
  "controls.restart": "Restart",
  "controls.restartTitle": "Restart charger",
  "controls.restartType": "Type of restart",
  "controls.soft": "Soft (ends charging cleanly first)",
  "controls.start": "Start remotely",
  "controls.startTitle": "Start charging",
  "controls.stopSession": "Stop session #{id} (connector {connector})",
  "controls.stopTitle": "Stop charging",
  "controls.title": "Remote control",
  "controls.unlock": "Unlock",
  "controls.unlockHint": "Releases the cable. Only do this when you are standing at the charger.",
  "controls.unlockTitle": "Unlock cable on connector {connector}",

  "details.chargePointId": "Charge point ID",
  "details.firmware": "Firmware",
  "details.namesNote":
    "The name, location and person are labels in this console only. The charger itself is identified by its charge point ID.",
  "details.title": "Charger details",

  "directory.readOnly":
    "Saved names could not be read, so editing is switched off to protect them. Ask your administrator to check directory.json. Charging is not affected.",
  "directory.unavailable":
    "Names are not available on this server version. Charging and cards work as usual.",

  "evidence.carried": "carried from a held backup",
  "evidence.empty": "No records yet.",
  "evidence.export": "Download shareable record",
  "evidence.exporting": "Preparing…",
  "evidence.fromCharger": "From charger",
  "evidence.latest": "Latest records",
  "evidence.lede":
    "The tamper-evident record chargeOS keeps for this charger. The download leaves out secrets and card numbers and is not a backup.",
  "evidence.system": "chargeOS",
  "evidence.toCharger": "To charger",

  "module.assist.description": "Ask your own AI provider for read-only troubleshooting advice.",
  "module.assist.label": "AI help",
  "module.evidence.description": "See the tamper-evident record and download it.",
  "module.evidence.label": "Records",
  "module.liberation.description":
    "Move a charger away from its previous provider and run the witnessed Freedom Test.",
  "module.liberation.label": "Switching and Freedom Test",
  "module.sharing.description":
    "Give an installer, employer or energy provider temporary read-only access.",
  "module.sharing.label": "Shared access",

  "nav.advanced": "Station settings",
  "nav.cards": "RFID cards",
  "nav.hint.attention": "needs attention",
  "nav.hint.cardsWaiting": "cards waiting to be sent",
  "nav.hint.notChecked": "offline charging not checked",
  "nav.overview": "Overview",
  "nav.people": "People",
  "nav.preferences": "Preferences",
  "nav.stations": "Chargers",
  "nav.usage": "Usage",

  "notice.cardAdded":
    "Card added. Send the card list to the charger so it also works without internet.",
  "notice.cardAddedUnnamed":
    "Card added, but its name could not be saved. Edit the card to try again.",
  "notice.cardRemoved":
    "Card removed from the list. It may keep working at the charger until the charger accepts the new card list.",
  "notice.cardSaved": "Card saved.",
  "notice.delegateIssued": "Access created. Copy the secret now; it is not stored.",
  "notice.delegateRevoked": "Access revoked. Your own cards and charging are not affected.",
  "notice.evidenceExported": "Record downloaded. Secrets and card numbers are left out.",
  "notice.failed": "That did not work. Try again.",
  "notice.identityAliasAccepted":
    "Name accepted. The charger connects on its next try; this page updates on its own.",

  "notice.inspectBlocked":
    "The charger is missing at least one setting needed for offline charging.",
  "notice.inspectReady":
    "The charger has every setting needed for offline charging. A real test at the charger is still the only proof.",
  "notice.personAdded": "Person added.",
  "notice.personRemoved": "Person removed. Their chargers and cards are now unassigned.",
  "notice.personSaved": "Name saved.",
  "notice.preparedChanged":
    "Offline settings changed on the charger: {count}. Send the card list next.",
  "notice.preparedUnchanged": "The offline settings were already right. Send the card list next.",
  "notice.stationSaved": "Charger saved.",
  "notice.synced": "The charger accepted the card list (version {revision}).",

  "offline.blockedText":
    "At least one setting needed for offline charging is missing or wrong. Open Station settings to fix it.",
  "offline.blockedTitle": "Something needs fixing",
  "offline.check": "Check the charger",
  "offline.checkAgain": "Check again",
  "offline.checking": "Checking…",
  "offline.checksLabel": "Offline charging checks",
  "offline.checksPass": "checks pass",
  "offline.connectFirst": "Connect the charger first, then check it.",
  "offline.details": "Details",
  "offline.explain":
    "chargeOS asks the charger which settings it has. Checking only reads; it changes nothing.",
  "offline.kicker": "Charging without internet",
  "offline.lastAttempt": "Last attempt",
  "offline.lastChecked": "Last checked {date}",
  "offline.lastRevision": "Card list version on charger",
  "offline.lastSync": "Last sent",
  "offline.notChecked": "not checked",
  "offline.physicalTest":
    "Still do a real test once: disconnect the internet and charge with your card.",
  "offline.physicalWork":
    "Changing the charger's server address, firmware or wiring is not done here. That is installer work.",
  "offline.prepare": "Change offline settings",
  "offline.prepareText":
    "Asks the charger to keep a local card list, accept those cards without internet, and refuse unknown cards. Nothing else changes, and the charger is not restarted.",
  "offline.prepareTitle": "Turn on offline charging",
  "offline.preparing": "Changing…",
  "offline.readyText":
    "The charger reported every setting it needs to accept your cards on its own.",
  "offline.readyTitle": "Ready",
  "offline.sendLocked": "Available once every check passes.",
  "offline.sendText":
    "Replaces the charger’s card list with the cards in this console. An accepted list confirms delivery. Test at the charger to check offline behavior.",
  "offline.sendTitle": "Send cards to the charger",
  "offline.unanswered": "Waiting for the charger to answer",
  "offline.unknownText":
    "Check whether the charger can accept your cards when the internet is down. Checking only reads settings.",
  "offline.unknownTitle": "Not checked yet",

  "overview.cardDetails": "View RFID cards",
  "overview.cardListWaiting": "A card list update has no reply yet.",
  "overview.cardsOnCharger": "Cards on the charger",
  "overview.cardsRegistered.one": "{count} card registered in chargeOS",
  "overview.cardsRegistered.other": "{count} cards registered in chargeOS",
  "overview.chargingNow": "Charging right now",
  "overview.chargingOn": "Connector {connector} reports charging",
  "overview.chargingUnknown": "Unknown",
  "overview.connectFirst":
    "chargeOS is waiting for the charger to connect. If you’re switching providers, keep your current service connected while you and your installer check the exact model and firmware, save your settings, and plan how to switch back.",
  "overview.connectionGuide": "Open the connection guide",
  "overview.fieldFailed": "The field test recorded a failure",
  "overview.fieldReview": "Field results recorded. Review pending.",
  "overview.fieldStale": "Previous field results are out of date",
  "overview.fieldUnverified": "Not verified",
  "overview.installerSettings": "Connection settings for your installer",
  "overview.lastCardList": "Last accepted list: {date}",
  "overview.lastChargingReport": "Charger status reported at {date}",
  "overview.listAccepted": "The charger accepted the current list",
  "overview.noCardList": "The charger hasn’t confirmed receipt of a card list.",
  "overview.noCards": "No cards registered in chargeOS",
  "overview.notCharging": "Charger reports no charging",
  "overview.notConnected": "Not connected",
  "overview.offlineDetails": "View offline charging settings",
  "overview.reconnect":
    "chargeOS has lost its connection to the charger. Check the connection before changing any settings.",
  "overview.settingsBlocked": "The settings check found a problem.",
  "overview.settingsPassed":
    "The settings check passed. Only a test at the charger can show what happens offline.",
  "overview.settingsUnchecked":
    "Check the settings after connection, then follow the field test guide.",
  "overview.statusTitle": "What chargeOS knows",
  "overview.statusUnavailable":
    "The console couldn’t refresh. Live charging status is unavailable.",
  "overview.waitingForStatus": "No live status from the charger.",
  "overview.stop": "Stop charging",
  "overview.stopBody":
    "A switching step recorded a problem. Keep everything as it is and resolve it before continuing.",
  "overview.stopLink": "Open switching",
  "overview.stopTitle": "Stop: a problem was recorded",

  "people.add": "Add person",
  "people.addCompany": "Add employee",
  "people.empty": "No people yet. Add someone to give chargers and cards a name.",
  "people.emptyCompany": "No employees yet. Add an employee, then assign their charger and cards.",
  "people.field.name": "Name",
  "people.lede": "The people who charge here, with their chargers and cards.",
  "people.ledeCompany":
    "Your employees, the charger at their home and the cards they use. Usage is reported per employee.",
  "people.noCards": "No cards",
  "people.noStation": "No charger",
  "people.nobody": "Nobody",
  "people.privacy":
    "Names stay on this server and are only shown in this console. They are not part of exports, shared access, AI help or encrypted backups.",
  "people.removeBody":
    "Their chargers and cards stay as they are but no longer have a name attached. Charging is not affected.",
  "people.removeTitle": "Remove {name}?",
  "people.rename": "Rename",
  "people.renameTitle": "Rename",
  "people.stationCount.one": "{count} charger",
  "people.stationCount.other": "{count} chargers",
  "people.stations": "Chargers",
  "people.title": "People",
  "people.titleCompany": "Employees",

  "prefs.company": "Company",
  "prefs.companyText":
    "Set up for an organization that runs chargers for its employees: usage is reported per employee and can be exported.",
  "prefs.language": "Language",
  "prefs.languageNote":
    "Saved in this browser. Help guides and some advanced sections are in English.",
  "prefs.lede": "Choose how this console looks. Your choices only apply in this browser.",
  "prefs.modules": "Extra sections",
  "prefs.modulesCustom": "Using your choice in this browser.",
  "prefs.modulesDefault": "Following the profile defaults.",
  "prefs.modulesNote":
    "Hiding a section only changes what this browser shows. It does not switch off cards, offline charging or anything already recorded. A hidden section comes back while it needs your attention.",
  "prefs.onByDefault": "On by default.",
  "prefs.personal": "Personal",
  "prefs.personalText":
    "Set up for a person with their own charger: the overview starts with how much you charge.",
  "prefs.profile": "Profile",
  "prefs.profileNote": "Your administrator sets the profile when the server starts, with",
  "prefs.title": "Preferences",
  "prefs.useDefaults": "Use profile defaults",

  "sessions.active": "charging",
  "sessions.card": "Card",
  "sessions.cardRefused": "card refused",
  "sessions.complete": "done",
  "sessions.conflict": "conflicting data",
  "sessions.connector": "Connector",
  "sessions.empty": "No charging sessions yet.",
  "sessions.energy": "Energy",
  "sessions.number": "Session",
  "sessions.retries.one": "{count} repeated message",
  "sessions.retries.other": "{count} repeated messages",
  "sessions.started": "Started",
  "sessions.status": "Status",

  "sharing.canRead": "Can see",
  "sharing.copyNow": "Copy this secret now",
  "sharing.copyNowBody":
    "Send it privately to that one person. chargeOS cannot show it again once you dismiss it.",
  "sharing.current": "Who has access",
  "sharing.day": "{count} day",
  "sharing.days": "{count} days",
  "sharing.dismiss": "I copied it",
  "sharing.expires": "Expires after",
  "sharing.expiresOn": "Expires {date}",
  "sharing.issue": "Create access",
  "sharing.issueTitle": "Give temporary read access",
  "sharing.issuing": "Creating…",
  "sharing.lede":
    "Give someone temporary, read-only access to this charger. They cannot change cards, settings or the charger, and you can take access back at any time.",
  "sharing.none": "Nobody else has access.",
  "sharing.revoke": "Revoke",
  "sharing.revokeConfirm": "Take this access away now?",
  "sharing.role": "Who is it for",
  "sharing.role.employer": "Employer (reimbursement)",
  "sharing.role.energy": "Energy provider",
  "sharing.role.installer": "Installer",
  "sharing.scope.employer": "Session times and energy only. No card identities.",
  "sharing.scope.energy": "Charger and connector status only.",
  "sharing.scope.installer":
    "Charger status, diagnostics, the switching record and unreviewed Freedom Test results.",
  "sharing.status.active": "active",
  "sharing.status.expired": "expired",
  "sharing.status.revoked": "revoked",

  "signin.body":
    "Enter the owner token from your chargeOS setup. It stays in this browser tab only.",
  "signin.help": "Setup and help guides",
  "signin.open": "Open console",
  "signin.title": "Welcome to your chargers",
  "signin.token": "Owner token",

  "station.awaitingBoot": "Waiting for the charger to report",
  "station.connected": "Connected",
  "station.connectedSince": "Connected since",
  "station.connector": "Connector {id}",
  "station.hardware": "Model",
  "station.noConnectors": "No connector status received yet.",
  "station.offline": "Offline",
  "station.title": "Charger",

  "stations.attention": "Needs attention",
  "stations.available": "Available",
  "stations.chargingNow": "Charging",
  "stations.driver": "Person",
  "stations.edit": "Edit names",
  "stations.editTitle": "Edit charger",
  "stations.energy": "Energy recorded",
  "stations.field.driver": "Person",
  "stations.field.driverHint": "Usage on this charger is reported under this person.",
  "stations.field.id": "Charge point ID (cannot be changed here):",
  "stations.field.name": "Name",
  "stations.field.namePlaceholder": "For example: Driveway",
  "stations.field.site": "Location",
  "stations.field.sitePlaceholder": "For example: Home or Brussels office",
  "stations.independence":
    "Each charger keeps its own card list and keeps working on its own, even when this console is unavailable.",
  "stations.lastSession": "Last session",
  "stations.lede": "Every charger you manage, who it belongs to and which cards it accepts.",
  "stations.metric.chargers": "Chargers",
  "stations.metric.charging": "Charging now",
  "stations.metric.connected": "Connected",
  "stations.metric.energy": "Energy recorded",
  "stations.offline": "Offline",
  "stations.open": "Open",
  "stations.summary": "Summary",
  "stations.title": "Chargers",

  "status.connected": "Charger connected",
  "status.offline": "Charger offline",

  "tab.assist": "AI help",
  "tab.controls": "Remote control",
  "tab.details": "Details",
  "tab.evidence": "Records",
  "tab.freedom": "Freedom Test",
  "tab.offline": "Offline charging",
  "tab.sessions": "Sessions",
  "tab.sharing": "Shared access",
  "tab.switching": "Switching provider",

  "usage.byCard": "This month by card",
  "usage.byCharger": "Usage by charger",
  "usage.byDriver": "Usage by person",
  "usage.chargers": "Chargers",
  "usage.chartTitle": "Energy per month, kWh",
  "usage.col.charger": "Charger",
  "usage.col.driver": "Person",
  "usage.col.energy": "Energy",
  "usage.col.month": "Month",
  "usage.col.sessions": "Sessions",
  "usage.col.site": "Location",
  "usage.conflictNote.one":
    "{count} session reported conflicting stop values; the first value is used and the row is marked “conflict” in the download.",
  "usage.conflictNote.other":
    "{count} sessions reported conflicting stop values; the first value is used and those rows are marked “conflict” in the download.",
  "usage.download": "Download CSV",
  "usage.drivers": "People",
  "usage.driversDetail": "with a charger",
  "usage.empty": "No charging sessions yet. Usage appears here after the first charge.",
  "usage.last12": "Last 12 months",
  "usage.lastMonth": "Last month",
  "usage.lede": "Energy recorded on every charger you manage, month by month.",
  "usage.ledeCompany":
    "Energy recorded on every charger, grouped by the employee each charger belongs to. Use the download for reimbursement or payroll review.",
  "usage.loading": "Loading usage…",
  "usage.meterNote":
    "Measured by the charger's own meter. A session counts once it stops. This is an overview, not a bill or an approved reimbursement.",
  "usage.notLoaded": "No report loaded.",
  "usage.openNote.one": "{count} session is still charging; it counts once it stops.",
  "usage.openNote.other": "{count} sessions are still charging; they count once they stop.",
  "usage.panelSub": "Energy per month, by the month each session started ({timeZone}).",
  "usage.panelTitle": "Your charging",
  "usage.reportNote":
    "Months follow {timeZone}; a session belongs to the month it started. Figures come from each charger's own meter. The download uses anonymous card references, never card numbers, and is not an approved reimbursement statement.",
  "usage.sessions.one": "{count} session",
  "usage.sessions.other": "{count} sessions",
  "usage.showChart": "Show chart",
  "usage.showTable": "Show table",
  "usage.stillCharging.one": "{count} still charging",
  "usage.stillCharging.other": "{count} still charging",
  "usage.thisMonth": "This month",
  "usage.title": "Usage",
  "usage.titleCompany": "Usage per employee",
  "usage.unassigned": "Nobody",
  "usage.withSessions": "{count} with sessions",
  ...fleetEn,
} as const;

export type MessageKey = keyof typeof en;
