import { describe, expect, it, vi } from 'vitest'

/**
 * Les traits qui coulent dans le tracé. MapLibre ne décale pas des pointillés :
 * chaque cran réécrit le motif. Il doit garder la même période — sinon les
 * traits sautent au lieu de glisser — et avancer dans le sens du tracé.
 */
vi.mock('maplibre-gl', () => ({ default: { addProtocol() {} } }))
const { flowDashes } = await import('./MapView.jsx')

const sum = (a) => a.reduce((x, y) => x + y, 0)

describe('les traits qui coulent', () => {
  it('gardent la même période à chaque cran', () => {
    const period = sum(flowDashes(0))
    for (let step = 0; step < 35; step += 1) expect(sum(flowDashes(step))).toBeCloseTo(period, 9)
  })

  it('avancent : le trait commence un peu plus loin à chaque cran', () => {
    expect(flowDashes(0)[1]).toBe(0)
    expect(flowDashes(5)[1]).toBeGreaterThan(flowDashes(4)[1])
    // Au bord de la période, le trait se coupe en deux sans changer de longueur.
    const coupe = flowDashes(34)
    expect(coupe[0] + coupe[2] + coupe[3]).toBeGreaterThan(0)
    expect(coupe.every((v) => v >= 0)).toBe(true)
  })
})
