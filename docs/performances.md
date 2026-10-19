# Performances

[← Lacet](../README.md) · [Toute la documentation](README.md)

## Sur l'appareil

Le moteur JavaScript est **plus rapide que le Python** qu'il reproduit : les
graphes y vivent dans des tableaux typés (voisins en CSR, coordonnées dans un
seul tampon), et la boucle de Dijkstra n'alloue rien.

| Paris intra-muros, 21 km | Python | JavaScript |
|---|---|---|
| Construction du graphe | 10,9 s | 4,7 s |
| Génération et notation | 4,3 s | 0,5 à 0,8 s |

**La région où l'on court est livrée avec l'app.** Chaque lundi, la compilation
télécharge l'extrait OpenStreetMap de la région chez Geofabrik (l'Alsace, dans
`.github/workflows/ios.yml`), le découpe en tuiles avec
`frontend/scripts/region_tiles.py` et les range dans l'app. Une recherche dans
la région lit ses rues sur place : **0,04 s** au lieu de vingt secondes à
plusieurs minutes chez Overpass, et même sans réseau. Les tuiles sont identiques
à ce qu'Overpass aurait rendu — vérifié voie par voie, étiquettes, nœuds et
géométries au bit près.

**Et elle déborde de six kilomètres.** Une carte qui s'arrête pile à la limite
administrative laisse sans rues quiconque habite près d'elle : constaté à
Bréchaumont, à deux kilomètres du Territoire de Belfort, où deux des six tuiles
d'une sortie de 5 km manquaient et partaient chez Overpass. La compilation coupe
donc les extraits des régions voisines — Lorraine, Franche-Comté, Bade-Wurtemberg,
Rhénanie-Palatinat, Suisse — à une emprise commune, les fusionne, et ne livre que
les tuiles qui y tiennent **entièrement** : le débord est aussi complet que le
reste. Depuis n'importe où en Alsace, y compris sur la frontière, les sorties de
5 et 10 km n'ont plus rien à demander à personne.

**On ne charge que ce qu'une boucle peut atteindre.** Une boucle de longueur L
ne s'éloigne jamais de plus de L/2 à vol d'oiseau : c'est tout ce qu'il faut
charger, et le rayon suit maintenant l'écart toléré au lieu d'une marge fixe
prise pour le mode le plus souple. Les rues arrivent par carreaux de 0,05°, pris
dès qu'ils **effleurent** ce disque : le débord — plus de la moitié de la
surface — est écarté avant la construction du graphe, sans jamais couper une rue
en deux. Mesuré à Guebwiller, 10 km : 16 carreaux et 14 062 voies avant, 11
carreaux et 5 833 voies après ; le graphe passe de 18 499 à 7 493 nœuds, et
l'ensemble rues + graphe de 0,59 s à 0,19 s sur un PC de bureau — un peu plus du
double sur un iPhone. Les carreaux, eux, restent gardés **entiers** : c'est ce
qui rend immédiate la recherche suivante, deux rues plus loin.

**Ailleurs, des archives préparées d'avance.** Overpass n'est pas un service de
téléchargement : c'est un moteur de requêtes, qui *calcule* l'extraction des
rues à la volée sur des serveurs publics. C'est la cause de fond de toutes les
lenteurs hors de la région livrée. Les rues, elles, ne changent pas d'une heure
à l'autre : elles sont donc découpées une fois par mois dans le dépôt public
[`lacet-data`](https://github.com/ImShimao/lacet-data), en archives d'un
demi-degré, et l'app **n'en lit que ce dont elle a besoin** — un répertoire de
quelques kilooctets, puis les tuiles voulues par plages d'octets (`Range`).
GitHub sert les
deux et autorise l'app à les lire (« HTTP 206 » et
« Access-Control-Allow-Origin : * », vérifié avant d'écrire une ligne — et
jsDelivr écarté au même moment, parce que ses plages d'octets portent sur une
version encodée du fichier et ne rendent pas les octets demandés). Une sortie de 10 km dans une ville jamais visitée : trois ou quatre
requêtes, trois mégaoctets, environ une seconde au lieu d'une minute. Ce qui en
vient est gardé sur l'appareil comme le reste — la zone devient utilisable hors
ligne — et n'est pas rafraîchi chez Overpass, puisque c'est le découpage mensuel
qui le remet à jour. Le format est décrit en tête de
`frontend/scripts/pack_tiles.py`, relu par `src/engine/archive.js`, et un test
lit une archive fabriquée par le Python : un décalage d'un octet se voit là
plutôt que sur le téléphone.

**Overpass reste le dernier recours.** Pour l'étranger, et pour les trous.
Deux serveurs y font la course. Hors de la région livrée, les rues
viennent d'Overpass. Mesuré le 19 septembre 2026 sur la France, la Suisse,
l'Italie, l'Espagne et l'Allemagne : l'instance principale répondait en 1,6 s…
ou en « 504 » au bout de 14 s, selon la minute ; celle d'OpenStreetMap France,
mondiale aussi et aux données identiques, en 1,5 à 5,4 s à chaque fois. Les deux
reçoivent donc chaque requête dès la première seconde, et la première réponse
l'emporte. Et seules les tuiles qui touchent le disque de recherche sont
demandées, non plus tout le carré qui l'entoure. Recherches à froid, dans des villes
jamais visitées : Marseille 10 km en 9 s, Toulouse 12 s, Lausanne 9 s, la
campagne provençale 4 s, Lyon 21 km en 23 s.

**Changer de distance ne retélécharge plus rien.** Au-delà de 25 km, le moteur
demande moins de détail (plus de voies de service) : c'était un autre
téléchargement, alors que les rues déjà gardées contenaient tout. Elles sont
maintenant filtrées sur place. Et quand seule la couronne extérieure manque, on
ne redemande qu'elle, en bandes, sans le centre.

**Rien n'attend plus indéfiniment.** Le pire cas s'additionnait sans plafond :
quatre miroirs relancés l'un après l'autre, deux tours, une file d'attente d'une
minute sur chacun, et tout ça autant de fois qu'il y a de lots à demander —
vingt minutes d'écran de chargement, constatées sur un téléphone. Le chargement
des rues a maintenant un budget : **quarante secondes**, puis on cherche avec ce
qui est arrivé (pourvu que la tuile du départ en fasse partie et qu'il y ait un
tiers de la zone), et quatre-vingt-dix secondes en tout avant de dire
honnêtement que les serveurs ne répondent pas. Le relief a le sien, quinze
secondes : c'est un complément, il ne doit pas coûter la recherche. Et les deux
lots qui partent ensemble vont désormais sur **deux serveurs différents**, au
lieu d'entrer dans la même file d'attente.

**Le cœur de la zone arrive avant son bord.** Une boucle reste bien à l'intérieur
du rayon demandé, et les tuiles du bord ne servent qu'à celles qui vont
l'effleurer. Quand la zone est lourde — une ville —, elle part donc en deux
temps : le cœur d'abord, la recherche commence avec lui, le bord continue
pendant qu'on lit les propositions. Et si ce bord tarde, ou si aucun miroir ne
répond, la recherche ne reste pas bloquée : elle cherche avec ce qu'elle a, le
dit, et le graphe tronqué n'est pas gardé — la recherche suivante aura tout.
C'est ce qui manquait le plus : une barre figée à 80 % pendant qu'il y avait,
déjà sur l'appareil, de quoi tracer la boucle.

**Les rues se préparent en fond.** Dès que le point de départ est connu — à
l'ouverture, ou quand on choisit une adresse —, l'app télécharge les rues de la
zone et construit leur graphe pendant qu'on règle ses filtres. La recherche qui
suit les trouve prêtes, ou rejoint le chargement en cours au lieu de le
recommencer. Mesuré à Colmar, ville jamais visitée : préparation en fond en
26 s, puis **recherche en 2 s**, relief compris — contre une trentaine de
secondes d'attente auparavant.

**Le relief part en un seul envoi.** L'IGN met en file les requêtes simultanées :
mille points passent en moins d'une seconde en un POST, en plus de cinq en dix
petits envois parallèles. Et c'est la requête qui coûte, pas les points —
remesuré le 22 septembre 2026 : 3,3 s pour trois cents points, 3,1 s pour mille,
3,7 s pour cinq mille, et un refus au-delà. Cinq itinéraires de 10 km, qui
partaient en deux envois, tiennent donc dans un seul : c'est, une fois les rues
sur l'appareil, le plus gros de ce qui reste à attendre.

Les rues sont gardées par carreaux de 0,05° dans IndexedDB, **au format serré
des tuiles livrées** : trois fois moins de place que les mêmes objets rangés
tels quels, 44 ms pour relire une tuile de 4 Mo au lieu de 100, et une taille
connue — sans quoi aucun plafond n'est possible. Le cache en a un : deux cent
cinquante mégaoctets, ou le quart de ce que WebKit accorde s'il promet
moins, et les carreaux dont on ne s'est pas servi depuis le plus longtemps
laissent la place. Soit environ trois fois l'Alsace : son coin, celui du
travail, deux ou trois endroits de vacances. Il n'y a rien à épingler, rien à
préparer avant de partir — et surtout plus de cache sans fin, que le système
finit par vider **en entier** au pire moment. Fraîches quatorze
jours ; ensuite, et jusqu'à trois mois, elles sont servies tout de suite et
rafraîchies en fond après la recherche. Une zone voisine ne retélécharge que
les carreaux qui lui manquent, et dans une grande ville deux lots partent en
parallèle — Overpass en accorde deux par adresse.

## Le moteur de référence (Python)

Mesuré sur un panel de huit départs et trois distances, après les optimisations :

| | Médiane | Maximum |
|---|---|---|
| Recherche complète, données à télécharger | 3,2 s | 18,4 s (Paris, 21 km) |
| Recherche suivante au même endroit | ~1,5 s | ~4,5 s |

Détail du pire cas — Paris intra-muros, 21,1 km, 547 000 nœuds après contraction :

| Étape | Première recherche | Recherche suivante |
|---|---|---|
| Téléchargement OSM | 2,9 s | ~2 s (lecture du cache disque) |
| Construction du graphe | 10,9 s | 0 s (cache mémoire) |
| Génération et notation | 4,3 s | 4,3 s |
| Altitude | 1,9 s | 0,07 s (cache disque) |
| **Total** | **~19 s** | **~4,5 s** |

Trois changements expliquent l'essentiel du gain :

**Les nœuds portent des indices contigus**, de 0 à N−1, au lieu de leur numéro
OpenStreetMap. La boucle interne de Dijkstra lit alors ses tableaux par indice
au lieu de hacher une clé — sur un centre-ville, où elle s'exécute des dizaines
de millions de fois par requête, c'est la différence entre une seconde et cinq.

**L'altitude est mise en commun et mise en cache.** Interroger chaque itinéraire
séparément était le poste le plus cher dès qu'on en propose cinq : autant de
connexions TLS, et des lots à moitié vides. Tous les points partent maintenant
ensemble, et une recherche relancée après un changement de filtre ne repaie plus
rien (4,75 s → 0,01 s).

**Terrain Tiles d'AWS donnent l'altitude hors ligne, au zoom 12.** Elles
passent après l'IGN et avant Valhalla, mais seulement celles déjà sur le
téléphone : elles partent avec la carte gardée d'un parcours (voir
`guidage.md`).
Mesuré le 19 octobre 2026 (`scripts/terrain_tiles.py`) sur douze boucles de
5 à 15 km autour de Guebwiller et de Soultz, contre l'IGN tous les 50 m : 3,5 m
d'écart moyen par point (p95 13 m, biais +1,4 m), et un D+ à −1 % au total,
8 % par boucle (pire cas 25 à 37 %, sur des boucles plates de 25 m de D+) — à
condition de le compter au réglage grossier (noyau 100 m, seuil 3 m) : au
réglage fin de l'IGN, le tremblement du modèle ajoute 9 % au total et 14 % par
boucle. C'est la qualité du repli Valhalla actuel. Les zooms 13 et 14 donnent
exactement la même erreur : en France la source est EU-DEM à 25 m, et zoomer ne
fait que la suréchantillonner. Le poids : 55 Mo pour l'Alsace au zoom 12
(493 tuiles de 111 ko), contre 199 Mo au 13 et 622 Mo au 14 ; une recherche de
15 km n'en lit que six (0,7 Mo). Licence libre, avec l'attribution « Mapzen »
et la mention Copernicus EU-DEM.

**La zone bâtie est mémoïsée par cellule de 80 m.** La question était reposée
pour chacune des 350 000 voies d'un extrait parisien, alors que la notion est
déjà une approximation à l'échelle du quartier.

**Le cache range l'extrait au lieu de le recopier.** Overpass rend chaque point
de géométrie comme un petit dictionnaire `{"lat": …, "lon": …}` : sur Paris,
2,9 millions de dictionnaires à reconstruire **à chaque lecture du cache**, soit
trois secondes de pure analyse syntaxique avant le moindre calcul. Le cache
écrit désormais les coordonnées à plat — `[lon, lat, lon, lat, …]` — et range
d'avance voies, polygones et traversées. À données rigoureusement identiques :
**41 % de fichier en moins, 30 % de lecture en moins.**

Les extraits déjà sur disque restent lisibles et sont convertis à leur première
relecture, en conservant leur date : réécrire un fichier le rajeunit, et un
extrait vieux de treize jours repartirait sinon pour quatorze sans avoir été
rafraîchi. `tests/test_extract.py` vérifie que les deux formats produisent le
même graphe, arête par arête.

Le graphe ne dépend que de l'extrait et du sport — ni de la distance visée, ni
du profil de sécurité. Enchaîner plusieurs recherches au même endroit, ce que
tout le monde fait, ne le construit donc qu'une fois.

Paris est le pire cas de France. Une ville moyenne tourne autour de 1 à 3 s à
froid. Pour descendre plus bas il faudrait un moteur compilé (GraphHopper)
plutôt qu'un Dijkstra en Python — mais ce prototype existe pour valider le
**modèle de sécurité**, et sur ce point il est déjà juste.

## Robustesse des données

Overpass est une ressource publique gratuite, régulièrement saturée aux heures
ouvrées européennes. Ce que fait le moteur de l'app, et l'échec constaté qui a
motivé chaque mesure :

- **Une requête par zone, pas par carreau.** Les carreaux manquants partent
  regroupés dans le rectangle qui les englobe, jusqu'à 40 Mo par requête. Un
  carreau par requête en envoyait vingt pour une recherche en ville, et chacune
  pouvait tomber sur un miroir saturé : **127 s** mesurées, contre 21 s groupées.
- **Quatre miroirs, dans un ordre fixe, et une santé retenue.** Un miroir qui
  échoue passe en fin de file pour les requêtes suivantes, et reprend sa place
  dès qu'il répond. Le tirage au sort répétait les mêmes erreurs une requête sur
  deux.
- **On n'attend pas un miroir muet.** Passé huit secondes sans réponse, un
  second part **sans abandonner le premier** ; la première réponse gagne. Un
  miroir qui répond normalement reste seul sollicité.
- **Une erreur passagère se réessaie sur place** (504, coupure) ; une limite de
  débit (429) attend le temps que le miroir annonce lui-même sur `/api/status`,
  au lieu de repartir à l'aveugle.
- **Une réponse vide est un échec, pas un résultat** : mise en cache, elle
  empoisonnait la zone deux semaines.
- **Un extrait périmé vaut mieux qu'une erreur.** Si tout est muet et qu'une
  copie existe, on s'en sert : le réseau de rues n'a pas changé, et la personne
  voulait juste courir.
