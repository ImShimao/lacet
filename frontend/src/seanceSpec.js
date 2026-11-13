// La séance du jour, réglable : combien de répétitions, et chaque effort et chaque
// récupération en mètres ou en secondes. Module pur, partagé par l'accueil, la
// course (`seance.js`) et le moteur (`engine/service.js`).

export const DEFAULT_SEANCE = { reps: 6, effort: { unit: 'm', value: 400 }, rest: { unit: 's', value: 60 } }

// Bornes par unité : au-delà, une séance n'a plus de sens, ou le moteur ne trouve
// plus de ligne droite à parcourir.
const BOUNDS = { reps: [1, 30], m: [50, 5000], s: [10, 3600] }

const clamp = (value, [lo, hi], fallback) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

const phase = (input, fallback) => {
  const unit = input?.unit === 'm' || input?.unit === 's' ? input.unit : fallback.unit
  return { unit, value: clamp(input?.value, BOUNDS[unit], fallback.value) }
}

/** Une séance valide, quoi qu'on lui donne : ce qui manque ou sort des bornes prend la valeur par défaut. */
export function normalizeSeance(input) {
  return {
    reps: clamp(input?.reps, BOUNDS.reps, DEFAULT_SEANCE.reps),
    effort: phase(input?.effort, DEFAULT_SEANCE.effort),
    rest: phase(input?.rest, DEFAULT_SEANCE.rest),
  }
}

/** Ce qu'on dit à la voix : « 400 mètres », « 2 minutes », « 90 secondes ». */
export function spoken({ unit, value }) {
  if (unit === 'm') return `${value} mètres`
  if (value < 60) return `${value} secondes`
  const minutes = Math.floor(value / 60)
  const seconds = value % 60
  const text = minutes === 1 ? '1 minute' : `${minutes} minutes`
  return seconds ? `${text} ${seconds} secondes` : text
}

/** Ce qu'on affiche : « 400 m », « 2 min », « 1 min 30 s ». */
export function shown({ unit, value }) {
  if (unit === 'm') return `${value} m`
  if (value < 60) return `${value} s`
  const minutes = Math.floor(value / 60)
  const seconds = value % 60
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}

/** « 6 × 400 m, récup 1 min » — le libellé de la séance partout dans l'app. */
export function describeSeance(spec) {
  return `${spec.reps} × ${shown(spec.effort)}, récup ${shown(spec.rest)}`
}

// Allure de référence pour traduire un effort en secondes en longueur de ligne
// droite : 5 min/km. Une estimation seulement — l'effort réel dépend de la course,
// la ligne droite de la séance complète n'en est que la forme.
const EFFORT_PACE_MPS = 1000 / 300

/** La longueur de ligne droite qui porte un effort, en mètres. */
export const effortMetres = ({ unit, value }) => (unit === 'm' ? value : Math.round(value * EFFORT_PACE_MPS))
