// Les points d'eau et les toilettes le long d'une boucle.
//
// Au-delà de dix kilomètres, ou par trente degrés, c'est la question qu'on se
// pose avant de partir : où boire, où s'arrêter. OpenStreetMap les recense —
// fontaines, robinets de cimetière, toilettes publiques —, mais pas les
// archives de rues de l'app, qui ne gardent que ce qui se court. Ils viennent
// donc d'Overpass, en une petite requête : deux étiquettes, l'emprise de la
// boucle, quelques kilooctets.
//
// Gardés sur l'appareil par carreau, comme les rues : une boucle refaite, ou sa
// voisine, les retrouve sans réseau.

import { store } from './engine/store'
import { planarDistance } from './engine/geo'

// Un carreau fait 0,05° de côté — cinq kilomètres sur quatre en France.
const TILE_DEG = 0.05
// Les fontaines ne bougent guère, mais la carte s'en remplit : celle qu'on
// ajoute soi-même à OpenStreetMap, gardée un mois, restait un mois invisible.
// Une semaine, pour une requête de quelques kilooctets.
const TTL_MS = 7 * 86_400_000
// Au-delà de cette distance du tracé, ce n'est plus « sur le parcours ».
export const NEAR_M = 150
// Deux relevés du même robinet, à quelques mètres, ne font qu'un arrêt.
const SAME_M = 25
const TIMEOUT_MS = 15_000

// Les deux miroirs qui répondent (voir `engine/overpass.js`) : on les lance
// ensemble, le premier qui répond l'emporte.
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter']

export const KINDS = {
  water: { label: "Point d'eau", plural: "points d'eau", icon: 'water' },
  toilets: { label: 'Toilettes', plural: 'toilettes', icon: 'toilets' },
}

const cache = store('pois')

/** Les carreaux qui couvrent une emprise [s, w, n, e]. */
export function tilesOver([s, w, n, e]) {
  const out = []
  for (let iy = Math.floor(s / TILE_DEG); iy <= Math.floor(n / TILE_DEG); iy += 1) {
    for (let ix = Math.floor(w / TILE_DEG); ix <= Math.floor(e / TILE_DEG); ix += 1) out.push([ix, iy])
  }
  return out
}

const tileBox = ([ix, iy]) => [iy * TILE_DEG, ix * TILE_DEG, (iy + 1) * TILE_DEG, (ix + 1) * TILE_DEG]

/** La requête : l'eau potable et les toilettes, pas ce qui est fermé au public. */
export function poiQuery([s, w, n, e]) {
  const box = `(${s},${w},${n},${e})`
  return `[out:json][timeout:20];
(
  nwr["amenity"="drinking_water"]${box};
  nwr["amenity"="water_point"]${box};
  nwr["amenity"="fountain"]["drinking_water"="yes"]${box};
  nwr["amenity"="toilets"]${box};
);
out center tags;`
}

/** Ce qu'on garde d'un élément OpenStreetMap, ou `null` s'il ne sert pas. */
export function toPoi(el) {
  const tags = el.tags || {}
  if (['private', 'no'].includes(tags.access)) return null
  if (tags.drinking_water === 'no' || tags.disused === 'yes') return null
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (lat == null || lon == null) return null
  const kind = tags.amenity === 'toilets' ? 'toilets' : 'water'
  return {
    kind,
    lat,
    lon,
    ...(tags.name ? { name: tags.name } : {}),
    ...(tags.fee === 'yes' ? { fee: true } : {}),
    ...(tags.access === 'customers' ? { customers: true } : {}),
    ...(tags.seasonal && tags.seasonal !== 'no' ? { seasonal: true } : {}),
  }
}

/** Interroge les miroirs ensemble ; le premier qui répond l'emporte. */
async function overpass(body, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await Promise.any(
      MIRRORS.map(async (url) => {
        const response = await fetchImpl(url, { method: 'POST', body: `data=${encodeURIComponent(body)}`, signal: controller.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json()
      }),
    )
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}

/**
 * Les points d'intérêt d'une emprise, carreau par carreau : ce qui est sur
 * l'appareil d'abord, le reste en une requête. Sans réseau, ce qu'on a — et
 * `complete` à faux pour le dire.
 */
export async function poisIn(bbox, { fetchImpl = fetch, now = Date.now() } = {}) {
  const tiles = tilesOver(bbox)
  const found = []
  const missing = []
  for (const tile of tiles) {
    const kept = await cache.get(tile.join(':'))
    if (kept && now - kept.at < TTL_MS) found.push(...kept.pois)
    else missing.push({ tile, kept })
  }
  if (!missing.length) return { pois: found, complete: true }

  const boxes = missing.map((m) => tileBox(m.tile))
  const union = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
  let elements
  try {
    elements = (await overpass(poiQuery(union), fetchImpl)).elements || []
  } catch {
    // Hors ligne ou miroirs saturés : les carreaux périmés valent mieux que rien.
    for (const m of missing) if (m.kept) found.push(...m.kept.pois)
    return { pois: found, complete: false }
  }
  const pois = elements.map(toPoi).filter(Boolean)
  for (const { tile } of missing) {
    const [s, w, n, e] = tileBox(tile)
    const inside = pois.filter((p) => p.lat >= s && p.lat < n && p.lon >= w && p.lon < e)
    await cache.set(tile.join(':'), { at: now, pois: inside })
    found.push(...inside)
  }
  return { pois: found, complete: true }
}

/**
 * Ceux qui bordent le tracé, dans l'ordre où on les croise : à combien de
 * mètres du départ, et à combien du tracé.
 */
export function alongRoute(geometry, pois, maxM = NEAR_M) {
  if (!geometry?.length || !pois.length) return []
  const project = planarDistance(geometry[0][1])
  const cumulative = [0]
  for (let i = 1; i < geometry.length; i += 1) cumulative.push(cumulative[i - 1] + project(geometry[i - 1], geometry[i]))

  const hits = []
  for (const poi of pois) {
    const p = [poi.lon, poi.lat]
    let best = null
    for (let i = 0; i < geometry.length - 1; i += 1) {
      const a = geometry[i]
      const b = geometry[i + 1]
      const ab = project(a, b)
      const ap = project(a, p)
      const bp = project(b, p)
      // La projection sur le segment, par la loi des cosinus : pas besoin de
      // repère local, et exact à cette échelle.
      const t = ab > 0 ? Math.max(0, Math.min(1, (ap * ap - bp * bp + ab * ab) / (2 * ab * ab))) : 0
      const d = t === 0 ? ap : t === 1 ? bp : Math.sqrt(Math.max(0, ap * ap - (t * ab) ** 2))
      if (!best || d < best.off) best = { off: d, along: cumulative[i] + t * ab }
    }
    if (best.off <= maxM) hits.push({ ...poi, along: Math.round(best.along), off: Math.round(best.off) })
  }
  hits.sort((a, b) => a.along - b.along)
  // Le même robinet relevé deux fois — un nœud et le bâtiment qui l'abrite.
  return hits.filter(
    (h, i) => !hits.slice(0, i).some((o) => o.kind === h.kind && project([o.lon, o.lat], [h.lon, h.lat]) < SAME_M),
  )
}

/** L'emprise d'un tracé, agrandie de la distance où l'on cherche. */
export function routeBox(geometry, marginM = NEAR_M) {
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (const [lon, lat] of geometry) {
    if (lat < s) s = lat
    if (lat > n) n = lat
    if (lon < w) w = lon
    if (lon > e) e = lon
  }
  const dLat = marginM / 111_000
  const dLon = marginM / (111_000 * Math.cos((((s + n) / 2) * Math.PI) / 180))
  return [s - dLat, w - dLon, n + dLat, e + dLon]
}
