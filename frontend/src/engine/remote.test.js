import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { TILE_DEG, clearTiles, fetchArea, resetMirrorHealth, tilesFor } from './overpass'
import { resetRegion } from './region'
import { mergeRanges, resetRemote } from './remote'

/**
 * Les rues des pays préparés, lues en ligne.
 *
 * En vacances loin de la région livrée dans l'app, la première recherche
 * attendait Overpass. Les pays préparés chaque mois sont lus à la place sur un
 * hébergement de fichiers, par morceaux : on vérifie qu'on n'y demande que ce
 * qu'il faut, en peu de requêtes, et qu'Overpass reprend la main sans bruit
 * dès que quelque chose manque.
 */

const BEAUNE = { lat: 47.0245, lon: 4.8395 }
const BASE = 'https://cartes.test/'
const q7 = (v) => Math.round(v * 1e7) / 1e7

/** Une tuile au format du générateur : une rue en son centre. */
function tileJson([ix, iy]) {
  const x = Math.round(q7(ix * TILE_DEG + TILE_DEG / 2) * 1e7)
  const y = Math.round(q7(iy * TILE_DEG + TILE_DEG / 2) * 1e7)
  const id = ix * 10000 + iy
  return {
    w: [[id * 10, { highway: 'residential' }, [id * 100, 1], [x, y, 10000, 10000]]],
    l: [],
    c: [],
  }
}

/** Un pays préparé : son fichier de tuiles, son index, le catalogue. */
function hosting(tiles) {
  const blobs = []
  const index = {}
  let offset = 0
  // Rangées comme le fait le générateur : ligne par ligne, puis colonne.
  for (const tile of [...tiles].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const blob = gzipSync(Buffer.from(JSON.stringify(tileJson(tile))))
    index[`${tile[0]}_${tile[1]}`] = [offset, blob.length]
    blobs.push(blob)
    offset += blob.length
  }
  const pack = Buffer.concat(blobs)
  const xs = tiles.map((t) => t[0])
  const ys = tiles.map((t) => t[1])
  const bbox = [Math.min(...xs) * TILE_DEG, Math.min(...ys) * TILE_DEG, (Math.max(...xs) + 1) * TILE_DEG, (Math.max(...ys) + 1) * TILE_DEG]
  const builtAt = Date.now() - 3 * 86_400_000
  const catalog = { v: 1, tileDeg: TILE_DEG, countries: [{ id: 'france', name: 'France', builtAt, bbox }] }
  const requests = []
  let down = false
  const fetchImpl = async (url, options = {}) => {
    if (down) throw new TypeError('Hébergement injoignable')
    requests.push({ url, range: options.headers?.Range ?? null })
    if (url === `${BASE}catalog.json`) return { ok: true, status: 200, json: async () => catalog }
    if (url === `${BASE}france/index.json`) return { ok: true, status: 200, json: async () => ({ v: 3, builtAt, tiles: index }) }
    if (url === `${BASE}france/tiles.bin`) {
      const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number)
      const slice = pack.subarray(start, end + 1)
      return { ok: true, status: 206, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchImpl, requests, setDown: (v) => (down = v) }
}

const noOverpass = async () => {
  throw new TypeError('Overpass ne doit pas être appelé')
}

/** Un Overpass qui répond d'un sentier par tuile, et compte ses appels. */
function overpass() {
  const state = { calls: 0 }
  state.fetchImpl = async (url, { body } = {}) => {
    state.calls += 1
    const m = decodeURIComponent(String(body).replace(/\+/g, ' ')).match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);/)
    const [s, w, n, e] = m.slice(1, 5).map(Number)
    const elements = []
    for (let iy = Math.round(s / TILE_DEG); iy < Math.round(n / TILE_DEG); iy += 1) {
      for (let ix = Math.round(w / TILE_DEG); ix < Math.round(e / TILE_DEG); ix += 1) {
        const lon = ix * TILE_DEG + 0.02
        const lat = iy * TILE_DEG + 0.02
        elements.push({ type: 'way', id: ix * 100000 + iy, tags: { highway: 'path' }, nodes: [1, 2], geometry: [{ lon, lat }, { lon: lon + 0.001, lat }] })
      }
    }
    const text = JSON.stringify({ elements })
    return { ok: true, status: 200, text: async () => text }
  }
  return state
}

beforeEach(async () => {
  resetRegion()
  resetRemote()
  resetMirrorHealth()
  await clearTiles()
})

describe('les pays préparés en ligne', () => {
  it('servent toutes les rues sans Overpass, en quelques requêtes', async () => {
    const area = { ...BEAUNE, radiusM: 6000, targetM: 10_000 }
    const wanted = tilesFor(area.lat, area.lon, area.radiusM)
    const host = hosting(wanted)
    const extract = await fetchArea({ ...area, fetchImpl: noOverpass, remoteFetch: host.fetchImpl, tilesUrl: BASE })
    expect(extract.ways.length).toBe(wanted.length)
    // Les tuiles voisines se suivent dans le fichier : une seule plage suffit ici.
    const ranges = host.requests.filter((r) => r.range)
    expect(ranges.length).toBe(1)
  })

  it('restent sur l’appareil pour la recherche suivante', async () => {
    const area = { ...BEAUNE, radiusM: 6000, targetM: 10_000 }
    const host = hosting(tilesFor(area.lat, area.lon, area.radiusM))
    await fetchArea({ ...area, fetchImpl: noOverpass, remoteFetch: host.fetchImpl, tilesUrl: BASE })
    const before = host.requests.length
    // Une autre distance, au même endroit : ni l'hébergement ni Overpass.
    await fetchArea({ ...area, targetM: 30_000, fetchImpl: noOverpass, remoteFetch: host.fetchImpl, tilesUrl: BASE })
    expect(host.requests.length).toBe(before)
  })

  it('laissent à Overpass ce qu’ils ne contiennent pas', async () => {
    const area = { ...BEAUNE, radiusM: 3000, targetM: 6000 }
    const wanted = tilesFor(area.lat, area.lon, area.radiusM)
    const host = hosting(wanted.slice(0, 2))
    const net = overpass()
    const extract = await fetchArea({ ...area, fetchImpl: net.fetchImpl, remoteFetch: host.fetchImpl, tilesUrl: BASE })
    expect(net.calls).toBeGreaterThan(0)
    expect(extract.ways.length).toBeGreaterThanOrEqual(wanted.length)
  })

  it('cèdent la place à Overpass si l’hébergement ne répond pas', async () => {
    const area = { ...BEAUNE, radiusM: 3000, targetM: 6000 }
    const host = hosting(tilesFor(area.lat, area.lon, area.radiusM))
    host.setDown(true)
    const net = overpass()
    const extract = await fetchArea({ ...area, fetchImpl: net.fetchImpl, remoteFetch: host.fetchImpl, tilesUrl: BASE })
    expect(net.calls).toBeGreaterThan(0)
    expect(extract.ways.length).toBeGreaterThan(0)
  })
})

describe('le regroupement des plages', () => {
  const tile = (offset, length) => ({ key: `${offset}`, offset, length })

  it('réunit les tuiles qui se suivent, et enjambe les petits trous', () => {
    const ranges = mergeRanges([tile(0, 100), tile(100, 100), tile(300, 50)])
    expect(ranges).toHaveLength(1)
    expect([ranges[0].start, ranges[0].end]).toEqual([0, 350])
  })

  it('coupe devant un grand trou ou une plage trop lourde', () => {
    expect(mergeRanges([tile(0, 100), tile(10_000_000, 100)])).toHaveLength(2)
    expect(mergeRanges([tile(0, 8_000_000), tile(8_000_000, 8_000_000)])).toHaveLength(2)
  })
})
