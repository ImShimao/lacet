import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BYTES, download, isStored, storedBytes, storedZoom, totalBytes } from './offlineMaps'

/**
 * Le téléchargement d'une carte, et son plafond de place.
 *
 * Le plafond est en **octets**, et c'est la mesure qui l'a imposé, contre
 * l'intuition : une tuile vectorielle pèse vingt kilooctets à la campagne et
 * six cents en plein Paris, et rien dans son adresse ne le dit. Un plafond en
 * nombre de tuiles se trompait donc d'un facteur vingt, dans un sens comme dans
 * l'autre — soit une carte inutilement grossière là où la place ne manquait
 * pas, soit deux cents mégaoctets avalés sans prévenir.
 *
 * Ce qui se vérifie ici, et qui ne se voit pas à la lecture :
 *
 * - on s'arrête à une **frontière de niveau**, jamais au milieu — une carte
 *   plus grossière reste lisible, une carte tronquée laisse des carrés noirs ;
 * - le **premier niveau passe quoi qu'il arrive**, sinon un parcours en zone
 *   dense n'aurait aucune carte plutôt qu'une carte large ;
 * - un fichier qui ne répond pas **dégrade** le résultat, il ne l'annule pas.
 */

/** Un carré d'environ 4 km au centre de Paris — cinq niveaux de zoom. */
const PARCOURS = {
  name: 'Boucle test',
  distance_m: 10_000,
  geometry: [
    [2.32, 48.84],
    [2.38, 48.84],
    [2.38, 48.88],
    [2.32, 48.88],
    [2.32, 48.84],
  ],
}

const STYLE = {
  key: 'dark',
  label: 'Sombre',
  style: {
    sources: { carto: { tiles: ['https://tiles.example/{z}/{x}/{y}.mvt'] } },
    layers: [],
  },
}

/** Le zoom que porte une adresse de tuile, ou `null` pour le reste. */
const zoomDe = (url) => {
  const m = url.match(/^https:\/\/tiles\.example\/(\d+)\//)
  return m ? Number(m[1]) : null
}

let stockage
let mises

/**
 * Un réseau où l'on choisit le poids de chaque tuile, par niveau de zoom.
 * `tailles[z]` en octets ; une taille nulle simule un fichier qui ne répond pas.
 */
function reseau(tailles) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const z = zoomDe(url)
      const size = z === null ? 1024 : tailles[z]
      if (size === 0) throw new TypeError('Failed to fetch')
      return {
        ok: true,
        headers: { get: () => 'application/octet-stream' },
        // Seule la taille compte ici : pas la peine d'allouer six mégaoctets.
        arrayBuffer: async () => {
          mises.push(url)
          return { byteLength: size }
        },
      }
    }),
  )
}

beforeEach(() => {
  const donnees = new Map()
  stockage = {
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => donnees.set(k, v),
    removeItem: (k) => donnees.delete(k),
  }
  mises = []
  vi.stubGlobal('localStorage', stockage)
  // Présent, mais inutilisable : le magasin retombe en mémoire.
  vi.stubGlobal('indexedDB', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Les niveaux de zoom réellement enregistrés. */
const niveauxPris = () =>
  [...new Set(mises.map(zoomDe).filter((z) => z !== null))].sort((a, b) => a - b)

describe('quand la place ne manque pas', () => {
  it('descend jusqu’au zoom le plus fin', async () => {
    reseau({ 10: 5e3, 11: 5e3, 12: 5e3, 13: 5e3, 14: 5e3 })
    const { maxZoom } = await download(PARCOURS, STYLE)
    expect(maxZoom).toBe(14)
    expect(niveauxPris()).toEqual([10, 11, 12, 13, 14])
  })

  it('note la taille et le fond utilisé', async () => {
    reseau({ 10: 5e3, 11: 5e3, 12: 5e3, 13: 5e3, 14: 5e3 })
    const { bytes } = await download(PARCOURS, STYLE)
    expect(isStored(PARCOURS)).toBe(true)
    expect(storedBytes(PARCOURS)).toBe(bytes)
    expect(storedZoom(PARCOURS)).toBe(14)
    expect(totalBytes()).toBe(bytes)
  })
})

describe('le relief de la zone', () => {
  it('part avec la carte, pour que le D+ reste connu sans réseau', async () => {
    reseau({ 10: 5e3, 11: 5e3, 12: 5e3, 13: 5e3, 14: 5e3 })
    await download(PARCOURS, STYLE)
    const relief = mises.filter((u) => u.includes('/terrarium/12/'))
    // Le carré de Paris est à cheval sur deux tuiles dans chaque sens au zoom
    // 12 ; une de plus tout autour : quatre sur quatre.
    expect(relief.length).toBe(16)
    // Et son poids compte avec celui de la carte, qui l'efface avec elle.
    expect(storedBytes(PARCOURS)).toBeGreaterThanOrEqual(16 * 1024)
  })

  it('part aussi quand le plafond des fonds de carte a mordu', async () => {
    // Un mégaoctet de relief ne mérite pas d'attendre la place des bâtiments.
    reseau({ 10: 60e6, 11: 60e6, 12: 60e6, 13: 60e6, 14: 60e6 })
    await download(PARCOURS, STYLE)
    expect(mises.some((u) => u.includes('/terrarium/12/'))).toBe(true)
  })
})

describe('quand les tuiles sont énormes', () => {
  /** Six mégaoctets la tuile : Paris au zoom 14 dépasserait les 200 Mo. */
  const enorme = { 10: 6e6, 11: 6e6, 12: 6e6, 13: 6e6, 14: 6e6 }

  it('s’arrête avant de dépasser le plafond', async () => {
    reseau(enorme)
    const { bytes, maxZoom } = await download(PARCOURS, STYLE)
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES)
    // Le plafond a bien mordu : sans lui, le zoom 14 serait passé et la carte
    // pèserait plus de deux cents mégaoctets.
    expect(maxZoom).toBeLessThan(14)
  })

  it('s’arrête sur une frontière de niveau, pas au milieu', async () => {
    // Un niveau entamé puis abandonné laisserait des carrés noirs au milieu de
    // la carte, ce qui est pire qu'une carte franchement plus grossière.
    reseau(enorme)
    const { maxZoom } = await download(PARCOURS, STYLE)
    const pris = niveauxPris()
    expect(pris[pris.length - 1]).toBe(maxZoom)
    // Chaque niveau retenu est complet : autant d'adresses que le plan en prévoit.
    for (const z of pris) {
      const attendues = mises.filter((u) => zoomDe(u) === z)
      expect(new Set(attendues).size).toBe(attendues.length)
    }
  })

  it('garde tout de même le niveau le plus large', async () => {
    // Sans cette garantie, un parcours en zone dense n'aurait aucune carte du
    // tout — alors qu'une carte large permet encore de se situer.
    reseau({ 10: 60e6, 11: 60e6, 12: 60e6, 13: 60e6, 14: 60e6 })
    const { maxZoom } = await download(PARCOURS, STYLE)
    expect(maxZoom).toBe(10)
    expect(niveauxPris()).toEqual([10])
  })
})

describe('quand des fichiers manquent', () => {
  it('dégrade la carte sans annuler le téléchargement', async () => {
    // Les tuiles du zoom 14 ne répondent pas ; le reste doit rester utilisable.
    reseau({ 10: 5e3, 11: 5e3, 12: 5e3, 13: 5e3, 14: 0 })
    const { maxZoom, bytes } = await download(PARCOURS, STYLE)
    expect(bytes).toBeGreaterThan(0)
    expect(niveauxPris()).toEqual([10, 11, 12, 13])
    // Et le zoom annoncé est celui qu'on a vraiment : annoncer 14 alors que
    // rien n'en est arrivé se découvrirait dehors, sans réseau pour corriger.
    expect(maxZoom).toBe(13)
  })

  it('ne prétend pas avoir gardé un fond qu’il ne sait pas lire', async () => {
    reseau({ 10: 5e3 })
    const sansTuiles = { key: 'x', label: 'X', style: { sources: {}, layers: [] } }
    await expect(download(PARCOURS, sansTuiles)).rejects.toThrow(/ne peut pas être gardé/)
  })
})

describe('la progression', () => {
  it('va de zéro à un, sans reculer', async () => {
    reseau({ 10: 5e3, 11: 5e3, 12: 5e3, 13: 5e3, 14: 5e3 })
    const vus = []
    await download(PARCOURS, STYLE, (p) => vus.push(p))
    expect(vus[vus.length - 1]).toBe(1)
    expect(vus.every((p, i) => i === 0 || p >= vus[i - 1])).toBe(true)
    expect(Math.min(...vus)).toBeGreaterThan(0)
    expect(Math.max(...vus)).toBeLessThanOrEqual(1)
  })
})
