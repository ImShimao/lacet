# Recon : les apps de boucles et de guidage de course (iPhone)

Périmètre : la génération de boucles, le choix d'une proposition, le guidage pendant la sortie et ce
qui l'entoure (sécurité, hors ligne, export). Pas le social, pas les plans d'entraînement.
Pour : Lacet — savoir ce que les autres font, ce que leurs utilisateurs leur reprochent, et ce que
Lacet doit faire ensuite.
Date : 2026-10-18. Sources publiques uniquement : sites, fiches App Store, aide en ligne, presse,
avis via le flux RSS officiel d'Apple. Aucun compte utilisé, rien de décompilé.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | RunnrZ, site | https://www.runnrz.app/en/ | moteur « RunGenius », SOS, historique |
| 2 | RunnrZ, App Store | https://apps.apple.com/us/app/runnrz-running-routes/id1599120893 | v2.4.1, nouveautés 2.3–2.4, abonnement 5,99–6,99 $/mois |
| 3 | Roovr, site | https://roovr.app/ | GraphHopper + OSM, direction N…NO, aperçu 3D, gratuit |
| 4 | Roovr vs Strava | https://roovr.app/compare/strava-routes-alternative/ | positionnement « gratuit, sans compte » |
| 5 | Roovr, fiche (miroir) | https://chrome-stats.com/d/id6764648385 | v1.0.6, mai 2026 |
| 6 | Trail Router, App Store | https://apps.apple.com/us/app/-/id1500479574 | nature, rues éclairées, peu de côtes ; passé à MapLibre en 2026 |
| 7 | RunGo, site | https://rungoapp.com/ | guidage vocal, notes vocales perso, 1 M de parcours |
| 8 | Footpath, guide | https://footpathapp.com/user-guide/drawing-a-route/ | tracé au doigt, aimanté aux rues |
| 9 | RunGen, App Store | https://apps.apple.com/us/app/id1514017009 | générateur aléatoire, Pro à 0,99 $ |
| 10 | Routeshuffle | https://routeshuffle.com/ | générateur web aléatoire |
| 11 | Strava, presse 2025 | https://press.strava.com/articles/strava-unveils-suite-of-new-subscriber-features | Routes « IA » sur la heatmap, POI, point à point |
| 12 | Strava, heatmaps nuit et semaine | https://the5krunner.com/2024/11/14/strava-launches-night-and-weekly-heatmaps-for-enhanced-route-planning/ | heatmap du coucher au lever du soleil |
| 13 | Strava Routes, lancement | https://the5krunner.com/2020/03/24/new-strava-heatmap-driven-routes-major-feature/ | boucles depuis la heatmap |
| 14 | Strava sur Apple Watch | https://www.macrumors.com/2026/01/26/strava-apple-watch-app-route-navigation/ | navigation au poignet (bêta) |
| 15 | Komoot, refonte 2025 | https://www.bikeradar.com/news/komoot-redesign-2025 | rachat Bending Spoons, prix, feuille de route |
| 16 | Komoot, aide planification | https://support.komoot.com/hc/articles/10194270667034 | sports, types de voies, surfaces |
| 17 | Garmin Connect, parcours | https://androidauthority.com/garmin-route-planner-3243313 | aller-retour auto + Trendline |
| 18 | Apple Plans, itinéraire perso | https://www.tapsmart.com/tips-and-tricks/custom-walking-routes/ | « Aller-retour » / « Fermer la boucle », iOS 18 |
| 19 | AllTrails Peak | https://www.alltrails.com/press/alltrails-expands-membership-offering-with-alltrails-peak | itinéraires perso, « smart routing » IA, 80 $/an |
| 20 | AllTrails, essai | https://www.outdoorlife.com/gear/alltrails-peak-preview/ | limites de la boucle IA |
| 21 | Mapy.com | https://www.apkmirror.com/apk/seznam-cz-a-s/mapy-cz-navigation-off-maps/mapy-com-offline-outdoor-maps-26-7-2-release/ | itinéraire circulaire, alertes de passages difficiles |
| 22 | LIT Run | https://www.litrun.co.uk/ | notes communautaires (éclairage, affluence), suivi par 3 contacts |
| 23 | Safetipin et autres | https://en.wikipedia.org/wiki/Safetipin | score de sécurité participatif |
| 24 | Walkable | https://apps.apple.com/us/app/walkable-safe-route-planner/id6762026493 | score 0–100 éclairage, affluence, visibilité |
| 25 | Avis App Store | `reviews.csv` | 764 avis de 9 apps, flux `itunes.apple.com/{us,fr,gb}/rss/customerreviews` |
| 26 | Strava, State of the Map 2024 | https://pretalx.com/sotm2024/talk/HVVYM7/ | un ingénieur Strava : graphe d'arêtes OSM, popularité par arête, traces alignées |
| 27 | Strava × Mapbox, 2019 | https://www.bikeradar.com/news/strava-and-mapbox-worldwide-map-upgrade | carte conçue avec Mapbox, données OSM |
| 28 | Strava rachète FATMAP | https://geoweeknews.com/news/tech-news-strava-acquires-3d-mapping-platform-fatmap | janvier 2023, cartographie 3D |
| 29 | Strava, rendu maison | https://www.advnture.com/news/strava-announces-updates-april-2025 | avril 2025 : moteur de rendu sur FATMAP, relief 3D, satellite, hiver |
| 30 | Strava, Routes 2025 | https://endurance.biz/2025/industry-news/strava-adds-ai-powered-routing-and-leaderboard-updates-for-summer-2025/ | suggestions « IA » tirées de la heatmap |
| 31 | GraphHopper, API | https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md | `algorithm=round_trip`, `round_trip.distance`, `round_trip.seed`, `heading` |
| 32 | openrouteservice, boucles | https://ask.openrouteservice.org/t/description-of-round-trip-feature/4170 | `round_trip` : `length`, `points`, `seed` ; 21 km demandés, 38 km rendus ([fil](https://ask.openrouteservice.org/t/directions-api-accurate-target-distance-response/7475)) |
| 33 | Indice vert par rue | https://github.com/redfrexx/green_index | HeiGIT : verdure par arête OSM (Sentinel-2), pour les itinéraires « verts » d'openrouteservice |

## Le panorama

| app | ce qu'elle fait | prix | force | faiblesse (avis) |
| --- | --- | --- | --- | --- |
| **Strava** | Routes suggérées sur la heatmap, tracé manuel, POI, heatmaps nuit/semaine, Beacon | abonnement | les données de 3 milliards d'activités | réseau social d'abord, tracé manuel buggé, carte payante |
| **Komoot** | planificateur multi-sport, types de voies et surfaces, Highlights, navigation, hors ligne | ~60 €/an | richesse des données de terrain | refonte 2025, prix, guidage confus, chemins fermés, pas de recalcul utile |
| **Garmin Connect** | aller-retour auto par distance + direction, Trendline | gratuit (montre) | popularité réelle | lié à la montre |
| **Apple Plans** | itinéraire à la main, « Fermer la boucle », hors ligne | gratuit | intégré à iOS | il faut poser les points soi-même |
| **AllTrails** | sentiers, itinéraires perso, IA « plus court, moins raide, plus beau » | 36–80 $/an | catalogue de sentiers | chemins inexistants, plantages hors ligne |
| **RunnrZ** | boucles par distance/durée/allure/niveau/terrain, 5 propositions, voix, SOS, historique | payant depuis 2026 | le plus proche de Lacet, en français | compte obligatoire, chemins privés, voix erratique, paywall |
| **Roovr** | boucle depuis la position, terrain, dénivelé, **direction**, aperçu **3D**, GPX/Strava | gratuit, sans compte | simplicité, 3D | pas de guidage, réseau requis |
| **Trail Router** | boucles vertes, rues éclairées, peu de côtes, voix, recalcul | gratuit | préférence nature | voix « intermittente », distances fausses, traverse des grands axes |
| **RunGo** | parcours guidés à la voix, notes vocales perso, courses vérifiées | premium | qualité de la voix (quand elle marche) | voix qui s'arrête, pas de recalcul |
| **Footpath** | tracé au doigt aimanté aux rues | Elite payant | rapidité du tracé | grands axes sans trottoir, hors parcours abusif |
| **RunGen, Routeshuffle** | boucle aléatoire à une distance | gratuit / 1 $ | zéro réglage | abandonnées ou sommaires |
| **LIT Run, Safetipin, Walkable, SafeRoute** | sécurité perçue : éclairage, affluence, criminalité, contacts | gratuit | angle « coureuses, la nuit » | données participatives clairsemées, pas de génération de boucle |

Personne ne réunit les trois : **génération de boucles + note de sécurité calculée + guidage hors
ligne**. Les générateurs (RunnrZ, Roovr, Trail Router) ne notent pas la sécurité ; les apps de
sécurité (LIT Run, Walkable) ne génèrent pas de boucles ; les gros (Strava, Komoot) ne refusent
rien, ils recommandent.

## Cartes et itinéraires : comment ils font

Ajouté le 2026-10-19. Toutes ces apps empilent les mêmes quatre couches ; elles ne diffèrent que par
ce qu'elles mettent dans chacune.

```
1. fond de carte     un moteur de rendu (Mapbox, MapLibre, MapKit) + des tuiles (vectorielles ou images)
2. données de rues   presque toujours OpenStreetMap
3. moteur            un graphe des rues, un coût par arête, un plus court chemin (Dijkstra, A*)
4. génération        des points de passage autour du départ, reliés par le moteur
   (+ altitude : un modèle numérique de terrain ; + guidage : la position recalée sur le tracé)
```

| app | fond de carte | rues | moteur, coût des arêtes | boucle | où ça calcule | confiance |
| --- | --- | --- | --- | --- | --- | --- |
| **Strava** | Mapbox (2019), puis rendu maison bâti sur FATMAP (avril 2025) : relief 3D, satellite, hiver | OSM | maison ; chaque arête OSM porte une **popularité** tirée de plus d'un milliard d'activités alignées dessus | suggestions « IA » dans la heatmap ; tracé manuel aimanté vers le plus fréquenté | serveur | haute (ingénieur Strava, n° 26) ; moyenne pour le rendu |
| **Roovr** | non dit ; aperçu 3D | OSM | **GraphHopper** (« Powered by GraphHopper ») | « pose des points clés autour de toi et les relie », cap N…NO ou auto, nouvelle variante à chaque tirage | serveur : « generating a loop requires connectivity » | haute |
| **RunnrZ** | non dit ; plan, satellite, relief, 3D (1.3.1), refait « sur les technologies Apple » (2.0) → probablement MapKit | non dit (« cartographie ultra-détaillée ») | « RunGenius », non publié | 5 propositions ; points de passage et zones exclues depuis 2.3 | serveur (avis « erreur réseau ») | faible : rien n'est publié |
| **Trail Router** | MapLibre (2026) | OSM | préfère parcs, forêts, bords d'eau, évite les grands axes — sans doute un **indice vert** par arête, comme openrouteservice (n° 33) | non publié | serveur | moyenne |
| **Lacet** | MapLibre ; CARTO, OpenFreeMap, OSM, OpenTopoMap, Esri (+ Mapbox avec un token) | OSM : archives `lacet-data`, Overpass en secours | Dijkstra maison, coût = longueur × (1 + λ·risque) × surface × nuit (`weights.js`) | polygones réguliers orientés, **un seul** Dijkstra, candidats notés A/B/C | **le téléphone**, hors ligne | — |

### Les trois recettes de boucle

1. **Des points sur un cercle** — GraphHopper (`algorithm=round_trip`, `round_trip.distance`,
   `round_trip.seed`, `heading`), openrouteservice (`round_trip` : `length`, `points`, `seed`), et
   donc Roovr. On pose *n* points autour du départ, espacés d'environ longueur ÷ *n*, dans une
   direction tirée au hasard (la graine) ou imposée (le cap), puis on route de l'un à l'autre. Peu
   cher, mais la distance n'est qu'un souhait : un point tombé de l'autre côté d'une rivière fait
   rendre 38 km pour 21 demandés (n° 32), et rien n'empêche les allers-retours.
2. **La popularité** — Strava, Garmin Trendline. Même mécanique, mais le coût d'une arête vient des
   passages réels. C'est leur seul avantage que Lacet ne peut pas copier : les données sont celles de
   leurs utilisateurs (voir *Hors périmètre*).
3. **Lacet** — la recette 1 en plus robuste : polygones réguliers au lieu d'un cercle, un Dijkstra
   unique pour tous les sommets, des candidats notés et rognés à la distance, la sécurité dans le
   coût (`docs/generation.md`).

### Ce que Lacet en retient

- Données, moteur et génération : Lacet est au niveau, et seul à tout calculer **hors ligne**. Roovr
  et RunnrZ ne génèrent rien sans réseau.
- **Écart visible : le relief en 3D.** Strava et Roovr drapent la boucle sur les montagnes ; Lacet
  incline la carte, mais à plat — `frontend/src` n'a aucune source `raster-dem`. MapLibre le fait
  nativement (source `raster-dem` + `map.setTerrain`, couche `hillshade`), avec des tuiles
  d'altitude gratuites et sans clé (Terrain Tiles, registre Open Data d'AWS, encodage `terrarium`).
  Taille **S**. Utile là où ça monte : Guebwiller, les Vosges.
- Un **indice vert** par arête (n° 33) donnerait la préférence « nature » de Trail Router à partir
  des seules données OSM (parcs, forêts, eau à moins de 100 m). Taille **M**, et c'est un calcul
  partagé : Python et JS, avec la parité.

## La boucle cœur

« Je veux courir 10 km depuis chez moi, maintenant, sans réfléchir au trajet et sans me perdre. »
Tout le reste — terrain, dénivelé, direction, partage — sert à rendre ce choix plus juste.

## Écrans (catégorie)

| ID | écran | où on le trouve | rôle | composants | état chez Lacet |
| --- | --- | --- | --- | --- | --- |
| S01 | Carte d'accueil | tous | position, point de départ | carte, recherche, bouton position | `Explore.jsx`, `SearchBar.jsx` |
| S02 | Critères | RunnrZ, Roovr, Strava | distance/durée, allure, terrain, dénivelé, direction, niveau | puces, curseurs | `FiltersSheet.jsx`, direction et D+ visé compris |
| S03 | Propositions | RunnrZ (5), Strava (3), Roovr (glisser) | comparer | cartes glissables, tracés superposés | 3 à 12, pointillés, noms propres |
| S04 | Détail d'une boucle | tous | profil, surfaces, D+, durée | profil, % surfaces | bande sécurité + profil, eau, note |
| S05 | Aperçu 3D / survol | Roovr, Footpath | « voir » la boucle avant | carte inclinée animée | **absent** |
| S06 | Éditeur de tracé | Footpath, Strava, Komoot, Apple Plans, RunnrZ 2.3 | points de passage, zones à éviter | marqueurs déplaçables | **absent** (signalements ponctuels seulement) |
| S07 | Course guidée | RunnrZ, RunGo, Trail Router, Komoot | consigne, chrono, carte suiveuse | bandeau de virage, chiffres | `LiveRun.jsx` + activité en direct |
| S08 | Hors parcours | RunnrZ 2.4, Trail Router, Komoot | alerte, recalcul | bandeau, voix | `routeTracker.js`, `reroute.js` |
| S09 | Fin de sortie | tous | bilan | stats, trace | `RunSummary.jsx` |
| S10 | Historique, favoris | tous | revoir, relancer | listes, filtres mois/sport | `Library.jsx` |
| S11 | Réglages voix | RunnrZ 2.4 (« personnalisable »), RunGo | fréquence, annonces | interrupteurs | marche/arrêt seulement |
| S12 | SOS / suivi par un proche | RunnrZ, LIT Run, Strava Beacon, Garmin LiveTrack | sécurité | bouton maintenu, contacts | SOS SMS ; **pas de « je pars / je suis rentré »** |
| S13 | Heatmap | Strava, Garmin, Komoot (prévu) | popularité | couche carte | hors périmètre (données propriétaires) |

## Parcours

```
F01 Partir courir depuis chez soi
    Roovr : ouvrir -> distance -> générer -> glisser -> (export montre)       3 touches, pas de guidage
    RunnrZ : ouvrir -> (connexion) -> critères -> générer -> choisir -> go     4–5 touches + compte
    Lacet : ouvrir -> « Trouver ma boucle » -> choisir -> « Démarrer »         2–3 touches, sans compte
    edge : pas de réseau, pas de GPS précis, aucune boucle sûre possible

F02 Varier : « une autre »
    Roovr, RunGen : régénérer à l'infini.  Lacet : « Régénérer » tourne les polygones (nombre d'or).

F03 Chemin fermé pendant la sortie
    RunnrZ : signaler -> l'app insiste sur le même chemin, puis passe en course libre (avis 2.4.1)
    Komoot : « faites demi-tour » sans itinéraire de contournement (avis)
    Lacet : signaler -> le point est écarté -> recalcul immédiat qui tient la distance

F04 Abandonner et rentrer (blessure, orage, nuit)
    RunnrZ 2.4 : « parcours retour ». Footpath : il faut arrêter et recréer un itinéraire (avis).
    Lacet : « Rentrer au départ », dans `LiveRun.jsx`.

F05 Préparer à l'avance, ailleurs
    RunnrZ, Roovr, Lacet : départ depuis une adresse. Lacet garde rues et fond de carte hors ligne.

F06 Envoyer à la montre
    Roovr : GPX + Strava direct. RunnrZ : GPX devenu payant (avis). Lacet : GPX par la feuille de partage.
```

## Composants récurrents

| composant | variantes | états | utilisé sur |
| --- | --- | --- | --- |
| Puces de distance | 5 km, 10 km, semi, marathon, libre | choisi, désactivé | S02 |
| Sélecteur de direction | N…NO + Auto (Roovr), direction de départ (Garmin) | — | S02 |
| Carte de proposition | distance, D+, durée, note | choisie, en pointillé | S03 |
| Profil altimétrique | simple ; avec surfaces superposées (Komoot) | survol au doigt | S04, S07 |
| Bandeau de virage | flèche, distance, rue | maintenant, à venir | S07 |
| Bouton SOS | appui maintenu, double-tap silencieux (LIT Run) | armé, envoyé | S07, S12 |
| Marqueur de point de passage | départ, via, arrivée | déplaçable | S06 |

## Modèle de données déduit (la requête de boucle)

```
LoopRequest  start, distance | duration + pace, terrain (route|mixte|sentier),
             relief (plat|vallonné|côtes) ou D+ cible (RunnrZ : demandé, absent),
             direction (Roovr, Garmin), level (RunnrZ : débutant|régulier|avancé),
             count (RunnrZ 5, 50 payant ; Strava 3), via[] et avoid[] (RunnrZ 2.3)
             evidence : S02 de chaque app, fiche App Store RunnrZ 2.3.0
             confidence : high
Report       point, kind (fermé | privé | travaux), date — RunnrZ 2.4 « signaler » ; Lacet `reports.js`
             confidence : high
```

Lacet a tout : `start`, `distance | duration + pace`, `terrain`, `relief` ou D+ visé, `direction`,
`count`, `reports`, et un point de passage (appui long).

## Matrice

Voir `features.csv` : 52 lignes. Must 17, should 17, could 18 (dont 3 skip).
Lacet : 38 oui, 2 partiels, 9 non. **Tous les « must » et « should » sont faits**, sauf les réglages
de la voix (partiels) ; il reste des « could », dont le relief 3D.

## Hors périmètre

- **Heatmaps et popularité** (Strava, Garmin Trendline) : ce sont les activités de leurs
  utilisateurs. Les tuiles de heatmap ne sont pas réutilisables (conditions d'usage) ; Trail Router
  a d'ailleurs retiré sa couche Strava en 2025.
- **Contenu communautaire** : Highlights et photos de Komoot, parcours vérifiés de RunGo, notes de
  LIT Run, défis entre amis de RunnrZ. Il faut un réseau et une modération ; Lacet n'a pas de serveur,
  par choix.
- **Apple Santé** : AltStore n'active pas HealthKit (voir `docs/app-iphone.md`).

## Taille

Écrans 13, parcours 6, entités 2. Parties dures : un éditeur de points de passage qui reste une
*boucle* ; une montre (watchOS natif, signature AltStore) ; un suivi en direct sans serveur.
Ce qui manque à Lacet est de taille **M** (quelques semaines) ; voir `fixes.md`.
