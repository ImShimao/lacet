// Consignes de navigation — portage fidèle de `backend/app/navigation.py`.

import { bearingDeg, haversineM } from './geo'
import { pyfloordiv, pymod, pyRound, sortByKey } from './py'

const BEARING_SPAN_M = 20
const SLIGHT_DEG = 30
const TURN_DEG = 55
const SHARP_DEG = 115
const UTURN_DEG = 155
const MERGE_DISTANCE_M = 25
const NAME_CHANGE_MIN_M = 120
const NAME_REPEAT_M = 400
const LAP_ABSORB_M = 25
const ORDINALS = ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième']

const CARDINALS = [
  'le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest',
]

const PHRASES = new Map([
  ['slight_left', 'Serre à gauche'],
  ['left', 'Tourne à gauche'],
  ['sharp_left', 'Tourne franchement à gauche'],
  ['slight_right', 'Serre à droite'],
  ['right', 'Tourne à droite'],
  ['sharp_right', 'Tourne franchement à droite'],
  ['uturn', 'Fais demi-tour'],
  ['straight', 'Continue tout droit'],
])

const SHORT = new Map([
  ['left', 'à gauche'],
  ['right', 'à droite'],
  ['slight_left', 'à gauche'],
  ['slight_right', 'à droite'],
  ['sharp_left', 'franchement à gauche'],
  ['sharp_right', 'franchement à droite'],
  ['uturn', 'demi-tour'],
])

const instruction = (distM, turn, angle, road, text, lon, lat, caution) => ({
  dist_m: distM, turn, angle, road, text, lon, lat, caution,
})

export function buildInstructions(graph, start, cand) {
  if (!cand.edges.length) return []

  let steps = mergeClose(rawSteps(graph, start, cand))

  const total = cand.stats ? cand.stats.distanceM : 0
  const [lon, lat] = graph.node(start)
  const firstRoad = graph.edgeName[cand.edges[0]]
  const heading = bearingFromStart(graph.coordsFrom(cand.edges[0], start))

  const out = [instruction(0, 'start', 0, firstRoad, startText(heading, firstRoad), lon, lat, false)]
  const markers = lapMarkers(cand, total, lon, lat, heading)
  if (markers.length) {
    const bounds = markers.map((m) => m.dist_m)
    steps = steps.filter((step) => bounds.every((b) => Math.abs(step.dist_m - b) > LAP_ABSORB_M))
  }

  out.push(...steps, ...markers)
  out.push(instruction(pyRound(total, 1), 'finish', 0, null, finishText(cand.laps), lon, lat, false))
  return sortByKey(out, (step) => step.dist_m)
}

function lapMarkers(cand, total, lon, lat, heading) {
  if (cand.laps < 2) return []
  const lap = total / cand.laps
  const out = []
  for (let k = 1; k < cand.laps; k += 1) {
    const restants = cand.laps - k
    const fait = k <= ORDINALS.length ? ORDINALS[k - 1] : `${k}ᵉ`
    const reste = restants === 1 ? 'Dernier tour.' : `Encore ${restants} tours.`
    out.push(
      instruction(
        pyRound(lap * k, 1), 'lap', 0, null,
        `Fin du ${fait} tour. ${reste} Repars vers ${headingWords(heading)}.`,
        lon, lat, false,
      ),
    )
  }
  return out
}

const headingWords = (heading) => CARDINALS[Math.trunc(pyfloordiv(pymod(heading + 22.5, 360), 45))]

const finishText = (laps) =>
  laps < 2
    ? 'Tu es revenu au point de départ. Boucle terminée.'
    : `Dernier tour bouclé. Les ${laps} tours sont terminés.`

/** Clé d'égalité d'un point arrondi au millionième, comme le tuple Python. */
const pointKey = (lon, lat) => `${pyRound(lon, 6)},${pyRound(lat, 6)}`

function rawSteps(graph, start, cand) {
  const unprotected = new Set()
  for (const c of cand.crossings) if (!c.protected) unprotected.add(pointKey(c.lon, c.lat))

  const steps = []
  let cursor = start
  let travelled = 0
  let outBearing = null
  let lastNamed = null
  const announced = new Map()

  for (const e of cand.edges) {
    const coords = graph.coordsFrom(e, cursor)
    const name = graph.edgeName[e]
    const length = graph.edgeLen[e]

    if (outBearing !== null) {
      const inBearing = bearingFromStart(coords)
      const angle = pymod(inBearing - outBearing + 180, 360) - 180
      const turn = classify(angle)

      const roadChanged = name !== lastNamed
      const fresh =
        name !== null && travelled - (announced.has(name) ? announced.get(name) : -1e9) > NAME_REPEAT_M
      const namedChange = fresh && roadChanged && length >= NAME_CHANGE_MIN_M
      const magnitude = Math.abs(angle)

      if (magnitude >= TURN_DEG || (magnitude >= SLIGHT_DEG && roadChanged) || namedChange) {
        if (name) announced.set(name, travelled)
        const [lon, lat] = coords[0]
        const rlon = pyRound(lon, 6)
        const rlat = pyRound(lat, 6)
        steps.push(
          instruction(
            pyRound(travelled, 1), turn, pyRound(angle, 1), name, phrase(turn, name),
            rlon, rlat, unprotected.has(pointKey(rlon, rlat)),
          ),
        )
      }
    }

    travelled += length
    outBearing = bearingToEnd(coords)
    if (name) lastNamed = name
    cursor = graph.other(e, cursor)
  }
  return steps
}

function mergeClose(steps) {
  if (steps.length < 2) return steps
  const out = []
  let i = 0
  while (i < steps.length) {
    let current = steps[i]
    const following = i + 1 < steps.length ? steps[i + 1] : null
    if (
      following !== null &&
      following.dist_m - current.dist_m <= MERGE_DISTANCE_M &&
      current.turn !== 'straight' &&
      following.turn !== 'straight'
    ) {
      current = instruction(
        current.dist_m, current.turn, current.angle, following.road,
        `${PHRASES.get(current.turn) ?? 'Continue'} puis tout de suite ${SHORT.get(following.turn) ?? 'tout droit'}${on(following.road)}`,
        current.lon, current.lat, current.caution || following.caution,
      )
      i += 2
    } else {
      i += 1
    }
    out.push(current)
  }
  return out
}

function classify(angle) {
  const magnitude = Math.abs(angle)
  const side = angle > 0 ? 'right' : 'left'
  if (magnitude >= UTURN_DEG) return 'uturn'
  if (magnitude >= SHARP_DEG) return `sharp_${side}`
  if (magnitude >= TURN_DEG) return side
  if (magnitude >= SLIGHT_DEG) return `slight_${side}`
  return 'straight'
}

const phrase = (turn, road) => `${PHRASES.get(turn) ?? 'Continue'}${on(road)}`
const on = (road) => (road ? ` sur ${road}` : '')
const startText = (heading, road) => `Départ — pars vers ${headingWords(heading)}${on(road)}.`

const bearingFromStart = (coords) => bearingDeg(coords[0], advance(coords, BEARING_SPAN_M))
const bearingToEnd = (coords) => bearingDeg(advance([...coords].reverse(), BEARING_SPAN_M), coords[coords.length - 1])

function advance(coords, distanceM) {
  let travelled = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const step = haversineM(coords[i], coords[i + 1])
    if (travelled + step >= distanceM) {
      if (step <= 0) continue
      const t = (distanceM - travelled) / step
      const a = coords[i]
      const b = coords[i + 1]
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    travelled += step
  }
  return coords[coords.length - 1]
}

// === détours ==================================================================
//
// Hors du portage Python : le recalcul en course (`reroute.js`) n'existe que
// dans l'app. Il réemploie les mêmes règles — mêmes angles, mêmes phrases — pour
// que les consignes d'un détour sonnent comme celles du parcours.

/** Les consignes le long d'une suite d'arêtes, distances comptées depuis `source`. */
export function pathSteps(graph, source, edges) {
  return mergeClose(rawSteps(graph, source, { edges, crossings: [] }))
}

/** Le virage que fait un angle (degrés, positif à droite), et sa phrase. */
export function turnOf(angle, road = null) {
  const turn = classify(angle)
  return { turn, text: phrase(turn, road) }
}

/** Cap de départ et cap d'arrivée d'une géométrie, lissés sur vingt mètres. */
export const headings = (coords) => [bearingFromStart(coords), bearingToEnd(coords)]
