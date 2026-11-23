# Limites et suite

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Limites, dites franchement

- **L'app ne garantit pas la sécurité.** Elle privilégie les voies protégées
  d'après OpenStreetMap. Les données peuvent être incomplètes ou dépassées, un
  chantier peut apparaître. La formulation dans l'interface le dit, et elle doit
  y rester.
- **Les fonds gratuits sont offerts par des tiers** (OpenFreeMap, OpenTopoMap),
  sans garantie de service. Le téléchargement hors ligne y va doucement — une
  tuile à la fois, jamais en rafale — et OpenFreeMap demande au plus 3 000
  tuiles ou 50 Mo par zone : le plafond de 40 Mo par parcours le tient.
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

### À vérifier sur l'iPhone (version 1.1.13)

- **Un GPX reçu** par Messages ou AirDrop doit s'ouvrir avec Lacet (`onOpenedFile`
  dans `native.js`, types déclarés dans `customize.py`), avec la vibration et le
  bandeau d'import.
- **Les flèches de sens** (`arrowIcon`, `MapView.jsx`) : espacées, dans le bon sens,
  lisibles sur le téléphone.
- **Le bilan de sortie**, **les miles** et **les badges relief**.

### Pour vendre l'app : chaque service, vérifié le 23 novembre 2026

Conditions lues sur le site de chaque service. But : rien d'interdit, et rien à
payer tant que l'app reste petite.

| Service | Sert à | Vente autorisée ? | Coût | État |
|---|---|---|---|---|
| OpenFreeMap | Fonds Nuit, Clair, Plan, Fjord, Rues | Oui, sans quota | 0 € | Par défaut depuis le 23 novembre |
| OpenTopoMap | Fond Nature | Oui (CC-BY-SA), usage léger | 0 € | Gardé, plus téléchargé hors ligne |
| Mapbox (jeton) | Satellite, fonds Mapbox, recherche | Oui | 0 € jusqu'à 200 000 tuiles image et 100 000 recherches par mois, puis ~0,50 $ les 1 000 tuiles | Satellite seulement avec jeton |
| CARTO, Esri, openstreetmap.org | Anciens fonds | Non sans clé ni compte | — | **Retirés** |
| IGN (altitude, France) | D+ | Oui, 5 requêtes/s par appareil | 0 € | Gardé |
| AWS Terrain Tiles | Relief 3D, badge relief, altitude hors ligne | Données ouvertes | 0 € | Gardé |
| Valhalla FOSSGIS | Itinéraire de secours | Politique introuvable | — | **Retiré** |
| Valhalla FOSSGIS | Altitude hors de France | Politique introuvable | 0 € | À remplacer par AWS avant la vente hors de France |
| Open-Meteo | Vent | **Non** : gratuit seulement hors usage commercial | Forfait payant, prix non affiché | OK pour une bêta gratuite ; avant Lacet+, passer par MET Norway via un petit relais Cloudflare (gratuit) ou payer |
| Photon (Komoot) | Recherche d'adresse | Rien d'écrit, « usage raisonnable » | 0 € | OK en bêta ; Mapbox à la vente |
| Nominatim | Recherche, dernier recours | Toléré : 1 requête/s, pas d'autocomplétion | 0 € | Appelé seulement quand Photon ne trouve rien |
| Overpass public | Rues hors archives | Usage commercial : instance propre conseillée | 0 € | Secours seulement : les archives couvrent la France |
| GitHub (lacet-data) | Archives de rues | Toléré, coupé si « usage excessif » | 0 € | Passer sur Cloudflare R2 (10 Go et sortie gratuits) avant le lancement |

À faire avant de faire payer, dans l'ordre : le vent (Open-Meteo), les
archives sur R2, l'altitude hors de France, le jeton Mapbox en secret GitHub.
Rien de cela ne coûte d'argent au départ.

- **Choix de la langue** : français ou anglais.

### Bêta, mise de côté pour plus tard

Décidée, mais pas maintenant. À faire dans cet ordre le jour où on la lance :

- Rues téléchargées autour de l'utilisateur et hébergées sur Cloudflare R2, au
  lieu des 122 Mo d'Alsace dans l'IPA (`frontend/public/region`), Overpass en
  secours seulement.
- Compte Apple Developer (99 €/an), signature et envoi vers TestFlight dans
  `.github/workflows/ios.yml`.
- `PrivacyInfo.xcprivacy` et fiche App Privacy « aucune donnée collectée ».
- Justification du GPS en arrière-plan pour la vérification d'Apple.
- Mesures anonymes d'usage (TelemetryDeck) pour suivre activation et rétention.
- **Lacet+** avec RevenueCat : page d'offre, « Restaurer mes achats », un
  interrupteur `isPlus()` et les limites de la version gratuite. Le détail
  des offres et des prix est dans la page « Lancement de Lacet ».

### À évaluer

- **Instructions de virage dans le GPX exporté** (points de parcours Garmin),
  pour qu'une montre les annonce : à garder seulement si l'intérêt se confirme.

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

- **Badge relief partout** : il ne s'affichait que là où une carte hors ligne
  était gardée. Les tuiles d'altitude AWS du départ se téléchargent maintenant
  une fois (`fetchTerrainTiles`, `environment.js`). Seuils calés le 21 novembre
  (`explain.js`). Les miles existent aussi (« Mon compte › Apparence »).
- **Fonds de carte vendables** : CARTO, Esri et openstreetmap.org retirés ;
  Nuit, Clair et Plan passent sur OpenFreeMap, Satellite sur Mapbox (avec jeton).

- **Valhalla public en calcul de secours** : retiré (`remote.js` supprimé).
  Sans rues, l'app le dit au lieu de proposer un tracé non noté.
- **Pages légales** : conditions d'utilisation (la note est une estimation,
  pas une garantie) et confidentialité, dans « Mon compte › À propos ».
- **`.vscode/`** n'est plus suivi par git (il reste ignoré, en local).
- **Le compte de tests** : 1243 aujourd'hui (848 Vitest, 395 pytest).
- **Icône de la doc et de la source AltStore** : celles du nouveau logo.
- **Feuille « Mon compte »** : chargée à l'ouverture seulement.

### À enlever

_(rien pour l'instant)_

### Reporté, et pourquoi

- **Choix de l'icône de l'app** : une icône alternative demande un changement natif (entrées `CFBundleAlternateIcons` et jeux d'icônes générés en compilation). Sans iPhone pour vérifier, c'est trop risqué pour un seul passage.

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
Fonds de carte © OpenFreeMap, © OpenMapTiles, © OpenTopoMap, © Mapbox · Altitudes IGN RGE ALTI, Valhalla (FOSSGIS) dans l'app,
OpenTopoData dans le moteur de référence
