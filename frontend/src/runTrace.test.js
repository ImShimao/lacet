import { describe, expect, it } from 'vitest'
import { climbProfile, paceBands } from './runTrace'

/**
 * Ce que l'écran de fin tire d'une trace horodatée : l'allure de chaque
 * tronçon, et le profil monté. Une sortie régulière ne doit pas se peindre du
 * vert au rouge, un feu rouge ne doit pas passer pour un coup de mou, et du
 * plat ne doit pas dessiner une montagne.
 */

// Une ligne droite vers l'est, un point tous les dix mètres.
const pas = 10 / (111_320 * Math.cos((47.9 * Math.PI) / 180))
const droite = (n) => Array.from({ length: n }, (_, i) => [7.2 + i * pas, 47.9])

/** L'heure de chaque point, à `vitesse(i)` mètres par seconde sur le tronçon qui y mène. */
const heures = (n, vitesse) => {
  const out = [0]
  for (let i = 1; i < n; i += 1) out.push(out[i - 1] + 10 / vitesse(i))
  return out
}

describe('l’allure le long de la trace', () => {
  it('laisse une sortie régulière d’une seule couleur', () => {
    const bandes = paceBands(droite(200), heures(200, () => 3))
    expect(new Set(bandes)).toEqual(new Set([2]))
  })

  it('peint le kilomètre rapide en vert et le lent en rouge', () => {
    // Un tiers à 4 m/s, un tiers à 3, un tiers à 2.
    const bandes = paceBands(droite(300), heures(300, (i) => (i < 100 ? 4 : i < 200 ? 3 : 2)))
    expect(bandes[40]).toBe(0)
    expect(bandes[150]).toBe(2)
    expect(bandes[260]).toBe(4)
  })

  it('ne compte pas un arrêt au feu comme un coup de mou', () => {
    const t = heures(200, () => 3)
    // Quarante secondes sans bouger au centième point.
    for (let i = 100; i < 200; i += 1) t[i] += 40
    expect(paceBands(droite(200), t)[99]).toBe(2)
  })

  it('se tait sans heures, ou quand elles manquent sur plus de la moitié', () => {
    expect(paceBands(droite(50), null)).toBeNull()
    const t = heures(200, () => 3).map((s, i) => (i < 150 ? null : s))
    expect(paceBands(droite(200), t)).toBeNull()
  })
})

describe('le profil monté', () => {
  it('dit le sommet, et le gain sur le départ', () => {
    // Trente mètres de montée jusqu'au milieu, puis la descente.
    const alts = Array.from({ length: 101 }, (_, i) => 250 + 30 * (1 - Math.abs(i - 50) / 50))
    const profil = climbProfile(droite(101), alts, 320, 64)
    expect(Math.round(profil.gain)).toBe(30)
    expect(Math.abs(profil.topM - 500)).toBeLessThan(5)
    expect(profil.d.startsWith('M0 ')).toBe(true)
  })

  it('ne dessine rien sur du plat, ni sans altitudes', () => {
    expect(climbProfile(droite(101), Array(101).fill(250.4), 320, 64)).toBeNull()
    expect(climbProfile(droite(101), Array(101).fill(null), 320, 64)).toBeNull()
    expect(climbProfile(droite(101), undefined, 320, 64)).toBeNull()
  })
})
