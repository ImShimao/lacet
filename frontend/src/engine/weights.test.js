import { describe, expect, it } from 'vitest'
import { emptyExtract } from './extract'
import { buildGraph } from './graph'
import { buildProfile } from './weights'

/**
 * « Voies sans voitures d'abord ».
 *
 * À Guebwiller, le long de la zone commerciale, la piste cyclable perdait
 * contre les voies de service et la pénétrante voisines : la sécurité seule ne
 * départage pas une piste d'une rue à 30, et le moteur prenait la plus courte.
 */

const LAT = 47.9
const LON = 7.2
const DX = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const at = (x) => [LON + x * DX, LAT]

/** Trois voies parallèles de cent mètres, chacune sur ses propres nœuds. */
function graphFor(sport) {
  const ways = [
    { id: 1, tags: { highway: 'residential', maxspeed: '30' } },
    { id: 2, tags: { highway: 'cycleway' } },
    { id: 3, tags: { highway: 'footway', footway: 'sidewalk' } },
    { id: 4, tags: { highway: 'pedestrian' } },
  ].map((w, k) => ({ ...w, nodes: [10 * k + 1, 10 * k + 2], flat: Float64Array.from([...at(0), ...at(100)]) }))
  const graph = buildGraph({ ...emptyExtract(), ways }, { sport })
  const edgeOf = (id) => [...graph.edgeWayId].indexOf(id)
  return { graph, edgeOf }
}

describe('les voies sans voitures', () => {
  it('passent devant une rue calme quand la préférence est active', () => {
    const { graph, edgeOf } = graphFor('run')
    const off = buildProfile('mixed', 'safe', false, 'run').precompute(graph)
    const on = buildProfile('mixed', 'safe', false, 'run', { carfree: true }).precompute(graph)
    expect(off[edgeOf(2)]).toBeCloseTo(off[edgeOf(1)])
    expect(on[edgeOf(2)]).toBeLessThan(on[edgeOf(1)] * 0.7)
  })

  it('ne comptent pas le trottoir qui longe la rue', () => {
    const { graph, edgeOf } = graphFor('run')
    const on = buildProfile('mixed', 'safe', false, 'run', { carfree: true }).precompute(graph)
    expect(on[edgeOf(3)]).toBeCloseTo(on[edgeOf(1)])
  })

  it('à vélo, ni la zone piétonne, où l’on roule au pas', () => {
    const { graph, edgeOf } = graphFor('bike')
    const off = buildProfile('mixed', 'safe', false, 'bike').precompute(graph)
    const on = buildProfile('mixed', 'safe', false, 'bike', { carfree: true }).precompute(graph)
    expect(on[edgeOf(4)]).toBeCloseTo(off[edgeOf(4)])
    expect(on[edgeOf(2)]).toBeLessThan(off[edgeOf(2)])
  })

  it('gardent l’heuristique d’A* admissible', () => {
    const on = buildProfile('mixed', 'safe', false, 'run', { carfree: true })
    const off = buildProfile('mixed', 'safe', false, 'run')
    expect(on.minFactor).toBeCloseTo(off.minFactor * 0.6)
  })
})
