import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { TILE_DEG, clearTiles, deriveLevel, fetchArea, resetMirrorHealth, takeChunk, tilesFor } from './overpass'
import { fromRegionTile, resetRegion } from './region'

/**
 * Ne plus attendre les rues.
 *
 * Trois mécanismes, trois attentes qu'ils suppriment :
 *
 * - **la carte régionale livrée avec l'app** : dans la région où l'on court,
 *   aucune requête du tout — Overpass mettait de vingt secondes à plusieurs
 *   minutes ;
 * - **le réemploi entre niveaux de détail** : passer de 21 à 30 km ne
 *   retélécharge plus toute la zone ;
 * - **des lots sans trou** : quand seule la couronne manque, on ne redemande
 *   pas le centre.
 *
 * Et la barre, pendant ce qui reste à télécharger, avance au fil des octets.
 */

const BEAUNE = { lat: 47.0245, lon: 4.8395 }

/** Encode un extrait comme `scripts/region_tiles.py`. */
function encodeTile(extract) {
  const delta = (values) => values.map((v, i) => (i ? v - values[i - 1] : v))
  const coords = (flat) => {
    const ints = Array.from(flat, (v) => Math.round(v * 1e7))
    return ints.map((v, i) => (i >= 2 ? v - ints[i - 2] : v))
  }
  return {
    w: extract.ways.map((w) => [w.id, w.tags, delta(w.nodes), coords(w.flat)]),
    l: extract.landuse.map((a) => [a.id, coords(a.flat)]),
    c: extract.crossings.map((c) => [c.id, Math.round(c.lon * 1e7), Math.round(c.lat * 1e7), c.tags]),
  }
}

// Sept décimales, comme toutes les coordonnées d'OpenStreetMap.
const q7 = (v) => Math.round(v * 1e7) / 1e7

/** Une tuile : une rue résidentielle et une voie de service, en son centre. */
function tileExtract([ix, iy]) {
  const lon = q7(ix * TILE_DEG + TILE_DEG / 2)
  const lat = q7(iy * TILE_DEG + TILE_DEG / 2)
  const id = ix * 10000 + iy
  const flat = Float64Array.of(lon, lat, q7(lon + 0.001), q7(lat + 0.001))
  return {
    ways: [
      { id: id * 10, tags: { highway: 'residential', name: 'Rue' }, nodes: [id * 100, id * 100 + 1], flat },
      { id: id * 10 + 1, tags: { highway: 'service' }, nodes: [id * 100 + 2, id * 100 + 3], flat },
    ],
    landuse: [],
    crossings: [{ id: id * 7, lon, lat, tags: { highway: 'crossing', crossing: 'zebra' } }],
  }
}

/** La carte régionale d'un ensemble de tuiles, servie comme par l'app. */
function region(tiles, builtAt = Date.now()) {
  const files = new Map(tiles.map((t) => [`/region/${t[0]}_${t[1]}.json`, encodeTile(tileExtract(t))]))
  const index = { v: 3, name: 'Test', builtAt, tileDeg: TILE_DEG, tiles: tiles.map((t) => `${t[0]}_${t[1]}`) }
  const calls = []
  const regionFetch = async (url) => {
    calls.push(url)
    if (url === '/region/index.json') return { ok: true, json: async () => index }
    const data = files.get(url)
    return data ? { ok: true, json: async () => data } : { ok: false, json: async () => ({}) }
  }
  return { regionFetch, calls }
}

/** Overpass qui ne répond jamais : tout doit venir d'ailleurs. */
const noNetwork = async () => {
  throw new TypeError('Pas de réseau')
}

/** Overpass qui répond d'une tuile par voie résidentielle + voie de service. */
function overpass() {
  const calls = []
  const fetchImpl = async (url, { body } = {}) => {
    const m = decodeURIComponent(String(body).replace(/\+/g, ' ')).match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);/)
    const [s, w, n, e] = m.slice(1, 5).map(Number)
    calls.push([s, w, n, e])
    const elements = []
    for (let iy = Math.round(s / TILE_DEG); iy < Math.round(n / TILE_DEG); iy += 1) {
      for (let ix = Math.round(w / TILE_DEG); ix < Math.round(e / TILE_DEG); ix += 1) {
        for (const way of tileExtract([ix, iy]).ways) {
          elements.push({
            type: 'way',
            id: way.id,
            tags: way.tags,
            nodes: way.nodes,
            geometry: [
              { lon: way.flat[0], lat: way.flat[1] },
              { lon: way.flat[2], lat: way.flat[3] },
            ],
          })
        }
      }
    }
    const text = JSON.stringify({ elements })
    return { ok: true, status: 200, text: async () => text }
  }
  return { fetchImpl, calls }
}

beforeEach(async () => {
  resetRegion()
  resetMirrorHealth()
  await clearTiles()
})

describe('la carte régionale', () => {
  it('sert les rues sans une seule requête à Overpass', async () => {
    const area = { ...BEAUNE, radiusM: 3000, targetM: 6000 }
    const { regionFetch } = region(tilesFor(area.lat, area.lon, area.radiusM))
    const extract = await fetchArea({ ...area, fetchImpl: noNetwork, regionFetch })
    expect(extract.ways.length).toBe(tilesFor(area.lat, area.lon, area.radiusM).length * 2)
    expect(extract.crossings.length).toBeGreaterThan(0)
  })

  it('en tire aussi les niveaux de détail plus grossiers', async () => {
    // Au-delà de 25 km, les voies de service ne comptent plus.
    const area = { ...BEAUNE, radiusM: 3000, targetM: 30_000 }
    const { regionFetch } = region(tilesFor(area.lat, area.lon, area.radiusM))
    const extract = await fetchArea({ ...area, fetchImpl: noNetwork, regionFetch })
    expect(extract.ways.length).toBeGreaterThan(0)
    expect(extract.ways.every((w) => w.tags.highway !== 'service')).toBe(true)
  })

  it('laisse à Overpass ce qu’elle ne couvre pas', async () => {
    const area = { ...BEAUNE, radiusM: 3000, targetM: 6000 }
    const tiles = tilesFor(area.lat, area.lon, area.radiusM)
    const { regionFetch } = region(tiles.slice(0, 2))
    const net = overpass()
    const extract = await fetchArea({ ...area, fetchImpl: net.fetchImpl, regionFetch })
    expect(net.calls.length).toBeGreaterThan(0)
    expect(extract.ways.length).toBe(tiles.length * 2)
  })

  it('cède la place à une copie plus récente déjà sur l’appareil', async () => {
    const area = { ...BEAUNE, radiusM: 3000, targetM: 6000 }
    const tiles = tilesFor(area.lat, area.lon, area.radiusM)
    const net = overpass()
    await fetchArea({ ...area, fetchImpl: net.fetchImpl, useRegion: false })
    const old = region(tiles, Date.now() - 20 * 86_400_000)
    await fetchArea({ ...area, fetchImpl: noNetwork, regionFetch: old.regionFetch })
    // Les copies de l'appareil sont fraîches : la carte livrée n'est même pas lue.
    expect(old.calls.filter((u) => u !== '/region/index.json')).toEqual([])
  })

  it('décode exactement ce que le générateur écrit', () => {
    const extract = tileExtract([96, 940])
    const back = fromRegionTile(encodeTile(extract))
    expect(back.ways.map((w) => [w.id, w.nodes, Array.from(w.flat)])).toEqual(
      extract.ways.map((w) => [w.id, w.nodes, Array.from(w.flat)]),
    )
    expect(back.crossings[0].lon).toBe(extract.crossings[0].lon)
  })

  it('filtre les voies comme la requête Overpass — générateur et app d’accord', () => {
    // Les filtres sont recopiés dans le générateur Python : s'ils divergent, la
    // carte livrée contiendrait d'autres rues que celles qu'Overpass aurait rendues.
    const python = readFileSync(new URL('../../scripts/region_tiles.py', import.meta.url), 'utf8')
    const javascript = readFileSync(new URL('./overpass.js', import.meta.url), 'utf8')
    for (const name of ['EXCLUDED_HIGHWAYS', 'BUILTUP_LANDUSE', 'EXCLUDED_SERVICE']) {
      const py = python.match(new RegExp(`${name} = "([^"]+)"`))[1]
      const js = javascript.match(new RegExp(`${name} = '([^']+)'`))[1]
      expect(py).toBe(js)
    }
    expect(python).toMatch(new RegExp(`TILE_DEG = ${TILE_DEG}\\b`))
  })
})

describe('le réemploi entre niveaux de détail', () => {
  it('ne retélécharge rien en passant de 21 à 30 km', async () => {
    const net = overpass()
    await fetchArea({ ...BEAUNE, radiusM: 5000, targetM: 21_000, fetchImpl: net.fetchImpl, useRegion: false })
    const first = net.calls.length
    // 30 km : niveau de détail 1. Le rayon de recherche ne change pas ici, pour
    // isoler le changement de niveau.
    const extract = await fetchArea({ ...BEAUNE, radiusM: 5000, targetM: 30_000, fetchImpl: net.fetchImpl, useRegion: false })
    expect(net.calls.length).toBe(first)
    expect(extract.ways.every((w) => w.tags.highway !== 'service')).toBe(true)
  })

  it('retire exactement ce que le niveau plus grossier exclut', () => {
    const extract = tileExtract([96, 940])
    expect(deriveLevel(extract, 0)).toBe(extract)
    expect(deriveLevel(extract, 1).ways.map((w) => w.tags.highway)).toEqual(['residential'])
  })
})

describe('les lots', () => {
  it('ne redemandent pas le centre quand seule la couronne manque', () => {
    // Un carré de 5 × 5 dont le centre 3 × 3 est déjà là.
    const ring = []
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (x === 0 || y === 0 || x === 4 || y === 4) ring.push([x, y])
      }
    }
    const missing = [...ring]
    const rects = []
    while (missing.length) rects.push(takeChunk(missing, 64).rect)
    for (const r of rects) {
      for (let y = r.iy0; y <= r.iy1; y += 1) {
        for (let x = r.ix0; x <= r.ix1; x += 1) {
          expect(x === 0 || y === 0 || x === 4 || y === 4).toBe(true)
        }
      }
    }
    expect(rects.length).toBeLessThanOrEqual(4)
  })
})

describe('la progression', () => {
  it('avance par petits pas pendant le téléchargement, sans jamais reculer', async () => {
    // Une réponse du poids attendu, qui arrive en vingt morceaux sur deux secondes.
    const area = { ...BEAUNE, radiusM: 2000, targetM: 6000 }
    const wanted = tilesFor(area.lat, area.lon, area.radiusM)
    const cols = new Set(wanted.map((t) => t[0])).size
    const rows = new Set(wanted.map((t) => t[1])).size
    const guess = 20_000
    const fetchImpl = async (url, { body } = {}) => {
      const { fetchImpl: plain } = overpass()
      const text = await (await plain(url, { body })).text()
      const bytes = new TextEncoder().encode(text + ' '.repeat(Math.max(0, guess * cols * rows - text.length)))
      const size = Math.ceil(bytes.length / 20)
      let offset = 0
      const stream = new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (offset >= bytes.length) {
            controller.close()
            return
          }
          controller.enqueue(bytes.slice(offset, offset + size))
          offset += size
        },
      })
      return { ok: true, status: 200, body: stream, text: async () => text }
    }
    const seen = []
    await fetchArea({
      ...area, fetchImpl, useRegion: false, tileBytesGuess: guess,
      onProgress: (f) => seen.push(f),
    })
    const distinct = [...new Set(seen.map((f) => Math.round(f * 100)))]
    expect(distinct.length).toBeGreaterThanOrEqual(8)
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true)
    expect(seen.at(-1)).toBe(1)
  }, 15_000)
})
