# Lacet

Lacet est une app iPhone qui propose des boucles de course revenant à la porte, notées A, B ou C selon
leur sécurité, puis guide à la voix pendant la sortie, écran verrouillé.
Tout tourne sur le téléphone : une interface React + MapLibre emballée par Capacitor, et un moteur
JavaScript (rues OpenStreetMap → graphe → boucles notées) qui s'exécute dans un worker.

## Architecture

- `frontend/src/` — l'interface React, à plat : écrans (`App.jsx`, `MapView.jsx`, `LiveRun.jsx`…),
  hooks `use*.js`, styles `styles/NN-*.css`, ponts vers le natif dans `native.js` (GPS, voix, activité en direct).
- `frontend/src/engine/` — le moteur de boucles, dans un worker (`worker.js`, appelé par `client.js`) :
  `graph`, `dijkstra`, `weights`, `loops`, `safety`, `service` (entrée `planLoops`), `reroute`,
  `navigation`, `matcher`, et les rues (`overpass`, `archive`, `tilestore`, `region`).
- `frontend/ios-overlay/` — ce qui distingue Lacet d'un projet Capacitor vierge (`customize.py`, plugins Swift).
- `backend/app/` — le moteur de référence Python (sans serveur : l'app calcule tout sur le téléphone) :
  `osm/` (Overpass, extraction, graphe), `routing/` (dijkstra, loops, weights), `safety/` (risk, gate,
  exclusion, night), `elevation.py`, `wind.py`, `solar.py`, `service.py` (entrée `plan_loops`).
- `.github/workflows/ios.yml` — compile l'IPA sur un Mac de GitHub ; `tests.yml` — les deux suites et la
  parité, sur Linux, à chaque push.

### Moteur JS ↔ moteur Python

Le moteur JS est un portage fidèle de `backend/app`. Python reste la référence : c'est là que chaque
seuil est justifié et testé.
- `backend/scripts/parity_dump.py` fait tourner Python sur des extraits figés et écrit
  `frontend/src/engine/__fixtures__/parity/expected.json.gz`.
- `engine/parity.test.js` exige du JS le même graphe, les mêmes candidats arête par arête et la même
  réponse, à 1e-9 près.
- `engine/py.js` reproduit l'arithmétique de CPython (`pymod`, `pyfloordiv`, `pyRound`, `pyRoundInt`,
  `pySum`, `pyHypot`…), vérifiée par `py.test.js` contre `__fixtures__/numbers.json` (écrit par
  `backend/scripts/parity_numbers.py`). Dans le moteur, utilise-les au lieu de `%`, `Math.floor(a / b)`,
  `Math.round` ou d'une somme naïve.
- Changer un calcul partagé = modifier Python **et** JS, relancer `parity_dump.py`, puis
  `parity.test.js`. Ce qui est propre à l'app (ex. `door.js`, le départ devant la porte) reste en JS.
- `parity_dump.py --check` dit, sans rien écrire, si l'oracle est à jour. `.github/workflows/tests.yml`
  le lance à chaque push, avec pytest et Vitest : un oracle oublié fait échouer la CI.

## Commandes

Écrites pour l'outil Bash (Git Bash) : préfère-le à PowerShell, car seul Bash passe par RTK, qui condense
les sorties de git et des tests. Pour lire un fichier, utilise l'outil Read, pas `cat` (`rtk read` est
interdit). En PowerShell 5.1, `&&` n'existe pas : remplace-le par `;`.
Reste à la racine : `cd` seulement dans un sous-shell `( … )`. Un `cd` nu déplace la session, et les
règles relatives de `.claude/settings.json` cessent alors de protéger les dossiers voisins.

- Installer : `(cd frontend && npm install)` ;
  `(cd backend && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements-dev.txt)`
- Front : `npm run dev` dans `frontend/` → http://127.0.0.1:5173, à taille de téléphone (ni GPS, ni voix,
  ni baromètre hors de l'app). Dans l'app Claude, lance plutôt l'aperçu `lacet-front` de
  `.claude/launch.json`.
- Tests front (Vitest) : un fichier : `(cd frontend && npx vitest run src/engine/reroute.test.js)` ;
  toute la suite : `(cd frontend && npm test)`
- Tests back (pytest, déjà en `-q`) : un fichier : `(cd backend && .venv/Scripts/python.exe -m pytest tests/test_loops.py)` ;
  toute la suite : sans argument. RTK ne réécrit pas pytest : son `-q` s'ajoute à celui de `pytest.ini`, et
  le bilan disparaît (« No tests collected » alors que tout passe).
- Essai réel (appelle OpenStreetMap) : `(cd backend && .venv/Scripts/python.exe scripts/smoke.py annecy 8)`
- Build web : `(cd frontend && npm run build)` (`dist/`, que Capacitor emballe).
- Build iOS : seulement sur GitHub (macOS), à chaque push sur `main` qui touche `frontend/`, ou
  `gh workflow run ios.yml`. Suivi : `gh run list --workflow ios.yml`, `gh run view <id> --log-failed`.
  L'IPA est jointe à la publication `v1.0.<n>` : `gh release download v1.0.<n> --pattern Lacet.ipa`,
  puis remplace `Lacet.ipa` à la racine et lance `python scripts/altstore_source.py`, qui prépare
  `altstore/` ; seul ce dossier se sert (aperçu `lacet-ipa`), jamais la racine, qui livrerait `.git`.

## Conventions

- Tests à côté du fichier : `foo.js` → `foo.test.js` ; un composant → `Foo.test.jsx`, avec
  `/** @vitest-environment jsdom */` en tête et Testing Library. Python : `backend/tests/test_*.py`,
  sur les damiers synthétiques de `conftest.py` (`grid_payload`), hors ligne et déterministes.
- Français pour les commentaires, docstrings, descriptions de tests et messages de commit ; anglais
  pour les identifiants (`buildGraph`, `plan_loops`).
- Les commentaires disent **pourquoi**, en phrases complètes, souvent avec la mesure ou le bug qui a
  motivé le choix. Un en-tête `/** … */` (ou une docstring) dit ce que le fichier ou le test protège.
- JS : modules ES, sans point-virgule, guillemets simples, 2 espaces. Python : `from __future__ import
  annotations`, types annotés, 4 espaces. Ni linter ni Prettier : imite le fichier voisin.
- Commit : une phrase en français qui décrit l'effet visible (« La voix dit « troisième kilomètre »,
  pas « ce kilomètre » »).
- iPhone portrait uniquement. Champs de saisie ≥ 16 px et `maximum-scale=1` dans `index.html`, sinon
  iOS zoome toute l'app au toucher.
- Générés, à ne pas éditer à la main : `frontend/ios/`, `frontend/dist/`, `frontend/public/region/`,
  `*.ipa`, `altstore/`, `expected.json.gz` et `numbers.json` (refaits par leurs scripts).

## Règles de travail

- Ne lis pas README.md en entier (68 Ko). Cherche-y avec grep la section utile
  (`grep -n '^##' README.md`, puis lis seulement la plage). Ses sections :
  - Ce qu'il fait · L'installer · Comment c'est fait · Le détail, section par section
  - Démarrer (première fois) · Lancer · Tester dans VS Code
  - L'app iPhone : Récupérer l'IPA · L'installer avec AltStore · Ce que fait l'app, et qu'une page ne
    ferait pas · En course, la carte suit comme un GPS · Hors parcours : un nouveau chemin · Les fonds de carte
  - Apple Santé et Strava · Le moteur de sécurité · La note A, B, C · L'algorithme de génération
  - Le choix des propositions · Quand la distance ne tient pas : les tours · Le vent
  - La préférence de dénivelé (Le dénivelé annoncé, et celui qu'on monte) · Le guidage · Réglages · Interface
  - La sortie (Les cartes hors ligne) · Performances (Sur l'appareil · Le moteur de référence (Python) ·
    Robustesse des données) · Limites, dites franchement · Ensuite
- Lance seulement les tests liés au fichier modifié, pas toute la suite, sauf avant un commit.
  Un changement du moteur ajoute toujours `parity.test.js`.
- Avant d'écrire du nouveau code, vérifie si une fonction existante du projet fait déjà le travail.
  Préfère la solution la plus simple.
- Pour Capacitor, MapLibre, Vite, Vitest : consulte Context7 avant d'utiliser une API dont tu
  n'es pas sûr de la version.
