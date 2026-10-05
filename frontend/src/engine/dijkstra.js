// Plus courts chemins : Dijkstra et A* — portage fidèle de `backend/app/routing/dijkstra.py`.
//
// Le tas de Python compare des couples (coût, nœud) : à coût égal, le plus petit
// numéro de nœud sort le premier. Le tas ci-dessous reproduit ce départage, sans
// lequel deux chemins de même coût seraient choisis différemment d'un moteur à
// l'autre.

import { haversineM } from './geo'

export const INF = Infinity

/** Tas binaire sur des couples (clé, nœud), ordre lexicographique. */
class PairHeap {
  constructor() {
    this.keys = []
    this.nodes = []
  }

  get size() {
    return this.keys.length
  }

  push(key, node) {
    const keys = this.keys
    const nodes = this.nodes
    let i = keys.length
    keys.push(key)
    nodes.push(node)
    while (i > 0) {
      const parent = (i - 1) >> 1
      const pk = keys[parent]
      if (key < pk || (key === pk && node < nodes[parent])) {
        keys[i] = pk
        nodes[i] = nodes[parent]
        i = parent
      } else break
    }
    keys[i] = key
    nodes[i] = node
  }

  /** Retire le minimum ; le rend dans `this.topKey` / `this.topNode`. */
  pop() {
    const keys = this.keys
    const nodes = this.nodes
    this.topKey = keys[0]
    this.topNode = nodes[0]
    const lastKey = keys.pop()
    const lastNode = nodes.pop()
    const n = keys.length
    if (n === 0) return
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      if (l >= n) break
      const r = l + 1
      let c = l
      if (r < n && (keys[r] < keys[l] || (keys[r] === keys[l] && nodes[r] < nodes[l]))) c = r
      if (keys[c] < lastKey || (keys[c] === lastKey && nodes[c] < lastNode)) {
        keys[i] = keys[c]
        nodes[i] = nodes[c]
        i = c
      } else break
    }
    keys[i] = lastKey
    nodes[i] = lastNode
  }
}

function blank(n) {
  return {
    dist: new Float64Array(n).fill(INF),
    cost: new Float64Array(n).fill(INF),
    prevNode: new Int32Array(n).fill(-1),
    prevEdge: new Int32Array(n).fill(-1),
    reached: [],
  }
}

/**
 * Plus courts chemins depuis `source` — `dijkstra` en Python. `oneway` à faux
 * ignore les sens uniques : l'accrochage d'une trace importée suit ce qui a été
 * réellement parcouru, contresens non cartographié compris.
 */
export function dijkstra(graph, source, weights, { maxDist = null, target = null, penalties = null, slack = 1.15, oneway = true } = {}) {
  const { edgeA, edgeB, edgeLen, adjOffset, adjEdges } = graph
  const sens = oneway ? graph.edgeOneway : null
  const n = graph.nodeCount
  const res = blank(n)
  const { dist, cost, prevNode, prevEdge, reached } = res
  const settled = new Uint8Array(n)

  dist[source] = 0
  cost[source] = 0
  const heap = new PairHeap()
  heap.push(0, source)
  const limit = maxDist !== null ? maxDist * slack : INF
  const bound = maxDist !== null ? maxDist : INF

  while (heap.size) {
    heap.pop()
    const c = heap.topKey
    const u = heap.topNode
    if (settled[u]) continue
    settled[u] = 1
    reached.push(u)

    if (target !== null && u === target) break

    const du = dist[u]
    if (du > bound) continue

    for (let k = adjOffset[u]; k < adjOffset[u + 1]; k += 1) {
      const e = adjEdges[k]
      const v = edgeA[e] === u ? edgeB[e] : edgeA[e]
      if (settled[v]) continue
      // Sens unique à vélo : 1 se prend depuis A, -1 depuis B.
      if (sens && sens[e] && (edgeA[e] === u) !== (sens[e] > 0)) continue

      const nd = du + edgeLen[e]
      if (nd > limit) continue

      let w = weights[e]
      if (penalties !== null) {
        const p = penalties.get(e)
        w *= p === undefined ? 1 : p
      }
      const nc = c + w

      if (nc < cost[v]) {
        cost[v] = nc
        dist[v] = nd
        prevNode[v] = u
        prevEdge[v] = e
        heap.push(nc, v)
      }
    }
  }
  return res
}

/**
 * A* guidé vers `target` — voir `astar` en Python pour `minFactor`, `epsilon`,
 * `blocked` (liste de nœuds interdits), `sector` et `allowed` (garde-fou angulaire).
 */
export function astar(
  graph,
  source,
  target,
  weights,
  { minFactor, maxDist = null, penalties = null, blocked = null, sector = null, allowed = null, epsilon = 1 },
) {
  const { edgeA, edgeB, edgeLen, adjOffset, adjEdges, nodeLon, nodeLat } = graph
  const sens = graph.edgeOneway
  const n = graph.nodeCount
  const goal = [nodeLon[target], nodeLat[target]]
  const hFactor = minFactor * epsilon

  const res = blank(n)
  const { dist, cost, prevNode, prevEdge, reached } = res
  const settled = new Uint8Array(n)

  if (blocked && blocked.length) {
    for (const node of blocked) settled[node] = 1
  }
  settled[source] = 0
  settled[target] = 0

  let gate = null
  if (allowed !== null && sector !== null) {
    gate = Uint8Array.from(allowed)
    gate[sector[target]] = 1
    gate[sector[source]] = 1
  }

  dist[source] = 0
  cost[source] = 0
  const heap = new PairHeap()
  heap.push(haversineM([nodeLon[source], nodeLat[source]], goal) * hFactor, source)
  const limit = maxDist !== null ? maxDist : INF

  while (heap.size) {
    heap.pop()
    const u = heap.topNode
    if (settled[u]) continue
    settled[u] = 1
    reached.push(u)

    if (u === target) break

    const du = dist[u]
    if (du > limit) continue
    const gu = cost[u]

    for (let k = adjOffset[u]; k < adjOffset[u + 1]; k += 1) {
      const e = adjEdges[k]
      const v = edgeA[e] === u ? edgeB[e] : edgeA[e]
      if (settled[v]) continue
      if (gate !== null && !gate[sector[v]]) continue
      if (sens && sens[e] && (edgeA[e] === u) !== (sens[e] > 0)) continue

      const nd = du + edgeLen[e]
      if (nd > limit) continue

      let w = weights[e]
      if (penalties !== null) {
        const p = penalties.get(e)
        w *= p === undefined ? 1 : p
      }
      const ng = gu + w

      if (ng < cost[v]) {
        cost[v] = ng
        dist[v] = nd
        prevNode[v] = u
        prevEdge[v] = e
        heap.push(ng + haversineM([nodeLon[v], nodeLat[v]], goal) * hFactor, v)
      }
    }
  }
  return res
}

/** Suite d'arêtes de la source jusqu'à `target`, ou `null`. */
export function reconstruct(result, target) {
  if (result.dist[target] === INF) return null
  const edges = []
  let cur = target
  let guard = 0
  while (result.prevEdge[cur] >= 0) {
    edges.push(result.prevEdge[cur])
    cur = result.prevNode[cur]
    guard += 1
    if (guard > 1_000_000) return null
  }
  edges.reverse()
  return edges
}

export function nodeSequence(graph, source, edges) {
  const nodes = [source]
  let cur = source
  for (const e of edges) {
    cur = graph.other(e, cur)
    nodes.push(cur)
  }
  return nodes
}
