import { describe, expect, it } from 'vitest'
import { blockedEdges } from './blocked'
import { buildGraph } from './graph'
import { buildProfile } from './weights'
import { planRejoin } from './reroute'
import { spliceRoute } from '../detour'
import { buildTrack } from '../routeTracker'

/**
 * Revenir sur la boucle, en tenant la distance.
 *
 * Un quartier en damier, rues tous les 100 m, et une boucle qui en fait le
 * tour : 2,4 km. Chaque cas est un écart qu'on fait en vrai.
 */

const N = 7
const LAT0 = 47.9
const LON0 = 7.2
const D_LAT = 100 / 111_195
const D_LON = 100 / (111_195 * Math.cos((LAT0 * Math.PI) / 180))
const at = (x, y) => [LON0 + x * D_LON, LAT0 + y * D_LAT]
const id = (x, y) => y * N + x + 1

function grid() {
  const ways = []
  let wayId = 1
  const street = (cells, name) => {
    ways.push({
      id: wayId++,
      tags: { highway: 'residential', name },
      nodes: cells.map(([x, y]) => id(x, y)),
      flat: Float64Array.from(cells.flatMap(([x, y]) => at(x, y))),
    })
  }
  for (let y = 0; y < N; y += 1) street(Array.from({ length: N }, (_, x) => [x, y]), `Rue ${y}`)
  for (let x = 0; x < N; x += 1) street(Array.from({ length: N }, (_, y) => [x, y]), `Avenue ${x}`)
  return buildGraph({ ways, landuse: [], crossings: [] })
}

/** Le tour du damier, dans le sens inverse des aiguilles d'une montre, depuis (0, 0). */
function perimeter() {
  const cells = []
  for (let x = 0; x < N; x += 1) cells.push([x, 0])
  for (let y = 1; y < N; y += 1) cells.push([N - 1, y])
  for (let x = N - 2; x >= 0; x -= 1) cells.push([x, N - 1])
  for (let y = N - 2; y >= 0; y -= 1) cells.push([0, y])
  return cells.map(([x, y]) => at(x, y))
}

const graph = grid()
const weights = buildProfile('road', 'standard', false).precompute(graph)
const loop = perimeter()
const near = (a, b) => Math.hypot((a[0] - b[0]) / D_LON, (a[1] - b[1]) / D_LAT) * 100 < 5

describe('le recalcul en course', () => {
  it('après un virage raté, rejoint la boucle devant soi — pas en arrière', () => {
    // Au lieu de continuer vers l'est en (3, 0), on a pris l'avenue 3 vers le
    // nord, et on est en (3, 2).
    const detour = planRejoin(graph, weights, {
      position: at(3, 2), heading: 0, geometry: loop, fromAlong: 300, travelledM: 500, plannedM: 2400,
    })
    expect(near(detour.coords.at(-1), at(6, 2))).toBe(true)
    expect(detour.connectM).toBeCloseTo(300, -1)
    expect(detour.steps[0].text).toMatch(/Tourne à droite dans la rue 2 pour rejoindre le parcours/)
    expect(detour.steps.at(-1).text).toMatch(/Tourne à gauche : tu retrouves le parcours/)
  })

  it('après un raccourci, va chercher ce qu’on a sauté pour tenir la distance', () => {
    // Coupé tout droit par l'avenue 3 : 1,2 km de boucle sautés.
    const detour = planRejoin(graph, weights, {
      position: at(3, 5), heading: 0, geometry: loop, fromAlong: 300, travelledM: 800, plannedM: 2400,
    })
    // La plus proche serait (3, 6), mais on finirait avec 600 m de moins.
    expect(near(detour.coords.at(-1), at(6, 5))).toBe(true)
  })

  it('très loin de la distance prévue, rentre au plus court', () => {
    // Déjà 3 km courus sur une boucle de 2,4 km : plus rien à tenir.
    const detour = planRejoin(graph, weights, {
      position: at(3, 3), heading: 0, geometry: loop, fromAlong: 300, travelledM: 3000, plannedM: 2400,
    })
    const joined = loop.findIndex((p) => near(p, detour.coords.at(-1)))
    const alongJoin = joined * 100
    // Ce qui reste depuis la jonction, plus le raccord : le plus court possible.
    expect(detour.connectM + (2400 - alongJoin)).toBeLessThanOrEqual(600 + 1)
  })

  it('part d’où l’on est, au milieu de la rue, sans revenir au carrefour d’avant', () => {
    // Sur Rue 2, quarante mètres après le carrefour (3, 2), en allant vers
    // l'est. Le carrefour le plus proche est derrière : le chemin en partait,
    // et la première consigne disait de faire demi-tour.
    const detour = planRejoin(graph, weights, {
      position: at(3.4, 2), heading: 90, geometry: loop, fromAlong: 300, travelledM: 500, plannedM: 2400,
    })
    expect(near(detour.coords.at(-1), at(6, 2))).toBe(true)
    expect(detour.connectM).toBeCloseTo(260, -1)
    // Tout le raccord est devant : aucun point en deçà de la position.
    expect(detour.coords.every(([lon]) => lon >= at(3.4, 2)[0] - 1e-9)).toBe(true)
    expect(detour.steps[0].turn).toBe('straight')
  })

  it('fait demi-tour quand la boucle est vraiment derrière', () => {
    // Même rue, mais en allant vers l'ouest : la boucle la plus juste est à
    // l'est. On le dit franchement.
    const detour = planRejoin(graph, weights, {
      position: at(3.4, 2), heading: 270, geometry: loop, fromAlong: 300, travelledM: 500, plannedM: 2400,
    })
    expect(near(detour.coords.at(-1), at(6, 2))).toBe(true)
    expect(detour.steps[0].turn).toBe('uturn')
  })

  it('rejoint la boucle après le passage fermé, jamais avant', () => {
    // Le portail en (4, 0), sur la boucle : on l'a trouvé fermé, on a fait
    // demi-tour et remonté jusqu'en (2,5 ; 0). Rejoindre la boucle en (3, 0),
    // à cinquante mètres, c'était y retourner.
    const portail = at(4, 0)
    const bloque = buildProfile('road', 'standard', false, 'run', { blocked: blockedEdges(graph, [portail]) }).precompute(graph)
    const detour = planRejoin(graph, bloque, {
      position: at(2.5, 0), heading: 270, geometry: loop, fromAlong: 250, travelledM: 350, plannedM: 2400, blocked: [portail],
    })
    const joinAlong = buildTrack(loop).cumulative[detour.joinIndex]
    expect(joinAlong).toBeGreaterThan(400)
    // Et le raccord ne passe pas par le portail.
    expect(detour.coords.some((p) => near(p, portail))).toBe(false)
  })

  it('recoud un parcours complet, consignes décalées au nouveau départ', () => {
    const route = {
      name: 'Tour du damier',
      distance_m: 2400,
      geometry: loop,
      instructions: [
        { dist_m: 0, turn: 'start', text: 'Départ' },
        { dist_m: 600, turn: 'left', text: 'Tourne à gauche sur Avenue 6' },
        { dist_m: 1200, turn: 'left', text: 'Tourne à gauche sur Rue 6' },
        { dist_m: 2400, turn: 'finish', text: 'Arrivée' },
      ],
      segments: [{ coords: loop, length_m: 2400, level: 'safe' }],
      crossings: [],
    }
    const detour = planRejoin(graph, weights, {
      position: at(3, 2), heading: 0, geometry: loop, fromAlong: 300, travelledM: 500, plannedM: 2400,
    })
    const joinAlong = buildTrack(loop).cumulative[detour.joinIndex]
    const next = spliceRoute(route, detour, joinAlong)

    // 300 m de raccord, puis 1 600 m de boucle depuis (6, 2).
    expect(next.distance_m).toBeCloseTo(1900, -1)
    const finish = next.instructions.at(-1)
    expect(finish.turn).toBe('finish')
    expect(finish.dist_m).toBeCloseTo(1900, -1)
    // Le virage en (6, 6) : 400 m après la jonction.
    expect(next.instructions.find((s) => s.text.includes('Rue 6')).dist_m).toBeCloseTo(700, -1)
    // Le virage en (6, 0) est derrière : il n'est plus annoncé.
    expect(next.instructions.some((s) => s.text.includes('Avenue 6'))).toBe(false)
    expect(next.segments[0].detour).toBe(true)
    // Le profil prévu se lit toujours sur le parcours d'origine.
    expect(1000 + next.plan_offset_m).toBeCloseTo(1500, -1)
  })
})

/**
 * Rentrer au départ : une blessure, un orage, la nuit. La distance ne compte
 * plus — le plus court chemin sûr jusqu'à la porte, qui est au milieu d'une rue.
 */
describe('le retour au départ', () => {
  // La porte, au milieu de la rue 0, entre les avenues 2 et 3.
  const porte = at(2.5, 0)
  // Le segment d'un raccord passe-t-il par ce point (le milieu d'une arête du damier) ?
  const passesBy = (coords, p) => coords.slice(1).some((c, i) => near([(c[0] + coords[i][0]) / 2, (c[1] + coords[i][1]) / 2], p))

  it('va jusqu’à la porte, sans passer devant pour aller au coin', () => {
    const retour = planRejoin(graph, weights, {
      position: at(4, 3), heading: 0, geometry: loop, fromAlong: 900, travelledM: 900, plannedM: 2400, home: porte,
    })
    expect(near(retour.coords.at(-1), porte)).toBe(true)
    // Quatre rues et demie : ni le coin d'après, ni la fin de la boucle.
    expect(retour.connectM).toBeCloseTo(450, -1)
    expect(retour.joinIndex).toBe(loop.length - 1)
    expect(retour.steps[0].text).toMatch(/pour rentrer\.$/)
  })

  it('contourne les rues signalées, même plus longues', () => {
    // Les avenues 2 et 3 barrées juste avant la rue 0 : le plus court (300 m)
    // y passait.
    const barrages = [at(2, 0.5), at(3, 0.5)]
    const prudent = buildProfile('road', 'standard', false, 'run', { blocked: blockedEdges(graph, barrages) }).precompute(graph)
    const retour = planRejoin(graph, prudent, {
      position: at(2.5, 2), heading: 180, geometry: loop, fromAlong: 900, travelledM: 900, plannedM: 2400, home: porte, blocked: barrages,
    })
    expect(near(retour.coords.at(-1), porte)).toBe(true)
    for (const b of barrages) expect(passesBy(retour.coords, b)).toBe(false)
    expect(retour.connectM).toBeCloseTo(500, -1)
  })

  it('remplace la fin de la boucle — et des tours — par l’arrivée à la porte', () => {
    const tours = {
      name: 'Deux tours du damier',
      distance_m: 4800,
      laps: 2,
      lap_distance_m: 2400,
      geometry: [...loop, ...loop.slice(1)],
      instructions: [
        { dist_m: 0, turn: 'start', text: 'Départ' },
        { dist_m: 4800, turn: 'finish', text: 'Dernier tour bouclé. Les 2 tours sont terminés.' },
      ],
      segments: [],
      crossings: [],
    }
    const retour = planRejoin(graph, weights, {
      position: at(6, 3), heading: 0, geometry: tours.geometry, fromAlong: 900, travelledM: 900, plannedM: 4800, home: loop[0],
    })
    const next = spliceRoute(tours, retour, buildTrack(tours.geometry).cumulative[retour.joinIndex], { home: true })
    // Rien de la boucle après la porte : neuf rues jusqu'au coin (0, 0), pas
    // le tour et demi qui restait.
    expect(next.distance_m).toBeCloseTo(900, -1)
    expect(near(next.geometry.at(-1), loop[0])).toBe(true)
    expect(next.instructions.at(-1)).toMatchObject({ turn: 'finish', text: 'Te voilà rentré au départ.' })
    expect(next.instructions.some((s) => s.text.includes('tours'))).toBe(false)
    expect(next.home).toBe(true)
  })
})
