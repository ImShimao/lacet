// Les données OpenStreetMap, téléchargées depuis l'appareil et gardées par tuiles.
//
// Le moteur Python demandait à Overpass un disque autour du départ et gardait
// l'extrait sur le disque du serveur. Sur un téléphone, deux choses changent, et
// ce sont deux mesures qui ont dicté la façon de faire.
//
// **Le coût d'une requête Overpass est presque entièrement fixe.** Mesuré à
// Beaune : une tuile de 5 km, 2,1 Mo en 1,4 s ; les quinze tuiles de la zone
// d'un seul tenant, 8,8 Mo en 1,8 s. La première version demandait les tuiles
// une par une, et payait quinze fois ce coût fixe — plus d'une minute pour une
// petite ville. Les tuiles manquantes partent donc **ensemble**, et la réponse
// est redécoupée en tuiles pour le cache.
//
// **Mais un extrait de grande ville ne tient pas d'un bloc.** Une tuile de Paris
// pèse des dizaines de mégaoctets ; en demander seize d'un coup ferait tomber
// l'app. La taille des lots s'adapte donc à la densité mesurée : la tuile du
// départ d'abord, seule, puis autant de tuiles qu'il en tient dans
// `CHUNK_BYTES` au poids constaté. Une petite ville part en deux requêtes,
// Paris en plusieurs lots raisonnables.
//
// Les tuiles gardées servent ensuite à toutes les recherches voisines : changer
// de distance ou partir de la rue d'à côté ne retélécharge que ce qui manque.

import { emptyExtract, fromOverpass, mergeExtracts } from './extract'
import { bboxAround } from './geo'
import { pyFixed } from './py'
import { store } from './store'

export const TILE_DEG = 0.05
const TTL_MS = 14 * 86_400_000
const CHUNK_BYTES = 40_000_000
const MAX_CHUNK_TILES = 64
const HEDGE_DELAY_MS = 8_000
const RETRY_DELAY_MS = 1_500
const MAX_RETRIES = 2
const MAX_SLOT_WAIT_S = 60
const QUERY_TIMEOUT_S = 90
const ROUNDS = 2

// Ordre de préférence. L'instance principale d'abord : c'est la plus fiable, et
// mesuré en septembre 2026, la seule des quatre qui répondait pour la France
// (kumi et private.coffee restaient muets, osm.ch ne couvre que la Suisse).
export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]

const EXCLUDED_HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape'
const BUILTUP_LANDUSE = 'residential|retail|commercial|industrial|education'
const EXCLUDED_SERVICE = 'parking_aisle|driveway|drive-through|slipway'

const DETAIL_LEVELS = [
  [25_000, ''],
  [60_000, 'service'],
  [120_000, 'service|footway|steps|pedestrian|bridleway'],
  [Infinity, 'service|footway|steps|pedestrian|bridleway|path|track|living_street'],
]

export function detailLevel(targetM) {
  return DETAIL_LEVELS.findIndex(([ceiling]) => targetM <= ceiling)
}

export function query(level, [s, w, n, e]) {
  const extra = DETAIL_LEVELS[level][1]
  const excluded = extra ? `${EXCLUDED_HIGHWAYS}|${extra}` : EXCLUDED_HIGHWAYS
  const bbox = [s, w, n, e].map((v) => pyFixed(v, 6)).join(',')
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];
(
  way["highway"]["highway"!~"^(${excluded})$"]["service"!~"^(${EXCLUDED_SERVICE})$"]["area"!~"^yes$"](${bbox});
);
out body geom;
(
  way["landuse"~"^(${BUILTUP_LANDUSE})$"](${bbox});
);
out geom;
(
  node["highway"="crossing"](${bbox});
);
out body;`
}

// --- tuiles -------------------------------------------------------------------

/** Tuiles (ix, iy) couvrant le disque de rayon `radiusM`, rangées ligne par ligne. */
export function tilesFor(lat, lon, radiusM) {
  const [s, w, n, e] = bboxAround(lat, lon, radiusM)
  const out = []
  for (let iy = Math.floor(s / TILE_DEG); iy <= Math.floor(n / TILE_DEG); iy += 1) {
    for (let ix = Math.floor(w / TILE_DEG); ix <= Math.floor(e / TILE_DEG); ix += 1) out.push([ix, iy])
  }
  return out
}

export const tileKey = (level, [ix, iy]) => `${level}:${ix}:${iy}`

/** Emprise (s, w, n, e) d'un rectangle de tuiles. */
const rectBbox = ({ ix0, iy0, ix1, iy1 }) => [iy0 * TILE_DEG, ix0 * TILE_DEG, (iy1 + 1) * TILE_DEG, (ix1 + 1) * TILE_DEG]

function rectOf(tiles) {
  let ix0 = Infinity
  let iy0 = Infinity
  let ix1 = -Infinity
  let iy1 = -Infinity
  for (const [ix, iy] of tiles) {
    ix0 = Math.min(ix0, ix)
    iy0 = Math.min(iy0, iy)
    ix1 = Math.max(ix1, ix)
    iy1 = Math.max(iy1, iy)
  }
  return { ix0, iy0, ix1, iy1 }
}

const rectSize = (r) => (r.ix1 - r.ix0 + 1) * (r.iy1 - r.iy0 + 1)

// Une géométrie posée pile sur la frontière de deux tuiles appartient aux deux :
// la marge évite qu'un arrondi la range d'un seul côté et la fasse manquer à
// l'autre.
const EDGE = 1e-9

/**
 * Redécoupe un extrait en tuiles.
 *
 * Une voie va dans **chaque** tuile que son emprise touche : une rue à cheval sur
 * deux tuiles est gardée dans les deux, et la fusion la dédoublonne. C'est ce
 * qui garantit qu'une tuile relue seule contient toutes les voies qui la
 * traversent — exactement ce qu'Overpass rendrait pour elle.
 */
export function splitIntoTiles(extract, rect) {
  const parts = new Map()
  for (let iy = rect.iy0; iy <= rect.iy1; iy += 1) {
    for (let ix = rect.ix0; ix <= rect.ix1; ix += 1) parts.set(`${ix}:${iy}`, emptyExtract())
  }

  const place = (flat, push) => {
    let minLon = Infinity
    let minLat = Infinity
    let maxLon = -Infinity
    let maxLat = -Infinity
    for (let i = 0; i < flat.length; i += 2) {
      minLon = Math.min(minLon, flat[i])
      maxLon = Math.max(maxLon, flat[i])
      minLat = Math.min(minLat, flat[i + 1])
      maxLat = Math.max(maxLat, flat[i + 1])
    }
    const ix0 = Math.max(rect.ix0, Math.floor((minLon - EDGE) / TILE_DEG))
    const ix1 = Math.min(rect.ix1, Math.floor((maxLon + EDGE) / TILE_DEG))
    const iy0 = Math.max(rect.iy0, Math.floor((minLat - EDGE) / TILE_DEG))
    const iy1 = Math.min(rect.iy1, Math.floor((maxLat + EDGE) / TILE_DEG))
    for (let iy = iy0; iy <= iy1; iy += 1) {
      for (let ix = ix0; ix <= ix1; ix += 1) push(parts.get(`${ix}:${iy}`))
    }
  }

  for (const way of extract.ways) place(way.flat, (part) => part.ways.push(way))
  for (const area of extract.landuse) place(area.flat, (part) => part.landuse.push(area))
  for (const c of extract.crossings) {
    place(Float64Array.of(c.lon, c.lat), (part) => part.crossings.push(c))
  }
  return parts
}

// --- téléchargement -----------------------------------------------------------

const tiles = store('osm')

export class OverpassError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OverpassError'
  }
}

const SILENT =
  "Aucun miroir OpenStreetMap n'a répondu. Vérifie ta connexion, ou réessaie dans une minute : ces serveurs sont publics et gratuits, et ils saturent régulièrement aux heures ouvrées."

/**
 * L'extrait couvrant la zone. `onProgress(fraction)` suit les tuiles obtenues.
 */
export async function fetchArea({ lat, lon, radiusM, targetM, onProgress = () => {}, fetchImpl = fetch, now = Date.now }) {
  const level = detailLevel(targetM)
  const wanted = tilesFor(lat, lon, radiusM)
  const obtained = new Map()
  const stale = new Map()
  const missing = []

  for (const tile of wanted) {
    const key = tileKey(level, tile)
    const cached = await tiles.get(key)
    if (cached && now() - cached.at < TTL_MS) obtained.set(key, cached.extract)
    else {
      missing.push(tile)
      if (cached) stale.set(key, cached.extract)
    }
  }
  const report = () => onProgress(obtained.size / wanted.length)
  report()

  // La tuile du départ d'abord : c'est elle qui mesure la densité de la zone.
  const home = [Math.floor(lon / TILE_DEG), Math.floor(lat / TILE_DEG)]
  missing.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))
  const homeIndex = missing.findIndex(([ix, iy]) => ix === home[0] && iy === home[1])
  if (homeIndex > 0) missing.unshift(...missing.splice(homeIndex, 1))

  let bytesPerTile = null
  let silent = false
  while (missing.length) {
    const budget =
      bytesPerTile === null ? 1 : Math.max(1, Math.min(MAX_CHUNK_TILES, Math.floor(CHUNK_BYTES / Math.max(bytesPerTile, 1))))
    const { chunk, rect } = takeChunk(missing, budget)

    // Quand un lot entier est resté sans réponse, les suivants le resteraient :
    // réseau coupé, ou tous les miroirs tombés. Relancer deux tours de tentatives
    // pour chaque tuile faisait attendre des dizaines de secondes pour rien.
    const answer = silent ? null : await queryMirrors(query(level, rectBbox(rect)), fetchImpl)
    if (answer === null) {
      silent = true
      // Tous les miroirs sont muets : une copie périmée vaut mieux qu'un échec.
      for (const tile of chunk) {
        const key = tileKey(level, tile)
        if (!stale.has(key)) throw new OverpassError(SILENT)
        obtained.set(key, stale.get(key))
      }
      report()
      continue
    }

    bytesPerTile = answer.bytes / rectSize(rect)
    const extract = fromOverpass(answer.payload)
    const parts = splitIntoTiles(extract, rect)
    for (const [cell, part] of parts) {
      const [ix, iy] = cell.split(':').map(Number)
      const key = tileKey(level, [ix, iy])
      // Une tuile vide n'est pas gardée : si le vide venait d'une panne, on ne
      // veut pas le figer pour deux semaines.
      if (part.ways.length) await tiles.set(key, { at: now(), extract: part })
      if (wanted.some(([wx, wy]) => wx === ix && wy === iy)) obtained.set(key, part)
    }
    report()
  }

  return mergeExtracts(wanted.map((tile) => obtained.get(tileKey(level, tile)) ?? emptyExtract()))
}

/**
 * Le prochain rectangle à demander, d'au plus `budget` tuiles.
 *
 * Il peut contenir des tuiles déjà obtenues — la tuile du départ, prise seule
 * en premier, laisse un trou au milieu de la zone. Les recouvrir est voulu : une
 * tuile de plus dans une requête ne coûte presque rien, alors qu'éviter le trou
 * découpait le reste en quatre requêtes, et c'est le coût fixe de chacune qui
 * domine.
 *
 * Quand tout ce qui reste tient dans le budget, un seul rectangle le couvre.
 * Sinon il part du coin de la zone restante et s'étend vers la droite, puis
 * vers le bas, tant que le budget le permet.
 */
export function takeChunk(missing, budget) {
  const bounds = rectOf(missing)
  let rect
  if (rectSize(bounds) <= budget) {
    rect = bounds
  } else {
    const [x0, y0] = missing[0]
    const x1 = Math.min(bounds.ix1, x0 + Math.max(0, budget - 1))
    const width = x1 - x0 + 1
    const y1 = Math.min(bounds.iy1, y0 + Math.max(0, Math.floor(budget / width) - 1))
    rect = { ix0: x0, iy0: y0, ix1: x1, iy1: y1 }
  }

  const chunk = []
  for (let i = missing.length - 1; i >= 0; i -= 1) {
    const [ix, iy] = missing[i]
    if (ix >= rect.ix0 && ix <= rect.ix1 && iy >= rect.iy0 && iy <= rect.iy1) chunk.unshift(...missing.splice(i, 1))
  }
  return { chunk, rect }
}

// --- miroirs ------------------------------------------------------------------

// Mémoire de l'état des miroirs, le temps de la session. Un miroir en panne le
// reste en général plusieurs heures : le retenter en premier à chaque requête
// coûtait quinze secondes d'attente à chaque fois.
const DEMOTE_MS = 10 * 60_000
const demotedUntil = new Map()

export function mirrorOrder(now = Date.now()) {
  const healthy = MIRRORS.filter((url) => !(demotedUntil.get(url) > now))
  const demoted = MIRRORS.filter((url) => demotedUntil.get(url) > now)
  return [...healthy, ...demoted]
}

const demote = (url) => demotedUntil.set(url, Date.now() + DEMOTE_MS)
const restore = (url) => demotedUntil.delete(url)
export const resetMirrorHealth = () => demotedUntil.clear()

async function queryMirrors(body, fetchImpl) {
  let empty = null
  for (let attempt = 0; attempt < ROUNDS; attempt += 1) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1) + Math.random() * 1000)
    const answer = await hedgedRound(mirrorOrder(), body, fetchImpl)
    if (answer !== null) {
      if (answer.payload.elements.length) return answer
      empty = answer
    }
  }
  return empty
}

/**
 * Un tour : les miroirs démarrent l'un après l'autre, sans attendre au-delà de
 * `HEDGE_DELAY_MS` celui qui tarde — voir `_hedged_round` en Python.
 *
 * Une précision tirée de la mesure : **une surcharge n'est pas une panne.**
 * Mesuré sur l'instance principale, une même requête rendait « 504 » au bout de
 * neuf secondes, puis passait en 0,3 s au tour suivant. Basculer aussitôt sur
 * les miroirs de secours — plus lents, et souvent tombés — faisait attendre
 * deux minutes. Une erreur de surcharge (429, 502, 503, 504) vaut donc un nouvel
 * essai rapide sur le même miroir, une fois, avant de le rétrograder.
 */
export async function hedgedRound(mirrors, body, fetchImpl, hedgeDelayMs = HEDGE_DELAY_MS, retryDelayMs = RETRY_DELAY_MS) {
  const waiting = [...mirrors]
  const inFlight = new Set()
  const emptyFrom = []
  let empty = null

  const launch = (url, { delayMs = 0, retries = 0 } = {}) => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const task = sleep(delayMs)
      .then(() => ask(url, body, controller, fetchImpl))
      .then(
        (answer) => ({ task, url, answer }),
        (error) => ({ task, url, error }),
      )
    Object.assign(task, { controller, url, startedAt, retries })
    inFlight.add(task)
  }

  try {
    while (waiting.length || inFlight.size) {
      // Rien en cours : le miroir suivant part tout de suite, sans délai.
      if (!inFlight.size) launch(waiting.shift())

      const outcome = await Promise.race([
        ...inFlight,
        ...(waiting.length ? [sleep(hedgeDelayMs).then(() => 'hedge')] : []),
      ])
      if (outcome === 'hedge') {
        launch(waiting.shift())
        continue
      }

      inFlight.delete(outcome.task)
      if (outcome.error) {
        if (outcome.error.transient && outcome.task.retries < MAX_RETRIES) {
          // Une limite de débit (429) annonce elle-même quand un créneau se
          // libère : on attend ce temps-là, ni plus ni moins, plutôt qu'un délai
          // fixe qui retomberait sur le même refus.
          const delayMs =
            outcome.error.status === 429 ? await slotDelayMs(outcome.url, fetchImpl, retryDelayMs) : retryDelayMs
          launch(outcome.url, { delayMs, retries: outcome.task.retries + 1 })
        } else {
          demote(outcome.url)
        }
        continue
      }
      if (outcome.answer.payload.elements.length) {
        restore(outcome.url)
        // Un miroir qui a rendu du vide là où un autre a trouvé des rues ne
        // couvre pas la zone (osm.ch hors de Suisse) ou a abandonné en route.
        for (const url of emptyFrom) demote(url)
        return outcome.answer
      }
      emptyFrom.push(outcome.url)
      empty = outcome.answer
    }
  } finally {
    for (const task of inFlight) {
      // Encore en vol au-delà du délai de chevauchement : lent au point d'avoir
      // été doublé. Il passe après les autres pour la suite de la session.
      if (Date.now() - task.startedAt >= hedgeDelayMs) demote(task.url)
      task.controller.abort()
    }
  }
  return empty
}

/** Les réponses d'un serveur surchargé, qui passent souvent au second essai. */
const TRANSIENT = new Set([429, 502, 503, 504])

/**
 * Temps d'attente avant qu'un créneau se libère, lu sur la page d'état du miroir.
 *
 * Overpass accorde deux créneaux par adresse, et garde chaque créneau occupé un
 * moment après une requête. Une première recherche en enchaîne deux ou trois :
 * la dernière peut tomber sur ce délai. La page `/api/status` dit combien de
 * créneaux sont libres, et sinon dans combien de secondes le prochain le sera.
 */
export async function slotDelayMs(url, fetchImpl, fallbackMs = RETRY_DELAY_MS) {
  try {
    const response = await fetchImpl(url.replace(/\/interpreter$/, '/status'))
    const text = await response.text()
    const free = text.match(/(\d+) slots? available now/)
    if (free && Number(free[1]) > 0) return 0
    const waits = [...text.matchAll(/in (\d+) seconds?/g)].map((m) => Number(m[1]))
    if (!waits.length) return fallbackMs
    return Math.min(MAX_SLOT_WAIT_S, Math.min(...waits)) * 1000 + 500
  } catch {
    return fallbackMs
  }
}

async function ask(url, body, controller, fetchImpl) {
  const timeout = setTimeout(() => controller.abort(), (QUERY_TIMEOUT_S + 15) * 1000)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      body: new URLSearchParams({ data: body }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), {
        status: response.status,
        transient: TRANSIENT.has(response.status),
      })
    }
    const text = await response.text()
    const payload = JSON.parse(text)
    if (!Array.isArray(payload.elements)) throw new OverpassError(`réponse de ${url} sans champ 'elements'`)
    return { payload, bytes: text.length }
  } finally {
    clearTimeout(timeout)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Oublie les tuiles gardées — appelé par l'effacement des données. */
export const clearTiles = () => tiles.clear()
