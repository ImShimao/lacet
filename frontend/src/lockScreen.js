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
 * Ce qui doit tenir l'écran de verrouillage pendant la sortie.
 *
 * `'activity'`, `'notice'`, `'both'`, ou `null` quand l'iPhone ne peut rien
 * afficher du tout.
 *
 * **Pourquoi « les deux » est le cas ordinaire.** iOS accepte une activité en
 * direct dès que l'extension qui la dessine est dans le paquet de l'app ; il ne
 * dit jamais s'il a réussi à la lancer. Une installation hors App Store qui
 * n'enregistre pas l'extension donne donc une demande acceptée, un écran de
 * verrouillage noir, et pas un mot d'explication — l'app se croyait tirée
 * d'affaire et ne posait pas la notification de secours.
 *
 * Tant que personne n'a confirmé avoir vu l'activité sur cet iPhone (`seen`),
 * on tient donc les deux à jour. La notification est passive : ni son, ni écran
 * allumé, et une seule à la fois, remplacée à chaque consigne. La redondance ne
 * coûte rien ; le silence coûtait la sortie.
 *
 * @param {object} o
 * @param {string} o.setting      le réglage de « Mon compte » : 'auto' | 'notice'
 * @param {boolean} o.started     iOS a accepté l'activité en direct
 * @param {boolean} o.noticeAllowed les notifications sont autorisées
 * @param {boolean} o.seen        l'activité a déjà été vue sur cet iPhone
 */
export function lockScreenMode({ setting, started, noticeAllowed, seen, card = false }) {
  // La carte du lecteur ne se devine pas tout à fait : elle confisque le
  // lecteur du téléphone. En automatique, on ne la prend que faute d'activité
  // en direct **et** si aucune musique ne joue (voir `fallbackCard`).
  if (setting === 'card') return card ? 'card' : noticeAllowed ? 'notice' : null
  if (!started && card) return 'card'
  if (!started) return noticeAllowed ? 'notice' : null
  if (seen) return 'activity'
  return noticeAllowed ? 'both' : 'activity'
}

/** L'activité en direct doit-elle être tentée, vu le réglage ? */
export const wantsActivity = (setting) => setting === 'auto'

/**
 * En automatique, faut-il se rabattre sur la carte du lecteur ?
 *
 * Oui quand l'activité en direct n'a pas pris — c'est le plus lisible des
 * replis — mais **seulement si rien ne joue** : couper la musique de quelqu'un
 * qui court en musique serait pire que la notification silencieuse.
 */
export const fallbackCard = ({ setting, started, otherAudio }) =>
  setting === 'auto' && !started && !otherAudio

/**
 * Faut-il la notification, avant même de savoir si elle est autorisée ?
 *
 * Oui dès que l'activité en direct a échoué, et oui tant qu'elle n'a pas fait
 * ses preuves ici. C'est ce qui décide s'il faut demander l'autorisation.
 */
export const wantsNotice = ({ started, seen }) => !started || !seen

/**
 * Ce que porte la carte du lecteur : la consigne en titre, la distance et ce
 * qui reste en sous-titre, la flèche du virage en pochette.
 *
 * C'est la place d'un titre et d'un artiste : deux lignes, la première en gras.
 * Elles tombent juste sur ce qu'on lit en courant.
 */
export function cardOf(state, { elapsedS = 0, now = Date.now() } = {}) {
  // La barre du lecteur devient celle de la sortie : le temps déjà couru, et
  // la durée jusqu'à l'arrivée estimée.
  const timing = {
    elapsed: Math.max(0, Math.round(elapsedS)),
    duration: Math.max(0, Math.round(elapsedS + Math.max(0, (state.arrival - now) / 1000))),
  }
  if (state.offRoute) {
    return { title: 'Hors parcours', subtitle: 'Reviens sur le tracé', icon: 'warning', ...timing }
  }
  if (state.paused) {
    return { title: 'Sortie en pause', subtitle: `Reste ${state.remaining}`, icon: 'start', ...timing }
  }
  const near = state.distance === 'maintenant' ? 'Maintenant' : state.distance
  return {
    title: state.instruction,
    subtitle: `${near} · reste ${state.remaining}`,
    icon: state.turn || 'straight',
    ...timing,
  }
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
