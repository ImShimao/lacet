import { describe, expect, it } from 'vitest'
import { fetchMany } from './environment'

/**
 * L'altitude des boucles proposées.
 *
 * Une fois les rues préparées en fond, c'était l'étape la plus lente d'une
 * recherche : quatre à cinq secondes. Mesuré sur le service de l'IGN, mille
 * points passent en moins d'une seconde en un seul envoi, et en plus de cinq en
 * dix petits envois simultanés — le service les met en file. On vérifie donc la
 * forme des requêtes, pas seulement leur résultat.
 */

/** Un faux service IGN : l'altitude vaut la longitude × 100, pour vérifier l'ordre. */
function fakeIgn({ postFails = false } = {}) {
  const calls = []
  let inFlight = 0
  let peak = 0
  const answer = (lons) => ({
    ok: true,
    status: 200,
    json: async () => ({ elevations: lons.map((lon) => ({ z: Number(lon) * 100 })) }),
  })
  const fetchImpl = async (url, options = {}) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      calls.push({ method: 'POST', points: body.lon.split('|').length })
      if (postFails) return { ok: false, status: 405, json: async () => ({}) }
      return answer(body.lon.split('|'))
    }
    const params = new URL(url).searchParams
    calls.push({ method: 'GET', points: params.get('lon').split('|').length })
    return answer(params.get('lon').split('|'))
  }
  return { fetchImpl, calls, peak: () => peak }
}

/** `n` points distincts, dans une zone propre à chaque test (le cache est partagé). */
const points = (n, zone) => Array.from({ length: n }, (_, i) => [zone + i * 0.0001, 45 + i * 0.00005])

describe("l'altitude", () => {
  it('part en un seul envoi pour une recherche ordinaire', async () => {
    const ign = fakeIgn()
    const route = points(900, 1)
    const [values] = await fetchMany([route], { fetchImpl: ign.fetchImpl, providers: ['ign'] })
    expect(ign.calls).toEqual([{ method: 'POST', points: 900 }])
    expect(values[0]).toBeCloseTo(route[0][0] * 100, 3)
    expect(values[899]).toBeCloseTo(route[899][0] * 100, 3)
  })

  it('découpe les très longues sorties en gros lots, jamais en même temps', async () => {
    const ign = fakeIgn()
    await fetchMany([points(2500, 2)], { fetchImpl: ign.fetchImpl, providers: ['ign'] })
    expect(ign.calls.map((c) => c.points)).toEqual([1000, 1000, 500])
    expect(ign.peak()).toBe(1)
  })

  it('retombe sur les petits envois si le POST est refusé', async () => {
    const ign = fakeIgn({ postFails: true })
    const route = points(250, 3)
    const [values] = await fetchMany([route], { fetchImpl: ign.fetchImpl, providers: ['ign'] })
    expect(ign.calls.map((c) => `${c.method} ${c.points}`)).toEqual(['POST 250', 'GET 100', 'GET 100', 'GET 50'])
    expect(values[249]).toBeCloseTo(route[249][0] * 100, 3)
  })
})
