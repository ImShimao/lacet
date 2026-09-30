import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OFFLINE_PROTOCOL,
  clear,
  download,
  loadOffline,
  offlineRequest,
  planTiles,
  remove,
} from './offlineMaps'

/**
 * Les cartes hors ligne, rangées sur l'appareil et relues par la carte.
 *
 * L'app n'a pas de service worker : sans ce chemin, une carte se téléchargeait,
 * s'annonçait « hors ligne ✓ », et restait noire une fois dehors. Rien ne le
 * montre tant qu'on a du réseau — c'est-à-dire pendant tous les essais faits à
 * la maison.
 */

/** Un parcours de ~4 km au centre de Paris. */
const PARCOURS = {
  name: 'Boucle iPhone',
  distance_m: 8_000,
  geometry: [
    [2.32, 48.84],
    [2.38, 48.84],
    [2.38, 48.88],
    [2.32, 48.88],
    [2.32, 48.84],
  ],
}

const AUTRE = { ...PARCOURS, name: 'Autre boucle', distance_m: 9_000 }

const STYLE_URL = 'https://styles.example/nuit.json'
const TILEJSON_URL = 'https://tiles.example/tiles.json'
const TUILES = 'https://tiles-a.example/{z}/{x}/{y}.mvt'
const POLICE = ['Montserrat Medium', 'Open Sans Bold']

const STYLE = { key: 'dark', label: 'Nuit', style: STYLE_URL }

const DOCUMENTS = {
  [STYLE_URL]: {
    version: 8,
    sources: { carto: { type: 'vector', url: TILEJSON_URL } },
    sprite: 'https://tiles.example/sprite',
    glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf',
    layers: [{ id: 'noms', type: 'symbol', layout: { 'text-font': POLICE } }],
  },
  [TILEJSON_URL]: { tiles: [TUILES] },
}

/** Une réponse réseau, avec ce que le téléchargement et la carte en lisent. */
function reponse(url, { ok = true, corps } = {}) {
  const texte = corps ?? (DOCUMENTS[url] ? JSON.stringify(DOCUMENTS[url]) : `contenu:${url}`)
  const octets = () => new TextEncoder().encode(texte).buffer
  return {
    ok,
    status: ok ? 200 : 503,
    headers: { get: () => 'application/octet-stream' },
    json: async () => JSON.parse(texte),
    arrayBuffer: async () => octets(),
    clone: () => reponse(url, { ok, corps: texte }),
    blob: async () => ({ size: octets().byteLength }),
  }
}

let appels

/** Le réseau : `etat` vaut 'ok', 'coupé' ou une fonction (url) → réponse. */
function reseau(etat = 'ok') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      appels.push(url)
      if (etat === 'coupé') throw new TypeError('Load failed')
      if (typeof etat === 'function') return etat(url)
      return reponse(url)
    }),
  )
}

const texte = (data) => new TextDecoder().decode(data)
const requete = (url, type = 'arrayBuffer') => loadOffline({ url, type }, new AbortController())

/** L'adresse d'une tuile gardée, telle que MapLibre la demande : avec un sous-domaine. */
function tuileDemandee(sousDomaine = 'c') {
  const [url] = planTiles(PARCOURS.geometry, TUILES).urls.filter((u) => u.includes('/14/'))
  return url.replace('//tiles.', `//tiles-${sousDomaine}.`)
}

beforeEach(async () => {
  const donnees = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => donnees.set(k, v),
    removeItem: (k) => donnees.delete(k),
  })
  // Présent, mais inutilisable : le magasin retombe en mémoire.
  vi.stubGlobal('indexedDB', {})
  // L'API de cache ne sert pas : y toucher serait une erreur.
  vi.stubGlobal('caches', {
    open: () => {
      throw new Error('API de cache utilisée dans l’app iPhone')
    },
    delete: () => {
      throw new Error('API de cache utilisée dans l’app iPhone')
    },
  })
  appels = []
  reseau('ok')
  await clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('le rangement sur l’appareil', () => {
  it('garde la carte sans passer par l’API de cache', async () => {
    const { bytes, maxZoom } = await download(PARCOURS, STYLE)
    expect(maxZoom).toBe(14)
    expect(bytes).toBeGreaterThan(0)
  })

  it('laisse partir normalement ce qui n’est pas gardé', async () => {
    await download(PARCOURS, STYLE)
    expect(offlineRequest('https://tiles-a.example/14/1/1.mvt', 'Tile')).toBeUndefined()
  })
})

describe('la carte, une fois dehors', () => {
  it('lit les tuiles sur l’appareil, sans attendre le réseau', async () => {
    await download(PARCOURS, STYLE)
    reseau('coupé')
    appels = []

    const demandee = tuileDemandee('c')
    const detour = offlineRequest(demandee, 'Tile')
    expect(detour.url.startsWith(`${OFFLINE_PROTOCOL}://`)).toBe(true)

    const { data } = await requete(detour.url)
    // Rangée sous `tiles.`, demandée sous `tiles-c.` : c'est bien la même.
    expect(texte(data)).toBe(`contenu:${demandee.replace('//tiles-c.', '//tiles.')}`)
    expect(appels).toEqual([])
  })

  it('retrouve les polices sous le nom brut que MapLibre demande', async () => {
    // Sans elles, la carte hors ligne s'affiche sans un seul nom de rue.
    await download(PARCOURS, STYLE)
    reseau('coupé')
    const brute = `https://tiles.example/fonts/${POLICE.join(',')}/0-255.pbf`
    const detour = offlineRequest(brute, 'Glyphs')
    expect(detour).toBeDefined()
    expect(texte((await requete(detour.url)).data)).toMatch(/^contenu:/)
  })

  it('reprend la feuille de style gardée quand le réseau ne répond pas', async () => {
    await download(PARCOURS, STYLE)
    reseau('coupé')
    const detour = offlineRequest(STYLE_URL, 'Style')
    const { data } = await requete(detour.url, 'json')
    expect(data.glyphs).toBe(DOCUMENTS[STYLE_URL].glyphs)
  })

  it('préfère la feuille de style du réseau quand il répond', async () => {
    // Elle désigne les adresses des tuiles : une copie figée pointerait vers
    // d'anciennes adresses partout ailleurs sur la carte.
    await download(PARCOURS, STYLE)
    reseau((url) => reponse(url, { corps: JSON.stringify({ version: 8, nouvelle: true }) }))
    const detour = offlineRequest(STYLE_URL, 'Style')
    expect((await requete(detour.url, 'json')).data.nouvelle).toBe(true)
  })

  it('se rabat aussi sur la copie quand le réseau répond en erreur', async () => {
    // Une couverture qui faiblit ne coupe pas franchement : elle rend des 503.
    await download(PARCOURS, STYLE)
    reseau((url) => reponse(url, { ok: false, corps: 'indisponible' }))
    const detour = offlineRequest(TILEJSON_URL, 'Source')
    expect((await requete(detour.url, 'json')).data.tiles).toEqual([TUILES])
  })
})

describe('le retrait', () => {
  it('garde ce qu’un autre parcours utilise encore', async () => {
    await download(PARCOURS, STYLE)
    await download(AUTRE, STYLE)
    await remove(PARCOURS)
    reseau('coupé')
    const detour = offlineRequest(tuileDemandee(), 'Tile')
    expect(detour).toBeDefined()
    expect(texte((await requete(detour.url)).data)).toMatch(/^contenu:/)
  })

  it('ne détourne plus rien une fois tout effacé', async () => {
    await download(PARCOURS, STYLE)
    await clear()
    expect(offlineRequest(tuileDemandee(), 'Tile')).toBeUndefined()
    expect(offlineRequest(STYLE_URL, 'Style')).toBeUndefined()
  })
})
