// Séries et défis : ce qui donne envie de ressortir demain.
//
// **Les semaines d'affilée d'abord.** Courir tous les jours n'est ni le but ni
// sain pour la plupart des coureurs ; sortir chaque semaine, si. La série de
// jours reste montrée, mais à partir de deux : un seul jour n'est pas une série.
// Une série en cours n'est pas perdue tant que la période n'est pas finie : sans
// sortie aujourd'hui, celle d'hier tient encore jusqu'à minuit.
//
// **Le défi du mois avance par paliers.** Un objectif unique est trop haut en
// novembre et trop bas en juin ; un palier, c'est toujours le prochain à
// portée — 25, 50, 100 km… —, avec ce qu'il faut par jour pour l'atteindre.
//
// Tout se calcule sur l'historique de l'appareil, à l'heure locale.

const DAY_MS = 864e5

/** Les paliers du défi du mois, en kilomètres. Le vélo va trois fois plus loin. */
export const MONTH_TIERS_KM = { run: [25, 50, 100, 150, 200, 300, 500], bike: [100, 200, 300, 500, 750, 1000, 1500] }

function startOfDay(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Le lundi d'une date, à minuit : en France la semaine commence le lundi. */
function monday(d) {
  const out = startOfDay(d)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

/** Le début de la période `k` crans avant celle de `d` (jours ou semaines). */
function back(d, k, days) {
  const out = days === 7 ? monday(d) : startOfDay(d)
  out.setDate(out.getDate() - days * k)
  return out.getTime()
}

/**
 * La série en cours et la plus longue, en périodes de `days` jours qui se
 * suivent. En cours : depuis la période actuelle, ou depuis la précédente si
 * l'actuelle n'a pas encore de sortie.
 */
function series(starts, now, days) {
  let current = 0
  for (let k = starts.has(back(now, 0, days)) ? 0 : 1; starts.has(back(now, k, days)); k += 1) current += 1
  const sorted = [...starts].sort((a, b) => a - b)
  let best = sorted.length ? 1 : 0
  let run = 1
  for (let i = 1; i < sorted.length; i += 1) {
    // Arrondi : un changement d'heure fait un jour de 23 ou 25 heures.
    run = Math.round((sorted[i] - sorted[i - 1]) / DAY_MS) === days ? run + 1 : 1
    best = Math.max(best, run)
  }
  return { current, best }
}

/** Les semaines et les jours d'affilée avec au moins une sortie. */
export function streaks(history, now = new Date()) {
  const ds = (history || []).map((r) => new Date(r.ranAt)).filter((d) => !Number.isNaN(d.getTime()))
  const days = new Set(ds.map((d) => startOfDay(d).getTime()))
  const weeks = new Set(ds.map((d) => monday(d).getTime()))
  return {
    weeks: series(weeks, now, 7),
    ranThisWeek: weeks.has(monday(now).getTime()),
    days: series(days, now, 1),
    ranToday: days.has(startOfDay(now).getTime()),
  }
}

/**
 * Le défi du mois en cours : la distance faite, le dernier palier atteint, le
 * suivant, les jours qui restent et ce qu'il faut par jour.
 */
export function monthChallenge(history, sport = 'run', now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  let metres = 0
  let runs = 0
  for (const r of history || []) {
    const t = new Date(r.ranAt).getTime()
    if (!(t >= first.getTime() && t < next.getTime())) continue
    if ((r.sport || 'run') !== sport) continue
    metres += r.actual_distance_m || 0
    runs += 1
  }
  const tiers = MONTH_TIERS_KM[sport] ?? MONTH_TIERS_KM.run
  const km = metres / 1000
  const reached = [...tiers].reverse().find((t) => km >= t) ?? null
  const target = tiers.find((t) => km < t) ?? null
  // Aujourd'hui compte encore : on peut sortir ce soir.
  const daysLeft = Math.round((next.getTime() - startOfDay(now).getTime()) / DAY_MS)
  const perDayKm = target ? (target - km) / Math.max(1, daysLeft) : 0
  return {
    month: now.toLocaleDateString('fr-FR', { month: 'long' }),
    km,
    runs,
    reached,
    target,
    share: target ? km / target : 1,
    daysLeft,
    perDayKm,
  }
}
