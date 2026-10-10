import { describe, expect, it } from 'vitest'
import { emptyExtract } from './extract'
import { buildGraph } from './graph'
import { Candidate, detectCrossings } from './loops'

/**
 * Les traversées de route rapide.
 *
 * Une traversée en décalé — on rejoint la départementale, on la longe quelques
 * mètres, on la quitte par le chemin d'en face — était comptée deux fois : en
 * arrivant, puis en repartant. Relevé au pied des Vosges, sur une boucle notée
 * B pour une seule traversée de trois secondes ; et en mode Sûr, une seule
 * départementale épuisait les deux traversées tolérées.
 */

const LAT = 47.9
const LON = 7.2
const DX = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const DY = 1 / 110_540
const at = (x, y) => [LON + x * DX, LAT + y * DY]

const way = (id, tags, cells) => ({
  id,
  tags,
  nodes: cells.map(([n]) => n),
  flat: Float64Array.from(cells.flatMap(([, x, y]) => at(x, y))),
})

/** Un chemin du sud, la route à 80 sur `offset` mètres, un chemin vers le nord. */
function crossed(offset) {
  const road = { highway: 'secondary', maxspeed: '80' }
  const extract = {
    ...emptyExtract(),
    ways: [
      way(1, road, [[1, -100, 0], [2, 0, 0], [3, offset, 0], [4, 300, 0]]),
      way(2, { highway: 'track' }, [[10, 0, -200], [2, 0, 0]]),
      way(3, { highway: 'track' }, [[3, offset, 0], [11, offset, 200]]),
    ],
  }
  const graph = buildGraph(extract)
  const nodes = [at(0, -200), at(0, 0), at(offset, 0), at(offset, 200)].map(([lon, lat]) => graph.nearestNode(lon, lat))
  const edges = nodes.slice(1).map((b, i) => {
    const a = nodes[i]
    for (let k = graph.adjOffset[a]; k < graph.adjOffset[a + 1]; k += 1) {
      const e = graph.adjEdges[k]
      if (graph.edgeA[e] === b || graph.edgeB[e] === b) return e
    }
    throw new Error('arête introuvable')
  })
  return detectCrossings(graph, new Candidate(edges, nodes))
}

describe('detectCrossings', () => {
  it('compte une seule fois une traversée en décalé', () => {
    const hits = crossed(5)
    expect(hits).toHaveLength(1)
    expect(hits[0].speedKmh).toBe(80)
  })

  it('compte deux traversées éloignées l’une de l’autre', () => {
    expect(crossed(100)).toHaveLength(2)
  })
})
