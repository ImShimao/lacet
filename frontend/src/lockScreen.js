// Ce que l'écran de verrouillage affiche pendant une sortie guidée.
//
// Téléphone dans la poche ou au brassard, on ne rouvre pas l'app pour savoir
// où tourner : on allume l'écran. L'app iPhone y pose une « activité en
// direct » — la consigne à venir, sa distance, le temps restant — dessinée par
// une petite extension native (`ios-overlay/live-activity/`). Ce module ne fait
// que préparer ces quelques valeurs, déjà formatées : l'extension les affiche
// telles quelles, sans rien recalculer.

// En dessous de cette distance parcourue, l'allure réelle ne dit encore rien :
// le premier kilomètre part d'un feu rouge ou d'un lacet à renouer. On se fie à
// l'allure prévue par le parcours jusque-là.
const MEASURED_AFTER_M = 400
const MEASURED_AFTER_S = 120

// Allure par défaut, en secondes par mètre, si le parcours n'en dit rien :
// 6 min 30 au kilomètre.
const DEFAULT_PACE = 0.39

/** « 120 m », « 1,2 km » — arrondi à ce qu'on peut lire en courant. */
export function shortDistance(meters) {
  const m = Math.max(0, meters)
  if (m < 20) return 'maintenant'
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

/** « 3,2 km » : ce qui reste jusqu'à l'arrivée. */
export function remainingDistance(meters) {
  const m = Math.max(0, meters)
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

/**
 * Secondes par mètre pour estimer l'arrivée.
 *
 * L'allure réelle dès qu'elle a un sens, l'allure prévue avant : afficher une
 * arrivée dans quatre heures parce qu'on a attendu au premier passage piéton
 * ferait douter de tout le reste.
 */
export function paceEstimate({ route, travelled, elapsedS }) {
  if (travelled >= MEASURED_AFTER_M && elapsedS >= MEASURED_AFTER_S) return elapsedS / travelled
  if (route?.duration_s > 0 && route?.distance_m > 0) return route.duration_s / route.distance_m
  return DEFAULT_PACE
}

/**
 * L'état complet à envoyer à l'écran de verrouillage.
 *
 * `step` est la consigne à venir telle que la rend `nextInstruction` —
 * `{ step, remaining }` — ou `null` quand il n'y en a plus.
 */
export function lockScreenState({ route, step, along, offRoute, travelled, elapsedS, now = Date.now() }) {
  const total = route?.distance_m || 0
  const left = Math.max(0, total - (along ?? travelled))
  const pace = paceEstimate({ route, travelled, elapsedS })
  const instruction = step?.step?.text || (left < 30 ? 'Arrivée' : 'Continue sur le parcours')

  return {
    name: route?.name || 'Sortie',
    instruction,
    distance: step ? shortDistance(step.remaining) : shortDistance(left),
    turn: step?.step?.turn || (left < 30 ? 'finish' : 'straight'),
    remaining: remainingDistance(left),
    arrival: Math.round(now + left * pace * 1000),
    progress: total ? Math.min(1, Math.max(0, (along ?? 0) / total)) : 0,
    offRoute: Boolean(offRoute),
  }
}

/**
 * Faut-il mettre l'écran à jour ?
 *
 * Tout de suite quand la consigne change ou qu'on sort du tracé — c'est ce
 * qu'on vient y lire. Sinon au plus toutes les `minMs` : la distance au virage
 * bouge à chaque relevé, et réveiller l'affichage à chaque seconde coûterait de
 * la batterie pour un chiffre que personne ne regarde. Le temps restant, lui,
 * défile tout seul à l'écran.
 */
export function shouldRefresh(previous, next, elapsedMs, minMs = 5000) {
  if (!previous) return true
  if (previous.instruction !== next.instruction || previous.offRoute !== next.offRoute) return true
  if (previous.distance === next.distance && previous.remaining === next.remaining) return false
  return elapsedMs >= minMs
}
