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
import { regionTile } from './region'
import { remoteTiles } from './remote'
import { store } from './store'

export const TILE_DEG = 0.05
const TTL_MS = 14 * 86_400_000

// Passé quatorze jours, une tuile n'est plus « fraîche » — mais elle reste
// bonne à servir pendant trois mois. Les rues d'un quartier changent rarement
// en quelques semaines, et faire attendre vingt secondes de téléchargement
// pour vérifier qu'elles n'ont pas bougé, c'était le prix de chaque retour
// dans un coin après deux semaines. On sert donc la copie tout de suite, et on
// la rafraîchit après coup, en fond, pour la fois suivante.
const USABLE_MS = 90 * 86_400_000
const REFRESH_DELAY_MS = 3000
// Les pays préparés en ligne le sont chaque mois : leurs tuiles restent
// fraîches jusqu'à la préparation suivante, plutôt que d'être redemandées à
// Overpass au bout de deux semaines.
const PACK_TTL_MS = 40 * 86_400_000

// La progression d'une requête, en deux temps. D'abord le serveur prépare les
// rues : rien n'arrive, parfois vingt secondes. Cette attente avance à l'œil,
// vite puis de moins en moins, sans jamais dépasser `WAIT_SHARE` — elle ne
// promet rien qu'elle ne sache. Puis les octets arrivent, et la barre suit leur
// compte, rapporté au poids attendu. Une barre qui sautait de 17 % à 100 % après
// une minute immobile se lisait comme une app plantée.
const WAIT_SHARE = 0.4
const WAIT_TAU_MS = 9000
const PROGRESS_TICK_MS = 400
// Pendant la réception, la barre suit les octets — mais le poids attendu n'est
// qu'une estimation. Si elle est trop haute, les octets seuls laisseraient la
// barre traîner puis sauter à la fin : une avance lente, au temps, garantit
// qu'elle bouge toujours.
const CREEP_TAU_MS = 25_000
// Poids d'une tuile tant qu'on n'en a mesuré aucune — une petite ville ; Paris
// pèse vingt fois plus, la campagne dix fois moins. Il ne sert qu'à la barre, et
// il s'affine à chaque téléchargement (`learnTileBytes`).
const GUESS_TILE_BYTES = 600_000
const CHUNK_BYTES = 40_000_000
const MAX_CHUNK_TILES = 64
// Délai avant de lancer un miroir de secours sur la même requête. Il grandit
// avec la taille du lot, et c'est la mesure qui l'impose : une tuile de Paris
// met une bonne minute à arriver, et doubler la requête au bout de huit
// secondes téléchargeait deux fois quinze mégaoctets — sur des serveurs publics,
// et sur le forfait de quelqu'un. Une petite zone, elle, doit basculer vite.
const HEDGE_DELAY_MS = 8_000
const HEDGE_PER_TILE_MS = 4_000
const MAX_HEDGE_DELAY_MS = 30_000

const hedgeDelayFor = (tiles) =>
  Math.min(MAX_HEDGE_DELAY_MS, HEDGE_DELAY_MS + HEDGE_PER_TILE_MS * Math.max(0, tiles - 1))
const RETRY_DELAY_MS = 1_500
const MAX_RETRIES = 2
const MAX_SLOT_WAIT_S = 60
// Quarante-cinq secondes, et non quatre-vingt-dix : passé ce délai, la requête
// ne va pas aboutir, et sur un téléphone c'est une barre de progression figée
// avec quelqu'un qui attend en bas de chez lui, chaussures aux pieds. Les
// miroirs de secours partent bien avant, au bout de huit secondes.
const QUERY_TIMEOUT_S = 45
const ROUNDS = 2

// Au moins deux miroirs doivent décrire la même zone comme vide avant qu'on le
// croie. Un seul ne suffit pas, et ce n'est pas de la prudence de principe :
// `overpass.osm.ch` ne contient que la Suisse et répondait « HTTP 200, aucune
// rue » en deux dixièmes de seconde pour l'Alsace. L'app le prenait pour une
// réponse valable et affichait « aucune voie praticable » en plein village.
const EMPTY_CONFIRMATIONS = 2

// Ordre de préférence, l'instance principale d'abord. **Que des instances
// mondiales** : un extrait régional répond vite et faux hors de sa région, ce
// qui est pire qu'une panne — mesuré le 17 septembre 2026 avec osm.ch, retiré
// depuis.
export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
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

/**
 * Un extrait d'un niveau de détail donné, tiré d'un niveau plus fin.
 *
 * Chaque niveau ne fait qu'**ajouter** des types de voies à la liste exclue :
 * les rues du niveau 0 contiennent donc toutes celles du niveau 1, et il suffit
 * d'en retirer les voies de service pour l'obtenir. Passer de 21 à 30 km
 * franchissait le seuil des 25 km et retéléchargeait toute la zone, alors que
 * tout était déjà sur l'appareil.
 */
export function deriveLevel(extract, level) {
  const extra = DETAIL_LEVELS[level][1]
  if (!extra) return extract
  const drop = new Set(extra.split('|'))
  return { ...extract, ways: extract.ways.filter((way) => !drop.has(way.tags.highway)) }
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
export async function fetchArea(args) {
  const {
    lat,
    lon,
    radiusM,
    targetM,
    onProgress = () => {},
    fetchImpl = fetch,
    now = Date.now,
    // Pour le rafraîchissement en fond : des tuiles précises, et aucune copie
    // considérée comme assez récente.
    tiles: only = null,
    freshMs = TTL_MS,
    usableMs = USABLE_MS,
    schedule = (task) => setTimeout(task, REFRESH_DELAY_MS),
    chunkBytes = CHUNK_BYTES,
    // La carte régionale livrée avec l'app (`region.js`). Jamais pour un
    // rafraîchissement : on veut alors les données du jour, pas celles livrées.
    useRegion = true,
    regionFetch = fetch,
    remoteFetch = fetch,
    tilesUrl = undefined,
    tileBytesGuess = null,
  } = args
  const level = detailLevel(targetM)
  const wanted = only ?? tilesFor(lat, lon, radiusM)
  const obtained = new Map()
  const stale = new Map()
  const aged = []
  const missing = []

  // Ce qu'on a déjà : sur l'appareil, à ce niveau ou à un niveau plus fin ; puis,
  // pour ce qui n'y est pas frais, dans la carte régionale — la plus récente des
  // deux copies l'emporte.
  const found = new Map()
  for (const tile of wanted) found.set(tile, await cachedTile(level, tile))
  // Une copie préparée d'un pays reste fraîche jusqu'à la préparation suivante ;
  // un rafraîchissement, lui, veut toujours les données du jour.
  const freshFor = (copy) => (only ? freshMs : Math.max(freshMs, copy?.ttl ?? 0))
  const isFresh = (copy) => Boolean(copy) && now() - copy.at < freshFor(copy)

  if (useRegion) {
    const unfresh = wanted.filter((tile) => !isFresh(found.get(tile)))
    const shipped = await Promise.all(unfresh.map(([ix, iy]) => regionTile(ix, iy, regionFetch)))
    unfresh.forEach((tile, k) => {
      const copy = shipped[k]
      if (copy && !(found.get(tile)?.at >= copy.at)) {
        found.set(tile, { at: copy.at, extract: deriveLevel(copy.extract, level) })
      }
    })

    // Puis les pays préparés en ligne, pour ce qui n'est toujours pas frais :
    // quelques requêtes à un hébergement de fichiers, au lieu d'Overpass.
    const still = wanted.filter((tile) => !isFresh(found.get(tile)))
    if (still.length) {
      let ready = wanted.length - still.length
      const online = await remoteTiles(still, {
        fetchImpl: remoteFetch,
        ...(tilesUrl !== undefined ? { base: tilesUrl } : {}),
        onTile: () => {
          ready += 1
          onProgress(Math.min(0.99, ready / wanted.length))
        },
      })
      for (const tile of still) {
        const copy = online.get(`${tile[0]}_${tile[1]}`)
        if (!copy || found.get(tile)?.at >= copy.at) continue
        // Gardée sur l'appareil, au niveau le plus fin : les recherches suivantes
        // — une autre distance, un autre jour — la trouvent sans réseau.
        await tiles.set(tileKey(0, tile), { at: copy.at, extract: copy.extract, ttl: PACK_TTL_MS })
        found.set(tile, { at: copy.at, extract: deriveLevel(copy.extract, level), ttl: PACK_TTL_MS })
      }
    }
  }

  for (const tile of wanted) {
    const key = tileKey(level, tile)
    const cached = found.get(tile)
    const age = cached ? now() - cached.at : Infinity
    if (age < freshFor(cached)) {
      obtained.set(key, cached.extract)
    } else if (age < usableMs) {
      obtained.set(key, cached.extract)
      aged.push(tile)
    } else {
      missing.push(tile)
      if (cached) stale.set(key, cached.extract)
    }
  }
  // Les requêtes en cours, et où elles en sont : voir `WAIT_SHARE`.
  const inflight = new Set()
  let shown = 0
  const report = () => {
    let done = obtained.size
    for (const job of inflight) done += job.tiles * jobFraction(job)
    // Jamais en arrière — une requête qui échoue et repart en deux ne doit pas
    // faire reculer la barre — et 100 % seulement quand tout est là.
    const fraction = obtained.size === wanted.length ? 1 : Math.min(0.99, done / wanted.length)
    shown = Math.max(shown, fraction)
    onProgress(shown)
  }
  // Au fil des octets, sans inonder l'écran : une réponse arrive en centaines de
  // morceaux, et dix mises à jour par seconde suffisent à l'œil.
  let lastReport = 0
  const reportSoon = () => {
    const t = Date.now()
    if (t - lastReport < 100) return
    lastReport = t
    report()
  }
  report()
  refreshLater(args, level, aged, schedule)
  // La tuile du départ d'abord : c'est elle qui mesure la densité de la zone.
  const home = [Math.floor(lon / TILE_DEG), Math.floor(lat / TILE_DEG)]
  missing.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))
  const homeIndex = missing.findIndex(([ix, iy]) => ix === home[0] && iy === home[1])
  if (homeIndex > 0) missing.unshift(...missing.splice(homeIndex, 1))

  let bytesPerTile = null
  let cap = Infinity
  let silent = false
  const ticker = missing.length ? setInterval(report, PROGRESS_TICK_MS) : null
  try {
    while (missing.length) {
      const budget = Math.min(cap, firstBudget(bytesPerTile, missing.length, level, chunkBytes))
      const batch = [takeChunk(missing, budget)]
      // Overpass accorde deux requêtes simultanées par adresse. Une fois la densité
      // de la zone mesurée, deux lots partent donc ensemble : dans une grande
      // ville, découpée en plusieurs lots, c'est l'attente divisée par deux. Avant
      // la mesure, on ne sait pas ce que pèse un lot, et on n'en risque qu'un.
      if (bytesPerTile !== null && !silent && missing.length) batch.push(takeChunk(missing, budget))

      // Quand un lot entier est resté sans réponse, les suivants le resteraient :
      // réseau coupé, ou tous les miroirs tombés. Relancer deux tours de tentatives
      // pour chaque tuile faisait attendre des dizaines de secondes pour rien.
      const answers = await Promise.all(
        batch.map(async ({ chunk, rect }) => {
          if (silent) return null
          const job = {
            tiles: chunk.length,
            startedAt: Date.now(),
            received: 0,
            expected: (bytesPerTile ?? tileBytesGuess ?? (await learnedTileBytes(level))) * rectSize(rect),
          }
          inflight.add(job)
          try {
            return await queryMirrors(query(level, rectBbox(rect)), fetchImpl, hedgeDelayFor(rectSize(rect)), (bytes) => {
              if (!job.firstByteAt) {
                job.firstByteAt = Date.now()
                job.base = waitFraction(job.firstByteAt - job.startedAt)
              }
              job.received = Math.max(job.received, bytes)
              reportSoon()
            })
          } finally {
            inflight.delete(job)
          }
        }),
      )

      let refused = false
      for (let b = 0; b < batch.length; b += 1) {
        const { chunk, rect } = batch[b]
        const answer = answers[b]

        // Mais un lot refusé n'est pas forcément un réseau coupé : une requête
        // large est aussi ce qu'un miroir déjà chargé abandonne en premier, et la
        // même zone passe en deux morceaux. On repose donc les tuiles et on réduit
        // de moitié avant de conclure. Une tuile seule qui échoue, elle, est un
        // vrai échec.
        if (answer === null && chunk.length > 1) {
          missing.unshift(...chunk)
          cap = Math.max(1, Math.floor(chunk.length / 2))
          refused = true
          continue
        }

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
        learnTileBytes(level, bytesPerTile)
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
      if (!refused) cap = Infinity
    }
  } finally {
    if (ticker) clearInterval(ticker)
  }
  report()

  return mergeExtracts(wanted.map((tile) => obtained.get(tileKey(level, tile)) ?? emptyExtract()))
}

const waitFraction = (elapsedMs) => WAIT_SHARE * (1 - Math.exp(-elapsedMs / WAIT_TAU_MS))

/** Où en est une requête : l'attente du serveur, puis les octets reçus. */
function jobFraction(job) {
  const elapsed = Date.now() - job.startedAt
  if (!job.firstByteAt) return waitFraction(elapsed)
  // Plus d'octets qu'attendu : l'estimation était basse, on la relève pour que
  // la barre continue d'avancer au lieu de se figer à 97 %.
  if (job.received > job.expected * 0.9) job.expected = job.received / 0.8
  const byBytes = job.base + (1 - job.base) * Math.min(0.97, job.received / Math.max(job.expected, 1))
  const byTime = 0.95 * (1 - Math.exp(-elapsed / CREEP_TAU_MS))
  return Math.max(byBytes, byTime)
}

// Le poids moyen d'une tuile, par niveau de détail, appris au fil des
// téléchargements et gardé d'une session à l'autre.
const learned = new Map()

async function learnedTileBytes(level) {
  if (!learned.has(level)) learned.set(level, (await tiles.get(`meta:tileBytes:${level}`)) ?? GUESS_TILE_BYTES)
  return learned.get(level)
}

function learnTileBytes(level, bytes) {
  const previous = learned.get(level) ?? GUESS_TILE_BYTES
  const next = Math.round(previous * 0.6 + bytes * 0.4)
  learned.set(level, next)
  tiles.set(`meta:tileBytes:${level}`, next)
}

/**
 * La meilleure copie gardée d'une tuile : à ce niveau de détail, ou à un niveau
 * plus fin dont on retire le superflu — la plus récente l'emporte.
 */
async function cachedTile(level, tile) {
  let best = null
  for (let l = level; l >= 0; l -= 1) {
    const copy = await tiles.get(tileKey(l, tile))
    if (copy && !(best?.at >= copy.at)) {
      best = { at: copy.at, ttl: copy.ttl, extract: l === level ? copy.extract : deriveLevel(copy.extract, level) }
    }
  }
  return best
}

// Les tuiles dont un rafraîchissement est déjà prévu ou en cours : deux
// recherches coup sur coup au même endroit ne doivent pas les demander deux fois.
const refreshing = new Set()

/**
 * Rafraîchit, un peu plus tard et en fond, les tuiles vieillies qu'on vient de
 * servir. Le délai laisse passer la fin de la recherche en cours — l'altitude,
 * le vent — avant d'occuper le réseau. Un échec ne dit rien à personne : la
 * copie gardée reste en place, et on réessaiera à la prochaine recherche.
 */
function refreshLater(args, level, aged, schedule) {
  const todo = aged.filter((tile) => !refreshing.has(tileKey(level, tile)))
  if (!todo.length) return
  for (const tile of todo) refreshing.add(tileKey(level, tile))
  schedule(() => {
    fetchArea({ ...args, tiles: todo, freshMs: 0, usableMs: 0, useRegion: false, onProgress: () => {} })
      .catch(() => {})
      .finally(() => {
        for (const tile of todo) refreshing.delete(tileKey(level, tile))
      })
  })
}

// Combien de tuiles demander tant qu'on n'a pas mesuré la densité de la zone.
//
// La tuile du départ part seule pour servir d'étalon — indispensable avant de
// demander seize tuiles de Paris. Mais une petite zone tient largement dans une
// requête, et la découper en deux payait deux fois le coût fixe d'Overpass,
// mesuré entre 2 et 13 secondes : pour une sortie de 6 km, c'est la moitié de
// l'attente. Le plafond reste bas et ne vaut que pour les niveaux de détail des
// courtes distances, les seuls où six tuiles pèsent à coup sûr peu.
const ONE_SHOT_TILES = 6

function firstBudget(bytesPerTile, remaining, level, chunkBytes = CHUNK_BYTES) {
  if (bytesPerTile === null) return remaining <= ONE_SHOT_TILES && level <= 1 ? remaining : 1
  return Math.max(1, Math.min(MAX_CHUNK_TILES, Math.floor(chunkBytes / Math.max(bytesPerTile, 1))))
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
  const holes = rectSize(bounds) - missing.length
  let rect
  if (rectSize(bounds) <= budget && holes <= Math.max(1, Math.floor(missing.length / 4))) {
    rect = bounds
  } else {
    // Sinon, un rectangle **sans trou**, étiré vers la droite puis vers le bas
    // tant que tout y manque. Le cas qui l'impose : augmenter la distance. Le
    // centre est déjà sur l'appareil, seule la couronne manque, et le rectangle
    // qui l'englobe retéléchargeait tout le centre — la moitié du poids, pour
    // rien. Quatre bandes autour coûtent moins qu'un bloc qui recouvre tout.
    const has = new Set(missing.map(([ix, iy]) => `${ix}:${iy}`))
    const [x0, y0] = missing[0]
    let x1 = x0
    while (x1 - x0 + 1 < budget && has.has(`${x1 + 1}:${y0}`)) x1 += 1
    const width = x1 - x0 + 1
    const rowFull = (y) => {
      for (let x = x0; x <= x1; x += 1) if (!has.has(`${x}:${y}`)) return false
      return true
    }
    let y1 = y0
    while ((y1 - y0 + 2) * width <= budget && rowFull(y1 + 1)) y1 += 1
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

async function queryMirrors(body, fetchImpl, hedgeDelayMs = HEDGE_DELAY_MS, onBytes = null) {
  let empty = null
  for (let attempt = 0; attempt < ROUNDS; attempt += 1) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1) + Math.random() * 1000)
    const answer = await hedgedRound(mirrorOrder(), body, fetchImpl, hedgeDelayMs, RETRY_DELAY_MS, onBytes)
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
export async function hedgedRound(
  mirrors,
  body,
  fetchImpl,
  hedgeDelayMs = HEDGE_DELAY_MS,
  retryDelayMs = RETRY_DELAY_MS,
  onBytes = null,
) {
  const waiting = [...mirrors]
  const inFlight = new Set()
  const emptyFrom = []
  let empty = null

  const launch = (url, { delayMs = 0, retries = 0 } = {}) => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const task = sleep(delayMs)
      .then(() => ask(url, body, controller, fetchImpl, onBytes))
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
        // couvre pas la zone, ou a abandonné en route.
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
  // Un seul « la zone est vide » ne fait pas une zone vide : sans confirmation,
  // on rend un échec, que l'appelant traduira par une copie gardée ou par un
  // message honnête — plutôt que par « aucune voie praticable », qui accuse
  // l'endroit alors que ce sont les serveurs qui ont failli.
  return emptyFrom.length >= EMPTY_CONFIRMATIONS ? empty : null
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

async function ask(url, body, controller, fetchImpl, onBytes = null) {
  const timeout = setTimeout(() => controller.abort(), (QUERY_TIMEOUT_S + 10) * 1000)
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
    const text = await readText(response, onBytes)
    const payload = JSON.parse(text)
    if (!Array.isArray(payload.elements)) throw new OverpassError(`réponse de ${url} sans champ 'elements'`)
    return { payload, bytes: text.length }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Le corps d'une réponse, lu morceau par morceau quand c'est possible, pour
 * que la barre suive les octets au fil de leur arrivée.
 */
async function readText(response, onBytes) {
  const reader = onBytes && response.body?.getReader?.()
  if (!reader) return response.text()
  const decoder = new TextDecoder()
  const parts = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    parts.push(decoder.decode(value, { stream: true }))
    onBytes(received)
  }
  parts.push(decoder.decode())
  return parts.join('')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Oublie les tuiles gardées — appelé par l'effacement des données. */
export const clearTiles = () => {
  refreshing.clear()
  return tiles.clear()
}
