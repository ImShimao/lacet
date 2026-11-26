# 002 — Sortir l'écriture de sauvegarde du setter `setPoiPrefs`

- **Status**: TODO
- **Commit**: a4fe34c
- **Severity**: LOW
- **Category**: Bugs & correctness
- **Rule**: react-doctor/no-side-effect-in-state-updater-function | Beyond the scan
- **Estimated scope**: 1 fichier (`frontend/src/App.jsx`), environ 6 lignes

## Problem

Le callback `onPoiPrefs` appelle `save(...)` à l'intérieur de la fonction passée à `setPoiPrefs`. React peut
rejouer un updater (StrictMode en développement, rendus concurrents). L'effet de bord, ici l'écriture dans
le magasin de l'app, s'exécute donc peut-être deux fois.

    // frontend/src/App.jsx:878 — current
    onPoiPrefs={(patch) =>
      setPoiPrefs((prev) => {
        const next = { ...prev, ...patch }
        save({ pois: next })
        return next
      })
    }

Impact réel : faible. Les deux écritures sont identiques, donc le résultat final ne change pas. Le risque est
une écriture en trop, et une règle de React enfreinte.

## Target

Calculer le nouvel état hors du setter, écrire, puis mettre à jour l'état :

    // target
    onPoiPrefs={(patch) => {
      const next = { ...poiPrefs, ...patch }
      setPoiPrefs(next)
      save({ pois: next })
    }}

`poiPrefs` vient du rendu courant. Le callback est recréé à chaque rendu, donc il voit la dernière valeur,
sauf si deux `onPoiPrefs` partent dans le même événement. Vérifier ce point avant d'exécuter (voir Steps).

Référence canonique : `npx react-doctor@latest rules explain no-side-effect-in-state-updater-function` :
« Compute state purely, then perform the side effect outside the setter. »

## Repo conventions to follow

- Le même motif, sans updater, est déjà utilisé pour `onProfile` juste en dessous (lignes 885–889) :
  `const next = { ...params, ...patch }; setParams(next); save({ params: next })`. Imiter exactement ce
  motif : c'est l'exemplaire.

## Steps

1. Lire `frontend/src/App.jsx` lignes 870–890 et vérifier que `poiPrefs` est bien la variable d'état du
   même composant.
2. Chercher les appels de `onPoiPrefs` (`grep -n "onPoiPrefs" frontend/src`) et vérifier qu'aucun ne part
   deux fois dans le même événement. Si l'un d'eux le fait, s'arrêter et signaler : il faudra alors une
   forme fonctionnelle différente.
3. Remplacer le bloc des lignes 878–884 par le code « target ».
4. Relire le diff.

## Boundaries

- Ne changer que `onPoiPrefs`. Ne pas toucher à `onProfile` ni à `onClearData`.
- Ne pas changer le contenu sauvegardé.
- Ne pas ajouter de dépendance.

## Verification

- **Mechanical** :
  - `npx react-doctor@latest --scope changed` ne signale plus la ligne 881.
  - `(cd frontend && npx vitest run src/App.test.jsx)` s'il existe, sinon le test lié le plus proche
    (`Account.test.jsx`) passe.
  - `(cd frontend && npm run build)` passe.
- **Behavior check** : dans l'aperçu, changer une option de points d'eau dans « Mon compte », recharger
  l'app, et vérifier que l'option est restée.
- **Done when** : le diagnostic disparaît, le réglage survit au rechargement, et le build passe.
