# 003 — Donner un nom accessible au champ « numéro » du contact d'urgence

- **Status**: DONE (non commité ; diagnostic ligne 136 disparu, total 147 → 146)
- **Commit**: a4fe34c
- **Severity**: HIGH (écran de sécurité)
- **Category**: Accessibility
- **Rule**: react-doctor/no-placeholder-only-field | Beyond the scan (pas de libellé associé)
- **Estimated scope**: 1 fichier (`frontend/src/SosButton.jsx`), 2 lignes, plus une clé de traduction dans
  `frontend/src/locales/en.js`

## Problem

Dans la feuille « Prévenir qui ? », le seul champ est un `<input type="tel">` dont le nom n'est donné que
par `placeholder`. Le titre `<h3>` et le paragraphe au-dessus ne sont pas liés au champ. Un lecteur
d'écran annonce donc « champ de saisie », sans dire à quoi il sert, et le placeholder disparaît à la saisie.

    // frontend/src/SosButton.jsx:136 — current
    <input
      className="field"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="06 12 34 56 78"
      value={number}
      onChange={(e) => setNumber(e.target.value)}
    />

Pourquoi c'est prioritaire : cet écran sert en cas de besoin, quand on court seul. Un utilisateur de
VoiceOver doit pouvoir saisir son numéro sans deviner le champ.

## Target

Ajouter un nom accessible, sans changer le texte visible ni le placeholder :

    // target
    <input
      className="field"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      aria-label={t('Numéro à prévenir')}
      placeholder="06 12 34 56 78"
      value={number}
      onChange={(e) => setNumber(e.target.value)}
    />

Référence canonique : `npx react-doctor@latest rules explain no-placeholder-only-field`. Le prompt en ligne
n'a pas été lu dans cette session.

**Décision à confirmer avant exécution** : « Numéro à prévenir » est une nouvelle chaîne en français. Le
projet demande de ne pas changer le texte français sans accord. Proposer ce libellé à l'utilisateur et
attendre son « oui » avant d'écrire. Si la chaîne est validée, l'ajouter à `frontend/src/locales/en.js`
avec sa traduction anglaise (par exemple « Number to alert »).

## Repo conventions to follow

- Les autres champs du même composant ou de `frontend/src/` utilisent-ils `aria-label` ou un `<label>` ?
  Chercher `aria-label=` et `<label` dans `frontend/src/*.jsx` et imiter le plus proche. Préférer un
  `<label>` visible si le design le permet, mais ne pas modifier la mise en page dans ce plan.

## Steps

1. Ouvrir `frontend/src/SosButton.jsx` autour de la ligne 127–145.
2. Demander à l'utilisateur d'approuver « Numéro à prévenir » (voir décision ci-dessus). S'il refuse, garder
   le texte qu'il propose.
3. Ajouter `aria-label={t('…')}` au champ, comme dans « Target ».
4. Ajouter la clé dans `frontend/src/locales/en.js`, si la chaîne est nouvelle.
5. Relire le diff.

## Boundaries

- Ne pas changer le placeholder, le type, ni la logique de `setNumber`.
- Ne pas déplacer le titre ni le paragraphe.
- Ne pas toucher aux autres feuilles SOS.

## Verification

- **Mechanical** :
  - `npx react-doctor@latest --scope changed` ne signale plus la ligne 136.
  - `(cd frontend && npx vitest run src/SosButton.test.jsx)` s'il existe, sinon les tests liés passent.
- **Behavior check** : dans l'aperçu, ouvrir la feuille « Prévenir qui ? », vérifier avec l'inspecteur
  d'accessibilité que le champ a le nom attendu, puis saisir un numéro et vérifier que la valeur reste.
- **Done when** : le nom accessible est présent, la saisie n'a pas changé, et les tests passent.
