import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { TILE_DEG, splitIntoTiles } from './overpass'
import { fromCompact, fromOverpass, mergeExtracts } from './extract'
import { buildGraph } from './graph'
import { fromRegionTile, toRegionTile } from './region'

/**
 * L'indice vert, hors de ce que voit la parité.
 *
 * `parity.test.js` vérifie le calcul lui-même contre Python, sur un extrait
 * d'un seul tenant. Mais l'app reçoit ses rues en tuiles : découpées, gardées
 * sur l'appareil au format des tuiles livrées, puis recousues. Une forêt rangée
 * dans une seule des tuiles qu'elle couvre perdrait son intérieur ailleurs, et
 * un sentier balisé son balisage — sans que rien à l'écran ne le montre.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const beaune = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))

const sum = (values) => [...values].reduce((a, b) => a + b, 0)

describe('l’indice vert à travers les tuiles', () => {
  it('ressort identique d’un découpage en tuiles gardées puis recousues', () => {
    // Beaune s'étend sur neuf tuiles : ses forêts et ses sentiers en traversent plusieurs.
    const coords = beaune.ways.flatMap((w) => [...w.flat])
    const lons = coords.filter((_, i) => i % 2 === 0)
    const lats = coords.filter((_, i) => i % 2 === 1)
    const rect = {
      ix0: Math.floor(Math.min(...lons) / TILE_DEG),
      ix1: Math.floor(Math.max(...lons) / TILE_DEG),
      iy0: Math.floor(Math.min(...lats) / TILE_DEG),
      iy1: Math.floor(Math.max(...lats) / TILE_DEG),
    }
    const parts = [...splitIntoTiles(beaune, rect).values()]
    const kept = parts.map((part) => fromRegionTile(JSON.parse(JSON.stringify(toRegionTile(part)))))
    const again = buildGraph(mergeExtracts(kept))
    const once = buildGraph(beaune)

    expect(sum(once.edgeGreen)).toBeGreaterThan(10)
    expect(sum(again.edgeGreen)).toBeCloseTo(sum(once.edgeGreen), 6)
    expect(sum(again.edgeMarked)).toBe(sum(once.edgeMarked))
    expect(sum(once.edgeMarked)).toBeGreaterThan(0)
  })

  it('lit les relations d’Overpass : forêt en morceaux et sentier balisé', () => {
    const at = (lon, lat) => ({ lon, lat })
    const extract = fromOverpass({
      elements: [
        { type: 'way', id: 7, tags: { highway: 'path' }, nodes: [1, 2], geometry: [at(7.2, 47.9), at(7.21, 47.9)] },
        { type: 'way', id: 8, tags: { landuse: 'forest' }, geometry: [at(7.2, 47.9), at(7.21, 47.9), at(7.2, 47.91), at(7.2, 47.9)] },
        { type: 'way', id: 9, tags: { landuse: 'farmland' }, geometry: [at(7.2, 47.9), at(7.21, 47.9), at(7.2, 47.9)] },
        {
          type: 'relation',
          id: 8,
          tags: { type: 'multipolygon', natural: 'wood' },
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: [at(7.2, 47.9), at(7.21, 47.9)] },
            { type: 'way', ref: 2, role: 'outer', geometry: [at(7.21, 47.9), at(7.2, 47.9)] },
          ],
        },
        { type: 'relation', id: 3, tags: { route: 'hiking' }, members: [{ type: 'way', ref: 7 }, { type: 'way', ref: 99 }] },
      ],
    })
    // La relation garde un identifiant négatif : elle ne se confond pas avec la voie 8.
    expect(extract.green.map((a) => [a.id, a.fill, a.rings.length])).toEqual([[8, true, 1], [-8, true, 2]])
    // Les terres agricoles ne sont ni vertes ni bâties.
    expect(extract.landuse).toEqual([])
    // Seules les voies présentes sont retenues.
    expect(extract.marked).toEqual([7])
  })
})
