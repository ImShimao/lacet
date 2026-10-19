# La génération des boucles

[← Lacet](../README.md) · [Toute la documentation](README.md)

## L'algorithme de génération

`backend/app/routing/loops.py`

Le principe tient en une idée : **une boucle est un polygone dont le départ est
un sommet.** La décrire demande trois nombres — une forme, une taille, une
orientation — et la géométrie fournit le reste.

1. **Un seul** Dijkstra depuis le départ. Il donne d'un coup, pour tous les
   nœuds atteignables, leur distance réseau réelle et leur coût pondéré — donc
   leur sûreté au mètre.
2. On en tire un index : pour chaque direction (par tranche de 5°) et chaque
   bande de distance, le nœud le moins cher au mètre. C'est le vivier.
3. On demande alors des polygones — *un triangle orienté à 40°*, *un carré à
   15°*, *un hexagone à 0°* — et on relie leurs points de passage par A*.
4. Portail L3, dédoublonnage, altitude, notation.

**Où sont les points de passage.** C'est le point à ne pas rater. Le départ
étant un sommet, les autres ne l'entourent pas : ils sont tous du même côté.
Dans un polygone régulier à *m* côtés vu depuis l'un de ses sommets, les *m−1*
autres se répartissent sur (m−2)·180/m degrés seulement, par pas de 180/m, et à
des distances **inégales** :

| Forme | Points | Étalement | Distances (× périmètre) | Rondeur idéale |
|---|---|---|---|---|
| Triangle | 2 | 60° | 0,333 · 0,333 | 0,605 |
| Carré | 3 | 90° | 0,250 · 0,354 · 0,250 | 0,785 |
| Pentagone | 4 | 108° | 0,200 · 0,324 · 0,324 · 0,200 | 0,865 |
| Hexagone | 5 | 120° | 0,167 · 0,289 · 0,333 · 0,289 · 0,167 | 0,907 |

La formule générale, par le théorème de l'angle inscrit : le k-ième point est à
`L·sin(kπ/m) / (m·sin(π/m))` et à `(k−1)·180/m` degrés du premier.

Répartir au contraire les points sur 360° — ce que faisait la version
précédente — place le départ **au centre** de la figure au lieu d'être dessus.
La boucle doit alors retraverser le milieu à chaque côté, les aires s'annulent,
et la rondeur s'effondre à 0,03. Le symptôme ne désignait pas la cause : les
boucles se refermaient, ne se recoupaient presque pas, respectaient la distance,
et n'étaient pourtant pas des boucles. `tests/test_shape_model.py` verrouille ce
point.

**Deux garde-fous** empêchent un tronçon de saboter la figure :

- une **zone centrale interdite** autour du départ, de rayon 0,45 fois la
  distance au premier point de passage. Une interdiction, pas une pénalité :
  une pénalité assez forte pour être efficace rend la recherche exorbitante,
  puisqu'elle continue d'explorer la zone chère au lieu de l'ignorer ;
- un **couloir de progression** angulaire. Sans lui, contourner par l'arrière
  est régulièrement moins cher que la corde directe : le tracé repassait dans un
  quartier déjà parcouru, en sens inverse, et son aire s'annulait. Le test coûte
  une lecture de tableau par arête, et il *réduit* l'espace exploré.

**Pourquoi viser les distances sur le réseau.** Le réseau impose des détours —
environ 1,3 fois la distance à vol d'oiseau. Mais ce facteur joue autant sur les
distances aux points de passage que sur le périmètre : viser les distances
théoriques en distance **réseau** donne directement la bonne longueur, sans
avoir à estimer le détour. Une boucle d'ajustement corrige le résidu.

Les tronçons utilisent A* avec une heuristique gonflée de 25 % : le chemin peut
être marginalement moins direct, la recherche est deux à trois fois plus rapide,
et la sécurité reste garantie par le portail L3.

**Ce que ça donne**, sur un panel de huit départs (grandes villes, périphérie,
village, littoral) × trois distances (5, 10, 21,1 km) :

| | Avant | Après |
|---|---|---|
| Itinéraires rendus | 61 | **115** |
| Rondeur médiane | 0,30 | **0,471** |
| Cas rendant le compte demandé | 16/24 (sur 3) | **22/24 (sur 5)** |
| Recherches ne rendant rien | 6/24 | **0/24** |
| Écart de distance | jusqu'à 10 % | **≤ 5 % le plus souvent** |
| Temps médian | 8,1 s | **3,3 s** |
| Temps maximum | 72 s | **19 s** |
| Échecs Overpass | 6/24 | **0/24** |

### Passer par un point

Un appui long sur la carte — ou « Passer par un point » dans le menu du départ
— pose un fanion, et **toutes** les boucles y passent. C'était la demande la
plus citée dans les avis des apps concurrentes (58 avis sur le contrôle du
tracé, `replica/fixes.md`). Propre à l'app : Python n'a pas de point de passage,
et la parité ne le voit pas (`via` dans `normalizeRequest`).

Le point se rattache à la voie la plus proche du réseau principal, à 300 m au
plus. Il oriente les polygones comme une direction le ferait (±45° autour de
lui), puis prend sa place parmi leurs sommets, dans l'ordre des caps : il
remplace le sommet qu'il côtoie, ou s'ajoute entre deux (`threadVia`). Hors de
l'éventail d'un polygone, il y ferait une pointe : ce polygone-là est laissé.

Un piège, trouvé à Beaune : chaque tronçon est calculé à part, et celui qui
repartait du point y faisait souvent demi-tour par la rue d'arrivée ;
l'aller-retour, rogné ensuite, emportait le point avec lui — trente-deux
boucles tracées, aucune n'y passait. Repartir par la rue d'arrivée coûte donc
mille fois sa longueur, juste après le point. Au bout d'une impasse, le
rognage reste inévitable : une boucle qui passe à 60 m du point compte comme
passée.

Trop loin pour la distance — plus de 42 % de la boucle à vol d'oiseau, quand
l'aller et le retour en prennent déjà 84 % sans le moindre détour de rue —,
la recherche s'arrête tout de suite et le dit, plutôt que de chercher une
minute pour rien.

## Le choix des propositions

**« Regénérer d'autres boucles » en propose vraiment d'autres.** Le moteur est
déterministe : relancer la même recherche redonnait exactement les mêmes
parcours. Une régénération tourne donc les polygones de départ d'une fraction du
nombre d'or — jamais deux fois le même angle, quel que soit le nombre de
relances — et pénalise les directions déjà montrées. La note de sécurité garde
la main : un cran de note retire 0,9 au classement, la ressemblance au plus
0,75, si bien qu'à qualité égale une boucle moins sûre ne passe pas devant pour
faire du neuf. Sans régénération, la réponse reste identique à celle du moteur
Python.

Trier sur la seule note ne marche pas : les meilleurs candidats se ressemblent,
parce que ce qui fait une bonne note — les rues calmes, les parcs, les berges —
se trouve toujours au même endroit. On sortait trois boucles partant du même
côté, ce qui n'est pas un choix.

La sélection retient donc, à chaque tour, le candidat dont la note **diminuée de
ce qu'il partage avec les déjà retenus** est la plus haute : arêtes communes et
proximité de direction. Le premier choisi reste toujours le mieux noté — la
variété ne coûte jamais la meilleure boucle, elle ne joue que sur les suivantes.

La direction affichée est celle du **centre de gravité** de la boucle, pas celle
des cent premiers mètres. Deux boucles qui partent par la même rue puis
divergent complètement s'annonçaient auparavant à l'identique.

**Choisir le côté où partir.** Les filtres ont une ligne « Direction » : Auto,
N, NE, E, SE, S, SO, O, NO. Vers la forêt plutôt que vers la zone commerciale,
du côté où l'on n'est pas allé hier. Une boucle part « vers le nord » quand son
centre de gravité — la direction qu'affichent les cartes — tombe à moins de 45°
du nord.

Filtrer les boucles ordinaires après coup ne suffit pas : leurs polygones font
le tour du départ, et un sur quatre seulement vise un quart de cercle donné —
deux ou trois boucles là où on en demande cinq. Avec une direction, les huit
orientations de chaque forme se serrent donc dans les ±45° du cap. L'axe d'un
polygone, du départ au centre du cercle où tombe son centre de gravité, est à
`θ + 90 − 180/m` de son premier sommet : c'est lui qu'on oriente, puis seules
restent les boucles dont le centre de gravité mesuré tombe dans la fenêtre. Les
tirages supplémentaires et les tours suivent le même cap. Sur l'extrait de
Beaune, à 5 km, chacune des huit directions rend ses cinq boucles, toutes
notées A.

**Quand un côté n'a rien.** Une rivière sans pont, une voie ferrée, une
frontière : si aucune boucle ne tient les seuils dans la direction demandée,
l'app le dit — « Aucune boucle sûre ne part vers le nord d'ici » — et cherche
de tous les côtés, comme en Auto. Ce repli passe **avant** celui du mode Sûr :
la sécurité compte davantage que la direction.

« Auto » n'envoie aucun cap, et la recherche est exactement celle d'avant :
la parité avec Python n'en voit rien (voir `heading` dans `service.js`).
Python ne connaît pas de direction imposée ; le calculateur de secours
(`remote.js`) non plus.

**Les noms sont choisis ensemble.** Nommer chaque boucle par sa voie la plus
longue paraît naturel, mais échoue précisément quand on en propose beaucoup :
les boucles d'un même quartier partagent leur artère principale, et l'écran
affichait « Boucle nord-ouest · avenue de la Gare » quatre fois. Le nom cesse
alors d'aider à choisir, ce qui est sa seule fonction.

Chaque boucle prend donc la voie qui lui est la plus **propre**, mesurée comme
*ce qu'elle en a de plus que toutes les autres réunies* — soit `2 × chez moi −
partout`. Une avenue partagée à parts égales vaut zéro quelle que soit sa
longueur ; une rue qu'une seule boucle emprunte vaut toute la sienne. Le
traitement est séquentiel, si bien que deux propositions ne peuvent pas porter
le même nom. Sur dix boucles au départ du Châtelet : dix noms distincts.

## Quand la distance ne tient pas : les tours

Il existe des endroits où une boucle de 21 km n'est tout simplement pas
possible sans longer une départementale. Un village dont toutes les sorties
sont des routes à 80, une presqu'île, un réseau trop pauvre. L'app rendait
alors une liste vide et un message d'explication — honnête, et parfaitement
inutile.

Or il reste une réponse évidente, celle que prend tout coureur qui connaît son
quartier : **une boucle deux fois plus courte, parcourue deux fois.** L'app la
propose désormais, en essayant deux tours avant trois, trois avant quatre, et
jamais en dessous de 1,5 km par tour — « cinq tours de 800 m » n'est plus une
sortie, c'est de la piste.

**Rien n'est relâché pour autant.** Le tour est généré et validé comme
n'importe quelle boucle de sa propre longueur : mêmes seuils, même portail,
même exigence de forme. Et le parcours répété est **revalidé dans son
ensemble**, parce que répéter change des choses réelles — on franchit chaque
traversée à chaque tour, on encaisse le dénivelé à chaque tour, et si le départ
tombe au milieu d'une portion exposée, les tours la mettent bout à bout.

Deux mesures, en revanche, sont reprises du tour unique et ne se répètent pas :
la **rondeur**, parce que l'aire double quand le périmètre double et que la
formule isopérimétrique la ferait chuter de moitié alors que la forme est
identique ; et le **recouvrement**, qui vaudrait mécaniquement (n−1)/n et ne
dirait plus rien.

**L'ordre des essais découle de la promesse du produit** : on préfère changer la
forme de la sortie plutôt que baisser l'exigence de sécurité. Les tours sont
donc tentés **avant** le repli sur les seuils Standard. L'inverse affichait
« aucun itinéraire ne tient les seuils du mode Sûr » au-dessus d'un itinéraire
noté A — l'app se contredisait.

Le parcours proposé est le parcours réel : géométrie répétée, consignes
répétées, profil altimétrique complet, fichier GPX de la sortie entière. Aucun
cas particulier ne subsiste en aval — le suivi GPS, la bande de parcours et le
guidage décrivent la sortie telle qu'elle sera courue.

**Sur le terrain, un tour ressemble au précédent.** On entend les mêmes
consignes dans le même ordre, et rien ne dit si c'est le premier passage ou le
dernier. Le guidage marque donc chaque retour au départ — « Fin du premier tour.
Encore deux tours. Repars vers le sud-ouest. » — et l'écran affiche « Tour 2
sur 3 » pendant toute la sortie.

La direction est reprise à chaque tour parce que le passage au départ est le
seul endroit du parcours où l'on peut repartir dans le mauvais sens sans s'en
apercevoir. Et la manœuvre qui tombe à cet endroit est absorbée par le repère :
l'angle y est bien de 180°, si bien que le guidage annonçait « fais demi-tour »
là où l'on repart pour un tour de plus — géométriquement exact, et trompeur
précisément au moment où l'on hésite.

**Ce que ça change**, au départ de Beaune :

| Distance demandée | Avant | Après |
|---|---|---|
| 21 km | **aucune proposition** | 5 propositions, dont **3 notées A** (6,9 km × 3) |
| 10 km | 1 proposition | 5 propositions |

Et là où les boucles entières existent — Paris, Nice, Lyon — rien ne change :
les tours ne sont proposés que pour compléter une liste trop courte.

**Et ils passent après toutes les boucles entières.** Un tour de plus ne
retirait que 0,12 point, moins qu'un cran de note et que le retrait des
réglages : un « 2 × 4,5 km » noté A, resté en plaine, doublait des boucles
entières notées B ou à peine trop vallonnées. Depuis la rue des Primevères, à
Soultz, douze propositions de 9 km en mettaient cinq en tours en tête de liste ;
elles s'ouvrent désormais sur les quatre boucles entières que le coin offre,
et les tours suivent. Le retrait par tour ne départage plus que les tours entre
eux (`select_varied`).

**Et l'app cherche d'autres boucles entières avant d'en proposer.** Le
générateur s'arrête dès qu'il tient huit tracés à la bonne distance : les
quasi-doublons retirés, il en restait quatre à six, et dès huit propositions la
liste se complétait de tours. Quand il en manque, l'app relance des tirages,
polygones tournés d'une fraction de cran — jamais l'angle d'un « Régénérer » :
deux toujours, puis jusqu'à huit tant que le tracé n'a pas pris une seconde et
demie sur l'iPhone (`WIDEN_ROUNDS`, `WIDEN_BUDGET_MS`, `engine/service.js` ;
propre à l'app, la parité le coupe).

Pousser les tirages ne suffisait pas. Tournés, les polygones retombent souvent
sur les mêmes sommets, donc sur la même boucle, retracée pour rien puis écartée
comme doublon : huit tirages sans limite rendaient 868 boucles entières au lieu
de 797, mais la recherche la plus lente passait de 1,2 à 2,5 s sur un PC — plus
de cinq secondes sur l'iPhone ; seize, 894 pour 4,6 s. Chaque tirage saute donc
les polygones déjà tracés — mêmes sommets, même boucle — et repart de l'échelle
à laquelle le précédent a fini, au lieu de la réajuster depuis le début ; ses
rotations tombent au milieu du plus grand écart laissé, la moitié du pas, puis
les quarts, puis les huitièmes (`reuse`, `engine/loops.js`). Le premier tirage,
lui, reste celui du moteur Python.

Mesuré sur 96 recherches (`frontend/scripts/measure_loops.mjs`) : quatre
départs — Soultz, rue des Primevères ; Guebwiller ; Buhl, dans la vallée de la
Lauch ; Issenheim, en plaine —, 5, 9 et 15 km, 8 et 12 propositions, Plat et
Vallonné, Sûr et Standard, sur les rues livrées avec l'app et le relief de
l'IGN. Temps de calcul sur un PC de bureau, l'arrêt au temps ramené à ce qu'il
serait sur l'iPhone, un peu plus de deux fois plus lent :

| | Avant | Après |
|---|---|---|
| Boucles entières rendues | 797 / 960 | **896 / 960** |
| … dont notées A | 476 (60 %) | **554 (62 %)** |
| … notées C | 2 | 2 |
| Recherches remplies de boucles entières | 51 / 96 | **79 / 96** |
| Tours proposés | 160 | **61, dont 20 en « 8 »** |
| Quasi-doublons écartés | 1 725 | 2 951 |
| Temps médian | 0,22 s | 0,22 s |
| Neuf recherches sur dix sous | 0,56 s | 0,70 s |
| Recherche la plus lente | 1,21 s | **1,01 s** |

Par départ, sur 240 : Soultz 204 → 228, Guebwiller 224 → 239, Buhl 203 → 238,
Issenheim 166 → 191. La plaine d'Issenheim reste la plus pauvre : à 15 km en
plat, les boucles tracées y font de 10 à 25 km, et un quart seulement tombe
dans la fourchette — il y manque des boucles de la bonne longueur, pas des
formes. La recherche la plus lente l'est moins qu'avant : un tirage qui ne
retrace pas ce qu'il connaît finit plus tôt. Et l'arrêt au temps rend le compte
un peu variable sur les recherches de 15 km en plat, qui l'atteignent : de 896
à 900 d'une mesure à l'autre.

**« Partir vers… » en profite le plus.** Sur seize directions — les quatre
départs, vers le nord, l'est, le sud et l'ouest, 9 km, Plat, Sûr, huit
propositions —, 99 boucles entières au lieu de 67 et 16 tours au lieu de 40 ;
aucune ne sort de sa fenêtre de ±45°. Depuis Soultz, l'est n'offrait qu'une
boucle : il en donne trois.

Et à Bligny-lès-Beaune, de nuit, la recherche de 7 km qui ne pouvait que
repêcher des trajets le long de la départementale trouve désormais une boucle
de 6,7 km notée A, sans un mètre exposé.

**Essayé, et pas gardé : des boucles allongées.** En vallée, un polygone
régulier semblait ne pas tenir. On a donc ajouté des formes étirées — un carré
et un hexagone inscrits dans une ellipse de rapport 1:2, le départ au bout du
grand axe —, tournées comme les autres pour que le réseau et le relief
choisissent leur orientation. Buhl gagnait deux boucles, 240 sur 240 ; mais en
plaine, elles prenaient la place de boucles régulières mieux notées : 895
boucles entières au lieu de 900, et 60 % de A au lieu de 62. Tracées en
dernier recours seulement, après toutes les formes régulières : 897. Le carré
étiré seul : 886. La vallée n'en manquait plus — Buhl rendait déjà 238 boucles
sur 240 avec les tirages en plus —, et ces formes n'ont été ni gardées, ni
portées en Python.

**Un « 8 » plutôt que deux fois la même boucle.** Là où il faut des tours,
« 2 × 4,5 km » faisait courir deux fois les mêmes rues. L'app enchaîne
désormais, quand elle les trouve, deux boucles **différentes** de la longueur
d'un tour, parties de deux côtés du départ, à 90° au moins l'une de l'autre :
le nord, puis le sud (`figure_eight`, `routing/loops.py` ;
`EIGHT_MIN_GAP_DEG`, `service.py`). Chaque boucle est validée comme un tour, et
le 8 l'est en entier, comme une boucle répétée : traversées et portions
exposées sont comptées sur la sortie entière, et le profil aussi. Une boucle ne sert
qu'à un seul 8, ni elle ni ses quasi-doublons : sans cette règle, le damier de
la parité sortait trois 8 identiques.

Le guidage marque la fin de la première boucle à sa vraie place — les deux
n'ont pas la même longueur — et dit de quel côté repart la seconde : « Fin du
premier tour. Dernier tour. Repars vers le sud. » La carte affiche
« 4,6 + 4,4 km » au lieu de « 4,5 km × 2 », et le compteur « Tour 2 sur 2 »
change au bon endroit. Sur les 96 recherches, 20 des 61 tours sont des 8, qui
restent derrière toutes les boucles entières.

## Le vent

Finir dix kilomètres face au vent est la façon la plus sûre de gâcher les deux
derniers. C'est un désagrément que tout le monde connaît, que personne ne peut
anticiper sans carte, et qu'une boucle permet d'éviter **gratuitement** : le
tracé passe de toute façon par tous les points cardinaux, il suffit de choisir
dans quel ordre.

L'app demande donc la direction du vent au départ (Open-Meteo, sans clé) et
préfère, à qualité égale, la boucle dont le **dernier tiers** se court vent dans
le dos — c'est là que le vent se paie, et le reste de la boucle le traversera de
toute façon.

Trois garde-fous, parce qu'un agrément ne doit jamais devenir un critère :

- **Sous 12 km/h, rien ne se passe.** En dessous, le vent ne se sent pas en
  courant, et l'orientation doit rester décidée par la sécurité et le terrain.
- **Le poids est de 0,10**, pondéré par la force du vent, contre 0,9 par cran de
  note de sécurité. Une boucle notée A avec un retour vent de face passe
  toujours devant une B vent dans le dos, et une demande de plat n'est jamais
  contredite. `tests/test_wind.py` vérifie exactement ces deux points.
- **L'échec est silencieux.** Sans réponse du service, le terme vaut zéro et la
  recherche est inchangée : on ne fait pas dépendre un itinéraire de la météo.

## La préférence de dénivelé

Elle joue à deux moments : en traçant, pour aller chercher le bon terrain, et en
choisissant, pour que les boucles conformes passent devant.

### En traçant : le relief de la zone

`backend/app/elevation.py` (`Terrain`) · `routing/loops.py` · `routing/weights.py`

Le moteur traçait d'abord sans rien savoir du relief, puis mesurait. Au pied
des Vosges, à Guebwiller, deux polygones sur trois montaient dans les vignes :
une demande de plat sur 9 km sortait 73, 290, 120, 323 et 377 m de D+, et dès
la deuxième régénération il ne restait que des boucles de 270 à 320 m. Les
boucles plates existaient, vers la plaine ; le moteur n'en traçait que deux ou
trois.

Il lit donc d'abord le relief de la zone : une grille d'environ 220 m, calée
sur un quadrillage fixe pour que le cache serve d'une recherche à l'autre —
deux mille points, une seule requête à l'IGN. Le pas grandit avec la distance
pour que la grille garde cette taille. Elle sert à deux choses :

- **Orienter les polygones.** On essaie trois fois plus d'orientations, et
  l'on trace d'abord celles dont les points de passage vont au terrain demandé :
  en plat, ce qu'ils imposent de monter au moins ; sinon, l'écart à la cible,
  par tranches de 5 m/km. En terrain plat, toutes les orientations tombent dans
  la même tranche : la recherche par défaut rend à Colmar exactement les mêmes
  boucles qu'avant.
- **En plat, faire payer la pente.** Une rue coûte en plus ce qu'elle monte et
  descend : une pente de 4 % compte double. Sans ce terme, entre deux points
  de passage au même niveau, le chemin le moins cher coupait encore par le
  coteau.

Mesuré sur quatre départs autour de Guebwiller, trois recherches chacun :

| | Avant | Polygones orientés | Et pente payée |
|---|---|---|---|
| Plat : boucles dans la fourchette | 7 / 60 | 22 / 60 | 30 / 60 |
| Vallonné : boucles dans la fourchette | 18 / 60 | 29 / 60 | — |

Le relief part en même temps que les rues ; une fois celles-ci arrivées, on
l'attend encore cinq secondes au plus. Sans réponse, on trace comme avant.

### En choisissant : la fourchette

Le relief de la zone ne suffit pas : le dénivelé exact n'est connu qu'une fois
la boucle tracée. Or le tri diversifié accorde jusqu'à 0,75 point pour une
direction originale : une boucle de montagne était repêchée en mode Plat au
seul motif qu'elle partait d'un côté encore inutilisé. Annecy proposait ainsi
304 m de D+ à qui demandait du plat.

Chaque préférence porte donc une **fourchette**, et en sortir coûte plus que
tout ce que la variété peut rapporter :

| Préférence | Cible | Fourchette acceptée |
|---|---|---|
| Plat | 3 m/km | 0 à 10 m/km |
| Vallonné | 10 m/km | 3 à 20 m/km |
| Côtes | 22 m/km | 12 m/km et au-delà |
| Un D+ précis | le D+ ÷ la distance | ±20 %, au moins ±2 m/km |

Ce n'est pas un rejet : s'il n'existe que des boucles hors fourchette, elles
sont proposées — simplement jamais devant une boucle conforme.

Le retrait grandit avec l'écart : 2, plus 0,8 par tranche de 5 m/km au-delà
de la fourchette. Fixe, il frappait pareil 120 et 380 m de D+, et la variété
les départageait : à Guebwiller, une demande de plat sur 9 km mettait 290 m en
tête et 120 m en troisième, pour une question de direction. Elles sortent
désormais dans l'ordre du dénivelé.

**Le réglage passe avant la note, de deux crans.** Une boucle plate notée C
passe devant une boucle de montagne notée A : « plat » est un réglage, et la C
a passé le portail du mode choisi — le mode Sûr, lui, ne la laisse jamais
entrer. Le retrait valait 0,8, moins qu'un seul cran de note (0,9) : une B
plate doublait tout juste une A vallonnée, une C jamais, et qui demandait du
plat en mode Standard recevait des boucles de coteau mieux notées. Dans la
fourchette, la note reprend la main — une A passe devant une B
(`tests/test_ranking.py`).

**Les boucles mesurées sont choisies sur les réglages.** Le dénivelé fin ne se
demande que pour une réserve d'une douzaine de boucles, et elle se choisissait
sans relief : une boucle plate écartée à ce stade ne pouvait plus sortir, quel
que soit son dénivelé réel. La réserve se range désormais d'abord sur la
fourchette, le D+ estimé sur le relief de la zone — la moitié de ce que la
boucle monte et descend sur la grille de 220 m. L'estimation sous-évalue les
côtes courtes, mais elle range dans le bon ordre, et c'est tout ce qu'on lui
demande.

### Un D+ précis

`backend/app/service.py` (`elevation_goal`) · `frontend/src/engine/service.js` ·
`frontend/src/FiltersSheet.jsx`

« On ne peut pas demander un D+ en particulier » : la plainte revient dans les
avis de RunnrZ, et 150 m sur 10 km tombaient entre Vallonné, qui en vise 100,
et Côtes, qui en vise 220. Sous les trois tuiles, la case **Un D+ précis**
ouvre un compteur — de 10 en 10 m, puis de 25 et de 50 en montagne, ou au
clavier — qui part de 10 m par kilomètre. Choisir une tuile l'efface.

Le D+ visé devient une cible par kilomètre, rapportée à la distance demandée,
et la fourchette se centre dessus, **à 20 % près** — jamais moins de 2 m/km
de part et d'autre, 20 m sur 10 km : en dessous, deux petites rampes de plus
feraient passer une C devant une A, et personne ne les sent en courant. La
règle est celle des trois préférences : hors fourchette, la boucle passe
derrière, de 2 plus 0,8 par tranche de 5 m/km, sans jamais être rejetée ;
dedans, la note décide. Le relief de la zone oriente les polygones vers la
cible, par tranches de 5 m/km. La pente payée de « Plat », elle, ne joue pas :
un D+ visé, même faible, remplace la préférence. Par kilomètre, la cible vaut
aussi pour les tours — deux tours de 5 km visent chacun la moitié. Et quand
aucune boucle ne tombe dans la fourchette, l'app le dit : « Rien autour de
400 m d'ici : la boucle la plus proche monte de 210 m. »

Mesuré autour de Soultz et de Guebwiller (`scripts/measure_loops.mjs --climb`) :
quatre départs, de la plaine d'Issenheim à la vallée de Buhl, à 5, 9 et
15 km, dix-sept D+ ronds de 25 à 500 m, huit propositions, mode Sûr, le D+ sur
l'altitude IGN fine, celui que l'app annonce. **Avant**, la préférence la plus
proche de la cible ; **après**, le D+ lui-même :

| D+ demandé (préférence la plus proche) | Boucles à ±20 %, avant | Après | 1ʳᵉ proposition à ±20 % | Notées A |
|---|---|---|---|---|
| Faible : 25 à 60 m (Plat) | 19 / 96 | 14 / 96 | 2 → 5 / 12 | 61 → 62 |
| Moyen : 50 à 180 m (Vallonné) | 20 / 192 | 18 / 192 | 6 → 13 / 24 | 132 → 134 |
| Fort : 100 à 500 m (Côtes) | 82 / 256 | 93 / 256 | 11 → 19 / 32 | 209 → 187 |
| Soultz, rue des Primevères | 47 / 136 | 50 / 136 | 7 → 14 / 17 | 105 → 102 |
| Guebwiller | 30 / 136 | 31 / 136 | 6 → 10 / 17 | 110 → 108 |
| Buhl | 16 / 136 | 14 / 136 | 2 → 3 / 17 | 116 → 114 |
| Issenheim | 28 / 136 | 30 / 136 | 4 → 10 / 17 | 71 → 59 |
| **Total** | **121 / 544** | **125 / 544** | **19 → 37 / 68** | **402 → 383** |

- **La première proposition tient le D+ deux fois plus souvent**, 37 fois sur
  68 au lieu de 19 : c'est là que le classement travaille.
- **Le nombre de boucles à ±20 % bouge à peine** : le terrain décide de ce qui
  existe. À 15 km de Soultz, la plus douce des huit propositions monte de
  184 m : qui en demande 120 reçoit la plus proche, et l'app le dit.
- **Moins de A (−5 %)**, presque toutes vers les grands D+ : une A trop plate
  passe derrière une B qui tient la fourchette — c'est la règle, comme pour
  Plat et Côtes.
- **Pour un petit D+, « Plat » trace mieux** : à 9 km, 40 m demandés en
  donnent 12 sur 32 à ±20 % avec Plat, 6 avec le D+ précis, faute de pente
  payée. Essayé, et pas gardé : tracer comme Plat sous 6,5 m/km rend 131
  boucles à ±20 % au lieu de 125, mais 35 premières propositions justes au
  lieu de 37 — un seuil de plus pour un écart dans le bruit. Payer la pente
  sans le reste : 120.

## La préférence de terrain

`backend/app/service.py` (`SURFACE_BAND`) · `frontend/src/engine/service.js`

Route, Mixte, Sentier ne jouaient qu'au tracé, sur le coût de chaque rue, et
pas du tout au classement : une demande de sentier sortait des boucles toutes
goudronnées dès qu'elles étaient mieux notées, et « Mixte », réglé par défaut,
ne se distinguait en rien de « Route ». Chaque terrain porte donc, comme le
dénivelé, une fourchette — la part du tracé hors bitume, chemins stabilisés et
sentiers :

| Terrain | Part hors bitume acceptée |
|---|---|
| Route | 0 à 10 % |
| Mixte | 15 à 85 % |
| Sentier (VTT à vélo) | 50 % et au-delà |

Même règle que pour le dénivelé : 2 de retrait hors fourchette, plus 0,8 par
tranche de 15 points d'écart. En ville, où aucune boucle n'a de chemin, toutes
paient le même retrait « Mixte », et la note décide comme avant : quelques
allées de parc ne font pas passer une B devant une A.

**Ce que ça change**, sur 40 propositions autour de Guebwiller et de Soultz
(route, mixte et sentier, plat, vallonné et côtes, 9 km, mode Standard) : 23
tiennent leurs deux fourchettes, contre 19 avant. En plaine, à Soultz, 16 sur
20 au lieu de 12. Au pied des Vosges, le classement seul n'y pouvait rien :
aucune boucle « vallonnée » tracée ne tombait dans la fourchette, toutes
montaient de 21 à 37 m/km.

**Essayé, et pas gardé : faire payer les raidillons en vallonné.** Seule la
pente au-delà de 4 % se payait au tracé, comme toute pente en plat. Le
dénivelé s'améliorait — 25 boucles « vallonnées » sur 30 dans leur fourchette
au lieu de 19 —, mais les chemins sont dans les côtes : en Sentier, la part
hors bitume passait sous la moitié, et les boucles tenant les **deux**
réglages tombaient de 14 à 10 sur 30 (13 avec une franchise de 6 %). Le
relief et le terrain se tiennent l'un l'autre au pied des collines ; les
départager demande autre chose qu'un coût de pente.

### Le dénivelé annoncé, et celui qu'on monte

`frontend/src/engine/environment.js` · `backend/app/elevation.py`

Le dénivelé annoncé se calculait sur un point tous les 100 m, lissé par une
moyenne de trois points — trois cents mètres — avec un seuil de deux mètres. Il
rabotait les côtes courtes : « on annonce 150 m, on en monte 200 ». Mesuré le
4 octobre 2026 sur 54 boucles de l'app autour de Guebwiller, contre leur
altitude IGN relevée tous les cinq mètres :

| Réglage | Total | Écart moyen | Pire boucle |
|---|---|---|---|
| Avant : 100 m, moyenne sur 3 points, seuil 2 m | −10 % | 15 % | −48 % |
| Après : 50 m, noyau triangulaire de 60 m, seuil 1 m | −1 % | 1,7 % | 10 % |

Hors de France (Valhalla, ~30 m), le noyau passe à 100 m et le seuil à 3 m :
−2 % et 11 %, contre −14 % et 21 % avec l'ancien seuil de huit mètres. Les ponts
et passages souterrains, où le modèle de terrain voit la rivière ou le talus, ne
pesaient que 0,3 % : pas de traitement à part.

**Le dénivelé mesuré** vient du **baromètre** de l'iPhone
(`ios-overlay/live-activity/App/AltimeterPlugin.swift`), cumulé côté natif
pendant toute la sortie : lissage de quatre secondes, seuil d'un mètre compté
depuis le creux. L'altitude du GPS, qui tremble de plusieurs mètres, ne sert
plus que de repli — iPhone qui refuse l'accès à « Mouvements et forme » — et le
bilan dit alors que ce n'est qu'un ordre de grandeur.
