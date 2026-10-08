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

Elle ne pouvait pas être un simple bonus. Le dénivelé n'est connu qu'**après**
avoir tracé l'itinéraire — il vient d'une API externe — donc il n'entre pas dans
le routage, seulement dans le choix final. Or le tri diversifié y accorde
jusqu'à 0,75 point pour une direction originale : une boucle de montagne était
repêchée en mode Plat au seul motif qu'elle partait d'un côté encore inutilisé.
Annecy proposait ainsi 304 m de D+ à qui demandait du plat.

Chaque préférence porte donc une **fourchette**, et en sortir coûte plus que
tout ce que la variété peut rapporter :

| Préférence | Cible | Fourchette acceptée |
|---|---|---|
| Plat | 3 m/km | 0 à 10 m/km |
| Vallonné | 10 m/km | 3 à 20 m/km |
| Côtes | 22 m/km | 12 m/km et au-delà |

Ce n'est pas un rejet : s'il n'existe que des boucles hors fourchette, elles
sont proposées — simplement jamais devant une boucle conforme.

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
