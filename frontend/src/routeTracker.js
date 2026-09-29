// Où en est-on sur le parcours ?
//
// Toute la sortie guidée dépend de cette question : la consigne à dire, la
// distance restante, et le fait de s'être trompé de rue. Elle se ramène à
// projeter la position GPS sur la polyligne du tracé.
//
// Deux précautions, tirées de ce que fait réellement un GPS de téléphone :
//
// **On cherche près du dernier point connu, pas partout.** Un tracé de 10 km
// compte un millier de points, et la position arrive chaque seconde. Balayer
// tout le tracé à chaque fois serait inutile, mais surtout faux : sur une
// boucle qui longe deux fois la même avenue, le point le plus proche dans
// l'absolu peut être celui de l'autre passage, et le guidage sauterait alors
// trois kilomètres en avant. On ne regarde donc qu'une fenêtre autour de la
// position précédente, en n'autorisant qu'une avancée plausible.
//
// **On projette sur les segments, pas sur les sommets.** Entre deux points
// distants de cinquante mètres, se contenter du sommet le plus proche donne une
// progression en marches d'escalier et une distance à l'écart surestimée de
// vingt-cinq mètres — de quoi déclencher une fausse alerte de hors-parcours.

import { haversine } from './format'

// Fenêtre de recherche, en mètres de part et d'autre de la position précédente.
// Large devant la vitesse d'un cycliste entre deux relevés (20 m/s au plus),
// étroite devant l'écart entre deux passages parallèles d'une boucle.
const WINDOW_M = 250

// Au-delà de cet écart au tracé, on considère que la personne n'est plus dessus.
const OFF_ROUTE_M = 45

/**
 * Prépare un tracé pour le suivi : distances cumulées et longueur totale.
 * À faire une fois par itinéraire, pas à chaque position.
 */
export function buildTrack(geometry) {
  const points = geometry || []
  const cumulative = new Float64Array(points.length)
  for (let i = 1; i < points.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + haversine(points[i - 1], points[i])
  }
  return { points, cumulative, total: cumulative[points.length - 1] || 0 }
}

/**
 * Projette `position` sur le tracé.
 *
 * `previous` est le résultat du relevé précédent ; le passer restreint la
 * recherche et évite les sauts d'un passage à l'autre. Rend `null` si le tracé
 * est vide.
 */
export function locate(track, position, previous) {
  const { points, cumulative } = track
  if (points.length < 2) return null

  let from = 0
  let to = points.length - 1
  if (previous) {
    // On borne par la distance cumulée, pas par le nombre de points : leur
    // espacement varie du simple au décuple selon la sinuosité de la voie.
    const lo = previous.along - WINDOW_M
    const hi = previous.along + WINDOW_M
    from = indexAt(cumulative, lo)
    to = indexAt(cumulative, hi)
  }

  let best = null
  for (let i = from; i < to; i += 1) {
    const hit = projectOnSegment(position, points[i], points[i + 1])
    const along = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * hit.t
    // **À écart égal, le passage le plus proche de l'avancée d'avant.** Une
    // rue prise à l'aller et au retour — une impasse, l'allée du départ — est
    // deux fois sous le GPS, exactement au même écart ; le premier trouvé
    // l'emportait, c'est-à-dire l'aller, et l'avancée repartait en arrière
    // pendant tout le retour. Dix mètres d'avancée ne pèsent qu'un mètre
    // d'écart : rien qui retienne un vrai saut en avant.
    const score = previous ? hit.offset + CONTINUITY * Math.abs(along - previous.along) : hit.offset
    if (!best || score < best.score) {
      best = { ...hit, index: i, along, score }
    }
  }
  if (!best) return previous || null

  return {
    index: best.index,
    along: best.along,
    offset: best.offset,
    offRoute: best.offset > OFF_ROUTE_M,
  }
}

// Le poids de la continuité face à l'écart au tracé — voir `locate`.
const CONTINUITY = 0.1

/** Premier indice dont la distance cumulée atteint `distance`. */
function indexAt(cumulative, distance) {
  let lo = 0
  let hi = cumulative.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid] < distance) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, Math.min(lo, cumulative.length - 2))
}

/**
 * Projection orthogonale d'un point sur un segment.
 *
 * On travaille en mètres locaux plutôt qu'en degrés : à 45° de latitude, un
 * degré de longitude vaut 0,71 degré de latitude, et l'ignorer déformerait
 * l'angle droit de la projection — l'erreur est maximale précisément sur les
 * segments est-ouest.
 */
function projectOnSegment(p, a, b) {
  const kx = Math.cos((a[1] * Math.PI) / 180) * 111320
  const ky = 110540

  const ax = 0
  const ay = 0
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * ky
  const px = (p[0] - a[0]) * kx
  const py = (p[1] - a[1]) * ky

  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0

  const cx = dx * t
  const cy = dy * t
  return { t, offset: Math.hypot(px - cx, py - cy) }
}

/**
 * Prochaine consigne à annoncer, et à quelle distance elle se trouve.
 *
 * `done` est l'ensemble des index déjà annoncés — l'appelant le tient, parce
 * que c'est lui qui sait si la voix a réellement parlé.
 */
export function nextInstruction(instructions, along, done) {
  for (let i = 0; i < instructions.length; i += 1) {
    if (done.has(i)) continue
    const remaining = instructions[i].dist_m - along
    // Une consigne dépassée de plus de trente mètres ne sera jamais dite : on
    // la donne comme faite, sinon elle bloquerait toutes les suivantes.
    if (remaining < -30) {
      done.add(i)
      continue
    }
    return { index: i, step: instructions[i], remaining }
  }
  return null
}

/** Cap de `a` vers `b`, en degrés depuis le nord, dans le sens horaire. */
export function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLon = toRad(b[0] - a[0])
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Le point du tracé situé à `distance` mètres du départ. */
export function pointAt(track, distance) {
  const { points, cumulative, total } = track
  if (points.length < 2) return points[0] ?? null
  const d = Math.max(0, Math.min(total, distance))
  // `indexAt` rend le premier sommet *au-delà* de la distance : le segment qui
  // la contient commence un cran avant.
  let i = indexAt(cumulative, d)
  if (i > 0 && cumulative[i] > d) i -= 1
  const span = cumulative[i + 1] - cumulative[i]
  const t = span > 0 ? (d - cumulative[i]) / span : 0
  const a = points[i]
  const b = points[i + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/**
 * La direction où l'on court, lue sur le tracé plutôt que sur le GPS.
 *
 * À dix kilomètres-heure, le cap que donne un téléphone est du bruit : deux
 * relevés distants de trois mètres, chacun juste à cinq mètres près. La carte
 * orientée sur ce cap tournait de trente degrés à chaque seconde. Le tracé, lui,
 * sait où l'on va : on vise le point situé `ahead` mètres plus loin, ce qui
 * lisse aussi les petits zigzags d'une rue sans rater les vrais virages.
 */
export function headingAt(track, along, ahead = 25) {
  const from = pointAt(track, along)
  const to = pointAt(track, along + ahead)
  if (!from || !to || haversine(from, to) < 1) return null
  return bearing(from, to)
}

export { OFF_ROUTE_M }
