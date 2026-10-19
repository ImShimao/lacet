// Ce que l'écran de verrouillage affiche pendant une sortie guidée.
//
// Téléphone dans la poche ou au brassard, on ne rouvre pas l'app pour savoir
// où tourner : on allume l'écran. L'app iPhone y pose une « activité en
// direct » — la consigne à venir, sa distance, le temps restant — dessinée par
// une petite extension native (`ios-overlay/live-activity/`). Ce module ne fait
// que préparer ces quelques valeurs, déjà formatées : l'extension les affiche
// telles quelles, sans rien recalculer.

import { pace } from './format'
import { clock } from './runFormat'

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
  if (m < 10) return 'maintenant'
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
 * `{ step, remaining }` —, complétée par l'écran de course de `imminent` (le
 * moment où la voix dit « maintenant ») et de `then` (la manœuvre d'après,
 * quand elle suit de près) ; ou `null` quand il n'y a plus de consigne.
 */
export function lockScreenState({ route, step, along, offRoute, paused = false, travelled, elapsedS, share = null, now = Date.now() }) {
  const total = route?.distance_m || 0
  const left = Math.max(0, total - (along ?? travelled))
  const pace = paceEstimate({ route, travelled, elapsedS })
  const text = step?.step?.text
  // Deux virages rapprochés se lisent ensemble : le second serait sinon affiché
  // une fois le premier pris, quand il n'est déjà plus temps de se placer.
  const instruction = text ? (step.then ? `${text} — ${step.then}` : text) : left < 30 ? 'Arrivée' : 'Continue sur le parcours'
  // « Maintenant » en même temps que la voix, quand l'écran de course le sait.
  const imminent = step ? step.imminent ?? step.remaining < 20 : false

  return {
    name: route?.name || 'Sortie',
    instruction,
    distance: imminent ? 'maintenant' : shortDistance(step ? step.remaining : left),
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
 * Le dernier état de l'écran de verrouillage : le bilan, drapeau à damier,
 * laissé un quart d'heure (`LiveActivityPlugin.end`). On range le téléphone
 * en arrivant ; c'est en le rallumant qu'on veut lire son temps.
 */
export function finishedState({ name, distanceM, elapsedS, bike = false, now = Date.now() }) {
  const perKm = distanceM > 100 ? elapsedS / (distanceM / 1000) : 0
  const average = bike
    ? `${((distanceM / Math.max(1, elapsedS)) * 3.6).toFixed(1).replace('.', ',')} km/h`
    : perKm
      ? `${pace(perKm)}/km`
      : null
  return {
    name: name || 'Sortie',
    instruction: ['Sortie terminée', [clock(elapsedS), average].filter(Boolean).join(' · ')].join(' — '),
    distance: `${(distanceM / 1000).toFixed(1).replace('.', ',')} km`,
    turn: 'finish',
    remaining: '0 m',
    arrival: now,
    progress: 1,
    offRoute: false,
    paused: false,
  }
}

/**
 * Faut-il mettre l'écran à jour ?
 *
 * Tout de suite quand la consigne change, quand il faut tourner maintenant ou
 * qu'on sort du tracé — c'est ce qu'on vient y lire. Sinon au plus toutes les
 * `minMs` : la distance au virage bouge à chaque relevé, et réveiller
 * l'affichage à chaque seconde coûterait de la batterie pour un chiffre que
 * personne ne regarde. L'écran de course raccourcit ce délai à l'approche d'un
 * virage, là où le chiffre compte.
 */
export function shouldRefresh(previous, next, elapsedMs, minMs = 5000) {
  if (!previous) return true
  if (
    previous.instruction !== next.instruction ||
    previous.offRoute !== next.offRoute ||
    previous.paused !== next.paused ||
    (next.distance === 'maintenant') !== (previous.distance === 'maintenant')
  ) {
    return true
  }
  if (previous.distance === next.distance && previous.remaining === next.remaining) return false
  return elapsedMs >= minMs
}
