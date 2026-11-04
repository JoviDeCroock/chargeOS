import type { fleetEn } from "./fleet.en.js";

/** Dutch (Belgium) messages for chargers, cards, employee pages, offboarding and the finance feed. */
export const fleetNl: Readonly<Record<keyof typeof fleetEn, string>> = {
  "fleet.sync.state.changed": "Overgeslagen · laadpaal of lijst gewijzigd",
  "fleet.sync.state.failed": "Aanvaarding onbevestigd · controleer de laadpaal",
  "fleet.sync.state.synced": "Laadpaal heeft de lijst aanvaard",
  "fleet.sync.state.no-cards": "Overgeslagen · geen geregistreerde passen",
  "fleet.sync.state.not-ready": "Overgeslagen · controle van instellingen nodig",
  "fleet.sync.state.offline": "Overgeslagen · laadpaal niet verbonden",
  "fleet.sync.state.already-current": "Overgeslagen · huidige lijst al aanvaard",
  "fleet.sync.state.eligible": "Klaar om te versturen",
  "fleet.sync.send.other": "Stuur naar {count} laadpalen",
  "fleet.sync.send.one": "Stuur naar {count} laadpaal",
  "fleet.sync.revision": "Lijstversie {revision}",
  "fleet.sync.changes": "Toevoegingen: {additions} · Verwijderingen: {removals}",
  "fleet.sync.reviewAgain": "Opnieuw bekijken",
  "fleet.sync.retryBody":
    "Het overzicht is niet beschikbaar of is gewijzigd. Controleer de huidige lijsten voordat je opnieuw probeert.",
  "fleet.sync.loading": "Controleren welke laadpalen hun passenlijst kunnen ontvangen…",
  "fleet.sync.resultBody":
    "Bekijk welke laadpalen hun lijst hebben aanvaard en waar nog actie nodig is.",
  "fleet.sync.result": "Resultaten van de synchronisatie",
  "fleet.sync.reviewBody":
    "Elke laadpaal die in aanmerking komt, krijgt zijn eigen volledige passenlijst. Controleer de toevoegingen en verwijderingen voordat je verstuurt.",
  "fleet.sync.review": "Bekijk de synchronisatie",
  "fleet.cards.alsoAccepted": "Passenlijst aanvaard bij {station}",
  "driver.addPersonal": "Persoonlijke laadpas toevoegen",
  "driver.cardCount.one": "{count} laadpas op deze laadpaal.",
  "driver.cardCount.other": "{count} laadpassen op deze laadpaal.",
  "driver.cards": "Laadpassen op je laadpaal",
  "driver.companyCards":
    "Bedrijfslaadpassen worden door je werkgever beheerd. Je eigen persoonlijke laadpassen kun je zelf toevoegen en verwijderen; die worden nooit terugbetaald.",
  "driver.expires": "Deze pagina werkt tot {date}. Vraag daarna een nieuwe link aan je werkgever.",
  "driver.noLink.body":
    "Open de link die je werkgever je stuurde. Er zit een persoonlijke sleutel in, dus hou hem voor jezelf.",
  "driver.noLink.title": "Deze pagina heeft je persoonlijke link nodig",
  "driver.noSessions": "Nog geen laadsessies.",
  "driver.offlineReady":
    "Je laadpaal is ingesteld om je laadpassen ook zonder internet te aanvaarden.",
  "driver.offlineUnknown": "Je werkgever heeft offline laden nog niet nagekeken.",
  "driver.personalNote":
    "Hij wordt toegevoegd als je persoonlijke laadpas. Sessies ermee blijven privé.",
  "driver.recent": "Recent geladen",
  "driver.removeTitle": "Deze persoonlijke laadpas verwijderen?",
  "driver.sessions": "Sessies",
  "driver.state.charging": "Aan het laden",
  "driver.state.offline": "Laadpaal offline",
  "driver.state.ready": "Klaar om te laden",
  "driver.syncBody":
    "Stuur de lijst naar je laadpaal, zodat deze laadpassen ook zonder internet werken.",
  "driver.syncOwner": "Je werkgever stuurt de lijst zodra offline laden is nagekeken.",
  "driver.syncTitle": "Laadpaswijzigingen wachten op je laadpaal",
  "driver.tapNow": "Hou je laadpas nu tegen je laadpaal",
  "driver.yourCharger": "Je laadpaal",

  "fleet.access.button": "Werknemerspagina",
  "fleet.access.can.personal": "Eigen persoonlijke laadpassen toevoegen of verwijderen",
  "fleet.access.can.sessions": "Eigen laadsessies bekijken",
  "fleet.access.can.status": "Zien of hun laadpaal online is en laadt",
  "fleet.access.cannot.company": "Bedrijfslaadpassen of andere laadpalen wijzigen",
  "fleet.access.create": "Link maken",
  "fleet.access.expiry":
    "De link werkt 90 dagen. Je kunt hem altijd stopzetten onder Laadpaalinstellingen, Gedeelde toegang.",
  "fleet.access.lede":
    "Een persoonlijke pagina voor deze werknemer, op gsm of computer. Daarmee kunnen ze:",
  "fleet.access.once": "Deze link wordt één keer getoond. Hij werkt tot {date}.",
  "fleet.access.send":
    "Stuur deze link naar {name}. Iedereen met de link kan de pagina openen, dus stuur hem privé.",
  "fleet.access.station": "Laadpaal",
  "fleet.access.title": "Werknemerspagina voor {name}",

  "fleet.add.button": "Laadpaal toevoegen",
  "fleet.add.chargerId": "Laadpaal-ID",
  "fleet.add.chargerIdHint":
    "Sommige laadpalen hebben een vaste ID, vaak hun serienummer. Vul die hier in; anders kiest chargeOS er een.",
  "fleet.add.chargerIdPlaceholder": "Leeg laten om chargeOS te laten kiezen",
  "fleet.add.checkIdentity": "Nakijken dat de juiste laadpaal verbindt",
  "fleet.add.firmware": "Firmware",
  "fleet.add.firmwareOptional": "Elke versie",
  "fleet.add.lede":
    "chargeOS maakt de laadpaal en een wachtwoord aan. Daarna geef je de installateur een installatieblad.",
  "fleet.add.limit":
    "Deze server aanvaardt hoogstens {limit} laadpaalverbindingen tegelijk. Vraag je beheerder CHARGEOS_OCPP_MAX_CONNECTIONS te verhogen voor deze laadpaal verbindt.",
  "fleet.add.model": "Model",
  "fleet.add.more": "Laadpaal-ID en identiteitscontrole",
  "fleet.add.submit": "Laadpaal aanmaken",
  "fleet.add.title": "Een laadpaal toevoegen",
  "fleet.add.vendor": "Merk",

  "fleet.capture.added": "Laadpas toegevoegd",
  "fleet.capture.addedBody":
    "Hij werkt nu aan deze laadpaal, zolang de laadpaal online is. Stuur de laadpaslijst zodat hij ook zonder internet werkt.",
  "fleet.capture.again": "Opnieuw proberen",
  "fleet.capture.alsoOn": "Deze laadpas werkt al aan: {stations}",
  "fleet.capture.arming": "De laadpaal wordt klaargezet…",
  "fleet.capture.discard": "Weggooien",
  "fleet.capture.expired": "Het registratievenster sloot voor er een laadpas werd aangeboden.",
  "fleet.capture.later": "Later",
  "fleet.capture.needsOnline":
    "De laadpaal moet online zijn om een laadpas te registreren door hem aan te bieden.",
  "fleet.capture.reference": "Referentie",
  "fleet.capture.remaining": "Resterende tijd: {time}",
  "fleet.capture.start": "Laadpas registreren",
  "fleet.capture.tapHint":
    "De laadpaal weigert de laadpas deze keer; dat is normaal. Alleen de eerste aangeboden laadpas telt.",
  "fleet.capture.tapNow": "Hou de laadpas tegen {station}",
  "fleet.capture.tapped": "Laadpas aangeboden om {time}",
  "fleet.capture.title": "Een laadpas registreren aan {station}",

  "fleet.connect.passwordSheet":
    "Het wachtwoord op de installatiefiche van deze laadpaal. Het wordt maar één keer getoond; maak een nieuw aan bij Laadpalen als het kwijt is.",
  "fleet.card.ownership": "Van wie is de laadpas",
  "fleet.card.ownership.company": "Bedrijfslaadpas",
  "fleet.card.ownership.companyHint": "Alleen jij kunt hem wijzigen of verwijderen.",
  "fleet.card.ownership.personal": "Persoonlijke laadpas",
  "fleet.card.ownership.personalHint":
    "De werknemer kan hem verwijderen via de eigen pagina, bijvoorbeeld de laadpas van een partner.",
  "fleet.card.unclassified": "Niet ingedeeld",
  "fleet.card.use": "Laden met deze laadpas is",
  "fleet.card.use.business": "Zakelijk",
  "fleet.card.use.businessHint": "Sessies kunnen terugbetaald worden.",
  "fleet.card.use.private": "Privé",
  "fleet.card.use.privateHint":
    "Sessies worden nooit terugbetaald en nooit naar financiën gestuurd.",

  "fleet.cards.classify": "Bedrijf of persoonlijk…",
  "fleet.cards.copy": "Gebruiken aan andere laadpalen…",
  "fleet.cards.lost": "Laadpas verloren: overal verwijderen",
  "fleet.cards.alsoAt": "Geregistreerd bij {station} · ontvangst onbevestigd",
  "fleet.cards.more": "Meer acties",
  "fleet.cards.removeHere": "Verwijderen van deze laadpaal",
  "fleet.cards.syncAll": "Bekijk synchronisatie",
  "fleet.cards.typeNumber": "Laadpasnummer intypen",

  "fleet.classify.everywhere": "Dit geldt voor dezelfde laadpas aan elke laadpaal.",
  "fleet.classify.title": "{name} indelen",

  "fleet.copy.confirm.one": "Toevoegen aan {count} laadpaal",
  "fleet.copy.confirm.other": "Toevoegen aan {count} laadpalen",
  "fleet.copy.hint":
    "Het laadpasnummer blijft op de server; er wordt niets opnieuw ingetypt. Stuur daarna de laadpaslijsten, zodat de laadpas daar ook offline werkt.",
  "fleet.copy.lede": "Kies de laadpalen waar deze laadpas ook moet werken.",
  "fleet.copy.none": "Deze laadpas werkt al aan elke laadpaal.",
  "fleet.copy.title": "{name} aan andere laadpalen gebruiken",

  "fleet.detail.identity-mismatch":
    "Stop: de laadpaal die verbond is niet het merk, model of de firmware die je verwachtte. Overleg met de installateur voor je verdergaat.",
  "fleet.detail.identity-unchecked": "Niet vergeleken met een verwacht model.",
  "fleet.detail.readiness-blocked":
    "De laadpaal kan in deze instelling geen laadpassen bewaren voor offline gebruik. Open offline laden voor details.",
  "fleet.detail.restart-required": "De laadpaal moet herstarten voor de controle verder kan.",
  "fleet.detail.sync-rejected":
    "De laadpaal weigerde de laatste laadpaslijst. Probeer opnieuw, of kijk offline laden na.",

  "fleet.feed.activeUntil": "Actief tot {date}",
  "fleet.feed.create": "Toegang voor financiën maken",
  "fleet.feed.excludes": "Nooit namen, laadpasnummers of sessies met privélaadpassen",
  "fleet.feed.includes": "Zakelijk laden per laadpaal en maand, met anonieme laadpasreferenties",
  "fleet.feed.lede":
    "Laat de terugbetalingsdienst elke maand het zakelijke laden lezen. De toegang geldt 90 dagen; vernieuw ze hier.",
  "fleet.feed.off": "Niet ingesteld",
  "fleet.feed.renew": "Vernieuwen voor 90 dagen",
  "fleet.feed.renewSoon": "Stopt over {days} dagen",
  "fleet.feed.secretBody":
    "Geef dit aan de terugbetalingsdienst. Het wordt één keer getoond; vernieuwen maakt een nieuwe aan en stopt deze.",
  "fleet.feed.title": "Terugbetalingsfeed",

  "fleet.lost.body": "De laadpas wordt verwijderd van: {stations}.",
  "fleet.lost.confirm": "Overal verwijderen",
  "fleet.lost.delay":
    "Elke laadpaal blijft de laadpas offline aanvaarden tot ze haar nieuwe lijst krijgt. Stuur de lijsten meteen hierna.",
  "fleet.lost.kept":
    "{stations} houdt deze laadpas, omdat het de enige laadpas van die laadpaal is. Voeg daar eerst een andere laadpas toe en verwijder deze daarna.",
  "fleet.lost.title": "{name} is verloren",

  "fleet.notice.classified": "Indeling van de laadpas bewaard.",
  "fleet.notice.copied.one":
    "Laadpas toegevoegd aan nog {count} laadpaal. Stuur de laadpaslijst om af te ronden.",
  "fleet.notice.copied.other":
    "Laadpas toegevoegd aan nog {count} laadpalen. Stuur de laadpaslijsten om af te ronden.",
  "fleet.notice.removedEverywhere.one":
    "Laadpas verwijderd van {count} laadpaal. Stuur de laadpaslijst om af te ronden.",
  "fleet.notice.removedEverywhere.other":
    "Laadpas verwijderd van {count} laadpalen. Stuur de laadpaslijsten om af te ronden.",
  "fleet.notice.removedKept.one":
    "De laadpas bleef op {count} laadpaal omdat het daar de enige laadpas is. Voeg daar eerst een andere laadpas toe.",
  "fleet.notice.removedKept.other":
    "De laadpas bleef op {count} laadpalen omdat het daar de enige laadpas is. Voeg daar eerst een andere laadpas toe.",
  "fleet.notice.retired": "Laadpaal buiten gebruik gesteld. Ze kan niet meer verbinden.",
  "fleet.notice.syncDone.one": "Laadpaslijst gestuurd naar {count} laadpaal.",
  "fleet.notice.syncDone.other": "Laadpaslijsten gestuurd naar {count} laadpalen.",
  "fleet.notice.syncSomeFailed":
    "Niet elke laadpaal aanvaardde zijn laadpaslijst: {failed} van {total} weigerden. Open die laadpalen voor details.",

  "fleet.offboard.button": "Verlaat het bedrijf",
  "fleet.offboard.company-keeps": "Het bedrijf houdt de laadpaal",
  "fleet.offboard.company-keepsHint":
    "Verwijder de laadpassen en toegang van {name}. Wijs de laadpaal later aan iemand anders toe.",
  "fleet.offboard.done": "Klaar",
  "fleet.offboard.employee-takes": "{name} neemt de laadpaal mee",
  "fleet.offboard.employee-takesHint":
    "Verwijder de bedrijfslaadpassen. De persoonlijke laadpassen van {name} blijven werken aan de laadpaal terwijl die naar haar nieuwe systeem verhuist.",
  "fleet.offboard.keptLast": "Behouden op {stations}: het is daar de enige laadpas.",
  "fleet.offboard.markEmployee": "{station} markeren als eigendom van de werknemer",
  "fleet.offboard.money":
    "De terugbetaling stopt op de vertrekdatum in de terugbetalingsdienst; hier verandert niets aan de overzichten.",
  "fleet.offboard.nothing": "Niets te wijzigen.",
  "fleet.offboard.plan": "Wat er gebeurt",
  "fleet.offboard.question": "Wat gebeurt er met hun laadpaal?",
  "fleet.offboard.removeCard": "{name} verwijderen van {stations}",
  "fleet.offboard.removePersonal": "Ook hun persoonlijke laadpassen verwijderen",
  "fleet.offboard.retireLater":
    "Zodra de installateur de laadpaal naar haar nieuwe systeem heeft verhuisd, stel je ze hier buiten gebruik zodat ze niet meer kan verbinden.",
  "fleet.offboard.retireStation": "{station} buiten gebruik stellen",
  "fleet.offboard.revokeAccess": "De werknemerspagina voor {station} stopzetten",
  "fleet.offboard.revoked.one": "{count} link stopgezet",
  "fleet.offboard.revoked.other": "{count} links stopgezet",
  "fleet.offboard.run": "Toepassen",
  "fleet.offboard.syncNext":
    "Stuur nu de nieuwe laadpaslijsten. Tot dan blijven verwijderde laadpassen offline werken.",
  "fleet.offboard.title": "{name} vertrekt",
  "fleet.offboard.trimCard": "{name} verwijderen van {stations} (behouden op hun eigen laadpaal)",
  "fleet.offboard.unassign": "{station} niet langer toewijzen",

  "fleet.ownership.company": "Eigendom van het bedrijf",
  "fleet.ownership.companyHint": "Het bedrijf kocht ze. Ze blijft als een werknemer vertrekt.",
  "fleet.ownership.companyShort": "Van het bedrijf",
  "fleet.ownership.employee": "Eigendom van de werknemer",
  "fleet.ownership.employeeHint": "De werknemer kocht ze. Ze gaat mee als die vertrekt.",
  "fleet.ownership.employeeShort": "Van de werknemer",
  "fleet.ownership.mark.company": "Markeren als eigendom van het bedrijf",
  "fleet.ownership.mark.employee": "Markeren als eigendom van de werknemer",
  "fleet.ownership.question": "Van wie is de laadpaal?",

  "fleet.retire.body":
    "Buiten gebruik stellen belet deze laadpaal te verbinden. De geschiedenis blijft en de ID wordt nooit hergebruikt.",
  "fleet.retire.button": "Buiten gebruik stellen…",
  "fleet.retire.cards":
    "Laadpassen die al op de laadpaal staan, blijven daar offline werken. Doe dit pas nadat de laadpaal naar een ander systeem verhuisd is of uitgeschakeld werd.",
  "fleet.retire.confirm": "Buiten gebruik stellen",
  "fleet.retire.title": "{name} buiten gebruik stellen?",
  "fleet.retire.type": "Typ {phrase} om te bevestigen",
  "fleet.retired.count.one": "{count} laadpaal buiten gebruik",
  "fleet.retired.count.other": "{count} laadpalen buiten gebruik",
  "fleet.retired.note":
    "Laadpalen buiten gebruik kunnen niet verbinden. Hun geschiedenis blijft bewaard.",
  "fleet.retired.on": "buiten gebruik sinds {date}",

  "fleet.role.driver": "Werknemer (eigen laadpaal)",
  "fleet.role.finance": "Financiën (terugbetalingsfeed)",
  "fleet.scope.driver": "Hun laadpaal, hun sessies en hun persoonlijke laadpassen.",
  "fleet.scope.finance":
    "Maandelijks zakelijk laden voor elke laadpaal. Geen namen of laadpasnummers.",

  "fleet.setup.anyFirmware": "elke firmware",
  "fleet.setup.done.body":
    "Alle stappen zijn gelukt op {time}. De laadpaal heeft zijn lijst met laadpassen en de instellingen om zonder internet te laden. Alleen een echte test zonder internet bewijst dat het werkt.",
  "fleet.setup.done.title": "Installatie voltooid voor {name}",
  "fleet.setup.expected": "Verwacht: {vendor} {model}, {firmware}",
  "fleet.setup.otherWays": "Andere manieren om een laadpas toe te voegen",
  "fleet.setup.progress": "Installatie: {done} van {total} stappen klaar",
  "fleet.setup.reissue": "Nieuw wachtwoord maken",
  "fleet.setup.reissueConfirm":
    "Een nieuw wachtwoord maken voor deze laadpaal? Het oude installatieblad werkt dan niet meer.",
  "fleet.setup.reported": "Gemeld: {vendor} {model}, firmware {firmware}",
  "fleet.setup.state.active": "Klaar",
  "fleet.setup.state.in-progress": "Wordt ingesteld",
  "fleet.setup.state.stopped": "Gestopt",
  "fleet.setup.state.waiting-for-charger": "Wacht op de laadpaal",
  "fleet.setup.title": "Deze laadpaal instellen",

  "fleet.sheet.address": "Serveradres",
  "fleet.sheet.addressUnknown":
    "Vraag het aan je beheerder (CHARGEOS_OCPP_PUBLIC_URL is niet ingesteld)",
  "fleet.sheet.chargerId": "Laadpaal-ID",
  "fleet.sheet.copied": "Gekopieerd",
  "fleet.sheet.copy": "Kopiëren",
  "fleet.sheet.done": "Klaar",
  "fleet.sheet.installer":
    "De installateur vult dit in in de eigen instellingstool van de laadpaal. De laadpaal openen of de bedrading wijzigen is werk voor de installateur, met de stroom uit.",
  "fleet.sheet.lede": "Geef dit aan de installateur.",
  "fleet.sheet.once":
    "Het wachtwoord wordt alleen nu getoond. chargeOS bewaart het om de laadpaal te herkennen, maar kan het niet opnieuw tonen.",
  "fleet.sheet.password": "Wachtwoord",
  "fleet.sheet.protocol": "Protocol",
  "fleet.sheet.protocolValue": "OCPP 1.6 JSON, met deze ID als gebruikersnaam",
  "fleet.sheet.title": "Installatieblad voor {name}",

  "fleet.step.cards-on-charger.body":
    "Stuur de laadpaslijst, zodat de laadpassen ook zonder internet werken.",
  "fleet.step.cards-on-charger.title": "Laadpassen op de laadpaal",
  "fleet.step.cards.body": "Houd de laadpas tegen de laadpaal om hem te registreren.",
  "fleet.step.cards.title": "Laadpas geregistreerd",
  "fleet.step.connected.body":
    "Wacht tot de laadpaal verbindt met haar installatieblad. Dat kan enkele minuten duren nadat de installateur de instellingen bewaart.",
  "fleet.step.connected.title": "Laadpaal verbonden",
  "fleet.step.identity.body":
    "Wacht tot de laadpaal meldt welk merk, model en welke firmware ze heeft.",
  "fleet.step.identity.title": "Gegevens van de laadpaal kloppen",
  "fleet.step.offline-ready.body":
    "Leest de offline-instellingen van je laadpaal. Er verandert niets.",
  "fleet.step.offline-ready.title": "Offline instellingen gecontroleerd",
  "fleet.step.test-charge.body":
    "Laad met de laadpaal online één keer met een geregistreerde laadpas. Zo zie je dat de laadpas werkt; testen zonder internet komt daarna.",
  "fleet.step.test-charge.title": "Eén keer geladen met een laadpas",
  "usage.privatePart": "waarvan privé: {energy}",
};
