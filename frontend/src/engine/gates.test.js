import { describe, expect, it } from 'vitest'
import { carryWeights, openDoor } from './door'
import { emptyExtract, fromOverpass, mergeExtracts } from './extract'
import { buildGraph } from './graph'
import { fromRegionTile, toRegionTile } from './region'
import { closedBarrier } from './safety'
import { BLOCKED_FACTOR, buildProfile } from './weights'

/**
 * Les portails fermés.
 *
 * Signalé au retour d'une sortie : un portail fermé au bout de sept cents
 * mètres de boucle, un demi-tour, et un détour improvisé qui a ajouté plus
 * d'un kilomètre. OpenStreetMap le savait souvent — `access=private`,
 * `locked=yes` — mais le moteur ne gardait des nœuds que les passages piétons.
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

describe('ce qui ferme le passage', () => {
  it('un portail privé ou verrouillé', () => {
    expect(closedBarrier({ barrier: 'gate', access: 'private' })).toBe(true)
    expect(closedBarrier({ barrier: 'gate', locked: 'yes' })).toBe(true)
    expect(closedBarrier({ barrier: 'gate', foot: 'no' })).toBe(true)
  })

  it('pas un portail ouvert, ni une borne, ni un portail privé ouvert aux piétons', () => {
    expect(closedBarrier({ barrier: 'gate' })).toBe(false)
    expect(closedBarrier({ barrier: 'bollard' })).toBe(false)
    expect(closedBarrier({ barrier: 'gate', access: 'private', foot: 'yes' })).toBe(false)
  })

  it('selon le sport : un échalier se franchit à pied, pas à vélo', () => {
    expect(closedBarrier({ barrier: 'stile' }, 'run')).toBe(false)
    expect(closedBarrier({ barrier: 'stile' }, 'bike')).toBe(true)
    expect(closedBarrier({ barrier: 'gate', bicycle: 'no' }, 'bike')).toBe(true)
    expect(closedBarrier({ barrier: 'gate', bicycle: 'no' }, 'run')).toBe(false)
  })
})

describe('dans le graphe', () => {
  it('coupe un chemin en son milieu, des deux côtés', () => {
    const extract = {
      ...emptyExtract(),
      ways: [way(1, 'Chemin du Moulin', [[1, 0, 0], [2, 50, 0], [3, 100, 0]], 'path')],
      barriers: [{ id: 2, lon: at(50, 0)[0], lat: at(50, 0)[1], tags: { barrier: 'gate', locked: 'yes' } }],
    }
    const graph = buildGraph(extract)
    // Le portail est devenu un nœud, et les deux moitiés du chemin sont fermées.
    expect(graph.edgeCount).toBe(2)
    expect([...graph.gatedEdges].sort()).toEqual([0, 1])
  })

  it('ferme l’allée privée, pas la rue d’où elle part', () => {
    // Le portail est posé là où l'allée quitte la rue : au bout de l'allée, au
    // milieu de la rue. Fermer la rue aurait coupé tout le quartier.
    const extract = {
      ...emptyExtract(),
      ways: [
        way(1, 'Rue du Parc', [[10, 0, 0], [11, 60, 0], [12, 120, 0]]),
        way(2, null, [[11, 60, 0], [13, 60, 40]], 'service'),
      ],
      barriers: [{ id: 11, lon: at(60, 0)[0], lat: at(60, 0)[1], tags: { barrier: 'gate', access: 'private' } }],
    }
    const graph = buildGraph(extract)
    const allee = [...Array(graph.edgeCount).keys()].filter((e) => graph.edgeWayId[e] === 2)
    expect([...graph.gatedEdges]).toEqual(allee)
  })

  it('pèse comme un signalement : un mur, sauf s’il n’y a pas d’autre chemin', () => {
    const extract = {
      ...emptyExtract(),
      ways: [way(1, 'Chemin', [[1, 0, 0], [2, 50, 0], [3, 100, 0]], 'path')],
      barriers: [{ id: 2, lon: at(50, 0)[0], lat: at(50, 0)[1], tags: { barrier: 'gate', locked: 'yes' } }],
    }
    const graph = buildGraph(extract)
    const libre = buildGraph({ ...extract, barriers: [] })
    const profile = buildProfile('mixed', 'standard', false)
    // Au mètre : sans barrière, le chemin n'est qu'une arête de cent mètres.
    const auMetre = (g, e) => profile.weight(g, e) / g.edgeLen[e]
    expect(auMetre(graph, 0)).toBeCloseTo(auMetre(libre, 0) * BLOCKED_FACTOR)
  })

  it('garde fermée la seule moitié qui touche le portail quand on part du milieu de l’allée', () => {
    // Le départ posé dans l'allée elle-même : la moitié côté rue passe par le
    // portail, l'autre non.
    const extract = {
      ...emptyExtract(),
      ways: [
        way(1, 'Rue du Parc', [[10, 0, 0], [11, 60, 0], [12, 120, 0]]),
        way(2, null, [[11, 60, 0], [13, 60, 40]], 'service'),
      ],
      barriers: [{ id: 11, lon: at(60, 0)[0], lat: at(60, 0)[1], tags: { barrier: 'gate', access: 'private' } }],
    }
    const area = buildGraph(extract)
    const [lon, lat] = at(61, 20)
    const { graph } = openDoor(area, lon, lat)
    const [cut, added] = graph.door.split
    expect(graph.gatedEdges.has(cut)).toBe(true)
    expect(graph.gatedEdges.has(added)).toBe(false)
    // Et le recalcul en course, qui reporte les poids, libère aussi l'autre moitié.
    const weights = carryWeights(graph, buildProfile('mixed', 'standard', false).precompute(area))
    expect(weights[added] / graph.edgeLen[added]).toBeCloseTo((weights[cut] / graph.edgeLen[cut]) / BLOCKED_FACTOR)
  })

  it('ne ferme rien à vélo que le piéton franchit, et inversement', () => {
    const extract = {
      ...emptyExtract(),
      ways: [way(1, 'Sentier', [[1, 0, 0], [2, 50, 0], [3, 100, 0]], 'path')],
      barriers: [{ id: 2, lon: at(50, 0)[0], lat: at(50, 0)[1], tags: { barrier: 'stile' } }],
    }
    expect(buildGraph(extract, { sport: 'run' }).gatedEdges.size).toBe(0)
    expect(buildGraph(extract, { sport: 'bike' }).gatedEdges.size).toBe(2)
  })
})

describe('dans les données', () => {
  const portail = { type: 'node', id: 42, lon: 7.2, lat: 47.9, tags: { barrier: 'gate', access: 'private' } }
  const passage = { type: 'node', id: 43, lon: 7.21, lat: 47.9, tags: { highway: 'crossing', crossing: 'zebra' } }

  it('lit les portails fermés dans la réponse d’Overpass', () => {
    const extract = fromOverpass({ elements: [portail, passage, { type: 'node', id: 44, lon: 7, lat: 47, tags: { barrier: 'gate' } }] })
    expect(extract.barriers.map((b) => b.id)).toEqual([42])
    expect(extract.crossings.map((c) => c.id)).toEqual([43])
  })

  it('les garde dans les tuiles, à côté des passages, et les relit séparés', () => {
    const extract = fromOverpass({ elements: [portail, passage] })
    const relue = fromRegionTile(JSON.parse(JSON.stringify(toRegionTile(extract))))
    expect(relue.barriers.map((b) => b.id)).toEqual([42])
    expect(relue.crossings.map((c) => c.id)).toEqual([43])
  })

  it('relit une tuile d’avant les portails sans rien perdre', () => {
    const ancienne = { w: [], l: [], c: [[43, 72_100_000, 479_000_000, { highway: 'crossing' }]] }
    const relue = fromRegionTile(ancienne)
    expect(relue.crossings).toHaveLength(1)
    expect(relue.barriers).toEqual([])
  })

  it('ne les compte qu’une fois quand deux tuiles les rendent', () => {
    const a = fromOverpass({ elements: [portail] })
    const b = fromOverpass({ elements: [portail] })
    expect(mergeExtracts([a, b]).barriers).toHaveLength(1)
  })
})
