// La sortie en cours, gardée hors de l'app.
//
// Une app de course peut être fermée en plein effort : iOS récupère la mémoire,
// le téléphone tombe à zéro pour cent, ou l'on glisse l'app par mégarde. Sans
// rien sur le disque, la sortie entière disparaît — distance, temps, trace — et
// c'est la seule donnée de l'app qu'on ne peut pas refaire.
//
// On écrit donc l'essentiel toutes les dix secondes : de quoi reprendre là où
// l'on s'est arrêté, ou au pire enregistrer ce qui avait été couru.

import { load, save } from './storage'

// Au-delà, ce n'est plus une sortie interrompue : c'est un vieux reste qu'on ne
// va pas proposer de reprendre.
const MAX_AGE_MS = 12 * 3_600_000

// En dessous, il n'y a rien à sauver : un démarrage par erreur.
const MIN_DISTANCE_M = 150

/** Écrit l'état de la sortie en cours. */
export const saveRun = (state) => save({ run: { ...state, at: Date.now() } })

/** Oublie la sortie en cours — à la fin, ou quand on l'abandonne. */
export const clearRun = () => save({ run: null })

/**
 * La sortie interrompue à reprendre, ou `null`.
 *
 * `now` est injectable pour les tests.
 */
export function loadRun(now = Date.now()) {
  const run = load().run
  if (!run?.at) return null
  if (now - run.at > MAX_AGE_MS) return null
  if ((run.covered ?? 0) < MIN_DISTANCE_M) return null
  return run
}
