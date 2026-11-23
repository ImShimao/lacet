# Comment c'est fait

[← Lacet](../README.md) · [Toute la documentation](README.md)

**Tout tourne sur l'appareil.** Le moteur — données OpenStreetMap, graphe,
sécurité, génération, notation — est écrit en JavaScript et s'exécute dans un
*worker*, sur le téléphone. Rien à héberger, rien à
payer : l'app va chercher elle-même les rues sur Overpass, l'altitude à l'IGN,
le vent chez Open-Meteo, et garde ce qu'elle a téléchargé.

**Une app iPhone écrite en React.** L'interface est une page (React +
MapLibre) emballée par Capacitor, et tout ce qu'une page ne sait pas faire passe
par des modules natifs : GPS et voix écran verrouillé, activité en direct,
vibrations, feuille de partage (`src/native.js`). Une seule mise en page, celle
du téléphone tenu droit ; sur iPad, iOS l'ouvre en mode iPhone.

```
frontend/             React + MapLibre — l'app, et le moteur (src/engine/)
frontend/ios-overlay/ réglages iOS appliqués au projet Xcode généré
backend/              Python — le moteur de référence
.github/workflows/    compilation de l'IPA sur un Mac de GitHub
```

**Pourquoi un moteur Python en plus ?** C'est la référence. Le portage
JavaScript note la *sécurité* des parcours : subtilement faux, il proposerait un
« A » là où il faudrait un « C », et rien à l'écran ne le montrerait.
`backend/scripts/parity_dump.py` fait tourner Python sur dix cas réels — Beaune,
Lyon, damiers artificiels ; jour, nuit, vent, vélo, tours — et
`frontend/src/engine/parity.test.js` exige du JavaScript le même graphe, les
mêmes candidats arête par arête et la même réponse, à 1e-9 près. Ce qui a
demandé de reproduire l'arithmétique de CPython jusqu'au modulo flottant et à
l'arrondi au pair.

Les archives de rues couvrent la France, la Suisse, la Belgique et le
Luxembourg, l'Allemagne du Sud-Ouest, l'Italie du Nord-Ouest, l'Espagne du
Nord-Est, l'Autriche, les Pays-Bas et le Portugal. Ailleurs, les rues viennent
d'Overpass ; quand aucun miroir ne répond, l'app le dit plutôt que de proposer
un tracé qu'elle n'a pas pu noter.
Ajouter un pays se fait dans `zones.json` du dépôt de données ; quand celui-ci
approchera des cinq gigaoctets que GitHub tolère, la suite ira dans un second
dépôt, dont l'adresse s'ajoute à `SOURCES` (voir `engine/archive.js`).

Aucune clé d'API n'est nécessaire. Données © OpenStreetMap (Overpass et les
archives de `lacet-data`), altitude IGN puis Valhalla — OpenTopoData côté
serveur, qui n'envoie pas d'en-têtes CORS —, vent Open-Meteo, fond de carte OpenFreeMap, recherche de lieux Photon (Komoot) et
Nominatim — plus Mapbox pour les commerces, si un token est présent :
OpenStreetMap ignore les enseignes ouvertes trop récemment.
