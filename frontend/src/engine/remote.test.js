import { describe, expect, it } from 'vitest'
import { decodeShape, planRemote } from './remote'

/**
 * Le filet de secours : une boucle calculée par un service public quand on n'a
 * pas les rues.
 *
 * Deux choses comptent ici, et aucune n'est la beauté du tracé. **Ce qui revient
 * doit être lu exactement** — une polyligne mal décodée, ce sont des rues
 * décalées de plusieurs kilomètres, affichées comme si de rien n'était. Et
 * **rien ne doit être inventé** : un tracé de secours n'a pas de note de
 * sécurité, et prétendre le contraire serait le pire service à rendre à
 * quelqu'un qui part courir.
 */

/** L'encodage des polylignes, écrit à part pour vérifier le décodeur. */
function encode(points, precision = 1e6) {
  let lat = 0
  let lon = 0
  let out = ''
  const piece = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [x, y] of points) {
    const py = Math.round(y * precision)
    const px = Math.round(x * precision)
    piece(py - lat)
    piece(px - lon)
    lat = py
    lon = px
  }
  return out
}

/** Un service qui rend une boucle carrée d'environ `km` autour du départ. */
function fakeValhalla(km = 5, { fails = false } = {}) {
  const calls = []
  const fetchImpl = async (url, { body } = {}) => {
    calls.push(JSON.parse(body))
    if (fails) return { ok: false, status: 503, json: async () => ({}) }
    const locations = JSON.parse(body).locations
    // Un tracé qui passe par les points demandés, densifié pour ressembler à
    // une vraie réponse.
    const points = []
    for (let i = 0; i < locations.length - 1; i += 1) {
      const a = locations[i]
      const b = locations[i + 1]
      for (let k = 0; k < 20; k += 1) {
        points.push([a.lon + ((b.lon - a.lon) * k) / 20, a.lat + ((b.lat - a.lat) * k) / 20])
      }
    }
    points.push([locations[0].lon, locations[0].lat])
    return {
      ok: true,
      status: 200,
      json: async () => ({
        trip: {
          summary: { length: km, time: km * 420 },
          legs: [
            {
              shape: encode(points),
              summary: { length: km },
              maneuvers: [
                { instruction: "Marchez vers l'est.", street_names: ['Rue du Test'], begin_shape_index: 0 },
                { instruction: 'Tournez à droite.', begin_shape_index: 10 },
              ],
            },
          ],
        },
      }),
    }
  }
  return { fetchImpl, calls }
}

const demande = (km = 5, limit = 3) => ({
  lat: 43.6108,
  lon: 3.8767,
  distance_km: km,
  tolerance: 0.35,
  limit,
  sport: 'run',
  seconds_per_km: 390,
})

describe('les polylignes', () => {
  it('se relisent au point près', () => {
    const points = [
      [3.8767, 43.6108],
      [3.881, 43.6123],
      [3.8705, 43.6201],
    ]
    const relus = decodeShape(encode(points))
    expect(relus.length).toBe(3)
    relus.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(points[i][0], 6)
      expect(y).toBeCloseTo(points[i][1], 6)
    })
  })
})

describe('le secours', () => {
  it('rend des boucles utilisables, et sans note', async () => {
    const service = fakeValhalla(5)
    const result = await planRemote(demande(), { fetchImpl: service.fetchImpl })

    expect(result.routes.length).toBeGreaterThan(0)
    const route = result.routes[0]
    expect(route.geometry.length).toBeGreaterThan(10)
    expect(route.distance_m).toBeGreaterThan(1000)
    expect(route.instructions[0].text).toMatch(/Marchez/)

    // **Aucune note inventée.** C'est la propriété qui compte le plus ici.
    expect(route.safety).toBeNull()
    expect(route.graded).toBe(false)
    expect(route.segments[0].level).toBe('unknown')
    expect(route.segments[0].risk).toBeNull()
    expect(result.meta.remote).toBe('valhalla')
    expect(result.meta.message).toMatch(/sécurité/i)
  })

  it('demande un profil piéton, et le vélo pour le vélo', async () => {
    const pied = fakeValhalla(5)
    await planRemote(demande(), { fetchImpl: pied.fetchImpl })
    expect(pied.calls[0].costing).toBe('pedestrian')
    expect(pied.calls[0].directions_options.language).toBe('fr-FR')

    const velo = fakeValhalla(5)
    await planRemote({ ...demande(), sport: 'bike' }, { fetchImpl: velo.fetchImpl })
    expect(velo.calls[0].costing).toBe('bicycle')
  })

  it('reste discret : quelques requêtes, pas des dizaines', async () => {
    // C'est un service public et gratuit. Une recherche ne doit pas lui coûter
    // une rafale.
    const service = fakeValhalla(5)
    await planRemote(demande(5, 6), { fetchImpl: service.fetchImpl })
    expect(service.calls.length).toBeLessThanOrEqual(8)
  })

  it('rend null plutôt qu’un tracé faux quand le service ne répond pas', async () => {
    const service = fakeValhalla(5, { fails: true })
    expect(await planRemote(demande(), { fetchImpl: service.fetchImpl })).toBeNull()
  })
})
