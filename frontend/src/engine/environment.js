// Soleil, vent et altitude — portage de `solar.py`, `wind.py` et `elevation.py`.
//
// Les calculs sont fidèles aux modules Python. Les appels réseau, eux, partent
// désormais du téléphone : même services, mêmes paramètres, mêmes précautions
// (échec silencieux pour le vent, repli IGN → OpenTopoData pour l'altitude,
// une requête par seconde vers OpenTopoData), et le cache vit dans IndexedDB.

import { store } from './store'
import { degrees, pyFixed, pyHypot, pymod, pyRound, pyRoundInt, pySum, radians } from './py'

// === Soleil ===================================================================

const ZENITH_DEG = 90.833

function dayOfYearUtc(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.floor((date.getTime() - start) / 86_400_000) + 1
}

/** Fait-il nuit à cet endroit, à cet instant ? — `is_night`. */
export function isNight(lat, lon, when = new Date()) {
  const day = dayOfYearUtc(when)
  const hour = when.getUTCHours()
  const gamma = ((2 * Math.PI) / 365) * (day - 1 + (hour - 12) / 24)

  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const latRad = radians(lat)
  const cosHa =
    Math.cos(radians(ZENITH_DEG)) / (Math.cos(latRad) * Math.cos(decl)) - Math.tan(latRad) * Math.tan(decl)

  if (cosHa > 1 || cosHa < -1) return !(hour >= 6 && hour < 20)

  const ha = degrees(Math.acos(cosHa))
  const sunrise = 720 - 4 * (lon + ha) - eqtime
  const sunset = 720 - 4 * (lon - ha) - eqtime
  const nowMinutes = hour * 60 + when.getUTCMinutes()
  return !(sunrise <= nowMinutes && nowMinutes <= sunset)
}

// === Vent =====================================================================

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const MIN_SPEED_KMH = 12
const FULL_SPEED_KMH = 35
const WIND_TTL_MS = 3_600_000
const WIND_CELL_DEG = 0.1

export class Wind {
  /** `bearing` : direction vers laquelle le vent **souffle**. */
  constructor(bearing, speedKmh) {
    this.bearing = bearing
    this.speedKmh = speedKmh
  }

  get matters() {
    return this.speedKmh >= MIN_SPEED_KMH
  }

  get strength() {
    if (!this.matters) return 0
    return Math.min(1, (this.speedKmh - MIN_SPEED_KMH) / (FULL_SPEED_KMH - MIN_SPEED_KMH))
  }
}

const windCache = new Map()

export async function currentWind(lat, lon, fetchImpl = fetch) {
  const cell = `${pyRoundInt(lat / WIND_CELL_DEG)},${pyRoundInt(lon / WIND_CELL_DEG)}`
  const hit = windCache.get(cell)
  if (hit && Date.now() - hit.at < WIND_TTL_MS) return hit.wind

  let wind = null
  try {
    const params = new URLSearchParams({
      latitude: pyFixed(lat, 4),
      longitude: pyFixed(lon, 4),
      current: 'wind_speed_10m,wind_direction_10m',
      wind_speed_unit: 'kmh',
    })
    const response = await withTimeout(fetchImpl(`${OPEN_METEO_URL}?${params}`), 6000)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const current = (await response.json()).current ?? {}
    const speed = Number(current.wind_speed_10m)
    const from = Number(current.wind_direction_10m)
    if (Number.isFinite(speed) && Number.isFinite(from)) wind = new Wind(pymod(from + 180, 360), speed)
  } catch {
    wind = null // la météo est un bonus, jamais un socle
  }

  windCache.set(cell, { at: Date.now(), wind })
  if (windCache.size > 400) windCache.clear()
  return wind
}

/** Part du dernier tiers courue vent dans le dos — `tailwind_finish`. */
export function tailwindFinish(geometry, wind) {
  if (wind === null || !wind.matters || geometry.length < 8) return 0.5

  const start = Math.trunc((geometry.length * 2) / 3)
  let aligned = 0
  let total = 0
  for (let i = start; i < geometry.length - 1; i += 1) {
    const a = geometry[i]
    const b = geometry[i + 1]
    const dx = (b[0] - a[0]) * Math.cos(radians(a[1]))
    const dy = b[1] - a[1]
    const length = pyHypot(dx, dy)
    if (length === 0) continue
    const heading = pymod(degrees(Math.atan2(dx, dy)), 360)
    const delta = Math.abs(pymod(heading - wind.bearing + 180, 360) - 180)
    aligned += length * (1 - delta / 180)
    total += length
  }
  return total ? aligned / total : 0.5
}

// === Altitude =================================================================

const IGN_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
const OPENTOPO_URL = 'https://api.opentopodata.org/v1/eu_dem25m,srtm30m'
const BATCH = 100
// L'IGN, lui, préfère un gros envoi à plusieurs petits. Mesuré sur mille points :
// un seul POST, moins d'une seconde à deux ; dix GET de cent en parallèle, plus
// de cinq ; deux POST de cinq cents en parallèle, dix. Le service met les
// requêtes simultanées en file : on envoie donc de gros lots, l'un après l'autre.
const IGN_BATCH = 1000
const ROUND = 5
const ELEVATION_TILE = 0.05
const ASCENT_THRESHOLD_M = 2

const elevationStore = store('elevation')

let opentopoQueue = Promise.resolve()

const missing = (z) => z === null || z === undefined || z === -99999 || z === -32768

/** Altitudes de plusieurs tracés en une fois — `fetch_many`. */
export async function fetchMany(routes, { fetchImpl = fetch, providers = ['ign', 'opentopodata'] } = {}) {
  if (!routes.length) return []

  const wanted = new Map()
  for (const coords of routes) {
    for (const c of coords) wanted.set(roundKey(c), null)
  }

  const tiles = new Map()
  for (const key of wanted.keys()) {
    const [lon, lat] = key.split(',').map(Number)
    const tile = `${Math.floor(lon / ELEVATION_TILE)}_${Math.floor(lat / ELEVATION_TILE)}`
    if (!tiles.has(tile)) tiles.set(tile, (await elevationStore.get(tile)) ?? {})
    const known = tiles.get(tile)[key]
    if (known !== undefined) wanted.set(key, known)
  }

  const unknown = [...wanted].filter(([, v]) => v === null).map(([k]) => k)
  if (unknown.length) {
    const coords = unknown.map((k) => k.split(',').map(Number))
    const values = await fetchWithFallback(coords, providers, fetchImpl)
    if (values === null) return routes.map(() => null)

    const dirty = new Set()
    unknown.forEach((key, i) => {
      wanted.set(key, values[i])
      const [lon, lat] = coords[i]
      const tile = `${Math.floor(lon / ELEVATION_TILE)}_${Math.floor(lat / ELEVATION_TILE)}`
      tiles.get(tile)[key] = values[i]
      dirty.add(tile)
    })
    await Promise.all([...dirty].map((tile) => elevationStore.set(tile, tiles.get(tile))))
  }

  return routes.map((coords) => (coords.length ? coords.map((c) => wanted.get(roundKey(c))) : null))
}

const roundKey = (c) => `${pyRound(c[0], ROUND)},${pyRound(c[1], ROUND)}`

async function fetchWithFallback(coords, providers, fetchImpl) {
  for (const provider of providers) {
    try {
      const values = await fetchProvider(provider, coords, fetchImpl)
      if (values && values.length === coords.length) return values
    } catch {
      /* fournisseur suivant */
    }
  }
  return null
}

async function fetchProvider(provider, coords, fetchImpl) {
  if (provider === 'ign') {
    const out = []
    for (let i = 0; i < coords.length; i += IGN_BATCH) {
      out.push(...(await ignLot(coords.slice(i, i + IGN_BATCH), fetchImpl)))
    }
    return out
  }

  const batches = []
  for (let i = 0; i < coords.length; i += BATCH) batches.push(coords.slice(i, i + BATCH))

  // OpenTopoData : une requête par seconde, tous appels confondus.
  const run = opentopoQueue.then(async () => {
    const out = []
    for (let i = 0; i < batches.length; i += 1) {
      if (i) await new Promise((r) => setTimeout(r, 1050))
      out.push(...(await opentopoBatch(batches[i], fetchImpl)))
    }
    return out
  })
  opentopoQueue = run.catch(() => undefined)
  return run
}

const ignQuery = (batch) => ({
  lon: batch.map((c) => pyFixed(c[0], 6)).join('|'),
  lat: batch.map((c) => pyFixed(c[1], 6)).join('|'),
  resource: 'ign_rge_alti_wld',
  delimiter: '|',
  indent: 'false',
  measures: 'false',
  zonly: 'true',
})

function ignValues(data) {
  return (data.elevations ?? []).map((item) => {
    const z = item !== null && typeof item === 'object' ? item.z : item
    return missing(z) ? 0 : Number(z)
  })
}

/**
 * Un gros lot, en une requête POST. Si le POST échoue — un proxy qui le
 * refuse, une version du service qui ne l'accepte plus —, on retombe sur des GET
 * de cent points, plus lents mais éprouvés, avant de changer de fournisseur.
 */
async function ignLot(batch, fetchImpl) {
  try {
    const response = await withTimeout(
      fetchImpl(IGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ignQuery(batch)),
      }),
      20_000,
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const values = ignValues(await response.json())
    if (values.length === batch.length) return values
  } catch {
    /* repli sur les GET */
  }
  const out = []
  for (let i = 0; i < batch.length; i += BATCH) out.push(...(await ignBatch(batch.slice(i, i + BATCH), fetchImpl)))
  return out
}

async function ignBatch(batch, fetchImpl) {
  const params = new URLSearchParams(ignQuery(batch))
  const response = await withTimeout(fetchImpl(`${IGN_URL}?${params}`), 20_000)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ignValues(await response.json())
}

async function opentopoBatch(batch, fetchImpl) {
  const locations = batch.map((c) => `${pyFixed(c[1], 6)},${pyFixed(c[0], 6)}`).join('|')
  const response = await withTimeout(fetchImpl(`${OPENTOPO_URL}?locations=${encodeURIComponent(locations)}`), 20_000)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return (data.results ?? []).map((item) => (missing(item.elevation) ? 0 : Number(item.elevation)))
}

/** D+ et D− avec seuil d'hystérésis — `ascent_descent`. */
export function ascentDescent(elevations, threshold = ASCENT_THRESHOLD_M) {
  if (elevations.length < 2) return [0, 0]
  let ascent = 0
  let descent = 0
  let reference = elevations[0]
  for (let i = 1; i < elevations.length; i += 1) {
    const value = elevations[i]
    const delta = value - reference
    if (delta >= threshold) {
      ascent += delta
      reference = value
    } else if (delta <= -threshold) {
      descent += -delta
      reference = value
    }
  }
  return [pyRound(ascent, 1), pyRound(descent, 1)]
}

/** Moyenne glissante — `smooth`. */
export function smooth(elevations, window = 3) {
  if (window < 2 || elevations.length < window) return elevations
  const half = Math.trunc(window / 2)
  const out = []
  for (let i = 0; i < elevations.length; i += 1) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(elevations.length, i + half + 1)
    out.push(pySum(elevations.slice(lo, hi)) / (hi - lo))
  }
  return out
}

export function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('délai dépassé')), ms)
    }),
  ])
}
