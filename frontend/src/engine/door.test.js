import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { STREET_REACH_M, nearestSpot, openDoor, streetKey } from './door'
import { repeatLoop } from './loops'
import { buildInstructions } from './navigation'
import { planLoops, reverseRoute } from './service'

/**
 * Partir de devant chez soi.
 *
 * Signalé d'une capture d'écran : le départ se posait au coin de la rue, sur le
 * carrefour le plus proche, et jamais devant la maison. Corrigé une première
 * fois, il partait de la maison elle-même, par une allée tracée à travers le
 * jardin. Ce qu'on veut : la rue, au droit de la porte — « à partir de la rue
 * même, genre devant chez moi ».
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

  it('part de la rue au droit du point choisi, et y revient', async () => {
    const [lon, lat] = home.point
    const result = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 3 }, deps)
    expect(result.routes.length).toBeGreaterThan(0)
    const spot = nearestSpot(graph, lon, lat)
    for (const route of result.routes) {
      // Sur la rue, pas dans la maison : quinze mètres devant elle.
      expect(haversineM(home.point, route.geometry[0])).toBeCloseTo(15, 0)
      expect(haversineM(spot.point, route.geometry[0])).toBeLessThan(0.5)
      expect(route.geometry.at(-1)).toEqual(route.geometry[0])
    }
  }, 30_000)

  it('ne trace rien entre la maison et la rue', async () => {
    const [lon, lat] = home.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    // Aucun point du tracé ne s'approche de la maison plus que la rue.
    expect(routes[0].geometry.some((p) => haversineM(p, home.point) < 14)).toBe(false)
  }, 30_000)

  it('part de devant la porte, pas du carrefour du coin', async () => {
    const [lon, lat] = home.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    const corner = graph.node(graph.nearestNode(lon, lat))
    expect(haversineM(routes[0].geometry[0], corner)).toBeGreaterThan(40)
  }, 30_000)

  it('dit de quel côté partir en sortant', async () => {
    const [lon, lat] = home.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    const [depart] = routes[0].instructions
    expect(depart.text).toMatch(/^Départ — en sortant, pars (à gauche|à droite|tout droit)( (sur|dans) .+)?\.$/)
    expect(depart.road).toBe(graph.edgeName[home.e])
    expect(haversineM([depart.lon, depart.lat], routes[0].geometry[0])).toBeLessThan(0.2)
  }, 30_000)

  it('ne touche pas au graphe de la zone, gardé pour les recherches suivantes', async () => {
    const before = [graph.nodeCount, graph.edgeCount, graph.edgeB[home.e], graph.edgeLen[home.e]]
    const [lon, lat] = home.point
    await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    expect([graph.nodeCount, graph.edgeCount, graph.edgeB[home.e], graph.edgeLen[home.e]]).toEqual(before)
  }, 30_000)

  it('coupe la rue en deux moitiés qui font exactement le tout', () => {
    const [lon, lat] = home.point
    const { graph: g, start, reachM } = openDoor(graph, lon, lat, { connect: false })
    const { node, split, connector } = g.door
    expect(start).toBe(node)
    expect(connector).toBe(null)
    expect(reachM).toBe(0)
    expect(g.nodeCount).toBe(graph.nodeCount + 1)
    const [cut, added] = split
    expect(g.edgeLen[cut] + g.edgeLen[added]).toBeCloseTo(graph.edgeLen[home.e], 9)
    expect(g.edgeB[cut]).toBe(node)
    expect(g.edgeA[added]).toBe(node)
    expect(g.coordsFrom(cut, g.edgeA[cut]).at(-1)).toEqual(g.node(node))
    expect(g.coordsFrom(added, node)[0]).toEqual(g.node(node))
  })

  it('trace, pour le recalcul en course, le bout de trottoir jusqu’à la rue', () => {
    const [lon, lat] = home.point
    const { graph: g, start, reachM } = openDoor(graph, lon, lat)
    expect(reachM).toBeCloseTo(15, 0)
    expect(g.coordsFrom(g.door.connector, start)).toEqual([g.node(start), g.node(g.door.node)])
  })

  it('se retourne comme les autres boucles, toujours depuis la rue', async () => {
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
    expect(route.geometry.at(-1)).toEqual(routes[0].geometry[0])
    expect(route.distance_m).toBeCloseTo(routes[0].distance_m, 1)
    expect(route.instructions[0].text).toMatch(/^Départ — en sortant/)
  }, 30_000)

  it('ne parle pas de « sortir » quand le point est loin de toute rue', async () => {
    const far = house(120)
    expect(far).toBeTruthy()
    const [lon, lat] = far.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1 }, deps)
    expect(haversineM(far.point, routes[0].geometry[0])).toBeCloseTo(120, 0)
    expect(routes[0].instructions[0].text).toMatch(/^Départ — pars vers /)
  }, 30_000)

  it('fait les tours sur la rue, et les termine devant la porte', async () => {
    const [lon, lat] = home.point
    let gardé = null
    await planLoops({ lat, lon, distance_km: 2, sport: 'run', limit: 1 }, { ...deps, onReversible: (r) => (gardé = r) })
    const { graph: g, start } = gardé
    const tours = repeatLoop(g, start, gardé.routes[0].cand, 3)
    const lap = tours.stats.distanceM / 3
    const fins = buildInstructions(g, start, tours).filter((s) => s.turn === 'lap')
    expect(fins.map((s) => s.dist_m)).toEqual([lap, 2 * lap].map((d) => Math.round(d * 10) / 10))
    expect([fins[0].lon, fins[0].lat]).toEqual(g.node(g.door.node))
  }, 30_000)
})

describe('la rue de l’adresse', () => {
  /**
   * Une maison d'angle, ou dont le jardin donne sur une autre voie : la plus
   * proche des murs n'est pas celle où donne la porte. Quand la recherche de
   * lieux dit « 12 rue des Tonneliers », c'est rue des Tonneliers qu'on sort.
   */
  const home = house(15)

  // Un point plus proche d'une rue que d'une autre, nommée autrement, à portée.
  function corner() {
    const kx = Math.cos((CENTRE[1] * Math.PI) / 180) * 111_320
    for (let e = 0; e < graph.edgeCount; e += 1) {
      const name = graph.edgeName[e]
      if (!name || graph.edgeLen[e] < 120) continue
      const coords = graph.coordsFrom(e, graph.edgeA[e])
      const [lon0, lat0] = coords[Math.floor(coords.length / 2)]
      for (const [ox, oy] of [[25, 0], [-25, 0], [0, 25], [0, -25]]) {
        const point = [lon0 + ox / kx, lat0 + oy / 110_540]
        const nearest = nearestSpot(graph, point[0], point[1])
        const other = graph.edgeName[nearest.edge]
        if (!other || streetKey(other) === streetKey(name)) continue
        const onName = nearestSpot(graph, point[0], point[1], (x) => graph.edgeName[x] === name)
        const d = haversineM(point, onName.point)
        if (d > haversineM(point, nearest.point) + 3 && d < 60) return { point, street: name, other }
      }
    }
    return null
  }

  it('sort sur la rue de l’adresse, même si une autre passe plus près', () => {
    const c = corner()
    expect(c).toBeTruthy()
    const [lon, lat] = c.point
    const sans = openDoor(graph, lon, lat, { connect: false })
    const avec = openDoor(graph, lon, lat, { connect: false, street: c.street })
    const street = (g, start) => {
      const names = []
      for (let k = g.adjOffset[start]; k < g.adjOffset[start + 1]; k += 1) names.push(g.edgeName[g.adjEdges[k]])
      return names
    }
    expect(street(sans.graph, sans.start)).toContain(c.other)
    expect(street(avec.graph, avec.start)).toContain(c.street)
  })

  it('reconnaît le nom malgré les accents, la casse et les traits d’union', () => {
    expect(streetKey('Rue Jean-Jaurès')).toBe(streetKey('rue jean jaures'))
    expect(streetKey('Allée de l’Église')).toBe(streetKey("Allee de l'Eglise"))
  })

  it('sans rue du nom donné à portée, prend la plus proche', () => {
    const [lon, lat] = home.point
    const inconnue = openDoor(graph, lon, lat, { connect: false, street: 'Rue qui n’existe pas' })
    const sans = openDoor(graph, lon, lat, { connect: false })
    expect(inconnue.graph.node(inconnue.start)).toEqual(sans.graph.node(sans.start))
  })

  it('passe de la demande au départ', async () => {
    const c = corner()
    const [lon, lat] = c.point
    const { routes } = await planLoops({ lat, lon, distance_km: 4, sport: 'run', limit: 1, street: c.street }, deps)
    const first = routes[0].segments[0].road
    expect(first).toBe(c.street)
  }, 30_000)
})
