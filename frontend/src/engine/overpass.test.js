import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { setArchiveSources } from './archive'
import { clipToDisk } from './extract'
import {
  MIRRORS,
  TILE_DEG,
  clearTiles,
  fetchArea,
  hedgedRound,
  mirrorOrder,
  resetAbandoned,
  resetMirrorHealth,
  splitIntoTiles,
  takeChunk,
  tilesFor,
} from './overpass'

/**
 * Le téléchargement des données OpenStreetMap depuis l'appareil.
 *
 * Deux mesures ont décidé de sa forme, et ce sont elles qu'on vérifie ici.
 *
 * **Une requête Overpass coûte surtout son coût fixe** : quinze tuiles d'un coup
 * coûtent à peine plus qu'une seule. Les demander une par une prenait plus d'une
 * minute pour une petite ville.
 *
 * **Les miroirs publics tombent, et restent tombés** : en septembre 2026, un seul
 * des quatre répondait pour la France. Retenter chaque fois en premier un miroir
 * en panne coûtait quinze secondes à chaque requête.
 */

// --- un faux Overpass ---------------------------------------------------------

/** Emprise (s, w, n, e) lue dans la requête, comme le ferait Overpass. */
function bboxOf(body) {
  const match = decodeURIComponent(String(body).replace(/\+/g, ' ')).match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);/)
  return match.slice(1, 5).map(Number)
}

let wayId = 1

/** Une voie par tuile de l'emprise, plus une voie à cheval sur deux tuiles. */
function payloadFor([s, w, n, e]) {
  const elements = []
  for (let lat = s; lat < n - 1e-9; lat += TILE_DEG) {
    for (let lon = w; lon < e - 1e-9; lon += TILE_DEG) {
      const cLat = lat + TILE_DEG / 2
      const cLon = lon + TILE_DEG / 2
      elements.push({
        type: 'way',
        id: Math.round(cLon * 1000) * 100000 + Math.round(cLat * 1000),
        tags: { highway: 'residential' },
        nodes: [wayId++, wayId++],
        geometry: [
          { lat: cLat, lon: cLon },
          { lat: cLat + 0.001, lon: cLon + 0.001 },
        ],
      })
    }
  }
  return { elements }
}

/**
 * Les tuiles dont la fausse voie — posée au centre — est à portée du départ.
 *
 * Les tuiles demandées débordent toujours le disque voulu : elles sont prises
 * dès qu'elles l'effleurent. Ce qui est **rendu**, lui, est ramené au disque
 * (`clipToDisk`), et c'est ce compte-là qu'on attend.
 */
function inReach({ lat, lon }, radiusM) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  return tilesFor(lat, lon, radiusM).filter(([ix, iy]) => {
    const west = (ix + 0.5) * TILE_DEG
    const south = (iy + 0.5) * TILE_DEG
    const dx = (Math.min(Math.max(lon, west), west + 0.001) - lon) * kx
    const dy = (Math.min(Math.max(lat, south), south + 0.001) - lat) * 110_540
    return Math.hypot(dx, dy) <= radiusM
  }).length
}

/** Réseau simulé : `behaviour(url)` rend 'ok', 'empty', 'error' ou 'silent'. */
function fakeNetwork(behaviour = () => 'ok') {
  const calls = []
  const fetchImpl = async (url, { body, signal } = {}) => {
    if (url.endsWith('/status')) {
      calls.push({ url, status: true })
      const text = [
        'Rate limit: 2',
        '0 slots available now.',
        'Slot available after: 2026-09-16T22:21:16Z, in 0 seconds.',
      ].join('\n')
      return { ok: true, status: 200, text: async () => text }
    }
    calls.push({ url, bbox: bboxOf(body) })
    const mode = behaviour(url)
    if (mode === 'error') throw new TypeError('Failed to fetch')
    if (mode === 'busy') return { ok: false, status: 504, text: async () => '' }
    if (mode === 'limited') return { ok: false, status: 429, text: async () => '' }
    if (mode === 'silent') {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('annulé', 'AbortError')))
      })
    }
    const payload = mode === 'empty' ? { elements: [] } : payloadFor(bboxOf(body))
    const text = JSON.stringify(payload)
    return { ok: true, status: 200, text: async () => text }
  }
  return { fetchImpl, calls }
}

beforeEach(async () => {
  // Aucune archive en ligne dans les tests : on vérifie ici le chemin Overpass.
  setArchiveSources([])
  resetAbandoned()
  resetMirrorHealth()
  await clearTiles()
})

const BEAUNE = { lat: 47.0245, lon: 4.8395 }

// Un coin couvert par l'archive d'essai (voir `archive.test.js`).
const ARCHIVE = readFileSync(new URL('./__fixtures__/archive/14_94.lct', import.meta.url))
const ARCHIVE_POINT = { lat: 47.02, lon: 7.02 }

/** Un CDN qui sert l'archive d'essai par plages d'octets. */
function fakeArchive() {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, { headers } = {}) => {
      calls.push(String(url))
      const [, from, to] = headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number)
      const part = ARCHIVE.subarray(from, Math.min(to + 1, ARCHIVE.length))
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength),
      }
    },
  }
}

// --- les tuiles ---------------------------------------------------------------

describe('le découpage en tuiles', () => {
  it('couvre tout le disque demandé, sans les coins hors d’atteinte', () => {
    const radius = 7000
    const tiles = tilesFor(BEAUNE.lat, BEAUNE.lon, radius)
    const home = [Math.floor(BEAUNE.lon / TILE_DEG), Math.floor(BEAUNE.lat / TILE_DEG)]
    expect(tiles).toContainEqual(home)
    // Tout le bord du disque tombe dans une tuile retenue…
    const kx = Math.cos((BEAUNE.lat * Math.PI) / 180) * 111_320
    const keys = new Set(tiles.map(([ix, iy]) => `${ix}:${iy}`))
    for (let a = 0; a < 360; a += 5) {
      const lon = BEAUNE.lon + (Math.sin((a * Math.PI) / 180) * radius * 0.999) / kx
      const lat = BEAUNE.lat + (Math.cos((a * Math.PI) / 180) * radius * 0.999) / 110_540
      expect(keys.has(`${Math.floor(lon / TILE_DEG)}:${Math.floor(lat / TILE_DEG)}`)).toBe(true)
    }
    // …et le carré englobant en comptait davantage : ses coins sont hors d'atteinte.
    expect(tiles.length).toBeLessThan(15)
  })

  it('range une voie à cheval dans chacune des tuiles qu’elle traverse', () => {
    // Relue seule, une tuile doit contenir toutes les voies qui la traversent —
    // sinon une rue qui franchit la frontière disparaîtrait du graphe.
    const [ix, iy] = [96, 940]
    const onBorder = (ix + 1) * TILE_DEG
    const way = {
      id: 1,
      tags: {},
      nodes: [1, 2],
      flat: Float64Array.of(onBorder - 0.01, iy * TILE_DEG + 0.01, onBorder + 0.01, iy * TILE_DEG + 0.01),
    }
    const parts = splitIntoTiles({ ways: [way], landuse: [], crossings: [] }, { ix0: ix, iy0: iy, ix1: ix + 1, iy1: iy })
    expect(parts.get(`${ix}:${iy}`).ways).toEqual([way])
    expect(parts.get(`${ix + 1}:${iy}`).ways).toEqual([way])
  })

  it('range un passage piéton dans sa seule tuile', () => {
    const c = { id: 9, lon: 4.8123, lat: 47.0123, tags: {} }
    const parts = splitIntoTiles({ ways: [], landuse: [], crossings: [c] }, { ix0: 96, iy0: 940, ix1: 97, iy1: 941 })
    const where = [...parts].filter(([, p]) => p.crossings.length).map(([k]) => k)
    expect(where).toEqual([`${Math.floor(4.8123 / TILE_DEG)}:${Math.floor(47.0123 / TILE_DEG)}`])
  })
})

describe('les lots de tuiles', () => {
  const grid = (w, h) => {
    const out = []
    for (let iy = 0; iy < h; iy += 1) for (let ix = 0; ix < w; ix += 1) out.push([ix, iy])
    return out
  }

  it('prend toute la zone d’un coup quand le budget le permet', () => {
    const missing = grid(5, 3)
    expect(takeChunk(missing, 64).chunk).toHaveLength(15)
    expect(missing).toHaveLength(0)
  })

  it('ne dépasse jamais le budget', () => {
    const missing = grid(5, 3)
    const sizes = []
    while (missing.length) {
      const { rect } = takeChunk(missing, 7)
      sizes.push((rect.ix1 - rect.ix0 + 1) * (rect.iy1 - rect.iy0 + 1))
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(7)
  })

  it('recouvre un trou plutôt que de multiplier les requêtes', () => {
    // La tuile du départ part seule en premier et laisse un trou. L'éviter
    // découpait le reste en quatre requêtes ; le recouvrir n'en coûte qu'une,
    // parce que c'est le coût fixe d'une requête qui domine, pas son volume.
    const missing = grid(5, 3).filter(([ix, iy]) => !(ix === 2 && iy === 1))
    const { chunk, rect } = takeChunk(missing, 64)
    expect(chunk).toHaveLength(14)
    expect(rect).toEqual({ ix0: 0, iy0: 0, ix1: 4, iy1: 2 })
  })
})

// --- les miroirs --------------------------------------------------------------

describe('les miroirs', () => {
  it('un miroir qui répond reste seul sollicité quand on ne fait pas la course', async () => {
    const { fetchImpl, calls } = fakeNetwork()
    await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50, 10, null, 1)
    expect(calls.map((c) => c.url)).toEqual([MIRRORS[0]])
  })

  it('les deux premiers miroirs font la course, sans attendre le délai de secours', async () => {
    // Mesuré : l'instance principale rendait « 504 » au bout de 14 s selon la
    // minute ; celle d'OpenStreetMap France répondait en deux. Attendre huit
    // secondes avant de la solliciter, c'était huit secondes de trop.
    const { fetchImpl } = fakeNetwork((url) => (url === MIRRORS[0] ? 'silent' : 'ok'))
    const started = Date.now()
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 60_000)
    expect(answer.payload.elements.length).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('ne prend pas une réponse tronquée pour la zone entière', async () => {
    // À court de temps, Overpass répond « 200 » avec ce qu'il a trouvé et une
    // remarque : un quartier entier pourrait manquer sans que rien ne le dise.
    const fetchImpl = async (url) => {
      const payload =
        url === MIRRORS[0]
          ? { remark: 'runtime error: Query timed out in "query" at line 3 after 31 seconds.', elements: [{ type: 'way', id: 1 }] }
          : { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [] }, { type: 'way', id: 2 }] }
      const text = JSON.stringify(payload)
      return { ok: true, status: 200, text: async () => text }
    }
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50, 10, null, 1)
    expect(answer.payload.remark).toBeUndefined()
    expect(answer.payload.elements).toHaveLength(2)
  })

  it('un miroir muet ne fait pas attendre les autres', async () => {
    const { fetchImpl } = fakeNetwork((url) => (url === MIRRORS[0] ? 'silent' : 'ok'))
    const debut = Date.now()
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)
    expect(answer.payload.elements.length).toBeGreaterThan(0)
    expect(Date.now() - debut).toBeLessThan(1000)
  })

  it('un miroir en panne passe en fin de liste pour la suite de la session', async () => {
    // Mesuré : un miroir tombé le reste des heures. Le retenter en premier à
    // chaque requête coûtait le délai de chevauchement à chaque fois.
    const { fetchImpl } = fakeNetwork((url) => (url === MIRRORS[0] ? 'error' : 'ok'))
    await hedgedRound(mirrorOrder(), 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)
    expect(mirrorOrder()[0]).not.toBe(MIRRORS[0])
    expect(mirrorOrder().at(-1)).toBe(MIRRORS[0])
  })

  it('un miroir qui rend du vide là où un autre trouve des rues passe après', async () => {
    // C'est le cas d'osm.ch, qui ne couvre que la Suisse : il répond vite, et
    // vide, pour toute la France.
    const { fetchImpl } = fakeNetwork((url) => (url === MIRRORS[0] ? 'empty' : 'ok'))
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)
    expect(answer.payload.elements.length).toBeGreaterThan(0)
    expect(mirrorOrder()[0]).not.toBe(MIRRORS[0])
  })

  it('une surcharge passagère vaut un nouvel essai rapide sur le même miroir', async () => {
    // Mesuré : l'instance principale rendait « 504 » en neuf secondes, puis
    // répondait en 0,3 s au tour suivant. Basculer sur les miroirs de secours,
    // lents ou tombés, faisait attendre deux minutes.
    let first = true
    const { fetchImpl, calls } = fakeNetwork((url) => {
      if (url === MIRRORS[0] && first) {
        first = false
        return 'busy'
      }
      return url === MIRRORS[0] ? 'ok' : 'silent'
    })
    // Sans course, pour isoler la règle du nouvel essai.
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 500, 10, null, 1)
    expect(answer.payload.elements.length).toBeGreaterThan(0)
    expect(calls.map((c) => c.url)).toEqual([MIRRORS[0], MIRRORS[0]])
    expect(mirrorOrder()[0]).toBe(MIRRORS[0])
  })

  it('une limite de débit attend le temps annoncé par le miroir, puis réessaie', async () => {
    let first = true
    const { fetchImpl, calls } = fakeNetwork((url) => {
      if (url === MIRRORS[0] && first) {
        first = false
        return 'limited'
      }
      return url === MIRRORS[0] ? 'ok' : 'silent'
    })
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 5000, 10, null, 1)
    expect(answer.payload.elements.length).toBeGreaterThan(0)
    // La page d'état a été lue, et le même miroir a répondu au second essai.
    expect(calls.some((c) => c.status)).toBe(true)
    expect(calls.filter((c) => !c.status).map((c) => c.url)).toEqual([MIRRORS[0], MIRRORS[0]])
  })

  it('si tous décrivent le vide, c’est que la zone est vide', async () => {
    const { fetchImpl } = fakeNetwork(() => 'empty')
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)
    expect(answer.payload.elements).toEqual([])
  })

  it('ne croit pas un seul miroir qui décrit le vide', async () => {
    // Mesuré le 17 septembre 2026 : osm.ch, qui ne contient que la Suisse,
    // répondait « HTTP 200, aucune rue » en deux dixièmes de seconde pour
    // l'Alsace. Pris pour une réponse valable, ce vide affichait « aucune voie
    // praticable » en plein village — l'app accusait l'endroit, pas les serveurs.
    const { fetchImpl } = fakeNetwork((url) => (url === MIRRORS[0] ? 'empty' : 'error'))
    expect(await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)).toBe(null)
  })

  it('tous en panne ne rend rien', async () => {
    const { fetchImpl } = fakeNetwork(() => 'error')
    expect(await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)).toBe(null)
  })
})

// --- la zone complète ---------------------------------------------------------

describe('le téléchargement d’une zone', () => {
  it('rend la main même quand les serveurs traînent', async () => {
    // Le pire cas s'additionnait : quatre miroirs relancés l'un après l'autre,
    // deux tours, une file d'attente sur chacun, et autant de fois qu'il y a de
    // lots. Constaté sur un téléphone : vingt minutes d'écran de chargement.
    // Passé le plafond, on cherche avec ce qui est arrivé.
    const { fetchImpl } = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 2000, targetM: 3000, fetchImpl })

    const muet = fakeNetwork(() => 'silent')
    const started = Date.now()
    const extract = await fetchArea({
      ...BEAUNE,
      radiusM: 7000,
      targetM: 10_000,
      fetchImpl: muet.fetchImpl,
      dataBudgetMs: 200,
      hardBudgetMs: 400,
    })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(extract.ways.length).toBeGreaterThan(0)
    expect(extract.partial).toBe(true)
  })

  it('demande le cœur de la zone avant son bord quand elle est lourde', async () => {
    // En ville, une requête sur toute la zone met une quinzaine de secondes, et
    // les trois quarts de ce qu'elle rapporte sont des rues qu'aucune boucle
    // n'atteindra. Le cœur part donc seul d'abord : la recherche peut commencer
    // avec lui pendant que le bord arrive.
    const { fetchImpl, calls } = fakeNetwork()
    const extract = await fetchArea({
      ...BEAUNE,
      radiusM: 7000,
      targetM: 10_000,
      fetchImpl,
      tileBytesGuess: 5_000_000,
    })
    const demandes = calls.filter((c) => c.bbox).map((c) => c.bbox)
    const [s0, w0, n0, e0] = demandes[0]
    // Le départ est dedans…
    expect(s0).toBeLessThanOrEqual(BEAUNE.lat)
    expect(n0).toBeGreaterThanOrEqual(BEAUNE.lat)
    expect(w0).toBeLessThanOrEqual(BEAUNE.lon)
    expect(e0).toBeGreaterThanOrEqual(BEAUNE.lon)
    // …mais pas toute la zone : le bord viendra après.
    const toute = demandes.reduce(
      ([s, w, n, e], b) => [Math.min(s, b[0]), Math.min(w, b[1]), Math.max(n, b[2]), Math.max(e, b[3])],
      demandes[0],
    )
    expect((n0 - s0) * (e0 - w0)).toBeLessThan((toute[2] - toute[0]) * (toute[3] - toute[1]))
    // Et à la fin, tout est là.
    expect(extract.partial).toBeUndefined()
  })

  it('garde sur l’appareil ce qu’elle a tiré des archives', async () => {
    // Les rues d'un coin traversé une fois doivent y rester : c'est ce qui rend
    // la recherche suivante immédiate, et la zone utilisable sans réseau.
    setArchiveSources(['https://exemple.test/packs'])
    const cdn = fakeArchive()
    const mort = fakeNetwork(() => 'error')
    const zone = { ...ARCHIVE_POINT, radiusM: 1500, targetM: 3000, peripheralWaitMs: 50 }

    const premier = await fetchArea({ ...zone, fetchImpl: mort.fetchImpl, archiveFetch: cdn.fetchImpl })
    expect(premier.ways.length).toBeGreaterThan(0)
    expect(cdn.calls.length).toBeGreaterThan(0)

    // L'écriture est différée pour ne pas retarder la recherche.
    await new Promise((resolve) => setTimeout(resolve, 30))

    // Plus d'archive, plus de réseau : tout doit venir de l'appareil.
    setArchiveSources([])
    const second = await fetchArea({
      ...zone,
      fetchImpl: mort.fetchImpl,
      archiveFetch: async () => {
        throw new TypeError('Pas de réseau')
      },
    })
    expect(second.ways.length).toBe(premier.ways.length)
  }, 20_000)

  it('cherche sans les tuiles de bordure quand elles tardent', async () => {
    // Le cas d'une maison à deux kilomètres de la limite de la carte livrée :
    // le cœur de la zone est sur l'appareil, deux tuiles du bord restent à
    // Overpass — qui ne répond pas. Rester bloqué à 80 % pendant qu'il y a de
    // quoi tracer la boucle est le pire des deux mondes.
    const { fetchImpl } = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 5000, targetM: 10_000, fetchImpl })

    const muet = fakeNetwork(() => 'silent')
    const started = Date.now()
    const extract = await fetchArea({
      ...BEAUNE,
      radiusM: 7000,
      targetM: 10_000,
      fetchImpl: muet.fetchImpl,
      peripheralWaitMs: 150,
    })
    expect(muet.calls.length).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(extract.ways.length).toBeGreaterThan(0)
    // Et il le dit : le graphe qui en sortira ne sera pas gardé pour la suite.
    expect(extract.partial).toBe(true)

    // Une deuxième recherche au même endroit ne reperd pas ce délai : ces
    // tuiles-là se téléchargent en fond, on ne les attend plus.
    const encore = Date.now()
    await fetchArea({
      ...BEAUNE,
      radiusM: 7000,
      targetM: 10_000,
      fetchImpl: fakeNetwork(() => 'silent').fetchImpl,
      peripheralWaitMs: 5000,
    })
    expect(Date.now() - encore).toBeLessThan(1000)
  })

  it('attend, en revanche, les rues du cœur de la zone', async () => {
    // Sans elles, il n'y a pas de recherche : une panne franche doit rester une
    // erreur, pas une boucle tracée sur rien.
    const mort = fakeNetwork(() => 'error')
    await expect(
      fetchArea({ ...BEAUNE, radiusM: 3000, targetM: 5000, fetchImpl: mort.fetchImpl, peripheralWaitMs: 150 }),
    ).rejects.toThrow(/miroir/i)
  }, 20_000)

  it('ne rend que les rues à portée, en gardant les tuiles entières', async () => {
    // Les tuiles couvrent bien plus large que le disque demandé — elles sont
    // prises dès qu'elles l'effleurent — et ce débord n'a rien à faire dans le
    // graphe. Il doit rester dans le cache, en revanche : c'est lui qui rendra
    // la recherche suivante, deux rues plus loin, immédiate.
    const { fetchImpl } = fakeNetwork()
    const large = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    expect(large.ways.length).toBe(inReach(BEAUNE, 7000))
    expect(large.ways.length).toBeLessThan(tilesFor(BEAUNE.lat, BEAUNE.lon, 7000).length)

    // Deux kilomètres plus à l'est, sans réseau : tout doit venir du cache.
    const next = { lat: BEAUNE.lat, lon: BEAUNE.lon + 0.03 }
    const near = await fetchArea({
      ...next,
      radiusM: 2000,
      targetM: 3000,
      fetchImpl: async () => {
        throw new TypeError('Pas de réseau')
      },
    })
    expect(near.ways.length).toBe(inReach(next, 2000))
  })

  it('garde une voie qui ne fait que traverser le disque', async () => {
    // La découpe se fait sur l'emprise de la voie, pas sur ses points : une rue
    // dont les deux bouts sont dehors mais qui passe au milieu reste entière.
    const traversante = {
      ways: [
        { id: 1, tags: { highway: 'residential' }, nodes: [], flat: Float64Array.of(4.5, 47.0245, 5.2, 47.0245) },
        { id: 2, tags: { highway: 'residential' }, nodes: [], flat: Float64Array.of(5.4, 47.5, 5.5, 47.6) },
      ],
      landuse: [],
      crossings: [],
    }
    const kept = clipToDisk(traversante, BEAUNE.lon, BEAUNE.lat, 3000)
    expect(kept.ways.map((w) => w.id)).toEqual([1])
    expect(kept.ways[0].flat.length).toBe(4)
  })

  it('ne fait que quelques requêtes pour une petite ville', async () => {
    // Quinze tuiles : la première seule, pour mesurer la densité, puis le reste
    // d'un bloc — au lieu de quinze requêtes.
    const { fetchImpl, calls } = fakeNetwork()
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    // Deux lots au plus — chacun demandé à deux miroirs à la fois.
    expect(new Set(calls.map((c) => c.bbox.join())).size).toBeLessThanOrEqual(2)
    expect(extract.ways.length).toBe(inReach(BEAUNE, 7000))
  })

  it('commence par la tuile du départ', async () => {
    const { fetchImpl, calls } = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    const [s, w] = calls[0].bbox
    expect([Math.round(w / TILE_DEG), Math.round(s / TILE_DEG)]).toEqual([
      Math.floor(BEAUNE.lon / TILE_DEG),
      Math.floor(BEAUNE.lat / TILE_DEG),
    ])
  })

  it('ne retélécharge rien de ce qui est gardé', async () => {
    const first = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl: first.fetchImpl })
    const second = fakeNetwork()
    const extract = await fetchArea({ ...BEAUNE, radiusM: 4000, targetM: 5000, fetchImpl: second.fetchImpl })
    expect(second.calls).toHaveLength(0)
    expect(extract.ways.length).toBeGreaterThan(0)
  })

  it('dédoublonne les voies gardées dans plusieurs tuiles', async () => {
    const { fetchImpl } = fakeNetwork()
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    const ids = extract.ways.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('demande une petite zone d’un seul coup', async () => {
    // La tuile du départ part seule pour mesurer la densité — indispensable avant
    // de demander seize tuiles de Paris. Mais une sortie de 6 km tient dans une
    // requête, et la couper en deux payait deux fois le coût fixe d'Overpass,
    // mesuré entre 2 et 13 secondes.
    const { fetchImpl, calls } = fakeNetwork()
    const extract = await fetchArea({ ...BEAUNE, radiusM: 2000, targetM: 6000, fetchImpl })
    expect(calls).toHaveLength(1)
    expect(extract.ways.length).toBeGreaterThan(0)
  })

  it('repart en deux morceaux quand un lot trop large est refusé', async () => {
    // Une requête large est ce qu'un miroir déjà chargé abandonne en premier.
    // Conclure « plus de réseau » sur ce seul refus condamnait la recherche alors
    // que la même zone passe en deux morceaux.
    const base = fakeNetwork()
    const tailles = []
    const fetchImpl = async (url, options) => {
      if (url.endsWith('/status')) return base.fetchImpl(url, options)
      const [s, w, n, e] = bboxOf(options.body)
      const tuiles = Math.round(((n - s) / TILE_DEG) * ((e - w) / TILE_DEG))
      tailles.push(tuiles)
      if (tuiles > 12) throw new TypeError('Failed to fetch')
      return base.fetchImpl(url, options)
    }
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    expect(extract.ways.length).toBe(inReach(BEAUNE, 7000))
    expect(Math.max(...tailles.filter((t) => t <= 12))).toBeGreaterThan(1)
  }, 20_000)

  it('sert tout de suite des rues un peu anciennes, puis les rafraîchit en fond', async () => {
    // Revenir dans un coin après deux semaines coûtait vingt secondes de
    // téléchargement pour vérifier que des rues n'avaient pas bougé.
    const debut = Date.now()
    const first = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 3000, targetM: 4000, fetchImpl: first.fetchImpl, now: () => debut })

    const later = () => debut + 30 * 86_400_000
    const second = fakeNetwork()
    const tasks = []
    const extract = await fetchArea({
      ...BEAUNE, radiusM: 3000, targetM: 4000, fetchImpl: second.fetchImpl, now: later,
      schedule: (task) => tasks.push(task),
    })
    expect(extract.ways.length).toBeGreaterThan(0)
    expect(second.calls).toHaveLength(0)
    expect(tasks).toHaveLength(1)

    // Une seconde recherche au même endroit ne prévoit pas le même
    // rafraîchissement une deuxième fois.
    await fetchArea({
      ...BEAUNE, radiusM: 3000, targetM: 4000, fetchImpl: second.fetchImpl, now: later,
      schedule: (task) => tasks.push(task),
    })
    expect(tasks).toHaveLength(1)

    // Le rafraîchissement, lui, retélécharge bien.
    tasks[0]()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(second.calls.length).toBeGreaterThan(0)
  })

  it('envoie deux lots à la fois, chacun sur son serveur', async () => {
    // Overpass accorde deux requêtes simultanées par adresse : deux lots en
    // parallèle divisent l'attente, un troisième serait refusé. Et les deux
    // lots partent sur des serveurs différents — envoyés au même, ils entraient
    // dans la même file d'attente et arrivaient l'un après l'autre.
    const base = fakeNetwork()
    const inFlight = new Map()
    const peak = new Map()
    let together = 0
    let ensemble = 0
    const fetchImpl = async (url, options) => {
      inFlight.set(url, (inFlight.get(url) ?? 0) + 1)
      peak.set(url, Math.max(peak.get(url) ?? 0, inFlight.get(url)))
      together += 1
      ensemble = Math.max(ensemble, together)
      await new Promise((resolve) => setTimeout(resolve, 20))
      try {
        return await base.fetchImpl(url, options)
      } finally {
        inFlight.set(url, inFlight.get(url) - 1)
        together -= 1
      }
    }
    // Des lots d'environ trois tuiles, comme en plein Paris.
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl, chunkBytes: 1200 })
    expect(extract.ways.length).toBe(inReach(BEAUNE, 7000))
    expect(ensemble).toBeGreaterThanOrEqual(2)
    expect(Math.max(...peak.values())).toBeLessThanOrEqual(2)
    // Les deux serveurs travaillent. Depuis qu'il n'en reste que deux, chaque
    // lot fait la course sur les deux : chacun voit deux requêtes à la fois,
    // sa limite par adresse, jamais trois.
    expect([...peak.keys()].sort()).toEqual([...MIRRORS].sort())
  })

  it('préfère une copie périmée à un échec quand tout est muet', async () => {
    const debut = Date.now()
    const fresh = fakeNetwork()
    await fetchArea({ ...BEAUNE, radiusM: 3000, targetM: 4000, fetchImpl: fresh.fetchImpl, now: () => debut })
    // Au-delà de trois mois, la copie ne se sert plus d'office — sauf faute de mieux.
    const later = () => debut + 120 * 86_400_000
    const dead = fakeNetwork(() => 'error')
    const extract = await fetchArea({ ...BEAUNE, radiusM: 3000, targetM: 4000, fetchImpl: dead.fetchImpl, now: later })
    expect(extract.ways.length).toBeGreaterThan(0)
  }, 20_000)
})
