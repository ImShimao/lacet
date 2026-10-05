import { describe, expect, it } from 'vitest'
import { reliefMismatch } from './explain'

/**
 * Le relief demandé que le terrain ne donne pas. À Colmar, « Côtes » rendait
 * cinq boucles de 8 à 23 m de D+ sur 10 km, sans un mot.
 */

const boucle = (ascent_m, distance_m = 10_000) => ({ ascent_m, distance_m })

describe('reliefMismatch', () => {
  it('dit qu’il n’y a pas de côtes en plaine', () => {
    expect(reliefMismatch('hilly', [boucle(8), boucle(23), boucle(11)])).toEqual({ kind: 'hilly', ascent: 23 })
  })

  it('se tait dès qu’une boucle a de vraies côtes', () => {
    expect(reliefMismatch('hilly', [boucle(23), boucle(160)])).toBeNull()
  })

  it('dit qu’il n’y a pas de plat en montagne', () => {
    expect(reliefMismatch('flat', [boucle(240), boucle(180)])).toEqual({ kind: 'flat', ascent: 180 })
    expect(reliefMismatch('flat', [boucle(240), boucle(60)])).toBeNull()
  })

  it('ne juge ni « Vallonné », ni des boucles sans altitude', () => {
    expect(reliefMismatch('rolling', [boucle(8)])).toBeNull()
    expect(reliefMismatch('hilly', [boucle(null)])).toBeNull()
  })
})
