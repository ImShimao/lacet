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

// **Sa propre clé, et c'est tout l'intérêt.**
//
// La sortie en cours vivait dans le magasin principal, avec les favoris et
// l'historique. Écrire dix kilooctets obligeait alors à relire, puis à
// réécrire, *tout* le reste — mesuré à 194 ms par passage sur un magasin
// plein, toutes les dix secondes, pendant que le GPS, la carte et la voix
// travaillent sur le même fil.
//
// Pire : quand ce magasin dépassait le quota du navigateur, l'écriture
// échouait, et `save` sacrifiait alors des sorties de l'historique pour faire
// de la place (voir `storage.js`). Autrement dit, courir pouvait effacer les
// sorties passées. Séparées, les deux ne se touchent plus.
const KEY = 'lacet.run.v1'

// Au-delà, ce n'est plus une sortie interrompue : c'est un vieux reste qu'on ne
// va pas proposer de reprendre.
const MAX_AGE_MS = 12 * 3_600_000

// En dessous, il n'y a rien à sauver : un démarrage par erreur.
const MIN_DISTANCE_M = 150

/**
 * Écrit l'état de la sortie en cours. Rend `false` si le navigateur a refusé.
 *
 * L'échec n'interrompt rien : une sortie continue de se courir sans disque, et
 * seule la reprise après fermeture est perdue. Mais il est rendu, parce que
 * « Mon compte » doit pouvoir le dire plutôt que de le taire.
 */
export function saveRun(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

/** Oublie la sortie en cours — à la fin, ou quand on l'abandonne. */
export function clearRun() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* rien à oublier si l'on ne peut pas écrire */
  }
  // L'ancien emplacement, dans le magasin principal : une sortie interrompue
  // avant la mise à jour y dort encore, et la laisser ferait reproposer la même
  // reprise à chaque lancement.
  if (load().run) save({ run: null })
}

/**
 * La sortie interrompue à reprendre, ou `null`.
 *
 * `now` est injectable pour les tests.
 */
export function loadRun(now = Date.now()) {
  let run = null
  try {
    const raw = localStorage.getItem(KEY)
    run = raw ? JSON.parse(raw) : null
  } catch {
    run = null
  }
  // Le repli sur l'ancien emplacement vaut pour une seule fois : celle où l'app
  // est mise à jour alors qu'une sortie était en cours. Sans lui, la mise à
  // jour effacerait la seule donnée de l'app qu'on ne peut pas refaire.
  if (!run) run = load().run ?? null
  if (!run?.at) return null
  if (now - run.at > MAX_AGE_MS) return null
  if ((run.covered ?? 0) < MIN_DISTANCE_M) return null
  return run
}
