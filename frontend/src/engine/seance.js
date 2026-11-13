// Séance du jour, version complète — « 6 × 400 m » : une boucle qui passe par une
// ligne droite plate de 400 m, à deux pas de la porte.
//
// Propre à l'app, comme `door.js` : le moteur Python ne connaît ni séance ni
// intervalle, donc rien à reporter dans `parity.test.js`. Les briques viennent du
// moteur : tronçons (`dijkstra`), virages (`bearingGap`), pente (`Terrain.climb`),
// danger (`EXPOSED_RISK`), et la finition de la boucle (`trimSpurs`, `measure`).

import { dijkstra, nodeSequence, reconstruct } from './dijkstra'
import { bearingDeg } from './geo'
import { bearingGap, Candidate, measure, trimSpurs } from './loops'
import { radians } from './py'
import { EXPOSED_RISK } from './safety'

// La séance tolère 10 % d'écart sur 400 m : 360 à 440 m.
export const STRAIGHT_TOLERANCE = 0.1
// Jusqu'où chercher la ligne droite depuis la porte.
export const SEARCH_RADIUS_M = 1000
// Un virage marqué, entre deux tronçons d'une même ligne droite.
export const MAX_TURN_DEG = 20
// Écart maximal de la ligne droite à sa corde : au-delà, elle courbe.
export const MAX_DEVIATION_M = 12
// Montées et descentes cumulées, en part de la longueur : 1 % = 4 m sur 400 m.
export const FLAT_SHARE = 0.01
// Le retour à la porte évite la ligne droite (voir `chainLegs` en Python).
const RETURN_PENALTY = 6

const legal = (graph, e, from) => {
  const sens = graph.edgeOneway[e]
  return !sens || (graph.edgeA[e] === from) === sens > 0
}

/** Écart maximal, en mètres, des points de `coords` à la corde de `a` à `b`. */
function deviationM(coords, a, b) {
  const kx = Math.cos(radians(a[1])) * 111_320
  const ky = 110_540
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * ky
  const len = Math.hypot(bx, by)
  let worst = 0
  for (const [lon, lat] of coords) {
    const px = (lon - a[0]) * kx
    const py = (lat - a[1]) * ky
    worst = Math.max(worst, len > 0 ? Math.abs(px * by - py * bx) / len : Math.hypot(px, py))
  }
  return worst
}

/** Les coordonnées du tracé `edges`, parti de `from` : de quoi dessiner la ligne droite. */
export function pathCoords(graph, from, edges) {
  const coords = []
  let cursor = from
  for (const e of edges) {
    const piece = graph.coordsFrom(e, cursor)
    coords.push(...(coords.length ? piece.slice(1) : piece))
    cursor = graph.other(e, cursor)
  }
  return coords
}

/** Le tronçon `path`, parti de `from`, est-il une ligne droite plate ? */
function isFlatStraight(graph, from, path, terrain) {
  const coords = pathCoords(graph, from, path)
  const length = path.reduce((sum, e) => sum + graph.edgeLen[e], 0)
  if (deviationM(coords, coords[0], coords[coords.length - 1]) > MAX_DEVIATION_M) return false
  return terrain.climb(coords) <= FLAT_SHARE * length
}

/**
 * La première ligne droite plate, de `straightM` mètres, qui part d'un carrefour
 * à portée de la porte — la plus proche. Un tronçon exposé (`EXPOSED_RISK`) ne
 * compte pas : une séance ne se court pas sur la voie des voitures.
 *
 * Renvoie `{ edges, lengthM, from }`, ou `null` s'il n'y en a aucune. `terrain`
 * est obligatoire : sans relief, la planéité ne se vérifie pas.
 */
export function findStraight(graph, start, straightM, terrain) {
  if (!terrain) return null
  const near = dijkstra(graph, start, graph.edgeLen, { maxDist: SEARCH_RADIUS_M, slack: 1 })
  const lo = straightM * (1 - STRAIGHT_TOLERANCE)
  const hi = straightM * (1 + STRAIGHT_TOLERANCE)

  let best = null
  for (const from of near.reached) {
    if (best !== null && near.dist[from] >= best.dist) continue
    const found = chainFrom(graph, from, lo, hi, terrain)
    if (found !== null) best = { ...found, dist: near.dist[from] }
  }
  return best
}

/** Le premier tronçon droit et plat de `lo` à `hi` mètres qui part de `from` : `{ edges, from, to, lengthM }`, ou `null`. */
function chainFrom(graph, from, lo, hi, terrain) {
  const path = []
  const visited = new Set([from])
  let found = null
  const walk = (node, length, bearing) => {
    for (let k = graph.adjOffset[node]; k < graph.adjOffset[node + 1] && found === null; k += 1) {
      const e = graph.adjEdges[k]
      const next = graph.other(e, node)
      if (!legal(graph, e, node) || visited.has(next) || graph.edgeSafety[e].risk >= EXPOSED_RISK) continue
      const len = length + graph.edgeLen[e]
      if (len > hi) continue
      const b = bearingDeg(graph.node(node), graph.node(next))
      if (bearing !== null && bearingGap(bearing, b) > MAX_TURN_DEG) continue

      path.push(e)
      visited.add(next)
      if (len >= lo && isFlatStraight(graph, from, path, terrain)) found = { edges: [...path], from, to: next, lengthM: len }
      else walk(next, len, b)
      path.pop()
      visited.delete(next)
    }
  }
  walk(from, 0, null)
  return found
}

/**
 * La boucle qui passe par la ligne droite : la porte → le début de la ligne, la
 * ligne, puis le retour à la porte par d'autres rues. Le retour pénalise les
 * tronçons déjà pris, pour ne pas repartir en arrière.
 *
 * Renvoie un `Candidate` mesuré (comme celui de `loops.js`), ou `null` si le
 * retour ou l'aller ne se tracent pas.
 */
export function seanceLoop(graph, start, straight, profile, { night = false } = {}) {
  const weights = profile.precompute(graph)
  const toStart = reconstruct(dijkstra(graph, start, weights, { target: straight.from }), straight.from)
  if (!toStart) return null

  const used = new Map()
  for (const e of [...toStart, ...straight.edges]) used.set(e, RETURN_PENALTY)
  const back = reconstruct(dijkstra(graph, straight.to, weights, { target: start, penalties: used }), start)
  if (!back) return null

  const edges = trimSpurs(graph, start, [...toStart, ...straight.edges, ...back], weights)
  // Le rognage peut manger la ligne droite elle-même : on ne la rend que si elle tient.
  const at = edges.indexOf(straight.edges[0])
  if (at < 0 || straight.edges.some((e, i) => edges[at + i] !== e)) return null

  const cand = new Candidate(edges, nodeSequence(graph, start, edges))
  measure(graph, start, cand, { night })
  return cand
}

/**
 * « 6 × 400 m » : la boucle de la séance, ou `null` s'il n'y a pas de ligne droite
 * plate à portée. `{ cand, straight }` : `straight.edges` sert à la mettre en
 * évidence sur la carte.
 */
export function planSeance(graph, start, { straightM = 400, terrain = null, profile, night = false }) {
  const straight = findStraight(graph, start, straightM, terrain)
  if (!straight) return null
  const cand = seanceLoop(graph, start, straight, profile, { night })
  return cand && { cand, straight }
}
