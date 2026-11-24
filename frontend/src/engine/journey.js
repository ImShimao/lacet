// D'un point à un autre : aller courir jusqu'au travail, rentrer d'une gare, rejoindre
// des amis au parc.
//
// Une boucle revient à la porte ; un trajet va de A à B. Le reste ne change pas :
// le même réseau, la même note A, B ou C, les mêmes consignes à la voix, le même
// relief. Propre à l'app — le moteur Python ne fait que des boucles —, donc hors
// de la parité, comme `door.js`.
//
// **Trois chemins, pas un.** Entre deux points, il n'y a pas de distance à tenir :
// ce qui se choisit, c'est ce qu'on accepte de détour pour être tranquille. Le
// plus sûr suit le profil « Sûr » (trottoirs, pistes, rues calmes, grands axes
// évités) ; l'équilibré le profil « Standard » ; le plus direct ne regarde que les
// mètres. Chacun reçoit sa note : on voit d'un coup d'œil ce que coûte, en
// sécurité, le kilomètre gagné. Deux chemins identiques n'en font qu'un.
//
// **L'aller-retour (`roundtrip`) revient par d'autres rues.** On court jusqu'à B
// puis on rentre : refaire le même chemin en sens inverse, c'est une demi-sortie
// vue deux fois. Le retour est cherché avec les rues de l'aller rendues
// `REUSE_FACTOR` fois plus chères : il les reprend seulement quand il n'y a pas
// d'autre passage (un pont, une impasse), et la note juge le tout.
//
// **Le trajet allongé (`stretch`) tient une distance ou une durée.** B est à
// 3 km, mais on veut en courir 15 : le chemin passe par un point choisi sur
// une ellipse dont A et B sont les foyers — tout point de l'ellipse met A et B
// à la même somme de distances —, puis l'ellipse grandit ou rétrécit jusqu'à
// ce que le chemin réel tombe sur la longueur demandée. Plusieurs côtés sont
// essayés ; les meilleurs, de directions différentes, sont proposés.
//
// **La zone chargée est un disque autour de A qui contient B**, et non le
// rectangle des deux : c'est celle que le recalcul en course (`planDetour`)
// redemande à partir de la même demande, et il retrouve ainsi le même graphe.

import { INF, dijkstra, nodeSequence, reconstruct } from './dijkstra'
import { blockedEdges, insideRing, withZones } from './blocked'
import { ELEVATION_STEP_M, fetchMany, isNight, shapeRelief } from './environment'
import { bearingDeg, haversineM, resample } from './geo'
import { PlanningError, graphRequest, matchedRoute, normalizeRequest } from './service'
import { BLOCKED_FACTOR, buildProfile } from './weights'

/** Au-delà, à vol d'oiseau, ce n'est plus une sortie mais un voyage. */
export const MAX_JOURNEY_M = { run: 20_000, bike: 30_000 }
// En dessous, A et B sont le même endroit.
const MIN_JOURNEY_M = 300
// Un point posé à plus de ça d'une rue n'est pas un départ, c'est un champ.
const SNAP_M = 400
// Le prix d'une rue déjà courue à l'aller, pour le retour : assez pour qu'un
// détour de deux ou trois fois sa longueur passe avant, pas assez pour faire
// d'un pont unique un mur.
const REUSE_FACTOR = 4

// Ce que les rues ajoutent, en moyenne, au vol d'oiseau : le premier essai.
const ROAD_FACTOR = 1.25
// Écart toléré entre la longueur demandée et celle du chemin trouvé.
const STRETCH_TOLERANCE = 0.08
// Les côtés de l'ellipse essayés, en degrés depuis l'axe A → B : les flancs
// d'abord, qui éloignent le plus du trajet direct.
const STRETCH_ANGLES = [90, 270, 50, 130, 230, 310]
const CARDINALS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest']

export const JOURNEY_VARIANTS = [
  { key: 'safe', label: 'Le plus sûr' },
  { key: 'balanced', label: 'Équilibré' },
  { key: 'direct', label: 'Le plus direct' },
]

/**
 * La demande d'un trajet, mise dans la forme d'une recherche de boucle : c'est
 * elle que garde le résultat, et elle que le recalcul en course relira. La
 * « distance » n'est pas une cible, mais la taille du disque à charger : une
 * boucle de cette longueur s'éloigne d'autant que B, plus un kilomètre de marge.
 */
export function journeyRequest(input) {
  const to = input?.to
  if (!Number.isFinite(to?.lat) || !Number.isFinite(to?.lon)) throw new PlanningError('Choisis une arrivée.')
  const crow = haversineM([input.lon, input.lat], [to.lon, to.lat])
  const sport = input.sport ?? 'run'
  if (crow < MIN_JOURNEY_M) throw new PlanningError("L'arrivée est au départ : pour revenir à ta porte, cherche une boucle.")
  if (crow > MAX_JOURNEY_M[sport]) {
    const km = Math.round(MAX_JOURNEY_M[sport] / 1000)
    throw new PlanningError(`Arrivée trop loin : ${km} km au plus à vol d'oiseau ${sport === 'bike' ? 'à vélo' : 'à pied'}.`)
  }
  const roundtrip = Boolean(input.roundtrip)
  // La longueur voulue, lue comme pour une boucle (distance, ou durée à l'allure).
  let target = null
  if (input.stretch && !roundtrip) {
    target = normalizeRequest({ ...input, to: undefined }).distance_km * 1000
    if (target < crow * 1.15) {
      const km = (crow / 1000).toFixed(1).replace('.', ',')
      throw new PlanningError(`L'arrivée est déjà à ${km} km à vol d'oiseau : demande plus long, ou « Au plus court ».`)
    }
  }
  // Le disque doit contenir l'ellipse : son point le plus loin de A en est à a + c.
  const far = target ? (target / ROAD_FACTOR + crow) / 2 : crow
  const reach = (2 * (far + 1000)) / 1.1 / 1000
  const req = normalizeRequest({ ...input, distance_km: Math.ceil(reach * 10) / 10, duration_min: null, tolerance: 0.1 })
  const label = typeof to.label === 'string' && to.label.trim() ? to.label.trim().slice(0, 60) : null
  return { req, to: { lat: to.lat, lon: to.lon }, label, crow, roundtrip, target }
}

/**
 * Les zones à éviter que le trajet peut vraiment contourner : toutes, sauf
 * celle où l'on part et celle où l'on arrive — il faut bien en sortir, ou y
 * entrer.
 */
function closedZones(graph, req, to) {
  const ends = [
    [req.lon, req.lat],
    [to.lon, to.lat],
  ]
  const holds = (z, p) => (z.polygon ? insideRing(p, z.polygon) : haversineM(p, [z.lon, z.lat]) <= z.radius_m)
  return withZones(graph, null, (req.zones ?? []).filter((z) => !ends.some((p) => holds(z, p))))
}

/**
 * Les poids de chaque variante. Les signalements pèsent dans toutes ; les rues
 * d'une zone à éviter y sont fermées. Un poids seulement lourd ne suffit pas :
 * le plus direct, ou le passage d'un trajet allongé, y entrait quand le détour
 * coûtait plus cher que la pénalité.
 */
function variantWeights(graph, key, req, night, blocked, closed) {
  let out
  if (key === 'direct') {
    out = Float64Array.from(graph.edgeLen)
    for (const e of blocked) out[e] *= BLOCKED_FACTOR
    for (const e of graph.gatedEdges ?? []) out[e] *= BLOCKED_FACTOR
  } else {
    out = Float64Array.from(
      buildProfile(req.surface, key === 'safe' ? 'safe' : 'standard', night, req.sport, {
        avoid: req.avoid,
        blocked,
        carfree: req.carfree,
        nature: req.nature,
        side: req.side,
      }).precompute(graph),
    )
  }
  for (const e of closed ?? []) out[e] = Infinity
  return out
}

// Moins de nœuds atteints que ça depuis le départ : on est sur un quai, une
// cour fermée ou un bout de piste isolé, pas dans le réseau des rues.
const ISLAND = 500

/** Les nœuds qu'on atteint depuis `from`, en masque pour `nearestNode`. */
function reachable(graph, from, weights) {
  const tree = dijkstra(graph, from, weights, { slack: 1 })
  const mask = new Uint8Array(graph.nodeCount)
  for (const n of tree.reached) mask[n] = 1
  return { mask, size: tree.reached.length }
}

/**
 * Le départ et l'arrivée, accrochés à des nœuds **reliés entre eux**.
 *
 * Le nœud le plus proche ne suffit pas : à Paris, une arrivée posée près d'une
 * gare s'accrochait à « Voie B/4 », un quai sans lien avec les rues, et aucun
 * chemin n'existait. On cherche donc l'arrivée parmi ce que le départ atteint —
 * et si le départ est lui-même sur un îlot, on le cherche parmi ce que l'arrivée
 * atteint.
 */
function endpoints(graph, req, to, weights) {
  let source = graph.nearestNode(req.lon, req.lat, SNAP_M)
  if (source === null) throw new PlanningError('Pas de rue connue près du départ.')
  let reach = reachable(graph, source, weights)
  if (reach.size < ISLAND) {
    const near = graph.nearestNode(to.lon, to.lat, SNAP_M)
    if (near !== null) {
      const fromB = reachable(graph, near, weights)
      const other = fromB.size >= ISLAND ? graph.nearestNode(req.lon, req.lat, SNAP_M, fromB.mask) : null
      if (other !== null) {
        source = other
        reach = reachable(graph, source, weights)
      }
    }
  }
  const target = graph.nearestNode(to.lon, to.lat, SNAP_M, reach.mask)
  if (target === null) throw new PlanningError("Pas de rue reliée au départ près de l'arrivée.")
  if (target === source) throw new PlanningError("L'arrivée est au départ : pour revenir à ta porte, cherche une boucle.")
  return { source, target, reach: reach.mask }
}

function pathLength(graph, edges) {
  let m = 0
  for (const e of edges) m += graph.edgeLen[e]
  return m
}

/**
 * Les chemins de A à B qui passent par un point de l'ellipse, à la longueur
 * voulue. Chaque côté s'ajuste en quelques essais : la longueur trouvée corrige
 * la taille de l'ellipse, en proportion.
 */
function stretchedPaths(graph, source, target, weights, wanted, mask) {
  const a0 = graph.node(source)
  const b0 = graph.node(target)
  const kx = 111_320 * Math.cos((a0[1] * Math.PI) / 180)
  const ky = 110_540
  const bx = (b0[0] - a0[0]) * kx
  const by = (b0[1] - a0[1]) * ky
  const c = Math.hypot(bx, by) / 2
  const ux = bx / (2 * c)
  const uy = by / (2 * c)
  const out = []
  for (const angle of STRETCH_ANGLES) {
    const t = (angle * Math.PI) / 180
    let sum = wanted / ROAD_FACTOR
    let best = null
    for (let tries = 0; tries < 4; tries += 1) {
      const a = Math.max(sum / 2, c * 1.02)
      const b = Math.sqrt(a * a - c * c)
      const x = bx / 2 + a * Math.cos(t) * ux - b * Math.sin(t) * uy
      const y = by / 2 + a * Math.cos(t) * uy + b * Math.sin(t) * ux
      const via = graph.nearestNode(a0[0] + x / kx, a0[1] + y / ky, SNAP_M * 2, mask)
      if (via === null || via === source || via === target) break
      const there = dijkstra(graph, source, weights, { target: via, slack: 1 })
      if (there.dist[via] === INF) break
      const first = reconstruct(there, via)
      const second = returnEdges(graph, via, target, weights, first)
      if (!first?.length || !second) break
      const edges = [...first, ...second]
      const length = pathLength(graph, edges)
      const error = Math.abs(length - wanted) / wanted
      if (!best || error < best.error) best = { edges, error, via }
      if (error <= STRETCH_TOLERANCE) break
      sum *= wanted / length
    }
    if (best && best.error <= STRETCH_TOLERANCE * 2) out.push(best)
  }
  // Les plus justes d'abord ; deux chemins par le même côté n'en font qu'un.
  out.sort((p, q) => p.error - q.error)
  const kept = []
  for (const p of out) {
    const side = Math.round(bearingDeg(graph.node(source), graph.node(p.via)) / 45) % 8
    const path = p.edges.join(',')
    if (kept.some((k) => k.side === side || k.path === path)) continue
    kept.push({ key: 'stretch', side, label: `Par ${CARDINALS[side]}`, path, edges: p.edges, nodes: nodeSequence(graph, source, p.edges) })
    if (kept.length === 3) break
  }
  return kept
}

/** Le retour de B vers A, les rues de l'aller rendues plus chères. */
function returnEdges(graph, from, to, weights, outbound) {
  const w = Float64Array.from(weights)
  for (const e of outbound) w[e] *= REUSE_FACTOR
  const tree = dijkstra(graph, from, w, { target: to, slack: 1 })
  if (tree.dist[to] === INF) return null
  const edges = reconstruct(tree, to)
  return edges?.length ? edges : null
}

/** La géométrie d'un chemin, de nœud en nœud. */
function geometryOf(graph, start, edges) {
  const out = []
  let cur = start
  for (const e of edges) {
    const coords = graph.coordsFrom(e, cur)
    for (const c of out.length ? coords.slice(1) : coords) out.push(c)
    cur = graph.other(e, cur)
  }
  return out
}

/**
 * Les chemins de A à B, notés et décrits comme des boucles.
 *
 * @param input  la demande d'une boucle, plus `to: {lat, lon}`
 * @param deps.loadGraph  comme pour `planLoops`
 * @returns `{ routes, rejected: [], meta }` — la forme d'une recherche, pour que
 *   l'écran, l'enregistrement et le guidage n'aient rien à apprendre
 */
export async function planJourney(input, { loadGraph, fetchElevations = fetchMany, now = () => new Date(), onProgress = () => {} }) {
  const started = performance.now()
  const { req, to, label, crow, roundtrip, target: wanted } = journeyRequest(input)
  const graph = await loadGraph(graphRequest({ ...input, distance_km: req.distance_km, duration_min: null }))
  onProgress('routing', 0)

  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  const blocked = withZones(graph, blockedEdges(graph, req.blocked), req.zones) ?? new Set()
  const closed = closedZones(graph, req, to)
  const direct = variantWeights(graph, 'direct', req, night, blocked, closed)
  const { source, target, reach } = endpoints(graph, req, to, direct)

  const found = wanted
    ? stretchedPaths(graph, source, target, variantWeights(graph, 'safe', req, night, blocked, closed), wanted, reach)
    : []
  for (const variant of wanted ? [] : JOURNEY_VARIANTS) {
    const weights = variant.key === 'direct' ? direct : variantWeights(graph, variant.key, req, night, blocked, closed)
    const tree = dijkstra(graph, source, weights, { target, slack: 1 })
    if (tree.dist[target] === INF) continue
    let edges = reconstruct(tree, target)
    if (!edges?.length) continue
    if (roundtrip) {
      const back = returnEdges(graph, target, source, weights, edges)
      if (!back) continue
      edges = [...edges, ...back]
    }
    const path = edges.join(',')
    if (found.some((f) => f.path === path)) continue
    found.push({ ...variant, path, edges, nodes: nodeSequence(graph, source, edges) })
  }
  if (!found.length && wanted) throw new PlanningError("Pas de chemin de cette longueur vers l'arrivée : essaie un peu plus court, ou plus long.")
  if (!found.length) throw new PlanningError("Aucun chemin praticable entre ces deux points : un fleuve, une autoroute ou une zone évitée les sépare.")

  // Le relief de tous les chemins en une seule demande.
  onProgress('elevation', 0)
  const geometries = found.map((f) => geometryOf(graph, source, f.edges))
  let reliefs = []
  if (req.with_elevation) {
    try {
      reliefs = await fetchElevations(geometries.map((g) => resample(g, ELEVATION_STEP_M).map(([, c]) => c)))
    } catch {
      reliefs = [] // sans relief, les chemins restent justes
    }
  }

  const routes = found.map((f, i) => {
    const relief = reliefs?.[i]
    let elev = null
    if (relief?.values?.length) {
      const { values, threshold } = shapeRelief(relief, ELEVATION_STEP_M)
      elev = [values, null, threshold, ELEVATION_STEP_M]
    }
    // Le nom dit la variante et où elle mène : c'est lui qu'on relit en favori.
    const where = label ? ` vers ${label}` : ''
    // Un chemin allongé a déjà son côté au-dessus du nom, sur sa carte : le nom
    // dit seulement où il mène.
    const name = f.key === 'stretch' && label ? `Vers ${label}` : roundtrip ? `${f.label}${where} et retour` : `${f.label}${where}`
    const route = matchedRoute(graph, source, f, { req, name, elev, night })
    // L'identifiant d'une boucle : la variante et la longueur, pour qu'un trajet
    // gardé en favori ne prenne pas la place d'un autre.
    const { imported, matched, ...plain } = route
    const id = `${roundtrip ? 'aba' : 'ab'}-${f.key}${f.side ?? ''}-${Math.trunc(route.distance_m)}`
    return { ...plain, id, journey: f.key, destination: to, ...(roundtrip ? { roundtrip: true } : {}) }
  })

  return {
    routes,
    rejected: [],
    meta: {
      journey: true,
      roundtrip,
      stretched: Boolean(wanted),
      night,
      crow_m: Math.round(crow),
      graph_nodes: graph.nodeCount,
      elapsed_s: Math.round((performance.now() - started) / 10) / 100,
      engine: 'local',
    },
  }
}
