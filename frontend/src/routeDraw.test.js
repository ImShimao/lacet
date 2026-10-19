/** Le tracé qui se dessine s'arrête au bon endroit, dans le bon tronçon, et finit entier. */
import { describe, expect, it } from 'vitest'
import { alongLine, bearingOf, drawPlan, drawnPart } from './routeDraw'

const line = (coordinates, level = 'safe') => ({
  type: 'Feature',
  properties: { level },
  geometry: { type: 'LineString', coordinates },
})

describe('le tracé qui se dessine', () => {
  // Deux tronçons de même longueur, sur l'équateur : la moitié tombe à leur jonction.
  const route = { type: 'FeatureCollection', features: [line([[0, 0], [0.01, 0]]), line([[0.01, 0], [0.02, 0]], 'risk')] }
  const plan = drawPlan(route)

  it('commence vide et finit avec tout le parcours', () => {
    expect(drawnPart(plan, 0).features).toEqual([])
    expect(drawnPart(plan, 1).features).toEqual(route.features)
  })

  it('coupe le tronçon en cours au point atteint, en gardant son niveau', () => {
    const { features } = drawnPart(plan, 0.75)
    expect(features).toHaveLength(2)
    expect(features[1].properties.level).toBe('risk')
    const [, end] = features[1].geometry.coordinates
    expect(end[0]).toBeCloseTo(0.015, 9)
  })

  it('fait avancer le survol au mètre près, et regarde dans le sens du parcours', () => {
    const { total, at } = alongLine([[7, 47], [7, 47.01], [7.01, 47.01]])
    expect(total).toBeGreaterThan(1800)
    expect(at(0)).toEqual([7, 47])
    expect(at(total)).toEqual([7.01, 47.01])
    expect(at(total * 10)).toEqual([7.01, 47.01])
    expect(bearingOf([7, 47], [7, 47.01])).toBeCloseTo(0, 6)
    expect(bearingOf([7, 47], [7.01, 47])).toBeCloseTo(90, 6)
  })

  it('accepte une ligne seule, celle d\'un parcours sans tronçons', () => {
    const { features } = drawnPart(drawPlan(line([[0, 0], [0, 0.01]])), 0.5)
    expect(features[0].geometry.coordinates[1][1]).toBeCloseTo(0.005, 9)
  })
})
