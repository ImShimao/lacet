import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { matchTrace } from './matcher'

/**
 * Reconnaître les rues d'une trace.
 *
 * L'épreuve est construite à l'envers, et c'est ce qui la rend crédible : on
 * part d'un chemin **connu** du graphe, on le dégrade comme un GPS le
 * dégraderait — bruit de quinze mètres, un point tous les dix —, puis on
 * demande au module de retrouver les arêtes d'origine. Si elles reviennent, le
 * parcours importé aura les mêmes noms de rue, les mêmes traversées et la même
 * note que s'il avait été calculé ici.
 *
 * Et une garde, aussi importante : une trace qui ne suit **aucune** rue ne doit
 * pas être accrochée de force. Mieux vaut un parcours sans nom qu'un parcours
 * qui prétend passer là où il ne passe pas.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
const graph = buildGraph(extract, { sport: 'run' })

/** Un carrefour, et non le bout d'une impasse : de quoi marcher vraiment. */
function carrefour(lon, lat) {
  const proche = graph.nearestNode(lon, lat, 800)
  for (let n = proche; n < graph.nodeCount; n += 1) {
    if (graph.adjOffset[n + 1] - graph.adjOffset[n] >= 3) return n
  }
  return proche
}

/**
 * Un chemin réel du graphe : on suit les rues au hasard, en évitant de revenir
 * sur ses pas — mais en l'acceptant dans une impasse, comme on le ferait.
 */
function cheminReel(depart, longueurM) {
  const edges = []
  const nodes = [depart]
  let cur = depart
  let total = 0
  let precedente = -1
  let graine = 7
  while (total < longueurM && edges.length < 300) {
    const toutes = []
    for (let k = graph.adjOffset[cur]; k < graph.adjOffset[cur + 1]; k += 1) toutes.push(graph.adjEdges[k])
    if (!toutes.length) break
    const choix = toutes.filter((e) => e !== precedente)
    const parmi = choix.length ? choix : toutes
    graine = (graine * 1103515245 + 12345) % 2147483647
    const e = parmi[graine % parmi.length]
    edges.push(e)
    total += graph.edgeLen[e]
    precedente = e
    cur = graph.other(e, cur)
    nodes.push(cur)
  }
  return { edges, nodes, total }
}

/** La géométrie d'un chemin, telle qu'elle serait dessinée. */
function geometrie(edges, depart) {
  const out = []
  let cur = depart
  for (const e of edges) {
    const coords = graph.coordsFrom(e, cur)
    for (const c of out.length ? coords.slice(1) : coords) out.push(c)
    cur = graph.other(e, cur)
  }
  return out
}

/** Ce qu'une montre enregistre : un point tous les dix mètres, et du bruit. */
function commeUnGps(coords, bruitM = 15) {
  let graine = 42
  const hasard = () => {
    graine = (graine * 1103515245 + 12345) % 2147483647
    return graine / 2147483647 - 0.5
  }
  const out = []
  let reste = 0
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversineM(coords[i - 1], coords[i])
    reste += d
    if (reste < 10) continue
    reste = 0
    const kx = 111_320 * Math.cos((coords[i][1] * Math.PI) / 180)
    out.push([coords[i][0] + (hasard() * 2 * bruitM) / kx, coords[i][1] + (hasard() * 2 * bruitM) / 110_540])
  }
  return out
}

describe('l’accrochage d’une trace au réseau', () => {
  it('retrouve les rues d’un chemin connu, malgré le bruit d’un GPS', () => {
    const depart = carrefour(4.8395, 47.0245)
    const vrai = cheminReel(depart, 2500)
    expect(vrai.edges.length).toBeGreaterThan(5)

    const trace = commeUnGps(geometrie(vrai.edges, depart))
    const trouve = matchTrace(graph, trace)
    expect(trouve).not.toBeNull()

    // La quasi-totalité des rues d'origine doit revenir. Quelques arêtes de
    // liaison peuvent s'ajouter aux extrémités : la trace bruitée ne commence
    // pas exactement au nœud de départ.
    const attendues = new Set(vrai.edges)
    const retrouvees = trouve.edges.filter((e) => attendues.has(e))
    expect(retrouvees.length / vrai.edges.length).toBeGreaterThan(0.85)
  })

  it('rend un chemin continu, arête après arête', () => {
    // Le reste du moteur — description, consignes, note — suppose une chaîne :
    // chaque arête partage un nœud avec la précédente.
    const depart = carrefour(4.8395, 47.0245)
    const vrai = cheminReel(depart, 2000)
    const trouve = matchTrace(graph, commeUnGps(geometrie(vrai.edges, depart)))
    expect(trouve).not.toBeNull()

    let cur = trouve.nodes[0]
    for (const e of trouve.edges) {
      expect(graph.edgeA[e] === cur || graph.edgeB[e] === cur).toBe(true)
      cur = graph.other(e, cur)
    }
    expect(trouve.nodes[trouve.nodes.length - 1]).toBe(cur)
  })

  it('suit la rue parcourue, pas la parallèle d’à côté', () => {
    // Le bruit d'un GPS rapproche parfois un point de la rue voisine ; c'est la
    // cohérence de l'ensemble qui doit l'emporter sur la proximité d'un point.
    const depart = carrefour(4.8395, 47.0245)
    const vrai = cheminReel(depart, 1500)
    const trace = commeUnGps(geometrie(vrai.edges, depart), 25)
    const trouve = matchTrace(graph, trace)
    expect(trouve).not.toBeNull()
    const attendues = new Set(vrai.edges)
    expect(trouve.edges.filter((e) => attendues.has(e)).length / vrai.edges.length).toBeGreaterThan(0.7)
  })

  it('renonce plutôt que d’inventer, quand la trace ne suit aucune rue', () => {
    // Une ligne droite en plein champ, à des kilomètres de tout : l'accrocher
    // de force ferait passer un parcours pour ce qu'il n'est pas.
    const ailleurs = []
    for (let i = 0; i < 40; i += 1) ailleurs.push([4.95 + i * 0.0004, 47.12 + i * 0.0002])
    expect(matchTrace(graph, ailleurs)).toBeNull()
  })

  it('rend un chemin de la bonne longueur, pas un détour par le pâté d’à côté', () => {
    // C'est la mesure qui compte pour qui suit le parcours : un chemin reconnu
    // dix pour cent trop long annoncerait un « restant » faux du début à la fin.
    const depart = carrefour(4.8395, 47.0245)
    const vrai = cheminReel(depart, 2500)
    const attendue = vrai.edges.reduce((s, e) => s + graph.edgeLen[e], 0)
    for (const bruit of [8, 15, 25]) {
      const trouve = matchTrace(graph, commeUnGps(geometrie(vrai.edges, depart), bruit))
      expect(trouve).not.toBeNull()
      const longueur = trouve.edges.reduce((s, e) => s + graph.edgeLen[e], 0)
      expect(Math.abs(longueur / attendue - 1)).toBeLessThan(0.12)
    }
  })

  it('ne dit rien d’une trace trop courte ou vide', () => {
    expect(matchTrace(graph, [])).toBeNull()
    expect(matchTrace(graph, [[4.8395, 47.0245]])).toBeNull()
  })
})
