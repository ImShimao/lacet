import { describe, expect, it } from 'vitest'
import { RACES, formatKm, raceOf } from './FiltersSheet.jsx'

/**
 * Les distances, telles qu'on les lit et telles qu'on les saisit.
 *
 * Un pas de 0,1 km ajouté en binaire donnait « 42.300000000000004 km » sur la
 * pastille d'activité : le genre de détail qui fait douter de tout le reste.
 */

describe('la distance affichée', () => {
  it('ne laisse jamais traîner de flottant', () => {
    expect(formatKm(42.300000000000004)).toBe('42,3')
    expect(formatKm(10)).toBe('10')
    expect(formatKm(10.5)).toBe('10,5')
  })

  it('garde le mètre quand on l’a saisi', () => {
    expect(formatKm(8.425)).toBe('8,425')
    expect(formatKm(21.0975)).toBe('21,098')
  })
})

describe('les distances de course', () => {
  it('reconnaît le semi et le marathon à leur valeur exacte', () => {
    expect(raceOf(21.0975).label).toBe('Semi')
    expect(raceOf(42.195).label).toBe('Marathon')
    expect(raceOf(21.5)).toBeNull()
  })

  it('les donne au mètre près, pas arrondies', () => {
    expect(RACES.map((r) => r.km)).toEqual([5, 10, 21.0975, 42.195])
  })
})
