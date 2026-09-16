// Génération de boucles — portage fidèle de `backend/app/routing/loops.py`.
//
// « Une boucle est un polygone dont le départ est un sommet. » Tout le
// raisonnement — placement des sommets par le théorème de l'angle inscrit,
// zone centrale interdite, couloir de progression, passes d'ajustement — est
// expliqué dans le module Python, qui fait foi.

import { astar, dijkstra, INF, nodeSequence, reconstruct } from './dijkstra'
import { bearingDeg, haversineM, roundness } from './geo'
import { degrees, pyfloordiv, pymod, pyMax, pyMin, pyRoundInt, pySum, radians } from './py'
import { EXPOSED_RISK, RouteStats, unlitLength } from './safety'

const RETURN_PENALTY = 6
const SHAPES = [3, 4, 5, 6]
const ORIENTATIONS = 8
const MAX_ATTEMPTS = 3
const ENOUGH_IN_RANGE = 8
const CORE_CLEARANCE = 0.75
const RETURN_EPSILON = 1.25
const LEG_MAX_SHARE = 0.7

const FINE_SECTORS = 72
const FINE_WIDTH = 360 / FINE_SECTORS
const BAND_RATIO = 0.06
const W_RADIUS = 3
const W_ANGLE = 1.4
const W_QUALITY = 1.2
const ANGLE_TOLERANCE = 0.25
const SPAN_MIN = 0.55
const SPAN_MAX = 1.3
const SWEEP_MARGIN_DEG = 30
const RADIUS_TOLERANCE = 0.35
const CORE_RADIUS_BUCKET_M = 50

/** `int(a // b)` */
const floorInt = (a, b) => Math.trunc(pyfloordiv(a, b))

export function nodeSectors(graph, start) {
  const slon = graph.nodeLon[start]
  const slat = graph.nodeLat[start]
  const kx = Math.cos(radians(slat))
  const inv = FINE_SECTORS / 360
  const out = new Uint8Array(graph.nodeCount)
  for (let i = 0; i < out.length; i += 1) {
    const angle = degrees(Math.atan2((graph.nodeLon[i] - slon) * kx, graph.nodeLat[i] - slat))
    out[i] = pymod(Math.trunc(pymod(angle, 360) * inv), FINE_SECTORS)
  }
  return out
}

export function sweepGate(fromDeg, toDeg, margin = SWEEP_MARGIN_DEG) {
  const span = pymod(toDeg - fromDeg, 360)
  const lo = fromDeg - margin
  const total = span + 2 * margin
  const allowed = new Uint8Array(FINE_SECTORS)
  const steps = Math.trunc(total / FINE_WIDTH) + 2
  const base = floorInt(lo, FINE_WIDTH)
  for (let k = 0; k < steps; k += 1) allowed[pymod(base + k, FINE_SECTORS)] = 1
  return allowed
}

export function waypointPlan(m, perimeterM) {
  const step = 180 / m
  const scale = perimeterM / (m * Math.sin(Math.PI / m))
  const out = []
  for (let k = 1; k < m; k += 1) out.push([(k - 1) * step, scale * Math.sin((k * Math.PI) / m)])
  return out
}

export class Candidate {
  constructor(edges, nodes) {
    this.edges = edges
    this.nodes = nodes
    this.geometry = []
    this.segments = []
    this.crossings = []
    this.stats = null
    this.bearing = 0
    this.roundness = 0
    this.shape = 0
    this.laps = 1
    this._edgeSet = null
  }

  get distanceM() {
    return this.stats ? this.stats.distanceM : 0
  }

  get edgeSet() {
    if (this._edgeSet === null) this._edgeSet = new Set(this.edges)
    return this._edgeSet
  }
}

class VertexIndex {
  constructor(graph, start, outbound, bandM, minDistM, maxDistM) {
    this.bandM = bandM
    const startCoord = graph.node(start)
    const cells = new Map()
    const { dist, cost } = outbound
    let bestQuality = INF

    for (const node of outbound.reached) {
      const d = dist[node]
      if (d < minDistM || d > maxDistM) continue
      const quality = cost[node] / d
      if (quality < bestQuality) bestQuality = quality
      const b = bearingDeg(startCoord, graph.node(node))
      const sector = pymod(floorInt(b, FINE_WIDTH), FINE_SECTORS)
      const key = floorInt(d, bandM) * FINE_SECTORS + sector
      const current = cells.get(key)
      if (current === undefined || quality < current[3]) cells.set(key, [node, d, b, quality])
    }

    this.cells = cells
    this.bestQuality = bestQuality < INF ? bestQuality : 1
  }

  get empty() {
    return this.cells.size === 0
  }

  pick(angle, radiusM, maxAngleDev, taken) {
    const lo = radiusM * (1 - RADIUS_TOLERANCE)
    const hi = radiusM * (1 + RADIUS_TOLERANCE)
    const bandLo = floorInt(lo, this.bandM)
    const bandHi = floorInt(hi, this.bandM)
    const fineSpan = floorInt(maxAngleDev, FINE_WIDTH) + 1
    const centre = pymod(floorInt(angle, FINE_WIDTH), FINE_SECTORS)

    let best = null
    let bestPenalty = INF

    for (let df = -fineSpan; df <= fineSpan; df += 1) {
      const fine = pymod(centre + df, FINE_SECTORS)
      for (let band = bandLo; band <= bandHi; band += 1) {
        const entry = this.cells.get(band * FINE_SECTORS + fine)
        if (entry === undefined) continue
        const [node, d, bearing, quality] = entry
        if (taken.has(node)) continue

        const angErr = Math.abs(pymod(bearing - angle + 180, 360) - 180)
        if (angErr > maxAngleDev) continue
        const radErr = (d - radiusM) / radiusM
        const a = angErr / maxAngleDev

        const penalty =
          W_RADIUS * radErr * radErr +
          W_ANGLE * (a * a) +
          W_QUALITY * Math.max(0, quality / this.bestQuality - 1)
        if (penalty < bestPenalty) {
          bestPenalty = penalty
          best = [node, d, bearing]
        }
      }
    }
    return best
  }
}

/** Boucles brutes, non filtrées. */
export function generateLoops(graph, start, targetM, profile, { sectors = 12, maxCandidates = 24, tolerance = 0.1 } = {}) {
  const collected = []
  let scale = 1
  const lo = targetM * (1 - tolerance)
  const hi = targetM * (1 + tolerance)

  const weights = profile.precompute(graph)
  const orientations = Math.max(3, Math.min(ORIENTATIONS, Math.trunc(sectors / 2)))
  const tree = new OutboundTree(graph, start, weights)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const batch = generateOnce(graph, start, targetM, profile, weights, tree, scale, orientations, maxCandidates)
    collected.push(...batch)

    let usable = 0
    for (const c of collected) if (c.stats && lo <= c.stats.distanceM && c.stats.distanceM <= hi) usable += 1
    if (usable >= ENOUGH_IN_RANGE) break

    if (!batch.length) {
      scale *= 1.3
      continue
    }

    const distances = batch.filter((c) => c.stats).map((c) => c.stats.distanceM)
    distances.sort((a, b) => a - b)
    const median = distances[Math.trunc(distances.length / 2)]
    if (median <= 0) break
    scale *= Math.max(0.6, Math.min(1.7, targetM / median))
  }
  return collected
}

class OutboundTree {
  constructor(graph, start, weights) {
    this.graph = graph
    this.start = start
    this.weights = weights
    this.reach = 0
    this.sectorTable = null
    this.result = null
  }

  sectors() {
    if (this.sectorTable === null) this.sectorTable = nodeSectors(this.graph, this.start)
    return this.sectorTable
  }

  forRadius(radiusM) {
    const needed = radiusM * (1 + RADIUS_TOLERANCE) + 50
    if (this.result === null || needed > this.reach) {
      this.reach = needed * 1.15
      this.result = dijkstra(this.graph, this.start, this.weights, { maxDist: this.reach, slack: 1 })
    }
    return this.result
  }
}

function generateOnce(graph, start, targetM, profile, weights, tree, scale, orientations, maxCandidates) {
  const plans = new Map(SHAPES.map((m) => [m, waypointPlan(m, targetM * scale)]))
  const allDistances = []
  for (const plan of plans.values()) for (const [, d] of plan) allDistances.push(d)

  const farthest = pyMax(allDistances)
  const outbound = tree.forRadius(farthest)

  const closest = pyMin(allDistances)
  const index = new VertexIndex(
    graph, start, outbound,
    Math.max(25, closest * BAND_RATIO),
    closest * (1 - RADIUS_TOLERANCE),
    farthest * (1 + RADIUS_TOLERANCE),
  )
  if (index.empty) {
    return fallbackOutAndBack(graph, start, outbound, weights, profile, targetM, scale, maxCandidates)
  }

  let candidates = []
  const coreMemo = new Map()
  const signatures = new Set()
  const nodeSector = tree.sectors()

  for (const m of SHAPES) {
    const plan = plans.get(m)
    const maxDev = (180 / m) * ANGLE_TOLERANCE

    for (let k = 0; k < orientations; k += 1) {
      if (candidates.length >= maxCandidates) break
      const theta = (k * 360) / orientations

      const vertices = pickVertices(index, plan, theta, maxDev)
      if (vertices === null) continue

      const signature = vertices.map((v) => v[0]).join(',')
      if (signatures.has(signature)) continue
      signatures.add(signature)

      const cand = buildPolygon(graph, start, vertices, outbound, weights, profile, targetM, nodeSector, coreMemo)
      if (cand !== null) {
        cand.shape = m
        candidates.push(cand)
      }
    }
  }

  if (!candidates.length) {
    candidates = fallbackOutAndBack(graph, start, outbound, weights, profile, targetM, scale, maxCandidates)
  }
  return candidates
}

function pickVertices(index, plan, theta, maxDev) {
  const vertices = []
  const taken = new Set()
  for (const [offset, distance] of plan) {
    const angle = pymod(theta + offset, 360)
    const found = index.pick(angle, distance, maxDev, taken)
    if (found === null) return null
    taken.add(found[0])
    vertices.push(found)
  }

  const ideal = plan.length > 1 ? plan[1][0] - plan[0][0] : 0
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const span = pymod(vertices[i + 1][2] - vertices[i][2], 360)
    if (!(ideal * SPAN_MIN <= span && span <= ideal * SPAN_MAX)) return null
  }
  return vertices
}

function buildPolygon(graph, start, vertices, outbound, weights, profile, targetM, nodeSector, coreMemo) {
  for (const clearance of [CORE_CLEARANCE, CORE_CLEARANCE * 0.5, 0]) {
    const edges = chainLegs(graph, start, vertices, outbound, weights, profile, targetM, clearance, nodeSector, coreMemo)
    if (edges) {
      const cand = new Candidate(edges, nodeSequence(graph, start, edges))
      measure(graph, start, cand, { night: profile.night })
      return cand
    }
  }
  return null
}

function chainLegs(graph, start, vertices, outbound, weights, profile, targetM, clearance, nodeSector, coreMemo) {
  const first = vertices[0][0]
  const leg = reconstruct(outbound, first)
  if (!leg || !leg.length) return null

  const edges = [...leg]
  const used = new Map()
  for (const e of leg) used.set(e, RETURN_PENALTY)

  const core = clearance > 0 ? coreNodes(outbound, vertices[0][1] * clearance, coreMemo) : null
  const legLimit = targetM * LEG_MAX_SHARE

  let cursor = first
  let cursorBearing = vertices[0][2]
  for (let i = 1; i < vertices.length; i += 1) {
    const [node, , bearing] = vertices[i]
    const gate = clearance > 0 ? sweepGate(cursorBearing, bearing) : null
    const piece = runLeg(graph, cursor, node, weights, profile, legLimit, used, core, nodeSector, gate)
    if (!piece || !piece.length) return null
    edges.push(...piece)
    for (const e of piece) used.set(e, RETURN_PENALTY)
    cursor = node
    cursorBearing = bearing
  }

  const closing = runLeg(graph, cursor, start, weights, profile, legLimit, used, null, null, null)
  if (!closing || !closing.length) return null
  edges.push(...closing)

  const trimmed = trimSpurs(edges)
  return trimmed.length ? trimmed : null
}

export function trimSpurs(edges) {
  const out = []
  for (const e of edges) {
    if (out.length && out[out.length - 1] === e) out.pop()
    else out.push(e)
  }
  return out
}

function coreNodes(outbound, radiusM, memo) {
  if (radiusM <= 0) return []
  const key = pyRoundInt(radiusM / CORE_RADIUS_BUCKET_M)
  const cached = memo.get(key)
  if (cached !== undefined) return cached

  const bucket = key * CORE_RADIUS_BUCKET_M
  const inside = []
  for (const node of outbound.reached) if (outbound.dist[node] <= bucket) inside.push(node)
  memo.set(key, inside)
  return inside
}

function runLeg(graph, source, target, weights, profile, limitM, penalties, blocked, nodeSector, gate) {
  const result = astar(graph, source, target, weights, {
    minFactor: profile.minFactor,
    maxDist: limitM,
    penalties,
    blocked,
    sector: nodeSector,
    allowed: gate,
    epsilon: RETURN_EPSILON,
  })
  return reconstruct(result, target)
}

function fallbackOutAndBack(graph, start, outbound, weights, profile, targetM, scale, limit) {
  const radius = targetM * 0.5 * scale
  const index = new VertexIndex(graph, start, outbound, Math.max(25, radius * BAND_RATIO), radius * 0.6, radius * 1.4)
  if (index.empty) return []

  const candidates = []
  const taken = new Set()
  const count = Math.max(4, limit)
  for (let k = 0; k < count; k += 1) {
    const angle = (k * 360) / count
    const found = index.pick(angle, radius, 45, taken)
    if (found === null) continue
    const node = found[0]
    taken.add(node)

    const outEdges = reconstruct(outbound, node)
    if (!outEdges || !outEdges.length) continue
    const penalties = new Map()
    for (const e of outEdges) penalties.set(e, RETURN_PENALTY)
    const backEdges = runLeg(graph, node, start, weights, profile, targetM * 0.8, penalties, null, null, null)
    if (!backEdges || !backEdges.length) continue
    const edges = trimSpurs([...outEdges, ...backEdges])
    if (!edges.length) continue
    const cand = new Candidate(edges, nodeSequence(graph, start, edges))
    measure(graph, start, cand, { night: profile.night })
    candidates.push(cand)
  }
  return candidates
}

/** Géométrie, tronçons homogènes, traversées et statistiques L3. */
export function measure(graph, start, cand, { night }) {
  const geometry = []
  const segments = []

  let total = 0
  let exposed = 0
  let protectedM = 0
  let inferred = 0
  let unlit = 0
  let tunnelUnlit = 0
  let longestExposed = 0
  let currentExposed = 0

  let cursor = start
  for (const e of cand.edges) {
    const coords = graph.coordsFrom(e, cursor)
    cursor = graph.other(e, cursor)

    const s = graph.edgeSafety[e]
    const length = graph.edgeLen[e]
    total += length

    if (s.risk >= EXPOSED_RISK) {
      exposed += length
      currentExposed += length
      longestExposed = Math.max(longestExposed, currentExposed)
    } else {
      currentExposed = 0
    }

    if (s.separation >= 2) protectedM += length
    if (s.inferred) inferred += length
    unlit += unlitLength(s, length)
    if (graph.edgeTunnel[e]) tunnelUnlit += length

    if (!geometry.length) geometry.push(...coords)
    else for (let k = 1; k < coords.length; k += 1) geometry.push(coords[k])

    const name = graph.edgeName[e]
    const last = segments[segments.length - 1]
    if (last && last.level === s.level && last.surface === s.surface && last.road === name) {
      for (let k = 1; k < coords.length; k += 1) last.coords.push(coords[k])
      last.lengthM += length
    } else {
      segments.push({
        coords: [...coords],
        lengthM: length,
        risk: s.risk,
        level: s.level,
        separation: s.separation,
        speedKmh: s.speedKmh,
        surface: s.surface,
        lit: s.lit,
        road: name,
        inferred: s.inferred,
      })
    }
  }

  const crossings = detectCrossings(graph, cand)
  let unprotected = 0
  for (const c of crossings) if (!c.protected) unprotected += 1

  // Recouvrement : `Counter(cand.edges)` garde l'ordre de première apparition,
  // et la somme compensée suit cet ordre.
  const counts = new Map()
  for (const e of cand.edges) counts.set(e, (counts.get(e) ?? 0) + 1)
  const repeatedParts = []
  for (const [e, n] of counts) if (n > 1) repeatedParts.push(graph.edgeLen[e] * (n - 1))
  const repeated = pySum(repeatedParts)

  const closure = geometry.length ? haversineM(geometry[0], geometry[geometry.length - 1]) : 0

  cand.geometry = geometry
  cand.segments = segments
  cand.crossings = crossings
  cand.roundness = roundness(geometry)
  cand.bearing = loopBearing(graph.node(start), geometry)
  cand.stats = new RouteStats({
    distanceM: total,
    exposedM: exposed,
    longestExposedM: longestExposed,
    unprotectedCrossings: unprotected,
    protectedCrossings: crossings.length - unprotected,
    tunnelUnlitM: tunnelUnlit,
    closureM: closure,
    overlapShare: total ? repeated / total : 0,
    protectedM,
    inferredM: inferred,
    unlitM: night ? unlit : null,
  })
}

function loopBearing(start, geometry) {
  if (!geometry.length) return 0
  const n = geometry.length
  const centroid = [pySum(geometry.map((c) => c[0])) / n, pySum(geometry.map((c) => c[1])) / n]
  return bearingDeg(start, centroid)
}

export function detectCrossings(graph, cand) {
  const used = cand.edgeSet
  const hits = []
  for (let i = 1; i < cand.nodes.length - 1; i += 1) {
    const node = cand.nodes[i]
    let fastest = 0
    for (let k = graph.adjOffset[node]; k < graph.adjOffset[node + 1]; k += 1) {
      const e = graph.adjEdges[k]
      if (used.has(e)) continue
      fastest = Math.max(fastest, graph.edgeSafety[e].speedKmh)
    }
    if (fastest < 70) continue

    const crossing = graph.crossings.get(node)
    hits.push({
      lon: graph.nodeLon[node],
      lat: graph.nodeLat[node],
      protected: crossing ? crossing.protected : false,
      speedKmh: fastest,
      kind: crossing ? crossing.kind : 'untagged',
    })
  }
  return hits
}

/** Une boucle parcourue plusieurs fois — voir `repeat_loop`. */
export function repeatLoop(graph, start, cand, laps) {
  const edges = []
  for (let i = 0; i < laps; i += 1) edges.push(...cand.edges)
  const repeated = new Candidate(edges, [])
  repeated.nodes = nodeSequence(graph, start, edges)
  measure(graph, start, repeated, { night: cand.stats.unlitM !== null })

  repeated.roundness = cand.roundness
  repeated.stats.overlapShare = cand.stats.overlapShare
  repeated.bearing = cand.bearing
  repeated.shape = cand.shape
  repeated.laps = laps
  return repeated
}

/** Part d'arêtes communes, rapportée au plus petit des deux tracés. */
export function similarity(a, b) {
  const sa = a.edgeSet
  const sb = b.edgeSet
  if (!sa.size || !sb.size) return 0
  let common = 0
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa]
  for (const e of small) if (large.has(e)) common += 1
  return common / Math.min(sa.size, sb.size)
}
