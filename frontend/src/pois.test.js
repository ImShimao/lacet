import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alongRoute, poisIn, poiQuery, routeBox, tilesOver, toPoi } from './pois'

/**
 * Les points d'eau : ce qu'on garde d'OpenStreetMap, et où on les
 * croise sur la boucle.
 */

beforeEach(() => vi.stubGlobal('indexedDB', {}))
afterEach(() => vi.unstubAllGlobals())

// Une ligne droite de 1 km vers l'est, à Paris.
const pas = 1000 / (111_195 * Math.cos((48.85 * Math.PI) / 180))
const TRACE = [
  [2.3, 48.85],
  [2.3 + pas / 2, 48.85],
  [2.3 + pas, 48.85],
]
const decale = (lon, nordM) => ({ lon, lat: 48.85 + nordM / 111_195 })

describe('ce qu’on garde d’OpenStreetMap', () => {
  it('garde l’eau potable, avec son nom', () => {
    expect(toPoi({ center: { lat: 1, lon: 2 }, tags: { amenity: 'drinking_water', name: 'Parc' } })).toEqual({
      kind: 'water',
      lat: 1,
      lon: 2,
      name: 'Parc',
    })
    expect(toPoi({ lat: 1, lon: 2, tags: { man_made: 'water_tap', drinking_water: 'yes' } })).toMatchObject({ kind: 'water' })
  })

  it('écarte ce où l’on n’est pas sûr de boire', () => {
    const eau = (tags, mois) => toPoi({ lat: 1, lon: 2, tags: { amenity: 'drinking_water', ...tags } }, mois)
    for (const tags of [
      { access: 'private' },
      { access: 'customers' },
      { fee: 'yes' },
      { drinking_water: 'no' },
      { 'drinking_water:legal': 'no' },
      { disused: 'yes' },
      { operational_status: 'broken' },
    ]) {
      expect(eau(tags, 6)).toBeNull()
    }
    expect(toPoi({ tags: { amenity: 'drinking_water' } })).toBeNull()
    // Les toilettes d'un carreau gardé par une ancienne version ne reviennent pas.
    expect(toPoi({ lat: 1, lon: 2, tags: { amenity: 'toilets' } })).toBeNull()
  })

  it('tait la fontaine saisonnière en hiver, pas en été', () => {
    const fontaine = { lat: 1, lon: 2, tags: { amenity: 'drinking_water', seasonal: 'yes' } }
    expect(toPoi(fontaine, 0)).toBeNull()
    expect(toPoi(fontaine, 10)).toBeNull()
    expect(toPoi(fontaine, 6)).toMatchObject({ kind: 'water' })
  })

  it('ne demande que l’eau potable, dans l’emprise', () => {
    const q = poiQuery([48.8, 2.3, 48.9, 2.4])
    expect(q).toContain('"amenity"="drinking_water"')
    expect(q).not.toContain('toilets')
    expect(q).not.toContain('water_point')
    expect(q).toContain('(48.8,2.3,48.9,2.4)')
  })
})

describe('ce qu’on croise en chemin', () => {
  it('place chaque arrêt à son kilomètre, dans l’ordre', () => {
    const arrets = alongRoute(TRACE, [
      { kind: 'water', ...decale(2.3 + pas * 0.8, 30) },
      { kind: 'water', ...decale(2.3 + pas * 0.2, -60) },
    ])
    expect(arrets.map((a) => a.along)).toEqual([...arrets.map((a) => a.along)].sort((x, y) => x - y))
    expect(arrets[0].along).toBeCloseTo(200, -1)
    expect(arrets[0].off).toBeCloseTo(60, -1)
    expect(arrets[1].along).toBeCloseTo(800, -1)
  })

  it('laisse de côté ce qui est trop loin du tracé', () => {
    expect(alongRoute(TRACE, [{ kind: 'water', ...decale(2.3 + pas / 2, 400) }])).toEqual([])
  })

  it('ne compte qu’une fois le même robinet relevé deux fois', () => {
    const a = { kind: 'water', ...decale(2.3 + pas / 2, 10) }
    const b = { kind: 'water', ...decale(2.3 + pas / 2 + 0.0001, 12) }
    expect(alongRoute(TRACE, [a, b])).toHaveLength(1)
  })
})

describe('le carnet sur l’appareil', () => {
  const reponse = (elements) => ({ ok: true, json: async () => ({ elements }) })
  const boite = routeBox(TRACE)

  it('couvre la boucle et ses abords', () => {
    expect(boite[0]).toBeLessThan(48.85)
    expect(boite[3]).toBeGreaterThan(2.3 + pas)
    expect(tilesOver(boite).length).toBeGreaterThan(0)
  })

  it('ne redemande pas ce qu’il a déjà', async () => {
    const fetchImpl = vi.fn(async () => reponse([{ lat: 48.8501, lon: 2.3001, tags: { amenity: 'drinking_water' } }]))
    const premier = await poisIn(boite, { fetchImpl })
    expect(premier.pois).toHaveLength(1)
    const appels = fetchImpl.mock.calls.length
    const second = await poisIn(boite, { fetchImpl })
    expect(second).toEqual({ pois: premier.pois, complete: true })
    expect(fetchImpl.mock.calls.length).toBe(appels)
  })

  it('sans réseau, dit qu’il manque quelque chose au lieu d’inventer', async () => {
    const ailleurs = [10.1, 5.1, 10.11, 5.11]
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    await expect(poisIn(ailleurs, { fetchImpl, online: () => false })).resolves.toEqual({
      pois: [],
      complete: false,
      offline: true,
    })
  })

  it('en ligne, un service qui refuse n’est pas une panne de réseau', async () => {
    // Le cas de l'automne 2026 : Overpass refusait l'app, sans en-têtes CORS,
    // et WebKit le rapportait comme une coupure — « Pas de réseau », en wifi.
    const ailleurs = [11.1, 6.1, 11.11, 6.11]
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Load failed')
    })
    await expect(poisIn(ailleurs, { fetchImpl, online: () => true })).resolves.toMatchObject({
      complete: false,
      offline: false,
    })
  })
})
