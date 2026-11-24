/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { figuresOf, templatesFor } from './shareCard'
import { setUnits } from './units'

/**
 * Ce que dit l'image partagée : les chiffres de la sortie, dans l'unité choisie,
 * et seulement les modèles qui ont de quoi se dessiner.
 */
afterEach(() => setUnits('km'))

const course = { actual_distance_m: 10000, actual_duration_s: 3000, actual_ascent_m: 84, sport: 'run' }
const velo = { actual_distance_m: 40000, actual_duration_s: 4800, actual_ascent_m: null, sport: 'bike' }

describe('les chiffres partagés', () => {
  it('donnent distance, allure, temps et D+ d’une course', () => {
    expect(figuresOf(course)).toEqual([
      ['10,00 km', 'Distance'],
      ['5:00 /km', 'Allure'],
      ['50:00', 'Temps'],
      ['84 m', 'Dénivelé +'],
    ])
  })

  it('donnent la vitesse à vélo, et taisent un D+ inconnu', () => {
    const f = figuresOf(velo)
    expect(f[1]).toEqual(['30,0 km/h', 'Vitesse'])
    expect(f.find(([, l]) => l === 'Dénivelé +')).toBeUndefined()
  })

  it('suivent les miles, vitesse comprise', () => {
    setUnits('mi')
    expect(figuresOf(course)[0][0]).toMatch(/ mi$/)
    expect(figuresOf(course)[1][0]).toMatch(/\/mi$/)
    // 30 km/h, c'est 18,6 mph : l'image disait « 30,0 km/h » en miles.
    expect(figuresOf(velo)[1][0]).toBe('18,6 mph')
  })
})

describe('les modèles d’image', () => {
  it('ne proposent la trace et les kilomètres que s’il y en a', () => {
    expect(templatesFor(course).map((t) => t.key)).toEqual(['card', 'figures', 'band'])
    const complete = { ...course, track: [[7, 47], [7.01, 47.01]], splits: [{ km: 1 }, { km: 2 }] }
    expect(templatesFor(complete).map((t) => t.key)).toEqual(['card', 'trace', 'figures', 'band', 'splits'])
  })
})
