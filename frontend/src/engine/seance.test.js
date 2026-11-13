import { describe, expect, it } from 'vitest'
import { emptyExtract } from './extract'
import { buildGraph } from './graph'
import { Terrain } from './environment'
import { planSeance } from './seance'
import { planSeanceRoute } from './service'
import { buildProfile } from './weights'

/**
 * La séance du jour, version complète : « 6 × 400 m » → une boucle qui passe par
 * une ligne droite plate de 400 m, près de la porte.
 *
 * Le réseau est un petit circuit : la porte en S, puis S → X (200 m) → Y (400 m
 * vers le nord, la ligne droite) → Z → W → S. Le seul tronçon de 360 à 440 m
 * droit et plat est X → Y.
 */

const LAT = 47.9
const LON = 7.2
const DX = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const DY = 1 / 110_540
const at = (x, y) => [LON + x * DX, LAT + y * DY]

const way = (id, name, cells, highway = 'residential') => ({
  id,
  tags: { highway, name },
  nodes: cells.map(([n]) => n),
  flat: Float64Array.from(cells.flatMap(([, x, y]) => at(x, y))),
})

// Nœuds : 1 = S (la porte), 2 = X, 3 = Y, 4 = Z, 5 = W. Coordonnées en mètres.
const network = () => ({
  ...emptyExtract(),
  ways: [
    way(1, 'Route du Parc', [[1, 0, 0], [2, 0, 200]]),
    way(2, 'Rue de la Ligne', [[2, 0, 200], [3, 0, 600]]),
    way(3, 'Rue Haute', [[3, 0, 600], [4, 300, 600]]),
    way(4, "Rue de l'Est", [[4, 300, 600], [5, 300, 0]]),
    way(5, 'Rue Basse', [[5, 300, 0], [1, 0, 0]]),
  ],
})

/** Le nœud du graphe posé sur le point (x, y) en mètres. */
function nodeAt(graph, x, y) {
  const [lon, lat] = at(x, y)
  for (let i = 0; i < graph.nodeCount; i += 1) {
    if (Math.abs(graph.nodeLon[i] - lon) < 1e-6 && Math.abs(graph.nodeLat[i] - lat) < 1e-6) return i
  }
  throw new Error(`pas de nœud en ${x}, ${y}`)
}

/** Un relief de 1 500 m de rayon, donné par `z(lon, lat)` en mètres. */
function terrainWith(z) {
  const terrain = new Terrain(LAT, LON, 1500)
  terrain.values = terrain.points().map(([lon, lat]) => z(lon, lat))
  return terrain
}

const FLAT = terrainWith(() => 100)
// Dix pour cent de pente vers le nord : 40 m de montée sur les 400 m.
const HILL = terrainWith((lon, lat) => 100 + ((lat - LAT) / DY) * 0.1)
const PROFILE = buildProfile('mixed', 'standard', false, 'run')

describe('séance du jour : la ligne droite plate', () => {
  it('trouve la ligne de 400 m près de la porte, et la boucle revient à la porte', () => {
    const graph = buildGraph(network())
    const door = nodeAt(graph, 0, 0)

    const found = planSeance(graph, door, { straightM: 400, terrain: FLAT, profile: PROFILE })

    expect(found).not.toBeNull()
    const { cand, straight } = found
    // La ligne droite est celle du nord, partie de X, à 200 m de la porte.
    expect(straight.lengthM).toBeGreaterThanOrEqual(360)
    expect(straight.lengthM).toBeLessThanOrEqual(440)
    expect(straight.from).toBe(nodeAt(graph, 0, 200))
    // La boucle parcourt cette ligne d'un bout à l'autre…
    expect(cand.edges).toEqual(expect.arrayContaining(straight.edges))
    // …et part de la porte, pour y revenir.
    expect(cand.nodes[0]).toBe(door)
    expect(cand.nodes[cand.nodes.length - 1]).toBe(door)
    expect(cand.distanceM).toBeGreaterThan(1500)
  })

  it('une ligne de même longueur en pente de 10 % n’est pas retenue', () => {
    const graph = buildGraph(network())
    expect(planSeance(graph, nodeAt(graph, 0, 0), { straightM: 400, terrain: HILL, profile: PROFILE })).toBeNull()
  })
})

describe('séance du jour : le parcours rendu à l’écran', () => {
  const request = { lat: LAT, lon: LON, distance_km: 1.8, sport: 'run' }
  const loadGraph = async () => buildGraph(network())

  it('rend la boucle avec le tracé de sa ligne droite, pour la carte', async () => {
    const flat = async ([points]) => [{ values: points.map(() => 100) }]
    const { routes, meta } = await planSeanceRoute(request, { loadGraph, fetchElevations: flat })

    expect(meta.message).toBeUndefined()
    expect(routes).toHaveLength(1)
    expect(routes[0].seance.straight.length).toBeGreaterThan(1)
  })

  it('sans relief, rend rien et le dit, plutôt qu’une boucle non vérifiée', async () => {
    const none = async () => [{ values: [] }]
    const { routes, meta } = await planSeanceRoute(request, { loadGraph, fetchElevations: none })

    expect(routes).toHaveLength(0)
    expect(meta.message).toMatch(/relief/)
  })

  it('un effort de 2 min se traduit en ligne de 400 m ; une durée sans ligne le dit', async () => {
    const flat = async ([points]) => [{ values: points.map(() => 100) }]
    const deux = { ...request, seance: { reps: 6, effort: { unit: 's', value: 120 }, rest: { unit: 's', value: 60 } } }
    const ok = await planSeanceRoute(deux, { loadGraph, fetchElevations: flat })
    expect(ok.routes).toHaveLength(1)
    expect(ok.routes[0].name).toBe('Fractionné · 6 × 2 min, récup 1 min')

    // 72 s ≈ 240 m : aucune ligne droite plate de cette longueur dans le réseau.
    const court = { ...request, seance: { ...deux.seance, effort: { unit: 's', value: 72 } } }
    const none = await planSeanceRoute(court, { loadGraph, fetchElevations: flat })
    expect(none.routes).toHaveLength(0)
    expect(none.meta.message).toContain('240 m')
  })
})
