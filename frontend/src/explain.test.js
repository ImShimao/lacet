import { describe, expect, it } from 'vitest'
import { climbBand, climbMismatch, compareRoutes, nightfall, reliefBadge, reliefMismatch, reliefOf, surfaceMismatch, weatherAdvice } from './explain'

/** La tenue conseillée d'après la météo du relais ; rien sans température. */
describe('weatherAdvice', () => {
  it('la pluie passe avant le froid, et le chaud demande de l’eau', () => {
    expect(weatherAdvice(null)).toBeNull()
    expect(weatherAdvice({ temp_c: 2, rain_mm: 0.5 }).icon).toBe('rain')
    expect(weatherAdvice({ temp_c: 2, rain_mm: 0 }).text).toMatch(/^2 °C au départ : gants/)
    expect(weatherAdvice({ temp_c: 29, rain_mm: 0 }).text).toMatch(/eau/)
    expect(weatherAdvice({ temp_c: 14.4, rain_mm: 0.1 }).text).toBe('14 °C et sec au départ.')
  })
})

/**
 * Le caractère d'une boucle, dans l'en-tête de son profil. « Côtes » doit
 * commencer où commence la bande de « Côtes » : sinon une boucle rendue pour
 * « Côtes », sans avertissement, se lirait « Vallonné ».
 */
describe('reliefOf', () => {
  it('suit les mots des réglages, et se tait sans altitude', () => {
    expect(reliefOf({ distance_m: 10000, ascent_m: 30 })).toBe('Plat')
    expect(reliefOf({ distance_m: 10000, ascent_m: 100 })).toBe('Vallonné')
    expect(reliefOf({ distance_m: 10000, ascent_m: 120 })).toBe('Côtes')
    expect(reliefOf({ distance_m: 10000, ascent_m: null })).toBeNull()
  })
})

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

/**
 * Le badge d'un relief avant de chercher — `reliefBadge`. Sans estimation (tuiles
 * absentes), pas de badge du tout.
 */
describe('reliefBadge', () => {
  it('sans estimation, pas de badge', () => {
    expect(reliefBadge('flat', null)).toBeNull()
  })

  // Les reliefs mesurés au départ, et ce que les boucles y ont vraiment donné.
  it('Plat tient à Soultz et Guebwiller, pas à Buhl ni Lautenbach', () => {
    expect(reliefBadge('flat', 34.6)).toBe('Probable') // Soultz : boucles à 3,5-5 m/km
    expect(reliefBadge('flat', 65.2)).toBe('Possible') // Guebwiller : 7 m/km au mieux
    expect(reliefBadge('flat', 81.5)).toBe('Peu probable') // Buhl : 22 m/km au mieux
  })

  it('Côtes vient dès Rouffach, jamais à Ensisheim', () => {
    expect(reliefBadge('hilly', 21.2)).toBe('Probable')
    expect(reliefBadge('hilly', 14.8)).toBe('Possible')
    expect(reliefBadge('hilly', 5.5)).toBe('Peu probable')
  })

  it('Vallonné manque en pleine plaine et au fond des vallées', () => {
    expect(reliefBadge('rolling', 5.5)).toBe('Peu probable')
    expect(reliefBadge('rolling', 34.6)).toBe('Probable')
    expect(reliefBadge('rolling', 98.2)).toBe('Peu probable')
  })

  it('un D+ précis tient jusqu’à la moitié du relief, et peu de D+ en montagne reste du plat', () => {
    expect(reliefBadge('climb', 98.2, 40)).toBe('Probable')
    expect(reliefBadge('climb', 98.2, 70)).toBe('Possible')
    expect(reliefBadge('climb', 98.2, 90)).toBe('Peu probable')
    expect(reliefBadge('climb', 98.2, 5)).toBe('Peu probable')
  })
})

/** Deux propositions face à face : un gagnant par ligne quand l'écart compte, et la phrase qui le dit. */
describe('compareRoutes', () => {
  const safe = { distance_m: 10100, duration_s: 3900, ascent_m: 40, safety: { grade: 'A', protected_share: 0.92, unprotected_crossings: 1 } }
  const fast = { distance_m: 9800, duration_s: 3780, ascent_m: 95, safety: { grade: 'B', protected_share: 0.71, unprotected_crossings: 4 } }

  it('dit ce que chacune gagne', () => {
    const { rows, verdict } = compareRoutes(safe, fast)
    expect(rows.find((r) => r.label === 'Note')).toMatchObject({ a: 'A', b: 'B', best: 'a' })
    expect(rows.find((r) => r.label === 'Durée').best).toBe('b')
    expect(rows.find((r) => r.label === 'Distance').best).toBeNull()
    expect(verdict).toBe(
      "La 1 est plus sûre (A contre B), monte 55 m de moins, a 21 points de plus à l'abri du trafic et traverse 3 fois de moins sans protection ; la 2 gagne 2 min.",
    )
  })

  it('ne désigne pas de gagnant pour un écart qui ne compte pas', () => {
    const twin = { ...safe, duration_s: 3930, ascent_m: 45 }
    const { rows, verdict } = compareRoutes(safe, twin)
    expect(rows.every((r) => r.best === null)).toBe(true)
    expect(verdict).toMatch(/se valent/)
  })

  it("reste lisible sans note ni relief", () => {
    const { rows } = compareRoutes({ distance_m: 5000 }, { distance_m: 5200 })
    expect(rows.map((r) => r.label)).toEqual(['Distance'])
  })
})
