import type { MessageKey } from "./en.js";
import { fleetNl } from "./fleet.nl.js";

/** Dutch (Belgium) owner-console messages. Keys and placeholders mirror `en.ts`. */
export const nl: Readonly<Record<MessageKey, string>> = {
  "stations.openOverview": "Open overzicht",
  "stations.resolveSetup": "Bekijk het installatieprobleem",
  "stations.connectionHelp": "Open hulp bij verbinden",
  "stations.metric.unknown": "Laadstatus onbekend",
  "offline.fieldGuide": "Open de gids voor de praktijktest",
  "controls.maintenance": "Herstarten en onderhoud",
  "controls.availability": "Beschikbaarheid van de aansluiting",
  "controls.startTarget": "Start op aansluiting {connector}",
  "controls.historyIntro":
    "In de geschiedenis zie je het antwoord van de laadpaal en wat chargeOS daarna heeft waargenomen.",
  "controls.target": "Start een laadbeurt of herstart {name} zonder ernaartoe te gaan.",
  "advanced.englishOnly":
    "Dit onderdeel is voorlopig alleen in het Engels beschikbaar, omdat de veiligheidsteksten eerst nagekeken moeten worden voor ze vertaald worden.",
  "advanced.lede":
    "Technische hulpmiddelen voor je laadpaal: offline-instellingen, bediening op afstand en de gegevens van de laadpaal.",
  "advanced.tabs": "Onderdelen van de laadpaalinstellingen",

  "app.charger": "Laadpaal",
  "app.chargerCount.one": "{count} laadpaal",
  "app.chargerCount.other": "{count} laadpalen",
  "app.connectedCount": "{connected} van {total} verbonden",
  "app.footer": "Open source. Lokaal eerst. Jij houdt de controle.",
  "app.help": "Hulpgidsen",
  "app.lock": "Console vergrendelen",
  "app.opening": "Je console wordt geopend…",
  "app.otherToken": "Ander token gebruiken",
  "app.sections": "Onderdelen van de console",
  "app.skip": "Naar de inhoud",
  "app.snapshot": "Bijgewerkt {date}",
  "app.updated": "Bijgewerkt",

  "attention.authorization-pending": "Laadpassen nog niet naar de laadpaal verzonden",
  "attention.continuity-unproven": "Offline-instellingen niet gecontroleerd",
  "attention.evidence-conflict": "Tegenstrijdige sessiegegevens",
  "attention.migration-action": "Overstapstap open",
  "attention.offline": "Offline",
  "attention.no-cards": "Nog geen laadpas",

  "board.freedomDetail": "Test met getuige aan de laadpaal",
  "board.sharingActive.one": "{count} persoon heeft leestoegang",
  "board.sharingActive.other": "{count} personen hebben leestoegang",
  "board.sharingDetail": "Tijdelijke toegang, alleen lezen",
  "board.sharingNone": "Niemand anders heeft toegang",
  "board.switchingDetail": "Overstappen van een vorige aanbieder",
  "board.title": "In één oogopslag",

  "cards.add": "Laadpas toevoegen",
  "cards.addHint":
    "De laadpas werkt aan de laadpaal zodra de laadpaal de nieuwe lijst met laadpassen aanvaardt. Tot dan wacht hij hier.",
  "cards.addTitle": "Laadpas toevoegen aan {station}",
  "cards.adding": "Bezig met toevoegen…",
  "cards.count.one": "{count} laadpas",
  "cards.count.other": "{count} laadpassen",
  "cards.editTitle": "Laadpas bewerken",
  "cards.field.holder": "Wie gebruikt hem",
  "cards.field.name": "Naam van de laadpas",
  "cards.field.namePlaceholder": "Bijvoorbeeld: blauwe sleutelhanger",
  "cards.field.newPerson": "Iemand nieuw…",
  "cards.field.number": "Pasnummer",
  "cards.field.numberHint":
    "De waarde die de laadpaal van de pas leest. Dat is vaak niet het nummer dat erop gedrukt staat; de pas tegen de laadpaal houden is daarom makkelijker. chargeOS bewaart ze alleen op deze server en toont ze nooit opnieuw.",
  "cards.field.reference": "Referentie van de laadpas:",
  "cards.first.body":
    "Nog geen enkele pas kan hier laden: chargeOS weigert elke pas tot je er een toevoegt. Houd je eigen pas tegen de laadpaal om ze toe te voegen.",
  "cards.first.title": "Voeg je eerste pas toe",

  "cards.keepOne": "Je kunt de laatste geregistreerde laadpas niet verwijderen.",
  "cards.lede": "Laadpassen en sleutelhangers die voor {station} geregistreerd zijn.",
  "cards.onCharger": "Op de laadpaal",
  "cards.privacy":
    "Namen worden alleen in deze console getoond. Exports, gedeelde toegang en AI-hulp gebruiken anonieme referenties.",
  "cards.removeAcknowledge":
    "Ik begrijp dat deze laadpas aan de laadpaal kan blijven werken tot de laadpaal de nieuwe lijst aanvaardt.",
  "cards.removeBody":
    "De laadpas wordt meteen uit de lijst gehaald. De laadpaal zelf vergeet hem pas wanneer hij de nieuwe lijst aanvaardt, dus stuur de lijst daarna door.",
  "cards.removeConfirm": "Laadpas verwijderen",
  "cards.removeTitle": "{name} verwijderen?",
  "cards.staleBody":
    "De laadpaal heeft de nieuwe lijst nog niet ontvangen. Tijdens een internetstoring kan hij ze nog aanvaarden. Stuur de lijst naar de laadpaal om het verwijderen af te ronden.",
  "cards.staleTitle.one": "{count} verwijderde laadpas kan nog werken aan de laadpaal",
  "cards.staleTitle.other": "{count} verwijderde laadpassen kunnen nog werken aan de laadpaal",
  "cards.sync.checkFirst":
    "Ze werken al zolang de laadpaal online is. Om ze ook zonder internet te laten werken, controleer je eerst de offline-instellingen van de laadpaal.",
  "cards.sync.confirm":
    "De lijst met laadpassen op de laadpaal vervangen door de laadpassen die hier staan?",
  "cards.sync.current": "Alle laadpassen staan op de laadpaal",
  "cards.sync.currentLong": "De laadpaal heeft de huidige lijst aanvaard",
  "cards.sync.never": "Laadpassen nog niet verstuurd",
  "cards.sync.neverLong": "De laadpaal heeft de ontvangst van een passenlijst nog niet bevestigd.",
  "cards.sync.offline":
    "De laadpaal is niet verbonden. Je kunt de lijst versturen zodra de verbinding terug is.",
  "cards.sync.openOffline": "Offline-instellingen controleren",
  "cards.sync.pending": "Wijzigingen wachten op de laadpaal",
  "cards.sync.pendingLong.one": "{count} wijziging wacht om naar de laadpaal verstuurd te worden",
  "cards.sync.pendingLong.other":
    "{count} wijzigingen wachten om naar de laadpaal verstuurd te worden",
  "cards.sync.readyHint": "Stuur de lijst zodat de laadpaal precies deze laadpassen kent.",
  "cards.sync.send": "Naar laadpaal sturen",
  "cards.sync.sending": "Bezig met versturen…",
  "cards.tap.add": "Deze pas toevoegen",
  "cards.tap.again": "Opnieuw luisteren",
  "cards.tap.captured": "Pas gevonden",
  "cards.tap.capturedBody":
    "Er werd om {time} een pas aangeboden (referentie {reference}). De laadpaal weigerde ze deze keer, zoals verwacht. Voeg ze toe en ze werkt hier voortaan.",
  "cards.tap.expired":
    "Er kwam geen pas bij chargeOS aan. Controleer of de laadpaal verbonden is en luister opnieuw, of typ het pasnummer.",
  "cards.tap.intro":
    "Houd je pas tegen de laadpaal en chargeOS voegt ze toe, zodat je het nummer nooit hoeft te kennen. De laadpaal weigert die ene keer; dat is normaal.",
  "cards.tap.known": "Die pas hoort al bij deze laadpaal. Er is niets veranderd.",
  "cards.tap.listening": "Houd je pas nu tegen de laadpaal",
  "cards.tap.listeningBody":
    "Houd één pas tegen de paslezer van de laadpaal. Alleen deze laadpaal luistert, en maar even.",
  "cards.tap.offline":
    "De laadpaal is offline. chargeOS ziet een pas alleen als de laadpaal verbonden is.",
  "cards.tap.several":
    "Er werden verschillende passen aangeboden, dus er is geen enkele toegevoegd. Luister opnieuw en bied alleen je eigen pas aan.",
  "cards.tap.start": "Pas aanbieden aan de laadpaal",
  "cards.tap.typeInstead": "Pasnummer typen",
  "cards.tap.until": "Luistert tot {time}.",

  "cards.title": "Laadpassen",
  "cards.unnamed": "Laadpas zonder naam",
  "cards.unnamedShort": "Laadpas zonder naam · {id}",
  "cards.waiting": "Nog niet naar de laadpaal gestuurd",

  "command.message.accepted":
    "{name}: de laadpaal zei ja. Kijk hieronder wat er daarna gebeurde; een ja alleen is geen bewijs.",
  "command.message.failed":
    "{name}: niet uitgevoerd ({status}). Deze laadpaal ondersteunt het misschien niet.",
  "command.message.pending": "{name}: verstuurd, wachten op de laadpaal.",
  "command.message.rejected": "{name}: de laadpaal zei nee ({status}). Er is niets veranderd.",
  "command.message.uncertain":
    "{name}: geen duidelijk antwoord ({status}). De laadpaal heeft het misschien uitgevoerd; controleer hem voor je het opnieuw probeert.",
  "command.state.accepted": "aanvaard",
  "command.state.failed": "mislukt",
  "command.state.pending": "wachten",
  "command.state.rejected": "geweigerd",
  "command.state.uncertain": "onzeker",
  "command.type.ChangeAvailability": "Beschikbaar maken",
  "command.type.RemoteStartTransaction": "Op afstand starten",
  "command.type.RemoteStopTransaction": "Op afstand stoppen",
  "command.type.Reset": "Herstarten",
  "command.type.UnlockConnector": "Kabel ontgrendelen",

  "common.cancel": "Annuleren",
  "common.close": "Sluiten",
  "common.edit": "Bewerken",
  "common.remove": "Verwijderen",
  "common.save": "Opslaan",
  "common.typePhrase": "Typ deze exacte zin om te bevestigen",

  "connect.address": "Adres voor de laadpaal",
  "connect.addressUnknown":
    "Het laadpaaladres uit je installatie (START-HERE.txt), gevolgd door de naam van de laadpaal",
  "connect.alias.accept": "{presented} gebruiken",
  "connect.alias.accepting": "Bewaren…",
  "connect.alias.offer":
    "Of laat de laadpaal zoals ze is: chargeOS kan {presented} aanvaarden als naam van deze laadpaal, omdat de laadpaal bewees dat ze het wachtwoord van deze laadpaal kent. De laadpaal maakt dan bij de volgende poging verbinding.",

  "connect.awaitingBootBody":
    "De laadpaal is verbonden. Wachten op het eerste opstartbericht, waarmee chargeOS het model en de firmware leert kennen. Dat duurt meestal minder dan een minuut.",
  "connect.identity": "Naam van de laadpaal (identiteit)",
  "connect.identityHint":
    "Neem de naam van de laadpaal exact over, ook hoofdletters. Sommige configuratietools vragen het adres en de naam apart; dan eindigt het adres met een schuine streep.",
  "connect.identityWithAlias": "{id}, of {alias} (de naam die je laadpaal al gebruikt)",

  "connect.installerNote":
    "Je installateur vult de verbindingsinstellingen in via de eigen configuratietool van de laadpaal. chargeOS wijzigt die verbindingsinstellingen nooit zelf.",
  "connect.intro":
    "Vul deze instellingen in via de configuratietool van je laadpaal. Deze pagina werkt zichzelf bij zodra de laadpaal verbinding maakt.",
  "connect.password": "Wachtwoord",
  "connect.passwordWhere":
    "Het laadpaalwachtwoord (stationSecret) in credentials.json van je installatie. Het wordt hier nooit getoond.",
  "connect.protocol": "Protocol",
  "connect.protocolValue": "OCPP 1.6 JSON (soms OCPP-J genoemd)",
  "connect.refused.anyDevice":
    "Elk toestel dat deze laadpaalnaam gebruikt, kan dit bericht veroorzaken. Het verklaart dus de laatste poging, maar bewijst niet waar die vandaan kwam.",

  "connect.refused.duplicate": "Er is al een verbinding open met deze laadpaalnaam",
  "connect.refused.duplicateFix":
    "Wacht een paar minuten en laat de laadpaal opnieuw proberen. Blijft het gebeuren, controleer dan dat geen ander toestel de naam {expected} gebruikt.",
  "connect.refused.identity": "Je laadpaal gebruikte een andere naam",
  "connect.refused.identityBody":
    "Ze stuurde het wachtwoord van deze laadpaal, maar noemde zich {presented}. chargeOS verwacht {expected}.",
  "connect.refused.identityFix":
    "Wijzig de naam van de laadpaal in de configuratietool naar {expected}.",
  "connect.refused.identityUnprintable":
    "Ze stuurde het wachtwoord van deze laadpaal, maar met een naam die chargeOS niet kan gebruiken. chargeOS verwacht {expected}.",
  "connect.refused.noPassword": "Je laadpaal maakte verbinding zonder wachtwoord",
  "connect.refused.noPasswordFix":
    "Kies in de configuratietool de beveiligingsinstelling die een wachtwoord meestuurt (Basic-authenticatie) en vul het laadpaalwachtwoord in. Vraagt de tool een gebruikersnaam, gebruik dan {expected}.",
  "connect.refused.protocol": "Je laadpaal gebruikt geen OCPP 1.6 JSON",
  "connect.refused.protocolBody": "Ze bood {offered} aan.",
  "connect.refused.protocolFix":
    "Kies OCPP 1.6 met JSON in de configuratietool. chargeOS ondersteunt nog geen andere versies.",
  "connect.refused.when": "Laatste poging om {time}.",
  "connect.refused.wrongPassword": "Je laadpaal stuurde een verkeerd wachtwoord",
  "connect.refused.wrongPasswordFix":
    "Kopieer het wachtwoord opnieuw uit credentials.json (stationSecret). Gebruik het volledig en kort het niet in. Kan de tool het niet opslaan, stop dan en vraag het je installateur.",
  "connect.security": "Beveiliging",
  "connect.securityValue": "De instelling die een wachtwoord meestuurt (Basic-authenticatie)",
  "connect.state.awaitingBoot": "Verbonden, even wachten",
  "connect.state.connected": "Verbonden",
  "connect.state.waiting": "Wachten op de laadpaal",
  "connect.title": "Verbind je laadpaal",
  "connect.unmatched.one":
    "{count} verbindingspoging gebruikte een onbekende laadpaalnaam en een onbekend wachtwoord (laatste om {time}). Was dat je laadpaal, controleer dan beide.",
  "connect.unmatched.other":
    "{count} verbindingspogingen gebruikten een onbekende laadpaalnaam en een onbekend wachtwoord (laatste om {time}). Was een ervan je laadpaal, controleer dan beide.",

  "connector.Available": "Beschikbaar",
  "connector.Charging": "Aan het laden",
  "connector.Faulted": "Storing",
  "connector.Finishing": "Bezig met afronden",
  "connector.Preparing": "Wordt klaargemaakt",
  "connector.Reserved": "Gereserveerd",
  "connector.SuspendedEV": "Gepauzeerd door de auto",
  "connector.SuspendedEVSE": "Gepauzeerd door de laadpaal",
  "connector.Unavailable": "Niet beschikbaar",

  "controls.card": "Laadpas",
  "controls.col.answer": "Antwoord van de laadpaal",
  "controls.col.command": "Opdracht",
  "controls.col.observed": "Wat er daarna gebeurde",
  "controls.col.requested": "Verstuurd",
  "controls.connector": "Aansluiting",
  "controls.hard": "Hard (onmiddellijk)",
  "controls.history": "Geschiedenis van opdrachten",
  "controls.historyEmpty": "Nog geen opdrachten op afstand verstuurd.",
  "controls.intro":
    "Alleen jij kunt deze versturen, en alleen terwijl de laadpaal verbonden is. Een laadpaal kan ja zeggen en het toch niet doen, dus elke opdracht toont het antwoord en wat er daarna echt gebeurde. chargeOS schakelt een laadpaal nooit uit, omdat een laadpaal dat onthoudt, ook als chargeOS verdwijnt.",
  "controls.makeAvailable": "Aansluiting {connector} beschikbaar maken",
  "controls.noSession": "Er wordt niet geladen.",
  "controls.notObserved": "Nog niet gezien",
  "controls.offline": "De laadpaal is offline, dus opdrachten op afstand zijn niet beschikbaar.",
  "controls.restart": "Herstarten",
  "controls.restartTitle": "Laadpaal herstarten",
  "controls.restartType": "Soort herstart",
  "controls.soft": "Zacht (rondt het laden eerst netjes af)",
  "controls.start": "Op afstand starten",
  "controls.startTitle": "Laden starten",
  "controls.stopSession": "Sessie #{id} stoppen (aansluiting {connector})",
  "controls.stopTitle": "Laden stoppen",
  "controls.title": "Bediening op afstand",
  "controls.unlock": "Ontgrendelen",
  "controls.unlockHint": "Maakt de kabel los. Doe dit alleen als je bij de laadpaal staat.",
  "controls.unlockTitle": "Kabel ontgrendelen op aansluiting {connector}",

  "details.chargePointId": "Laadpunt-ID",
  "details.firmware": "Firmware",
  "details.namesNote":
    "Naam, locatie en persoon zijn alleen labels in deze console. De laadpaal zelf wordt herkend aan zijn laadpunt-ID.",
  "details.title": "Gegevens van de laadpaal",

  "directory.readOnly":
    "Opgeslagen namen konden niet gelezen worden, dus bewerken staat uit om ze te beschermen. Vraag je beheerder om directory.json na te kijken. Laden werkt gewoon.",
  "directory.unavailable":
    "Namen zijn niet beschikbaar op deze serverversie. Laden en laadpassen werken zoals gewoonlijk.",

  "evidence.carried": "overgenomen uit een bewaarde back-up",
  "evidence.empty": "Nog geen registraties.",
  "evidence.export": "Deelbare registratie downloaden",
  "evidence.exporting": "Bezig met voorbereiden…",
  "evidence.fromCharger": "Van de laadpaal",
  "evidence.latest": "Laatste registraties",
  "evidence.lede":
    "De fraudebestendige registratie die chargeOS voor deze laadpaal bijhoudt. De download laat geheimen en pasnummers weg en is geen back-up.",
  "evidence.system": "chargeOS",
  "evidence.toCharger": "Naar de laadpaal",

  "module.assist.description":
    "Vraag je eigen AI-dienst om tips bij problemen. Hij kan niets veranderen.",
  "module.assist.label": "AI-hulp",
  "module.evidence.description": "Bekijk en download wat chargeOS over je laadpaal registreerde.",
  "module.evidence.label": "Registraties",
  "module.liberation.description":
    "Haal een laadpaal stap voor stap weg bij zijn vorige aanbieder.",
  "module.liberation.label": "Overstappen van aanbieder",
  "module.sharing.description":
    "Geef een installateur, werkgever of energieleverancier tijdelijk alleen-lezen toegang.",
  "module.sharing.label": "Gedeelde toegang",

  "nav.advanced": "Laadpaalinstellingen",
  "nav.cards": "Laadpassen",
  "nav.hint.attention": "vraagt aandacht",
  "nav.hint.cardsWaiting": "laadpassen wachten om verstuurd te worden",
  "nav.overview": "Overzicht",
  "nav.people": "Personen",
  "nav.preferences": "Voorkeuren",
  "nav.stations": "Laadpalen",
  "nav.usage": "Verbruik",

  "notice.cardAdded":
    "Laadpas toegevoegd. Stuur de lijst naar de laadpaal zodat hij ook zonder internet werkt.",
  "notice.cardAddedUnnamed":
    "Laadpas toegevoegd, maar de naam kon niet opgeslagen worden. Bewerk de laadpas om het opnieuw te proberen.",
  "notice.cardRemoved":
    "Laadpas uit de lijst gehaald. Hij kan aan de laadpaal blijven werken tot de laadpaal de nieuwe lijst aanvaardt.",
  "notice.cardSaved": "Laadpas opgeslagen.",
  "notice.delegateIssued": "Toegang aangemaakt. Kopieer het geheim nu; het wordt niet bewaard.",
  "notice.delegateRevoked":
    "Toegang ingetrokken. Je eigen laadpassen en laden worden niet beïnvloed.",
  "notice.evidenceExported": "Registratie gedownload. Geheimen en pasnummers zijn weggelaten.",
  "notice.failed": "Dat is niet gelukt. Probeer het opnieuw.",
  "notice.identityAliasAccepted":
    "Naam aanvaard. De laadpaal maakt bij de volgende poging verbinding; deze pagina werkt zichzelf bij.",

  "notice.inspectBlocked":
    "De laadpaal mist minstens één instelling die nodig is om offline te laden.",
  "notice.inspectReady":
    "De laadpaal heeft alle instellingen om offline te laden. Een echte test aan de laadpaal blijft het enige bewijs.",
  "notice.personAdded": "Persoon toegevoegd.",
  "notice.personRemoved":
    "Persoon verwijderd. Hun laadpalen en laadpassen hebben nu niemand toegewezen.",
  "notice.personSaved": "Naam opgeslagen.",
  "notice.preparedChanged":
    "Offline-instellingen gewijzigd op de laadpaal: {count}. Stuur nu de lijst met laadpassen.",
  "notice.preparedUnchanged":
    "De offline-instellingen stonden al goed. Stuur nu de lijst met laadpassen.",
  "notice.stationSaved": "Laadpaal opgeslagen.",
  "notice.synced": "De laadpaal heeft de lijst met laadpassen aanvaard (versie {revision}).",

  "offline.blockedText":
    "Minstens één instelling om offline te laden ontbreekt of is fout. Open de laadpaalinstellingen om het op te lossen.",
  "offline.blockedTitle": "Er moet iets opgelost worden",
  "offline.check": "Offline-instellingen controleren",
  "offline.checkAgain": "Opnieuw controleren",
  "offline.checking": "Bezig met controleren…",
  "offline.checksLabel": "Controles voor offline laden",
  "offline.checksPass": "controles in orde",
  "offline.connectFirst": "Verbind eerst de laadpaal en controleer hem dan.",
  "offline.details": "Details",
  "offline.explain":
    "chargeOS vraagt de laadpaal welke instellingen hij heeft. Controleren leest alleen; er verandert niets.",
  "offline.kicker": "Laden zonder internet",
  "offline.lastAttempt": "Laatste poging",
  "offline.lastChecked": "Laatst gecontroleerd {date}",
  "offline.lastRevision": "Versie van de lijst op de laadpaal",
  "offline.lastSync": "Laatst verstuurd",
  "offline.notChecked": "niet gecontroleerd",
  "offline.physicalTest":
    "Doe toch één keer een echte test: koppel het internet los en laad met je laadpas.",
  "offline.physicalWork":
    "Het serveradres, de firmware of de bedrading van de laadpaal wijzig je hier niet. Dat is werk voor een installateur.",
  "offline.prepare": "Offline-instellingen wijzigen",
  "offline.prepareText":
    "Vraagt de laadpaal om een lokale lijst met laadpassen bij te houden, die laadpassen zonder internet te aanvaarden en onbekende laadpassen te weigeren. Verder verandert er niets en de laadpaal wordt niet herstart.",
  "offline.prepareTitle": "Offline laden inschakelen",
  "offline.preparing": "Bezig met wijzigen…",
  "offline.readyText":
    "De laadpaal meldde alle instellingen die hij nodig heeft om je laadpassen zelfstandig te aanvaarden.",
  "offline.readyTitle": "Instellingen goedgekeurd bij controle",
  "offline.sendLocked": "Beschikbaar zodra alle controles in orde zijn.",
  "offline.sendText":
    "Vervangt de passenlijst op de laadpaal door de passen in deze console. Een aanvaarde lijst bevestigt de ontvangst. Test aan de laadpaal hoe die offline werkt.",
  "offline.sendTitle": "Laadpassen naar de laadpaal sturen",
  "offline.unanswered": "Wachten op antwoord van de laadpaal",
  "offline.unknownText":
    "Controleer of de laadpaal je laadpassen kan aanvaarden als het internet wegvalt. Controleren leest alleen instellingen.",
  "offline.unknownTitle": "Controleer de instellingen voor offline laden",

  "overview.cardDetails": "Bekijk laadpassen",
  "overview.cardListWaiting":
    "De laadpaal heeft nog niet geantwoord op een update van de passenlijst.",
  "overview.cardsOnCharger": "Laadpassen",
  "overview.cardsRegistered.one": "{count} laadpas geregistreerd in chargeOS",
  "overview.cardsRegistered.other": "{count} laadpassen geregistreerd in chargeOS",
  "overview.chargingNow": "Laden op dit moment",
  "overview.chargedSoFar": "{energy} tot nu toe, volgens de meterstand van de laadpaal om {date}",
  "overview.chargingSince": "Gestart {date}",
  "overview.noMeterReading": "Wachten op de eerste meterstand van de laadpaal",
  "overview.chargingOn": "Aansluiting {connector} meldt dat er geladen wordt",
  "overview.chargingUnknown": "Onbekend",
  "overview.connectFirst":
    "chargeOS wacht op een verbinding met de laadpaal. Stap je over naar een andere aanbieder? Laat je huidige dienst aangesloten terwijl jij en je installateur het exacte model en de firmware controleren, de instellingen opslaan en voorbereiden hoe je terug kunt.",
  "overview.connectionGuide": "Open de verbindingsgids",
  "overview.fieldFailed": "De praktijktest bevat een mislukte controle",
  "overview.fieldReview": "Resultaten van de praktijktest vastgelegd. Beoordeling volgt.",
  "overview.fieldStale": "Eerdere resultaten van de praktijktest zijn niet meer geldig",
  "overview.fieldUnverified": "Niet geverifieerd",
  "overview.installerSettings": "Verbindingsinstellingen voor je installateur",
  "overview.lastCardList": "Laatst aanvaarde lijst: {date}",
  "overview.lastChargingReport": "Gemeld door de laadpaal om {date}",
  "overview.listAccepted": "De laadpaal heeft de huidige lijst aanvaard",
  "overview.noCards": "Geen passen geregistreerd in chargeOS",
  "overview.notCharging": "Laadt niet",
  "overview.notConnected": "Niet verbonden",
  "overview.offlineDetails": "Bekijk de instellingen voor offline laden",
  "overview.reconnect":
    "chargeOS is de verbinding met de laadpaal kwijt. Controleer de verbinding voordat je instellingen wijzigt.",
  "overview.refresh": "Vernieuw status",
  "overview.refreshing": "Vernieuwen…",
  "overview.settingsBlocked": "De controle van de instellingen heeft een probleem gevonden.",
  "overview.settingsPassed":
    "De instellingen zijn gecontroleerd. Alleen een test aan de laadpaal toont wat er offline gebeurt.",
  "overview.settingsUnchecked": "Instellingen nog niet gecontroleerd.",
  "overview.statusTitle": "Wat chargeOS weet",
  "overview.statusUnavailable":
    "De console kon niet vernieuwen. De actuele laadstatus is niet beschikbaar.",
  "overview.waitingForStatus": "Geen actuele status van de laadpaal.",
  "overview.stop": "Laden stoppen",
  "overview.stopBody":
    "Bij een overstapstap werd een probleem geregistreerd. Laat alles zoals het is en los het op voor je verdergaat.",
  "overview.stopLink": "Overstappen openen",
  "overview.stopTitle": "Stop: er werd een probleem geregistreerd",

  "people.add": "Persoon toevoegen",
  "people.addCompany": "Werknemer toevoegen",
  "people.empty":
    "Optioneel. Voeg de mensen toe die hier laden om te zien wiens laadpas elke laadbeurt startte.",
  "people.emptyCompany":
    "Nog geen werknemers. Voeg een werknemer toe en wijs daarna hun laadpaal en laadpassen toe.",
  "people.field.name": "Naam",
  "people.lede": "De mensen die hier laden, met hun laadpalen en laadpassen.",
  "people.ledeCompany":
    "Je werknemers, de laadpaal bij hen thuis en de laadpassen die ze gebruiken. Het verbruik wordt per werknemer gerapporteerd.",
  "people.noCards": "Geen laadpassen",
  "people.noStation": "Geen laadpaal",
  "people.nobody": "Niet toegewezen",
  "people.privacy":
    "Namen blijven op deze server en worden alleen in deze console getoond. Ze zitten niet in exports, gedeelde toegang, AI-hulp of versleutelde back-ups.",
  "people.removeBody":
    "Hun laadpalen en laadpassen blijven zoals ze zijn, maar hebben geen naam meer. Laden wordt niet beïnvloed.",
  "people.removeTitle": "{name} verwijderen?",
  "people.rename": "Naam wijzigen",
  "people.renameTitle": "Naam wijzigen",
  "people.stationCount.one": "{count} laadpaal",
  "people.stationCount.other": "{count} laadpalen",
  "people.stations": "Laadpalen",
  "people.title": "Personen",
  "people.titleCompany": "Werknemers",

  "prefs.company": "Bedrijf",
  "prefs.companyText":
    "Ingesteld voor een organisatie die laadpalen beheert voor haar werknemers: het verbruik wordt per werknemer gerapporteerd en kan gedownload worden.",
  "prefs.language": "Taal",
  "prefs.languageNote": "De hulpgidsen en sommige geavanceerde onderdelen zijn in het Engels.",
  "prefs.lede":
    "Kies je taal en welke onderdelen je ziet. Je keuzes gelden alleen in deze browser.",
  "prefs.modules": "Extra onderdelen",
  "prefs.modulesCustom": "Je eigen keuze in deze browser wordt gebruikt.",
  "prefs.modulesDefault": "Vink een onderdeel aan om het toe te voegen.",
  "prefs.modulesNote":
    "Laadpassen, offline laden en registraties blijven werken. Een verborgen onderdeel verschijnt alleen weer zolang het je aandacht nodig heeft, zoals actieve gedeelde toegang of een onafgeronde overstap, en je keuze blijft bewaard.",
  "prefs.onByDefault": "Standaard aan.",
  "prefs.personal": "Persoonlijk",
  "prefs.personalText":
    "Ingesteld voor iemand met een eigen laadpaal: het overzicht toont je laadpaal en hoeveel je laadt.",
  "prefs.profile": "Profiel",
  "prefs.profileNote":
    "Wie chargeOS installeerde, kiest het profiel. Vraag het hen als het moet veranderen.",
  "prefs.title": "Voorkeuren",
  "prefs.useDefaults": "Standaard van het profiel gebruiken",

  "sessions.soFar": "tot nu toe",
  "sessions.active": "aan het laden",
  "sessions.card": "Laadpas",
  "sessions.cardRefused": "laadpas geweigerd",
  "sessions.complete": "Afgerond",
  "sessions.conflict": "tegenstrijdige gegevens",
  "sessions.connector": "Aansluiting",
  "sessions.empty": "Nog geen laadsessies.",
  "sessions.energy": "Energie",
  "sessions.number": "Sessie",
  "sessions.retries.one": "{count} herhaald bericht",
  "sessions.retries.other": "{count} herhaalde berichten",
  "sessions.started": "Gestart",
  "sessions.status": "Status",

  "sharing.canRead": "Kan zien",
  "sharing.copyNow": "Kopieer dit geheim nu",
  "sharing.copyNowBody":
    "Stuur het privé naar die ene persoon. chargeOS kan het niet opnieuw tonen zodra je het sluit.",
  "sharing.current": "Wie heeft toegang",
  "sharing.day": "{count} dag",
  "sharing.days": "{count} dagen",
  "sharing.dismiss": "Ik heb het gekopieerd",
  "sharing.expires": "Vervalt na",
  "sharing.expiresOn": "Vervalt {date}",
  "sharing.issue": "Toegang aanmaken",
  "sharing.issueTitle": "Tijdelijke leestoegang geven",
  "sharing.issuing": "Bezig met aanmaken…",
  "sharing.lede":
    "Geef iemand tijdelijke toegang om deze laadpaal te bekijken. Ze kunnen laadpassen, instellingen of de laadpaal niet wijzigen, en je kunt de toegang altijd intrekken.",
  "sharing.none": "Niemand anders heeft toegang.",
  "sharing.revoke": "Intrekken",
  "sharing.revokeConfirm": "Deze toegang nu intrekken?",
  "sharing.role": "Voor wie",
  "sharing.role.employer": "Werkgever (terugbetaling)",
  "sharing.role.energy": "Energieleverancier",
  "sharing.role.installer": "Installateur",
  "sharing.scope.employer": "Alleen sessietijden en energie. Geen identiteit van laadpassen.",
  "sharing.scope.energy": "Alleen de status van de laadpaal en aansluitingen.",
  "sharing.scope.installer":
    "Status van de laadpaal, diagnose, het overstapdossier en niet-nagekeken resultaten van de Freedom Test.",
  "sharing.status.active": "actief",
  "sharing.status.expired": "vervallen",
  "sharing.status.revoked": "ingetrokken",

  "signin.body":
    "Meld je aan om je laadpaal te bekijken en te beheren. Het token blijft alleen in dit browsertabblad.",
  "signin.help": "Installatie- en hulpgidsen",
  "signin.open": "Console openen",
  "signin.title": "Je chargeOS-console",
  "signin.token": "Eigenaarstoken",

  "station.awaitingBoot": "Wachten tot de laadpaal zich meldt",
  "station.connected": "Verbonden",
  "station.connectedSince": "Verbonden sinds",
  "station.connector": "Aansluiting {id}",
  "station.hardware": "Model",
  "station.noConnectors": "Nog geen status van de aansluitingen ontvangen.",
  "station.offline": "Offline",
  "station.title": "Laadpaal",

  "stations.attention": "Vraagt aandacht",
  "stations.available": "Beschikbaar",
  "stations.chargingNow": "Laden gemeld",
  "stations.driver": "Persoon",
  "stations.edit": "Namen bewerken",
  "stations.editTitle": "Laadpaal bewerken",
  "stations.energy": "Energie, totaal",
  "stations.field.driver": "Persoon",
  "stations.field.driverHint":
    "Het verbruik op deze laadpaal wordt onder deze persoon gerapporteerd.",
  "stations.field.id": "Laadpunt-ID (kan hier niet gewijzigd worden):",
  "stations.field.name": "Naam",
  "stations.field.namePlaceholder": "Bijvoorbeeld: Oprit",
  "stations.field.site": "Locatie",
  "stations.field.sitePlaceholder": "Bijvoorbeeld: Thuis of kantoor Brussel",
  "stations.independence":
    "Elke laadpaal heeft zijn eigen passenlijst. Test offline laden aan elke laadpaal.",
  "stations.lastSession": "Laatste sessie",
  "stations.lede": "Bekijk per laadpaal de verbinding, de laatste laadbeurt en de volgende stap.",
  "stations.metric.chargers": "Laadpalen",
  "stations.metric.charging": "Laden gemeld",
  "stations.metric.connected": "Verbonden",
  "stations.metric.energy": "Geregistreerde energie",
  "stations.offline": "Offline",
  "stations.open": "Openen",
  "stations.summary": "Samenvatting",
  "stations.title": "Laadpalen",

  "status.connected": "Laadpaal verbonden",
  "status.offline": "Laadpaal offline",

  "tab.assist": "AI-hulp",
  "tab.controls": "Bediening op afstand",
  "tab.details": "Gegevens",
  "tab.evidence": "Registraties",
  "tab.freedom": "Freedom Test",
  "tab.offline": "Offline laden",
  "tab.sessions": "Sessies",
  "tab.sharing": "Gedeelde toegang",
  "tab.switching": "Overstappen",

  "usage.byCard": "Deze maand per laadpas",
  "usage.byCharger": "Verbruik per laadpaal",
  "usage.byDriver": "Verbruik per persoon",
  "usage.chargers": "Laadpalen",
  "usage.chartTitle": "Energie per maand, kWh",
  "usage.col.charger": "Laadpaal",
  "usage.col.driver": "Persoon",
  "usage.col.energy": "Energie",
  "usage.col.month": "Maand",
  "usage.col.sessions": "Sessies",
  "usage.col.site": "Locatie",
  "usage.conflictNote.one":
    "{count} sessie meldde tegenstrijdige eindwaarden; de eerste waarde wordt gebruikt en de rij is gemarkeerd als “conflict” in de download.",
  "usage.conflictNote.other":
    "{count} sessies meldden tegenstrijdige eindwaarden; de eerste waarde wordt gebruikt en die rijen zijn gemarkeerd als “conflict” in de download.",
  "usage.download": "CSV downloaden",
  "usage.drivers": "Personen",
  "usage.driversDetail": "met een laadpaal",
  "usage.empty": "Nog geen laadsessies. Het verbruik verschijnt hier na de eerste laadbeurt.",
  "usage.last12": "Laatste 12 maanden",
  "usage.lastMonth": "Vorige maand",
  "usage.lede": "Geregistreerde energie op alle laadpalen die je beheert, maand per maand.",
  "usage.ledeCompany":
    "Geregistreerde energie op alle laadpalen, gegroepeerd per werknemer bij wie de laadpaal hoort. Gebruik de download voor terugbetaling of loonadministratie.",
  "usage.loading": "Verbruik wordt geladen…",
  "usage.notLoaded": "Geen rapport geladen.",
  "usage.openNote.one": "{count} sessie is nog aan het laden; ze telt mee zodra ze stopt.",
  "usage.openNote.other": "{count} sessies zijn nog aan het laden; ze tellen mee zodra ze stoppen.",
  "usage.panelTitle": "Jouw laadbeurten",
  "usage.reportNote":
    "Maanden volgen {timeZone}; een sessie hoort bij de maand waarin ze begon. De cijfers komen van de eigen meter van elke laadpaal. De download gebruikt anonieme referenties, nooit pasnummers, en is geen goedgekeurde onkostennota.",
  "usage.sessions.one": "{count} sessie",
  "usage.sessions.other": "{count} sessies",
  "usage.showChart": "Grafiek tonen",
  "usage.showTable": "Tabel tonen",
  "usage.stillCharging.one": "{count} nog aan het laden",
  "usage.stillCharging.other": "{count} nog aan het laden",
  "usage.thisMonth": "Deze maand",
  "usage.title": "Verbruik",
  "usage.titleCompany": "Verbruik per werknemer",
  "usage.unassigned": "Niemand",
  "usage.withSessions": "{count} met sessies",
  "overview.unnamedTitle": "Je laadpaal",
  "stations.nameIt": "Geef deze laadpaal een naam",
  "fleet.step.identity.unchecked": "Gegevens van de laadpaal ontvangen",
  "usage.historyHint": "Vanaf je tweede maand verschijnt een maandgrafiek.",
  "offline.techDetails": "Instellingen die dit wijzigt",
  "cards.noPerson": "Niemand gekoppeld",
  "cards.addName": "Laadpas benoemen",
  "cards.reference": "Referentie {id}",
  "stations.continueSetup": "Verder instellen",
  "fleet.setup.why":
    "Met deze stappen komen je laadpassen op de laadpaal, zodat ze ook zonder internet werken.",
  "details.notNamed": "Nog geen naam",
  "stations.nameItShort": "Laadpaal benoemen",
  "app.menu": "Menu",
  "app.closeMenu": "Menu sluiten",
  "controls.availableNow": "Nu: {status}",
  "cards.sync.notSent": "Je laadpassen zijn nog niet naar de laadpaal gestuurd.",
  "stations.chargingShort": "Laden",
  "fleet.step.connected.todo": "Verbind de laadpaal",
  "fleet.step.identity.todo": "Gegevens van de laadpaal ontvangen",
  "fleet.step.cards.todo": "Registreer een laadpas",
  "fleet.step.offline-ready.todo": "Controleer de offline-instellingen",
  "fleet.step.cards-on-charger.todo": "Stuur de laadpassen naar de laadpaal",
  "fleet.step.test-charge.todo": "Probeer een laadbeurt terwijl de laadpaal verbonden is",
  "fleet.setup.fieldTest": "Test offline laden",
  "fleet.setup.fieldTestBody":
    "Laad met je laadpas terwijl chargeOS en het internet onbereikbaar zijn voor de laadpaal. Hiervoor moet je bij de laadpaal zijn.",
  "fleet.setup.fieldTestGuide": "Zo test je",
  "controls.targetThis": "Start een laadbeurt of herstart deze laadpaal zonder ernaartoe te gaan.",
  "controls.isAvailable": "Aansluiting {connector} is beschikbaar. Niets te wijzigen.",
  "signin.where": "Hulp bij het vinden van je token",
  "fleet.setup.notReady": "Offline laden instellen",
  "cards.ledeThis": "Laadpassen en sleutelhangers die je laadpaal kunnen starten.",
  "overview.notSentValue": "Nog niet naar de laadpaal gestuurd",
  "overview.notConfirmedValue": "Nog niet aanvaard door de laadpaal",
  "overview.connectedNotCharging": "Verbonden · laadt niet",
  "offline.stepOf": "Dit is stap {step} van {total} bij het instellen van deze laadpaal.",
  "offline.allSteps": "Bekijk alle stappen in het overzicht",
  "fleet.setup.whyOnline":
    "Je laadpassen worden goedgekeurd zolang de laadpaal online is. Met deze stappen bereid je laden zonder internet voor.",
  "offline.pathPassed": "Geslaagd",
  "offline.pathProblem": "Moet worden opgelost",
  "usage.thisMonthLower": "deze maand",
  "usage.lastOn": "Laatste laadbeurt {date}",
  "usage.meterNoteZone":
    "Gemeten door de eigen meter van de laadpaal en geteld wanneer een sessie stopt, in de maand waarin ze begon ({timeZone}). Geen factuur of goedgekeurde terugbetaling.",
  "controls.startHint":
    "Steek eerst de stekker in de auto. De laadpaal start dan alsof deze laadpas werd aangeboden.",
  "connect.titleConnected": "Verbinding",
  "fleet.setup.showDone": "Stappen 1–{last} klaar",
  "status.connectedShort": "Verbonden",
  "status.offlineShort": "Niet verbonden",
  "usage.meterShort": "Gemeten door de eigen meter van je laadpaal. Geen factuur.",
  "usage.howCounted": "Hoe dit geteld wordt",
  "usage.allSessions": "Alle sessies bekijken",
  "nav.sessions": "Laadbeurten",
  "sessions.title": "Laadbeurten",
  "sessions.ledeThis": "Elke laadbeurt op je laadpaal, nieuwste eerst.",
  "sessions.lede": "Elke laadbeurt op {station}, nieuwste eerst.",
  "sessions.note":
    "De energie komt van de eigen meter van de laadpaal en is definitief zodra een sessie stopt.",
  "fleet.setup.stepOf": "Stap {step} van {total}",
  "offline.rowSettings": "Offline-instellingen",
  "offline.rowField": "Test offline laden",
  "cards.privacyShort": "Namen van laadpassen blijven op je chargeOS-server.",
  "people.privacyShort": "Namen blijven op je chargeOS-server.",
  "offline.pathNotChecked": "Niet gecontroleerd",
  "details.siteNotSet": "Niet ingesteld",
  "fleet.setup.stake":
    "Tot dit is ingesteld en getest, werken je laadpassen misschien niet als het internet uitvalt.",
  "offline.testNotDone": "Niet gedaan",
  "sessions.duration": "Duur",
  "sessions.hoursMinutes": "{hours} u {minutes} min",
  "sessions.minutes": "{minutes} min",
  "sessions.underMinute": "Minder dan 1 min",
  "head.connection": "Verbinding",
  "head.charging": "Nu",
  "head.offline": "Offline laden",
  "cards.sync.continueSetup": "Verder met installeren",
  "cards.manage": "Opties voor laadpas",
  "cards.manageCompany": "Indelen of verwijderen",
  "stations.setupOpen": "Installatie niet afgerond",
  "signin.tokenHint":
    "Plak het eigenaarstoken dat je kreeg toen chargeOS werd geïnstalleerd. Vraag het aan wie het installeerde als je het niet hebt.",
  "prefs.modulesNoteShort": "Wat gebeurt er als een onderdeel verborgen is?",
  "head.offlineNotReady": "Nog niet getest",
  "fleet.setup.stakeWorking":
    "Je laadpassen werken zolang de laadpaal met chargeOS verbonden is. Laden zonder die verbinding vraagt nog deze stappen en je eigen test.",
  "fleet.step.connected.why": "zodat chargeOS hem kan bereiken",
  "fleet.step.identity.why": "zodat je weet dat het de juiste laadpaal is",
  "fleet.step.cards.why": "zodat je laadpas kan starten",
  "fleet.step.offline-ready.why": "leest alleen, verandert niets",
  "fleet.step.cards-on-charger.why": "zodat de laadpaal je laadpassen kent zonder internet",
  "fleet.step.test-charge.why":
    "start en stop een laadbeurt met je laadpas, nadat die verstuurd is",
  "fleet.setup.fieldTestWhy": "aan de laadpaal, met chargeOS en het internet onbereikbaar",
  "cards.sync.laterInSetup":
    "De installatie stuurt ze in een latere stap naar de laadpaal, zodat ze ook zonder internet werken.",
  "cards.sync.nextInSetup":
    "Ze naar de laadpaal sturen is je volgende installatiestap, zodat ze ook zonder internet werken.",
  "head.connectedChargeOS": "Verbonden met chargeOS",
  "cards.sync.workConnected": "Je laadpassen werken zolang de laadpaal verbonden is.",
  "people.emptyTitle": "Nog geen mensen",
  ...fleetNl,
};
