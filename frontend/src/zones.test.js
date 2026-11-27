/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { ZONE_RADIUS, addZone, avoidedZones, listZones, removeZone, updateZone } from './zones'

/**
 * Les zones à éviter, d'une recherche à l'autre.
 *
 * Une zone dessinée doit survivre au redémarrage de l'app — c'est tout son
 * intérêt —, et se désactiver sans se perdre : la forêt de chasse redevient
 * praticable en février, et redeviendra à éviter en septembre.
 */

describe('les zones à éviter', () => {
  beforeEach(() => localStorage.clear())

  it('garde la zone dans le stockage, et la donne au moteur en disque', () => {
    addZone({ lon: 7.2, lat: 47.9, radius_m: 420, name: '  Forêt de chasse ' })
    // Relue depuis le stockage, comme après un redémarrage.
    const [zone] = listZones()
    expect(zone.name).toBe('Forêt de chasse')
    expect(avoidedZones()).toEqual([{ lon: 7.2, lat: 47.9, radius_m: 420 }])
  })

  it('borne le rayon à celui du curseur', () => {
    addZone({ lon: 7.2, lat: 47.9, radius_m: 50_000 })
    expect(listZones()[0].radius_m).toBe(ZONE_RADIUS.max)
    expect(listZones()[0].name).toBe('Zone à éviter')
  })

  it('désactivée, elle reste dans la liste mais ne compte plus', () => {
    const [zone] = addZone({ lon: 7.2, lat: 47.9, radius_m: 300 })
    updateZone(zone.id, { on: false })
    expect(listZones()).toHaveLength(1)
    expect(avoidedZones()).toEqual([])
    updateZone(zone.id, { on: true, name: 'Chantier' })
    expect(avoidedZones()).toHaveLength(1)
    expect(listZones()[0].name).toBe('Chantier')
  })

  it('garde un contour, et son nom vient de la raison', () => {
    const polygon = [
      [7.2, 47.9],
      [7.21, 47.9],
      [7.21, 47.91],
    ]
    addZone({ polygon, reason: 'works' })
    const [zone] = listZones()
    expect(zone.name).toBe('Zone travaux')
    expect(zone.reason).toBe('works')
    expect(avoidedZones()).toEqual([{ polygon }])
  })

  it('refuse un contour de moins de trois points', () => {
    expect(
      addZone({
        polygon: [
          [7.2, 47.9],
          [7.21, 47.9],
        ],
      }),
    ).toEqual([])
  })

  it('se supprime', () => {
    const [zone] = addZone({ lon: 7.2, lat: 47.9, radius_m: 300 })
    expect(removeZone(zone.id)).toEqual([])
    expect(avoidedZones()).toEqual([])
  })
})

describe('le contour d’une zone', () => {
  // Douze points touchés en désordre ne doivent pas donner une étoile croisée.
  it('range les coins autour du centre, sans qu’aucun côté n’en croise un autre', async () => {
    const { ringOf } = await import('./zones')
    const touches = [[7, 48], [7.02, 48.02], [7.02, 48], [7, 48.02], [7.01, 47.995], [7.025, 48.01]]
    const ring = ringOf(touches)
    expect(ring).toHaveLength(touches.length)
    const cross = (a, b, c, d) => {
      const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
    }
    const sides = ring.map((p, i) => [p, ring[(i + 1) % ring.length]])
    for (let i = 0; i < sides.length; i++) for (let j = i + 2; j < sides.length; j++) {
      if (i === 0 && j === sides.length - 1) continue
      expect(cross(...sides[i], ...sides[j])).toBe(false)
    }
    // Deux points ne font pas encore un contour : rendus tels quels.
    expect(ringOf(touches.slice(0, 2))).toEqual(touches.slice(0, 2))
  })

  it('garde une forme en creux telle qu’on l’a posée', async () => {
    const { ringOf } = await import('./zones')
    // Un L, coin par coin : déjà sans croisement, il ne doit pas bouger.
    const l = [[7, 48], [7.02, 48], [7.02, 48.005], [7.005, 48.005], [7.005, 48.02], [7, 48.02]]
    expect(ringOf(l)).toEqual(l)
  })
})
