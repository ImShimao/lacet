/**
 * Le bilan d'un mois : kilomètres, dénivelé, plus longue sortie, régularité.
 *
 * Module pur, sans React : la page `MonthReport.jsx` et la carte partageable
 * (`shareCard.js`) lisent les mêmes chiffres. Le mois et la semaine se comptent
 * en heure locale, comme l'écran de Mes parcours qui découpe déjà les mois.
 */

/** Le mois d'une sortie : « 2026-09 ». */
export function monthKey(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** « Septembre 2026 ». */
export function monthLabel(key) {
  if (!key) return 'Sans date'
  const [y, m] = key.split('-').map(Number)
  const text = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Le lundi de la semaine d'une date, à minuit : la semaine commence le lundi en France. */
function monday(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
}

/**
 * Les chiffres d'un mois. `key` : « 2026-09 ». Un mois sans sortie rend
 * `count: 0` et des zéros, sans `longest`.
 *
 * `ascent_m` reste `null` si aucune sortie du mois n'a de dénivelé mesuré :
 * un « 0 m » affirmerait un relief plat, pas une absence de donnée.
 * `weeks` : `active` semaines avec au moins une sortie, sur `total` semaines
 * qui touchent le mois (une semaine à cheval sur deux mois compte pour les deux).
 */
export function monthSummary(history, key) {
  const runs = (history || []).filter((r) => monthKey(r.ranAt) === key)
  const [y, m] = key.split('-').map(Number)
  const fin = new Date(y, m, 1)

  // Les semaines qui touchent le mois, du lundi qui le précède au dernier jour.
  let total = 0
  for (let lundi = monday(new Date(y, m - 1, 1)); lundi < fin; lundi = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 7)) total += 1
  const active = new Set(runs.map((r) => monday(new Date(r.ranAt)).getTime())).size

  const measured = runs.filter((r) => r.actual_ascent_m != null)
  const longest = runs.reduce((best, r) => ((r.actual_distance_m || 0) > (best?.actual_distance_m || 0) ? r : best), null)

  return {
    count: runs.length,
    distance_m: runs.reduce((sum, r) => sum + (r.actual_distance_m || 0), 0),
    time_s: runs.reduce((sum, r) => sum + (r.actual_duration_s || 0), 0),
    ascent_m: measured.length ? measured.reduce((sum, r) => sum + r.actual_ascent_m, 0) : null,
    longest: longest && (longest.actual_distance_m || 0) > 0 ? longest : null,
    weeks: { active, total },
  }
}

/**
 * La distance de chaque jour du mois `key` (« 2026-09 »), en mètres, du 1er au
 * dernier : un jour sans sortie vaut 0, pour que le dessin garde sa place.
 */
export function dailyMetres(runs, key) {
  const [y, m] = key.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const out = Array.from({ length: days }, () => 0)
  for (const r of runs) {
    const d = new Date(r.ranAt)
    if (monthKey(r.ranAt) !== key) continue
    out[d.getDate() - 1] += r.actual_distance_m || 0
  }
  return out
}
