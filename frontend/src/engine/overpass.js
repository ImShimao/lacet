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

import { clipToDisk, emptyExtract, fromOverpass, mergeExtracts } from './extract'
import { bboxAround } from './geo'
import { pyFixed } from './py'
import { fetchArchived, resetArchives } from './archive'
import { regionTile } from './region'
import { store } from './store'
import { clearTiles as forgetTiles, readTile, touchTiles, writeTile } from './tilestore'

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
// Le cœur du disque : ce dont une recherche a vraiment besoin. Le rayon est
// calculé pour la plus longue boucle acceptée, et les tuiles du bord ne servent
// qu'aux rares boucles qui vont l'effleurer.
const CORE_SHARE = 0.6
// Âge à partir duquel une copie déjà sur l'appareil vaut la peine d'être
// comparée aux archives. Les archives sont refaites tous les mois : en deçà, la
// copie locale est au moins aussi bonne, et l'aller-retour ne rapporterait
// qu'une seconde d'attente — y compris chez soi, où la carte livrée suffit.
const ARCHIVE_AFTER_MS = 30 * 86_400_000

// Ce qu'on accorde à Overpass pour ces tuiles de bordure avant de chercher sans
// elles. Mesuré chez quelqu'un à deux kilomètres de la limite de l'Alsace : deux
// des six tuiles d'une recherche de 5 km manquaient à la carte livrée, et la
// barre restait à 80 % le temps qu'Overpass réponde — une minute, ou jamais.
// Quatre tuiles suffisaient pourtant à tracer la boucle.
const PERIPHERAL_WAIT_MS = 6_000
// **Le temps qu'on s'autorise à attendre les rues, en tout.**
//
// Sans plafond, le pire cas s'additionne : quatre miroirs relancés l'un après
// l'autre, deux tours, une file d'attente d'une minute sur chacun, et tout ça
// autant de fois qu'il y a de lots à demander. Constaté sur un téléphone :
// vingt minutes devant l'écran de chargement. Une attente pareille ne se
// rattrape pas — quelqu'un en tenue a déjà refermé l'app.
//
// Passé `DATA_BUDGET_MS`, on cherche donc avec ce qui est arrivé, pourvu que la
// tuile du départ en fasse partie et qu'il y ait de quoi tracer. Passé
// `DATA_HARD_MS`, on s'en contente quoi qu'il arrive, et s'il n'y a rien, on le
// dit. Ce qui continue d'arriver est rangé pour la recherche suivante.
const DATA_BUDGET_MS = 40_000
const DATA_HARD_MS = 90_000
// En dessous de cette part de la zone, chercher n'aurait pas de sens : mieux
// vaut attendre encore un peu.
const ENOUGH_SHARE = 0.34
// Au-delà de ce poids attendu, la zone part en deux temps : le cœur, puis le
// bord. En dessous — une petite ville, un village —, tout tient dans une requête
// dont le coût est surtout fixe, et la couper en deux ferait payer ce coût deux
// fois pour gagner une seconde.
const SPLIT_BYTES = 8_000_000

const RETRY_DELAY_MS = 1_500
const MAX_RETRIES = 2
// Un créneau annoncé au-delà de vingt secondes ne vaut plus la peine : c'est la
// moitié du temps qu'on s'accorde pour toute la zone, et un autre miroir répond
// souvent plus vite que celui qui fait patienter.
const MAX_SLOT_WAIT_S = 20
// Trente secondes, et non quatre-vingt-dix : passé ce délai, la requête ne va
// pas aboutir, et sur un téléphone c'est une barre figée avec quelqu'un qui
// attend en bas de chez lui, chaussures aux pieds. Et un serveur Overpass
// chargé fait passer d'abord les requêtes qui annoncent peu de temps : un délai
// court, c'est aussi une place plus tôt dans sa file.
const QUERY_TIMEOUT_S = 30
const ROUNDS = 2

// Au moins deux miroirs doivent décrire la même zone comme vide avant qu'on le
// croie. Un seul ne suffit pas, et ce n'est pas de la prudence de principe :
// `overpass.osm.ch` ne contient que la Suisse et répondait « HTTP 200, aucune
// rue » en deux dixièmes de seconde pour l'Alsace. L'app le prenait pour une
// réponse valable et affichait « aucune voie praticable » en plein village.
const EMPTY_CONFIRMATIONS = 2

// Ordre de préférence. **Que des instances mondiales** : un extrait régional
// répond vite et faux hors de sa région, ce qui est pire qu'une panne — mesuré
// le 17 septembre 2026 avec osm.ch, retiré depuis.
//
// Les deux premières font la course dès la première seconde (`RACE_WIDTH`).
// Mesuré le 19 septembre 2026, sur des tuiles de France, de Suisse, d'Italie,
// d'Espagne et d'Allemagne : l'instance principale répondait en 1,6 s… ou en
// « 504 » au bout de 14 s, ou « 429 » faute de créneau, selon la minute ; celle
// d'OpenStreetMap France, mondiale elle aussi et aux données identiques, en 1,5
// à 5,4 s à chaque fois.
//
// Kumi et private.coffee, les anciens secours, ont été retirés : « 500 » à
// toute requête le 10 octobre 2026, plus aucune réponse en trente secondes le
// 12. Gardés en dernier recours, ils ne faisaient qu'allonger l'attente quand
// les deux autres saturaient.
export const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter']

// Combien de miroirs partent ensemble sur chaque lot. Le premier qui répond
// l'emporte, l'autre est annulé : on paie une requête de plus pour ne plus
// jamais attendre qu'un serveur surchargé se décide.
const RACE_WIDTH = 2

const EXCLUDED_HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape'
const BUILTUP_LANDUSE = 'residential|retail|commercial|industrial|education'
const EXCLUDED_SERVICE = 'parking_aisle|driveway|drive-through|slipway'
// Les barrières qu'un vélo ne franchit pas — voir `closedBarrier` (`safety.js`).
const NO_BIKE_BARRIERS = 'stile|turnstile|full-height_turnstile|kissing_gate'

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
  node["barrier"]["locked"="yes"](${bbox});
  node["barrier"]["access"~"^(no|private)$"](${bbox});
  node["barrier"]["foot"~"^(no|private)$"](${bbox});
  node["barrier"]["bicycle"~"^(no|private)$"](${bbox});
  node["barrier"~"^(${NO_BIKE_BARRIERS})$"](${bbox});
);
out body;
(
  way["leisure"="park"](${bbox});
  way["landuse"="forest"](${bbox});
  way["natural"~"^(wood|water)$"](${bbox});
  way["waterway"~"^(river|canal)$"](${bbox});
  rel["type"="multipolygon"]["leisure"="park"](${bbox});
  rel["type"="multipolygon"]["landuse"="forest"](${bbox});
  rel["type"="multipolygon"]["natural"~"^(wood|water)$"](${bbox});
);
out geom;
(
  rel["route"~"^(hiking|foot|running)$"](${bbox});
);
out body;`
}

// --- tuiles -------------------------------------------------------------------

/**
 * Tuiles (ix, iy) couvrant le disque de rayon `radiusM`, rangées ligne par ligne.
 *
 * Seules celles qui touchent le **disque**, pas tout le carré qui l'entoure : les
 * tuiles des coins, hors d'atteinte, se téléchargeaient pour rien — jusqu'à un
 * quart du poids en ville, où une seule tuile pèse une dizaine de mégaoctets.
 */
export function tilesFor(lat, lon, radiusM) {
  const [s, w, n, e] = bboxAround(lat, lon, radiusM)
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  const out = []
  for (let iy = Math.floor(s / TILE_DEG); iy <= Math.floor(n / TILE_DEG); iy += 1) {
    for (let ix = Math.floor(w / TILE_DEG); ix <= Math.floor(e / TILE_DEG); ix += 1) {
      // Le point de la tuile le plus proche du centre, et sa distance.
      const nearLon = Math.min(Math.max(lon, ix * TILE_DEG), (ix + 1) * TILE_DEG)
      const nearLat = Math.min(Math.max(lat, iy * TILE_DEG), (iy + 1) * TILE_DEG)
      if (Math.hypot((nearLon - lon) * kx, (nearLat - lat) * ky) <= radiusM) out.push([ix, iy])
    }
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

  // Une voie de sentier balisé le reste dans chaque tuile où elle va.
  const marked = new Set(extract.marked ?? [])
  for (const way of extract.ways) {
    place(way.flat, (part) => {
      part.ways.push(way)
      if (marked.has(way.id)) part.marked.push(way.id)
    })
  }
  for (const area of extract.landuse) place(area.flat, (part) => part.landuse.push(area))
  // Une forêt entière dans chaque tuile qu'elle touche : son intérieur ne se
  // peint qu'avec tout son contour (`green.js`).
  for (const area of extract.green ?? []) {
    let all = area.rings[0]
    if (area.rings.length > 1) {
      all = new Float64Array(area.rings.reduce((sum, r) => sum + r.length, 0))
      let at = 0
      for (const r of area.rings) {
        all.set(r, at)
        at += r.length
      }
    }
    place(all, (part) => part.green.push(area))
  }
  for (const c of extract.crossings) {
    place(Float64Array.of(c.lon, c.lat), (part) => part.crossings.push(c))
  }
  for (const b of extract.barriers ?? []) {
    place(Float64Array.of(b.lon, b.lat), (part) => part.barriers.push(b))
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
 * Les rues à portée du départ. `onProgress(fraction)` suit les tuiles obtenues.
 *
 * Les tuiles sont demandées et gardées **entières** — elles resserviront au
 * départ d'à côté — mais ce qui est rendu est ramené au disque de rayon
 * `radiusM` : le débord des tuiles fait plus de la moitié de la surface, et il
 * n'a rien à faire dans le graphe (`clipToDisk`).
 */
export async function fetchArea(args) {
  const {
    lat,
    lon,
    radiusM,
    targetM,
    onProgress = () => {},
    // Appelé quand il faut passer par le réseau — archives ou Overpass. Sans
    // lui, l'écran annonçait un téléchargement même chez soi, en Alsace, où
    // toutes les rues sont livrées avec l'app.
    onDownload = () => {},
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
    // Les archives en ligne (`archive.js`). Jamais pour un rafraîchissement, qui
    // veut les données du jour, ni quand l'appelant les a déjà écartées.
    useArchive = true,
    archiveFetch = fetch,
    tileBytesGuess = null,
    peripheralWaitMs = PERIPHERAL_WAIT_MS,
    dataBudgetMs = DATA_BUDGET_MS,
    hardBudgetMs = DATA_HARD_MS,
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
  // En parallèle : seize tuiles lues l'une après l'autre, c'est seize
  // transactions IndexedDB à la file, et sur un téléphone chacune coûte le
  // décodage d'un extrait de plusieurs mégaoctets.
  const found = new Map()
  // D'où vient chaque tuile. Ça ne change rien au calcul, mais « c'est lent »
  // n'a pas le même sens selon que les rues viennent de l'appareil, de la carte
  // livrée, des archives ou d'Overpass — et c'est la première question à se
  // poser quand quelqu'un le signale, téléphone en main.
  const origins = new Map()
  const copies = await Promise.all(wanted.map((tile) => cachedTile(level, tile)))
  wanted.forEach((tile, k) => {
    found.set(tile, copies[k])
    if (copies[k]) origins.set(tile, 'appareil')
  })
  const isFresh = (copy) => Boolean(copy) && now() - copy.at < freshMs

  if (useRegion) {
    const unfresh = wanted.filter((tile) => !isFresh(found.get(tile)))
    const shipped = await Promise.all(unfresh.map(([ix, iy]) => regionTile(ix, iy, regionFetch)))
    unfresh.forEach((tile, k) => {
      const copy = shipped[k]
      if (copy && !(found.get(tile)?.at >= copy.at)) {
        found.set(tile, { at: copy.at, extract: deriveLevel(copy.extract, level), prepared: true })
        origins.set(tile, 'livrée')
      }
    })
  }

  const served = []
  // Puis les archives en ligne : le reste du pays, préparé d'avance et lu à
  // l'octet près. Ce qui n'y est pas — l'étranger, pour l'instant — reste à
  // Overpass, qui met dix fois plus de temps à le calculer.
  if (useArchive && !only) {
    const unfresh = wanted.filter((tile) => {
      const copy = found.get(tile)
      return !copy || now() - copy.at >= ARCHIVE_AFTER_MS
    })
    if (unfresh.length) {
      onDownload()
      const archived = await fetchArchived(unfresh, { fetchImpl: archiveFetch })
      const keep = []
      for (const tile of unfresh) {
        const copy = archived.get(`${tile[0]}:${tile[1]}`)
        // Une archive moins détaillée que ce qu'on demande ne ferait pas
        // l'affaire : elle promettrait des rues qu'elle ne contient pas.
        if (copy && copy.level <= level && !(found.get(tile)?.at >= copy.at)) {
          found.set(tile, { at: copy.at, extract: deriveLevel(copy.extract, level), prepared: true })
          origins.set(tile, 'archives')
          keep.push([tileKey(copy.level, tile), copy])
        }
      }
      // Gardées sur l'appareil, comme celles d'Overpass : c'est ce qui rend la
      // zone utilisable hors ligne, et la recherche suivante immédiate. Après
      // coup : encoder dix tuiles coûte deux dixièmes de seconde, et la
      // recherche n'a pas à les attendre.
      if (keep.length) {
        setTimeout(() => {
          for (const [key, copy] of keep) writeTile(key, copy.at, copy.extract, now()).catch(() => {})
        }, 0)
      }
    }
  }

  for (const tile of wanted) {
    const key = tileKey(level, tile)
    const cached = found.get(tile)
    const age = cached ? now() - cached.at : Infinity
    if (cached?.key) served.push(cached.key)
    if (age < freshMs) {
      obtained.set(key, cached.extract)
    } else if (age < usableMs) {
      obtained.set(key, cached.extract)
      // Une tuile venue d'une carte préparée — celle livrée avec l'app, ou les
      // archives en ligne — n'est pas rafraîchie chez Overpass : elle date du
      // dernier découpage, et c'est lui qui la remettra à jour. Sans cette
      // exception, chaque recherche relançait en fond ce qu'on cherchait
      // justement à ne plus demander.
      if (!cached.prepared) aged.push(tile)
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
  if (missing.length) onDownload()
  report()
  refreshLater(args, level, aged, schedule)
  // La tuile du départ d'abord : c'est elle qui mesure la densité de la zone.
  const home = [Math.floor(lon / TILE_DEG), Math.floor(lat / TILE_DEG)]
  missing.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))
  const homeIndex = missing.findIndex(([ix, iy]) => ix === home[0] && iy === home[1])
  if (homeIndex > 0) missing.unshift(...missing.splice(homeIndex, 1))

  // **Le cœur avant le bord, quand la zone est lourde.** Une boucle reste bien à
  // l'intérieur du rayon demandé, et les tuiles du bord ne servent qu'à celles
  // qui vont l'effleurer : les demander dans la même requête que le reste, en
  // ville, c'est faire attendre quinze secondes pour des rues dont on n'a pas
  // besoin. Le cœur arrive donc d'abord, la recherche part avec (voir `settle`),
  // et le bord continue pendant qu'on lit les propositions.
  const distanceTo = nearestTileDistance(lat, lon)
  const weight = tileBytesGuess ?? (await learnedTileBytes(level))
  const heavy = missing.length * weight > SPLIT_BYTES
  const phases =
    heavy
      ? [
          missing.filter((tile) => distanceTo(tile) < CORE_SHARE * radiusM),
          missing.filter((tile) => distanceTo(tile) >= CORE_SHARE * radiusM),
        ].filter((phase) => phase.length)
      : [missing].filter((phase) => phase.length)

  let bytesPerTile = null
  let cap = Infinity
  let silent = false
  // Les tuiles rangées sur l'appareil : lancées ensemble, attendues à la fin.
  // Attendre chaque écriture avant de découper la suivante ajoutait, sur un
  // téléphone, le temps de recopier quinze extraits avant de rendre la main.
  const written = []
  const ticker = phases.length ? setInterval(report, PROGRESS_TICK_MS) : null
  const download = (async () => {
    try {
      for (const queue of phases) {
        while (queue.length) {
          const budget = Math.min(cap, firstBudget(bytesPerTile, queue.length, level, chunkBytes, heavy))
          const batch = [takeChunk(queue, budget)]
          // Overpass accorde deux requêtes simultanées par adresse. Une fois la densité
          // de la zone mesurée, deux lots partent donc ensemble : dans une grande
          // ville, découpée en plusieurs lots, c'est l'attente divisée par deux. Avant
          // la mesure, on ne sait pas ce que pèse un lot, et on n'en risque qu'un.
          if (bytesPerTile !== null && !silent && queue.length) batch.push(takeChunk(queue, budget))

          // Quand un lot entier est resté sans réponse, les suivants le resteraient :
          // réseau coupé, ou tous les miroirs tombés. Relancer deux tours de tentatives
          // pour chaque tuile faisait attendre des dizaines de secondes pour rien.
          const answers = await Promise.all(
            batch.map(async ({ chunk, rect }, k) => {
              if (silent) return null
              const job = {
                tiles: chunk.length,
                startedAt: Date.now(),
                received: 0,
                expected: (bytesPerTile ?? tileBytesGuess ?? (await learnedTileBytes(level))) * rectSize(rect),
              }
              inflight.add(job)
              try {
                // Deux lots en vol : chacun part sur son serveur — `mirrorOrder`.
                return await queryMirrors(
                  query(level, rectBbox(rect)),
                  fetchImpl,
                  hedgeDelayFor(rectSize(rect)),
                  (bytes) => {
                    if (!job.firstByteAt) {
                      job.firstByteAt = Date.now()
                      job.base = waitFraction(job.firstByteAt - job.startedAt)
                    }
                    job.received = Math.max(job.received, bytes)
                    reportSoon()
                  },
                  k * RACE_WIDTH,
                )
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
              queue.unshift(...chunk)
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
              if (part.ways.length) written.push(writeTile(key, now(), part))
              const voulue = wanted.find(([wx, wy]) => wx === ix && wy === iy)
              if (voulue) {
                obtained.set(key, part)
                origins.set(voulue, 'Overpass')
              }
            }
            report()
          }
          if (!refused) cap = Infinity
        }
      }
    } finally {
      if (ticker) clearInterval(ticker)
    }
    await Promise.all(written)
  })()

  // Ce qui a servi ici ne sera pas jeté de sitôt : le budget du cache écarte
  // d'abord les tuiles dont on ne s'est pas servi depuis le plus longtemps.
  touchTiles(served, now()).catch(() => {})
  await settle(download, {
    wanted, obtained, level, lat, lon, radiusM, peripheralWaitMs, dataBudgetMs, hardBudgetMs,
  })
  // L'étape est finie, même s'il manque une bordure : la barre ne doit pas
  // rester plantée à 80 % pendant que la recherche, elle, est repartie.
  onProgress(1)

  const merged = mergeExtracts(wanted.map((tile) => obtained.get(tileKey(level, tile)) ?? emptyExtract()))
  // Les tuiles gardées restent entières — c'est ce qui les rend réutilisables
  // pour le départ d'à côté. Seul ce qu'on rend ici est ramené au disque voulu.
  const out = clipToDisk(merged, lon, lat, radiusM)
  out.sources = {}
  for (const tile of wanted) {
    if (!obtained.has(tileKey(level, tile))) continue
    const origine = origins.get(tile) ?? 'appareil'
    out.sources[origine] = (out.sources[origine] ?? 0) + 1
  }
  // Dit au reste du moteur qu'il manque une bordure : le graphe qui en sort ne
  // sera pas gardé pour les recherches suivantes, qui, elles, auront tout.
  if (obtained.size < wanted.length) out.partial = true
  return out
}

/**
 * Attend le cœur de la zone, mais pas éternellement.
 *
 * On ne peut pas se passer du cœur : sans lui, il n'y a pas d'itinéraire. On
 * peut, en revanche, se passer de la moitié de la zone, et il vaut mieux des
 * boucles un peu moins variées tout de suite qu'une zone complète dans un quart
 * d'heure. Le téléchargement, lui, continue : ce qui arrive après est rangé, et
 * la recherche suivante au même endroit aura tout.
 */
async function deadline(download, { wanted, obtained, level, lat, lon, dataBudgetMs, hardBudgetMs }) {
  const home = tileKey(level, [Math.floor(lon / TILE_DEG), Math.floor(lat / TILE_DEG)])
  const enough = () => obtained.has(home) && obtained.size >= Math.ceil(wanted.length * ENOUGH_SHARE)

  let timer = null
  const after = (ms) =>
    new Promise((resolve) => {
      timer = setTimeout(() => resolve('délai'), ms)
    })
  // Le téléchargement l'emporte presque toujours ; les deux plafonds ne servent
  // qu'aux jours où les serveurs publics d'OpenStreetMap sont à genoux.
  let failure = null
  const task = download.then(
    () => 'fini',
    (error) => {
      failure = error
      return 'panne'
    },
  )
  let issue = await Promise.race([task, after(dataBudgetMs)])
  if (timer) clearTimeout(timer)
  if (issue === 'délai' && !enough()) {
    issue = await Promise.race([task, after(Math.max(0, hardBudgetMs - dataBudgetMs))])
    if (timer) clearTimeout(timer)
  }
  if (issue === 'fini') return undefined

  // Rien du tout : une panne reste une panne, et un délai dépassé se dit de la
  // même façon. Mais s'il est arrivé des tuiles, même pas celle du départ, on
  // cherche avec : le départ se raccroche au réseau jusqu'à deux kilomètres,
  // souvent dans la tuile d'à côté.
  if (!obtained.size) throw failure ?? new OverpassError(SILENT)
  for (const tile of wanted) {
    const key = tileKey(level, tile)
    if (!obtained.has(key)) abandoned.add(key)
  }
  return undefined
}

/** Distance du départ au point le plus proche d'une tuile. */
function nearestTileDistance(lat, lon) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  return ([ix, iy]) => {
    const x = (Math.min(Math.max(lon, ix * TILE_DEG), (ix + 1) * TILE_DEG) - lon) * kx
    const y = (Math.min(Math.max(lat, iy * TILE_DEG), (iy + 1) * TILE_DEG) - lat) * 110_540
    return Math.hypot(x, y)
  }
}

/**
 * Attend le téléchargement — mais pas indéfiniment pour des tuiles de bordure.
 *
 * Sans le cœur de la zone, il n'y a rien à chercher : on attend, aussi longtemps
 * qu'il le faut. Mais quand seules manquent des tuiles du bord — la carte livrée
 * s'arrête à la limite de la région, et une maison à deux kilomètres de cette
 * limite en demande deux ou trois à Overpass —, les tuiles en main suffisent à
 * tracer la boucle. On leur laisse quelques secondes, puis on cherche sans
 * elles ; le téléchargement, lui, continue en fond et les range pour la fois
 * suivante.
 *
 * Une panne franche d'Overpass ne fait pas échouer la recherche non plus, pour
 * la même raison : mieux vaut les boucles du cœur de la zone qu'un écran
 * d'erreur devant quelqu'un en tenue.
 */
async function settle(download, args) {
  const { wanted, obtained, level, lat, lon, radiusM, peripheralWaitMs } = args
  const absent = wanted.filter((tile) => !obtained.has(tileKey(level, tile)))
  if (!absent.length) return download

  const near = nearestTileDistance(lat, lon)
  const core = absent.some((tile) => near(tile) < CORE_SHARE * radiusM)
  if (core || !obtained.size) return deadline(download, args)

  // Les tuiles sur lesquelles on a déjà renoncé dans cette session ne coûtent
  // plus d'attente : elles se téléchargent en fond, comme les autres.
  const delay = absent.every((tile) => abandoned.has(tileKey(level, tile))) ? 0 : peripheralWaitMs
  let timer = null
  const gaveUp = await Promise.race([
    // Une erreur vaut ici un abandon, pas un échec : le cœur est là.
    download.then(() => false, () => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), delay)
    }),
  ])
  if (timer) clearTimeout(timer)
  if (gaveUp) {
    for (const tile of wanted) {
      const key = tileKey(level, tile)
      if (!obtained.has(key)) abandoned.add(key)
    }
  }
  return undefined
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
  const levels = []
  for (let l = level; l >= 0; l -= 1) levels.push(l)
  const copies = await Promise.all(levels.map((l) => readTile(tileKey(l, tile))))
  let best = null
  let bestLevel = level
  for (let k = 0; k < levels.length; k += 1) {
    const copy = copies[k]
    if (copy && !(best?.at >= copy.at)) {
      best = copy
      bestLevel = levels[k]
    }
  }
  if (!best) return null
  // Le passage au niveau demandé ne se fait qu'une fois, sur la copie retenue.
  return {
    at: best.at,
    key: tileKey(bestLevel, tile),
    extract: bestLevel === level ? best.extract : deriveLevel(best.extract, level),
  }
}

// Les tuiles de bordure sur lesquelles on a déjà renoncé à attendre, le temps de
// la session. Sans cette mémoire, chaque recherche au même endroit reperdait les
// mêmes six secondes à attendre les mêmes tuiles absentes.
const abandoned = new Set()

/** Pour les tests : oublie les tuiles abandonnées. */
export const resetAbandoned = () => abandoned.clear()

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

function firstBudget(bytesPerTile, remaining, level, chunkBytes = CHUNK_BYTES, heavy = false) {
  // `heavy` : la zone a déjà été jugée lourde et coupée en deux (le coeur, puis
  // le bord). Son coeur tient souvent en cinq ou six tuiles, et le raccourci du
  // « tout d'un coup » les demanderait ensemble — soixante mégaoctets de Paris
  // dans une seule requête, ce que la mesure de densité existe pour éviter.
  if (bytesPerTile === null) return !heavy && remaining <= ONE_SHOT_TILES && level <= 1 ? remaining : 1
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

/**
 * Les miroirs, les valides d'abord. `offset` décale le départ parmi eux.
 *
 * Deux lots partent ensemble dans une grande ville : sans décalage, ils
 * attaquaient le même serveur, qui met les requêtes simultanées dans la même
 * file — deux lots, deux fois l'attente. Décalés, chacun a sa file, et les
 * deux arrivent dans le temps d'un seul.
 */
export function mirrorOrder(now = Date.now(), offset = 0) {
  const healthy = MIRRORS.filter((url) => !(demotedUntil.get(url) > now))
  const demoted = MIRRORS.filter((url) => demotedUntil.get(url) > now)
  const shift = healthy.length ? ((offset % healthy.length) + healthy.length) % healthy.length : 0
  return [...healthy.slice(shift), ...healthy.slice(0, shift), ...demoted]
}

const demote = (url) => demotedUntil.set(url, Date.now() + DEMOTE_MS)
const restore = (url) => demotedUntil.delete(url)
export const resetMirrorHealth = () => demotedUntil.clear()

async function queryMirrors(body, fetchImpl, hedgeDelayMs = HEDGE_DELAY_MS, onBytes = null, offset = 0) {
  let empty = null
  for (let attempt = 0; attempt < ROUNDS; attempt += 1) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1) + Math.random() * 1000)
    const mirrors = mirrorOrder(Date.now(), offset)
    const answer = await hedgedRound(mirrors, body, fetchImpl, hedgeDelayMs, RETRY_DELAY_MS, onBytes)
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
  raceWidth = RACE_WIDTH,
) {
  const waiting = [...mirrors]
  const inFlight = new Set()
  const emptyFrom = []
  let empty = null

  const launch = (url, { delayMs = 0, retries = 0 } = {}) => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const task = sleep(delayMs)
      // Un départ différé dont la course est déjà gagnée ne part plus : sans
      // cette garde, la requête du perdant partait quand même, pour rien.
      .then(() => {
        if (controller.signal.aborted) throw Object.assign(new Error('course terminée'), { name: 'AbortError' })
        return ask(url, body, controller, fetchImpl, onBytes)
      })
      .then(
        (answer) => ({ task, url, answer }),
        (error) => ({ task, url, error }),
      )
    Object.assign(task, { controller, url, startedAt, retries })
    inFlight.add(task)
  }

  let raced = false
  try {
    while (waiting.length || inFlight.size) {
      // Rien en cours : le miroir suivant part tout de suite, sans délai — et au
      // tout premier départ, les `RACE_WIDTH` premiers ensemble.
      if (!inFlight.size) {
        launch(waiting.shift())
        if (!raced) {
          raced = true
          for (let k = 1; k < raceWidth && waiting.length; k += 1) launch(waiting.shift())
        }
      }

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
    // À court de temps ou de mémoire, Overpass répond quand même « 200 », avec
    // ce qu'il a eu le temps de trouver et une remarque. Prendre ces rues-là pour
    // la zone entière laisserait des quartiers vides — un échec, donc, qu'on
    // retente, ailleurs ou en plus petit.
    if (typeof payload.remark === 'string' && /runtime error|timed out|out of memory/i.test(payload.remark)) {
      throw Object.assign(new Error(`${url} : ${payload.remark}`), { transient: true })
    }
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
  abandoned.clear()
  resetArchives()
  return forgetTiles()
}
