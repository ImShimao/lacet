---
type: categorie
tags: [donnees, carte]
---

# Données et cartes

Retour : [[Accueil]] · Source : `docs/architecture.md`, `docs/performances.md`, `docs/guidage.md`

L'app ne demande **aucune clé d'API** pour l'essentiel. Elle va chercher elle-même les rues, l'altitude et le vent, et garde ce qu'elle a téléchargé.

## Qui fournit quoi

| Donnée | Source | Remarque |
|---|---|---|
| Rues | OpenStreetMap, via Overpass | Requête publique partagée |
| Rues (archives) | `lacet-data` (dépôt public) | Découpées chaque mois |
| Rues (région livrée) | Compilation de l'IPA | Toute l'Alsace, lue sur place |
| Altitude | IGN (France) | Ensuite Valhalla, puis Terrain Tiles hors ligne |
| Vent | Open-Meteo | Sans clé |
| Fond de carte | CARTO, OpenFreeMap, OpenTopoMap, Esri | Sans clé |
| Commerces | Mapbox si un jeton est présent | OSM ignore les enseignes ouvertes trop récemment |
| Lieux | Photon (Komoot), Nominatim | Recherche d'adresse |

Attribution OpenStreetMap obligatoire (ODbL), à l'écran et dans les GPX. Mention « Mapzen » et Copernicus EU-DEM pour les tuiles d'altitude hors ligne. Ne rien retirer.

Côté serveur de référence, l'altitude vient d'OpenTopoData (qui n'envoie pas d'en-têtes CORS, donc pas utilisable dans l'app).

## Région livrée avec l'app

- Chaque lundi, la compilation télécharge l'extrait OSM de la région (l'Alsace, dans `.github/workflows/ios.yml`) chez Geofabrik, le découpe avec `frontend/scripts/region_tiles.py`, et le range dans l'app.
- Une recherche dans la région lit ses rues sur place : **0,04 s** au lieu de vingt secondes à plusieurs minutes, et sans réseau.
- L'extrait **déborde de six kilomètres** : une carte qui s'arrête à la limite administrative laisse sans rues ceux qui habitent près. Constaté à Bréchaumont : deux tuiles sur six manquaient. La compilation fusionne les régions voisines (Lorraine, Franche-Comté, Bade-Wurtemberg, Rhénanie-Palatinat, Suisse) et ne livre que les tuiles entièrement dedans.

## Archives de rues

- `lacet-data` : découpage mensuel en archives d'un demi-degré. L'app lit un répertoire de quelques Ko, puis les tuiles voulues par plages d'octets (`Range`).
- GitHub autorise la lecture (« HTTP 206 », « Access-Control-Allow-Origin: * »). **jsDelivr écarté** : ses plages d'octets portent sur une version encodée du fichier.
- Une sortie de 10 km dans une ville jamais visitée : trois ou quatre requêtes, trois Mo, environ une seconde.
- Format décrit en tête de `frontend/scripts/pack_tiles.py`, relu par `src/engine/archive.js`. Un test lit une archive fabriquée par Python.
- Pays couverts : France, Suisse, Belgique, Luxembourg, Allemagne du Sud-Ouest, Italie du Nord-Ouest, Espagne du Nord-Est, Autriche, Pays-Bas, Portugal. Ajouter un pays : `zones.json` du dépôt de données. Au-delà de cinq Go (limite GitHub tolérée), second dépôt, adresse dans `SOURCES` (`engine/archive.js`).

## Overpass : le dernier recours

- Overpass calcule l'extraction à la volée sur des serveurs publics : c'est la cause des lenteurs hors de la région livrée.
- Deux miroirs font la course (instance principale et OpenStreetMap France) ; la première réponse gagne. Mesuré le 19 septembre 2026 : 1,6 s ou « 504 » après 14 s pour la principale ; 1,5 à 5,4 s pour l'autre.
- Requêtes groupées par zone (jusqu'à 40 Mo), pas par carreau : 127 s mesurées contre 21 s.
- Budget : quarante secondes de chargement, puis on cherche avec ce qui est arrivé. Quatre-vingt-dix secondes au total avant de dire que les serveurs ne répondent pas.
- Une réponse vide est un échec, pas un résultat. Un extrait périmé vaut mieux qu'une erreur.
- Pour de la production : héberger sa propre instance ou un extrait OSM local.

## Cache sur l'appareil

- Rues par carreaux de 0,05° dans IndexedDB, au format serré des tuiles livrées (trois fois moins de place).
- Plafond de 250 Mo (ou le quart de ce que WebKit accorde). Les carreaux les moins utilisés partent en premier.
- Fraîches quatorze jours ; ensuite, jusqu'à trois mois, servies tout de suite et rafraîchies en fond.
- Le graphe ne dépend que de l'extrait et du sport : le même endroit ne le reconstruit qu'une fois.
- Les coordonnées sont stockées à plat (`[lon, lat, lon, lat…]`) : 41 % de fichier en moins, 30 % de lecture en moins. Les anciens extraits sont convertis à leur première relecture, en gardant leur date.

## Cartes hors ligne

Ce qui est déjà hors ligne : géométrie, consignes, profil et note d'un parcours enregistré. La seule pièce manquante était **le fond de carte**.

- **Explicite, parcours par parcours** : une icône dans « Mes parcours ». Garder les quarante favoris automatiquement remplirait le téléphone, souvent sur données mobiles.
- **Automatique au départ** : les cinq dernières sorties gardent leur carte (la sixième chasse la moins récente). Une carte gardée se reprend au départ suivant passé deux mois, ou si le fond a changé.
- **Plafond réel : 40 Mo par parcours**, en octets (pas en nombre de tuiles : une boucle de 10 km dans Paris pèse 16 Mo, la même en rase campagne moins d'un). Vérifié pendant le téléchargement, à une frontière de niveau de zoom, jamais au milieu.
- **Zoom 14** : la source CARTO déclare `maxzoom: 14`. Au-delà, le moteur agrandit la tuile. Relief et Satellite déclarent 17 et 19 : vides au-delà du 14 ; l'écran « Mon compte » le dit.
- **Une seule clé de tuiles** : le rendu tire `tiles-a` à `tiles-d` au hasard. Une tuile enregistrée depuis l'un serait introuvable depuis l'autre : trois sur quatre manquaient, en damier. L'app range tout sous un seul nom.
- Les tuiles sont partagées entre parcours ; retirer l'un ne casse pas l'autre. Les cartes vivent dans leur propre magasin, que les mises à jour ne balayent jamais.
- Les cartes gardées à la main ne partent jamais seules.

## Altitude hors ligne

Garder une carte garde aussi les tuiles d'altitude (Terrain Tiles d'AWS, zoom 12, une de plus autour : environ un Mo). Le moteur les lit quand l'IGN ne répond pas, au réglage grossier du D+. Elles ne sont pas rangées dans le cache d'altitude : le réseau revenu, l'IGN reprend la main.

Mesuré le 19 octobre 2026 : 3,5 m d'écart moyen par point, D+ à −1 % au total, 8 % par boucle. Le zoom 13 et 14 ne font pas mieux (EU-DEM à 25 m). Poids : 55 Mo pour l'Alsace au zoom 12, contre 622 Mo au 14.

## Pièges

- Fichiers générés, jamais versionnés (`.gitignore`) : `frontend/public/region/`, `altstore/`, `*.ipa`.
- `expected.json.gz` et `numbers.json` sont refaits par leurs scripts, jamais à la main.
- Une tuile écrite avant le graphe des espaces verts n'a pas les clés `g` et `r` : ses rues perdent seulement ce bonus jusqu'à leur rafraîchissement.

## Liens

[[Moteur]] · [[Securite]] · [[iPhone]] · [[Performances]] · [[Limites]]
