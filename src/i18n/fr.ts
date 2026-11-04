import type { MessageKey } from "./en.js";
import { fleetFr } from "./fleet.fr.js";

/** French (Belgium) owner-console messages. Keys and placeholders mirror `en.ts`. */
export const fr: Readonly<Record<MessageKey, string>> = {
  "stations.openOverview": "Ouvrir la vue d’ensemble",
  "stations.resolveSetup": "Voir le problème de configuration",
  "stations.connectionHelp": "Ouvrir l’aide à la connexion",
  "stations.metric.unknown": "État de recharge inconnu",
  "offline.fieldGuide": "Ouvrir le guide du test sur place",
  "controls.maintenance": "Maintenance",
  "controls.availability": "Disponibilité de la prise",
  "controls.startTarget": "Démarrer sur la prise {connector}",
  "controls.historyIntro":
    "L’historique indique la réponse de la borne et ce que chargeOS a observé ensuite.",
  "controls.target": "Commandes pour {name}.",
  "advanced.englishOnly":
    "Cette section n’est disponible qu’en anglais pour l’instant, car ses textes de sécurité doivent être relus avant d’être traduits.",
  "advanced.lede":
    "Outils techniques pour votre borne. Vous n’en avez besoin que pour configurer la recharge hors ligne, commander la borne à distance ou consulter les enregistrements.",
  "advanced.tabs": "Sections des réglages de la borne",

  "app.charger": "Borne",
  "app.chargerCount.one": "{count} borne",
  "app.chargerCount.other": "{count} bornes",
  "app.connectedCount": "{connected} sur {total} connectées",
  "app.footer": "Open source. Local d’abord. Vous gardez le contrôle.",
  "app.help": "Guides d’aide",
  "app.lock": "Verrouiller la console",
  "app.opening": "Ouverture de votre console…",
  "app.otherToken": "Utiliser un autre jeton",
  "app.sections": "Sections de la console",
  "app.skip": "Aller au contenu",
  "app.snapshot": "Mis à jour {date}",
  "app.updated": "Mis à jour",

  "attention.authorization-pending": "Badges pas encore envoyés à la borne",
  "attention.continuity-unproven": "Recharge hors ligne non vérifiée",
  "attention.evidence-conflict": "Données de session contradictoires",
  "attention.migration-action": "Étape de changement ouverte",
  "attention.offline": "Hors ligne",
  "attention.no-cards": "Aucun badge",

  "board.freedomDetail": "Test devant témoin à la borne",
  "board.sharingActive.one": "{count} personne a un accès en lecture",
  "board.sharingActive.other": "{count} personnes ont un accès en lecture",
  "board.sharingDetail": "Accès temporaire en lecture seule",
  "board.sharingNone": "Personne d’autre n’a accès",
  "board.switchingDetail": "Quitter un ancien fournisseur",
  "board.title": "En un coup d’œil",

  "cards.add": "Ajouter un badge",
  "cards.addHint":
    "Le badge fonctionne à la borne dès que la borne accepte la nouvelle liste des badges. En attendant, il reste ici.",
  "cards.addTitle": "Ajouter un badge à {station}",
  "cards.adding": "Ajout en cours…",
  "cards.count.one": "{count} badge",
  "cards.count.other": "{count} badges",
  "cards.editTitle": "Modifier le badge",
  "cards.field.holder": "Qui l’utilise",
  "cards.field.name": "Nom du badge",
  "cards.field.namePlaceholder": "Par exemple : porte-clés bleu",
  "cards.field.newPerson": "Quelqu’un de nouveau…",
  "cards.field.number": "Numéro du badge",
  "cards.field.numberHint":
    "La valeur que la borne lit sur le badge. Ce n’est souvent pas le numéro imprimé dessus ; il est donc plus simple de présenter le badge à la borne. chargeOS la conserve uniquement sur ce serveur et ne l’affiche plus jamais.",
  "cards.field.reference": "Référence du badge :",
  "cards.first.body":
    "Aucun badge ne peut encore charger ici : chargeOS refuse tous les badges tant que vous n’en avez pas ajouté. Présentez votre propre badge à la borne pour l’ajouter.",
  "cards.first.title": "Ajoutez votre premier badge",

  "cards.keepOne": "chargeOS empêche la suppression du dernier badge enregistré.",
  "cards.lede": "Badges et porte-clés de recharge enregistrés pour {station}.",
  "cards.onCharger": "Sur la borne",
  "cards.privacy":
    "Les noms ne sont affichés que dans cette console. Les exports, l’accès partagé et l’aide IA utilisent des références anonymes.",
  "cards.removeAcknowledge":
    "Je comprends que ce badge peut continuer à fonctionner à la borne jusqu’à ce que la borne accepte la nouvelle liste.",
  "cards.removeBody":
    "Le badge est retiré de la liste immédiatement. La borne elle-même ne l’oublie qu’une fois la nouvelle liste acceptée ; envoyez donc la liste ensuite.",
  "cards.removeConfirm": "Retirer le badge",
  "cards.removeTitle": "Retirer {name} ?",
  "cards.staleBody":
    "La borne n’a pas encore reçu la nouvelle liste. Pendant une coupure d’internet, elle peut encore les accepter. Envoyez la liste à la borne pour terminer le retrait.",
  "cards.staleTitle.one": "{count} badge retiré peut encore fonctionner à la borne",
  "cards.staleTitle.other": "{count} badges retirés peuvent encore fonctionner à la borne",
  "cards.sync.checkFirst":
    "Vérifiez d’abord les paramètres hors ligne de la borne. L’envoi devient possible dès que ce contrôle réussit.",
  "cards.sync.confirm": "Remplacer la liste des badges sur la borne par les badges affichés ici ?",
  "cards.sync.current": "Tous les badges sont sur la borne",
  "cards.sync.currentLong": "La borne a accepté la liste actuelle",
  "cards.sync.never": "Badges pas encore envoyés",
  "cards.sync.neverLong": "La borne n’a pas confirmé la réception d’une liste de badges.",
  "cards.sync.offline":
    "La borne est déconnectée. Vous pourrez envoyer la liste quand elle se reconnectera.",
  "cards.sync.openOffline": "Vérifier les paramètres hors ligne",
  "cards.sync.pending": "Modifications en attente pour la borne",
  "cards.sync.pendingLong.one": "{count} modification attend d’être envoyée à la borne",
  "cards.sync.pendingLong.other": "{count} modifications attendent d’être envoyées à la borne",
  "cards.sync.readyHint": "Envoyez la liste pour que la borne connaisse exactement ces badges.",
  "cards.sync.send": "Envoyer à la borne",
  "cards.sync.sending": "Envoi en cours…",
  "cards.tap.add": "Ajouter ce badge",
  "cards.tap.again": "Écouter à nouveau",
  "cards.tap.captured": "Badge trouvé",
  "cards.tap.capturedBody":
    "Un badge a été présenté à {time} (référence {reference}). La borne l’a refusé cette fois, comme prévu. Ajoutez-le et il fonctionnera ici désormais.",
  "cards.tap.expired":
    "Aucun badge n’est arrivé jusqu’à chargeOS. Vérifiez que la borne est connectée et écoutez à nouveau, ou saisissez le numéro du badge.",
  "cards.tap.intro":
    "Présentez votre badge à la borne et chargeOS l’ajoute : vous n’avez jamais besoin de connaître son numéro. La borne refuse ce passage-là ; c’est normal.",
  "cards.tap.known": "Ce badge fait déjà partie des badges de cette borne. Rien n’a changé.",
  "cards.tap.listening": "Présentez votre badge à la borne maintenant",
  "cards.tap.listeningBody":
    "Tenez un seul badge contre le lecteur de la borne. Seule cette borne écoute, et seulement un court moment.",
  "cards.tap.offline":
    "La borne est hors ligne. chargeOS ne voit un badge que lorsque la borne est connectée.",
  "cards.tap.several":
    "Plusieurs badges différents ont été présentés : aucun n’a été ajouté. Écoutez à nouveau et présentez uniquement votre badge.",
  "cards.tap.start": "Présenter un badge à la borne",
  "cards.tap.typeInstead": "Saisir le numéro du badge",
  "cards.tap.until": "Écoute jusqu’à {time}.",

  "cards.title": "Badges",
  "cards.unnamed": "Badge sans nom",
  "cards.unnamedShort": "Badge sans nom · {id}",
  "cards.waiting": "Pas encore envoyé",

  "command.message.accepted":
    "{name} : la borne a dit oui. Vérifiez ci-dessous ce qui s’est passé ensuite ; un oui seul n’est pas une preuve.",
  "command.message.failed":
    "{name} : non exécuté ({status}). Cette borne ne le prend peut-être pas en charge.",
  "command.message.pending": "{name} : envoyé, en attente de la borne.",
  "command.message.rejected": "{name} : la borne a dit non ({status}). Rien n’a changé.",
  "command.message.uncertain":
    "{name} : pas de réponse claire ({status}). La borne a peut-être agi ; vérifiez-la avant de réessayer.",
  "command.state.accepted": "acceptée",
  "command.state.failed": "échouée",
  "command.state.pending": "en attente",
  "command.state.rejected": "refusée",
  "command.state.uncertain": "incertaine",
  "command.type.ChangeAvailability": "Rendre disponible",
  "command.type.RemoteStartTransaction": "Démarrage à distance",
  "command.type.RemoteStopTransaction": "Arrêt à distance",
  "command.type.Reset": "Redémarrage",
  "command.type.UnlockConnector": "Déverrouiller le câble",

  "common.cancel": "Annuler",
  "common.close": "Fermer",
  "common.edit": "Modifier",
  "common.remove": "Retirer",
  "common.save": "Enregistrer",
  "common.typePhrase": "Tapez exactement cette phrase pour confirmer",

  "connect.address": "Adresse pour la borne",
  "connect.addressUnknown":
    "L’adresse de la borne indiquée lors de l’installation (START-HERE.txt), suivie du nom de la borne",
  "connect.alias.accept": "Utiliser {presented}",
  "connect.alias.accepting": "Enregistrement…",
  "connect.alias.offer":
    "Ou laissez la borne telle quelle : chargeOS peut accepter {presented} comme nom de cette borne, car la borne a prouvé qu’elle connaît le mot de passe de cette borne. Elle se connectera alors à sa prochaine tentative.",

  "connect.awaitingBootBody":
    "La borne est connectée. En attente de son premier message de démarrage, qui indique à chargeOS le modèle et le micrologiciel. Cela prend généralement moins d’une minute.",
  "connect.identity": "Nom de la borne (identité)",
  "connect.identityHint":
    "Recopiez le nom de la borne exactement, majuscules comprises. Certains outils de configuration demandent l’adresse et le nom séparément ; l’adresse se termine alors par une barre oblique.",
  "connect.identityWithAlias": "{id}, ou {alias} (le nom que votre borne utilise déjà)",

  "connect.installerNote":
    "Votre installateur saisit les paramètres de connexion dans l’outil de configuration de la borne. chargeOS ne modifie jamais lui-même ces paramètres de connexion.",
  "connect.intro":
    "Saisissez ces réglages dans l’outil de configuration de votre borne. Cette page se met à jour d’elle-même dès que la borne se connecte.",
  "connect.password": "Mot de passe",
  "connect.passwordWhere":
    "Le mot de passe de la borne (stationSecret) dans le fichier credentials.json de votre installation. Il n’est jamais affiché ici.",
  "connect.protocol": "Protocole",
  "connect.protocolValue": "OCPP 1.6 JSON (parfois appelé OCPP-J)",
  "connect.refused.anyDevice":
    "Tout appareil qui utilise ce nom de borne peut provoquer ce message : il explique la dernière tentative, sans prouver d’où elle venait.",

  "connect.refused.duplicate": "Une connexion avec ce nom de borne est déjà ouverte",
  "connect.refused.duplicateFix":
    "Attendez quelques minutes et laissez la borne réessayer. Si cela se reproduit, vérifiez qu’aucun autre appareil n’utilise le nom {expected}.",
  "connect.refused.identity": "Votre borne a utilisé un autre nom",
  "connect.refused.identityBody":
    "Elle a envoyé le mot de passe de cette borne, mais s’est présentée comme {presented}. chargeOS attend {expected}.",
  "connect.refused.identityFix":
    "Changez le nom de la borne en {expected} dans l’outil de configuration.",
  "connect.refused.identityUnprintable":
    "Elle a envoyé le mot de passe de cette borne, mais avec un nom que chargeOS ne peut pas utiliser. chargeOS attend {expected}.",
  "connect.refused.noPassword": "Votre borne s’est connectée sans mot de passe",
  "connect.refused.noPasswordFix":
    "Dans l’outil de configuration, choisissez le réglage de sécurité qui envoie un mot de passe (authentification Basic) et saisissez le mot de passe de la borne. Si un nom d’utilisateur est demandé, utilisez {expected}.",
  "connect.refused.protocol": "Votre borne n’utilise pas OCPP 1.6 JSON",
  "connect.refused.protocolBody": "Elle a proposé {offered}.",
  "connect.refused.protocolFix":
    "Choisissez OCPP 1.6 avec JSON dans l’outil de configuration. chargeOS ne prend pas encore en charge d’autres versions.",
  "connect.refused.when": "Dernière tentative à {time}.",
  "connect.refused.wrongPassword": "Votre borne a envoyé un mauvais mot de passe",
  "connect.refused.wrongPasswordFix":
    "Copiez à nouveau le mot de passe depuis credentials.json (stationSecret). Utilisez-le en entier, sans le raccourcir. Si l’outil ne peut pas l’enregistrer, arrêtez et demandez à votre installateur.",
  "connect.security": "Sécurité",
  "connect.securityValue": "Le réglage qui envoie un mot de passe (authentification Basic)",
  "connect.state.awaitingBoot": "Connectée, en attente",
  "connect.state.connected": "Connectée",
  "connect.state.waiting": "En attente de la borne",
  "connect.title": "Connectez votre borne",
  "connect.unmatched.one":
    "{count} tentative de connexion a utilisé un nom de borne et un mot de passe inconnus (dernière à {time}). Si c’était votre borne, vérifiez les deux.",
  "connect.unmatched.other":
    "{count} tentatives de connexion ont utilisé un nom de borne et un mot de passe inconnus (dernière à {time}). Si l’une d’elles venait de votre borne, vérifiez les deux.",

  "connector.Available": "Disponible",
  "connector.Charging": "En charge",
  "connector.Faulted": "Panne",
  "connector.Finishing": "Fin de charge",
  "connector.Preparing": "Préparation",
  "connector.Reserved": "Réservée",
  "connector.SuspendedEV": "En pause (voiture)",
  "connector.SuspendedEVSE": "En pause (borne)",
  "connector.Unavailable": "Indisponible",

  "controls.card": "Badge",
  "controls.col.answer": "Réponse de la borne",
  "controls.col.command": "Commande",
  "controls.col.observed": "Ce qui s’est passé ensuite",
  "controls.col.requested": "Envoyée",
  "controls.connector": "Prise",
  "controls.hard": "Forcé (immédiat)",
  "controls.history": "Historique des commandes",
  "controls.historyEmpty": "Aucune commande à distance envoyée pour l’instant.",
  "controls.intro":
    "Vous seul pouvez les envoyer, et uniquement quand la borne est connectée. Une borne peut dire oui sans le faire, c’est pourquoi chaque commande affiche sa réponse et ce qui s’est réellement passé ensuite. chargeOS n’éteint jamais une borne, car elle s’en souviendrait même si chargeOS disparaissait.",
  "controls.makeAvailable": "Rendre la prise {connector} disponible",
  "controls.noSession": "Aucune recharge en cours.",
  "controls.notObserved": "Pas encore observé",
  "controls.offline":
    "La borne est hors ligne, les commandes à distance ne sont donc pas disponibles.",
  "controls.restart": "Redémarrer",
  "controls.restartTitle": "Redémarrer la borne",
  "controls.restartType": "Type de redémarrage",
  "controls.soft": "Doux (termine d’abord la recharge proprement)",
  "controls.start": "Démarrer à distance",
  "controls.startTitle": "Démarrer la recharge",
  "controls.stopSession": "Arrêter la session n° {id} (prise {connector})",
  "controls.stopTitle": "Arrêter la recharge",
  "controls.title": "Commande à distance",
  "controls.unlock": "Déverrouiller",
  "controls.unlockHint": "Libère le câble. Ne le faites que lorsque vous êtes devant la borne.",
  "controls.unlockTitle": "Déverrouiller le câble de la prise {connector}",

  "details.chargePointId": "Identifiant de la borne",
  "details.firmware": "Micrologiciel",
  "details.namesNote":
    "Le nom, le lieu et la personne sont des étiquettes propres à cette console. La borne elle-même est identifiée par son identifiant.",
  "details.title": "Détails de la borne",

  "directory.readOnly":
    "Les noms enregistrés n’ont pas pu être lus ; la modification est donc désactivée pour les protéger. Demandez à votre administrateur de vérifier directory.json. La recharge n’est pas affectée.",
  "directory.unavailable":
    "Les noms ne sont pas disponibles sur cette version du serveur. La recharge et les badges fonctionnent normalement.",

  "evidence.carried": "repris d’une sauvegarde conservée",
  "evidence.empty": "Aucun enregistrement pour l’instant.",
  "evidence.export": "Télécharger l’enregistrement partageable",
  "evidence.exporting": "Préparation…",
  "evidence.fromCharger": "De la borne",
  "evidence.latest": "Derniers enregistrements",
  "evidence.lede":
    "L’enregistrement infalsifiable que chargeOS tient pour cette borne. Le téléchargement exclut les secrets et les numéros de badge, et n’est pas une sauvegarde.",
  "evidence.system": "chargeOS",
  "evidence.toCharger": "Vers la borne",

  "module.assist.description":
    "Demandez des conseils de dépannage à votre propre service d’IA. Il ne peut rien modifier.",
  "module.assist.label": "Aide IA",
  "module.evidence.description":
    "Consultez et téléchargez ce que chargeOS a enregistré sur votre borne.",
  "module.evidence.label": "Enregistrements",
  "module.liberation.description": "Détachez une borne de son ancien fournisseur, étape par étape.",
  "module.liberation.label": "Changement de fournisseur",
  "module.sharing.description":
    "Donnez à un installateur, un employeur ou un fournisseur d’énergie un accès temporaire en lecture seule.",
  "module.sharing.label": "Accès partagé",

  "nav.advanced": "Réglages de la borne",
  "nav.cards": "Badges",
  "nav.hint.attention": "demande votre attention",
  "nav.hint.cardsWaiting": "badges en attente d’envoi",
  "nav.overview": "Aperçu",
  "nav.people": "Personnes",
  "nav.preferences": "Préférences",
  "nav.stations": "Bornes",
  "nav.usage": "Consommation",

  "notice.cardAdded":
    "Badge ajouté. Envoyez la liste des badges à la borne pour qu’il fonctionne aussi sans internet.",
  "notice.cardAddedUnnamed":
    "Badge ajouté, mais son nom n’a pas pu être enregistré. Modifiez le badge pour réessayer.",
  "notice.cardRemoved":
    "Badge retiré de la liste. Il peut continuer à fonctionner à la borne jusqu’à ce que la borne accepte la nouvelle liste.",
  "notice.cardSaved": "Badge enregistré.",
  "notice.delegateIssued": "Accès créé. Copiez le secret maintenant ; il n’est pas conservé.",
  "notice.delegateRevoked": "Accès retiré. Vos propres badges et la recharge ne sont pas affectés.",
  "notice.evidenceExported":
    "Enregistrement téléchargé. Les secrets et les numéros de badge sont exclus.",
  "notice.failed": "Cela n’a pas fonctionné. Réessayez.",
  "notice.identityAliasAccepted":
    "Nom accepté. La borne se connectera à sa prochaine tentative ; cette page se met à jour d’elle-même.",

  "notice.inspectBlocked":
    "Il manque à la borne au moins un réglage nécessaire à la recharge hors ligne.",
  "notice.inspectReady":
    "La borne dispose de tous les réglages pour la recharge hors ligne. Un vrai test à la borne reste la seule preuve.",
  "notice.personAdded": "Personne ajoutée.",
  "notice.personRemoved":
    "Personne retirée. Ses bornes et badges ne sont plus attribués à personne.",
  "notice.personSaved": "Nom enregistré.",
  "notice.preparedChanged":
    "Réglages hors ligne modifiés sur la borne : {count}. Envoyez ensuite la liste des badges.",
  "notice.preparedUnchanged":
    "Les réglages hors ligne étaient déjà corrects. Envoyez ensuite la liste des badges.",
  "notice.stationSaved": "Borne enregistrée.",
  "notice.synced": "La borne a accepté la liste des badges (version {revision}).",

  "offline.blockedText":
    "Au moins un réglage nécessaire à la recharge hors ligne est absent ou incorrect. Ouvrez les réglages de la borne pour le corriger.",
  "offline.blockedTitle": "Quelque chose doit être corrigé",
  "offline.check": "Vérifier les paramètres hors ligne",
  "offline.checkAgain": "Vérifier à nouveau",
  "offline.checking": "Vérification…",
  "offline.checksLabel": "Vérifications de la recharge hors ligne",
  "offline.checksPass": "vérifications OK",
  "offline.connectFirst": "Connectez d’abord la borne, puis vérifiez-la.",
  "offline.details": "Détails",
  "offline.explain":
    "chargeOS demande à la borne quels réglages elle possède. La vérification ne fait que lire ; rien n’est modifié.",
  "offline.kicker": "Recharger sans internet",
  "offline.lastAttempt": "Dernière tentative",
  "offline.lastChecked": "Dernière vérification {date}",
  "offline.lastRevision": "Version de la liste sur la borne",
  "offline.lastSync": "Dernier envoi",
  "offline.notChecked": "non vérifiée",
  "offline.physicalTest":
    "Faites quand même un vrai test une fois : coupez internet et rechargez avec votre badge.",
  "offline.physicalWork":
    "L’adresse du serveur, le micrologiciel ou le câblage de la borne ne se modifient pas ici. C’est le travail d’un installateur.",
  "offline.prepare": "Modifier les réglages hors ligne",
  "offline.prepareText":
    "Demande à la borne de garder une liste locale de badges, d’accepter ces badges sans internet et de refuser les badges inconnus. Rien d’autre ne change et la borne n’est pas redémarrée.",
  "offline.prepareTitle": "Activer la recharge hors ligne",
  "offline.preparing": "Modification…",
  "offline.readyText":
    "La borne a signalé tous les réglages dont elle a besoin pour accepter vos badges de manière autonome.",
  "offline.readyTitle": "Vérification des réglages réussie",
  "offline.sendLocked": "Disponible dès que toutes les vérifications sont OK.",
  "offline.sendText":
    "Remplace la liste de la borne par les badges de cette console. Une liste acceptée confirme la réception. Faites un test à la borne pour vérifier son fonctionnement hors ligne.",
  "offline.sendTitle": "Envoyer les badges à la borne",
  "offline.unanswered": "En attente de la réponse de la borne",
  "offline.unknownText":
    "Vérifiez si la borne peut accepter vos badges lorsque internet est coupé. La vérification ne fait que lire les réglages.",
  "offline.unknownTitle": "Réglages pas encore vérifiés",

  "overview.cardDetails": "Voir les badges",
  "overview.cardListWaiting": "La borne n’a pas encore répondu à une mise à jour de la liste.",
  "overview.cardsOnCharger": "Badges",
  "overview.cardsRegistered.one": "{count} badge enregistré dans chargeOS",
  "overview.cardsRegistered.other": "{count} badges enregistrés dans chargeOS",
  "overview.chargingNow": "Recharge en ce moment",
  "overview.chargedSoFar": "{energy} jusqu’ici, selon le relevé du compteur de la borne à {date}",
  "overview.chargingSince": "Début : {date}",
  "overview.noMeterReading": "En attente du premier relevé du compteur de la borne",
  "overview.chargingOn": "La prise {connector} signale une recharge",
  "overview.chargingUnknown": "Inconnue",
  "overview.connectFirst":
    "chargeOS attend que la borne se connecte. Si vous changez de fournisseur, gardez votre service actuel connecté pendant que vous vérifiez le modèle et le firmware exacts avec votre installateur, sauvegardez les réglages et préparez le retour à l’ancienne configuration.",
  "overview.connectionGuide": "Ouvrir le guide de connexion",
  "overview.fieldFailed": "Un échec a été enregistré lors du test sur place",
  "overview.fieldReview": "Résultats du test sur place enregistrés. Examen en attente.",
  "overview.fieldStale": "Les résultats du test précédent ne sont plus à jour",
  "overview.fieldUnverified": "Non vérifiée",
  "overview.installerSettings": "Paramètres de connexion pour votre installateur",
  "overview.lastCardList": "Dernière liste acceptée : {date}",
  "overview.lastChargingReport": "Signalé par la borne à {date}",
  "overview.listAccepted": "La borne a accepté la liste actuelle",
  "overview.noCards": "Aucun badge enregistré dans chargeOS",
  "overview.notCharging": "Pas de recharge",
  "overview.notConnected": "Non connectée",
  "overview.offlineDetails": "Voir les réglages de recharge hors ligne",
  "overview.reconnect":
    "chargeOS a perdu la connexion avec la borne. Vérifiez la connexion avant de modifier les réglages.",
  "overview.refresh": "Actualiser l’état",
  "overview.refreshing": "Actualisation…",
  "overview.settingsBlocked": "La vérification des réglages a détecté un problème.",
  "overview.settingsPassed":
    "Les réglages ont passé la vérification. Seul un test à la borne permet de voir ce qui se passe hors ligne.",
  "overview.settingsUnchecked": "Paramètres pas encore vérifiés.",
  "overview.statusTitle": "Ce que chargeOS sait",
  "overview.statusUnavailable":
    "La console n’a pas pu s’actualiser. L’état de recharge en direct est indisponible.",
  "overview.waitingForStatus": "Aucun état en direct de la borne.",
  "overview.stop": "Arrêter la recharge",
  "overview.stopBody":
    "Une étape du changement de fournisseur a enregistré un problème. Laissez tout en l’état et résolvez-le avant de continuer.",
  "overview.stopLink": "Ouvrir le changement de fournisseur",
  "overview.stopTitle": "Stop : un problème a été enregistré",

  "people.add": "Ajouter une personne",
  "people.addCompany": "Ajouter un collaborateur",
  "people.empty":
    "Personne pour l’instant. Ajoutez les personnes qui rechargent ici pour lier leurs badges.",
  "people.emptyCompany":
    "Aucun collaborateur pour l’instant. Ajoutez un collaborateur, puis attribuez-lui sa borne et ses badges.",
  "people.field.name": "Nom",
  "people.lede": "Les personnes qui rechargent ici, avec leurs bornes et leurs badges.",
  "people.ledeCompany":
    "Vos collaborateurs, la borne à leur domicile et les badges qu’ils utilisent. La consommation est rapportée par collaborateur.",
  "people.noCards": "Aucun badge",
  "people.noStation": "Aucune borne",
  "people.nobody": "Non attribuée",
  "people.privacy":
    "Les noms restent sur ce serveur et ne sont affichés que dans cette console. Ils ne font pas partie des exports, de l’accès partagé, de l’aide IA ni des sauvegardes chiffrées.",
  "people.removeBody":
    "Ses bornes et badges restent tels quels mais n’ont plus de nom associé. La recharge n’est pas affectée.",
  "people.removeTitle": "Retirer {name} ?",
  "people.rename": "Renommer",
  "people.renameTitle": "Renommer",
  "people.stationCount.one": "{count} borne",
  "people.stationCount.other": "{count} bornes",
  "people.stations": "Bornes",
  "people.title": "Personnes",
  "people.titleCompany": "Collaborateurs",

  "prefs.company": "Entreprise",
  "prefs.companyText":
    "Configuré pour une organisation qui gère des bornes pour ses collaborateurs : la consommation est rapportée par collaborateur et peut être téléchargée.",
  "prefs.language": "Langue",
  "prefs.languageNote":
    "Enregistrée dans ce navigateur. Les guides d’aide et certaines sections avancées sont en anglais.",
  "prefs.lede":
    "Choisissez votre langue et les sections affichées. Vos choix ne valent que dans ce navigateur.",
  "prefs.modules": "Sections supplémentaires",
  "prefs.modulesCustom": "Votre choix dans ce navigateur est utilisé.",
  "prefs.modulesDefault":
    "Les sections standard de votre profil sont affichées. Cochez une section pour l’afficher.",
  "prefs.modulesNote":
    "Masquer une section ne change que ce navigateur ; les badges, la recharge hors ligne et les enregistrements continuent de fonctionner. Une section masquée revient quand elle a besoin de vous.",
  "prefs.onByDefault": "Activée par défaut.",
  "prefs.personal": "Personnel",
  "prefs.personalText":
    "Configuré pour une personne avec sa propre borne : l’aperçu commence par votre consommation.",
  "prefs.profile": "Profil",
  "prefs.profileNote":
    "La personne qui a installé chargeOS choisit le profil. Demandez-lui s’il doit changer.",
  "prefs.title": "Préférences",
  "prefs.useDefaults": "Utiliser les réglages du profil",

  "sessions.soFar": "jusqu’ici",
  "sessions.active": "en charge",
  "sessions.card": "Badge",
  "sessions.cardRefused": "badge refusé",
  "sessions.complete": "Terminée",
  "sessions.conflict": "données contradictoires",
  "sessions.connector": "Prise",
  "sessions.empty": "Aucune session de recharge pour l’instant.",
  "sessions.energy": "Énergie",
  "sessions.number": "Session",
  "sessions.retries.one": "{count} message répété",
  "sessions.retries.other": "{count} messages répétés",
  "sessions.started": "Début",
  "sessions.status": "Statut",

  "sharing.canRead": "Peut voir",
  "sharing.copyNow": "Copiez ce secret maintenant",
  "sharing.copyNowBody":
    "Envoyez-le en privé à cette seule personne. chargeOS ne pourra plus l’afficher une fois fermé.",
  "sharing.current": "Qui a accès",
  "sharing.day": "{count} jour",
  "sharing.days": "{count} jours",
  "sharing.dismiss": "Je l’ai copié",
  "sharing.expires": "Expire après",
  "sharing.expiresOn": "Expire le {date}",
  "sharing.issue": "Créer l’accès",
  "sharing.issueTitle": "Donner un accès temporaire en lecture",
  "sharing.issuing": "Création…",
  "sharing.lede":
    "Donnez à quelqu’un un accès temporaire en lecture seule à cette borne. Cette personne ne peut modifier ni les badges, ni les réglages, ni la borne, et vous pouvez retirer l’accès à tout moment.",
  "sharing.none": "Personne d’autre n’a accès.",
  "sharing.revoke": "Retirer",
  "sharing.revokeConfirm": "Retirer cet accès maintenant ?",
  "sharing.role": "Pour qui",
  "sharing.role.employer": "Employeur (remboursement)",
  "sharing.role.energy": "Fournisseur d’énergie",
  "sharing.role.installer": "Installateur",
  "sharing.scope.employer":
    "Uniquement les heures de session et l’énergie. Aucune identité de badge.",
  "sharing.scope.energy": "Uniquement l’état de la borne et des prises.",
  "sharing.scope.installer":
    "État de la borne, diagnostic, dossier de changement de fournisseur et résultats non relus du Freedom Test.",
  "sharing.status.active": "actif",
  "sharing.status.expired": "expiré",
  "sharing.status.revoked": "retiré",

  "signin.body":
    "Saisissez le jeton propriétaire reçu lors de l’installation de chargeOS. Si vous ne l’avez pas, demandez-le à la personne qui a installé chargeOS. Il reste uniquement dans cet onglet.",
  "signin.help": "Guides d’installation et d’aide",
  "signin.open": "Ouvrir la console",
  "signin.title": "Bienvenue sur vos bornes",
  "signin.token": "Jeton propriétaire",

  "station.awaitingBoot": "En attente du signalement de la borne",
  "station.connected": "Connectée",
  "station.connectedSince": "Connectée depuis",
  "station.connector": "Prise {id}",
  "station.hardware": "Modèle",
  "station.noConnectors": "Aucun état de prise reçu pour l’instant.",
  "station.offline": "Hors ligne",
  "station.title": "Borne",

  "stations.attention": "Demande votre attention",
  "stations.available": "Disponible",
  "stations.chargingNow": "Recharge signalée",
  "stations.driver": "Personne",
  "stations.edit": "Modifier les noms",
  "stations.editTitle": "Modifier la borne",
  "stations.energy": "Énergie, au total",
  "stations.field.driver": "Personne",
  "stations.field.driverHint":
    "La consommation de cette borne est rapportée au nom de cette personne.",
  "stations.field.id": "Identifiant de la borne (non modifiable ici) :",
  "stations.field.name": "Nom",
  "stations.field.namePlaceholder": "Par exemple : Allée",
  "stations.field.site": "Lieu",
  "stations.field.sitePlaceholder": "Par exemple : Domicile ou bureau de Bruxelles",
  "stations.independence":
    "Chaque borne a sa propre liste de badges. Vérifiez la recharge hors ligne sur chaque borne.",
  "stations.lastSession": "Dernière session",
  "stations.lede":
    "Consultez la connexion, le dernier état de recharge et la prochaine étape pour chaque borne.",
  "stations.metric.chargers": "Bornes",
  "stations.metric.charging": "Recharge signalée",
  "stations.metric.connected": "Connectées",
  "stations.metric.energy": "Énergie enregistrée",
  "stations.offline": "Hors ligne",
  "stations.open": "Ouvrir",
  "stations.summary": "Résumé",
  "stations.title": "Bornes",

  "status.connected": "Borne connectée",
  "status.offline": "Borne hors ligne",

  "tab.assist": "Aide IA",
  "tab.controls": "Commande à distance",
  "tab.details": "Détails",
  "tab.evidence": "Enregistrements",
  "tab.freedom": "Freedom Test",
  "tab.offline": "Recharge hors ligne",
  "tab.sessions": "Sessions",
  "tab.sharing": "Accès partagé",
  "tab.switching": "Changer de fournisseur",

  "usage.byCard": "Ce mois-ci par badge",
  "usage.byCharger": "Consommation par borne",
  "usage.byDriver": "Consommation par personne",
  "usage.chargers": "Bornes",
  "usage.chartTitle": "Énergie par mois, kWh",
  "usage.col.charger": "Borne",
  "usage.col.driver": "Personne",
  "usage.col.energy": "Énergie",
  "usage.col.month": "Mois",
  "usage.col.sessions": "Sessions",
  "usage.col.site": "Lieu",
  "usage.conflictNote.one":
    "{count} session a signalé des valeurs de fin contradictoires ; la première valeur est utilisée et la ligne est marquée « conflit » dans le téléchargement.",
  "usage.conflictNote.other":
    "{count} sessions ont signalé des valeurs de fin contradictoires ; la première valeur est utilisée et ces lignes sont marquées « conflit » dans le téléchargement.",
  "usage.download": "Télécharger le CSV",
  "usage.drivers": "Personnes",
  "usage.driversDetail": "avec une borne",
  "usage.empty":
    "Aucune session de recharge pour l’instant. La consommation apparaît ici après la première recharge.",
  "usage.last12": "12 derniers mois",
  "usage.lastMonth": "Mois dernier",
  "usage.lede": "Énergie enregistrée sur toutes les bornes que vous gérez, mois par mois.",
  "usage.ledeCompany":
    "Énergie enregistrée sur toutes les bornes, regroupée par collaborateur auquel la borne appartient. Utilisez le téléchargement pour les remboursements ou la paie.",
  "usage.loading": "Chargement de la consommation…",
  "usage.notLoaded": "Aucun rapport chargé.",
  "usage.openNote.one":
    "{count} session est encore en charge ; elle sera comptée une fois terminée.",
  "usage.openNote.other":
    "{count} sessions sont encore en charge ; elles seront comptées une fois terminées.",
  "usage.panelTitle": "Vos recharges",
  "usage.reportNote":
    "Les mois suivent {timeZone} ; une session appartient au mois où elle a commencé. Les chiffres proviennent du compteur de chaque borne. Le téléchargement utilise des références anonymes, jamais les numéros de badge, et n’est pas une note de frais approuvée.",
  "usage.sessions.one": "{count} session",
  "usage.sessions.other": "{count} sessions",
  "usage.showChart": "Afficher le graphique",
  "usage.showTable": "Afficher le tableau",
  "usage.stillCharging.one": "{count} encore en charge",
  "usage.stillCharging.other": "{count} encore en charge",
  "usage.thisMonth": "Ce mois-ci",
  "usage.title": "Consommation",
  "usage.titleCompany": "Consommation par collaborateur",
  "usage.unassigned": "Personne",
  "usage.withSessions": "{count} avec sessions",
  "overview.unnamedTitle": "Votre borne",
  "stations.nameIt": "Nommer cette borne",
  "fleet.step.identity.unchecked": "Informations de la borne reçues",
  "usage.historyHint": "Un graphique mensuel apparaît dès votre deuxième mois.",
  "offline.techDetails": "Paramètres modifiés",
  "cards.noPerson": "Aucune personne liée",
  "cards.addName": "Ajouter un nom",
  "cards.reference": "Référence {id}",
  "stations.continueSetup": "Continuer la configuration",
  "fleet.setup.why":
    "Ces étapes placent vos badges sur la borne pour qu’ils fonctionnent sans internet.",
  "details.notNamed": "Pas encore nommée",
  "stations.nameItShort": "Ajouter un nom",
  "app.menu": "Menu",
  "app.closeMenu": "Fermer le menu",
  "controls.availableNow": "Actuellement : {status}",
  "cards.sync.notSent": "Vos badges n’ont pas encore été envoyés à la borne.",
  "stations.chargingShort": "Recharge",
  "fleet.step.connected.todo": "Connectez la borne",
  "fleet.step.identity.todo": "Recevoir les informations de la borne",
  "fleet.step.cards.todo": "Enregistrez un badge",
  "fleet.step.offline-ready.todo": "Vérifiez les paramètres hors ligne",
  "fleet.step.cards-on-charger.todo": "Envoyez les badges à la borne",
  "fleet.step.test-charge.todo": "Rechargez une fois après l’envoi des badges",
  "fleet.setup.fieldTest": "Ensuite : tester la recharge sans internet",
  "fleet.setup.fieldTestBody":
    "À la borne, coupez internet et rechargez avec votre badge. Vous seul pouvez le faire.",
  "fleet.setup.fieldTestGuide": "Comment tester",
  "controls.targetThis": "Commandes pour cette borne.",
  "controls.isAvailable": "Le connecteur {connector} est disponible. Rien à modifier.",
  "signin.where": "Où le trouver ?",
  "fleet.setup.notReady": "Configurer la recharge sans internet",
  "cards.ledeThis": "Badges et porte-clés qui peuvent démarrer votre borne.",
  "overview.notSentValue": "Pas encore envoyés à la borne",
  "overview.notConfirmedValue": "Pas encore acceptés par la borne",
  "overview.connectedNotCharging": "Connectée · pas de recharge",
  "offline.stepOf": "C’est l’étape {step} sur {total} de la configuration de cette borne.",
  "offline.allSteps": "Voir toutes les étapes dans l’aperçu",
  "fleet.setup.whyOnline":
    "Vos badges sont acceptés tant que la borne est en ligne. Ces étapes préparent la recharge sans internet.",
  "offline.pathPassed": "Réussie",
  "offline.pathProblem": "À corriger",
  "offline.pathNotYet": "Pas encore faite",
  "usage.panelSubShort": "Énergie mesurée par votre borne, par mois.",
  "usage.thisMonthLower": "ce mois-ci",
  "usage.lastOn": "dernière le {date}",
  "usage.meterNoteZone":
    "Mesurée par le compteur de la borne et comptée à la fin d'une session, dans le mois où elle a commencé ({timeZone}). Ni une facture ni un remboursement approuvé.",
  "controls.startHint":
    "Branchez d'abord la voiture. La borne démarre alors comme si ce badge avait été présenté.",
  "connect.titleConnected": "Connexion",
  "fleet.setup.showDone": "Afficher les étapes terminées",
  "status.connectedShort": "Connectée à chargeOS",
  "status.offlineShort": "Hors ligne",
  "usage.meterShort": "Mesurée par le compteur de votre borne. Pas une facture.",
  "usage.howCounted": "Comment c’est compté",
  "usage.allSessions": "Voir toutes les sessions",
  "today.title": "Recharge aujourd’hui",
  "today.online": "En ligne",
  "today.offline": "Si internet tombe",
  "today.onlineWorks": "Fonctionne. chargeOS accepte vos badges tant que la borne est connectée.",
  "today.onlineNoCard": "Enregistrez d’abord un badge.",
  "today.onlineDisconnected": "La borne n’est pas connectée pour le moment.",
  "nav.sessions": "Sessions",
  "sessions.title": "Sessions de recharge",
  "sessions.ledeThis": "Chaque session de recharge sur votre borne, la plus récente d’abord.",
  "sessions.lede": "Chaque session de recharge sur {station}, la plus récente d’abord.",
  "sessions.note":
    "L’énergie vient du compteur de la borne et devient définitive à la fin de la session.",
  "fleet.setup.stepOf": "Étape {step} sur {total}",
  "today.offlineNotReady":
    "La configuration n’est pas terminée : la recharge sans internet n’est pas encore vérifiée.",
  "today.offlineStopped":
    "La configuration est arrêtée : la recharge sans internet n’est pas vérifiée.",
  "offline.rowSettings": "Réglages hors ligne",
  "offline.rowField": "Test sans internet",
  "cards.privacyShort": "Les noms des badges restent privés dans cette console.",
  "people.privacyShort": "Les noms restent privés dans cette console.",
  ...fleetFr,
};
