import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alongRoute, poisIn, poiQuery, routeBox, tilesOver, toPoi } from './pois'

/**
 * Les points d'eau et toilettes : ce qu'on garde d'OpenStreetMap, et où on les
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
  it('distingue l’eau des toilettes, et garde ce qui aide à choisir', () => {
    expect(toPoi({ lat: 1, lon: 2, tags: { amenity: 'drinking_water' } })).toMatchObject({ kind: 'water' })
    expect(toPoi({ center: { lat: 1, lon: 2 }, tags: { amenity: 'toilets', fee: 'yes', name: 'Parc' } })).toEqual({
      kind: 'toilets',
      lat: 1,
      lon: 2,
      name: 'Parc',
      fee: true,
    })
  })

  it('écarte ce qui est fermé au public ou non potable', () => {
    expect(toPoi({ lat: 1, lon: 2, tags: { amenity: 'toilets', access: 'private' } })).toBeNull()
    expect(toPoi({ lat: 1, lon: 2, tags: { amenity: 'drinking_water', drinking_water: 'no' } })).toBeNull()
    expect(toPoi({ tags: { amenity: 'toilets' } })).toBeNull()
  })

  it('ne demande que les deux genres, dans l’emprise', () => {
    const q = poiQuery([48.8, 2.3, 48.9, 2.4])
    expect(q).toContain('"amenity"="drinking_water"')
    expect(q).toContain('"amenity"="toilets"')
    expect(q).toContain('(48.8,2.3,48.9,2.4)')
  })
})

describe('ce qu’on croise en chemin', () => {
  it('place chaque arrêt à son kilomètre, dans l’ordre', () => {
    const arrets = alongRoute(TRACE, [
      { kind: 'water', ...decale(2.3 + pas * 0.8, 30) },
      { kind: 'toilets', ...decale(2.3 + pas * 0.2, -60) },
    ])
    expect(arrets.map((a) => a.kind)).toEqual(['toilets', 'water'])
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
    await expect(poisIn(ailleurs, { fetchImpl })).resolves.toEqual({ pois: [], complete: false })
  })
})
