# Limites et suite

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Limites, dites franchement

- **L'app ne garantit pas la sécurité.** Elle privilégie les voies protégées
  d'après OpenStreetMap. Les données peuvent être incomplètes ou dépassées, un
  chantier peut apparaître. La formulation dans l'interface le dit, et elle doit
  y rester.
- **Les tuiles CARTO** sont gratuites pour un usage raisonnable, pas pour une app
  distribuée à grande échelle. Prévois MapTiler, Mapbox ou Protomaps auto-hébergé.
  Le téléchargement hors ligne y va d'ailleurs doucement — une tuile à la fois,
  jamais en rafale — pour la même raison.
- **Une carte hors ligne pèse lourd en ville** : compter une quinzaine de
  mégaoctets pour une boucle de 10 km en plein centre, contre un ou deux à la
  campagne. C'est le prix des bâtiments et des commerces dans chaque tuile ; le
  plafond de 40 Mo par parcours empêche seulement que cela dérape.
- **Overpass est une ressource publique partagée.** Pour de la production, il
  faut héberger sa propre instance ou passer à un extrait OSM local.
- **Attribution OpenStreetMap obligatoire** (licence ODbL), à l'écran et dans les
  fichiers GPX exportés. C'est déjà fait, ne le retire pas.

## Reste à faire

Tiré de l'analyse complète du 10 novembre 2026. Les corrections et le nouvel
écran de fin sont livrés depuis la version 1.0.98 ; voici ce qui ne l'est pas.

### À vérifier sur l'iPhone (version 1.0.98)

Rien de ceci n'a pu être éprouvé hors du téléphone :

- **Le partage en image** depuis l'écran de fin : l'écriture du PNG et la
  feuille de partage d'iOS (`shareCard.js`, `shareImage` dans `native.js`). Si
  l'image échoue, le texte doit partir à sa place.
- **Le profil monté**, calé sur l'altitude du GPS au départ puis suivi au
  baromètre (`baroAltitude`, `LiveRun.jsx`). Le baromètre lui-même n'a jamais
  été éprouvé sur l'appareil.
- **La trace coloriée par allure** sur une vraie sortie : que les arrêts aux
  feux ne passent pas pour des coups de mou, et que les couleurs se lisent.
- **Une reprise après coupure** : la date, le temps d'arrêt et le recalcul
  doivent survivre à l'app fermée en pleine sortie, et à « Pas fini ? Reprendre ».
- **Le poids d'une sortie** : la trace porte désormais l'heure et l'altitude de
  chaque point, environ un tiers de plus. À relire dans « Mon compte », après
  quelques sorties, contre le plafond de vingt-cinq sorties complètes.
- **La longue liste** de « Mes parcours » : soixante lignes puis « Afficher les
  suivantes ». Le gain n'a pas été mesuré sur un historique de plusieurs
  centaines de sorties.

### Ce qui existe et peut mieux faire

- **Allure visée à la voix** : « dix secondes trop lent » à chaque kilomètre,
  quand une allure est réglée. L'écran de fin la compare déjà après coup
  (`Splits`, `RunDetail.jsx`) ; en course, rien ne le dit.
- **Objectif de la semaine** : un trait sur le graphique « Volume par semaine »
  (`WeeklyVolume`, `Library.jsx`), qui n'a aujourd'hui aucun repère.
- **Détail d'une sortie passée** : la barre de recherche de lieu reste affichée
  au-dessus, sans raison (`App.jsx`, `stage__top`).
- **Filtre des mois** : le menu flotte seul sur sa ligne ; à ranger avec les
  pastilles d'activité (`histfilter`, `Library.jsx`).
- **Lien du SMS au proche** : Google Maps aujourd'hui (`mapLink`, `contact.js`) ;
  un lien Apple Plans s'ouvre sans rien installer sur un iPhone.
- **Poids du paquet** : un seul fichier JS de 1,47 Mo. Charger « Mon compte » et
  les filtres à la demande (`import()`) accélère le lancement.
- **Sorties anciennes** : elles n'ont ni heures ni altitudes par point, donc ni
  trace coloriée ni profil. Rien à rattraper — à savoir, c'est tout.

### À ajouter

- **Séance du jour, version simple** : « 6 × 400 m, récup 1 min », minutée à la
  voix sur n'importe quelle boucle.
- **Séance du jour, version complète** : « 6 × 400 m » → une boucle qui contient
  une ligne droite plate de 400 m près de chez toi. Personne ne le fait
  correctement aujourd'hui.
- **Bilan du mois** : une page de synthèse (kilomètres, D+, plus longue sortie,
  régularité), à partager en image comme une sortie.
- **Records sur semi et marathon** : l'écran de fin s'arrête à 1, 5 et 10 km
  (`BEST_KM`, `knownRoutes.js`).
- Partage live d'une sortie en cours, couche communautaire de signalements avec
  seuil anti-abus : il y faut un serveur.

### À enlever

- **Les alphabets cyrillique, grec et vietnamien de la police Inter** : environ
  250 Ko dans l'IPA pour une app en français. N'importer que le latin.
- **`.vscode/`**, suivi par git, s'il ne sert plus.
- **Le compte de tests du README** : il annonce 1169 tests ; il y en a 1194
  (799 Vitest, 395 pytest).

### Écartés, et pourquoi

- **Apple Watch et Apple Santé** : impossibles sans compte développeur payant
  (signature d'une app watchOS, droits HealthKit).
- **Cardio Bluetooth** : un plugin natif de plus pour peu d'usage.
- **Heatmap** : données propriétaires.

---

Données cartographiques © contributeurs OpenStreetMap (ODbL) ·
Fonds de carte © CARTO · Altitudes IGN RGE ALTI, Valhalla (FOSSGIS) dans l'app,
OpenTopoData dans le moteur de référence
