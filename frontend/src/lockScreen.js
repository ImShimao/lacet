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
export function lockScreenState({ route, step, along, offRoute, paused = false, travelled, elapsedS, share = null, now = Date.now() }) {
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
    // `share` : l'avancée sur le parcours prévu, quand un détour a remplacé le
    // tracé — la barre ne doit pas repartir de zéro à chaque recalcul.
    progress: Math.min(1, Math.max(0, share ?? (total ? (along ?? 0) / total : 0))),
    offRoute: Boolean(offRoute),
    // En pause, l'écran le dit au lieu d'un compte à rebours qui filerait vers
    // une arrivée qu'on n'atteindra pas à l'heure dite.
    paused: Boolean(paused),
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
  if (
    previous.instruction !== next.instruction ||
    previous.offRoute !== next.offRoute ||
    previous.paused !== next.paused
  ) {
    return true
  }
  if (previous.distance === next.distance && previous.remaining === next.remaining) return false
  return elapsedMs >= minMs
}

/**
 * La notification de secours, quand l'activité en direct n'est pas disponible.
 *
 * Une notification ne sait pas faire défiler un compte à rebours : elle donne
 * l'heure d'arrivée, qui, elle, ne se périme pas d'une seconde à l'autre.
 */
export function noticeOf(state) {
  if (state.paused) {
    return { title: 'Sortie en pause', subtitle: '', body: `Reste ${state.remaining} jusqu'à l'arrivée.`, icon: 'start' }
  }
  if (state.offRoute) {
    return {
      title: 'Hors parcours',
      subtitle: '',
      body: 'Lacet te propose un chemin pour revenir sur la boucle.',
      icon: 'warning',
    }
  }
  const at = new Date(state.arrival)
  const clock = `${at.getHours()}h${String(at.getMinutes()).padStart(2, '0')}`
  return {
    // Le virage en titre, sa distance en sous-titre : c'est l'ordre dans lequel
    // l'œil les prend sur un écran de verrouillage, et la vignette de la flèche
    // (`icon`) donne la direction avant même la lecture.
    title: state.instruction,
    subtitle: state.distance === 'maintenant' ? 'Maintenant' : `Dans ${state.distance}`,
    body: `Reste ${state.remaining} · arrivée vers ${clock}`,
    icon: state.turn || 'straight',
  }
}
