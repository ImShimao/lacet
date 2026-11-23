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
// **La zone chargée est un disque autour de A qui contient B**, et non le
// rectangle des deux : c'est celle que le recalcul en course (`planDetour`)
// redemande à partir de la même demande, et il retrouve ainsi le même graphe.

import { INF, dijkstra, nodeSequence, reconstruct } from './dijkstra'
import { blockedEdges, withZones } from './blocked'
import { ELEVATION_STEP_M, fetchMany, isNight, shapeRelief } from './environment'
import { haversineM, resample } from './geo'
import { PlanningError, graphRequest, matchedRoute, normalizeRequest } from './service'
import { BLOCKED_FACTOR, buildProfile } from './weights'

/** Au-delà, à vol d'oiseau, ce n'est plus une sortie mais un voyage. */
export const MAX_JOURNEY_M = { run: 20_000, bike: 30_000 }
// En dessous, A et B sont le même endroit.
const MIN_JOURNEY_M = 300
// Un point posé à plus de ça d'une rue n'est pas un départ, c'est un champ.
const SNAP_M = 400

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
  const reach = (2 * (crow + 1000)) / 1.1 / 1000
  const req = normalizeRequest({ ...input, distance_km: Math.ceil(reach * 10) / 10, duration_min: null, tolerance: 0.1 })
  const label = typeof to.label === 'string' && to.label.trim() ? to.label.trim().slice(0, 60) : null
  return { req, to: { lat: to.lat, lon: to.lon }, label, crow }
}

/** Les poids de chaque variante. Les zones et les signalements pèsent dans toutes. */
function variantWeights(graph, key, req, night, blocked) {
  if (key === 'direct') {
    const out = Float64Array.from(graph.edgeLen)
    for (const e of blocked) out[e] *= BLOCKED_FACTOR
    for (const e of graph.gatedEdges ?? []) out[e] *= BLOCKED_FACTOR
    return out
  }
  return buildProfile(req.surface, key === 'safe' ? 'safe' : 'standard', night, req.sport, {
    avoid: req.avoid,
    blocked,
    carfree: req.carfree,
    nature: req.nature,
    side: req.side,
  }).precompute(graph)
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
  return { source, target }
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
  const { req, to, label, crow } = journeyRequest(input)
  const graph = await loadGraph(graphRequest({ ...input, distance_km: req.distance_km, duration_min: null }))
  onProgress('routing', 0)

  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  const blocked = withZones(graph, blockedEdges(graph, req.blocked), req.zones) ?? new Set()
  const { source, target } = endpoints(graph, req, to, variantWeights(graph, 'direct', req, night, blocked))

  const found = []
  for (const variant of JOURNEY_VARIANTS) {
    const tree = dijkstra(graph, source, variantWeights(graph, variant.key, req, night, blocked), { target, slack: 1 })
    if (tree.dist[target] === INF) continue
    const edges = reconstruct(tree, target)
    if (!edges?.length) continue
    const path = edges.join(',')
    if (found.some((f) => f.path === path)) continue
    found.push({ ...variant, path, edges, nodes: nodeSequence(graph, source, edges) })
  }
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
    const name = label ? `${f.label} vers ${label}` : f.label
    const route = matchedRoute(graph, source, f, { req, name, elev, night })
    // L'identifiant d'une boucle : la variante et la longueur, pour qu'un trajet
    // gardé en favori ne prenne pas la place d'un autre.
    const { imported, matched, ...plain } = route
    return { ...plain, id: `ab-${f.key}-${Math.trunc(route.distance_m)}`, journey: f.key, destination: to }
  })

  return {
    routes,
    rejected: [],
    meta: {
      journey: true,
      night,
      crow_m: Math.round(crow),
      graph_nodes: graph.nodeCount,
      elapsed_s: Math.round((performance.now() - started) / 10) / 100,
      engine: 'local',
    },
  }
}
