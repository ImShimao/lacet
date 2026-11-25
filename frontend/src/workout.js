// La séance fractionnée, dite à la voix : échauffement, répétitions,
// récupérations, retour au calme.
//
// Sur une piste, on lit sa montre entre deux tours ; dans la rue, les yeux sont
// sur le trottoir. La voix dit donc chaque bloc à son début — ce qu'il faut
// courir et combien de temps —, prévient peu avant sa fin, et donne le temps de
// chaque répétition courue à la distance. Le chrono est celui de la sortie,
// pauses déduites : un feu rouge en pleine récupération ne la mange pas.
//
// Indépendante du tracé : elle se court sur une boucle guidée comme en course
// libre. Réglée dans « Mon compte › Guidage et voix », lue au départ.

import { load } from './storage'

import { t as tr } from './i18n'
/** Les séances proposées : les classiques du fractionné, de la piste au court-long. */
export const WORKOUT_PRESETS = [
  { key: '400', label: '8 × 400 m', reps: 8, work: { m: 400 }, rest_s: 90 },
  { key: '1000', label: '5 × 1 km', reps: 5, work: { m: 1000 }, rest_s: 120 },
  { key: '30-30', label: '10 × 30 s / 30 s', reps: 10, work: { s: 30 }, rest_s: 30 },
  { key: '1min', label: '10 × 1 min', reps: 10, work: { s: 60 }, rest_s: 60 },
  { key: '3min', label: '6 × 3 min', reps: 6, work: { s: 180 }, rest_s: 120 },
]

// La séance à soi : réglée champ par champ quand aucun classique ne convient.
// Gardée même quand on revient à un classique, pour la retrouver telle quelle.
export const CUSTOM_DEFAULTS = { reps: 6, unit: 'm', work_m: 400, work_s: 60, rest_s: 90 }

export const WORKOUT_DEFAULTS = { on: false, preset: '400', warmup_min: 10, cooldown_min: 5, custom: CUSTOM_DEFAULTS }

/** « 400 m », « 1,5 km », « 30 s », « 1 min 30 » : une quantité en peu de signes. */
export function shortAmount(b) {
  if (b.m) return b.m % 1000 ? (b.m > 1000 ? `${String(b.m / 1000).replace('.', ',')} km` : `${b.m} m`) : `${b.m / 1000} km`
  const m = Math.floor(b.s / 60)
  const s = b.s % 60
  if (!m) return `${s} s`
  return s ? `${m} min ${s}` : `${m} min`
}

/** La séance à courir : un classique, ou la séance personnalisée mise sous la même forme. */
export function workoutPlan(settings = workoutSettings()) {
  if (settings.preset === 'custom') {
    const c = { ...CUSTOM_DEFAULTS, ...settings.custom }
    const work = c.unit === 's' ? { s: c.work_s } : { m: c.work_m }
    return { key: 'custom', reps: c.reps, work, rest_s: c.rest_s, label: `${c.reps} × ${shortAmount(work)} / ${shortAmount({ s: c.rest_s })}` }
  }
  return WORKOUT_PRESETS.find((p) => p.key === settings.preset) ?? WORKOUT_PRESETS[0]
}

export const workoutSettings = () => ({ ...WORKOUT_DEFAULTS, ...load().workout })

// Le dernier avertissement avant la fin d'un bloc : à temps pour se préparer,
// trop tard pour qu'on l'oublie. Seulement sur les blocs assez longs pour que
// la phrase ne chevauche pas celle du début.
const WARN_S = 10
const WARN_MIN_S = 45
const WARN_M = 100
const WARN_MIN_M = 300

/** « 1 minute 30 », « 45 secondes » — une durée comme on la dit. */
export function durationWords(seconds) {
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (!m) return `${s} secondes`
  const whole = m > 1 ? `${m} minutes` : '1 minute'
  return s ? `${whole} ${s}` : whole
}

const amountWords = (b) => (b.m ? (b.m % 1000 ? tr('{m} mètres', { m: b.m }) : b.m === 1000 ? tr('1 kilomètre') : tr('{v1} kilomètres', { v1: b.m / 1000 })) : durationWords(b.s))

/** Les blocs de la séance, dans l'ordre. */
export function blocksOf(settings = workoutSettings()) {
  const preset = workoutPlan(settings)
  const out = []
  if (settings.warmup_min > 0) out.push({ kind: 'warmup', s: settings.warmup_min * 60 })
  for (let rep = 1; rep <= preset.reps; rep += 1) {
    out.push({ kind: 'work', rep, reps: preset.reps, ...preset.work })
    if (rep < preset.reps) out.push({ kind: 'rest', rep, reps: preset.reps, s: preset.rest_s })
  }
  if (settings.cooldown_min > 0) out.push({ kind: 'cooldown', s: settings.cooldown_min * 60 })
  const spoken = tr('{reps} fois {v2}, récupération {v3}', { reps: preset.reps, v2: amountWords(preset.work), v3: durationWords(preset.rest_s) })
  return { label: preset.label, spoken, blocks: out }
}

function startPhrase(b) {
  if (b.kind === 'warmup') return tr('D\'abord {v1} d\'échauffement, tranquille.', { v1: amountWords(b) })
  if (b.kind === 'rest') return tr('Récupère : {v1}, en trottinant.', { v1: amountWords(b) })
  if (b.kind === 'cooldown') return tr('Fini les répétitions. Retour au calme : {v1}.', { v1: amountWords(b) })
  const which = b.rep === b.reps ? tr('Dernière répétition') : tr('Répétition {rep} sur {reps}', { rep: b.rep, reps: b.reps })
  return `${which} : ${amountWords(b)}. Vas-y !`
}

const TITLES = { warmup: 'Échauffement', rest: 'Récupération', cooldown: 'Retour au calme' }

/**
 * Le coach : on lui donne le temps couru et la distance, aussi souvent qu'on
 * veut ; il rend ce qu'il faut dire maintenant, et où en est la séance.
 *
 * @returns `update(seconds, metres)` → `{ said: string[], status }`, `status`
 *   valant `null` une fois la séance finie, sinon `{ kind, title, left, rep, reps }`
 *   où `left` est en secondes ou en mètres selon le bloc (`unit`).
 */
export function createCoach({ spoken, blocks }, saved = null) {
  // `saved` : l'instantané d'une sortie reprise après un arrêt de l'app — le
  // bloc en cours et d'où il est parti, en temps couru et en mètres.
  let index = saved?.index ?? -1
  let from = saved?.from ?? { t: 0, m: 0 }
  let warned = saved?.warned ?? false
  let done = saved?.done ?? false

  return {
    /** Ce qu'il faut garder pour reprendre la séance où elle en était. */
    snapshot: () => ({ index, from: { ...from }, warned, done }),
    update(t, m) {
      const said = []
      if (done || !blocks.length) return { said, status: null }
      if (index === -1) {
        index = 0
        from = { t, m }
        said.push(tr('Séance fractionnée : {spoken}. {v2}', { spoken, v2: startPhrase(blocks[0]) }))
      }
      for (;;) {
        const b = blocks[index]
        const left = b.m ? b.m - (m - from.m) : b.s - (t - from.t)
        if (left > 0) {
          const warn = b.m ? b.m >= WARN_MIN_M && left <= WARN_M : b.s >= WARN_MIN_S && left <= WARN_S
          if (warn && !warned) {
            warned = true
            said.push(b.m ? tr('Plus que {WARN_M} mètres.', { WARN_M }) : tr('Dix secondes.'))
          }
          return {
            said,
            status: { kind: b.kind, title: TITLES[b.kind] ?? tr('Répétition {rep}/{reps}', { rep: b.rep, reps: b.reps }), left, unit: b.m ? 'm' : 's', rep: b.rep, reps: b.reps },
          }
        }
        // Le bloc est fini : le temps d'une répétition courue à la distance, puis la suite.
        const took = b.kind === 'work' && b.m ? tr('Terminé en {v1}.', { v1: durationWords(t - from.t) }) : ''
        index += 1
        from = { t, m }
        warned = false
        if (index >= blocks.length) {
          done = true
          said.push(`${took} Séance terminée. Bravo !`.trim())
          return { said, status: null }
        }
        said.push(`${took} ${startPhrase(blocks[index])}`.trim())
      }
    },
  }
}
