import { describe, expect, it } from 'vitest'
import { decodeShape, planRemote, readTrip } from './remote'

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
    expect(route.instructions[0]).toMatchObject({ turn: 'start', dist_m: 0, road: 'Rue du Test' })
    expect(route.instructions[0].text).toMatch(/^Départ — pars vers .+ sur Rue du Test\.$/)

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

  it('donne des consignes que le guidage sait suivre', () => {
    // Trois tronçons : les deux points de passage du polygone sont, pour le
    // calculateur, deux arrivées et deux départs. Le guidage comparait la
    // distance courue à un `dist_m` absent — « dans NaN mètres » — et aurait
    // annoncé l'arrivée à chaque point de passage.
    const ligne = (x0, n) => Array.from({ length: n }, (_, k) => [3.87 + (x0 + k) * 0.0005, 43.61])
    const points = ligne(0, 61)
    const trip = {
      legs: [
        { shape: encode(points.slice(0, 21)), maneuvers: [
          { type: 1, instruction: "Marchez vers l'est.", street_names: ['Rue du Test'], begin_shape_index: 0 },
          { type: 10, instruction: 'Tournez à droite.', street_names: ['Rue Pasteur'], begin_shape_index: 8 },
          { type: 4, instruction: 'Vous êtes arrivé à votre destination.', begin_shape_index: 20 },
        ] },
        { shape: encode(points.slice(20, 41)), maneuvers: [
          { type: 1, instruction: 'Marchez vers le sud.', begin_shape_index: 0 },
          { type: 8, instruction: 'Continuez.', begin_shape_index: 3 },
          { type: 15, instruction: 'Tournez à gauche.', street_names: ['Rue Haute'], begin_shape_index: 6 },
          { type: 5, instruction: 'Vous êtes arrivé à votre destination.', begin_shape_index: 20 },
        ] },
        { shape: encode(points.slice(40, 61)), maneuvers: [
          { type: 2, instruction: 'Marchez vers le nord.', begin_shape_index: 0 },
          { type: 4, instruction: 'Vous êtes arrivé à votre destination.', begin_shape_index: 20 },
        ] },
      ],
    }
    const { geometry, instructions } = readTrip(trip)
    expect(geometry.length).toBe(61)
    expect(instructions.map((s) => s.turn)).toEqual(['start', 'right', 'left', 'finish'])
    expect(instructions.map((s) => s.text)).toEqual([
      expect.stringMatching(/^Départ — pars vers l'est sur Rue du Test\.$/),
      'Tourne à droite sur Rue Pasteur',
      'Tourne à gauche sur Rue Haute',
      'Tu es revenu au point de départ. Boucle terminée.',
    ])
    // Chaque consigne tombe là où le calculateur la place, en mètres depuis le départ.
    const pas = 0.0005 * 111_320 * Math.cos((43.61 * Math.PI) / 180)
    expect(instructions[1].dist_m).toBeCloseTo(8 * pas, -1)
    expect(instructions[2].dist_m).toBeCloseTo(26 * pas, -1)
    expect(instructions[3].dist_m).toBeCloseTo(60 * pas, -1)
    for (const s of instructions) {
      expect(Number.isFinite(s.lon) && Number.isFinite(s.lat)).toBe(true)
    }
  })

  it('mesure le relief des boucles de secours', async () => {
    // Les altitudes reviennent en `{values, coarse}` : lues comme une liste,
    // elles ne donnaient jamais de dénivelé.
    const trajets = fakeValhalla(5)
    const fetchImpl = async (url, init = {}) => {
      if (String(url).includes('altimetrie')) {
        const { lon } = JSON.parse(init.body)
        const n = lon.split('|').length
        return { ok: true, status: 200, json: async () => ({ elevations: Array.from({ length: n }, (_, k) => 200 + (k % 20) * 3) }) }
      }
      return trajets.fetchImpl(url, init)
    }
    const result = await planRemote(demande(), { fetchImpl })
    const route = result.routes[0]
    expect(route.ascent_m).toBeGreaterThan(0)
    expect(route.elevation_profile.length).toBeGreaterThan(5)
    expect(route.elevation_profile.at(-1).dist_m).toBeLessThanOrEqual(route.distance_m)
  })

  it('rend null plutôt qu’un tracé faux quand le service ne répond pas', async () => {
    const service = fakeValhalla(5, { fails: true })
    expect(await planRemote(demande(), { fetchImpl: service.fetchImpl })).toBeNull()
  })
})
