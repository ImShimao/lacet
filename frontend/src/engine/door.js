// Partir de chez soi — pas du carrefour d'à côté.
//
// Le graphe ne connaît que des carrefours : une rue n'y est qu'un trait entre
// deux intersections. Le départ se posait donc sur le **carrefour** le plus
// proche du point choisi, et la boucle commençait au coin de la rue, vingt ou
// quatre-vingts mètres plus loin — jamais devant la porte. Signalé d'une
// capture d'écran : « le point de départ n'est même pas devant chez moi ».
//
// On fait maintenant ce que ferait quelqu'un qui sort de chez lui :
//
// 1. **Il rejoint la rue.** On cherche le point de voie le plus proche du
//    départ — sur n'importe quelle rue, pas seulement à ses extrémités — et
//    l'on coupe la rue en deux à cet endroit. C'est le seuil.
// 2. **Il y va à pied.** Du départ au seuil, un raccord en ligne droite :
//    l'allée, le trottoir, les quelques mètres qu'aucune carte ne trace. La
//    boucle part **exactement** du point choisi, et y revient.
//
// Le graphe partagé n'est pas touché : il sert à d'autres recherches, et le
// seuil ne vaut que pour celle-ci. On en dérive un autre, qui partage les
// géométries et ne recopie que les colonnes des arêtes — deux nœuds et deux
// arêtes de plus.
//
// Propre au moteur de l'app : le moteur Python part du carrefour. Voir la
// liste des divergences dans `service.js`.

import { Graph } from './graph'
import { haversineM } from './geo'
import { evaluateEdge } from './safety'
import { BLOCKED_FACTOR } from './weights'

// Au-delà, le point posé n'est plus une porte : c'est un champ, un toit, le
// milieu d'un étang. Une ligne droite jusqu'à la rue traverserait n'importe
// quoi ; le départ se pose alors sur la rue la plus proche, et l'écran le dit
// (voir `useSearch.js`). Deux cents mètres couvrent les plus longues allées de
// campagne.
export const MAX_REACH_M = 200

// En deçà, le point est déjà sur la rue : un raccord de cette longueur ne
// serait qu'un pas de côté dessiné.
const ON_STREET_M = 1.5

// Si près d'un carrefour, c'est le carrefour : couper la rue à deux mètres de
// lui ne créerait qu'un tronçon minuscule, sans rien changer au départ.
const AT_NODE_M = 3

// Un sentier ou un escalier ne l'emporte sur une rue que s'il est plus proche
// d'autant. Derrière bien des maisons passe un chemin, plus près du mur que la
// rue où donne la porte ; partir par l'escalier du talus n'a pas de sens.
const TRAIL_HANDICAP_M = 8
const TRAIL_LIKE = new Set(['path', 'track', 'bridleway', 'steps'])

/**
 * Un graphe dérivé : celui de la zone, plus le seuil et le raccord.
 *
 * Les géométries restent celles du graphe d'origine, sauf pour les arêtes
 * ajoutées ou coupées, dont la forme est gardée à part (`shapes`) et rendue
 * par `coordsFrom`. Ces arêtes-là gardent dans `edgeCoordStart` la tranche de
 * la rue entière : un lecteur qui irait lire `coords` directement verrait la
 * rue complète au lieu de sa moitié — une approximation prudente, jamais un
 * point inventé.
 */
class DoorGraph extends Graph {
  coordsFrom(e, node) {
    const shape = this.shapes.get(e)
    if (!shape) return super.coordsFrom(e, node)
    const out = shape.map(([lon, lat]) => [lon, lat])
    return node === this.edgeA[e] ? out : out.reverse()
  }
}

/**
 * Le point de voie le plus proche de `[lon, lat]`, arête par arête.
 *
 * Toutes les arêtes sont balayées : une rue longue peut passer devant la porte
 * sans qu'aucun de ses deux carrefours soit proche, et c'est justement le cas
 * qu'on veut trouver. En mètres locaux, sans racine carrée inutile — quelques
 * millisecondes pour une ville entière.
 *
 * `accept` restreint les arêtes candidates (masque de composante).
 */
export function nearestSpot(graph, lon, lat, accept = null) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  const coords = graph.coords
  let best = null
  let bestScore = Infinity

  for (let e = 0; e < graph.edgeCount; e += 1) {
    if (accept && !accept(e)) continue
    const handicap = TRAIL_LIKE.has(graph.edgeSafety[e].highway) ? TRAIL_HANDICAP_M : 0
    const start = graph.edgeCoordStart[e]
    const count = graph.edgeCoordCount[e]
    for (let i = 0; i + 1 < count; i += 1) {
      const ax = (coords[2 * (start + i)] - lon) * kx
      const ay = (coords[2 * (start + i) + 1] - lat) * ky
      const bx = (coords[2 * (start + i + 1)] - lon) * kx
      const by = (coords[2 * (start + i + 1) + 1] - lat) * ky
      const dx = bx - ax
      const dy = by - ay
      const length = dx * dx + dy * dy
      const t = length > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0
      const px = ax + dx * t
      const py = ay + dy * t
      const score = Math.hypot(px, py) + handicap
      if (score < bestScore) {
        bestScore = score
        best = { edge: e, segment: i, t }
      }
    }
  }
  if (!best) return null

  // Où tombe le seuil, et à quelle part de la rue depuis son extrémité A.
  const { edge, segment, t } = best
  const start = graph.edgeCoordStart[edge]
  const count = graph.edgeCoordCount[edge]
  const at = (i) => [coords[2 * (start + i)], coords[2 * (start + i) + 1]]
  const a = at(segment)
  const b = at(segment + 1)
  const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  let before = 0
  let total = 0
  for (let i = 0; i + 1 < count; i += 1) {
    const d = haversineM(at(i), at(i + 1))
    if (i < segment) before += d
    if (i === segment) before += d * t
    total += d
  }
  return { edge, segment, t, point, share: total > 0 ? before / total : 0 }
}

/**
 * Le départ, devant la porte.
 *
 * @param graph  le graphe de la zone — jamais modifié
 * @param lon, lat  le point choisi
 * @param options.inMain  (nœud) → vrai s'il est relié au gros du réseau
 * @param options.mainMask  () → masque de la plus grande composante
 * @param options.sport  pour qualifier le raccord comme le reste du réseau
 * @returns `{ graph, start, reachM }` — le graphe à employer, le nœud d'où
 *   part la boucle, la longueur du raccord (0 sans raccord) — ou `null` si le
 *   réseau est vide.
 */
export function openDoor(graph, lon, lat, { inMain = () => true, mainMask = null, sport = 'run' } = {}) {
  let spot = nearestSpot(graph, lon, lat)
  // La rue la plus proche est un îlot — une cour, un parking fermé que les
  // données ne relient à rien : on prend la plus proche de celles qui mènent
  // quelque part.
  if (spot && !inMain(graph.edgeA[spot.edge]) && mainMask) {
    const mask = mainMask()
    spot = nearestSpot(graph, lon, lat, (e) => mask[graph.edgeA[e]] === 1)
  }
  if (!spot) return null

  const here = [lon, lat]
  const e = spot.edge
  const along = graph.edgeLen[e] * spot.share

  // Le seuil : un carrefour existant s'il est tout près, sinon un point neuf.
  let doorNode = null
  if (along <= AT_NODE_M) doorNode = graph.edgeA[e]
  else if (graph.edgeLen[e] - along <= AT_NODE_M) doorNode = graph.edgeB[e]
  const doorPoint = doorNode !== null ? graph.node(doorNode) : spot.point
  const reach = haversineM(here, doorPoint)
  const connect = reach > ON_STREET_M && reach <= MAX_REACH_M

  if (doorNode !== null && !connect) return { graph, start: doorNode, reachM: 0 }

  const n0 = graph.nodeCount
  const m0 = graph.edgeCount
  const nodes = []
  const edges = []
  const shapes = new Map()

  if (doorNode === null) {
    doorNode = n0 + nodes.length
    nodes.push(doorPoint)
    // La rue coupée en deux : la première moitié garde le numéro de l'arête,
    // la seconde est ajoutée. Les longueurs sont prises sur celle de la rue,
    // au prorata, pour que les deux moitiés fassent exactement le tout.
    const start = graph.edgeCoordStart[e]
    const count = graph.edgeCoordCount[e]
    const all = []
    for (let i = 0; i < count; i += 1) all.push([graph.coords[2 * (start + i)], graph.coords[2 * (start + i) + 1]])
    const cut = spot.segment + 1
    const first = all.slice(0, cut)
    const second = all.slice(cut)
    if (spot.t > 0) first.push(doorPoint)
    else first[first.length - 1] = doorPoint
    if (spot.t < 1) second.unshift(doorPoint)
    else second[0] = doorPoint
    shapes.set(e, first)
    shapes.set(m0 + edges.length, second)
    edges.push({
      a: doorNode,
      b: graph.edgeB[e],
      length: graph.edgeLen[e] - along,
      like: e,
      safety: graph.edgeSafety[e],
      name: graph.edgeName[e],
      tunnel: graph.edgeTunnel[e],
    })
  }

  let start = doorNode
  let connector = null
  if (connect) {
    start = n0 + nodes.length
    nodes.push(here)
    connector = m0 + edges.length
    shapes.set(connector, [here, doorPoint])
    edges.push({
      a: start,
      b: doorNode,
      length: reach,
      like: e,
      // L'allée, le bout de trottoir : ni trafic ni nom. Une voie piétonne en
      // ville, pour la note comme pour les poids — et, de toute façon, le seul
      // chemin possible pour sortir.
      safety: evaluateEdge({ highway: 'footway' }, { inBuiltup: true, sport }),
      name: null,
      tunnel: 0,
    })
  }

  const g = new DoorGraph()
  const grow = (Type, base, extra) => {
    const out = new Type(base.length + extra.length)
    out.set(base)
    out.set(extra, base.length)
    return out
  }
  g.nodeLon = grow(Float64Array, graph.nodeLon, nodes.map((p) => p[0]))
  g.nodeLat = grow(Float64Array, graph.nodeLat, nodes.map((p) => p[1]))
  g.edgeA = grow(Int32Array, graph.edgeA, edges.map((x) => x.a))
  g.edgeB = grow(Int32Array, graph.edgeB, edges.map((x) => x.b))
  g.edgeLen = grow(Float64Array, graph.edgeLen, edges.map((x) => x.length))
  g.edgeCoordStart = grow(Int32Array, graph.edgeCoordStart, edges.map((x) => graph.edgeCoordStart[x.like]))
  g.edgeCoordCount = grow(Int32Array, graph.edgeCoordCount, edges.map((x) => graph.edgeCoordCount[x.like]))
  g.edgeWayId = grow(Float64Array, graph.edgeWayId, edges.map((x) => graph.edgeWayId[x.like]))
  g.edgeTunnel = grow(Uint8Array, graph.edgeTunnel, edges.map((x) => x.tunnel))
  g.edgeSafety = graph.edgeSafety.concat(edges.map((x) => x.safety))
  g.edgeName = graph.edgeName.concat(edges.map((x) => x.name))
  if (shapes.has(e)) {
    g.edgeB[e] = doorNode
    g.edgeLen[e] = along
  }
  g.coords = graph.coords
  g.crossings = graph.crossings
  g.gates = graph.gates
  g.gatedEdges = graph.gatedEdges
  const splitGated = shapes.has(e) && graph.gatedEdges.has(e)
  if (splitGated) {
    // Une rue fermée par une barrière à l'un de ses bouts : seule la moitié
    // qui touche la barrière reste fermée.
    const gated = new Set(graph.gatedEdges)
    if (!graph.gates.has(graph.edgeA[e])) gated.delete(e)
    if (graph.gates.has(graph.edgeB[e])) gated.add(m0)
    g.gatedEdges = gated
  }
  g.shapes = shapes
  g.door = {
    node: doorNode,
    start,
    connector,
    reachM: connect ? reach : 0,
    split: shapes.has(e) ? [e, m0] : null,
    splitGated,
  }
  g.link()
  return { graph: g, start, reachM: connect ? reach : 0 }
}

/**
 * Les rues signalées, reportées sur le graphe dérivé : la moitié ajoutée d'une
 * rue coupée partage le sort de l'autre.
 */
export function carryBlocked(graph, blocked) {
  if (!blocked || !graph.door?.split) return blocked
  const [cut, added] = graph.door.split
  if (!blocked.has(cut)) return blocked
  return new Set([...blocked, added])
}

/**
 * Les poids d'un profil, reportés sur le graphe dérivé.
 *
 * Un poids est une longueur multipliée par des facteurs propres à la voie : la
 * rue coupée en deux se partage le sien au prorata, et l'allée — seul chemin
 * pour sortir — pèse sa longueur.
 */
export function carryWeights(graph, weights) {
  const door = graph.door
  if (!door) return weights
  const out = new Float64Array(graph.edgeCount)
  out.set(weights)
  if (door.split) {
    const [cut, added] = door.split
    const whole = weights[cut]
    const total = graph.edgeLen[cut] + graph.edgeLen[added]
    out[cut] = total > 0 ? (whole * graph.edgeLen[cut]) / total : 0
    out[added] = total > 0 ? (whole * graph.edgeLen[added]) / total : 0
    // Le poids de la rue entière portait la barrière d'un de ses bouts : la
    // moitié qui n'y touche pas en est libérée.
    if (door.splitGated) {
      if (!graph.gatedEdges.has(cut)) out[cut] /= BLOCKED_FACTOR
      if (!graph.gatedEdges.has(added)) out[added] /= BLOCKED_FACTOR
    }
  }
  if (door.connector != null) out[door.connector] = graph.edgeLen[door.connector]
  return out
}

/** La longueur du raccord emprunté par ce tracé, ou 0. */
export function reachOf(graph, edges) {
  const connector = graph.door?.connector
  if (connector == null || edges[0] !== connector) return 0
  return graph.edgeLen[connector]
}
