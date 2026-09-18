import { describe, expect, it } from 'vitest'
import { motionTracker } from './autoPause'

/**
 * La pause automatique.
 *
 * Elle ne doit jamais mettre en pause quelqu'un qui avance : cela fausserait la
 * sortie pour de bon. Rater une pause, en revanche, ne coûte que quelques
 * secondes. On vérifie donc surtout les faux arrêts — la côte montée en
 * marchant, le GPS qui tremble — autant que les vrais.
 */

const START = [7.2225, 47.8875]
const METRE_LAT = 1 / 110540

/** Un point à `north` mètres au nord et `east` mètres à l'est du départ. */
function at(north, east = 0) {
  const kx = Math.cos((START[1] * Math.PI) / 180) * 111320
  return [START[0] + east / kx, START[1] + north * METRE_LAT]
}

/** Des relevés chaque seconde : `positions` en mètres vers le nord. */
function feed(tracker, positions, { speeds = null, from = 0 } = {}) {
  return positions.map((north, i) =>
    tracker.push({ t: (from + i) * 1000, point: at(north), speed: speeds ? speeds[i] : null }),
  )
}

// Une petite secousse de GPS immobile, reproductible : quelques mètres autour du point.
const jitter = (i) => [1.5, -2, 0.5, 2.5, -1, -2.5, 1, 0, -1.5, 2][i % 10]

describe('sans vitesse du téléphone (navigateur)', () => {
  it('met en pause après huit secondes immobile, GPS tremblant compris', () => {
    const t = motionTracker()
    const running = Array.from({ length: 10 }, (_, i) => i * 3)
    const standing = Array.from({ length: 12 }, (_, i) => 27 + jitter(i))
    const events = feed(t, [...running, ...standing])
    expect(events.filter(Boolean)).toEqual(['stop'])
    expect(t.stopped).toBe(true)
    // L'arrêt a commencé avant d'être certain : le chrono le décompte aussi.
    const detected = events.indexOf('stop') * 1000
    expect(detected - t.since).toBeGreaterThanOrEqual(7000)
  })

  it('ne met jamais en pause une côte montée en marchant', () => {
    // 1 m/s : l'allure d'une montée raide avalée au pas.
    const t = motionTracker()
    const events = feed(t, Array.from({ length: 40 }, (_, i) => i * 1))
    expect(events.filter(Boolean)).toEqual([])
  })

  it('ne met pas en pause un coureur lent', () => {
    const t = motionTracker()
    const events = feed(t, Array.from({ length: 60 }, (_, i) => i * 2.2))
    expect(events.filter(Boolean)).toEqual([])
  })

  it('repart dès qu’on s’éloigne du point d’arrêt', () => {
    const t = motionTracker()
    feed(t, Array.from({ length: 12 }, (_, i) => jitter(i)))
    expect(t.stopped).toBe(true)
    const events = feed(t, [3, 6, 9, 12, 15, 18], { from: 12 })
    expect(events.filter(Boolean)).toEqual(['resume'])
    expect(t.stopped).toBe(false)
  })

  it('ne se remet pas en pause aussitôt reparti', () => {
    const t = motionTracker()
    feed(t, Array.from({ length: 12 }, (_, i) => jitter(i)))
    const events = feed(t, Array.from({ length: 10 }, (_, i) => 4 + i * 3), { from: 12 })
    expect(events.filter(Boolean)).toEqual(['resume'])
  })
})

describe('avec la vitesse du téléphone (iPhone)', () => {
  it('se fie à la vitesse mesurée plutôt qu’aux positions', () => {
    // Positions qui tremblent de plus de cinq mètres, mais vitesse nulle : on
    // est bien arrêté.
    const t = motionTracker()
    const events = feed(
      t,
      Array.from({ length: 10 }, (_, i) => jitter(i) * 2),
      { speeds: Array(10).fill(0.1) },
    )
    expect(events.filter(Boolean)).toEqual(['stop'])
  })

  it('repart sur deux relevés en mouvement, sans attendre quinze mètres', () => {
    const t = motionTracker()
    feed(t, Array(10).fill(0), { speeds: Array(10).fill(0) })
    const events = feed(t, [1, 3.5], { speeds: [2.5, 2.8], from: 10 })
    expect(events).toEqual([null, 'resume'])
  })

  it('ne s’arrête pas pour une seconde d’hésitation', () => {
    const t = motionTracker()
    const speeds = [3, 3, 3, 0.2, 0.3, 3, 3, 3, 3, 3, 3, 3]
    const positions = speeds.reduce((acc, s, i) => [...acc, (acc[i - 1] ?? 0) + s], [])
    const events = feed(t, positions, { speeds })
    expect(events.filter(Boolean)).toEqual([])
  })
})
