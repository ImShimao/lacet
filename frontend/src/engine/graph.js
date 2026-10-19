// Le graphe routable — portage fidèle de `backend/app/osm/graph.py`.
//
// Même construction, dans le même ordre : L0, repérage des jonctions,
// contraction, évaluation de sécurité. L'ordre compte au-delà du résultat
// visible : les rangs des nœuds et des arêtes décident, à coût égal, quel
// chemin Dijkstra retient — les garder identiques est ce qui permet aux deux
// moteurs de rendre les mêmes itinéraires.
//
// La forme change pour tenir sur un téléphone : les arêtes sont rangées en
// colonnes de tableaux typés plutôt qu'en objets, l'adjacence en un seul
// tableau compact (CSR), et toutes les géométries dans un buffer partagé.
// L'ordre d'adjacence de chaque nœud est celui de Python — les arêtes y sont
// ajoutées dans leur ordre de création.

import { haversineM, planarDistance, pointInRing, ringBbox } from './geo'
import { pairs, pointAt } from './extract'
import { greenIndex } from './green'
import { pyfloordiv, pyRound, pySum, radians } from './py'
import { closedBarrier, evaluateEdge, isExcluded, onewayFor, tunnelIsUnprotected } from './safety'

const BUILTUP_DENSITY_M = 15_000
const DENSITY_CELL_M = 400

/** Clé entière d'une case (cx, cy), cases signées jusqu'à ±32 767. */
const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768)

/** `int(x // step)` */
const cellOf = (x, step) => Math.trunc(pyfloordiv(x, step))

class GrowableFloat64 {
  constructor(capacity = 1024) {
    this.data = new Float64Array(capacity)
    this.length = 0
  }

  push(value) {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    this.data[this.length] = value
    this.length += 1
  }

  pack() {
    return this.data.slice(0, this.length)
  }
}

export class Graph {
  constructor() {
    this.nodeLon = []
    this.nodeLat = []
    this.edgeA = []
    this.edgeB = []
    this.edgeLen = []
    this.edgeCoordStart = []
    this.edgeCoordCount = []
    this.edgeSafety = []
    this.edgeName = []
    this.edgeWayId = []
    this.edgeTunnel = []
    // Sens permis à vélo : 1 de A vers B, -1 de B vers A, 0 les deux — voir `onewayFor`.
    this.edgeOneway = []
    // Part de l'arête près d'un parc, d'un bois ou de l'eau, et voie de sentier
    // balisé — voir `green.js`.
    this.edgeGreen = new Float64Array(0)
    this.edgeMarked = []
    this.coords = null
    this.adjOffset = null
    this.adjEdges = null
    this.crossings = new Map()
    // Les barrières fermées (voir `closedBarrier`) : leurs nœuds, et les arêtes
    // qu'elles ferment. Vides sur tout extrait sans barrière — celui des tests
    // de parité compris.
    this.gates = new Set()
    this.gatedEdges = new Set()

    this.grid = new Map()
    this.origin = null
    this.cellM = 200
    this.kx = 111_320
    this.ky = 110_540
  }

  get nodeCount() {
    return this.nodeLon.length
  }

  get edgeCount() {
    return this.edgeA.length
  }

  node(i) {
    return [this.nodeLon[i], this.nodeLat[i]]
  }

  other(e, node) {
    return this.edgeA[e] === node ? this.edgeB[e] : this.edgeA[e]
  }

  /** Géométrie orientée dans le sens du parcours. */
  coordsFrom(e, node) {
    const start = this.edgeCoordStart[e]
    const count = this.edgeCoordCount[e]
    const coords = this.coords
    const out = new Array(count)
    if (node === this.edgeA[e]) {
      for (let k = 0; k < count; k += 1) out[k] = [coords[2 * (start + k)], coords[2 * (start + k) + 1]]
    } else {
      for (let k = 0; k < count; k += 1) {
        const p = start + count - 1 - k
        out[k] = [coords[2 * p], coords[2 * p + 1]]
      }
    }
    return out
  }

  // --- indexation spatiale ------------------------------------------------

  cell(lon, lat) {
    const x = (lon - this.origin[0]) * this.kx
    const y = (lat - this.origin[1]) * this.ky
    return [cellOf(x, this.cellM), cellOf(y, this.cellM)]
  }

  buildIndex() {
    const n = this.nodeCount
    if (!n) return
    this.origin = [pySum(this.nodeLon) / n, pySum(this.nodeLat) / n]
    this.kx = 111_320 * Math.cos(radians(this.origin[1]))
    this.ky = 110_540
    this.grid.clear()
    for (let i = 0; i < n; i += 1) {
      const [cx, cy] = this.cell(this.nodeLon[i], this.nodeLat[i])
      const key = cellKey(cx, cy)
      let bucket = this.grid.get(key)
      if (!bucket) this.grid.set(key, (bucket = []))
      bucket.push(i)
    }
  }

  /** Nœud le plus proche d'un point, ou `null` au-delà de `maxRadiusM`.
   *  `allowed` : masque (Uint8Array) restreignant la recherche. */
  nearestNode(lon, lat, maxRadiusM = 2000, allowed = null) {
    if (this.origin === null) this.buildIndex()
    if (!this.nodeCount) return null

    const target = [lon, lat]
    const [cx, cy] = this.cell(lon, lat)
    const maxRings = cellOf(maxRadiusM, this.cellM) + 2
    let best = null
    let bestD = Infinity

    for (let r = 0; r <= maxRings; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const bucket = this.grid.get(cellKey(cx + dx, cy + dy))
          if (!bucket) continue
          for (const node of bucket) {
            if (allowed !== null && !allowed[node]) continue
            const d = haversineM(target, [this.nodeLon[node], this.nodeLat[node]])
            if (d < bestD) {
              bestD = d
              best = node
            }
          }
        }
      }
      if (best !== null && bestD <= r * this.cellM) break
    }
    return bestD <= maxRadiusM ? best : null
  }

  // --- composantes connexes -----------------------------------------------

  /** Taille atteinte par un parcours borné — seule la taille sert à l'appelant. */
  localComponentSize(node, limit) {
    const seen = new Uint8Array(this.nodeCount)
    seen[node] = 1
    let size = 1
    const stack = [node]
    while (stack.length && size < limit) {
      const u = stack.pop()
      for (let k = this.adjOffset[u]; k < this.adjOffset[u + 1]; k += 1) {
        const v = this.other(this.adjEdges[k], u)
        if (!seen[v]) {
          seen[v] = 1
          size += 1
          stack.push(v)
        }
      }
    }
    return size
  }

  /** Plus grande composante connexe, en masque. À taille égale, la première
   *  rencontrée dans l'ordre des nœuds — comme `largest_component`. */
  largestComponent() {
    const n = this.nodeCount
    const label = new Int32Array(n).fill(-1)
    let bestLabel = -1
    let bestSize = 0
    let next = 0
    for (let start = 0; start < n; start += 1) {
      if (label[start] !== -1) continue
      const id = next
      next += 1
      let size = 0
      const stack = [start]
      label[start] = id
      while (stack.length) {
        const u = stack.pop()
        size += 1
        for (let k = this.adjOffset[u]; k < this.adjOffset[u + 1]; k += 1) {
          const v = this.other(this.adjEdges[k], u)
          if (label[v] === -1) {
            label[v] = id
            stack.push(v)
          }
        }
      }
      if (size > bestSize) {
        bestSize = size
        bestLabel = id
      }
    }
    const mask = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) if (label[i] === bestLabel) mask[i] = 1
    return mask
  }

  /** Passe aux tableaux typés et construit l'adjacence compacte. */
  freeze(coords) {
    this.coords = coords
    this.nodeLon = Float64Array.from(this.nodeLon)
    this.nodeLat = Float64Array.from(this.nodeLat)
    this.edgeA = Int32Array.from(this.edgeA)
    this.edgeB = Int32Array.from(this.edgeB)
    this.edgeLen = Float64Array.from(this.edgeLen)
    this.edgeCoordStart = Int32Array.from(this.edgeCoordStart)
    this.edgeCoordCount = Int32Array.from(this.edgeCoordCount)
    this.edgeWayId = Float64Array.from(this.edgeWayId)
    this.edgeTunnel = Uint8Array.from(this.edgeTunnel)
    this.edgeOneway = Int8Array.from(this.edgeOneway)
    this.edgeMarked = Uint8Array.from(this.edgeMarked)
    this.link()
  }

  /** L'adjacence compacte, arêtes rangées dans leur ordre de création. */
  link() {
    const n = this.nodeCount
    const degree = new Int32Array(n + 1)
    for (let e = 0; e < this.edgeCount; e += 1) {
      degree[this.edgeA[e] + 1] += 1
      degree[this.edgeB[e] + 1] += 1
    }
    for (let i = 0; i < n; i += 1) degree[i + 1] += degree[i]
    this.adjOffset = degree
    this.adjEdges = new Int32Array(degree[n])
    const cursor = degree.slice(0, n)
    for (let e = 0; e < this.edgeCount; e += 1) {
      this.adjEdges[cursor[this.edgeA[e]]++] = e
      this.adjEdges[cursor[this.edgeB[e]]++] = e
    }
  }
}

// --- zone bâtie -------------------------------------------------------------

class BuiltUpIndex {
  static MAX_CELLS_PER_POLYGON = 400
  static MEMO_CELL_M = 80

  constructor(areas, origin) {
    this.origin = origin
    this.memo = new Map()
    this.kx = 111_320 * Math.cos(radians(origin[1]))
    this.ky = 110_540
    this.density = new Map()
    this.buckets = new Map()
    this.always = []

    for (const { flat } of areas) {
      if (flat.length < 6) continue
      const ring = pairs(flat)
      const bbox = ringBbox(ring)
      const entry = [bbox, ring]
      const [cx0, cy0] = this.cell(bbox[0], bbox[1])
      const [cx1, cy1] = this.cell(bbox[2], bbox[3])
      const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1)
      if (cells > BuiltUpIndex.MAX_CELLS_PER_POLYGON) {
        this.always.push(entry)
        continue
      }
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const key = cellKey(cx, cy)
          let bucket = this.buckets.get(key)
          if (!bucket) this.buckets.set(key, (bucket = []))
          bucket.push(entry)
        }
      }
    }
  }

  cell(lon, lat) {
    const x = (lon - this.origin[0]) * this.kx
    const y = (lat - this.origin[1]) * this.ky
    return [cellOf(x, DENSITY_CELL_M), cellOf(y, DENSITY_CELL_M)]
  }

  addRoadLength(lon, lat, lengthM) {
    const [cx, cy] = this.cell(lon, lat)
    const key = cellKey(cx, cy)
    this.density.set(key, (this.density.get(key) ?? 0) + lengthM)
  }

  neighbourhoodDensity(lon, lat) {
    const [cx, cy] = this.cell(lon, lat)
    const values = []
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) values.push(this.density.get(cellKey(cx + dx, cy + dy)) ?? 0)
    }
    return pySum(values)
  }

  isBuiltup(lon, lat) {
    const key = cellKey(
      cellOf((lon - this.origin[0]) * this.kx, BuiltUpIndex.MEMO_CELL_M),
      cellOf((lat - this.origin[1]) * this.ky, BuiltUpIndex.MEMO_CELL_M),
    )
    let cached = this.memo.get(key)
    if (cached === undefined) {
      cached = this.compute(lon, lat)
      this.memo.set(key, cached)
    }
    return cached
  }

  compute(lon, lat) {
    const [cx, cy] = this.cell(lon, lat)
    const inside = ([bbox, ring]) =>
      bbox[0] <= lon && lon <= bbox[2] && bbox[1] <= lat && lat <= bbox[3] && pointInRing([lon, lat], ring)
    for (const entry of this.buckets.get(cellKey(cx, cy)) ?? []) if (inside(entry)) return true
    for (const entry of this.always) if (inside(entry)) return true
    return this.neighbourhoodDensity(lon, lat) >= BUILTUP_DENSITY_M
  }
}

// --- construction -----------------------------------------------------------

/** Identifiant stable dérivé des coordonnées, pour une voie sans liste de nœuds. */
const coordKey = (lon, lat) => `${pyRound(lon, 7)},${pyRound(lat, 7)}`

export function buildGraph(extract, { allowTrail = false, sport = 'run' } = {}) {
  const graph = new Graph()
  if (!extract.ways.length) {
    graph.freeze(new Float64Array(0))
    return graph
  }

  const crossingIds = new Set(extract.crossings.map((c) => c.id))
  const marked = new Set(extract.marked ?? [])
  const gateIds = new Set((extract.barriers ?? []).filter((b) => closedBarrier(b.tags, sport)).map((b) => b.id))
  const origin = pointAt(extract.ways[0].flat, 0)
  const builtup = new BuiltUpIndex(extract.landuse, origin)
  const distance = planarDistance(origin[1])

  // --- passe 1 : L0 + densité de voirie -----------------------------------
  const kept = []
  for (const way of extract.ways) {
    if (isExcluded(way.tags, { allowTrail, sport })) continue
    const flat = way.flat
    const n = flat.length / 2
    if (n < 2) continue

    let nodeIds = way.nodes
    if (nodeIds.length !== n) {
      nodeIds = new Array(n)
      for (let i = 0; i < n; i += 1) nodeIds[i] = coordKey(flat[2 * i], flat[2 * i + 1])
    }

    const cumulative = new Float64Array(n)
    let total = 0
    for (let i = 0; i < n - 1; i += 1) {
      total += distance([flat[2 * i], flat[2 * i + 1]], [flat[2 * i + 2], flat[2 * i + 3]])
      cumulative[i + 1] = total
    }

    const mid = Math.trunc(n / 2)
    builtup.addRoadLength(flat[2 * mid], flat[2 * mid + 1], total)
    kept.push([way, nodeIds, cumulative])
  }

  // --- passe 2 : jonctions ------------------------------------------------
  const occurrences = new Map()
  for (const [, nodeIds] of kept) {
    for (const id of nodeIds) occurrences.set(id, (occurrences.get(id) ?? 0) + 1)
  }
  const junctions = new Set()
  for (const [id, count] of occurrences) if (count >= 2) junctions.add(id)
  for (const id of crossingIds) if (occurrences.has(id)) junctions.add(id)
  // Une barrière coupe la voie : elle doit être un nœud du graphe, sans quoi
  // elle disparaîtrait au milieu d'une arête.
  for (const id of gateIds) if (occurrences.has(id)) junctions.add(id)
  for (const [, nodeIds] of kept) {
    junctions.add(nodeIds[0])
    junctions.add(nodeIds[nodeIds.length - 1])
  }

  // --- passe 3 : contraction + sécurité ------------------------------------
  const rank = new Map()
  const coords = new GrowableFloat64(1 << 16)
  // Pour chaque barrière : les arêtes qui y touchent, et si elle est au bout
  // de leur voie ou en son milieu — voir plus bas.
  const gateSides = new Map()
  const nodeRank = (osmId, lon, lat) => {
    let idx = rank.get(osmId)
    if (idx === undefined) {
      idx = graph.nodeLon.length
      rank.set(osmId, idx)
      graph.nodeLon.push(lon)
      graph.nodeLat.push(lat)
    }
    return idx
  }

  for (const [way, nodeIds, cumulative] of kept) {
    const tags = way.tags
    const flat = way.flat
    const n = flat.length / 2
    const mid = Math.trunc(n / 2)
    const inBuiltup = builtup.isBuiltup(flat[2 * mid], flat[2 * mid + 1])
    const safety = evaluateEdge(tags, { inBuiltup, sport })
    const tunnel = tunnelIsUnprotected(tags) ? 1 : 0
    // Les arêtes suivent l'ordre des nœuds de la voie : `oneway=yes` va de A vers B.
    const oneway = onewayFor(tags, sport)
    // `tags.get("name") or tags.get("ref")` rend la dernière valeur évaluée :
    // une référence vide donne "", pas None, et la navigation fait la différence.
    const name = (tags.name || tags.ref) ?? null

    // La géométrie de la voie est rangée une fois ; ses arêtes en désignent
    // chacune une tranche.
    const wayStart = coords.length / 2
    for (let i = 0; i < flat.length; i += 1) coords.push(flat[i])

    const splits = [0]
    for (let i = 1; i < n - 1; i += 1) if (junctions.has(nodeIds[i])) splits.push(i)
    splits.push(n - 1)

    for (let k = 0; k < splits.length - 1; k += 1) {
      const i = splits[k]
      const j = splits[k + 1]
      const a = nodeIds[i]
      const b = nodeIds[j]
      if (a === b) continue
      const length = cumulative[j] - cumulative[i]
      if (length <= 0) continue

      const ra = nodeRank(a, flat[2 * i], flat[2 * i + 1])
      const rb = nodeRank(b, flat[2 * j], flat[2 * j + 1])
      graph.edgeA.push(ra)
      graph.edgeB.push(rb)
      graph.edgeLen.push(length)
      graph.edgeCoordStart.push(wayStart + i)
      graph.edgeCoordCount.push(j - i + 1)
      graph.edgeSafety.push(safety)
      graph.edgeName.push(name)
      graph.edgeWayId.push(way.id)
      graph.edgeTunnel.push(tunnel)
      graph.edgeOneway.push(oneway)
      graph.edgeMarked.push(marked.has(way.id) ? 1 : 0)
      if (gateIds.size) {
        const e = graph.edgeA.length - 1
        for (const [id, end] of [[a, i === 0], [b, j === n - 1]]) {
          if (!gateIds.has(id)) continue
          if (!gateSides.has(id)) gateSides.set(id, [])
          gateSides.get(id).push([e, end])
        }
      }
    }
  }

  // **Ce qu'une barrière ferme.** Au milieu d'un chemin, elle le coupe : les
  // deux côtés sont fermés. Posée là où une allée privée quitte la rue — le
  // nœud est au bout de l'allée, au milieu de la rue —, elle ferme l'allée et
  // pas la rue : ce sont les voies qui **commencent** au portail qu'on ferme.
  for (const [id, sides] of gateSides) {
    graph.gates.add(rank.get(id))
    const through = sides.some(([, end]) => !end)
    const branch = sides.some(([, end]) => end)
    for (const [e, end] of sides) if (!(through && branch) || end) graph.gatedEdges.add(e)
  }

  // --- traversées ----------------------------------------------------------
  for (const node of extract.crossings) {
    const idx = rank.get(node.id)
    if (idx === undefined) continue
    const [kind, isProtected] = classifyCrossing(node.tags)
    graph.crossings.set(idx, { node: idx, lon: node.lon, lat: node.lat, kind, protected: isProtected })
  }

  graph.freeze(coords.pack())
  graph.edgeGreen = greenIndex(graph, extract.green ?? [], origin)
  graph.buildIndex()
  return graph
}

function classifyCrossing(tags) {
  const crossing = tags.crossing ?? ''
  if (crossing === 'traffic_signals' || tags['crossing:signals'] === 'yes') return ['traffic_signals', true]
  const markings = tags['crossing:markings']
  if (
    crossing === 'marked' || crossing === 'zebra' || crossing === 'uncontrolled' ||
    (markings !== undefined && markings !== 'no')
  ) {
    return ['marked', true]
  }
  if (crossing === 'unmarked') return ['unmarked', false]
  return ['untagged', false]
}
