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
// libre. Réglée dans « Mon compte › Séance fractionnée », lue au départ.
//
// Une séance personnalisée enchaîne des séries — « 6 × 400 m, puis 3 × 1 km » —,
// chacune avec son effort et sa récupération, et une récupération plus longue
// entre deux séries : une seule série ne disait ni la pyramide ni le court-long.

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
export const SERIES_DEFAULTS = { reps: 6, unit: 'm', work_m: 400, work_s: 60, rest_s: 90 }
export const CUSTOM_DEFAULTS = { series: [SERIES_DEFAULTS], set_rest_s: 180 }
export const MAX_SERIES = 6

/**
 * Les séries d'une séance personnalisée. Avant les séries, la séance tenait en
 * une seule (`{ reps, unit, work_m, … }` à plat) : on la relit comme sa
 * première série, pour ne rien perdre de ce qui était réglé.
 */
export function customSeries(custom = {}) {
  if (Array.isArray(custom.series) && custom.series.length) return custom.series.map((x) => ({ ...SERIES_DEFAULTS, ...x }))
  return [{ ...SERIES_DEFAULTS, ...custom }]
}

/** Une série réglée (`unit`, `work_m`, `work_s`) mise sous la forme d'une série de séance. */
const seriesOf = (x) => ({ reps: x.reps, work: x.unit === 's' ? { s: x.work_s } : { m: x.work_m }, rest_s: x.rest_s })

/** Le classique repris en séance personnalisée, pour le retoucher. */
export function customFromPreset(key) {
  const p = WORKOUT_PRESETS.find((x) => x.key === key) ?? WORKOUT_PRESETS[0]
  const series = { ...SERIES_DEFAULTS, reps: p.reps, rest_s: p.rest_s, ...(p.work.m ? { unit: 'm', work_m: p.work.m } : { unit: 's', work_s: p.work.s }) }
  return { ...CUSTOM_DEFAULTS, series: [series] }
}

export const WORKOUT_DEFAULTS = { on: false, preset: '400', warmup_min: 10, cooldown_min: 5, custom: CUSTOM_DEFAULTS }

/** « 400 m », « 1,5 km », « 30 s », « 1 min 30 » : une quantité en peu de signes. */
export function shortAmount(b) {
  if (b.m) return b.m % 1000 ? (b.m > 1000 ? `${String(b.m / 1000).replace('.', ',')} km` : `${b.m} m`) : `${b.m / 1000} km`
  const m = Math.floor(b.s / 60)
  const s = b.s % 60
  if (!m) return `${s} s`
  return s ? `${m} min ${s}` : `${m} min`
}

const seriesLabel = (x) => `${x.reps} × ${shortAmount(x.work)} / ${shortAmount({ s: x.rest_s })}`

/**
 * La séance à courir : ses séries, et la récupération entre deux séries. Un
 * classique n'a qu'une série, et pas de récupération à part.
 */
export function workoutPlan(settings = workoutSettings()) {
  if (settings.preset === 'custom') {
    const series = customSeries(settings.custom).map(seriesOf)
    const set_rest_s = settings.custom?.set_rest_s ?? CUSTOM_DEFAULTS.set_rest_s
    return { key: 'custom', series, set_rest_s, label: series.map(seriesLabel).join(' + ') }
  }
  const p = WORKOUT_PRESETS.find((x) => x.key === settings.preset) ?? WORKOUT_PRESETS[0]
  return { key: p.key, series: [{ reps: p.reps, work: p.work, rest_s: p.rest_s }], set_rest_s: 0, label: p.label }
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

/**
 * Les blocs de la séance, dans l'ordre. Les répétitions se comptent sur toute
 * la séance — « répétition 7 sur 9 » —, pas série par série : c'est ce qui
 * reste à courir qu'on veut entendre.
 */
export function blocksOf(settings = workoutSettings()) {
  const plan = workoutPlan(settings)
  const reps = plan.series.reduce((n, x) => n + x.reps, 0)
  const out = []
  if (settings.warmup_min > 0) out.push({ kind: 'warmup', s: settings.warmup_min * 60 })
  let rep = 0
  plan.series.forEach((x, i) => {
    for (let k = 1; k <= x.reps; k += 1) {
      rep += 1
      out.push({ kind: 'work', rep, reps, ...x.work })
      if (rep === reps) continue
      // La dernière répétition d'une série : la récupération entre séries, si elle est réglée.
      const between = k === x.reps && i < plan.series.length - 1 && plan.set_rest_s > 0
      out.push({ kind: 'rest', rep, reps, s: between ? plan.set_rest_s : x.rest_s })
    }
  })
  if (settings.cooldown_min > 0) out.push({ kind: 'cooldown', s: settings.cooldown_min * 60 })
  const spoken = plan.series
    .map((x) => tr('{reps} fois {v2}, récupération {v3}', { reps: x.reps, v2: amountWords(x.work), v3: durationWords(x.rest_s) }))
    .join(tr(', puis '))
  return { label: plan.label, spoken, blocks: out }
}

// L'effort se court plus vite que l'allure habituelle, la récupération plus
// lentement, en trottinant : sans ces écarts, 8 × 400 m à 6:30/km
// s'annonçaient pour un quart d'heure de trop.
const WORK_PACE = 0.85
const REST_PACE = 1.4

/**
 * Ce que la séance prendra, à l'allure donnée (secondes au kilomètre) : sa
 * durée, sa distance, et chaque bloc avec sa durée — pour la dessiner à
 * l'échelle. Une estimation : on ne court pas un 400 m comme on le prévoit.
 */
export function estimate(settings = workoutSettings(), pace = 390) {
  const blocks = blocksOf(settings).blocks.map((b) => {
    const factor = b.kind === 'work' ? WORK_PACE : b.kind === 'rest' ? REST_PACE : 1
    const p = pace * factor
    return b.m ? { ...b, secs: (b.m / 1000) * p, metres: b.m } : { ...b, secs: b.s, metres: (b.s / p) * 1000 }
  })
  return {
    blocks,
    seconds: blocks.reduce((n, b) => n + b.secs, 0),
    metres: blocks.reduce((n, b) => n + b.metres, 0),
    reps: blocks.filter((b) => b.kind === 'work').length,
  }
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
