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

/**
 * Un faux couple de fournisseurs : l'IGN ne connaît que la France (longitude
 * inférieure à 7,2 ici), Valhalla connaît tout mais répond mille mètres.
 */
function fakeBorder() {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('/height')) {
      const shape = JSON.parse(options.body).shape
      calls.push({ service: 'valhalla', points: shape.length })
      return { ok: true, json: async () => ({ height: shape.map(() => 1000) }) }
    }
    const lonsOf = (texte) => texte.split('|').map(Number)
    const lons = options.method === 'POST' ? lonsOf(JSON.parse(options.body).lon) : lonsOf(new URL(url).searchParams.get('lon'))
    calls.push({ service: 'ign', points: lons.length })
    // Hors de France, le service répond -99999 : pas de donnée, pas zéro mètre.
    return { ok: true, json: async () => ({ elevations: lons.map((lon) => ({ z: lon < 7.2 ? lon * 100 : -99999 })) }) }
  }
  return { fetchImpl, calls }
}

describe("l'altitude hors de la zone couverte", () => {
  const providers = ['ign', 'valhalla']

  it('ne prend pas un point sans donnée pour un point à zéro mètre', async () => {
    // Cinq boucles en Valais annonçaient « D+ 0 m » : l'IGN répondait -99999,
    // et ces -99999 passaient pour le niveau de la mer. Pire, la réponse
    // passait pour valide, et le fournisseur mondial n'était jamais interrogé.
    const { fetchImpl } = fakeBorder()
    const suisse = [
      [7.3856, 46.2578],
      [7.386, 46.258],
    ]
    const [values] = await fetchMany([suisse], { fetchImpl, providers })
    expect(values).toEqual([1000, 1000])
  })

  it('demande les altitudes lointaines à un service qui répond aux navigateurs', async () => {
    // Le repli précédent, OpenTopoData, n'envoie aucun en-tête CORS : depuis
    // une page, l'appel échoue avant même de partir. Le défaut ne se voyait
    // nulle part — le repli avalait l'erreur et rendait des boucles sans
    // relief. On vérifie donc à qui l'on parle, et comment.
    const envois = []
    const fetchImpl = async (url, options = {}) => {
      envois.push({ url: String(url), méthode: options.method })
      const shape = JSON.parse(options.body).shape
      return { ok: true, json: async () => ({ height: shape.map(() => 500) }) }
    }
    const [values] = await fetchMany([[[8.5, 47.3]]], { fetchImpl, providers: ['valhalla'] })
    expect(envois).toEqual([{ url: 'https://valhalla1.openstreetmap.de/height', méthode: 'POST' }])
    expect(values).toEqual([500])
  })

  it('envoie les points par lots de cinq cents, un envoi à la fois', async () => {
    let enCours = 0
    let pointe = 0
    const lots = []
    const fetchImpl = async (url, options = {}) => {
      enCours += 1
      pointe = Math.max(pointe, enCours)
      await new Promise((r) => setTimeout(r, 5))
      enCours -= 1
      const shape = JSON.parse(options.body).shape
      lots.push(shape.length)
      return { ok: true, json: async () => ({ height: shape.map(() => 500) }) }
    }
    await fetchMany([points(1200, 12)], { fetchImpl, providers: ['valhalla'] })
    expect(lots).toEqual([500, 500, 200])
    expect(pointe).toBe(1)
  })

  it('n’interroge le second fournisseur que sur ce que le premier ignore', async () => {
    const { fetchImpl, calls } = fakeBorder()
    const frontière = [
      [7.1, 47.5],
      [7.11, 47.5],
      [7.3, 47.5],
    ]
    const [values] = await fetchMany([frontière], { fetchImpl, providers })
    expect(values[0]).toBeCloseTo(710, 3)
    expect(values[2]).toBe(1000)
    expect(calls.filter((c) => c.service === 'valhalla')).toEqual([{ service: 'valhalla', points: 1 }])
  })

  it('rend un tracé sans profil plutôt qu’un dénivelé calculé sur des trous', async () => {
    const seulIgn = fakeBorder()
    const suisse = [
      [7.5, 46.3],
      [7.51, 46.3],
    ]
    const [values] = await fetchMany([suisse], { fetchImpl: seulIgn.fetchImpl, providers: ['ign'] })
    expect(values).toBeNull()
  })
})

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
    // Le service refuse au-delà de cinq mille points par envoi (« HTTP 400 »),
    // et met les requêtes simultanées en file : au-delà, on enchaîne.
    const ign = fakeIgn()
    await fetchMany([points(12_000, 2)], { fetchImpl: ign.fetchImpl, providers: ['ign'] })
    expect(ign.calls.map((c) => c.points)).toEqual([5000, 5000, 2000])
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
