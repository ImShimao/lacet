import { beforeEach, describe, expect, it } from 'vitest'
import { clearTiles, readTile, resetUsage, setBudget, tileUsage, touchTiles, writeTile } from './tilestore'

/**
 * Les rues gardées sur l'appareil.
 *
 * Deux propriétés, et ce sont elles qui rendent l'app utilisable ailleurs que
 * chez soi. **Ce qu'on relit est ce qu'on a rangé** : une tuile mal relue, ce
 * sont des rues déplacées de quelques mètres, des jonctions qui ne se
 * rejoignent plus, et des itinéraires faux sans que rien ne le dise. **Et le
 * cache a une fin** : sans plafond, il grossit jusqu'à ce qu'iOS le vide en
 * entier — au pire moment, celui où l'on revient d'un voyage.
 */

/** Une tuile plausible : `n` voies de deux points, une traversée. */
function tile(n, seed = 0) {
  const ways = []
  for (let i = 0; i < n; i += 1) {
    const lon = 7.1 + (seed + i) * 0.0001
    const lat = 47.9 + (seed + i) * 0.00007
    ways.push({
      id: 1000 + seed * 1000 + i,
      tags: { highway: 'residential', name: `Rue ${i}`, surface: 'asphalt' },
      nodes: [9_000_000_000 + i * 3, 9_000_000_000 + i * 3 + 1],
      flat: Float64Array.of(lon, lat, Math.round((lon + 0.001) * 1e7) / 1e7, Math.round((lat + 0.001) * 1e7) / 1e7),
    })
  }
  return { ways, landuse: [], crossings: [{ id: 5 + seed, lon: 7.1, lat: 47.9, tags: { highway: 'crossing' } }] }
}

beforeEach(async () => {
  setBudget(1_000_000)
  await clearTiles()
  resetUsage()
})

describe('les rues gardées', () => {
  it('rend exactement ce qu’on lui a confié', async () => {
    const original = tile(3)
    await writeTile('0:141:958', 1000, original)
    const relu = await readTile('0:141:958')

    expect(relu.at).toBe(1000)
    expect(relu.extract.ways.map((w) => w.id)).toEqual(original.ways.map((w) => w.id))
    expect(relu.extract.ways[1].tags).toEqual(original.ways[1].tags)
    expect(relu.extract.ways[1].nodes).toEqual(original.ways[1].nodes)
    // Les coordonnées au bit près : sept décimales, comme OpenStreetMap.
    expect([...relu.extract.ways[2].flat]).toEqual([...original.ways[2].flat])
    expect(relu.extract.crossings[0]).toEqual(original.crossings[0])
  })

  it('sait ce qu’elle pèse', async () => {
    await writeTile('0:1:1', 1000, tile(20))
    const { bytes, count, budget } = await tileUsage()
    expect(count).toBe(1)
    expect(bytes).toBeGreaterThan(500)
    expect(budget).toBe(1_000_000)
  })

  it('jette les tuiles dont on ne s’est pas servi depuis le plus longtemps', async () => {
    // Trois tuiles largement au-dessus du budget : la plus anciennement utilisée
    // doit partir, et celle qui vient de servir rester.
    await writeTile('0:1:1', 1000, tile(120, 1))
    // Le budget se règle sur ce que pèse vraiment une tuile : deux y tiennent,
    // pas trois.
    const seule = (await tileUsage()).bytes
    setBudget(Math.round(seule * 2.5))

    await writeTile('0:2:2', 2000, tile(120, 2))
    // On se sert de la première : elle passe devant la deuxième.
    await touchTiles(['0:1:1'], 3000)
    await writeTile('0:3:3', 4000, tile(120, 3))

    expect(await readTile('0:3:3')).not.toBeNull()
    expect(await readTile('0:2:2')).toBeNull()
    expect(await readTile('0:1:1')).not.toBeNull()
    const { bytes } = await tileUsage()
    expect(bytes).toBeLessThanOrEqual(seule * 2.5)
  })

  it('annonce ce que pèse le cache même quand il a été rempli ailleurs', async () => {
    // Les tuiles s'écrivent dans le worker, l'écran « Mon compte » les compte
    // depuis la page : deux exemplaires du module, un seul magasin. L'écran
    // affichait « 0 o » sur un cache de cinquante mégaoctets parce qu'il avait
    // lu le journal en arrivant, avant la première recherche.
    const vide = await tileUsage()
    expect(vide.bytes).toBe(0)

    // Le worker range une tuile : un autre exemplaire du module, le même
    // magasin. La page n'en saura rien si elle se fie à ce qu'elle a en tête.
    const { store } = await import('./store')
    await store('osm').set('meta:usage', { total: 4242, tiles: { '0:4:4': { bytes: 4242, used: 1 } } })

    const relu = await tileUsage()
    expect(relu.bytes).toBe(4242)
    expect(relu.count).toBe(1)
  })

  it('relit encore les caches rangés par les versions d’avant', async () => {
    // Elles gardaient l'extrait tel quel. Les jeter ferait retélécharger toute
    // une région à la première mise à jour.
    const { store } = await import('./store')
    const ancien = tile(2, 7)
    await store('osm').set('0:9:9', { at: 500, extract: ancien })
    const relu = await readTile('0:9:9')
    expect(relu.at).toBe(500)
    expect(relu.extract.ways[0].id).toBe(ancien.ways[0].id)
  })
})
