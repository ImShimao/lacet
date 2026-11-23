import { describe, expect, it } from 'vitest'
import { currentWind } from './environment'
import { RELAY_URL } from './relay'

/**
 * Le vent passe par le relais de Lacet (MET Norway), plus par Open-Meteo, dont
 * l'offre gratuite est interdite à une app commerciale. On vérifie l'adresse,
 * la position arrondie au kilomètre, et le sens : le relais dit d'où vient le
 * vent, le moteur veut où il va.
 */
describe('currentWind', () => {
  it('lit le relais et retourne la direction', async () => {
    const asked = []
    const relay = async (url) => {
      asked.push(url)
      return { ok: true, json: async () => ({ speed_kmh: 20, from_deg: 270 }) }
    }
    const wind = await currentWind(47.90123, 7.21098, relay)
    expect(asked).toEqual([`${RELAY_URL}/wind?lat=47.90&lon=7.21`])
    expect(wind.speedKmh).toBe(20)
    expect(wind.bearing).toBe(90) // un vent d'ouest souffle vers l'est
  })

  it('sans relais, pas de vent — et pas d’erreur', async () => {
    const panne = async () => ({ ok: false, status: 502 })
    expect(await currentWind(10.5, 20.5, panne)).toBeNull()
  })
})
