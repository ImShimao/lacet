import { describe, expect, it } from 'vitest'
import { duration, haversine, km, pace, percent, profileRange, surfaceLabel } from './format'

/**
 * Le formatage des chiffres affichés.
 *
 * C'est le genre de code qu'on ne teste jamais parce qu'il « ne peut pas se
 * tromper ». Il se trompait : l'allure affichait « 4:60 » dès qu'elle tombait
 * dans la dernière demi-seconde d'une minute — en gros chiffres, au milieu de
 * l'écran, pendant qu'on court.
 */

describe('pace', () => {
  it('formate une allure ordinaire', () => {
    expect(pace(390)).toBe('6:30')
    expect(pace(300)).toBe('5:00')
  })

  it('ne produit jamais soixante secondes', () => {
    // Le bug : `floor(x/60)` d'un côté et `round(x%60)` de l'autre donnaient
    // « 4:60 ». L'allure se recalcule à chaque relevé GPS, donc ça se voyait
    // plusieurs fois par sortie.
    expect(pace(299.7)).toBe('5:00')
    expect(pace(359.6)).toBe('6:00')
    expect(pace(599.9)).toBe('10:00')
  })

  it('n’affiche jamais soixante, quelle que soit la valeur', () => {
    for (let s = 150; s <= 1200; s += 0.1) {
      const [, secondes] = pace(s).split(':')
      expect(Number(secondes)).toBeLessThan(60)
    }
  })

  it('complète les secondes à deux chiffres', () => {
    expect(pace(305)).toBe('5:05')
  })

  it('refuse ce qui n’est pas une allure', () => {
    expect(pace(0)).toBe('—')
    expect(pace(-3)).toBe('—')
    expect(pace(NaN)).toBe('—')
    expect(pace(Infinity)).toBe('—')
  })
})

describe('duration', () => {
  it('omet les heures tant qu’il n’y en a pas', () => {
    expect(duration(90)).toBe('1:30')
    expect(duration(59)).toBe('0:59')
  })

  it('ajoute les heures au-delà', () => {
    expect(duration(3661)).toBe('1:01:01')
    expect(duration(7200)).toBe('2:00:00')
  })

  it('part de zéro', () => {
    expect(duration(0)).toBe('0:00')
  })
})

describe('km', () => {
  it('convertit avec deux décimales par défaut, à la française', () => {
    expect(km(10_012)).toBe('10,01')
  })

  it('accepte une autre précision', () => {
    expect(km(10_012, 1)).toBe('10,0')
    expect(km(10_012, 0)).toBe('10')
  })
})

describe('profileRange', () => {
  it('donne à une boucle plate un axe où elle a l’air plate', () => {
    // Vingt mètres d'écart : ils n'occupent qu'un tiers de la hauteur, en bas.
    const [lo, hi] = profileRange([187, 199, 207, 190])
    expect(hi - lo).toBe(60)
    expect(lo).toBeLessThan(187)
    expect(hi).toBeGreaterThan(207)
    expect((187 - lo) / (hi - lo)).toBeLessThan(0.25)
  })

  it('suit le relief quand il y en a', () => {
    expect(profileRange([200, 450, 320])).toEqual([200, 450])
  })
})

describe('percent', () => {
  it('arrondit et suffixe', () => {
    expect(percent(0.954)).toBe('95 %')
    expect(percent(0)).toBe('0 %')
  })
})

describe('surfaceLabel', () => {
  it('traduit les revêtements constatés', () => {
    expect(surfaceLabel('paved')).toBe('bitume')
    expect(surfaceLabel('trail')).toBe('sentier')
  })

  it('rend la clé telle quelle si elle est inconnue', () => {
    expect(surfaceLabel('lave')).toBe('lave')
  })
})

describe('haversine', () => {
  it('mesure un degré de latitude', () => {
    // ~111,2 km, la référence qui permet de vérifier l'ordre de grandeur.
    expect(haversine([2.35, 48.0], [2.35, 49.0])).toBeCloseTo(111_195, -2)
  })

  it('raccourcit un degré de longitude avec la latitude', () => {
    const equateur = haversine([0, 0], [1, 0])
    const paris = haversine([2, 48.85], [3, 48.85])
    expect(paris).toBeLessThan(equateur * 0.7)
  })

  it('rend zéro pour deux points confondus', () => {
    expect(haversine([2.35, 48.85], [2.35, 48.85])).toBe(0)
  })

  it('est symétrique', () => {
    const a = [2.35, 48.85]
    const b = [2.36, 48.86]
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 9)
  })
})
