import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { MAX_REACH_M, nearestSpot, openDoor } from './door'
import { repeatLoop } from './loops'
import { buildInstructions } from './navigation'
import { planLoops, reverseRoute } from './service'

/**
 * Partir de chez soi.
 *
 * Signalé d'une capture d'écran : le départ se posait au coin de la rue, sur le
 * carrefour le plus proche, et jamais devant la maison. Le graphe ne connaît
 * que des carrefours ; on coupe maintenant la rue devant la porte, et une allée
 * y mène depuis le point choisi — qui est, au mètre près, celui d'où part et où
 * revient la boucle.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
const graph = buildGraph(extract, { sport: 'run' })
const deps = { loadGraph: async () => graph, fetchElevations: async () => [], wind: async () => null }

const CENTRE = [4.8395, 47.0245]

/**
 * Une maison au milieu d'une rue : à `offset` mètres sur le côté d'une rue
 * nommée d'au moins 120 m, en son milieu — loin de ses deux carrefours — et
 * telle que cette rue soit bien la plus proche.
 */
function house(offset = 15) {
  const kx = Math.cos((CENTRE[1] * Math.PI) / 180) * 111_320
  const ky = 110_540
  const candidates = []
  for (let e = 0; e < graph.edgeCount; e += 1) {
    if (!graph.edgeName[e] || graph.edgeLen[e] < 120) continue
    const coords = graph.coordsFrom(e, graph.edgeA[e])
    const mid = Math.floor(coords.length / 2)
    const a = coords[Math.max(0, mid - 1)]
    const b = coords[Math.min(coords.length - 1, mid)]
    if (a === b) continue
    const dx = (b[0] - a[0]) * kx
    const dy = (b[1] - a[1]) * ky
    const len = Math.hypot(dx, dy)
    if (len < 5) continue
    const at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const point = [at[0] + ((-dy / len) * offset) / kx, at[1] + ((dx / len) * offset) / ky]
    const spot = nearestSpot(graph, point[0], point[1])
    if (spot.edge !== e) continue
    candidates.push({ e, point, near: haversineM(point, CENTRE) })
  }
  candidates.sort((x, y) => x.near - y.near)
  return candidates[0]
}

describe('le départ devant la porte', () => {
  const home = house(15)

  it('part du point choisi, et y revient', async () => {
    const [lon, lat] = home.point
    const result = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 3 }, deps)
    expect(result.routes.length).toBeGreaterThan(0)
    for (const route of result.routes) {
      expect(route.geometry[0]).toEqual([Number(lon.toFixed(6)), Number(lat.toFixed(6))])
      expect(route.geometry.at(-1)).toEqual(route.geometry[0])
    }
  }, 30_000)

  it('rejoint la rue en face, pas le carrefour du coin', async () => {
    const [lon, lat] = home.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    const [, seuil] = routes[0].geometry
    // L'allée fait la distance du point à la rue — une quinzaine de mètres —,
    // pas celle du point au carrefour le plus proche, à plus de soixante.
    expect(haversineM(home.point, seuil)).toBeCloseTo(15, 0)
    const corner = graph.node(graph.nearestNode(lon, lat))
    expect(haversineM(seuil, corner)).toBeGreaterThan(40)
  }, 30_000)

  it('dit de quel côté partir, une fois sur le trottoir', async () => {
    const [lon, lat] = home.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    const [depart, ...reste] = routes[0].instructions
    expect(depart.text).toMatch(/^Départ — rejoins .+ et pars (à gauche|à droite|tout droit)\.$/)
    expect(depart.road).toBe(graph.edgeName[home.e])
    // Le virage sur la rue est dans le départ : pas une seconde consigne douze
    // mètres plus loin, ni une au retour devant la maison.
    const [seuilLon, seuilLat] = routes[0].geometry[1]
    const auSeuil = reste.filter((s) => s.turn !== 'finish' && s.lon === seuilLon && s.lat === seuilLat)
    expect(auSeuil).toEqual([])
  }, 30_000)

  it('ne touche pas au graphe de la zone, gardé pour les recherches suivantes', async () => {
    const before = [graph.nodeCount, graph.edgeCount, graph.edgeB[home.e], graph.edgeLen[home.e]]
    const [lon, lat] = home.point
    await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    expect([graph.nodeCount, graph.edgeCount, graph.edgeB[home.e], graph.edgeLen[home.e]]).toEqual(before)
  }, 30_000)

  it('coupe la rue en deux moitiés qui font exactement le tout', () => {
    const [lon, lat] = home.point
    const { graph: g, start } = openDoor(graph, lon, lat)
    const { node, split } = g.door
    const [cut, added] = split
    expect(g.edgeLen[cut] + g.edgeLen[added]).toBeCloseTo(graph.edgeLen[home.e], 9)
    expect(g.edgeB[cut]).toBe(node)
    expect(g.edgeA[added]).toBe(node)
    // Les moitiés se raccordent au seuil, et l'allée y mène depuis le départ.
    expect(g.coordsFrom(cut, g.edgeA[cut]).at(-1)).toEqual(g.node(node))
    expect(g.coordsFrom(added, node)[0]).toEqual(g.node(node))
    expect(g.coordsFrom(g.door.connector, start)).toEqual([g.node(start), g.node(node)])
  })

  it('se retourne comme les autres boucles, toujours depuis la porte', async () => {
    const [lon, lat] = home.point
    let gardé = null
    const { routes } = await planLoops(
      { lat, lon, distance_km: 4, sport: 'run', limit: 1 },
      { ...deps, onReversible: (r) => (gardé = r) },
    )
    const premier = gardé.routes[0]
    const { route } = reverseRoute(gardé.graph, gardé.start, premier.cand, {
      req: gardé.req, elev: null, score: premier.score, rank: 0, night: false,
    })
    expect(route.geometry[0]).toEqual(routes[0].geometry[0])
    expect(route.geometry[1]).toEqual(routes[0].geometry[1])
    expect(route.distance_m).toBeCloseTo(routes[0].distance_m, 1)
  }, 30_000)

  it("ne trace pas de ligne droite à travers champs au-delà d'une allée", async () => {
    // Un point posé loin de toute rue : on part de la rue la plus proche, et
    // l'écran dit de combien le départ s'est déplacé.
    const far = house(MAX_REACH_M + 60)
    expect(far).toBeTruthy()
    const [lon, lat] = far.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    expect(haversineM(far.point, routes[0].geometry[0])).toBeGreaterThan(MAX_REACH_M)
  }, 30_000)

  it('ne fait pas repasser par la porte à chaque tour', async () => {
    const [lon, lat] = home.point
    let gardé = null
    await planLoops({ lat, lon, distance_km: 2, sport: 'run', limit: 1 }, { ...deps, onReversible: (r) => (gardé = r) })
    const { graph: g, start } = gardé
    const tours = repeatLoop(g, start, gardé.routes[0].cand, 3)
    // L'allée à l'aller, l'allée au retour — et rien entre les deux.
    expect(tours.edges.filter((e) => e === g.door.connector).length).toBe(2)
    expect(tours.edges[0]).toBe(g.door.connector)
    expect(tours.edges.at(-1)).toBe(g.door.connector)

    // Les fins de tour tombent au seuil de la rue, pas devant la maison.
    const reach = g.edgeLen[g.door.connector]
    const lap = (tours.stats.distanceM - 2 * reach) / 3
    const fins = buildInstructions(g, start, tours).filter((s) => s.turn === 'lap')
    expect(fins.map((s) => s.dist_m)).toEqual([reach + lap, reach + 2 * lap].map((d) => Math.round(d * 10) / 10))
    expect([fins[0].lon, fins[0].lat]).toEqual(g.node(g.door.node))
  }, 30_000)
})
