---
type: categorie
tags: [performance]
---

# Performances et robustesse

Retour : [[Accueil]] · Source : `docs/performances.md`

## Sur l'appareil

Le moteur JavaScript est **plus rapide que le Python** qu'il reproduit : graphes en tableaux typés (voisins en CSR, coordonnées dans un seul tampon), Dijkstra sans allocation.

| Paris intra-muros, 21 km | Python | JavaScript |
|---|---|---|
| Construction du graphe | 10,9 s | 4,7 s |
| Génération et notation | 4,3 s | 0,5 à 0,8 s |

### Ce qu'on charge

- **On ne charge que ce qu'une boucle peut atteindre** : une boucle de longueur L ne s'éloigne jamais de plus de L/2 à vol d'oiseau. Carreaux de 0,05° pris dès qu'ils **effleurent** le disque. Mesuré à Guebwiller, 10 km : 16 carreaux et 14 062 voies → 11 carreaux et 5 833 voies ; graphe de 18 499 à 7 493 nœuds ; rues + graphe de 0,59 s à 0,19 s sur PC.
- **Le cœur arrive avant le bord.** Dans une grande zone, la recherche démarre avec le cœur ; le bord continue pendant qu'on lit les propositions. Si le bord tarde, on cherche avec ce qu'on a, on le dit, et le graphe tronqué n'est pas gardé.
- **Les rues se préparent en fond** dès que le départ est connu. Colmar, ville jamais visitée : préparation 26 s, puis **recherche en 2 s** au lieu d'une trentaine.
- **Changer de distance ne retélécharge rien** : les rues gardées sont filtrées sur place.

### Ce qu'on attend

- **Le relief part en un seul envoi.** Mesuré le 22 septembre 2026 : 3,3 s pour 300 points, 3,1 s pour 1 000, 3,7 s pour 5 000, puis refus. C'est la **requête** qui coûte, pas les points. Cinq itinéraires de 10 km tiennent donc dans un seul envoi.
- **Une fois les rues sur l'appareil, c'est le plus gros poste restant** (`docs/performances.md` l. 116-122). Piste ouverte : voir [[Taches]].
- **Relief** : quinze secondes de budget. C'est un complément, il ne doit pas coûter la recherche.

### Budgets (rien n'attend indéfiniment)

- Rues : quarante secondes, puis on cherche avec le reste ; quatre-vingt-dix secondes au total avant d'avouer que les serveurs ne répondent pas.
- Les deux lots partent vers **deux miroirs différents**, pour ne pas entrer dans la même file d'attente.
- Avant : quatre miroirs relancés l'un après l'autre, vingt minutes d'écran de chargement constatées sur un téléphone.

### Cache

- Carreaux de 0,05° dans IndexedDB, au format serré. 44 ms pour relire une tuile de 4 Mo au lieu de 100.
- Plafond de 250 Mo (ou le quart de ce que WebKit accorde), éviction des carreaux les moins récents. Plus de cache sans fin, que le système vide **en entier** au pire moment.
- Fraîches quatorze jours ; ensuite servies tout de suite et rafraîchies en fond jusqu'à trois mois.

## Moteur de référence (Python)

Mesuré sur huit départs et trois distances :

| | Médiane | Maximum |
|---|---|---|
| Recherche complète, données à télécharger | 3,2 s | 18,4 s (Paris, 21 km) |
| Recherche suivante au même endroit | ~1,5 s | ~4,5 s |

Paris 21,1 km (547 000 nœuds après contraction) :

| Étape | Première | Suivante |
|---|---|---|
| Téléchargement OSM | 2,9 s | ~2 s (disque) |
| Construction du graphe | 10,9 s | 0 s (mémoire) |
| Génération et notation | 4,3 s | 4,3 s |
| Altitude | 1,9 s | 0,07 s (disque) |
| **Total** | **~19 s** | **~4,5 s** |

Trois changements ont fait l'essentiel du gain :
- **Indices contigus** (0 à N−1) au lieu des numéros OSM : Dijkstra lit des tableaux au lieu de hacher une clé. Entre une seconde et cinq sur un centre-ville.
- **Altitude mise en commun et en cache** : une recherche relancée après un changement de filtre ne repaie rien (4,75 s → 0,01 s).
- **Cache à coordonnées plates** : 41 % de fichier en moins, 30 % de lecture en moins. `tests/test_extract.py` vérifie que les deux formats donnent le même graphe, arête par arête.

Une ville moyenne tourne à 1 à 3 s à froid. Paris est le pire cas de France.

## Robustesse face à Overpass

Overpass est gratuit et public, régulièrement saturé aux heures ouvrées européennes.

- **Une requête par zone**, pas par carreau. 127 s mesurées contre 21 s groupées.
- **Quatre miroirs, ordre fixe, santé retenue** : un miroir qui échoue passe en fin de file. Le tirage au sort répétait les erreurs une fois sur deux.
- **On n'attend pas un miroir muet** : après huit secondes, un second part sans abandonner le premier ; la première réponse gagne.
- **Erreur passagère** (504, coupure) : réessai sur place. **Limite de débit** (429) : attente annoncée par `/api/status`.
- **Une réponse vide est un échec**, pas un résultat : mise en cache, elle empoisonnait la zone deux semaines.
- **Un extrait périmé vaut mieux qu'une erreur** : le réseau de rues n'a pas changé.

Mesures de latence du 19 septembre 2026 : Marseille 10 km en 9 s, Toulouse 12 s, Lausanne 9 s, campagne provençale 4 s, Lyon 21 km en 23 s (à froid).

## Pièges

- Un `Math.floor(a / b)` ou une somme naïve peut diverger de Python sur de gros nombres. Passer par `engine/py.js`, voir [[Moteur]].
- Un nouvel appel réseau doit rester lent et unitaire.
- Un tirage qui retrace ce qu'il connaît perd du temps : les polygones déjà tracés sont sautés.

## Liens

[[iPhone]] · [[Donnees]] · [[Moteur]] · [[Taches]]
