// Reconnaître, dans une trace, les rues qu'elle emprunte.
//
// Un fichier GPX donne une suite de points et rien d'autre. Tant qu'on ne sait
// pas **quelles rues** ces points suivent, on ne peut ni nommer un virage, ni
// dire s'il y a un trottoir, ni repérer une traversée : le parcours importé
// restait donc muet et sans note. Ce module fait le lien.
//
// **Le problème n'est pas de coller au plus près.** Un GPS urbain se trompe de
// quinze à trente mètres, parfois plus entre deux immeubles : à chaque point,
// la rue la plus proche est souvent la mauvaise, et coller chaque point à son
// plus proche voisin donne un chemin qui saute d'une rue à l'autre, traverse
// les maisons et revient. Ce qu'on cherche, c'est **la suite de rues la plus
// vraisemblable dans son ensemble** : chaque point doit être proche de sa rue,
// *et* le chemin d'un point au suivant doit ressembler à ce qu'on a parcouru.
//
// D'où un Viterbi sur un treillis de candidats — la méthode de Newson et Krumm,
// devenue l'ordinaire du map-matching :
//
// - **l'émission** note la proximité : un point à 5 m de la rue vaut mieux qu'à
//   30, selon une gaussienne d'écart-type `SIGMA_M` ;
// - **la transition** note la cohérence : la distance *par les rues* entre deux
//   positions retenues doit ressembler à la distance à vol d'oiseau entre les
//   deux points mesurés. Un écart de cent mètres — la rue d'à côté qu'il aurait
//   fallu contourner — coûte cher ; un écart de cinq, rien.
//
// Le chemin retenu est ensuite **recousu** : entre deux positions consécutives,
// on intercale le plus court chemin, et l'on obtient une suite d'arêtes du
// graphe — c'est-à-dire exactement ce que produit une recherche de boucle, et
// donc ce que le reste du moteur sait décrire, nommer et noter.

import { dijkstra, reconstruct } from './dijkstra'
import { haversineM, resample } from './geo'

// Un point tous les soixante mètres. Plus fin, le bruit du GPS domine ce qui
// sépare deux points et fait hésiter entre deux rues ; plus large, on saute des
// carrefours. Balayé sur trois chemins réels et trois niveaux de bruit : 60 m
// rend la longueur à 3,9 % près, contre 6,9 % à 40 m et 6,4 % à 80 m.
const SAMPLE_M = 60

// Au-delà, la rue n'est pas celle qu'on a courue : c'est le pâté de maisons
// d'à côté. Large tout de même — un GPS entre deux immeubles dérive.
const RADIUS_M = 45

// La sévérité de l'émission. Non pas l'erreur typique d'un GPS — dix mètres,
// c'est moins que ce qu'il se trompe en ville — mais la valeur qui rend les
// meilleures longueurs : au-delà, les candidats lointains pèsent trop et le
// chemin part faire le tour du pâté de maisons d'à côté.
const SIGMA_M = 10

// L'échelle de l'écart toléré entre la distance par les rues et la distance à
// vol d'oiseau. Newson et Krumm en font une exponentielle ; on garde la forme.
const BETA_M = 12

// Assez de candidats pour que la bonne rue y soit, assez peu pour que le
// treillis reste petit.
const MAX_CANDIDATES = 6

// Ce qu'on accorde au plus court chemin entre deux positions : trois fois le
// vol d'oiseau, et de quoi contourner un pâté de maisons quand les deux points
// sont presque confondus.
const DETOUR_FACTOR = 3
const DETOUR_SLACK_M = 250

// Faire demi-tour coûte. Sans ça, un point égaré sur la rue parallèle se
// rejoint par un aller-retour dont la longueur ressemble à celle qu'on a
// parcourue : rien ne le distingue, et le chemin reconnu se met à zigzaguer.
// Un vrai demi-tour — une impasse, un bout d'aller-retour — reste possible : il
// est soutenu par plusieurs points d'affilée, et cette accumulation l'emporte.
const UTURN_PENALTY = 2.5

// En dessous, la trace n'a pas été reconnue : mieux vaut la garder telle quelle,
// sans nom ni note, que de la remplacer par un chemin inventé.
const MIN_MATCHED_SHARE = 0.7

// La part de la trace qu'une rupture peut faire perdre avant qu'on renonce.
const MAX_LOST_SHARE = 0.05

/**
 * Les rues qu'une trace emprunte, ou `null` si on ne les reconnaît pas.
 *
 * Rend la suite d'arêtes et de nœuds du graphe — la même forme qu'un candidat
 * de recherche —, avec la part de la trace effectivement reconnue.
 */
export function matchTrace(
  graph,
  trace,
  { sampleM = SAMPLE_M, radiusM = RADIUS_M, sigmaM = SIGMA_M, betaM = BETA_M } = {},
) {
  if (!graph?.edgeCount || !trace || trace.length < 2) return null

  const points = resample(trace, sampleM).map(([, c]) => c)
  if (points.length < 2) return null

  const index = edgeIndex(graph, radiusM)
  const lattice = points.map((p) => candidates(graph, index, p, radiusM))
  // Un point sans candidat n'est pas une erreur — un bout de chemin privé, un
  // tunnel — mais une colonne vide couperait le treillis en deux.
  const colonnes = lattice.filter((c) => c.length)
  if (colonnes.length < 2 || colonnes.length < points.length * MIN_MATCHED_SHARE) return null

  const chosen = viterbi(graph, points, lattice, sigmaM, betaM)
  if (!chosen) return null
  // **Une rupture ne se franchit pas en silence.** Quand la trace saute par où
  // aucune rue ne passe — un bac, un tunnel absent des données, deux bouts de
  // réseau que rien ne relie —, le treillis repart de zéro, et la chaîne
  // retenue ne commence qu'après : tout ce qui précédait disparaissait du
  // parcours reconnu, sans rien dire. Deux ou trois points au tout début, passe
  // encore ; au-delà, la trace reste telle qu'elle est venue.
  const lost = colonnes.length - chosen.length
  if (lost > Math.max(2, colonnes.length * MAX_LOST_SHARE)) return null

  const edges = stitch(graph, chosen)
  if (!edges || !edges.length) return null

  const nodes = [chosen[0].entry]
  let cur = chosen[0].entry
  for (const e of edges) {
    cur = graph.other(e, cur)
    nodes.push(cur)
  }
  return { edges, nodes, share: chosen.length / points.length }
}

// --- les candidats -----------------------------------------------------------

/**
 * Les arêtes rangées par case, **sur toute leur longueur**.
 *
 * Passer par les nœuds ne suffirait pas : une rue droite de trois cents mètres
 * n'a que deux nœuds, et un point posé en son milieu n'en verrait aucun. Ses
 * points de forme non plus — une rue droite n'en a souvent que deux, ses deux
 * bouts : chaque segment est donc suivi pas à pas, une demi-case à la fois,
 * et toutes les cases qu'il traverse le connaissent.
 */
function edgeIndex(graph, radiusM) {
  const cell = radiusM
  const kx = 111_320 * Math.cos((graph.nodeLat[0] * Math.PI) / 180)
  const grid = new Map()
  const key = (lon, lat) => `${Math.floor((lon * kx) / cell)}:${Math.floor((lat * 110_540) / cell)}`
  const file = (e, lon, lat, last) => {
    const k = key(lon, lat)
    if (k === last) return k
    let bucket = grid.get(k)
    if (!bucket) grid.set(k, (bucket = new Set()))
    bucket.add(e)
    return k
  }

  const coords = graph.coords
  for (let e = 0; e < graph.edgeCount; e += 1) {
    const start = graph.edgeCoordStart[e]
    const count = graph.edgeCoordCount[e]
    let last = file(e, coords[2 * start], coords[2 * start + 1], null)
    for (let i = 1; i < count; i += 1) {
      const lon0 = coords[2 * (start + i - 1)]
      const lat0 = coords[2 * (start + i - 1) + 1]
      const lon1 = coords[2 * (start + i)]
      const lat1 = coords[2 * (start + i) + 1]
      const metres = Math.hypot((lon1 - lon0) * kx, (lat1 - lat0) * 110_540)
      const steps = Math.max(1, Math.ceil(metres / (cell / 2)))
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps
        last = file(e, lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t, last)
      }
    }
  }
  return { grid, key }
}

/** Les positions plausibles d'un point mesuré : une par arête proche, au plus. */
function candidates(graph, index, point, radiusM) {
  const [cx, cy] = index.key(point[0], point[1]).split(':').map(Number)
  const seen = new Set()
  const out = []

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const e of index.grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (seen.has(e)) continue
        seen.add(e)
        const hit = project(graph, e, point)
        if (hit.distance > radiusM) continue
        // Une arête se parcourt dans les deux sens : ce sont deux positions
        // différentes, qui ne mènent pas aux mêmes rues ensuite.
        out.push({ edge: e, distance: hit.distance, along: hit.along, entry: graph.edgeA[e], exit: graph.edgeB[e] })
        out.push({
          edge: e,
          distance: hit.distance,
          along: graph.edgeLen[e] - hit.along,
          entry: graph.edgeB[e],
          exit: graph.edgeA[e],
        })
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance)
  return out.slice(0, MAX_CANDIDATES * 2)
}

/** La projection d'un point sur une arête : sa distance, et sa position dessus. */
function project(graph, edge, point) {
  const start = graph.edgeCoordStart[edge]
  const count = graph.edgeCoordCount[edge]
  let best = { distance: Infinity, along: 0 }
  let travelled = 0

  for (let i = 0; i < count - 1; i += 1) {
    const a = [graph.coords[2 * (start + i)], graph.coords[2 * (start + i) + 1]]
    const b = [graph.coords[2 * (start + i + 1)], graph.coords[2 * (start + i + 1) + 1]]
    const segment = haversineM(a, b)
    const { distance, t } = pointToSegment(point, a, b)
    if (distance < best.distance) best = { distance, along: travelled + t * segment }
    travelled += segment
  }
  return best
}

/** Distance d'un point à un segment, et où il tombe dessus (0 à 1). */
function pointToSegment(p, a, b) {
  // Plan local : sur quelques dizaines de mètres, la Terre est plate.
  const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const ax = 0
  const ay = 0
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * 110_540
  const px = (p[0] - a[0]) * kx
  const py = (p[1] - a[1]) * 110_540
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0
  return { distance: Math.hypot(px - t * dx, py - t * dy), t }
}

// --- le treillis --------------------------------------------------------------

/**
 * Le chemin le plus vraisemblable à travers les candidats.
 *
 * Les probabilités sont manipulées en logarithmes : multiplier deux cents
 * gaussiennes tomberait sous le plus petit flottant bien avant la fin de la
 * trace.
 */
function viterbi(graph, points, lattice, sigmaM, betaM) {
  let previous = null
  let previousIndex = -1

  for (let i = 0; i < lattice.length; i += 1) {
    const colonne = lattice[i]
    if (!colonne.length) continue

    const states = colonne.map((c) => ({
      ...c,
      score: emission(c.distance, sigmaM),
      from: null,
      path: null,
    }))

    if (previous) {
      const straight = haversineM(points[previousIndex], points[i])
      const limite = straight * DETOUR_FACTOR + DETOUR_SLACK_M
      // Un seul Dijkstra par nœud de sortie : les candidats d'une même colonne
      // se partagent souvent le même, et c'est le calcul le plus cher.
      const runs = new Map()
      for (const u of previous) {
        if (!runs.has(u.exit)) {
          // Sans sens uniques : la trace dit où l'on est passé, et un contresens
          // cyclable absent de la carte ne doit pas la détourner.
          runs.set(u.exit, dijkstra(graph, u.exit, graph.edgeLen, { maxDist: limite, oneway: false }))
        }
      }

      for (const v of states) {
        let best = -Infinity
        let parent = null
        let path = null
        for (const u of previous) {
          if (u.score === -Infinity) continue
          const run = runs.get(u.exit)
          let byRoad
          let edges = []
          if (u.edge === v.edge && u.exit === v.exit) {
            // Toujours la même rue, dans le même sens : la distance parcourue
            // est simplement l'avancée sur l'arête.
            byRoad = Math.abs(v.along - u.along)
          } else {
            const reste = graph.edgeLen[u.edge] - u.along
            if (run.dist[v.entry] === Infinity) continue
            byRoad = reste + run.dist[v.entry] + v.along
            edges = reconstruct(run, v.entry) ?? []
          }
          // Un demi-tour : sur place, ou en repartant par où l'on vient.
          const demiTour =
            (u.edge === v.edge && u.exit !== v.exit) || (edges.length > 0 && edges[0] === u.edge)
          const s = u.score + transition(byRoad, straight, betaM) - (demiTour ? UTURN_PENALTY : 0)
          if (s > best) {
            best = s
            parent = u
            path = u.edge === v.edge && u.exit === v.exit ? [] : [...edges, v.edge]
          }
        }
        v.score = best === -Infinity ? -Infinity : best + v.score
        v.from = parent
        v.path = path
      }
      // Aucun enchaînement possible : la trace a sauté — un tunnel, un bateau,
      // un morceau de chemin absent du réseau. On repart de cette colonne.
      if (states.every((s) => s.score === -Infinity)) {
        for (const s of states) {
          s.score = emission(s.distance, sigmaM)
          s.from = null
          s.path = null
        }
      }
    }

    previous = states
    previousIndex = i
  }

  if (!previous) return null
  const last = previous.reduce((a, b) => (b.score > a.score ? b : a))
  if (last.score === -Infinity) return null

  const chain = []
  for (let s = last; s; s = s.from) chain.push(s)
  chain.reverse()
  return chain
}

/** Plus le point est loin de la rue, moins elle est plausible. */
const emission = (distance, sigmaM) => -(distance * distance) / (2 * sigmaM * sigmaM)

/** Plus le chemin par les rues s'éloigne du vol d'oiseau, moins il est plausible. */
const transition = (byRoad, straight, betaM) => -Math.abs(byRoad - straight) / betaM

/**
 * Les arêtes du chemin retenu, bout à bout.
 *
 * Aucune déduplication : **une rue parcourue deux fois l'est vraiment**. On
 * monte une impasse et l'on revient, on repasse par la place centrale — écarter
 * la répétition couperait la chaîne, et le reste du moteur suppose un chemin
 * continu, arête après arête.
 *
 * La continuité est donc vérifiée plutôt que supposée : chaque arête doit
 * partager un nœud avec la précédente. Une rupture signalerait une incohérence
 * du treillis ; on s'arrête là plutôt que de rendre un chemin impossible.
 */
function stitch(graph, chain) {
  const out = []
  let cur = chain[0].entry

  const add = (e) => {
    if (graph.edgeA[e] !== cur && graph.edgeB[e] !== cur) return false
    out.push(e)
    cur = graph.other(e, cur)
    return true
  }

  if (!add(chain[0].edge)) return []
  for (const state of chain.slice(1)) {
    for (const e of state.path ?? []) {
      if (!add(e)) return out
    }
  }
  return out
}
