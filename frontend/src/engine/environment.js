// Soleil, vent et altitude — portage de `solar.py`, `wind.py` et `elevation.py`.
//
// Les calculs sont fidèles aux modules Python. Les appels réseau, eux, partent
// désormais du téléphone : même services, mêmes paramètres, mêmes précautions
// (échec silencieux pour le vent, repli IGN → tuiles gardées → Valhalla pour
// l'altitude, un envoi à la fois vers Valhalla), et le cache vit dans IndexedDB.

import { store } from './store'
import { degrees, pyFixed, pyfloordiv, pyHypot, pymod, pyRound, pyRoundInt, radians } from './py'

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
 * Compter le dénivelé : tous les combien, lissé comment, à partir de quand.
 *
 * Le calcul d'avant — un point tous les 100 m, une moyenne sur trois points,
 * un seuil de deux mètres — rabotait les côtes. Une moyenne sur trois points
 * espacés de cent mètres, c'est un lissage sur trois cents : une bosse de
 * quinze mètres sur deux cents y fond de moitié. On annonçait 150 m, on en
 * montait 200.
 *
 * Mesuré le 4 octobre 2026 sur 54 boucles proposées par l'app autour de
 * Guebwiller, Soultz, Buhl, Cernay et Bollwiller — de la plaine aux Vosges —,
 * contre leur altitude IGN relevée tous les cinq mètres (lissée sur une
 * quinzaine de mètres, seuil d'un mètre : ce que mesure un altimètre) :
 *
 *                                total     écart moyen   pire boucle
 *   avant (100 m, 3 pts, 2 m)    −10 %        15 %          −48 %
 *   après (50 m, 60 m, 1 m)       −1 %       1,7 %          10 %
 *
 * L'écart venait presque tout entier du lissage : sans lui, cent mètres de pas
 * suffisaient déjà (2,5 %). Cinquante mètres gardent les bosses courtes, et un
 * noyau triangulaire de soixante mètres — un point voisin compte pour un
 * sixième — efface le tremblement du modèle sans toucher au relief. Triangle et
 * non gaussienne : sans exponentielle, le calcul est le même au bit près dans
 * le moteur Python de référence.
 *
 * Les ponts et passages souterrains, où le modèle de terrain voit la rivière ou
 * le talus, ne pesaient que 0,3 % sur ces 54 boucles : pas de traitement à part.
 *
 * **Le modèle grossier** (Valhalla, ~30 m, hors de France) tremble davantage :
 * en ville plate, un seuil de deux mètres lui faisait annoncer 72 m de D+ à
 * Paris contre 17. Mesuré sur les mêmes boucles, son meilleur réglage est un
 * noyau de cent mètres et un seuil de trois : −2 % au total et 11 % d'écart
 * moyen, contre −14 % et 21 % avec l'ancien seuil de huit mètres.
 */
export const ELEVATION_STEP_M = 50
const FINE = { kernelM: 60, thresholdM: 1 }
const COARSE = { kernelM: 100, thresholdM: 3 }
const ASCENT_THRESHOLD_M = FINE.thresholdM

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

// Le relief de la zone, avant de tracer — voir `Terrain` dans `elevation.py`.
const TERRAIN_STEP_DEG = [0.003, 0.002]
const TERRAIN_RADIUS_PER_STEP_M = 5000

/** L'altitude en tout point de la zone, interpolée sur une grille — `Terrain`. */
export class Terrain {
  constructor(lat, lon, radiusM) {
    const mult = Math.max(1, Math.ceil(radiusM / TERRAIN_RADIUS_PER_STEP_M))
    this.stepLon = TERRAIN_STEP_DEG[0] * mult
    this.stepLat = TERRAIN_STEP_DEG[1] * mult
    const halfLat = radiusM / 111_320
    const halfLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
    this.i0 = Math.floor((lat - halfLat) / this.stepLat)
    this.j0 = Math.floor((lon - halfLon) / this.stepLon)
    this.nLat = Math.ceil((lat + halfLat) / this.stepLat) - this.i0 + 1
    this.nLon = Math.ceil((lon + halfLon) / this.stepLon) - this.j0 + 1
    this.values = []
  }

  /** Les nœuds de la grille, ligne de latitude après ligne de latitude. */
  points() {
    const out = []
    for (let i = 0; i < this.nLat; i += 1) {
      for (let j = 0; j < this.nLon; j += 1) out.push([(this.j0 + j) * this.stepLon, (this.i0 + i) * this.stepLat])
    }
    return out
  }

  /** Interpolation bilinéaire ; au-delà du bord, la valeur du bord. */
  at(lon, lat) {
    const fi = lat / this.stepLat - this.i0
    const fj = lon / this.stepLon - this.j0
    const a = Math.min(this.nLat - 2, Math.max(0, Math.floor(fi)))
    const b = Math.min(this.nLon - 2, Math.max(0, Math.floor(fj)))
    const u = Math.min(1, Math.max(0, fi - a))
    const v = Math.min(1, Math.max(0, fj - b))
    const z = this.values
    const row = a * this.nLon
    const next = (a + 1) * this.nLon
    return (1 - u) * ((1 - v) * z[row + b] + v * z[row + b + 1]) + u * ((1 - v) * z[next + b] + v * z[next + b + 1])
  }

  /** Somme des montées et des descentes le long d'une ligne. */
  climb(coords) {
    let total = 0
    let prev = this.at(coords[0][0], coords[0][1])
    for (let k = 1; k < coords.length; k += 1) {
      const z = this.at(coords[k][0], coords[k][1])
      total += Math.abs(z - prev)
      prev = z
    }
    return total
  }
}

/** Altitudes de plusieurs tracés en une fois — `fetch_many`. */
export async function fetchMany(routes, { fetchImpl = fetch, providers = ['ign', 'terrain', 'valhalla'] } = {}) {
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
      // Ni ce que disent les tuiles gardées : elles le rediront sans réseau, et
      // l'IGN, s'il était rangé à leur place, ne serait plus jamais redemandé.
      if (fresh.local[i]) return
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
  // Chaque tracé dit **si ses altitudes sont grossières** : le plus grossier de
  // ses points décide du lissage et du seuil (voir `shapeRelief`). Une boucle à
  // cheval sur la frontière ne mérite pas la finesse française sur sa moitié
  // suisse.
  return routes.map((coords) => {
    if (!coords.length) return null
    const kept = coords.map((c) => wanted.get(roundKey(c)))
    if (kept.some((v) => v === null || v === undefined)) return null
    return {
      values: kept.map((v) => (typeof v === 'object' ? v.z : v)),
      coarse: kept.some((v) => typeof v === 'object' && v.c),
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
 * Rend `null` si personne n'a rien su dire, et une liste à trous sinon —
 * avec, point par point, si l'altitude vient d'un modèle grossier, et si elle
 * vient des tuiles gardées sur l'appareil.
 */
async function fetchWithFallback(coords, providers, fetchImpl) {
  const values = new Array(coords.length).fill(null)
  // Quels points viennent d'un modèle grossier : c'est ce qui décide du seuil.
  const coarse = new Array(coords.length).fill(false)
  const local = new Array(coords.length).fill(false)
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
        local[index] = provider === 'terrain'
      }
    })
    todo = rest
  }

  return todo.length === coords.length ? null : { values, coarse, local }
}

async function fetchProvider(provider, coords, fetchImpl) {
  if (provider === 'terrain') return storedTerrain(coords)
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

// === Terrain Tiles ============================================================

/**
 * L'altitude sans réseau — `TERRAIN_URL` dans `elevation.py`.
 *
 * L'IGN et Valhalla sont des services : sans couverture, plus de D+. Les
 * Terrain Tiles d'AWS (Mapzen, d'après Copernicus EU-DEM en Europe) se gardent,
 * elles, avec la carte d'un parcours (`offlineMaps.js`), dans le même magasin.
 * Mesuré le 19 octobre 2026 autour de Guebwiller et Soultz : au zoom 12, 3,5 m
 * d'écart moyen avec l'IGN et un D+ à −1 % au total — au réglage grossier, que
 * ce fournisseur reçoit puisqu'il n'est pas l'IGN. Les zooms 13 et 14 ne font
 * qu'agrandir les mêmes données. On ne lit que les tuiles déjà sur l'appareil :
 * en ligne, l'IGN répond mieux, et Valhalla sans rien télécharger.
 */
export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const TERRAIN_ZOOM = 12
export const terrainTileUrl = (x, y, z = TERRAIN_ZOOM) =>
  TERRAIN_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y)

const mapFiles = store('maps')
// Une tuile décodée pèse 256 Ko : on en garde une poignée, de quoi couvrir
// une recherche de quinze kilomètres (six tuiles) sans tout relire.
const GRID_MEMORY = 16
const grids = new Map()

/** Les octets RGB d'un PNG 8 bits sans entrelacement, filtres défaits — `decode_png`. */
export async function decodePng(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((v, i) => data[i] !== v)) throw new Error('pas un PNG')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const idat = []
  let width = 0
  let height = 0
  let channels = 0
  for (let pos = 8; pos < data.length; ) {
    const length = view.getUint32(pos)
    const kind = String.fromCharCode(...data.subarray(pos + 4, pos + 8))
    const body = data.subarray(pos + 8, pos + 8 + length)
    if (kind === 'IHDR') {
      width = view.getUint32(pos + 8)
      height = view.getUint32(pos + 12)
      const [depth, color, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error('PNG inattendu')
      channels = color === 2 ? 3 : 4
    } else if (kind === 'IDAT') idat.push(body)
    pos += 12 + length
  }
  // DecompressionStream plutôt qu'une bibliothèque : WebKit l'a depuis iOS 16.4.
  const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))
  const raw = new Uint8Array(await new Response(stream).arrayBuffer())

  const stride = width * channels
  const rgb = new Uint8Array(width * height * 3)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1)
    const kind = raw[start]
    const line = raw.slice(start + 1, start + 1 + stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      if (kind === 1) line[i] = (line[i] + a) & 255
      else if (kind === 2) line[i] = (line[i] + b) & 255
      else if (kind === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255
      else if (kind === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let k = 0; k < 3; k += 1) rgb[(y * width + x) * 3 + k] = line[x * channels + k]
    }
    prev = line
  }
  return { width, height, rgb }
}

/**
 * Les altitudes d'une tuile, ligne après ligne — `terrarium_grid`.
 *
 * Float32 suffit et reste exact : R × 256 + G + B / 256 tient en 24 bits.
 */
export async function terrariumGrid(bytes) {
  const { width, height, rgb } = await decodePng(bytes)
  const grid = new Float32Array(width * height)
  for (let k = 0; k < grid.length; k += 1) grid[k] = rgb[3 * k] * 256 + rgb[3 * k + 1] + rgb[3 * k + 2] / 256 - 32768
  return grid
}

/** La position en pixels du monde entier au zoom `z` — `terrarium_pixel`. */
export function terrariumPixel(lon, lat, z = TERRAIN_ZOOM) {
  const n = 2 ** z * 256
  const gx = ((lon + 180) / 360) * n - 0.5
  const s = Math.sin(radians(lat))
  const gy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - 0.5
  return [gx, gy]
}

/**
 * L'altitude de chaque point, interpolée entre les quatre centres de pixels
 * voisins — `terrain_values`. `tile(z, x, y)` rend la grille d'une tuile (256 ×
 * 256, ligne après ligne) ou `null` : le point reste alors sans réponse.
 */
export function terrainValues(coords, tile, z = TERRAIN_ZOOM) {
  const seen = new Map()
  const px = (x, y) => {
    const tx = pyfloordiv(x, 256)
    const ty = pyfloordiv(y, 256)
    const key = `${tx},${ty}`
    if (!seen.has(key)) seen.set(key, tile(z, tx, ty))
    const grid = seen.get(key)
    return grid ? grid[pymod(y, 256) * 256 + pymod(x, 256)] : null
  }
  return coords.map(([lon, lat]) => {
    const [gx, gy] = terrariumPixel(lon, lat, z)
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const u = gx - x0
    const v = gy - y0
    const a = px(x0, y0)
    const b = px(x0 + 1, y0)
    const c = px(x0, y0 + 1)
    const d = px(x0 + 1, y0 + 1)
    if (a === null || b === null || c === null || d === null) return null
    const top = (1 - u) * a + u * b
    const bottom = (1 - u) * c + u * d
    return (1 - v) * top + v * bottom
  })
}

/** Les tuiles qu'il faut pour ces points : celles des quatre pixels voisins. */
function terrainTilesFor(coords, z = TERRAIN_ZOOM) {
  const keys = new Set()
  for (const [lon, lat] of coords) {
    const [gx, gy] = terrariumPixel(lon, lat, z)
    for (const x of [Math.floor(gx), Math.floor(gx) + 1]) {
      for (const y of [Math.floor(gy), Math.floor(gy) + 1]) keys.add(`${pyfloordiv(x, 256)},${pyfloordiv(y, 256)}`)
    }
  }
  return [...keys].map((k) => k.split(',').map(Number))
}

/** Les altitudes lues dans les tuiles gardées, sans jamais toucher au réseau. */
async function storedTerrain(coords) {
  const here = await storedGrids(terrainTilesFor(coords))
  return terrainValues(coords, (z, x, y) => here.get(terrainTileUrl(x, y, z)) ?? null)
}

/** Les grilles gardées de ces tuiles, par adresse — celles qui manquent restent absentes. */
async function storedGrids(tiles) {
  // Celles de cet appel à part : le ménage de la mémoire ne doit pas jeter une
  // tuile dont un long parcours a encore besoin.
  const here = new Map()
  for (const [x, y] of tiles) {
    const url = terrainTileUrl(x, y)
    if (grids.has(url)) {
      here.set(url, grids.get(url))
      continue
    }
    let grid = null
    try {
      const file = await mapFiles.get(url)
      if (file) grid = await terrariumGrid(file.bytes)
    } catch {
      grid = null // une tuile illisible vaut une tuile absente
    }
    // Une tuile absente n'est pas retenue : elle peut arriver avec la
    // prochaine carte gardée.
    if (!grid) continue
    if (grids.size >= GRID_MEMORY) grids.delete(grids.keys().next().value)
    grids.set(url, grid)
    here.set(url, grid)
  }
  return here
}

/**
 * Le D+ qu'un parcours de `distanceKm` peut ramasser près de `lat, lon`, en
 * m/km, d'après les altitudes déjà gardées — sans réseau, avant la recherche.
 *
 * Un parcours s'éloigne au plus de `distanceKm / 2` du départ ; sur ce disque,
 * un tracé qui va et revient ramasse la moitié de ce qu'il parcourt en
 * dénivelé, soit `500 × pente` m/km. `pixelAt(x, y)` rend l'altitude d'un pixel
 * du monde à `z`, ou `null`. Rend `null` si moins de la moitié du disque est
 * gardée : une estimation à moitié vide ment.
 */
export function reachableClimbPerKm(lat, lon, distanceKm, pixelAt, z = TERRAIN_ZOOM) {
  const radius = Math.max(500, (distanceKm * 1000) / 2)
  const metresPerPixel = (40_075_016.686 * Math.cos(radians(lat))) / 2 ** (z + 8)
  const [cx, cy] = terrariumPixel(lon, lat, z)
  const reach = radius / metresPerPixel
  const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= reach * reach
  let climb = 0
  let length = 0
  let expected = 0
  let known = 0
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y += 1) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x += 1) {
      if (!inside(x, y)) continue
      expected += 1
      const here = pixelAt(x, y)
      if (here === null) continue
      known += 1
      // Un voisin à l'est et un au sud : chaque paire compte une fois.
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ]) {
        if (!inside(nx, ny)) continue
        const next = pixelAt(nx, ny)
        if (next === null) continue
        climb += Math.abs(next - here)
        length += metresPerPixel
      }
    }
  }
  if (known < expected / 2 || length === 0) return null
  return Math.round((10 * 500 * climb) / length) / 10
}

/**
 * Va chercher chez AWS les tuiles d'altitude qui manquent, et les garde avec
 * celles des cartes hors ligne. Sans elles, le badge de relief ne s'affichait
 * que là où l'on avait déjà gardé une carte : presque jamais. Données ouvertes,
 * sans clé ni coût ; une à quatre tuiles d'environ 100 Ko par départ. Une tuile
 * qui échoue reste absente.
 */
export async function fetchTerrainTiles(tiles, fetchImpl = fetch) {
  for (const [x, y] of tiles) {
    const url = terrainTileUrl(x, y)
    if (grids.has(url) || (await mapFiles.get(url))) continue
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      await mapFiles.set(url, { type: 'image/png', bytes })
    } catch {
      // hors ligne ou trop lent : le badge attendra
    }
  }
}

/**
 * Le D+ possible autour du départ, lu sur les grilles d'altitude de l'appareil
 * — voir `reachableClimbPerKm`. Les tuiles manquantes sont téléchargées une
 * fois ; sans réseau, une tuile absente rend `null`, et la réponse aussi.
 */
export async function reliefHint(lat, lon, distanceKm, { fetchImpl = fetch } = {}) {
  const radius = Math.max(500, (distanceKm * 1000) / 2)
  const dLat = radius / 111_320
  const dLon = radius / (111_320 * Math.cos(radians(lat)))
  const corners = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon - dLon, lat + dLat],
    [lon + dLon, lat + dLat],
  ]
  // Toutes les tuiles entre les coins, pas seulement celles des coins : au-delà
  // de 13 km, le disque en enjambe une troisième par le milieu.
  const cornerTiles = terrainTilesFor(corners)
  const xs = cornerTiles.map(([x]) => x)
  const ys = cornerTiles.map(([, y]) => y)
  const tiles = []
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) tiles.push([x, y])
  }
  await fetchTerrainTiles(tiles, fetchImpl)
  const here = await storedGrids(tiles)
  const pixelAt = (x, y) => {
    const tx = Math.floor(x / 256)
    const ty = Math.floor(y / 256)
    const grid = here.get(terrainTileUrl(tx, ty))
    if (!grid) return null
    const z = grid[(y - ty * 256) * 256 + (x - tx * 256)]
    return missing(z) ? null : z
  }
  return reachableClimbPerKm(lat, lon, distanceKm, pixelAt)
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

/**
 * Les altitudes d'un tracé échantillonné tous les `stepM` mètres, prêtes à
 * compter : lissées selon la finesse de leur source, avec le seuil qui leur
 * convient — `shape_relief`. `relief` est ce que rend `fetchMany`.
 */
export function shapeRelief(relief, stepM = ELEVATION_STEP_M) {
  const { kernelM, thresholdM } = relief.coarse ? COARSE : FINE
  return { values: smoothAlong(relief.values, stepM, kernelM), threshold: thresholdM }
}

/**
 * Lissage triangulaire le long du tracé — `smooth_along`. Un voisin à `d`
 * mètres pèse `1 − d / kernelM` ; au-delà du noyau, rien. Aux deux bouts, le
 * noyau tronqué est renormalisé.
 *
 * Les sommes se font une à une, dans l'ordre : c'est ce qui garde le résultat
 * identique au bit près à celui de Python.
 */
export function smoothAlong(elevations, stepM, kernelM) {
  const reach = Math.floor(kernelM / stepM)
  if (reach < 1 || elevations.length < 3) return elevations.slice()
  const weights = []
  for (let k = 0; k <= reach; k += 1) weights.push(1 - (k * stepM) / kernelM)
  const out = []
  for (let i = 0; i < elevations.length; i += 1) {
    let sum = 0
    let total = 0
    for (let k = -reach; k <= reach; k += 1) {
      const j = i + k
      if (j < 0 || j >= elevations.length) continue
      const w = weights[Math.abs(k)]
      sum += elevations[j] * w
      total += w
    }
    out.push(sum / total)
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
