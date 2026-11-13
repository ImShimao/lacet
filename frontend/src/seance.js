// Séance du jour, version simple : des efforts en mètres (« 400 m »), des
// récupérations en secondes (« 1 min »), dits à la voix pendant une sortie.
//
// Le module ne parle pas : à chaque relevé, il rend l'état suivant et, s'il y a
// une transition, la phrase à dire. `LiveRun.jsx` la dit par son `talk`, qui
// tient aussi le journal de la sortie. Un effort se mesure en distance courue,
// une récupération en temps en mouvement : une pause à un feu ne raccourcit pas
// la récupération : `LiveRun.jsx` lui passe le temps en mouvement (`movingSeconds`),
// si bien qu'une pause au bouton prolonge la récupération au lieu de la finir.

export const SEANCE = { reps: 6, effort: 400, rest: 60 }

/** Lance la séance à la position `{ metres, seconds }` du moment : première répétition. */
export function startSeance({ metres, seconds }, spec = SEANCE) {
  const state = { spec, rep: 1, phase: 'effort', from: { metres, seconds }, over: false }
  return { state, say: `Séance. Répétition 1 sur ${spec.reps}. Effort, ${spec.effort} mètres.` }
}

/**
 * Au relevé `{ metres, seconds }`, passe à l'étape suivante si elle est atteinte.
 * Sans transition, rend le même `state` et `say` à `null`.
 *
 * Pas de récupération après la dernière répétition : la séance s'arrête à la
 * ligne d'arrivée de son dernier effort.
 */
export function stepSeance(state, { metres, seconds }) {
  if (!state || state.over) return { state, say: null }
  const { spec, rep, phase, from } = state
  if (phase === 'effort') {
    if (metres - from.metres < spec.effort) return { state, say: null }
    if (rep === spec.reps) {
      return { state: { ...state, over: true, phase: 'done' }, say: 'Séance terminée.' }
    }
    return {
      state: { ...state, phase: 'rest', from: { metres, seconds } },
      say: `Récupération, ${spec.rest} secondes.`,
    }
  }
  if (seconds - from.seconds < spec.rest) return { state, say: null }
  const next = rep + 1
  return {
    state: { ...state, rep: next, phase: 'effort', from: { metres, seconds } },
    say: `Répétition ${next} sur ${spec.reps}. Effort, ${spec.effort} mètres.`,
  }
}
