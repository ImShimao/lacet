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
