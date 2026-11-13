---
type: categorie
tags: [moteur, algorithme]
---

# Moteur : génération et notation des boucles

Retour : [[Accueil]] · Source : `docs/architecture.md`, `docs/generation.md`

Le moteur tourne dans un worker sur le téléphone. Il existe en deux versions qui doivent donner la même réponse.

## Deux moteurs, un oracle

- **JS** (ce que l'app exécute) : `frontend/src/engine/`. Entrée `planLoops` (`service`), appelée par `client.js` via `worker.js`. Typé, sans allocation dans Dijkstra.
- **Python** (référence) : `backend/app/`. Entrée `plan_loops` (`service.py`). C'est là que chaque seuil est justifié et testé. Plus de serveur : il sert à la vérification, pas à la production.
- Pourquoi garder Python : le JS note la **sécurité**. Subtilement faux, il proposerait un A là où il faut un C, et rien à l'écran ne le montrerait.
- Parité : `backend/scripts/parity_dump.py` fait tourner Python sur dix cas réels (Beaune, Lyon, damiers ; jour, nuit, vent, vélo, tours) et écrit `expected.json.gz`. `engine/parity.test.js` exige le même graphe, les mêmes candidats arête par arête et la même réponse, à 1e-9 près.
- Un changement de calcul partagé = Python **et** JS, puis `parity_dump.py`, puis `parity.test.js`. `parity_dump.py --check` vérifie que l'oracle est à jour ; la CI le lance à chaque push.

## Arithmétique CPython

Reproduite dans `engine/py.js` : `pymod`, `pyfloordiv`, `pyRound`, `pyRoundInt` (arrondi au pair), `pySum`, `pyHypot`. Vérifiée par `py.test.js` contre `__fixtures__/numbers.json`, écrit par `parity_numbers.py`. À utiliser à la place de `%`, `Math.floor(a / b)`, `Math.round` ou d'une somme naïve.

## Étapes et fichiers

| Étape | JS (`engine/`) | Python (`backend/app/`) |
|---|---|---|
| Graphe | `graph` | `osm/build_graph`, `osm/Edge` |
| Plus court chemin | `dijkstra` | `routing/dijkstra`, `astar` |
| Poids et profil | `weights` | `routing/build_profile`, `routing/weights` |
| Polygones et boucles | `loops` | `routing/loops`, `waypoint_plan`, `sweep_gate` |
| Sécurité | `safety` | `safety/` (voir [[Securite]]) |
| Note et classement | `service` | `service.py` |
| Guidage | `navigation`, `buildInstructions` | `navigation.py`, `build_instructions` |
| Recalcul en course | `reroute`, `planRejoin` | (JS seulement) |
| Trace GPS | `matcher`, `routeTracker` | (JS seulement) |
| Départ devant la porte | `door.js` | (JS seulement, propre à l'app) |

## Génération : la boucle est un polygone

Une boucle est un polygone dont le départ est un sommet. Trois nombres la décrivent : forme, taille, orientation.

1. **Un seul Dijkstra** depuis le départ : distance réseau et coût pondéré pour tous les nœuds atteignables.
2. **Un index** : pour chaque direction (tranches de 5°) et chaque bande de distance, le nœud le moins cher au mètre.
3. **Les polygones** (triangle à 40°, carré à 15°, hexagone à 0°…), leurs points de passage reliés par A*.
4. **Portail L3, dédoublonnage, altitude, notation.**

**Où sont les points de passage.** Le départ étant un sommet, les autres points sont du même côté : ils s'étalent sur (m−2)·180/m degrés, à des distances inégales. Répartis sur 360°, le départ tomberait au centre et la rondeur chuterait à 0,03.

| Forme | Points | Étalement | Rondeur idéale |
|---|---|---|---|
| Triangle | 2 | 60° | 0,605 |
| Carré | 3 | 90° | 0,785 |
| Pentagone | 4 | 108° | 0,865 |
| Hexagone | 5 | 120° | 0,907 |

Deux garde-fous : une **zone centrale interdite** (rayon 0,45 × la distance au premier point, une interdiction plutôt qu'une pénalité) et un **couloir de progression** angulaire qui évite de repasser dans un quartier déjà parcouru.

**Distances sur le réseau.** Le réseau impose un détour d'environ 1,3 × la distance à vol d'oiseau. Viser les distances en distance réseau donne directement la bonne longueur.

**Mesuré** (panel de huit départs × trois distances) : itinéraires rendus 61 → 115, rondeur médiane 0,30 → 0,471, recherches vides 6/24 → 0/24, temps médian 8,1 s → 3,3 s, maximum 72 s → 19 s.

### Pas d'épingle, pas de lasso

- `_trim_spurs` (`SPUR_MAX_M` = 150 m) : tout ce qui ramène au même carrefour en moins de 150 m est rogné. Un tour d'étang en fait plusieurs centaines.
- `SAME_SPOT_M` = 10 m : deux nœuds reliés par une arête courte sont le même carrefour.
- Mesuré sur 48 boucles : 11 épingles (1,1 km) avant, aucune après. Le recouvrement passe de 1,9 à 1,4 km.
- Le point demandé par l'utilisateur n'est jamais rogné.

### Le tour des ronds-points

À pied, le chemin le plus court prenait l'anneau dans un sens au hasard. On le contourne par le trottoir, du côté de la route choisi (gauche par défaut). `keep_side` (`keepSide`) remplace le passage de l'autre côté par l'autre moitié de l'anneau quand elle n'est pas plus de 1,6 fois plus longue, ou pas plus de 20 m sur un petit rond-point. Mesuré : 44 passages, « en face » du côté gauche 22 fois sur 24. À vélo, l'anneau est à sens unique et rien ne change.

### Passer par un point

`via` dans `normalizeRequest` (propre à l'app, Python n'a pas de point de passage). Le point se rattache à la voie la plus proche du réseau principal (300 m au plus), oriente les polygones (±45°), et s'insère dans leurs sommets (`threadVia`). Piège trouvé à Beaune : repartir par la rue d'arrivée coûte mille fois sa longueur juste après le point.

Trop loin : plus de 42 % de la boucle à vol d'oiseau, la recherche s'arrête et le dit.

## Choix des propositions

- **« Régénérer »** tourne les polygones d'une fraction du nombre d'or, jamais le même angle deux fois, et pénalise les directions déjà montrées. Un cran de note retire 0,9 ; la ressemblance au plus 0,75.
- **Chaque recherche varie** : une graine au sort par recherche (`seed`, `App.jsx`). Un tirage supplémentaire polygones tournés s'**ajoute** au tirage ordinaire (remplacé, un lot changeait du tout au tout : Guebwiller à 5 km, −1,73 → −2,58). Un hasard de 0 à 0,1 sur le choix final (`SEED_JITTER`).
- **Mémoire des boucles montrées** : les dix dernières par départ, en tracés légers (`rememberShown`, `knownRoutes.js`). Recul de 0,5 au choix pour une boucle qui en suit une sur les deux tiers (`FAMILIAR_PENALTY`).
- **Mesuré** (douze recherches lancées deux fois) : à la seconde recherche, 28 boucles sur 60 sont neuves, contre 0 avant.
- **Sélection diversifiée** : à chaque tour, le candidat dont la note est diminuée de ce qu'il partage avec les déjà retenus (arêtes communes, proximité de direction). Le premier reste le mieux noté.
- **Direction** : la direction affichée est celle du centre de gravité, pas des cent premiers mètres. Une boucle part « vers le nord » si son centre tombe à moins de 45° du nord. Si rien ne tient dans la direction, l'app le dit et cherche de tous les côtés (ce repli passe avant celui du mode Sûr).
- **Noms** : chaque boucle prend la voie qui lui est la plus propre, `2 × chez moi − partout`. Deux propositions ne portent jamais le même nom.

## Quand la distance ne tient pas : les tours

Si aucune boucle entière n'existe (village entouré de routes à 80, presqu'île), l'app propose une boucle plus courte parcourue plusieurs fois : deux tours avant trois, trois avant quatre, jamais moins de 1,5 km par tour.

- Le tour est généré et validé comme une boucle de sa longueur. Le parcours répété est **revalidé dans son ensemble** (traversées et portions exposées se répètent).
- Rondeur et recouvrement ne se répètent pas.
- Les tours passent **après** les boucles entières : un « 2 × 4,5 km » noté A ne doit pas doubler des boucles entières.
- **Le « 8 »** : deux boucles différentes, de la longueur d'un tour, parties de deux côtés du départ, à 90° au moins l'une de l'autre (`figure_eight`, `EIGHT_MIN_GAP_DEG`). Le 8 est validé en entier.

**Au départ de Beaune, 21 km** : aucune proposition avant, cinq après dont trois notées A.

## Choisir la forme (filtres)

« Auto » = comportement ordinaire. Une forme choisie se tient strictement : « 1 boucle » ne complète jamais par des tours ; « 2 boucles » ne rend que des 8 ; « 3 tours » que des boucles d'un tiers.

- Un tour de moins de 1,5 km est refusé avant même de télécharger les rues (`_form_refusal`).
- Si le coin n'offre rien sous cette forme, le message dit laquelle manque (`_form_message`), au lieu de laisser croire que c'est la sécurité.
- Mesuré (12 recherches, 5 propositions) : 1 boucle 12/12 servies ; 2 boucles 11/12 (un refus annoncé) ; 2 tours 12/12 ; 3 tours 12/12. Hors de la forme : 0.

## Le vent

- Direction du vent via Open-Meteo, sans clé. Préfère, à qualité égale, la boucle dont le **dernier tiers** se court vent dans le dos.
- **Sous 12 km/h, rien ne se passe.**
- Poids **0,10** pondéré par la force, contre 0,9 par cran de sécurité. Une A avec vent de face passe toujours devant une B vent dans le dos. Testé dans `tests/test_wind.py`.
- Sans réponse du service, le terme vaut zéro.

## Le dénivelé

**En traçant.** Le relief de la zone est lu d'abord : une grille d'environ 220 m, calée sur un quadrillage fixe, deux mille points, une seule requête IGN. Il sert à :
- orienter les polygones (trois fois plus d'orientations essayées, celles qui vont au terrain demandé d'abord) ;
- en plat, faire payer la pente : une pente de 4 % compte double.

Mesuré autour de Guebwiller : plat dans la fourchette 7/60 → 30/60 ; vallonné 18/60 → 29/60.

**En choisissant.** Chaque préférence a une fourchette :

| Préférence | Cible | Fourchette |
|---|---|---|
| Plat | 3 m/km | 0 à 10 m/km |
| Vallonné | 10 m/km | 3 à 20 m/km |
| Côtes | 22 m/km | 12 m/km et au-delà |
| D+ précis | D+ ÷ distance | ±20 %, au moins ±2 m/km |

Hors fourchette, la boucle n'est jamais rejetée : elle passe derrière, avec un retrait de 2 plus 0,8 par tranche de 5 m/km. Le réglage passe **avant** la note, de deux crans : une C plate passe devant une A vallonnée (sauf en mode Sûr, qui ne la laisse pas entrer).

**Un D+ précis** : un compteur de 10 m en 10 m (puis par pas de 25 et 50 en montagne). Mesuré : la première proposition tient le D+ 37 fois sur 68 au lieu de 19.

**Le dénivelé annoncé** : relevé tous les 50 m, noyau triangulaire de 60 m, seuil de 1 m. Mesuré le 4 octobre sur 54 boucles : total −10 % → −1 %, écart moyen 15 % → 1,7 %, pire boucle −48 % → 10 %. Valhalla (hors de France, ~30 m) : noyau 100 m, seuil 3 m.

## Parcs, bois, eau, balisage

- **Indice vert** de chaque arête : part de sa longueur à moins de 100 m d'un parc, bois, forêt, plan d'eau, rivière ou canal.
- **Balisage** : voie d'une relation de randonnée ou de course (`route=hiking|foot|running`).
- Bonus borné : jusqu'à 25 % de moins pour une arête verte, 15 % pour une voie balisée. Jamais sur une voie exposée. Mesuré : 25 % / 15 % est le meilleur compromis (distance 3,6 %, près du vert 77 %).

## Terrain

Route 0 à 10 % hors bitume · Mixte 15 à 85 % · Sentier 50 % et plus. Même retrait que pour le dénivelé. En ville, toutes paient le même retrait et la note décide.

## Ce qui reste ouvert côté moteur

- Les formes allongées (ellipses 1:2) ont été essayées et **pas gardées** : elles prenaient la place de boucles régulières mieux notées en plaine.
- Faire payer les raidillons en vallonné a été essayé et **pas gardé** : le terrain se perd dans les côtes.
- Pour descendre sous la seconde sur Paris, il faudrait un moteur compilé (GraphHopper). Pas nécessaire aujourd'hui.

## Pièges

- Ajouter un test pour toute logique non triviale. Un changement du moteur ajoute toujours `parity.test.js`.
- Passer par les helpers `py.js` pour les nombres.
- `door.js` n'existe qu'en JS : ne pas le porter côté Python.

## Liens

[[Securite]] · [[Performances]] · [[Dev]] · [[Decisions]] · [[Donnees]]
