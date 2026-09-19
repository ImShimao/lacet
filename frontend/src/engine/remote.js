// Les rues de pays entiers, préparées d'avance et hébergées en ligne.
//
// La carte régionale livrée dans l'app couvre la région où l'on court. Ailleurs
// — en vacances dans le Sud, en Suisse —, la première recherche attendait
// Overpass, un serveur qui calcule chaque requête et met de vingt secondes à
// plusieurs minutes quand il est chargé. Chaque mois, la compilation prépare
// les rues de plusieurs pays (`scripts/region_tiles.py --pack`) et les dépose sur
// un hébergement de fichiers (Hugging Face) : un fichier par pays, fait de
// tuiles compressées une à une et mises bout à bout, et l'index de leurs
// positions. L'app n'en lit que les octets des tuiles dont elle a besoin, par des
// requêtes HTTP « Range » : quelques mégaoctets, servis en une fraction de
// seconde par un réseau de diffusion, au lieu d'un calcul.
//
// Tout est facultatif : sans adresse configurée (`VITE_TILES_URL`), hors des
// pays préparés, ou si l'hébergement ne répond pas, Overpass reste la source.

import { store } from './store'
import { fromRegionTile } from './region'

const BASE = import.meta.env?.VITE_TILES_URL || ''

// Les octets de tuiles voisines se suivent dans le fichier d'un pays : on les
// demande d'un seul tenant. On tolère un petit trou entre deux tuiles plutôt
// que de payer une requête de plus, et on plafonne la taille d'un envoi pour
// que la progression reste lisible et qu'un échec ne coûte pas tout.
const MAX_GAP_BYTES = 256 * 1024
const MAX_RANGE_BYTES = 12 * 1024 * 1024
const PARALLEL = 4

const meta = store('osm')
let catalog = null

/** Le catalogue des pays préparés — ou `null`. */
function loadCatalog(base, fetchImpl) {
  if (!catalog) {
    catalog = (async () => {
      if (!base || typeof DecompressionStream === 'undefined') return null
      try {
        const response = await fetchImpl(`${base}catalog.json`)
        const data = response.ok ? await response.json() : null
        return data?.v === 1 ? data : null
      } catch {
        return null
      }
    })()
  }
  return catalog
}

/** Pour les tests : oublie le catalogue lu. */
export const resetRemote = () => {
  catalog = null
  indexes.clear()
}

const indexes = new Map()

/**
 * L'index d'un pays : la position de chaque tuile dans son fichier. Gardé sur
 * l'appareil jusqu'à la préparation suivante — celui de la France pèse
 * plusieurs centaines de kilooctets.
 */
function loadIndex(base, country, fetchImpl) {
  if (!indexes.has(country.id)) {
    indexes.set(
      country.id,
      (async () => {
        const key = `meta:remote:${country.id}`
        const kept = await meta.get(key)
        if (kept?.builtAt === country.builtAt) return kept
        try {
          const response = await fetchImpl(`${base}${country.id}/index.json`)
          if (!response.ok) return null
          const data = await response.json()
          const index = { builtAt: data.builtAt, tiles: data.tiles }
          await meta.set(key, index)
          return index
        } catch {
          return null
        }
      })(),
    )
  }
  return indexes.get(country.id)
}

const within = ([w, s, e, n], ix, iy, deg) => {
  const lon = (ix + 0.5) * deg
  const lat = (iy + 0.5) * deg
  return lon >= w && lon <= e && lat >= s && lat <= n
}

/**
 * Les tuiles demandées que les pays préparés contiennent, au format de l'app :
 * une `Map` de « ix_iy » vers `{ at, extract }`. `onTile` est appelé à chaque
 * tuile arrivée, pour la barre de progression.
 */
export async function remoteTiles(tiles, { fetchImpl = fetch, base = BASE, onTile = () => {} } = {}) {
  const found = new Map()
  const cat = await loadCatalog(base, fetchImpl)
  if (!cat || !tiles.length) return found

  // Qui contient quoi. Les emprises se chevauchent — celle de la France
  // englobe la Suisse —, elles ne font que désigner les candidats : c'est
  // l'index de chaque pays qui dit s'il a la tuile.
  const deg = cat.tileDeg ?? 0.05
  const candidates = cat.countries.filter((c) => tiles.some(([ix, iy]) => within(c.bbox, ix, iy, deg)))
  const loaded = await Promise.all(candidates.map((c) => loadIndex(base, c, fetchImpl)))
  const byCountry = new Map()
  for (const [ix, iy] of tiles) {
    const key = `${ix}_${iy}`
    const k = candidates.findIndex((c, i) => loaded[i]?.tiles[key] && within(c.bbox, ix, iy, deg))
    if (k < 0) continue
    if (!byCountry.has(k)) byCountry.set(k, [])
    byCountry.get(k).push(key)
  }

  const jobs = []
  for (const [k, keys] of byCountry) {
    const index = loaded[k]
    const wanted = keys
      .map((key) => ({ key, offset: index.tiles[key][0], length: index.tiles[key][1] }))
      .sort((a, b) => a.offset - b.offset)
    for (const range of mergeRanges(wanted)) jobs.push({ country: candidates[k], builtAt: index.builtAt, ...range })
  }

  // Quelques envois à la fois : assez pour ne pas attendre chacun en série,
  // pas au point de saturer la connexion d'un téléphone.
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try {
        const bytes = await fetchRange(`${base}${job.country.id}/tiles.bin`, job.start, job.end, fetchImpl)
        for (const tile of job.tiles) {
          const slice = bytes.subarray(tile.offset - job.start, tile.offset - job.start + tile.length)
          const data = JSON.parse(await gunzip(slice))
          found.set(tile.key, { at: job.builtAt, extract: fromRegionTile(data) })
          onTile(tile.key)
        }
      } catch {
        /* ces tuiles-là iront à Overpass */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker))
  return found
}

/** Regroupe des tuiles triées par position en plages d'un seul tenant. */
export function mergeRanges(sorted) {
  const ranges = []
  for (const tile of sorted) {
    const last = ranges.at(-1)
    const end = tile.offset + tile.length
    if (last && tile.offset - last.end <= MAX_GAP_BYTES && end - last.start <= MAX_RANGE_BYTES) {
      last.end = end
      last.tiles.push(tile)
    } else {
      ranges.push({ start: tile.offset, end, tiles: [tile] })
    }
  }
  return ranges
}

async function fetchRange(url, start, end, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Un serveur qui ignore « Range » rend le fichier entier : on y découpe quand même.
  return response.status === 200 ? bytes.subarray(start, end) : bytes
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
