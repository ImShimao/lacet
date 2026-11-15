// Partir de là où l'on est vraiment.
//
// Une boucle se prépare au chaud : le départ est une adresse cherchée, ou un
// repère posé du doigt, à vingt ou cinquante mètres de la porte. Au moment de
// partir, le téléphone sait où l'on est — et la boucle commençait quand même
// au repère : « Tu t'es écarté du parcours » avant le premier pas, et une
// arrivée qui attendait qu'on dépasse sa porte.
//
// Au départ, la boucle est donc **recalée sur la position** : la même boucle,
// les mêmes rues, la même note — seul le point de départ glisse le long du
// tracé, et l'arrivée avec lui.
//
// - La position tombe sur la boucle, à l'aller ou au retour : la boucle
//   **tourne**. Elle part de là, passe par l'ancien départ comme par n'importe
//   quel carrefour, et revient là.
// - Elle tombe sur un bout de rue que la boucle prend à l'aller **et** au
//   retour : ce bout est **coupé**. Aller jusqu'à l'ancien départ pour y faire
//   demi-tour n'aurait aucun sens.
//
// Rien d'autre n'est touché : hors de la boucle — une rue voisine, l'autre
// trottoir d'un boulevard —, le parcours reste tel quel, et c'est le recalcul
// en course qui raccorde (`engine/reroute.js`). Un parcours à tours ou un « 8 »
// non plus : leurs fins de tour sont comptées depuis le départ.
//
// Tout se fait sur le tracé, sans le moteur : un favori rouvert ou un fichier
// importé se recalent comme une boucle qu'on vient de calculer.

import { haversine } from './format'
import { bearing, buildTrack, pointAt } from './routeTracker'
import { on, turnOf } from './engine/navigation'

// En deçà, on est au départ : rien à recaler.
const MIN_SHIFT_M = 8
// Au-delà, on n'est pas devant chez soi : on a préparé la boucle ailleurs.
const MAX_SHIFT_M = 150
// La position doit tomber sur la boucle à cet écart au plus : la largeur d'une
// rue et de son trottoir, plus l'imprécision d'un bon relevé.
const ON_LOOP_M = 25
// Un relevé plus flou que ça ne dit pas de quel côté du carrefour on est.
const MAX_ACCURACY_M = 25
// Une boucle dont les deux bouts ne se rejoignent pas n'en est pas une.
const CLOSED_M = 25
// Aller et retour par la même rue : les deux passages sont au même endroit.
const SAME_SPOT_M = 15
// Le cap d'une rue se lit sur cette longueur, comme dans le moteur.
const BEARING_SPAN_M = 35
// Une consigne à moins de cinq mètres du départ ou de l'arrivée n'en est pas une.
const EDGE_M = 5
// En dessous, on continue tout droit : rien à dire à l'ancien départ.
const SLIGHT_DEG = 30

const CARDINALS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest']
const round1 = (x) => Math.round(x * 10) / 10

/**
 * La même boucle, partant de `position` — ou `null` s'il n'y a rien à recaler.
 *
 * @param route     le parcours choisi
 * @param position  [lon, lat], là où l'on est
 * @param accuracy  la précision du relevé, en mètres, si le GPS la donne
 */
export function startHere(route, position, accuracy = null) {
  const g = route?.geometry
  if (!g || g.length < 3 || !position) return null
  if ((route.laps ?? 1) > 1 || route.figure_eight || route.home || route.rerouted) return null
  if ((route.instructions || []).some((s) => s.turn === 'lap')) return null
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return null
  const gap = haversine(g[g.length - 1], g[0])
  if (gap > CLOSED_M) return null
  const away = haversine(position, g[0])
  if (away < MIN_SHIFT_M || away > MAX_SHIFT_M) return null

  const track = buildTrack(g)
  const total = track.total
  if (total < 4 * MAX_SHIFT_M) return null
  const out = project(track, position, 0, MAX_SHIFT_M)
  const back = project(track, position, total - MAX_SHIFT_M, total)
  const usable = (spot) => spot && spot.off <= ON_LOOP_M && spot.along >= MIN_SHIFT_M && spot.along <= total - MIN_SHIFT_M

  if (usable(out) && usable(back) && haversine(out.point, back.point) <= SAME_SPOT_M) return trim(route, track, out, back)
  const spot = [out, back].filter(usable).sort((a, b) => a.off - b.off)[0]
  return spot ? rotate(route, track, spot, gap) : null
}

/** Le point du tracé le plus proche de `position`, entre `from` et `to` mètres. */
function project(track, [lon, lat], from, to) {
  const { points, cumulative } = track
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_540
  let best = null
  for (let i = 0; i < points.length - 1; i += 1) {
    if (cumulative[i + 1] < from || cumulative[i] > to) continue
    const ax = (points[i][0] - lon) * kx
    const ay = (points[i][1] - lat) * ky
    const dx = (points[i + 1][0] - lon) * kx - ax
    const dy = (points[i + 1][1] - lat) * ky - ay
    const len2 = dx * dx + dy * dy
    const raw = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
    // Un long tronçon dépasse de la fenêtre : on n'en lit que ce qui y tient.
    const len = cumulative[i + 1] - cumulative[i]
    const lo = len > 0 ? Math.max(0, (from - cumulative[i]) / len) : 0
    const hi = len > 0 ? Math.min(1, (to - cumulative[i]) / len) : 1
    const t = Math.max(lo, Math.min(hi, raw))
    const off = Math.hypot(ax + t * dx, ay + t * dy)
    if (!best || off < best.off) {
      best = {
        off,
        index: i,
        along: cumulative[i] + t * len,
        point: [points[i][0] + t * (points[i + 1][0] - points[i][0]), points[i][1] + t * (points[i + 1][1] - points[i][1])],
      }
    }
  }
  return best
}

/** La boucle tournée : elle part de `spot`, passe par l'ancien départ, et y revient. */
function rotate(route, track, spot, gap) {
  const g = route.geometry
  const a = spot.along
  const total = track.total + gap
  const rot = (d) => (d >= a ? d - a : d + total - a)
  const geometry = clean([spot.point, ...g.slice(spot.index + 1), ...g.slice(0, spot.index + 1), spot.point])

  const steps = (route.instructions || []).filter((s) => s.turn !== 'start' && s.turn !== 'finish')
  const moved = steps.map((s) => ({ ...s, dist_m: round1(rot(s.dist_m)) }))
  // L'ancien départ est devenu un carrefour comme un autre : s'il faut y
  // tourner, c'est une consigne.
  const road = (route.instructions || []).find((s) => s.turn === 'start')?.road ?? null
  const arriving = bearing(pointAt(track, track.total - BEARING_SPAN_M), g[g.length - 1])
  const leaving = bearing(g[0], pointAt(track, BEARING_SPAN_M))
  const angle = ((leaving - arriving + 540) % 360) - 180
  if (Math.abs(angle) >= SLIGHT_DEG) {
    moved.push({ dist_m: round1(rot(0)), angle: round1(angle), road, lon: g[0][0], lat: g[0][1], caution: false, ...turnOf(angle, road) })
  }

  const [before, after] = splitSegments(route.segments, a)
  const marks = crossingMarks(route, track)
  return {
    ...route,
    geometry,
    distance_m: round1(total),
    instructions: instructionsFor(route, geometry, moved, total, roadAt(route, a)),
    segments: [...after, ...before],
    crossings: [...marks.filter((m) => m.along >= a), ...marks.filter((m) => m.along < a)].map((m) => m.crossing),
    elevation_profile: rotateProfile(route.elevation_profile, a / track.total),
    lap_distance_m: round1(total),
    lap_distances_m: [round1(total)],
  }
}

/** La boucle sans le bout de rue pris à l'aller et au retour. */
function trim(route, track, out, back) {
  const g = route.geometry
  const total = back.along - out.along
  const geometry = clean([out.point, ...g.slice(out.index + 1, back.index + 1), out.point])
  const moved = (route.instructions || [])
    .filter((s) => s.turn !== 'start' && s.turn !== 'finish' && s.dist_m > out.along && s.dist_m < back.along)
    .map((s) => ({ ...s, dist_m: round1(s.dist_m - out.along) }))

  const [upToBack] = splitSegments(route.segments, back.along)
  const [, kept] = splitSegments(upToBack, out.along)
  const share = total / track.total
  const profile = route.elevation_profile
  const scale = profile?.length > 1 ? profile[profile.length - 1].dist_m / track.total : 1
  return {
    ...route,
    geometry,
    distance_m: round1(total),
    duration_s: route.duration_s != null ? Math.round(route.duration_s * share) : route.duration_s,
    instructions: instructionsFor(route, geometry, moved, total, roadAt(route, out.along)),
    segments: kept,
    crossings: crossingMarks(route, track)
      .filter((m) => m.along > out.along && m.along < back.along)
      .map((m) => m.crossing),
    elevation_profile:
      profile?.length > 1
        ? sliceProfile(profile, out.along * scale, back.along * scale)
        : profile,
    lap_distance_m: round1(total),
    lap_distances_m: [round1(total)],
  }
}

/** Départ, consignes déplacées, arrivée — dans l'ordre du nouveau tracé. */
function instructionsFor(route, geometry, moved, total, road) {
  const old = route.instructions || []
  if (!old.length) return old
  const track = buildTrack(geometry)
  const heading = bearing(geometry[0], pointAt(track, BEARING_SPAN_M))
  const cardinal = CARDINALS[Math.floor((((heading % 360) + 360 + 22.5) % 360) / 45)]
  const [lon, lat] = geometry[0]
  const finish = old.find((s) => s.turn === 'finish')
  return [
    { dist_m: 0, turn: 'start', angle: 0, road, text: `Départ — pars vers ${cardinal}${on(road)}.`, lon, lat, caution: false },
    ...moved.filter((s) => s.dist_m > EDGE_M && s.dist_m < total - EDGE_M).sort((x, y) => x.dist_m - y.dist_m),
    { ...(finish ?? { turn: 'finish', angle: 0, road: null, text: 'Tu es revenu au point de départ. Boucle terminée.', caution: false }), dist_m: round1(total), lon, lat },
  ]
}

/** Le nom de la rue à `along` mètres du départ, d'après les tronçons. */
function roadAt(route, along) {
  let cursor = 0
  for (const segment of route.segments || []) {
    cursor += lengthOf(segment)
    if (cursor >= along) return segment.road ?? null
  }
  return null
}

const lengthOf = (segment) => {
  const coords = segment.coords
  if (!coords?.length) return segment.length_m ?? 0
  let length = 0
  for (let i = 1; i < coords.length; i += 1) length += haversine(coords[i - 1], coords[i])
  return length
}

/**
 * Les tronçons avant et après `along`, celui qui le contient coupé en deux.
 * Un favori ne garde que leurs longueurs : elles seules sont alors coupées.
 */
function splitSegments(segments, along) {
  const before = []
  const after = []
  let cursor = 0
  for (const segment of segments || []) {
    const length = lengthOf(segment)
    if (cursor + length <= along) before.push(segment)
    else if (cursor >= along) after.push(segment)
    else {
      const head = along - cursor
      const coords = segment.coords
      if (!coords?.length) {
        before.push({ ...segment, length_m: round1(head) })
        after.push({ ...segment, length_m: round1(length - head) })
      } else {
        let walked = 0
        let cut = coords.length - 1
        let point = coords[cut]
        for (let i = 1; i < coords.length; i += 1) {
          const step = haversine(coords[i - 1], coords[i])
          if (walked + step >= head) {
            const t = step > 0 ? (head - walked) / step : 0
            point = [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])]
            cut = i
            break
          }
          walked += step
        }
        before.push({ ...segment, coords: [...coords.slice(0, cut), point], length_m: round1(head) })
        after.push({ ...segment, coords: [point, ...coords.slice(cut)], length_m: round1(length - head) })
      }
    }
    cursor += length
  }
  return [before, after]
}

/**
 * Chaque traversée avec sa place sur le tracé. Cherchée après la précédente :
 * la liste suit l'ordre du parcours (voir `crossingsAhead`, dans `detour.js`).
 */
function crossingMarks(route, track) {
  const g = route.geometry
  let from = 0
  return (route.crossings || []).map((crossing) => {
    let best = from
    let bestD = Infinity
    for (let i = from; i < g.length; i += 1) {
      const d = haversine(g[i], [crossing.lon, crossing.lat])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    from = best
    return { crossing, along: track.cumulative[best] }
  })
}

/** L'altitude à `d` mètres sur le profil, entre ses deux points voisins. */
function eleAt(profile, d) {
  for (let i = 1; i < profile.length; i += 1) {
    if (profile[i].dist_m >= d) {
      const a = profile[i - 1]
      const b = profile[i]
      const t = b.dist_m > a.dist_m ? (d - a.dist_m) / (b.dist_m - a.dist_m) : 0
      return a.ele_m + t * (b.ele_m - a.ele_m)
    }
  }
  return profile[profile.length - 1].ele_m
}

/** Le profil entre `from` et `to`, recompté depuis `from`. */
function sliceProfile(profile, from, to) {
  const point = (d, ele) => ({ dist_m: round1(d - from), ele_m: round1(ele) })
  return [
    point(from, eleAt(profile, from)),
    ...profile.filter((p) => p.dist_m > from && p.dist_m < to).map((p) => point(p.dist_m, p.ele_m)),
    point(to, eleAt(profile, to)),
  ]
}

/** Le profil d'une boucle tournée : il commence à `share` du tour, et s'y referme. */
function rotateProfile(profile, share) {
  if (!profile || profile.length < 2) return profile
  const total = profile[profile.length - 1].dist_m
  const cut = share * total
  const tail = sliceProfile(profile, cut, total)
  const head = sliceProfile(profile, 0, cut).map((p) => ({ ...p, dist_m: round1(p.dist_m + total - cut) }))
  return [...tail, ...head.slice(1)]
}

/** Sans deux points de suite au même endroit : un cap ne s'y lirait pas. */
const clean = (coords) => coords.filter((c, i) => i === 0 || haversine(coords[i - 1], c) > 0.2)
