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

import { INF, dijkstra, nodeSequence, reconstruct } from './dijkstra'
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
 * @returns `{ coords, connectM, joinIndex, steps }` ou `null` s'il n'y a pas de chemin.
 *   `coords` va de la position au point de jonction, `geometry[joinIndex]` ;
 *   `steps` sont les consignes du raccord, distances comptées depuis la position.
 */
export function planRejoin(graph, weights, { position, heading = null, geometry, fromAlong = 0, travelledM = 0, plannedM = null }) {
  if (!geometry || geometry.length < 2 || !position) return null
  const source = graph.nearestNode(position[0], position[1], 400)
  if (source === null) return null
  const lead = haversineM(position, graph.node(source))

  const cumulative = new Float64Array(geometry.length)
  for (let i = 1; i < geometry.length; i += 1) cumulative[i] = cumulative[i - 1] + haversineM(geometry[i - 1], geometry[i])
  const total = cumulative[geometry.length - 1]
  const planned = plannedM ?? total

  const tree = dijkstra(graph, source, weights, { maxDist: MAX_CONNECT_M, slack: 1 })

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
    const node = graph.nearestNode(geometry[i][0], geometry[i][1], SNAP_M)
    if (node === null) continue
    lastAlong = along
    if (!visits.has(node)) visits.set(node, [])
    visits.get(node).push(along)
    const d = tree.dist[node]
    if (d === INF) continue
    const estimate = travelledM + lead + d + (total - along)
    candidates.push({ index: i, node, along, connectM: d, score: Math.abs(estimate - planned) + CONNECT_WEIGHT * d })
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
    return connection(graph, source, edges, best, { position, heading, geometry, lead })
  }
  return null
}

/** Le raccord : sa géométrie, sa longueur et ses consignes. */
function connection(graph, source, edges, best, { position, heading, geometry, lead }) {
  const coords = [position]
  const sourceCoord = graph.node(source)
  if (lead > 1) coords.push(sourceCoord)
  let cursor = source
  for (const e of edges) {
    const c = graph.coordsFrom(e, cursor)
    for (let k = 1; k < c.length; k += 1) coords.push(c[k])
    cursor = graph.other(e, cursor)
  }
  const connectM = lead + best.connectM
  const firstRoad = edges.length ? graph.edgeName[edges[0]] : null

  const steps = []
  if (coords.length >= 2 && connectM >= 10) {
    const [departure] = headings(coords)
    if (heading != null) {
      const angle = pymod(departure - heading + 180, 360) - 180
      const { turn, text } = turnOf(angle, firstRoad)
      steps.push(step(0, turn, `${text} pour rejoindre le parcours.`, coords[0], firstRoad))
    } else {
      const words = CARDINALS[Math.trunc(pymod(departure + 22.5, 360) / 45)]
      steps.push(step(0, 'start', `Pars vers ${words}${firstRoad ? ` sur ${firstRoad}` : ''} pour rejoindre le parcours.`, coords[0], firstRoad))
    }
    for (const s of pathSteps(graph, source, edges)) steps.push({ ...s, dist_m: Math.round((s.dist_m + lead) * 10) / 10 })
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
function advanceAlong(geometry, index, metres) {
  let left = metres
  for (let i = index; i < geometry.length - 1; i += 1) {
    const d = haversineM(geometry[i], geometry[i + 1])
    if (d >= left && d > 0) {
      const t = left / d
      const [a, b] = [geometry[i], geometry[i + 1]]
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    left -= d
  }
  return geometry[geometry.length - 1]
}
