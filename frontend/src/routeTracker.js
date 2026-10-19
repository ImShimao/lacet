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
 *
 * `reach` : les mètres qu'on a pu parcourir depuis `previous` — la vitesse
 * qu'on ne dépasse pas, multipliée par le temps écoulé, plus le tremblement du
 * GPS. **Deux cent cinquante mètres, c'est une minute de course.** À un relevé
 * par seconde, la fenêtre entière laissait un seul reflet sur une façade,
 * donné pour précis, tomber sur le tracé deux cents mètres plus loin : la
 * sortie y « avançait », et le relevé suivant, revenu à sa place, passait
 * pour un demi-tour — « Tu reviens sur tes pas », et plus aucune consigne
 * jusqu'à ce faux point. Bornée à ce qu'on a pu courir, la recherche voit ce
 * reflet pour ce qu'il est : un point loin du tracé. `previous` est alors le
 * dernier relevé tombé sur le tracé, et `reach` compte depuis lui : après une
 * demi-minute à l'écart, la fenêtre s'est rouverte d'elle-même, et l'on
 * retrouve le tracé là où on le rejoint.
 *
 * `ahead` : les mètres qu'on a dû courir depuis `previous`, à l'allure du
 * moment — c'est de l'avancée attendue, et non de la précédente, que la
 * continuité mesure l'écart. `course` : le cap du déplacement, en degrés, tel
 * que le donne le GPS. Voir plus bas pour l'un et l'autre.
 */
export function locate(track, position, previous, { reach = WINDOW_M, ahead = 0, course = null } = {}) {
  const { points, cumulative } = track
  if (points.length < 2) return null

  let from = 0
  let to = points.length - 1
  let lo = -Infinity
  let hi = Infinity
  if (previous) {
    // On borne par la distance cumulée, pas par le nombre de points : leur
    // espacement varie du simple au décuple selon la sinuosité de la voie.
    const window = Math.min(WINDOW_M, reach)
    lo = previous.along - window
    hi = previous.along + window
    // Les segments qui touchent la fenêtre — y compris celui où elle tient
    // tout entière : sur une rue droite, ses deux bornes tombaient sur le même
    // sommet, et l'on ne cherchait plus nulle part. Chacun n'est lu que sur sa
    // part dans la fenêtre : un segment de cent mètres qui la déborde
    // laissait sinon un reflet sauter cinquante mètres plus loin.
    from = Math.max(0, indexAt(cumulative, lo) - 1)
    to = Math.min(points.length - 1, indexAt(cumulative, hi) + 1)
  }

  let best = null
  for (let i = from; i < to; i += 1) {
    const length = cumulative[i + 1] - cumulative[i]
    const tMin = length > 0 ? Math.max(0, (lo - cumulative[i]) / length) : 0
    const tMax = length > 0 ? Math.min(1, (hi - cumulative[i]) / length) : 1
    if (tMin > tMax) continue
    const hit = projectOnSegment(position, points[i], points[i + 1], tMin, tMax)
    const along = cumulative[i] + length * hit.t
    // **À écart égal, le passage le plus proche de l'avancée attendue.** Une
    // rue prise à l'aller et au retour — une impasse, l'allée du départ — est
    // deux fois sous le GPS, exactement au même écart ; le premier trouvé
    // l'emportait, c'est-à-dire l'aller, et l'avancée repartait en arrière
    // pendant tout le retour.
    //
    // Et l'écart se mesure à l'avancée **attendue**, pas à la précédente : au
    // demi-tour d'un tel aller-retour, l'aller et le retour sont à égale
    // distance de l'avancée d'avant, et l'aller gagnait. Un « 8 » dont la
    // seconde boucle repart par la rue d'arrivée de la première y reculait
    // pas à pas — « Tu reviens sur tes pas », puis plus une consigne de toute
    // la seconde boucle.
    // Dix mètres d'avancée ne pèsent qu'un mètre d'écart : rien qui retienne
    // un vrai saut en avant.
    //
    // **Et dans le sens où l'on court.** Au demi-tour d'une impasse, dans les
    // lacets d'une montée, deux passages se superposent en sens contraire, et
    // ni l'écart ni l'avancée ne les départagent : l'avancée calculée retarde
    // de quelques mètres sur la vraie, et le reflet sur l'aller est aussi près
    // de l'avancée attendue que la vraie place sur le retour. Une fois sur
    // l'aller, chaque relevé l'y confirmait, à reculons : passé un demi-tour à
    // la Guillotière, l'app suivait l'aller jusqu'au carrefour d'avant, s'y
    // perdait, et ne retrouvait plus le tracé. Le cap du GPS, lui, sait de
    // quel côté l'on va : un passage coûte d'autant plus qu'il s'écarte de ce
    // cap, jusqu'à vingt-cinq mètres à contresens. Progressivement, et pas
    // seulement à contresens : dans un escalier en lacet des pentes de la
    // Croix-Rousse, le palier — à angle droit de la volée qu'on monte —
    // restait plus près que la volée elle-même, et l'avancée y restait
    // accrochée, le carrefour suivant jamais atteint. Revenir vraiment sur ses
    // pas reste possible : tous les passages sont alors à contresens, et le
    // plus proche l'emporte.
    const against = course == null ? 0 : AGAINST_M * Math.max(0, turnBetween(course, bearing(points[i], points[i + 1])) - ALIGNED_DEG) / (180 - ALIGNED_DEG)
    const score = (previous ? hit.offset + CONTINUITY * Math.abs(along - previous.along - ahead) : hit.offset) + against
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

// Le poids de la continuité face à l'écart au tracé, et le prix d'un passage à
// contresens — voir `locate`.
const CONTINUITY = 0.1
const ALIGNED_DEG = 30
const AGAINST_M = 25

/** L'écart entre deux caps, de 0 à 180°. */
const turnBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

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
 * Projection orthogonale d'un point sur un segment — ou sur sa part entre
 * `tMin` et `tMax`, de 0 (en `a`) à 1 (en `b`).
 *
 * On travaille en mètres locaux plutôt qu'en degrés : à 45° de latitude, un
 * degré de longitude vaut 0,71 degré de latitude, et l'ignorer déformerait
 * l'angle droit de la projection — l'erreur est maximale précisément sur les
 * segments est-ouest.
 */
function projectOnSegment(p, a, b, tMin = 0, tMax = 1) {
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
  const t = lengthSquared > 0 ? Math.max(tMin, Math.min(tMax, (px * dx + py * dy) / lengthSquared)) : 0

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

// Contresens : un écart de cap au-delà de ce seuil, mesuré sur au moins tant
// de mètres — en dessous, c'est le tremblement du GPS qui donne la direction.
const WRONG_WAY_DEG = 120
const WRONG_WAY_MOVE_M = 15

/**
 * Parti à contresens du tracé.
 *
 * Revenir sur ses pas après avoir avancé, `LiveRun` le voit déjà : l'avancée
 * recule (« Tu reviens sur tes pas »). Mais partir du mauvais côté au départ ne
 * fait rien reculer — on est à zéro : on court sur la **fin** de la boucle, à
 * rebours. La recherche bornée autour du départ ne la voit pas, et l'app ne
 * disait que « Tu t'es écarté du parcours », sans dire de quel côté repartir.
 *
 * Contresens : sur le tracé, bien au-delà de l'avancée la plus lointaine
 * (`farthest`), et dans le sens inverse du tracé à cet endroit. `from` : le
 * dernier point sur le parcours ; `to` : la position.
 */
export function wrongWay(track, from, to, farthest) {
  if (!from || haversine(from, to) < WRONG_WAY_MOVE_M) return false
  const hit = locate(track, to, null)
  if (!hit || hit.offRoute || hit.along - farthest < WINDOW_M) return false
  const route = headingAt(track, hit.along)
  if (route == null) return false
  return turnBetween(bearing(from, to), route) > WRONG_WAY_DEG
}

/** Le cap `course` remonte-t-il le tracé, à l'avancée `along` ? */
export function runsBack(track, along, course) {
  const route = headingAt(track, along)
  return route != null && turnBetween(course, route) > WRONG_WAY_DEG
}

export { OFF_ROUTE_M }
