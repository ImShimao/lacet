import { describe, expect, it } from 'vitest'
import { timeTotal } from './Library.jsx'

/** Le temps cumulé de « Mes parcours », dit dans l'unité qui convient. */
describe('timeTotal', () => {
  it('compte en minutes sous l’heure, plutôt que « 0 heures »', () => {
    expect(timeTotal(57 * 60)).toEqual([57, 'minutes'])
    expect(timeTotal(60)).toEqual([1, 'minute'])
  })

  it('accorde les heures', () => {
    expect(timeTotal(65 * 60)).toEqual([1, 'heure'])
    expect(timeTotal(5 * 3600)).toEqual([5, 'heures'])
  })
})
