import { describe, expect, it } from 'vitest'
import { lockScreenState, paceEstimate, shortDistance, shouldRefresh } from './lockScreen'
import { bearing, buildTrack, headingAt } from './routeTracker'

/**
 * L'écran de verrouillage et la carte orientée pendant la course.
 *
 * Deux choses qu'on ne vérifie pas en courant : l'heure d'arrivée annoncée
 * — une estimation folle au premier feu rouge ferait douter de tout le reste —
 * et le sens de la carte, qui ne doit pas tourner sur le bruit du GPS.
 */

const ROUTE = {
  name: 'Boucle nord',
  distance_m: 6000,
  duration_s: 2340,
  instructions: [],
}

const NOW = Date.UTC(2026, 8, 18, 18, 0, 0)

describe('les distances affichées', () => {
  it('arrondissent à ce qu’on lit en courant', () => {
    expect(shortDistance(124)).toBe('120 m')
    expect(shortDistance(1260)).toBe('1,3 km')
    expect(shortDistance(12)).toBe('maintenant')
  })
})

describe('l’heure d’arrivée', () => {
  it('suit l’allure prévue tant que l’allure réelle ne veut rien dire', () => {
    // 90 secondes pour 150 m : un feu rouge au départ, pas une allure.
    const pace = paceEstimate({ route: ROUTE, travelled: 150, elapsedS: 90 })
    expect(pace).toBeCloseTo(2340 / 6000)
  })

  it('suit l’allure réelle ensuite', () => {
    const pace = paceEstimate({ route: ROUTE, travelled: 2000, elapsedS: 600 })
    expect(pace).toBeCloseTo(0.3)
  })

  it('annonce l’arrivée d’après ce qui reste', () => {
    const state = lockScreenState({
      route: ROUTE,
      step: { step: { text: 'Tourne à gauche', turn: 'left' }, remaining: 84 },
      along: 4000,
      offRoute: false,
      travelled: 4000,
      elapsedS: 1200,
      now: NOW,
    })
    // 2 km restants à 0,3 s/m : dix minutes.
    expect(state.arrival).toBe(NOW + 600_000)
    expect(state.remaining).toBe('2,0 km')
    expect(state.distance).toBe('80 m')
    expect(state.instruction).toBe('Tourne à gauche')
    expect(state.turn).toBe('left')
    expect(state.progress).toBeCloseTo(4000 / 6000)
  })

  it('annonce l’arrivée quand il n’y a plus de consigne', () => {
    const state = lockScreenState({ route: ROUTE, step: null, along: 5990, travelled: 5990, elapsedS: 2300, now: NOW })
    expect(state.turn).toBe('finish')
    expect(state.instruction).toBe('Arrivée')
  })
})

describe('la fréquence des mises à jour', () => {
  const base = { instruction: 'Tourne à gauche', distance: '120 m', remaining: '2,0 km', offRoute: false }

  it('suit tout de suite une nouvelle consigne', () => {
    expect(shouldRefresh(base, { ...base, instruction: 'Tourne à droite' }, 200)).toBe(true)
  })

  it('suit tout de suite une pause, et la reprise', () => {
    expect(shouldRefresh(base, { ...base, paused: true }, 200)).toBe(true)
    expect(shouldRefresh({ ...base, paused: true }, { ...base, paused: false }, 200)).toBe(true)
  })

  it('suit tout de suite une sortie du tracé', () => {
    expect(shouldRefresh(base, { ...base, offRoute: true }, 200)).toBe(true)
  })

  it('ne réveille pas l’écran à chaque mètre', () => {
    expect(shouldRefresh(base, { ...base, distance: '110 m' }, 1200)).toBe(false)
    expect(shouldRefresh(base, { ...base, distance: '110 m' }, 6000)).toBe(true)
  })

  it('ne renvoie rien qui n’ait changé', () => {
    expect(shouldRefresh(base, { ...base }, 60_000)).toBe(false)
  })
})

describe('le sens de la carte', () => {
  // Un L : 500 m plein est, puis 500 m plein nord.
  const est = [2.35 + 500 / (111320 * Math.cos((48.85 * Math.PI) / 180)), 48.85]
  const L = buildTrack([[2.35, 48.85], est, [est[0], 48.85 + 500 / 111320]])

  it('mesure les caps dans le sens des aiguilles d’une montre', () => {
    expect(bearing([2.35, 48.85], [2.35, 48.86])).toBeCloseTo(0, 0)
    expect(bearing([2.35, 48.85], [2.36, 48.85])).toBeCloseTo(90, 0)
  })

  it('suit le tracé, pas le bruit', () => {
    expect(headingAt(L, 100)).toBeCloseTo(90, 0)
    expect(headingAt(L, 800)).toBeCloseTo(0, 0)
  })

  it('anticipe le virage de quelques mètres', () => {
    // À 10 m du coin, on vise déjà la branche nord : la carte pivote à temps.
    const cap = headingAt(L, 490)
    expect(cap).toBeGreaterThan(10)
    expect(cap).toBeLessThan(80)
  })
})

describe('l’avancée après un détour', () => {
  it('ne repart pas de zéro : elle suit la part de sortie faite', () => {
    const route = { distance_m: 3000, duration_s: 1200 }
    const next = lockScreenState({ route, step: null, along: 0, offRoute: false, travelled: 5000, elapsedS: 1800, share: 0.62 })
    expect(next.progress).toBeCloseTo(0.62)
  })
})

