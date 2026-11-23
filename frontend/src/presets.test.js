/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PRESETS, parsePresets, presets, setPresets } from './presets'

/**
 * Les raccourcis de distance : ce qu'on tape dans « Mon compte » doit donner
 * la liste qu'on croit, virgule française comprise, et une saisie ratée ne doit
 * jamais vider l'accueil de ses raccourcis.
 */
afterEach(() => localStorage.clear())

describe('parsePresets', () => {
  it('lit la virgule décimale et trie', () => {
    expect(parsePresets('15, 5 ; 10,5 3')).toEqual([3, 5, 10.5, 15])
  })

  it('écarte le zéro, les doublons et le texte', () => {
    expect(parsePresets('5 5 0 abc 8')).toEqual([5, 8])
  })

  it('ne rend rien quand rien ne vaut', () => {
    expect(parsePresets('abc')).toBeNull()
  })
})

describe('presets', () => {
  it('rend les valeurs par défaut, puis celles réglées', () => {
    expect(presets('run')).toEqual(DEFAULT_PRESETS.run)
    setPresets('run', [4, 8])
    expect(presets('run')).toEqual([4, 8])
    expect(presets('duration')).toEqual(DEFAULT_PRESETS.duration)
  })
})
