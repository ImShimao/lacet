import { beforeEach, describe, expect, it } from 'vitest'
import {
  MIRRORS,
  TILE_DEG,
  clearTiles,
  fetchArea,
  hedgedRound,
  mirrorOrder,
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
  resetMirrorHealth()
  await clearTiles()
})

const BEAUNE = { lat: 47.0245, lon: 4.8395 }

// --- les tuiles ---------------------------------------------------------------

describe('le découpage en tuiles', () => {
  it('couvre tout le disque demandé', () => {
    const tiles = tilesFor(BEAUNE.lat, BEAUNE.lon, 7000)
    expect(tiles.length).toBe(15)
    const home = [Math.floor(BEAUNE.lon / TILE_DEG), Math.floor(BEAUNE.lat / TILE_DEG)]
    expect(tiles).toContainEqual(home)
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
  it('un miroir qui répond reste seul sollicité', async () => {
    const { fetchImpl, calls } = fakeNetwork()
    await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 50)
    expect(calls.map((c) => c.url)).toEqual([MIRRORS[0]])
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
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 500, 10)
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
    const answer = await hedgedRound(MIRRORS, 'data=(47,4.8,47.05,4.85);', fetchImpl, 5000, 10)
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
  it('ne fait que quelques requêtes pour une petite ville', async () => {
    // Quinze tuiles : la première seule, pour mesurer la densité, puis le reste
    // d'un bloc — au lieu de quinze requêtes.
    const { fetchImpl, calls } = fakeNetwork()
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl })
    expect(calls.length).toBeLessThanOrEqual(2)
    expect(extract.ways.length).toBe(15)
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
    expect(extract.ways.length).toBe(15)
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

  it('envoie deux lots à la fois dans une grande ville, jamais plus', async () => {
    // Overpass accorde deux requêtes simultanées par adresse : deux lots en
    // parallèle divisent l'attente, un troisième serait refusé.
    const base = fakeNetwork()
    let inFlight = 0
    let peak = 0
    const fetchImpl = async (url, options) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      try {
        return await base.fetchImpl(url, options)
      } finally {
        inFlight -= 1
      }
    }
    // Des lots d'environ trois tuiles, comme en plein Paris.
    const extract = await fetchArea({ ...BEAUNE, radiusM: 7000, targetM: 10_000, fetchImpl, chunkBytes: 1200 })
    expect(extract.ways.length).toBe(15)
    expect(peak).toBe(2)
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
