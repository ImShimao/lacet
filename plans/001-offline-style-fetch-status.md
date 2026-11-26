# 001 — Vérifier le statut HTTP avant de lire la réponse du style de carte

- **Status**: TODO
- **Commit**: a4fe34c
- **Severity**: MEDIUM
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-fetch-response-used-without-status-check (3 sites) | Beyond the scan
- **Estimated scope**: 1 fichier (`frontend/src/offlineMaps.js`), environ 10 lignes, plus un test

## Problem

`fetch()` ne rejette pas sur un 4xx ou 5xx : il résout avec la réponse d'erreur. Le code lit alors le corps
comme s'il était le bon document, et une erreur devient une liste vide, sans message.

    // frontend/src/offlineMaps.js:277 — current
    style = await (await fetch(source)).json()

    // frontend/src/offlineMaps.js:291 — current
    const tilejson = await (await fetch(src.url)).json()

Conséquence : si le serveur de style répond 404 ou 503, `style.sources` est absent, `templates` reste vide,
et la carte « gardée » ne télécharge aucune tuile sans rien dire. Hors ligne, la carte est noire, comme
dans le cas décrit dans `docs/app-iphone.md` (cartes gardées, IndexedDB). Le site à 291 est pire : un
TileJSON en erreur est lu et ignoré.

Les trois sites (277, 291, et `offlineMaps.js:368` pour la lecture des tuiles) ne sont pas tous signalés par
le scan ; seuls 277 et 291 le sont. Vérifier aussi l'autre `fetch` de ce fichier avant de finir.

## Target

Même logique, avec un contrôle explicite du statut. Le code exact à produire :

    // target — à adapter aux noms existants du fichier
    async function getJson(url) {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} pour ${url}`)
      return response.json()
    }

    style = await getJson(source)
    // ...
    const tilejson = await getJson(src.url)

Les valeurs d'origine restent identiques en cas de succès. Seul le cas d'erreur change : il lève une
exception au lieu de produire un résultat vide.

Référence canonique : `npx react-doctor@latest rules explain no-fetch-response-used-without-status-check`.
Le prompt en ligne (react.doctor/prompts/rules/...) n'a pas été lu dans cette session : à vérifier avant
exécution.

## Repo conventions to follow

- Les erreurs de réseau remontent déjà à l'appelant de `describeStyle` ; ne pas les avaler ici.
- Lire d'abord les appelants de `describeStyle` et de la fonction de téléchargement, et vérifier comment
  ils traitent une exception. Si un appelant ne l'attrape pas, le téléchargement échouera au lieu de rester
  silencieux : c'est le comportement voulu, mais il faut le dire dans le compte rendu.
- Imiter le style de gestion d'erreur du fichier (`try/catch` avec commentaire `/* … */` pour le pourquoi).

## Steps

1. Lire `frontend/src/offlineMaps.js` autour de 272–320 et 360–380, et tous les appelants de `describeStyle`.
2. Ajouter le helper `getJson` près de `describeStyle`, ou réutiliser un helper existant s'il en existe un
   (chercher `response.ok` dans `frontend/src/`).
3. Remplacer les deux lectures (lignes 277 et 291) par `getJson`.
4. Traiter la lecture des tuiles à la ligne 368 de la même façon, si elle appelle `fetch` sans `ok`.
5. Ajouter un test à côté : `frontend/src/offlineMaps.test.js` (créer le fichier s'il n'existe pas), avec un
   `fetch` simulé qui répond `{ ok: false, status: 404 }` et vérifie qu'une exception est levée.
6. Relire le diff et retirer tout autre changement.

## Boundaries

- Ne pas changer le format des données gardées ni les clés IndexedDB.
- Ne pas toucher au moteur (`frontend/src/engine/`) ni à `parity.test.js`.
- Ne pas ajouter de dépendance.
- Si le code a dérivé du commit a4fe34c, s'arrêter et signaler la dérive.

## Verification

- **Mechanical** :
  - `npx react-doctor@latest --scope changed` ne signale plus les lignes 277 et 291.
  - `(cd frontend && npx vitest run src/offlineMaps.test.js)` passe.
  - `(cd frontend && npm run build)` passe.
- **Behavior check** : dans l'aperçu `lacet-front`, télécharger une carte avec le réseau coupé (ou un
  fond de style bloqué) : l'app doit afficher une erreur, pas un téléchargement « réussi » vide. Avec le réseau
  normal, le téléchargement doit se comporter exactement comme avant.
- **Done when** : les diagnostics sont levés, les tests et le build passent, et le téléchargement normal est
  inchangé.
