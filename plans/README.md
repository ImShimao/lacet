# Plans improve-react

Audit lancé sur le commit a4fe34c (React Doctor 0.9.23, 147 diagnostics bruts).

Après vérification à la lecture du code, beaucoup de diagnostics du scan ne sont pas des défauts ici :

| Diagnostic signalé | Verdict après lecture |
|---|---|
| `MapView.jsx` `effect-needs-cleanup` (126, 351, 377, 406, 448, 668) | Faux positif. La carte est détruite au démontage (`instance.remove()`, l. 304) ; les écouteurs de l'effet du tracé sont retirés (l. 818–826) ; les marqueurs sont retirés par leur propre cycle. |
| `Account.jsx` `exhaustive-deps` (60, 73) | Faux positif. `known` dépend de `page`, donc aucune valeur périmée. |
| `ShareSheet.jsx` 29, 69 | Faux positifs. Le drapeau `alive` protège la mise à jour ; `fetch` reçoit une URL `data:`, qui ne peut pas échouer en 4xx. |
| `Countdown.jsx` 37 | Faux positif. L'effet est relancé à chaque `n`. |
| `Explore.jsx` 1036, 1057 | Clés d'index sur des listes statiques (étapes, rejets) : sans effet réel. |
| `Explain.jsx` 52, `Prefs.jsx` 73 | Fond cliquable de dialogue, voulu. À confirmer côté clavier avant de planifier. |
| `FiltersSheet.jsx` `prefer-html-dialog` | `docs/interface.md` dit que les réglages « retiennent le focus » : à vérifier avant de remplacer par `<dialog>`. |

## Plans retenus

| # | Fichier | Catégorie | Sévérité | Statut |
|---|---|---|---|---|
| 001 | [offline-style-fetch-status](001-offline-style-fetch-status.md) | Bugs | MEDIUM | DONE (f26e87c, sans test unitaire) |
| 002 | [app-poi-prefs-save-outside-updater](002-app-poi-prefs-save-outside-updater.md) | Bugs | LOW | DONE (a010197) |
| 003 | [sos-contact-field-label](003-sos-contact-field-label.md) | Accessibilité | HIGH | DONE (non commité) |

## Ordre recommandé

1. 003 — impact le plus fort (écran de sécurité), petit diff, bloqué seulement par l'accord sur le libellé.
2. 001 — avant tout test hors ligne.
3. 002 — réparation de règle, sans effet visible.

Pas de dépendances entre les plans.

## Non retenu (à reconsidérer)

- `LiveRun.jsx` 234, 276, 321 : `useRef(now())` évalue `now()` à chaque rendu. Gain réel faible.
- `LiveRun.jsx` 267–360 : les écritures de refs pendant le rendu sont gardées par un drapeau « une seule
  fois ». Le rendu reste idempotent. Le scan a raison en principe ; le risque concret est faible.
