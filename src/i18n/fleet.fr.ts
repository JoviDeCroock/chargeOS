import type { fleetEn } from "./fleet.en.js";

/** French (Belgium) messages for chargers, cards, employee pages, offboarding and the finance feed. */
export const fleetFr: Readonly<Record<keyof typeof fleetEn, string>> = {
  "fleet.sync.state.changed": "Ignorée · borne ou liste modifiée",
  "fleet.sync.state.failed": "Acceptation non confirmée · vérifier la borne",
  "fleet.sync.state.synced": "La borne a accepté la liste",
  "fleet.sync.state.no-cards": "Ignorée · aucun badge enregistré",
  "fleet.sync.state.not-ready": "Ignorée · vérification des réglages nécessaire",
  "fleet.sync.state.offline": "Ignorée · borne déconnectée",
  "fleet.sync.state.already-current": "Ignorée · liste actuelle déjà acceptée",
  "fleet.sync.state.eligible": "Prête à recevoir la liste",
  "fleet.sync.send.other": "Envoyer à {count} bornes",
  "fleet.sync.send.one": "Envoyer à {count} borne",
  "fleet.sync.revision": "Version de liste {revision}",
  "fleet.sync.changes": "Ajouts : {additions} · Suppressions : {removals}",
  "fleet.sync.reviewAgain": "Vérifier à nouveau",
  "fleet.sync.retryBody":
    "La vérification est indisponible ou a changé. Vérifiez les listes actuelles avant de réessayer.",
  "fleet.sync.loading": "Vérification des bornes pouvant recevoir leur liste de badges…",
  "fleet.sync.resultBody":
    "Vérifiez quelles bornes ont accepté leur liste et lesquelles nécessitent encore une intervention.",
  "fleet.sync.result": "Résultats de la synchronisation",
  "fleet.sync.reviewBody":
    "Chaque borne éligible recevra sa propre liste complète de badges. Vérifiez les ajouts et suppressions avant l’envoi.",
  "fleet.sync.review": "Vérifier la synchronisation des badges",
  "fleet.cards.alsoAccepted": "Liste de badges acceptée sur {station}",
  "driver.addPersonal": "Ajouter un badge personnel",
  "driver.cardCount.one": "{count} badge sur cette borne.",
  "driver.cardCount.other": "{count} badges sur cette borne.",
  "driver.cards": "Badges sur votre borne",
  "driver.companyCards":
    "Les badges de l’entreprise sont gérées par votre employeur. Vous pouvez ajouter et retirer vos propres badges personnels ; ils ne sont jamais remboursés.",
  "driver.expires":
    "Cette page fonctionne jusqu’au {date}. Demandez ensuite un nouveau lien à votre employeur.",
  "driver.noLink.body":
    "Ouvrez le lien envoyé par votre employeur. Il contient une clé personnelle : gardez-le pour vous.",
  "driver.noLink.title": "Cette page a besoin de votre lien personnel",
  "driver.noSessions": "Pas encore de recharge.",
  "driver.offlineReady": "Votre borne est réglée pour accepter vos badges même sans internet.",
  "driver.offlineUnknown": "Votre employeur n’a pas encore vérifié la recharge hors ligne.",
  "driver.personalNote":
    "Il sera ajouté comme badge personnel. Les recharges avec lui restent privées.",
  "driver.recent": "Recharges récentes",
  "driver.removeTitle": "Retirer ce badge personnel ?",
  "driver.sessions": "Recharges",
  "driver.state.charging": "En charge",
  "driver.state.offline": "Borne hors ligne",
  "driver.state.ready": "Prête à charger",
  "driver.syncBody":
    "Envoyez la liste à votre borne pour que ces badges fonctionnent aussi sans internet.",
  "driver.syncOwner": "Votre employeur enverra la liste une fois la recharge hors ligne vérifiée.",
  "driver.syncTitle": "Des changements de badges attendent votre borne",
  "driver.tapNow": "Présentez maintenant votre badge à votre borne",
  "driver.yourCharger": "Votre borne",

  "fleet.access.button": "Page employé",
  "fleet.access.can.personal": "Ajouter ou retirer ses propres badges personnels",
  "fleet.access.can.sessions": "Voir ses propres recharges",
  "fleet.access.can.status": "Voir si sa borne est en ligne et charge",
  "fleet.access.cannot.company": "Modifier les badges de l’entreprise ou une autre borne",
  "fleet.access.create": "Créer le lien",
  "fleet.access.expiry":
    "Le lien fonctionne 90 jours. Vous pouvez y mettre fin à tout moment dans Réglages de la borne, Accès partagé.",
  "fleet.access.lede":
    "Une page personnelle pour cet employé, sur téléphone ou ordinateur. Elle permet de :",
  "fleet.access.once": "Ce lien n’est affiché qu’une fois. Il fonctionne jusqu’au {date}.",
  "fleet.access.send":
    "Envoyez ce lien à {name}. Toute personne qui a le lien peut ouvrir la page : envoyez-le en privé.",
  "fleet.access.station": "Borne",
  "fleet.access.title": "Page employé pour {name}",

  "fleet.add.button": "Ajouter une borne",
  "fleet.add.chargerId": "ID de la borne",
  "fleet.add.chargerIdHint":
    "Certaines bornes ont un ID fixe, souvent leur numéro de série. Saisissez-le ici ; sinon chargeOS en choisit un.",
  "fleet.add.chargerIdPlaceholder": "Laisser vide pour que chargeOS choisisse",
  "fleet.add.checkIdentity": "Vérifier que c’est la bonne borne qui se connecte",
  "fleet.add.firmware": "Firmware",
  "fleet.add.firmwareOptional": "Toute version",
  "fleet.add.lede":
    "chargeOS crée la borne et son mot de passe. Vous remettez ensuite une fiche d’installation à l’installateur.",
  "fleet.add.limit":
    "Ce serveur accepte au maximum {limit} connexions de bornes à la fois. Demandez à votre administrateur d’augmenter CHARGEOS_OCPP_MAX_CONNECTIONS avant que cette borne se connecte.",
  "fleet.add.model": "Modèle",
  "fleet.add.more": "ID de la borne et vérification d’identité",
  "fleet.add.submit": "Créer la borne",
  "fleet.add.title": "Ajouter une borne",
  "fleet.add.vendor": "Marque",

  "fleet.capture.added": "Badge ajouté",
  "fleet.capture.addedBody":
    "Il fonctionne maintenant sur cette borne, tant que la borne est en ligne. Envoyez la liste des badges pour qu’il fonctionne aussi sans internet.",
  "fleet.capture.again": "Réessayer",
  "fleet.capture.alsoOn": "Ce badge fonctionne déjà sur : {stations}",
  "fleet.capture.arming": "Préparation de la borne…",
  "fleet.capture.discard": "Abandonner",
  "fleet.capture.expired":
    "La fenêtre d’enregistrement s’est fermée avant qu’un badge soit présenté.",
  "fleet.capture.later": "Plus tard",
  "fleet.capture.needsOnline":
    "La borne doit être en ligne pour enregistrer un badge en le présentant.",
  "fleet.capture.reference": "Référence",
  "fleet.capture.remaining": "Temps restant : {time}",
  "fleet.capture.start": "Enregistrer un badge",
  "fleet.capture.tapHint":
    "La borne refusera le badge cette fois-ci ; c’est normal. Seul le premier badge présenté compte.",
  "fleet.capture.tapNow": "Présentez le badge à {station}",
  "fleet.capture.tapped": "Badge présenté à {time}",
  "fleet.capture.title": "Enregistrer un badge sur {station}",

  "fleet.connect.passwordSheet":
    "Le mot de passe de la fiche d’installation de cette borne. Il n’est affiché qu’une fois ; créez-en un nouveau sous Bornes s’il est perdu.",
  "fleet.card.ownership": "À qui appartient le badge",
  "fleet.card.ownership.company": "Badge d’entreprise",
  "fleet.card.ownership.companyHint": "Vous seul pouvez le modifier ou le retirer.",
  "fleet.card.ownership.personal": "Badge personnel",
  "fleet.card.ownership.personalHint":
    "L’employé peut le retirer depuis sa page, par exemple le badge d’un partenaire.",
  "fleet.card.unclassified": "Non classé",
  "fleet.card.use": "La recharge avec ce badge est",
  "fleet.card.use.business": "Professionnelle",
  "fleet.card.use.businessHint": "Les recharges peuvent être remboursées.",
  "fleet.card.use.private": "Privée",
  "fleet.card.use.privateHint":
    "Les recharges ne sont jamais remboursées ni envoyées au service financier.",

  "fleet.cards.classify": "Entreprise ou personnel…",
  "fleet.cards.copy": "Utiliser sur d’autres bornes…",
  "fleet.cards.lost": "Badge perdu : retirer partout",
  "fleet.cards.alsoAt": "Enregistré sur {station} · réception non confirmée",
  "fleet.cards.more": "Autres actions",
  "fleet.cards.removeHere": "Retirer de cette borne",
  "fleet.cards.syncAll": "Vérifier la synchronisation",
  "fleet.cards.typeNumber": "Saisir un numéro de badge",

  "fleet.classify.everywhere": "Ceci s’applique au même badge sur chaque borne.",
  "fleet.classify.title": "Classer {name}",

  "fleet.copy.confirm.one": "Ajouter à {count} borne",
  "fleet.copy.confirm.other": "Ajouter à {count} bornes",
  "fleet.copy.hint":
    "Le numéro du badge reste sur le serveur ; rien n’est ressaisi. Envoyez ensuite les listes pour que le badge fonctionne aussi hors ligne là-bas.",
  "fleet.copy.lede": "Choisissez les bornes où ce badge doit aussi fonctionner.",
  "fleet.copy.none": "Ce badge fonctionne déjà sur toutes les bornes.",
  "fleet.copy.title": "Utiliser {name} sur d’autres bornes",

  "fleet.detail.identity-mismatch":
    "Arrêt : la borne qui s’est connectée n’a pas la marque, le modèle ou le firmware attendus. Vérifiez avec l’installateur avant de continuer.",
  "fleet.detail.identity-unchecked": "Non comparée à un modèle attendu.",
  "fleet.detail.readiness-blocked":
    "Dans sa configuration actuelle, la borne ne peut pas garder de badges pour un usage hors ligne. Ouvrez la recharge hors ligne pour les détails.",
  "fleet.detail.restart-required":
    "La borne doit redémarrer avant que la vérification puisse continuer.",
  "fleet.detail.sync-rejected":
    "La borne a refusé la dernière liste de badges. Réessayez, ou vérifiez la recharge hors ligne.",

  "fleet.feed.activeUntil": "Actif jusqu’au {date}",
  "fleet.feed.create": "Créer l’accès financier",
  "fleet.feed.excludes":
    "Jamais de noms, de numéros de badge ni de recharges avec des badges privés",
  "fleet.feed.includes":
    "Recharge professionnelle par borne et par mois, avec des références de badge anonymes",
  "fleet.feed.lede":
    "Permet au service de remboursement de lire chaque mois la recharge professionnelle. L’accès dure 90 jours ; renouvelez-le ici.",
  "fleet.feed.off": "Pas configuré",
  "fleet.feed.renew": "Renouveler pour 90 jours",
  "fleet.feed.renewSoon": "Se termine dans {days} jours",
  "fleet.feed.secretBody":
    "Remettez ceci au service de remboursement. Il n’est affiché qu’une fois ; renouveler en crée un nouveau et met fin à celui-ci.",
  "fleet.feed.title": "Flux de remboursement",

  "fleet.lost.body": "Le badge sera retiré de : {stations}.",
  "fleet.lost.confirm": "Retirer partout",
  "fleet.lost.delay":
    "Chaque borne continue d’accepter le badge hors ligne jusqu’à ce qu’elle reçoive sa nouvelle liste. Envoyez les listes juste après.",
  "fleet.lost.kept":
    "{stations} garde ce badge, car c’est le seul badge de cette borne. Ajoutez-y d’abord un autre badge, puis retirez celui-ci.",
  "fleet.lost.title": "{name} est perdu",

  "fleet.notice.classified": "Classement du badge enregistré.",
  "fleet.notice.copied.one":
    "Badge ajouté à {count} borne de plus. Envoyez la liste de badges pour terminer.",
  "fleet.notice.copied.other":
    "Badge ajouté à {count} bornes de plus. Envoyez les listes de badges pour terminer.",
  "fleet.notice.removedEverywhere.one":
    "Badge retiré de {count} borne. Envoyez la liste de badges pour terminer.",
  "fleet.notice.removedEverywhere.other":
    "Badge retiré de {count} bornes. Envoyez les listes de badges pour terminer.",
  "fleet.notice.removedKept.one":
    "Le badge a été gardé sur {count} borne car c’est son seul badge. Ajoutez-y d’abord un autre badge.",
  "fleet.notice.removedKept.other":
    "Le badge a été gardé sur {count} bornes car c’est leur seul badge. Ajoutez-y d’abord un autre badge.",
  "fleet.notice.retired": "Borne mise hors service. Elle ne peut plus se connecter.",
  "fleet.notice.syncDone.one": "Liste de badges envoyée à {count} borne.",
  "fleet.notice.syncDone.other": "Listes de badges envoyées à {count} bornes.",
  "fleet.notice.syncSomeFailed":
    "Toutes les bornes n’ont pas accepté leur liste de badges : {failed} sur {total} ont refusé. Ouvrez ces bornes pour les détails.",

  "fleet.offboard.button": "Quitte l’entreprise",
  "fleet.offboard.company-keeps": "L’entreprise garde la borne",
  "fleet.offboard.company-keepsHint":
    "Retirer les badges et l’accès de {name}. Attribuer la borne à quelqu’un d’autre plus tard.",
  "fleet.offboard.done": "Fait",
  "fleet.offboard.employee-takes": "{name} emporte la borne",
  "fleet.offboard.employee-takesHint":
    "Retirer les badges de l’entreprise. Les badges personnels de {name} continuent de fonctionner sur sa borne pendant son passage au nouveau système.",
  "fleet.offboard.keptLast": "Gardé sur {stations} : c’est le seul badge là-bas.",
  "fleet.offboard.markEmployee": "Indiquer que {station} appartient à l’employé",
  "fleet.offboard.money":
    "Le remboursement s’arrête à la date de départ dans le service de remboursement ; rien ici ne modifie les relevés.",
  "fleet.offboard.nothing": "Rien à modifier.",
  "fleet.offboard.plan": "Ce qui va se passer",
  "fleet.offboard.question": "Que devient sa borne ?",
  "fleet.offboard.removeCard": "Retirer {name} de {stations}",
  "fleet.offboard.removePersonal": "Retirer aussi ses badges personnels",
  "fleet.offboard.retireLater":
    "Une fois la borne passée à son nouveau système par l’installateur, mettez-la hors service ici pour qu’elle ne puisse plus se connecter.",
  "fleet.offboard.retireStation": "Mettre {station} hors service",
  "fleet.offboard.revokeAccess": "Mettre fin à la page employé de {station}",
  "fleet.offboard.revoked.one": "{count} lien arrêté",
  "fleet.offboard.revoked.other": "{count} liens arrêtés",
  "fleet.offboard.run": "Appliquer",
  "fleet.offboard.syncNext":
    "Envoyez maintenant les nouvelles listes de badges. D’ici là, les badges retirés continuent de fonctionner hors ligne.",
  "fleet.offboard.title": "{name} s’en va",
  "fleet.offboard.trimCard": "Retirer {name} de {stations} (la garder sur sa propre borne)",
  "fleet.offboard.unassign": "Ne plus attribuer {station}",

  "fleet.ownership.company": "Appartient à l’entreprise",
  "fleet.ownership.companyHint": "L’entreprise l’a achetée. Elle reste quand un employé part.",
  "fleet.ownership.companyShort": "À l’entreprise",
  "fleet.ownership.employee": "Appartient à l’employé",
  "fleet.ownership.employeeHint": "L’employé l’a achetée. Elle part avec lui.",
  "fleet.ownership.employeeShort": "À l’employé",
  "fleet.ownership.mark.company": "Indiquer : appartient à l’entreprise",
  "fleet.ownership.mark.employee": "Indiquer : appartient à l’employé",
  "fleet.ownership.question": "À qui appartient la borne ?",

  "fleet.retire.body":
    "La mise hors service empêche cette borne de se connecter. Son historique reste et son ID n’est jamais réutilisé.",
  "fleet.retire.button": "Mettre hors service…",
  "fleet.retire.cards":
    "Les badges déjà présents sur la borne y fonctionnent toujours hors ligne. Ne le faites qu’après le passage de la borne à un autre système ou son arrêt.",
  "fleet.retire.confirm": "Mettre hors service",
  "fleet.retire.title": "Mettre {name} hors service ?",
  "fleet.retire.type": "Tapez {phrase} pour confirmer",
  "fleet.retired.count.one": "{count} borne hors service",
  "fleet.retired.count.other": "{count} bornes hors service",
  "fleet.retired.note":
    "Les bornes hors service ne peuvent pas se connecter. Leur historique est conservé.",
  "fleet.retired.on": "hors service depuis le {date}",

  "fleet.role.driver": "Employé (sa propre borne)",
  "fleet.role.finance": "Finances (flux de remboursement)",
  "fleet.scope.driver": "Sa borne, ses recharges et ses badges personnels.",
  "fleet.scope.finance":
    "Recharge professionnelle mensuelle pour chaque borne. Ni noms ni numéros de badge.",

  "fleet.setup.anyFirmware": "tout firmware",
  "fleet.setup.done.body":
    "Toutes les étapes ont réussi le {time}. La borne a sa liste de badges et les réglages pour charger sans internet. Seul un vrai test sans internet le prouve.",
  "fleet.setup.done.title": "Configuration terminée pour {name}",
  "fleet.setup.expected": "Attendu : {vendor} {model}, {firmware}",
  "fleet.setup.otherWays": "Autres façons d’ajouter un badge",
  "fleet.setup.progress": "Configuration : {done} étapes sur {total} terminées",
  "fleet.setup.reissue": "Créer un nouveau mot de passe",
  "fleet.setup.reissueConfirm":
    "Créer un nouveau mot de passe pour cette borne ? L’ancienne fiche d’installation ne fonctionnera plus.",
  "fleet.setup.reported": "Annoncé : {vendor} {model}, firmware {firmware}",
  "fleet.setup.state.active": "Prête",
  "fleet.setup.state.in-progress": "Installation en cours",
  "fleet.setup.state.stopped": "Arrêtée",
  "fleet.setup.state.waiting-for-charger": "En attente de la borne",
  "fleet.setup.title": "Installer cette borne",

  "fleet.sheet.address": "Adresse du serveur",
  "fleet.sheet.addressUnknown":
    "Demandez à votre administrateur (CHARGEOS_OCPP_PUBLIC_URL n’est pas défini)",
  "fleet.sheet.chargerId": "ID de la borne",
  "fleet.sheet.copied": "Copié",
  "fleet.sheet.copy": "Copier",
  "fleet.sheet.done": "Terminé",
  "fleet.sheet.installer":
    "L’installateur saisit ces données dans l’outil de configuration de la borne. Ouvrir la borne ou modifier son câblage est un travail d’installateur, courant coupé.",
  "fleet.sheet.lede": "Remettez ceci à l’installateur.",
  "fleet.sheet.once":
    "Le mot de passe n’est affiché que maintenant. chargeOS le garde pour reconnaître la borne, mais ne peut plus l’afficher.",
  "fleet.sheet.password": "Mot de passe",
  "fleet.sheet.protocol": "Protocole",
  "fleet.sheet.protocolValue": "OCPP 1.6 JSON, avec cet ID comme nom d’utilisateur",
  "fleet.sheet.title": "Fiche d’installation pour {name}",

  "fleet.step.cards-on-charger.body":
    "Envoyez la liste des badges pour qu’ils fonctionnent aussi sans internet.",
  "fleet.step.cards-on-charger.title": "Badges sur la borne",
  "fleet.step.cards.body": "Présentez le badge à la borne pour l’enregistrer.",
  "fleet.step.cards.title": "Badge enregistré",
  "fleet.step.connected.body":
    "En attente de la connexion de la borne avec sa fiche d’installation. Cela peut prendre quelques minutes après l’enregistrement des réglages par l’installateur.",
  "fleet.step.connected.title": "Borne connectée",
  "fleet.step.identity.body":
    "En attente de la marque, du modèle et du firmware annoncés par la borne.",
  "fleet.step.identity.title": "Informations de la borne conformes",
  "fleet.step.offline-ready.body": "Lit les réglages hors ligne de votre borne, sans les modifier.",
  "fleet.step.offline-ready.title": "Réglages hors ligne vérifiés",
  "fleet.step.test-charge.body":
    "Borne en ligne, rechargez une fois avec un badge enregistré. Cela montre que le badge fonctionne ; le test sans internet vient ensuite.",
  "fleet.step.test-charge.title": "Une recharge faite avec un badge",
  "usage.privatePart": "dont privé : {energy}",
};
