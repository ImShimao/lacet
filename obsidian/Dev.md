---
type: categorie
tags: [dev, commandes]
---

# Développement

Retour : [[Accueil]] · Source : `docs/developper.md`, `CLAUDE.md`

## Installer (une fois)

```bash
cd frontend && npm install
```

```bash
cd backend && python -m venv .venv && .venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

## Lancer

- **Interface** : `npm run dev` dans `frontend/`, puis http://127.0.0.1:5173, à taille de téléphone. C'est l'interface, **pas l'app** : pas de GPS, de voix, d'écran verrouillé, de baromètre ni de vibrations. La position y est « indisponible » et l'app retombe sur le dernier départ.
- **Dans l'app Claude** : l'aperçu `lacet-front` de `.claude/launch.json`.
- **Rues livrées** : `frontend/public/region/` n'est pas versionné. Sans elles, l'aperçu télécharge les rues comme à l'étranger ; avec une copie ancienne, il lit d'autres rues que l'app. Pour une copie identique au téléphone, la reprendre dans la dernière IPA :

```bash
unzip -o -j Lacet.ipa 'Payload/Lacet.app/public/region/*' -d frontend/public/region
```

## Tester

| Quoi | Commande |
|---|---|
| Un fichier front | `cd frontend && npx vitest run src/engine/reroute.test.js` |
| Toute la suite front | `cd frontend && npm test` |
| Un fichier back | `cd backend && .venv\Scripts\python.exe -m pytest tests/test_loops.py` |
| Toute la suite back | `cd backend && .venv\Scripts\python.exe -m pytest` |
| Vrai essai (appelle OSM) | `cd backend && .venv\Scripts\python.exe scripts/smoke.py annecy 8` |
| Compter les boucles distinctes | `cd frontend && npx vite-node scripts/measure_loops.mjs -- --heading` |
| Build web | `cd frontend && npm run build` |

- Villes préréglées pour `smoke.py` : `paris`, `lyon`, `toulouse`, `annecy`. Ou des coordonnées : `scripts/smoke.py 47.2184 -1.5536 12`.
- `measure_loops.mjs` : 96 recherches autour de Soultz et Guebwiller, plus seize avec `--heading`. Options : `--region` (dossier des tuiles), `--only soultz`, `--out` (JSON), `--seed`, `--forms`, `--climb`. C'est lui qui a produit les tableaux de [[Moteur]].
- Ne lancer que les tests liés au fichier modifié, sauf avant un commit. Un changement du moteur ajoute toujours `parity.test.js`.
- GitHub relance les suites à chaque envoi (`tests.yml`), avec `parity_dump.py --check`.
- **Test de voix** (`LiveRun.voice.test.jsx`) : court des boucles réelles à allure de course, relevé par seconde, bruit de GPS, reflets, une demi-minute hors tracé. C'est un test qui juge ce qu'on **entend**.

## Débogage (VS Code)

`F5`, puis : *Backend — tests* (pytest en debug), *Backend — test réel sur une ville* (Paris), *Front — Chrome* (points d'arrêt dans le JSX). Tâche : `Ctrl+Shift+P → Exécuter la tâche → Lacet — tous les tests`.

## Conventions

- Tests à côté du fichier : `foo.js` → `foo.test.js`. Un composant : `Foo.test.jsx`, avec `/** @vitest-environment jsdom */` et Testing Library. Python : `backend/tests/test_*.py`, sur les damiers de `conftest.py` (`grid_payload`), hors ligne et déterministes.
- Commentaires et docstrings en français ; identifiants en anglais (`buildGraph`, `plan_loops`).
- Les commentaires disent **pourquoi**, avec la mesure ou le bug qui a motivé le choix.
- JS : modules ES, sans point-virgule, guillemets simples, 2 espaces. Python : `from __future__ import annotations`, types annotés, 4 espaces.
- Pas de linter ni de Prettier : imiter le fichier voisin.
- Commit : une phrase en français qui décrit l'effet visible (« La voix dit « troisième kilomètre », pas « ce kilomètre » »).

## Pièges

- **Allure « 4:60 »** : trouvée en écrivant les tests. Séparer minutes et secondes **avant** d'arrondir, pas après.
- **RTK et pytest** : RTK ne réécrit pas pytest. Son `-q` s'ajoute à celui de `pytest.ini` et le bilan disparaît (« No tests collected » alors que tout passe).
- **PowerShell 5.1** : pas de `&&`, utiliser `;`.
- **`cd` nu** : décale les règles relatives de `.claude/settings.json`. Utiliser un sous-shell `( … )`.
- **Bash** : seul Bash passe par RTK. Pour lire un fichier, l'outil Read, pas `cat`.

## Générés, à ne pas éditer à la main

`frontend/ios/`, `frontend/dist/`, `frontend/public/region/`, `*.ipa`, `altstore/`, `expected.json.gz`, `numbers.json`.

## Liens

[[Moteur]] · [[iPhone]] · [[Decisions]] · [[Taches]]
