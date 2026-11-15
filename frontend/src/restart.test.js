import { describe, expect, it } from 'vitest'
import { startHere } from './restart'
import { haversine } from './format'

/**
 * Le départ recalé sur la position : la même boucle, qui part et revient là où
 * l'on est vraiment — et rien de touché quand ce n'est pas sûr.
 */

// Un carré de 400 m de côté, parcouru est, sud, ouest, nord.
const LAT = 48
const mLat = 1 / 110_574
const mLon = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const at = (eastM, northM) => [2 + eastM * mLon, LAT + northM * mLat]
const side = (from, to, n = 8) => Array.from({ length: n }, (_, i) => at(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n))
const CORNERS = [[0, 0], [400, 0], [400, -400], [0, -400]]
const geometry = [...CORNERS.flatMap((c, i) => side(c, CORNERS[(i + 1) % 4])), at(0, 0)]
// Les distances du carré sont justes à quelques mètres : on compare à dix près.
const tours = (route) => route.instructions.map((s) => [s.turn, Math.round(s.dist_m / 10) * 10])
const step = (dist_m, turn, text, [e, n]) => ({ dist_m, turn, angle: turn === 'right' ? 90 : 0, road: null, text, lon: at(e, n)[0], lat: at(e, n)[1], caution: false })
const carre = {
  id: 'r0',
  distance_m: 1600,
  duration_s: 600,
  laps: 1,
  geometry,
  instructions: [
    step(0, 'start', "Départ — pars vers l'est.", [0, 0]),
    step(400, 'right', 'Tourne à droite', [400, 0]),
    step(800, 'right', 'Tourne à droite', [400, -400]),
    step(1200, 'right', 'Tourne à droite', [0, -400]),
    step(1600, 'finish', 'Tu es revenu au point de départ. Boucle terminée.', [0, 0]),
  ],
  segments: [
    { length_m: 400, level: 'safe', road: 'rue du Nord', coords: [...side(CORNERS[0], CORNERS[1]), at(400, 0)] },
    { length_m: 1200, level: 'caution', road: 'rue du Tour', coords: [...geometry.slice(8)] },
  ],
  crossings: [
    { lon: at(200, 0)[0], lat: at(200, 0)[1], protected: true },
    { lon: at(0, -200)[0], lat: at(0, -200)[1], protected: false },
  ],
  elevation_profile: [0, 400, 800, 1200, 1600].map((d, i) => ({ dist_m: d, ele_m: [100, 110, 120, 110, 100][i] })),
}

describe('la boucle tourne pour partir d’où l’on est', () => {
  // Devant sa porte, 60 m après le repère, sur le trottoir à 6 m du tracé.
  const recale = startHere(carre, at(60, 6), 8)

  it('part de la position et y revient, sans changer de longueur', () => {
    expect(recale).not.toBeNull()
    expect(haversine(recale.geometry[0], at(60, 0))).toBeLessThan(1)
    expect(haversine(recale.geometry.at(-1), at(60, 0))).toBeLessThan(1)
    expect(recale.distance_m).toBeCloseTo(1600, -1)
  })

  it('décale les consignes, et tourne à l’ancien départ', () => {
    expect(tours(recale)).toEqual([
      ['start', 0],
      ['right', 340],
      ['right', 740],
      ['right', 1140],
      ['right', 1540],
      ['finish', 1600],
    ])
    expect(recale.instructions[0].text).toBe("Départ — pars vers l'est dans la rue du Nord.")
    expect(recale.instructions.at(-2).text).toBe('Tourne à droite')
  })

  it('garde les tronçons, les traversées et le profil dans l’ordre du nouveau tracé', () => {
    const longueur = recale.segments.reduce((s, x) => s + x.length_m, 0)
    expect(longueur).toBeCloseTo(1600, -1)
    expect(recale.segments.map((s) => s.road)).toEqual(['rue du Nord', 'rue du Tour', 'rue du Nord'])
    expect(recale.crossings.map((c) => c.protected)).toEqual([true, false])
    expect(recale.elevation_profile[0].dist_m).toBe(0)
    expect(recale.elevation_profile.at(-1).dist_m).toBeCloseTo(1600, 0)
    expect(recale.elevation_profile[0].ele_m).toBeCloseTo(101.5, 1)
    expect(recale.elevation_profile.at(-1).ele_m).toBeCloseTo(101.5, 1)
  })

  it('tourne aussi quand la porte est sur le retour', () => {
    const retour = startHere(carre, at(-5, -80), 8)
    expect(haversine(retour.geometry[0], at(0, -80))).toBeLessThan(1)
    expect(tours(retour).slice(0, 2)).toEqual([
      ['start', 0],
      ['right', 80],
    ])
    expect(retour.crossings.map((c) => c.protected)).toEqual([true, false])
  })
})

describe('le bout de rue pris à l’aller et au retour est coupé', () => {
  // La même boucle au bout d'une impasse de 100 m : aller, carré, retour.
  const impasse = [at(-100, 0), at(-50, 0)]
  const spur = {
    ...carre,
    distance_m: 1800,
    geometry: [...impasse, ...geometry, at(-50, 0), at(-100, 0)],
    instructions: [
      step(0, 'start', "Départ — pars vers l'est.", [-100, 0]),
      ...carre.instructions.slice(1, 4).map((s) => ({ ...s, dist_m: s.dist_m + 100 })),
      step(1700, 'right', 'Tourne à droite', [0, 0]),
      step(1800, 'finish', 'Tu es revenu au point de départ. Boucle terminée.', [-100, 0]),
    ],
    segments: [{ length_m: 1800, level: 'safe', road: 'impasse' }],
    crossings: [],
    elevation_profile: null,
  }

  it('part de la porte, sans l’aller-retour jusqu’à l’ancien départ', () => {
    const recale = startHere(spur, at(-40, 3), 8)
    expect(recale.distance_m).toBeCloseTo(1680, -1)
    expect(haversine(recale.geometry[0], at(-40, 0))).toBeLessThan(1)
    expect(haversine(recale.geometry.at(-1), at(-40, 0))).toBeLessThan(1)
    expect(tours(recale)).toEqual([
      ['start', 0],
      ['right', 440],
      ['right', 840],
      ['right', 1240],
      ['right', 1640],
      ['finish', 1680],
    ])
    // Un favori n'a que la longueur de ses tronçons : elle suit.
    expect(recale.segments[0].length_m).toBeCloseTo(1680, -1)
  })
})

describe('rien n’est touché quand ce n’est pas sûr', () => {
  it('au départ même, trop loin, ou hors de la boucle', () => {
    expect(startHere(carre, at(3, 2), 8)).toBeNull()
    expect(startHere(carre, at(60, 300), 8)).toBeNull()
    expect(startHere(carre, at(60, 40), 8)).toBeNull()
  })

  it('avec un relevé flou, un parcours à tours, ou un tracé qui ne boucle pas', () => {
    expect(startHere(carre, at(60, 6), 60)).toBeNull()
    expect(startHere({ ...carre, laps: 2 }, at(60, 6), 8)).toBeNull()
    expect(startHere({ ...carre, geometry: geometry.slice(0, 20) }, at(60, 6), 8)).toBeNull()
    expect(startHere(carre, null)).toBeNull()
  })
})
