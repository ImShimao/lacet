import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { blockOf, fetchArchived, resetArchives, setArchiveSources } from './archive'
import { clearTiles } from './tilestore'

/**
 * Les archives de rues, lues à l'octet près.
 *
 * Ce qui est vérifié ici, c'est **l'accord entre les deux langages** : l'archive
 * d'essai est fabriquée par `scripts/pack_tiles.py`, en Python, et relue par le
 * client JavaScript de l'app. Un décalage d'un octet dans l'en-tête ou le
 * répertoire ne se verrait nulle part ailleurs — l'app dirait simplement, sans
 * raison visible, qu'elle n'a pas de rues pour ce coin.
 *
 * Et **la frugalité** : une recherche ne doit demander que les tuiles qu'elle
 * veut, en quelques requêtes, pas l'archive entière.
 *
 * L'archive d'essai se refabrique en appelant `pack.pack()` sur trois tuiles
 * synthétiques — voir l'historique de `__fixtures__/archive/14_94.lct`.
 */

const archive = readFileSync(new URL('./__fixtures__/archive/14_94.lct', import.meta.url))

/** Un serveur qui honore les plages d'octets, comme jsDelivr et GitHub. */
function fakeCdn({ ranges = true, only = null } = {}) {
  const calls = []
  const fetchImpl = async (url, { headers } = {}) => {
    const name = String(url).split('/').pop()
    if (only && name !== only) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    const range = headers?.Range?.match(/bytes=(\d+)-(\d+)/)
    calls.push({ name, range: range ? [Number(range[1]), Number(range[2])] : null })
    if (!range || !ranges) {
      return { ok: true, status: 200, arrayBuffer: async () => toBuffer(archive) }
    }
    const [, from, to] = range.map(Number)
    return {
      ok: true,
      status: 206,
      arrayBuffer: async () => toBuffer(archive.subarray(from, Math.min(to + 1, archive.length))),
    }
  }
  return { fetchImpl, calls }
}

const toBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

beforeEach(async () => {
  resetArchives()
  // Les répertoires sont aussi gardés sur l'appareil : sans ce ménage, le
  // deuxième test croirait les avoir déjà lus.
  await clearTiles()
  setArchiveSources(['https://exemple.test/packs'])
})

describe('les archives de rues', () => {
  it('range les tuiles par blocs d’un demi-degré', () => {
    expect(blockOf(140, 940)).toEqual([14, 94])
    expect(blockOf(141, 941)).toEqual([14, 94])
    expect(blockOf(150, 940)).toEqual([15, 94])
    // Les longitudes négatives tombent du bon côté : Brest n'est pas Berlin.
    expect(blockOf(-3, 940)).toEqual([-1, 94])
  })

  it('relit ce que le paquetage Python a écrit', async () => {
    const cdn = fakeCdn()
    const got = await fetchArchived(
      [
        [140, 940],
        [141, 941],
      ],
      { fetchImpl: cdn.fetchImpl },
    )
    expect([...got.keys()].sort()).toEqual(['140:940', '141:941'])

    const { at, extract } = got.get('140:940')
    expect(at).toBe(1_750_000_000_000)
    expect(extract.ways.length).toBe(12)
    expect(extract.ways[0].tags.name).toBe('Rue 140-0')
    // Les numéros de nœuds sont écrits en écarts : mal relus, les jonctions ne
    // se rejoindraient plus et les boucles seraient fausses.
    expect(extract.ways[1].nodes).toEqual([9_000_000_002, 9_000_000_003])
    // Coordonnées en centièmes de millionième de degré, premier point absolu.
    expect(extract.ways[0].flat[0]).toBeCloseTo(7.01, 7)
    expect(extract.crossings[0].tags.crossing).toBe('zebra')
  })

  it('ne demande que ce qu’elle lit', async () => {
    const cdn = fakeCdn()
    await fetchArchived([[141, 940]], { fetchImpl: cdn.fetchImpl })
    // Une requête pour le répertoire, une pour la tuile — et pas l'archive
    // entière : c'est tout l'intérêt.
    expect(cdn.calls.length).toBe(2)
    const [, tuile] = cdn.calls
    expect(tuile.range[1] - tuile.range[0]).toBeLessThan(archive.length)
  })

  it('demande d’un bloc les tuiles qui se suivent', async () => {
    const cdn = fakeCdn()
    await fetchArchived(
      [
        [140, 940],
        [141, 940],
        [141, 941],
      ],
      { fetchImpl: cdn.fetchImpl },
    )
    // Les tuiles voisines se suivent dans le fichier : une seule plage les
    // couvre toutes les trois, après la lecture du répertoire.
    expect(cdn.calls.length).toBe(2)
  })

  it('s’accommode d’un serveur qui ignore les plages', async () => {
    // Certains proxys rendent le fichier entier avec « HTTP 200 ». C'est
    // correct, seulement plus lourd : il ne faut pas pour autant se tromper de
    // tuile en la découpant.
    const cdn = fakeCdn({ ranges: false })
    const got = await fetchArchived([[141, 941]], { fetchImpl: cdn.fetchImpl })
    expect(got.get('141:941').extract.ways.length).toBe(5)
  })

  it('rend la main sans rien quand l’archive n’existe pas', async () => {
    // L'étranger, pour l'instant : Overpass reprend la main, et rien ne casse.
    const cdn = fakeCdn({ only: 'aucune.lct' })
    const got = await fetchArchived([[300, 800]], { fetchImpl: cdn.fetchImpl })
    expect(got.size).toBe(0)
  })

  it('ne redemande pas un répertoire déjà lu', async () => {
    const cdn = fakeCdn()
    await fetchArchived([[140, 940]], { fetchImpl: cdn.fetchImpl })
    await fetchArchived([[141, 941]], { fetchImpl: cdn.fetchImpl })
    const repertoires = cdn.calls.filter((c) => c.range && c.range[0] === 0)
    expect(repertoires.length).toBe(1)
  })
})
