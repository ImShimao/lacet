// Séance du jour, pendant une sortie : des efforts et des récupérations, chacun en
// mètres ou en secondes (voir `seanceSpec.js` pour le réglage), dits à la voix.
//
// Le module ne parle pas : à chaque relevé, il rend l'état suivant et, s'il y a
// une transition, la phrase à dire. `LiveRun.jsx` la dit par son `talk`, qui
// tient aussi le journal de la sortie. Une distance se mesure en mètres courus,
// une durée en temps en mouvement : une pause à un feu ne raccourcit pas la
// récupération — `LiveRun.jsx` lui passe le temps en mouvement (`movingSeconds`),
// si bien qu'une pause au bouton prolonge la récupération au lieu de la finir.

import { DEFAULT_SEANCE, normalizeSeance, spoken } from './seanceSpec'

/** Lance la séance à la position `{ metres, seconds }` du moment : première répétition. */
export function startSeance({ metres, seconds }, spec = DEFAULT_SEANCE) {
  const s = normalizeSeance(spec)
  const state = { spec: s, rep: 1, phase: 'effort', from: { metres, seconds }, over: false }
  return { state, say: `Fractionné. Répétition 1 sur ${s.reps}. Effort, ${spoken(s.effort)}.` }
}

// Une étape est finie quand la distance courue, ou le temps en mouvement, depuis
// son début atteint sa valeur.
const reached = ({ unit, value }, now, from) =>
  unit === 'm' ? now.metres - from.metres >= value : now.seconds - from.seconds >= value

/**
 * Au relevé `{ metres, seconds }`, passe à l'étape suivante si elle est finie.
 * Sans transition, rend le même `state` et `say` à `null`.
 *
 * Pas de récupération après la dernière répétition : la séance s'arrête à la
 * ligne d'arrivée de son dernier effort.
 */
export function stepSeance(state, now) {
  if (!state || state.over) return { state, say: null }
  const { spec, rep, phase, from } = state
  if (phase === 'effort') {
    if (!reached(spec.effort, now, from)) return { state, say: null }
    if (rep === spec.reps) {
      return { state: { ...state, over: true, phase: 'done' }, say: 'Fractionné terminé.' }
    }
    return {
      state: { ...state, phase: 'rest', from: { metres: now.metres, seconds: now.seconds } },
      say: `Récupération, ${spoken(spec.rest)}.`,
    }
  }
  if (!reached(spec.rest, now, from)) return { state, say: null }
  const next = rep + 1
  return {
    state: { ...state, rep: next, phase: 'effort', from: { metres: now.metres, seconds: now.seconds } },
    say: `Répétition ${next} sur ${spec.reps}. Effort, ${spoken(spec.effort)}.`,
  }
}
