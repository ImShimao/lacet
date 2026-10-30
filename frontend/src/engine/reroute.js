// Le recalcul en course : revenir sur la boucle quand on s'en est écarté.
//
// Un raté de virage, une rue barrée, une envie de passer par le parc : on se
// retrouve hors du tracé. Dire « reviens sur le tracé » ne suffit pas — encore
// faut-il savoir par où. Ce module cherche le chemin qui ramène sur la boucle,
// **en tenant la distance prévue** : c'est elle qu'on est sorti courir.
//
// **Où rejoindre ?** Chaque point de ce qui reste de la boucle est un candidat.
// Un seul Dijkstra depuis la position donne la distance jusqu'à tous. Pour
// chacun, on estime la sortie complète — déjà couru, plus le raccord, plus la
// fin de la boucle depuis ce point — et on retient celui qui tombe le plus
// près de la distance prévue, le raccord comptant un peu en plus : entre deux
// solutions aussi justes, la plus directe.
//
// Ce qui en découle, sans règle particulière :
// - après un simple écart dans une rue parallèle, on rejoint la boucle au plus
//   près, devant soi ;
// - après un raccourci, on revient chercher ce qu'on a sauté plutôt que de
//   rentrer avec un kilomètre de moins ;
// - après un grand détour, on coupe au plus court vers l'arrivée.
//
// Le chemin suit les mêmes préférences que la boucle — trottoirs, pistes,
// rues calmes — puisqu'il est calculé avec le même profil.
//
// **Rentrer au départ** (`home`) est l'autre geste : une blessure, un orage, la
// nuit qui tombe — on abandonne la distance, on veut sa porte. Le même Dijkstra
// depuis la position, mais vers le seuil de la porte seul, au moins coûteux
// pour le profil : le plus court chemin *sûr*, pas le plus court tout court.

import { BLOCK_RADIUS_M } from './blocked'
import { INF, dijkstra, nodeSequence, reconstruct } from './dijkstra'
import { carryWeights, nearestSpot, openDoor } from './door'
import { bearingDeg, haversineM } from './geo'
import { headings, pathSteps, turnOf } from './navigation'
import { pymod } from './py'

// Un point candidat tous les 25 m de boucle : assez fin pour rejoindre au bon
// carrefour, assez peu pour rester instantané sur 20 km.
const SAMPLE_M = 25
// Un point de la boucle doit tomber sur un carrefour du réseau pour qu'on y
// arrive : les points intermédiaires d'une rue courbe n'en sont pas.
const SNAP_M = 15
// Le poids du raccord lui-même, en plus de l'écart à la distance prévue.
const CONNECT_WEIGHT = 0.5
// Au-delà, on ne cherche plus : c'est qu'on est parti ailleurs, pas perdu.
const MAX_CONNECT_M = 5000
// Un raccord qui passe par la boucle un peu plus loin puis revient en arrière
// ferait faire l'aller-retour : on rejoindrait plutôt là où il la croise.
const SPUR_M = 400

const CARDINALS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest']

/**
 * Le chemin qui ramène sur la boucle.
 *
 * @param graph    le graphe de la zone
 * @param weights  les poids du profil (`profile.precompute(graph)`)
 * @param position [lon, lat] — là où l'on est
 * @param heading  le cap suivi, en degrés, pour dire « fais demi-tour » ; ou null
 * @param geometry le tracé suivi jusqu'ici
 * @param fromAlong où l'on a quitté ce tracé, en mètres depuis son début
 * @param travelledM la distance déjà courue
 * @param plannedM la distance prévue pour toute la sortie
 * @param blocked  les signalements `[lon, lat]` à contourner — dont celui qu'on
 *   vient de faire, qui a souvent déclenché ce recalcul
 * @param sport    pour qualifier le raccord jusqu'à la rue
 * @param home     [lon, lat] du départ pour y rentrer au plus court sûr, la
 *   distance prévue oubliée ; ou null pour finir la boucle
 * @returns `{ coords, connectM, joinIndex, steps }` ou `null` s'il n'y a pas de chemin.
 *   `coords` va de la position au point de jonction, `geometry[joinIndex]` —
 *   avec `home`, au départ, et `joinIndex` est la fin du tracé : rien ne suit ;
 *   `steps` sont les consignes du raccord, distances comptées depuis la position.
 */
export function planRejoin(
  area,
  areaWeights,
  { position, heading = null, geometry, fromAlong = 0, travelledM = 0, plannedM = null, blocked = [], sport = 'run', home = null },
) {
  if (!geometry || geometry.length < 2 || !position) return null

  // **D'où l'on est, pas du carrefour le plus proche.** Partir du carrefour,
  // c'était souvent partir de celui qu'on venait de passer : la première
  // consigne disait « fais demi-tour » alors que la rue continuait devant.
  // La rue est coupée à la position, comme au départ de la boucle (`door.js`),
  // et le chemin peut la prendre dans un sens ou dans l'autre.
  const door = openDoor(area, position[0], position[1], { sport })
  if (!door) return null
  const graph = door.graph
  const weights = carryWeights(graph, areaWeights)
  const source = door.start
  const lead = haversineM(position, graph.node(source))
  if (lead > MAX_LEAD_M) return null
  if (home) return towardHome(area, graph, weights, source, home, { position, heading, geometry, lead, sport })
  const threshold = graph.door?.node ?? source

  const cumulative = new Float64Array(geometry.length)
  for (let i = 1; i < geometry.length; i += 1) cumulative[i] = cumulative[i - 1] + haversineM(geometry[i - 1], geometry[i])
  const total = cumulative[geometry.length - 1]
  const planned = plannedM ?? total
  const beyond = obstacleAlong(geometry, cumulative, fromAlong, blocked)

  const tree = dijkstra(graph, source, weights, { maxDist: MAX_CONNECT_M, slack: 1 })
  const backwards = behind(graph, threshold, heading)

  const candidates = []
  // Les passages de la boucle par chaque carrefour — une boucle peut repasser
  // deux fois au même endroit.
  const visits = new Map()
  let lastAlong = -Infinity
  for (let i = 0; i < geometry.length; i += 1) {
    const along = cumulative[i]
    if (along < fromAlong) continue
    const finish = i === geometry.length - 1
    if (!finish && along - lastAlong < SAMPLE_M) continue
    // Les carrefours du réseau de la zone : le seuil posé à l'instant n'en est
    // pas un, et les numéros sont les mêmes dans les deux graphes.
    const node = area.nearestNode(geometry[i][0], geometry[i][1], SNAP_M)
    if (node === null) continue
    lastAlong = along
    if (!visits.has(node)) visits.set(node, [])
    visits.get(node).push(along)
    // Rejoindre la boucle avant l'obstacle, ce serait y retourner.
    if (along <= beyond) continue
    const d = tree.dist[node]
    if (d === INF) continue
    const estimate = travelledM + lead + d + (total - along)
    const turnBack = backwards.size && backwards.has(firstEdgeFrom(tree, node, threshold)) ? TURN_BACK_COST_M : 0
    candidates.push({
      index: i,
      node,
      along,
      connectM: d,
      score: Math.abs(estimate - planned) + CONNECT_WEIGHT * d + turnBack,
    })
  }
  candidates.sort((a, b) => a.score - b.score || a.along - b.along)

  for (const best of candidates.slice(0, 25)) {
    const edges = reconstruct(tree, best.node)
    if (!edges) continue
    const nodes = nodeSequence(graph, source, edges)
    const spur = nodes
      .slice(0, -1)
      .some((n) => (visits.get(n) ?? []).some((a) => a > best.along && a - best.along <= SPUR_M))
    if (spur) continue
    return connection(graph, source, edges, best, { position, heading, geometry, lead, sport })
  }
  return null
}

// Au-delà, on n'est plus sur un chemin qu'on a quitté : on est ailleurs.
const MAX_LEAD_M = 400

/**
 * Rentrer au départ : le chemin le moins coûteux pour le profil jusqu'au seuil
 * de la porte — un raccord par la rue signalée pèse quatre cents fois sa
 * longueur, une départementale à 80 bien plus qu'une rue calme.
 *
 * Le seuil est rarement un carrefour : la boucle part du trottoir, au milieu de
 * la rue (`door.js`). Viser le carrefour le plus proche, c'était passer devant
 * la porte pour aller au coin, puis revenir. On vise le point de la rue
 * lui-même, par celui de ses deux bouts qui coûte le moins.
 */
function towardHome(area, graph, weights, source, home, { position, heading, geometry, lead, sport }) {
  const spot = nearestSpot(area, home[0], home[1])
  if (!spot) return null
  // La position a pu couper la même rue : la porte tombe alors sur l'une des
  // deux moitiés, et sa distance se compte depuis le bout de celle-ci.
  let e = spot.edge
  let offset = area.edgeLen[e] * spot.share
  const split = graph.door?.split
  if (split && split[0] === e && offset > graph.edgeLen[e]) {
    offset -= graph.edgeLen[e]
    e = split[1]
  }
  const tree = dijkstra(graph, source, weights)
  const length = graph.edgeLen[e]
  const share = length > 0 ? Math.min(1, offset / length) : 0
  const [a, b] = [graph.edgeA[e], graph.edgeB[e]]
  // Les sens uniques, comme dans `dijkstra` : 1 se prend depuis A, -1 depuis B.
  const sens = graph.edgeOneway[e]
  const viaA = sens < 0 ? INF : tree.cost[a] + weights[e] * share
  const viaB = sens > 0 ? INF : tree.cost[b] + weights[e] * (1 - share)
  if (viaA === INF && viaB === INF) return null
  const end = viaA <= viaB ? a : b
  const edges = reconstruct(tree, end)
  if (!edges) return null
  // La porte sur un carrefour : sa rue n'est pas à prendre, on y est.
  const lastM = end === a ? share * length : (1 - share) * length
  const onStreet = lastM > 1
  if (onStreet) edges.push(e)
  const best = { index: geometry.length - 1, connectM: tree.dist[end] + (onStreet ? lastM : 0) }
  return connection(graph, source, edges, best, {
    position, heading, geometry, lead, sport, home: true, lastM: onStreet ? lastM : null,
  })
}

// Ce que coûte un demi-tour dans le choix de la jonction, en mètres : à
// distance à peu près égale, on continue devant soi plutôt que de faire volte-
// face — mais on fait demi-tour quand c'est vraiment plus juste.
const TURN_BACK_COST_M = 120
const BEHIND_DEG = 110

/**
 * Les moitiés de rue qui partent derrière soi, depuis le seuil.
 *
 * Rien sans cap connu : on ne sait pas alors ce qui est devant.
 */
function behind(graph, node, heading) {
  const out = new Set()
  if (heading == null) return out
  for (let k = graph.adjOffset[node]; k < graph.adjOffset[node + 1]; k += 1) {
    const e = graph.adjEdges[k]
    if (e === graph.door?.connector) continue
    const [bearing] = headings(graph.coordsFrom(e, node))
    if (Math.abs(pymod(bearing - heading + 180, 360) - 180) > BEHIND_DEG) out.add(e)
  }
  return out
}

/** L'arête par laquelle le chemin vers `node` quitte le seuil. */
function firstEdgeFrom(tree, node, threshold) {
  let cur = node
  let guard = 0
  while (tree.prevNode[cur] >= 0 && tree.prevNode[cur] !== threshold && guard < 100_000) {
    cur = tree.prevNode[cur]
    guard += 1
  }
  return tree.prevNode[cur] === threshold ? tree.prevEdge[cur] : -1
}

/**
 * Le point de la boucle au-delà duquel il faut la rejoindre.
 *
 * Un signalement qui tombe sur la suite du parcours — le portail qu'on vient de
 * trouver fermé — n'est contourné qu'à condition de rejoindre la boucle
 * **après** lui : la rejoindre avant, c'était y être renvoyé. On ne regarde que
 * les six cents mètres qui suivent : un vieux signalement à l'autre bout de la
 * boucle ne doit pas en faire sauter la moitié.
 */
function obstacleAlong(geometry, cumulative, fromAlong, blocked) {
  let beyond = -Infinity
  if (!blocked?.length) return beyond
  for (let i = 0; i < geometry.length; i += 1) {
    const along = cumulative[i]
    if (along < fromAlong - OBSTACLE_BEHIND_M) continue
    if (along > fromAlong + OBSTACLE_AHEAD_M) break
    if (blocked.some((p) => haversineM(p, geometry[i]) <= BLOCK_RADIUS_M)) beyond = Math.max(beyond, along)
  }
  return beyond
}

const OBSTACLE_AHEAD_M = 600
// Un peu en arrière aussi : on signale souvent l'obstacle après avoir
// rebroussé chemin, et « l'endroit où l'on a quitté le tracé » est alors en
// deçà de lui.
const OBSTACLE_BEHIND_M = 150

/**
 * Le raccord : sa géométrie, sa longueur et ses consignes.
 *
 * `lastM` : la dernière arête ne se prend que sur ce nombre de mètres — la rue
 * de la porte, jusqu'au seuil.
 */
function connection(graph, source, edges, best, { position, heading, geometry, lead, sport = 'run', home = false, lastM = null }) {
  const coords = [position]
  const sourceCoord = graph.node(source)
  if (lead > 1) coords.push(sourceCoord)
  let cursor = source
  edges.forEach((e, k) => {
    let c = graph.coordsFrom(e, cursor)
    if (lastM !== null && k === edges.length - 1) c = upTo(c, lastM)
    for (let i = 1; i < c.length; i += 1) coords.push(c[i])
    cursor = graph.other(e, cursor)
  })
  const goal = home ? 'rentrer' : 'rejoindre le parcours'
  const connectM = lead + best.connectM
  // L'allée jusqu'à la rue n'a pas de nom : c'est la rue qu'on nomme.
  const connector = graph.door?.connector
  const street = edges.find((e) => e !== connector)
  const firstRoad = street !== undefined ? graph.edgeName[street] : null
  // La direction se lit sur la rue, pas sur les quelques mètres pour l'atteindre.
  const onStreet = connector != null && edges[0] === connector ? coords.slice(1) : coords

  const steps = []
  if (coords.length >= 2 && connectM >= 10) {
    const [departure] = headings(onStreet.length >= 2 ? onStreet : coords)
    if (heading != null) {
      const angle = pymod(departure - heading + 180, 360) - 180
      const { turn, text } = turnOf(angle, firstRoad)
      steps.push(step(0, turn, `${text} pour ${goal}.`, coords[0], firstRoad))
    } else {
      const words = CARDINALS[Math.trunc(pymod(departure + 22.5, 360) / 45)]
      steps.push(step(0, 'start', `Pars vers ${words}${firstRoad ? ` sur ${firstRoad}` : ''} pour ${goal}.`, coords[0], firstRoad))
    }
    // Le virage sur la rue, au bout de l'allée, est celui que la première
    // consigne vient de dire : pas de seconde annonce trois mètres plus loin.
    const quiet = onStreet !== coords ? graph.door.node : null
    for (const s of pathSteps(graph, source, edges, quiet, sport)) steps.push({ ...s, dist_m: Math.round((s.dist_m + lead) * 10) / 10 })
  }

  // La jonction elle-même : dans quel sens repartir sur la boucle.
  const finish = best.index === geometry.length - 1
  if (!finish) {
    const arrival = coords.length >= 2 ? headings(coords)[1] : heading
    const ahead = advanceAlong(geometry, best.index, 20)
    const onward = bearingDeg(geometry[best.index], ahead)
    const angle = arrival == null ? 0 : pymod(onward - arrival + 180, 360) - 180
    const { turn, text } = turnOf(angle)
    steps.push(
      step(
        Math.round(connectM * 10) / 10,
        turn,
        turn === 'straight' ? 'Tu retrouves le parcours. Continue tout droit.' : `${text} : tu retrouves le parcours.`,
        geometry[best.index],
        null,
      ),
    )
  }

  return { coords, connectM, joinIndex: best.index, steps }
}

const step = (distM, turn, text, [lon, lat], road) => ({
  dist_m: distM, turn, angle: 0, road, text, lon, lat, caution: false,
})

/** Le point situé `metres` plus loin sur la géométrie, depuis le sommet `index`. */
const advanceAlong = (geometry, index, metres) => upTo(geometry.slice(index), metres).at(-1)

/** Le début d'une ligne, sur `metres`, coupé au point exact ; toute la ligne si elle est plus courte. */
function upTo(line, metres) {
  const out = [line[0]]
  let left = metres
  for (let i = 1; i < line.length; i += 1) {
    const [a, b] = [line[i - 1], line[i]]
    const d = haversineM(a, b)
    if (d >= left && d > 0) {
      const t = left / d
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      return out
    }
    out.push(b)
    left -= d
  }
  return out
}
