import { describe, expect, it } from 'vitest'
import { climbBand, climbMismatch, nightfall, reliefMismatch, surfaceMismatch } from './explain'

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

/** Le D+ visé que le coin n'offre pas : 400 m en pleine plaine. */
describe('climbMismatch', () => {
  it('reprend la fourchette du moteur', () => {
    expect(climbBand(150, 10)).toEqual([120, 180])
    // Jamais moins de 2 m/km de part et d'autre : 20 m sur 10 km.
    expect(climbBand(40, 10)).toEqual([20, 60])
  })

  it('dit ce qui s’en approche le plus quand rien ne tombe dedans', () => {
    expect(climbMismatch(400, [boucle(120), boucle(210), boucle(90)])).toEqual({ kind: 'climb', ascent: 210 })
  })

  it('se tait dès qu’une boucle tient le D+, ou sans D+ visé', () => {
    expect(climbMismatch(150, [boucle(60), boucle(170)])).toBeNull()
    expect(climbMismatch(null, [boucle(60)])).toBeNull()
  })
})

/** Le terrain demandé que le coin n'a pas : « Sentier » en plein centre-ville. */
describe('surfaceMismatch', () => {
  const terrain = (chemins_m, distance_m = 10_000) => ({
    distance_m,
    surfaces: { paved_m: distance_m - chemins_m, gravel_m: chemins_m / 2, trail_m: chemins_m / 2, unknown_m: 0 },
  })

  it('dit qu’il n’y a pas de sentiers en ville', () => {
    expect(surfaceMismatch('trail', [terrain(500), terrain(2100), terrain(0)])).toEqual({ kind: 'trail', share: 21 })
  })

  it('se tait dès qu’une boucle tient la fourchette', () => {
    expect(surfaceMismatch('trail', [terrain(500), terrain(6000)])).toBeNull()
    expect(surfaceMismatch('road', [terrain(3000), terrain(400)])).toBeNull()
  })

  it('dit qu’il n’y a pas de boucle goudronnée entre les vignes', () => {
    expect(surfaceMismatch('road', [terrain(3000), terrain(1800)])).toEqual({ kind: 'road', share: 18 })
  })

  it('ne juge pas « Mixte », réglé par défaut', () => {
    expect(surfaceMismatch('mixed', [terrain(0)])).toBeNull()
  })
})

describe('la nuit qui tombe pendant la boucle', () => {
  // Guebwiller, le 19 octobre : le soleil s'y couche vers 18 h 30, heure de Paris.
  const [lat, lon] = [47.91, 7.21]
  const at = (h, m) => Date.UTC(2026, 9, 19, h - 2, m)

  it('donne l’heure où elle tombe, à la minute près', () => {
    const t = nightfall(lat, lon, 3600, at(18, 0))
    expect(t).not.toBeNull()
    expect(t - at(18, 0)).toBeGreaterThan(10 * 60_000)
    expect(t - at(18, 0)).toBeLessThan(55 * 60_000)
  })

  it('se tait de jour à l’arrivée comme de nuit au départ', () => {
    expect(nightfall(lat, lon, 3600, at(14, 0))).toBeNull()
    expect(nightfall(lat, lon, 3600, at(21, 0))).toBeNull()
  })
})
