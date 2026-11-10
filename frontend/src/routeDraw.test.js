/** Le tracé qui se dessine s'arrête au bon endroit, dans le bon tronçon, et finit entier. */
import { describe, expect, it } from 'vitest'
import { alongLine, bearingOf, drawPlan, drawnPart, easeBearing, profileAt, sketch } from './routeDraw'

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

  it('tourne la caméra du survol par le plus court, au même rythme quelle que soit la cadence', () => {
    // De 350° à 10° : vingt degrés vers la droite, pas trois cent quarante vers la gauche.
    const turned = easeBearing(350, 10, 500)
    expect(turned).toBeGreaterThan(350)
    expect(turned).toBeLessThan(370)
    // Deux images de 8 ms valent une image de 16 ms : un iPhone à 120 Hz ne tourne pas plus vite.
    expect(easeBearing(easeBearing(0, 90, 8), 90, 8)).toBeCloseTo(easeBearing(0, 90, 16), 9)
    // Une image sautée ne fait pas dépasser le cap visé.
    expect(easeBearing(0, 90, 10_000)).toBeCloseTo(90, 6)
    expect(easeBearing(40, 40, 16)).toBe(40)
  })

  it('lit l\'altitude du profil au point atteint par la pastille', () => {
    const profile = [{ dist_m: 0, ele_m: 300 }, { dist_m: 1000, ele_m: 400 }, { dist_m: 2000, ele_m: 350 }]
    expect(profileAt(profile, 500)).toBeCloseTo(350, 9)
    expect(profileAt(profile, 1500)).toBeCloseTo(375, 9)
    expect(profileAt(profile, -5)).toBe(300)
    expect(profileAt(profile, 9999)).toBe(350)
    expect(profileAt(null, 10)).toBeNull()
  })

  it('accepte une ligne seule, celle d\'un parcours sans tronçons', () => {
    const { features } = drawnPart(drawPlan(line([[0, 0], [0, 0.01]])), 0.5)
    expect(features[0].geometry.coordinates[1][1]).toBeCloseTo(0.005, 9)
  })
})

describe('le croquis de la trace', () => {
  it('tient dans son cadre, centré, nord en haut', () => {
    // Une trace plus haute que large : elle remplit la hauteur et se centre.
    const { d, start } = sketch([[7, 47], [7, 47.01], [7.001, 47.01]], 120, 80)
    expect(start).toEqual([57.7, 74])
    expect(d.startsWith('M57.7 74L')).toBe(true)
    expect(d).toContain('L57.7 6')
    expect(sketch([[7, 47]], 120, 80)).toBeNull()
  })
})

describe('le croquis par allure', () => {
  it('fait un chemin par suite de tronçons de la même bande', async () => {
    const { bandPaths } = await import('./routeDraw')
    const points = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]
    const parts = bandPaths(points, [0, 0, null, 4])
    expect(parts.map((p) => [p.band, p.d])).toEqual([
      [0, 'M0 0L1 0L2 0'],
      [4, 'M3 0L4 0'],
    ])
  })
})
