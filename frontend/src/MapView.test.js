import { describe, expect, it, vi } from 'vitest'

/**
 * Les traits qui coulent dans le tracé. MapLibre ne décale pas des pointillés :
 * chaque cran réécrit le motif. Il doit garder la même période — sinon les
 * traits sautent au lieu de glisser — et avancer dans le sens du tracé.
 */
vi.mock('maplibre-gl', () => ({ default: { addProtocol() {} } }))
const { flowDashes, startArrowGeoJson } = await import('./MapView.jsx')

const sum = (a) => a.reduce((x, y) => x + y, 0)

describe('les traits qui coulent', () => {
  it('gardent la même période à chaque cran', () => {
    const period = sum(flowDashes(0))
    for (let step = 0; step < 28; step += 1) expect(sum(flowDashes(step))).toBeCloseTo(period, 9)
  })

  it('avancent : le trait commence un peu plus loin à chaque cran', () => {
    expect(flowDashes(0)[1]).toBe(0)
    expect(flowDashes(5)[1]).toBeGreaterThan(flowDashes(4)[1])
    // Au bord de la période, le trait se coupe en deux sans changer de longueur.
    const coupe = flowDashes(27)
    expect(coupe[0] + coupe[2] + coupe[3]).toBeGreaterThan(0)
    expect(coupe.every((v) => v >= 0)).toBe(true)
  })
})

/** La flèche du départ : juste après la porte, tournée dans le sens du tracé. */
describe('la flèche du départ', () => {
  // Un kilomètre plein est, puis retour : la flèche doit pointer vers l'est.
  const est = { geometry: [[7.2, 47.9], [7.2134, 47.9], [7.2, 47.9]] }

  it('se pose à quelques dizaines de mètres de la porte, vers où l’on part', () => {
    const [f] = startArrowGeoJson(est).features
    expect(f.properties.bearing).toBeCloseTo(90, 0)
    expect(f.geometry.coordinates[0]).toBeGreaterThan(7.2)
    expect(f.geometry.coordinates[0]).toBeLessThan(7.2015)
  })

  it('ne se pose pas sur un tracé trop court ou absent', () => {
    expect(startArrowGeoJson(null).features).toEqual([])
    expect(startArrowGeoJson({ geometry: [[7.2, 47.9], [7.2005, 47.9]] }).features).toEqual([])
  })
})
