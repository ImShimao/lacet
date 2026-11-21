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

Rien de ceci n'a pu être éprouvé hors du téléphone. La marche à suivre pour chaque point est dans [À vérifier sur l'iPhone](a-verifier-iphone.md) :

- **Le partage en image** (`ShareSheet.jsx`, `shareCard.js`, `shareImage` dans
  `native.js`) : l'écriture du PNG et la feuille de partage d'iOS ; si l'image
  échoue, le texte doit partir à sa place. Et « Copier » : un PNG transparent
  dans le presse-papiers depuis la vue web, puis collé dans une story Instagram
  ou Snapchat, qui doit garder sa transparence.
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

- **Poids du paquet** : un fichier JS de 1,48 Mo, dont l'essentiel est MapLibre,
  nécessaire dès l'ouverture de la carte. « Mon compte » est déjà chargé à la
  demande (28 ko de moins au lancement) ; le reste ne se découpe pas sans gain.
- **Sorties anciennes** : elles n'ont ni heures ni altitudes par point, donc ni
  trace coloriée ni profil. Rien à rattraper — à savoir, c'est tout.

### À ajouter

- Partage live d'une sortie en cours, couche communautaire de signalements avec
  seuil anti-abus : il y faut un serveur.

### Fait

- **`.vscode/`** n'est plus suivi par git (il reste ignoré, en local).
- **Le compte de tests** : 1243 aujourd'hui (848 Vitest, 395 pytest).
- **Icône de la doc et de la source AltStore** : celles du nouveau logo.
- **Feuille « Mon compte »** : chargée à l'ouverture seulement.

### À enlever

_(rien pour l'instant)_

### Reporté, et pourquoi

- **Système de mesure km / miles** : `km()` et les allures sont appelés à une quarantaine d'endroits, dont la voix, le partage et les champs de saisie du moteur, qui restent en métrique. Le faire en une fois cassait des tests et laissait des écrans incohérents. À traiter comme un chantier à part, avec une décision sur la saisie.
- **Choix de l'icône de l'app** : une icône alternative demande un changement natif (entrées `CFBundleAlternateIcons` et jeux d'icônes générés en compilation). Sans iPhone pour vérifier, c'est trop risqué pour un seul passage.
- **Seuils du badge relief** (Probable / Possible / Peu probable) : leur calibrage demande des dizaines de recherches réelles sur OpenStreetMap, puis de juger les boucles obtenues. À faire avec du temps devant soi.

### Écartés, et pourquoi

- **Apple Watch et Apple Santé** : impossibles sans compte développeur payant
  (signature d'une app watchOS, droits HealthKit).
- **Cardio Bluetooth** : un plugin natif de plus pour peu d'usage.
- **Heatmap** : données propriétaires.
- **Lien Apple Plans dans le SMS au proche** : c'est le proche qui ouvre le
  lien, peut-être sur Android. Le lien Google Maps (`mapLink`, `contact.js`)
  s'ouvre partout.

---

Données cartographiques © contributeurs OpenStreetMap (ODbL) ·
Fonds de carte © CARTO · Altitudes IGN RGE ALTI, Valhalla (FOSSGIS) dans l'app,
OpenTopoData dans le moteur de référence
