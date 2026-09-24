// Soleil, vent et altitude — portage de `solar.py`, `wind.py` et `elevation.py`.
//
// Les calculs sont fidèles aux modules Python. Les appels réseau, eux, partent
// désormais du téléphone : même services, mêmes paramètres, mêmes précautions
// (échec silencieux pour le vent, repli IGN → Valhalla pour l'altitude, un
// envoi à la fois vers Valhalla), et le cache vit dans IndexedDB.

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
/**
 * Le relief hors de France, vu depuis un navigateur.
 *
 * L'app interrogeait OpenTopoData. Deux choses l'en empêchaient, et aucune ne
 * se voyait : le jeu de données était nommé « eu_dem25m » au lieu de
 * « eudem25m » (HTTP 400, avalé par le repli), et **ce service n'envoie aucun
 * en-tête CORS** — un navigateur ne peut pas l'appeler, quoi qu'on fasse. Le
 * repli mondial n'a donc jamais rien rendu dans l'app : hors de France, l'IGN
 * répondait -99999, ces -99999 passaient pour le niveau de la mer, et toutes
 * les boucles d'un séjour à l'étranger s'affichaient « D+ 0 m ».
 *
 * Valhalla, lui, répond aux navigateurs — c'est déjà le calculateur de secours
 * pour les itinéraires — et accepte cinq cents points par envoi : mesuré à
 * 150 ms là où OpenTopoData, limité à une requête par seconde et cent points,
 * aurait demandé cinq secondes.
 */
const VALHALLA_HEIGHT_URL = 'https://valhalla1.openstreetmap.de/height'
const VALHALLA_BATCH = 500
const BATCH = 100
// L'IGN, lui, préfère un gros envoi à plusieurs petits. Mesuré sur mille points :
// un seul POST, moins d'une seconde à deux ; dix GET de cent en parallèle, plus
// de cinq ; deux POST de cinq cents en parallèle, dix. Le service met les
// requêtes simultanées en file : on envoie donc de gros lots, l'un après l'autre.
//
// **Cinq mille, et non mille.** Remesuré le 22 septembre 2026 : trois cents
// points coûtent 3,3 s, mille 3,1 s, cinq mille 3,7 s — le prix est celui de la
// requête, pas des points. Au-delà, le service refuse (« HTTP 400 » à six
// mille). Un lot de mille faisait donc partir deux requêtes, et attendre deux
// fois, pour cinq itinéraires de 10 km ; tout tient maintenant dans une.
const IGN_BATCH = 5000
const ROUND = 5
const ELEVATION_TILE = 0.05
/**
 * Le seuil d'hystérésis — et pourquoi il dépend de la source.
 *
 * Un modèle d'altitude tremble d'autant plus qu'il est grossier. Mesuré sur dix
 * boucles, cache vidé entre les deux fournisseurs : en montagne, l'IGN (1 m) et
 * Valhalla (~30 m) s'accordent à 1 ou 7 % près ; en ville plate, Valhalla
 * annonce 72 m de D+ à Paris contre 17, 35 à Strasbourg contre 8, 23 à Mulhouse
 * contre 2. Ce n'est pas du relief, c'est la grille qui tremble — et un seuil
 * de deux mètres compte ce tremblement comme des côtes.
 *
 * Huit mètres l'effacent : Paris retombe à 19, Strasbourg à 8, Mulhouse à 8,
 * pendant que les Vosges ne perdent que 5 %. Le seuil suit donc la source, et
 * la France garde ses deux mètres.
 */
const ASCENT_THRESHOLD_M = 2
export const COARSE_THRESHOLD_M = 8

const elevationStore = store('elevation')

// Les altitudes gardées avant la correction des points sans donnée valent zéro
// mètre là où le fournisseur ne savait pas. Un cache empoisonné : sans ce
// ménage, l'app continuerait d'annoncer « D+ 0 m » sur toutes les boucles d'un
// séjour à l'étranger, sans jamais redemander. On le vide une fois, et la
// marque reste pour ne pas recommencer à chaque recherche.
const FORMAT_KEY = 'meta:format'
// 3 : les altitudes gardées portent désormais la finesse de leur source.
const FORMAT = 3
let purge = null

function purgeLegacy() {
  if (!purge) {
    purge = (async () => {
      if ((await elevationStore.get(FORMAT_KEY)) === FORMAT) return
      await elevationStore.clear()
      await elevationStore.set(FORMAT_KEY, FORMAT)
    })()
  }
  return purge
}

// Un envoi à la fois : ce serveur est public, gratuit, et sert déjà les
// itinéraires de secours. Rien ne presse — cinq cents points passent d'un coup.
let heightQueue = Promise.resolve()

/**
 * Un point sans donnée — pas un point à zéro mètre.
 *
 * L'IGN couvre la France et répond -99999 partout ailleurs. Prendre ces
 * -99999 pour le niveau de la mer rendait **plate toute boucle hors de
 * France** : cinq itinéraires en Valais, « D+ 0 m » sur les cinq. Pire, la
 * réponse passait pour valide, et le fournisseur suivant — celui qui couvre le
 * monde — n'était jamais interrogé.
 */
const missing = (z) => z === null || z === undefined || z === -99999 || z === -32768

/** Altitudes de plusieurs tracés en une fois — `fetch_many`. */
export async function fetchMany(routes, { fetchImpl = fetch, providers = ['ign', 'valhalla'] } = {}) {
  if (!routes.length) return []
  await purgeLegacy()

  const wanted = new Map()
  for (const coords of routes) {
    for (const c of coords) wanted.set(roundKey(c), null)
  }

  // Les tuiles d'altitude déjà connues, lues **ensemble** : une par une, c'est
  // autant de transactions IndexedDB à la file avant la moindre requête.
  const tileOf = (key) => {
    const [lon, lat] = key.split(',').map(Number)
    return `${Math.floor(lon / ELEVATION_TILE)}_${Math.floor(lat / ELEVATION_TILE)}`
  }
  const names = [...new Set([...wanted.keys()].map(tileOf))]
  const stored = await Promise.all(names.map((tile) => elevationStore.get(tile)))
  const tiles = new Map(names.map((tile, i) => [tile, stored[i] ?? {}]))
  for (const key of wanted.keys()) {
    const known = tiles.get(tileOf(key))[key]
    if (known !== undefined) wanted.set(key, known)
  }

  const unknown = [...wanted].filter(([, v]) => v === null).map(([k]) => k)
  if (unknown.length) {
    const coords = unknown.map((k) => k.split(',').map(Number))
    const fresh = await fetchWithFallback(coords, providers, fetchImpl)
    if (fresh === null) return routes.map(() => null)

    const dirty = new Set()
    unknown.forEach((key, i) => {
      // Un point que personne ne connaît n'est pas gardé : le mettre en cache
      // interdirait de le redemander le jour où un fournisseur l'aura.
      if (fresh.values[i] === null) return
      // La finesse est gardée avec la valeur : sans elle, un point relu du
      // cache retrouverait le seuil fin, et le tremblement avec lui.
      const kept = fresh.coarse[i] ? { z: fresh.values[i], c: 1 } : fresh.values[i]
      wanted.set(key, kept)
      const [lon, lat] = coords[i]
      const tile = `${Math.floor(lon / ELEVATION_TILE)}_${Math.floor(lat / ELEVATION_TILE)}`
      tiles.get(tile)[key] = kept
      dirty.add(tile)
    })
    await Promise.all([...dirty].map((tile) => elevationStore.set(tile, tiles.get(tile))))
  }

  // Un tracé dont un seul point manque n'a pas de profil : mieux vaut « D+ — »
  // qu'un dénivelé calculé sur des trous. Les autres tracés gardent le leur.
  //
  // Chaque tracé rend ses altitudes **et le seuil qui leur convient** : le plus
  // grossier de ses points décide. Une boucle à cheval sur la frontière ne
  // mérite pas la finesse française sur sa moitié suisse.
  return routes.map((coords) => {
    if (!coords.length) return null
    const kept = coords.map((c) => wanted.get(roundKey(c)))
    if (kept.some((v) => v === null || v === undefined)) return null
    return {
      values: kept.map((v) => (typeof v === 'object' ? v.z : v)),
      threshold: kept.some((v) => typeof v === 'object' && v.c) ? COARSE_THRESHOLD_M : ASCENT_THRESHOLD_M,
    }
  })
}

const roundKey = (c) => `${pyRound(c[0], ROUND)},${pyRound(c[1], ROUND)}`

/**
 * Chaque fournisseur complète ce que le précédent n'a pas su dire.
 *
 * Le second ne remplace pas le premier : il ne reçoit que les points restés
 * sans réponse. Une boucle à cheval sur la frontière garde ainsi le mètre de
 * l'IGN côté français et prend Valhalla côté suisse, au lieu de tout redemander
 * au second et de perdre la précision du premier.
 *
 * Rend `null` si personne n'a rien su dire, et une liste à trous sinon.
 */
async function fetchWithFallback(coords, providers, fetchImpl) {
  const values = new Array(coords.length).fill(null)
  // Quels points viennent d'un modèle grossier : c'est ce qui décide du seuil.
  const coarse = new Array(coords.length).fill(false)
  let todo = coords.map((_, i) => i)

  for (const provider of providers) {
    if (!todo.length) break
    let answer = null
    try {
      answer = await fetchProvider(
        provider,
        todo.map((i) => coords[i]),
        fetchImpl,
      )
    } catch {
      continue /* fournisseur suivant */
    }
    if (!answer || answer.length !== todo.length) continue
    const rest = []
    todo.forEach((index, k) => {
      if (answer[k] === null || answer[k] === undefined) rest.push(index)
      else {
        values[index] = answer[k]
        coarse[index] = provider !== 'ign'
      }
    })
    todo = rest
  }

  return todo.length === coords.length ? null : { values, coarse }
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
  for (let i = 0; i < coords.length; i += VALHALLA_BATCH) batches.push(coords.slice(i, i + VALHALLA_BATCH))

  const run = heightQueue.then(async () => {
    const out = []
    for (const batch of batches) out.push(...(await valhallaHeights(batch, fetchImpl)))
    return out
  })
  heightQueue = run.catch(() => undefined)
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
    return missing(z) ? null : Number(z)
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

async function valhallaHeights(batch, fetchImpl) {
  const response = await withTimeout(
    fetchImpl(VALHALLA_HEIGHT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape: batch.map((c) => ({ lat: c[1], lon: c[0] })), range: false }),
    }),
    20_000,
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const heights = data.height ?? []
  if (heights.length !== batch.length) throw new Error(`${heights.length} altitudes pour ${batch.length} points`)
  return heights.map((z) => (missing(z) ? null : Number(z)))
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
