/**
 * English messages for adding chargers, coupling cards, employee pages, offboarding and the
 * finance feed. Spread into the reference catalog; Dutch and French must match these keys.
 */
export const fleetEn = {
  "fleet.sync.state.changed": "Skipped · charger or list changed",
  "fleet.sync.state.failed": "Acceptance unconfirmed · check the charger",
  "fleet.sync.state.synced": "Charger accepted the list",
  "fleet.sync.state.no-cards": "Skipped · no registered cards",
  "fleet.sync.state.not-ready": "Skipped · settings check needed",
  "fleet.sync.state.offline": "Skipped · charger disconnected",
  "fleet.sync.state.already-current": "Skipped · current list already accepted",
  "fleet.sync.state.eligible": "Ready to send",
  "fleet.sync.send.other": "Send to {count} chargers",
  "fleet.sync.send.one": "Send to {count} charger",
  "fleet.sync.revision": "List version {revision}",
  "fleet.sync.changes": "Additions: {additions} · Removals: {removals}",
  "fleet.sync.reviewAgain": "Review again",
  "fleet.sync.retryBody":
    "The review is unavailable or has changed. Review the current lists before trying again.",
  "fleet.sync.loading": "Checking which chargers can receive their card list…",
  "fleet.sync.resultBody":
    "Check which chargers accepted their list and which still need attention.",
  "fleet.sync.result": "Card sync results",
  "fleet.sync.reviewBody":
    "Each eligible charger will receive its own full card list. Check the additions and removals before sending.",
  "fleet.sync.review": "Review card sync",
  "fleet.cards.alsoAccepted": "Card list accepted at {station}",
  "driver.addPersonal": "Add a personal card",
  "driver.cardCount.one": "{count} card on this charger.",
  "driver.cardCount.other": "{count} cards on this charger.",
  "driver.cards": "Cards on your charger",
  "driver.companyCards":
    "Company cards are managed by your employer. You can add and remove your own personal cards; they are never reimbursed.",
  "driver.expires": "This page works until {date}. Ask your employer for a new link after that.",
  "driver.noLink.body":
    "Open the link your employer sent you. It contains a personal key, so keep it to yourself.",
  "driver.noLink.title": "This page needs your personal link",
  "driver.noSessions": "No charging sessions yet.",
  "driver.offlineReady": "Your charger is set up to accept your cards without internet.",
  "driver.offlineUnknown": "Your employer has not finished checking offline charging yet.",
  "driver.personalNote": "It will be added as your personal card. Sessions with it stay private.",
  "driver.recent": "Recent charging",
  "driver.removeTitle": "Remove this personal card?",
  "driver.sessions": "Sessions",
  "driver.state.charging": "Charging",
  "driver.state.offline": "Charger offline",
  "driver.state.ready": "Ready to charge",
  "driver.syncBody": "Send the list to your charger so these cards also work without internet.",
  "driver.syncOwner": "Your employer will send the list once offline charging is checked.",
  "driver.syncTitle": "Card changes are waiting for your charger",
  "driver.tapNow": "Hold your card against your charger now",
  "driver.yourCharger": "Your charger",

  "fleet.access.button": "Employee page",
  "fleet.access.can.personal": "Add or remove their own personal cards",
  "fleet.access.can.sessions": "See their own charging sessions",
  "fleet.access.can.status": "See whether their charger is online and charging",
  "fleet.access.cannot.company": "Change company cards or any other charger",
  "fleet.access.create": "Create link",
  "fleet.access.expiry":
    "The link works for 90 days. You can end it at any time under Station settings, Shared access.",
  "fleet.access.lede":
    "A personal page for this employee, on their phone or computer. With it they can:",
  "fleet.access.once": "This link is shown once. It works until {date}.",
  "fleet.access.send":
    "Send this link to {name}. Anyone with the link can open the page, so send it privately.",
  "fleet.access.station": "Charger",
  "fleet.access.title": "Employee page for {name}",

  "fleet.add.button": "Add charger",
  "fleet.add.chargerId": "Charger ID",
  "fleet.add.chargerIdHint":
    "Some chargers have a fixed ID, often their serial number. Enter it here; otherwise chargeOS chooses one.",
  "fleet.add.chargerIdPlaceholder": "Leave empty to let chargeOS choose",
  "fleet.add.checkIdentity": "Check that the right charger connects",
  "fleet.add.firmware": "Firmware",
  "fleet.add.firmwareOptional": "Any version",
  "fleet.add.lede":
    "chargeOS creates the charger and a password for it. You then give the installer a setup sheet.",
  "fleet.add.limit":
    "This server accepts at most {limit} charger connections at once. Ask your administrator to raise CHARGEOS_OCPP_MAX_CONNECTIONS before this charger connects.",
  "fleet.add.model": "Model",
  "fleet.add.more": "Charger ID and identity check",
  "fleet.add.submit": "Create charger",
  "fleet.add.title": "Add a charger",
  "fleet.add.vendor": "Make",

  "fleet.capture.added": "Card added",
  "fleet.capture.addedBody":
    "It works at this charger now, while the charger is online. Send the card list so it also works without internet.",
  "fleet.capture.again": "Try again",
  "fleet.capture.alsoOn": "This card already works at: {stations}",
  "fleet.capture.arming": "Getting the charger ready…",
  "fleet.capture.discard": "Discard",
  "fleet.capture.expired": "The registration window closed before a card was tapped.",
  "fleet.capture.later": "Later",
  "fleet.capture.needsOnline": "The charger must be online to register a card by tapping it.",
  "fleet.capture.reference": "Reference",
  "fleet.capture.remaining": "Time left: {time}",
  "fleet.capture.start": "Register a card",
  "fleet.capture.tapHint":
    "The charger will refuse the card this time; that is expected. Only the first card tapped is used.",
  "fleet.capture.tapNow": "Hold the card against {station}",
  "fleet.capture.tapped": "Card tapped at {time}",
  "fleet.capture.title": "Register a card at {station}",

  "fleet.connect.passwordSheet":
    "The password on this charger's setup sheet. It is shown only once; make a new one under Chargers if it was lost.",
  "fleet.card.ownership": "Who owns the card",
  "fleet.card.ownership.company": "Company card",
  "fleet.card.ownership.companyHint": "Only you can change or remove it.",
  "fleet.card.ownership.personal": "Personal card",
  "fleet.card.ownership.personalHint":
    "The employee can remove it from their own page, for example a partner's card.",
  "fleet.card.unclassified": "Not classified",
  "fleet.card.use": "Charging with this card is",
  "fleet.card.use.business": "Business",
  "fleet.card.use.businessHint": "Sessions can be reimbursed.",
  "fleet.card.use.private": "Private",
  "fleet.card.use.privateHint": "Sessions are never reimbursed and never sent to finance.",

  "fleet.cards.classify": "Company or personal…",
  "fleet.cards.copy": "Use on other chargers…",
  "fleet.cards.lost": "Card lost: remove everywhere",
  "fleet.cards.alsoAt": "Registered at {station} · delivery unconfirmed",
  "fleet.cards.more": "More",
  "fleet.cards.removeHere": "Remove from this charger",
  "fleet.cards.syncAll": "Review card sync",
  "fleet.cards.typeNumber": "Type a card number",

  "fleet.classify.everywhere": "This applies to the same card on every charger.",
  "fleet.classify.title": "Classify {name}",

  "fleet.copy.confirm.one": "Add to {count} charger",
  "fleet.copy.confirm.other": "Add to {count} chargers",
  "fleet.copy.hint":
    "The card number stays on the server; nothing is retyped. Send the card lists afterwards so the card works offline there too.",
  "fleet.copy.lede": "Choose the chargers where this card should also work.",
  "fleet.copy.none": "This card already works at every charger.",
  "fleet.copy.title": "Use {name} on other chargers",

  "fleet.detail.identity-mismatch":
    "Stop: the charger that connected is not the make, model or firmware you expected. Check with the installer before going further.",
  "fleet.detail.identity-unchecked": "No expected identity was entered, so it was not compared.",
  "fleet.detail.readiness-blocked":
    "The charger cannot keep cards for offline use as it is set up now. Open offline charging for details.",
  "fleet.detail.restart-required": "The charger must restart before the check can continue.",
  "fleet.detail.sync-rejected":
    "The charger refused the last card list. Try again, or check offline charging.",

  "fleet.feed.activeUntil": "Active until {date}",
  "fleet.feed.create": "Create finance access",
  "fleet.feed.excludes": "Never names, card numbers or sessions with private cards",
  "fleet.feed.includes": "Business charging per charger and month, with anonymous card references",
  "fleet.feed.lede":
    "Lets the reimbursement service read each month's business charging. Access lasts 90 days; renew it here.",
  "fleet.feed.off": "Not set up",
  "fleet.feed.renew": "Renew for 90 days",
  "fleet.feed.renewSoon": "Ends in {days} days",
  "fleet.feed.secretBody":
    "Give this to the reimbursement service. It is shown once; renewing creates a new one and ends this one.",
  "fleet.feed.title": "Reimbursement feed",

  "fleet.lost.body": "The card will be removed from: {stations}.",
  "fleet.lost.confirm": "Remove everywhere",
  "fleet.lost.delay":
    "Each charger keeps accepting the card offline until it receives its new list. Send the lists right after this.",
  "fleet.lost.kept":
    "{stations} keeps this card, because it is that charger's only card. Add another card there first, then remove this one.",
  "fleet.lost.title": "{name} is lost",

  "fleet.notice.classified": "Card classification saved.",
  "fleet.notice.copied.one": "Card added to {count} more charger. Send the card list to finish.",
  "fleet.notice.copied.other":
    "Card added to {count} more chargers. Send the card lists to finish.",
  "fleet.notice.removedEverywhere.one":
    "Card removed from {count} charger. Send the card list to finish.",
  "fleet.notice.removedEverywhere.other":
    "Card removed from {count} chargers. Send the card lists to finish.",
  "fleet.notice.removedKept.one":
    "The card was kept on {count} charger because it is its only card. Add another card there first.",
  "fleet.notice.removedKept.other":
    "The card was kept on {count} chargers because it is their only card. Add another card there first.",
  "fleet.notice.retired": "Charger retired. It can no longer connect.",
  "fleet.notice.syncDone.one": "Card list sent to {count} charger.",
  "fleet.notice.syncDone.other": "Card lists sent to {count} chargers.",
  "fleet.notice.syncSomeFailed":
    "Not every charger accepted its card list: {failed} of {total} refused. Open those chargers for details.",

  "fleet.offboard.button": "Leaves the company",
  "fleet.offboard.company-keeps": "The company keeps the charger",
  "fleet.offboard.company-keepsHint":
    "Remove {name}'s cards and access. Assign the charger to someone else later.",
  "fleet.offboard.done": "Done",
  "fleet.offboard.employee-takes": "{name} takes the charger",
  "fleet.offboard.employee-takesHint":
    "Remove company cards. {name}'s personal cards keep working on their charger while it moves to its new system.",
  "fleet.offboard.keptLast": "Kept on {stations}: it is the only card there.",
  "fleet.offboard.markEmployee": "Mark {station} as owned by the employee",
  "fleet.offboard.money":
    "Reimbursement ends on the leaving date in the reimbursement service; nothing here changes statements.",
  "fleet.offboard.nothing": "Nothing to change.",
  "fleet.offboard.plan": "What will happen",
  "fleet.offboard.question": "What happens to their charger?",
  "fleet.offboard.removeCard": "Remove {name} from {stations}",
  "fleet.offboard.removePersonal": "Also remove their personal cards",
  "fleet.offboard.retireLater":
    "Once the installer has moved the charger to its new system, retire it here so it can no longer connect.",
  "fleet.offboard.retireStation": "Retire {station}",
  "fleet.offboard.revokeAccess": "End the employee page for {station}",
  "fleet.offboard.revoked.one": "{count} link ended",
  "fleet.offboard.revoked.other": "{count} links ended",
  "fleet.offboard.run": "Apply",
  "fleet.offboard.syncNext":
    "Send the new card lists now. Until then, removed cards keep working offline.",
  "fleet.offboard.title": "{name} leaves",
  "fleet.offboard.trimCard": "Remove {name} from {stations} (keep it on their own charger)",
  "fleet.offboard.unassign": "Unassign {station}",

  "fleet.ownership.company": "Company-owned",
  "fleet.ownership.companyHint": "The company bought it. It stays when an employee leaves.",
  "fleet.ownership.companyShort": "Company-owned",
  "fleet.ownership.employee": "Employee-owned",
  "fleet.ownership.employeeHint": "The employee bought it. It goes with them when they leave.",
  "fleet.ownership.employeeShort": "Employee-owned",
  "fleet.ownership.mark.company": "Mark as company-owned",
  "fleet.ownership.mark.employee": "Mark as employee-owned",
  "fleet.ownership.question": "Who owns the charger?",

  "fleet.retire.body":
    "Retiring stops this charger from connecting. Its history stays, and its ID is never reused.",
  "fleet.retire.button": "Retire charger…",
  "fleet.retire.cards":
    "Cards already on the charger keep working there offline. Only do this after the charger was moved to another system or switched off.",
  "fleet.retire.confirm": "Retire charger",
  "fleet.retire.title": "Retire {name}?",
  "fleet.retire.type": "Type {phrase} to confirm",
  "fleet.retired.count.one": "{count} retired charger",
  "fleet.retired.count.other": "{count} retired chargers",
  "fleet.retired.note": "Retired chargers cannot connect. Their history stays in the records.",
  "fleet.retired.on": "retired {date}",

  "fleet.role.driver": "Employee (own charger)",
  "fleet.role.finance": "Finance (reimbursement feed)",
  "fleet.scope.driver": "Their charger, their sessions, and their personal cards.",
  "fleet.scope.finance": "Monthly business charging for every charger. No names or card numbers.",

  "fleet.setup.anyFirmware": "any firmware",
  "fleet.setup.done.body":
    "Every setup step passed on {time}. The charger has its card list and the settings for charging without internet. One real test with the internet unplugged is still the only proof.",
  "fleet.setup.done.title": "Setup complete for {name}",
  "fleet.setup.expected": "Expected: {vendor} {model}, {firmware}",
  "fleet.setup.offlineDetails": "Offline charging details",
  "fleet.setup.otherWays": "Other ways to add a card",
  "fleet.setup.progress": "{done} of {total} steps done",
  "fleet.setup.reissue": "Make a new password",
  "fleet.setup.reissueConfirm":
    "Make a new password for this charger? The old setup sheet stops working.",
  "fleet.setup.reported": "Reported: {vendor} {model}, firmware {firmware}",
  "fleet.setup.state.active": "Ready",
  "fleet.setup.state.in-progress": "Setting up",
  "fleet.setup.state.stopped": "Stopped",
  "fleet.setup.state.waiting-for-charger": "Waiting for the charger",
  "fleet.setup.title": "Set up this charger",

  "fleet.sheet.address": "Server address",
  "fleet.sheet.addressUnknown": "Ask your administrator (CHARGEOS_OCPP_PUBLIC_URL is not set)",
  "fleet.sheet.chargerId": "Charger ID",
  "fleet.sheet.copied": "Copied",
  "fleet.sheet.copy": "Copy",
  "fleet.sheet.done": "Done",
  "fleet.sheet.installer":
    "The installer enters these in the charger's own setup tool. Opening the charger or changing its wiring is installer work with the power off.",
  "fleet.sheet.lede": "Give this to the installer.",
  "fleet.sheet.once":
    "The password is shown only now. chargeOS keeps it to recognise the charger, but cannot show it again.",
  "fleet.sheet.password": "Password",
  "fleet.sheet.protocol": "Protocol",
  "fleet.sheet.protocolValue": "OCPP 1.6 JSON, with this ID as user name",
  "fleet.sheet.title": "Setup sheet for {name}",

  "fleet.step.cards-on-charger.body": "Send the card list so the cards also work without internet.",
  "fleet.step.cards-on-charger.title": "Cards on the charger",
  "fleet.step.cards.body": "Tap the employee's card at the charger to register it.",
  "fleet.step.cards.title": "Card registered",
  "fleet.step.connected.body":
    "Waiting for the charger to connect with its setup sheet. This can take a few minutes after the installer saves the settings.",
  "fleet.step.connected.title": "Charger connected",
  "fleet.step.identity.body":
    "Waiting for the charger to say which make, model and firmware it is.",
  "fleet.step.identity.title": "Right charger",
  "fleet.step.offline-ready.body":
    "Check, and if needed prepare, the charger to keep cards for offline use.",
  "fleet.step.offline-ready.title": "Offline settings checked",
  "fleet.step.test-charge.body":
    "Charge once with the registered card. Setup finishes when that charge is accepted.",
  "fleet.step.test-charge.title": "First charge",
  "usage.privatePart": "of which private: {energy}",
} as const;
