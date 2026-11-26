// Mettre le fond de carte d'un parcours de côté, pour le courir sans réseau.
//
// Ce qui manquait n'était pas le parcours : sa géométrie, ses consignes, son
// profil et son évaluation de sécurité vivent déjà dans le stockage local, et
// s'ouvrent hors ligne. Ce qui manquait, c'est **la carte dessous** — un favori
// ouvert sans couverture donnait un trait vert sur du noir, inutilisable pour
// se repérer.
//
// **Les tuiles sont vectorielles et s'arrêtent au zoom 14.** Au-delà, le moteur
// de rendu réutilise la même tuile en l'agrandissant. Mettre de côté le zoom 14
// suffit donc à disposer d'une carte nette à tous les zooms où l'on regarde un
// parcours.
//
// **Peu de tuiles ne veut pas dire peu d'octets.** C'est la mesure qui l'a
// appris, contre l'intuition : une boucle de dix kilomètres dans Paris tient en
// trente-deux tuiles — et pèse seize mégaoctets, parce qu'une tuile vectorielle
// de centre-ville transporte six cents kilooctets de bâtiments, de commerces et
// de libellés. La même boucle en rase campagne en pèse moins d'un. Compter les
// tuiles pour estimer la place occupée se trompe donc d'un facteur vingt, dans
// un sens comme dans l'autre : c'est pourquoi le plafond réel est en octets, et
// se vérifie pendant le téléchargement, pas avant.
//
// **Le style, les pictogrammes et les polices ne dépendent pas du parcours.**
// Ils sont téléchargés une fois et servent à tous les suivants ; seul le lot de
// tuiles est propre à chaque boucle.
//
// **Les fichiers vont dans IndexedDB, et la carte vient les y lire**
// (`offlineRequest`, `loadOffline`). L'app n'a pas de service worker — WebKit
// n'en fait pas tourner sous son adresse `capacitor://` — : ranger les tuiles
// dans l'API de cache donnait une carte téléchargée, annoncée « hors ligne ✓ »,
// et noire une fois dehors.

import { TERRAIN_ZOOM, terrainTileUrl } from './engine/environment'
import { store } from './engine/store'
import { load, save } from './storage'

import { t } from './i18n'
// Les tuiles de CARTO s'arrêtent là ; au-delà, le rendu agrandit. En deçà, on
// descend jusqu'au zoom 10 pour que dézoomer ne fasse pas un trou : cela ne
// coûte qu'une poignée de tuiles supplémentaires.
const TILE_ZOOM = 14
const MIN_ZOOM = 10

// La projection Web Mercator ne va pas jusqu'aux pôles : au-delà, la formule
// passe par le logarithme d'un nombre négatif et rend `NaN`, qui traverse
// silencieusement tous les calculs et finit par ne produire *aucune* tuile.
// C'est exactement l'inverse de ce qu'on veut d'une garde-fou.
const LAT_MAX = 85.05112878

// Plafond de tuiles par parcours. Il ne borne pas la taille — seuls les octets
// la bornent — mais le **temps** et le nombre de requêtes : les tuiles partent
// une par une vers des serveurs publics, et quelques centaines suffisent à
// occuper une minute. C'est aussi le garde-fou contre une géométrie aberrante,
// qui demanderait sinon des centaines de millions d'adresses.
const MAX_TILES = 300

// Plafond de place occupée par parcours. Quarante mégaoctets laissent passer
// une boucle urbaine complète au zoom le plus fin (seize en moyenne à Paris) et
// arrêtent la combinaison coûteuse : un long parcours à travers une grande
// ville, qui dépasserait sans cela les deux cents.
const MAX_BYTES = 40 * 1024 * 1024

// Taille supposée d'une tuile tant qu'on n'en a mesuré aucune. Elle ne sert
// qu'à décider du tout premier niveau ; dès qu'un niveau est passé, c'est sa
// moyenne réelle qui prédit le suivant — bien plus juste qu'une constante, car
// les tuiles d'un même endroit se ressemblent.
const GUESS_BYTES = 150 * 1024

// Marge autour du parcours, en tuiles. Une seule suffit : à ce zoom une tuile
// couvre plus de deux kilomètres, donc le tour est largement pris.
const MARGIN = 1

// Le relief garde une tuile de plus tout autour du parcours : au zoom 12, elle
// couvre six kilomètres et demi, de quoi chercher d'autres boucles alentour
// sans réseau (une recherche de quinze kilomètres en lit six). Mesuré le 19
// octobre 2026 : une centaine de kilooctets la tuile, un mégaoctet la zone —
// hors du plafond des fonds de carte, qu'il ne mérite pas d'entamer. Au-delà de
// ce nombre, un parcours aberrant ou continental, on s'en passe.
const RELIEF_MARGIN = 1
const MAX_RELIEF_TILES = 100

// Plages de glyphes à prendre. 0–255 couvre l'ASCII et le latin-1 — donc les
// accents français ; 256–511 le latin étendu, pour les œ et les noms d'ailleurs.
const GLYPH_RANGES = ['0-255', '256-511']

/** Les quatre sous-domaines de tuiles sont équivalents : on range tout sous
 *  un seul nom.
 *
 *  L'adresse est aussi mise sous sa forme canonique — espaces encodés, virgules
 *  laissées telles quelles — qui est celle que le réseau reçoit. MapLibre
 *  demande les polices sous un nom brut (`Montserrat Medium,Open Sans Bold`) ;
 *  rangées sous une autre écriture, elles n'étaient jamais retrouvées, et la
 *  carte hors ligne s'affichait sans un seul nom de rue. */
export function mapKey(url) {
  const shared = url.replace(/\/\/tiles-[a-d]\./, '//tiles.')
  try {
    return new URL(shared).href
  } catch {
    return shared
  }
}

/** IndexedDB est-il là ? Demandé à chaque appel plutôt qu'une fois au
 *  chargement : figé dans une constante, ce test devenait impossible à éprouver. */
export const isAvailable = () => typeof indexedDB !== 'undefined'

/** Les fichiers de carte, dans IndexedDB. */
const deviceFiles = store('maps')

/**
 * Range un fichier téléchargé. Rend la taille enregistrée : c'est elle qui fait
 * avancer le plafond en octets, et elle doit être la vraie, pas celle
 * qu'annonce un en-tête.
 */
async function keepFile(url, response) {
  const bytes = await response.arrayBuffer()
  await deviceFiles.set(url, { type: response.headers.get('content-type') || '', bytes })
  return bytes.byteLength
}

/**
 * Clé d'un parcours dans le journal des cartes gardées — et celle qui dit qu'un
 * parcours est en favori.
 *
 * Faite du nom et de la longueur, elle changeait avec le nom : un favori
 * renommé perdait sa carte hors ligne, et la même boucle retrouvée par une
 * recherche n'avait plus le cœur plein. Un parcours renommé garde donc dans
 * `key` la clé qu'il avait (`useLibrary.rename`).
 */
export const keyOf = (route) => route.key ?? `${route.name}|${Math.round(route.distance_m)}`

// --- géométrie des tuiles --------------------------------------------------

function tileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function tileY(lat, z) {
  const rad = (Math.max(-LAT_MAX, Math.min(LAT_MAX, lat)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

function boundsOf(geometry) {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of geometry) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

/** Bornes en tuiles d'un parcours à un zoom donné. */
function rangeAt(bounds, z, margin) {
  const max = 2 ** z
  const clamp = (v) => Math.max(0, Math.min(max - 1, v))
  return {
    x0: clamp(tileX(bounds.minLon, z) - margin),
    x1: clamp(tileX(bounds.maxLon, z) + margin),
    // L'axe des tuiles descend vers le sud : la latitude maximale donne le y minimal.
    y0: clamp(tileY(bounds.maxLat, z) - margin),
    y1: clamp(tileY(bounds.minLat, z) + margin),
  }
}

const countAt = (r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)

/** La pile de zooms retenue quand le plus fin est `top`.
 *
 *  On garde toujours quelques niveaux plus larges que le plus fin : dézoomer
 *  pendant la sortie ne doit pas ouvrir un trou noir. Sur une géométrie si
 *  vaste que même le zoom 10 dépasse le budget, `top` descend en dessous, et
 *  la pile se réduit à ce seul niveau.
 */
const baseZoom = (top) => Math.min(MIN_ZOOM, top)

/** La marge n'a de sens qu'au niveau le plus fin : les niveaux plus larges
 *  couvrent déjà quatre fois plus de terrain à chaque cran. */
const marginAt = (z, top) => (z === top ? MARGIN : 0)

/** Combien de tuiles coûterait une pile s'arrêtant à `top`, sans rien construire. */
function countPlan(bounds, top) {
  let total = 0
  for (let z = baseZoom(top); z <= top; z += 1) {
    total += countAt(rangeAt(bounds, z, marginAt(z, top)))
  }
  return total
}

/**
 * Les tuiles à prendre, niveau par niveau, du plus large au plus fin.
 *
 * On couvre le **rectangle** englobant le parcours, et non le seul couloir
 * qu'il emprunte. C'est un choix, pas un oubli : un couloir économiserait un
 * bon tiers des tuiles sur un long circuit, mais laisserait du noir dès qu'on
 * fait glisser la carte pour regarder à côté — or c'est précisément ce qu'on
 * fait quand on cherche où couper, où s'abriter, ou par où rentrer.
 *
 * Le compte est fait **avant** de construire quoi que ce soit. Sur une
 * géométrie aberrante — une boucle qui ferait le tour du monde parce qu'une
 * coordonnée s'est inversée — construire d'abord pour mesurer ensuite
 * demanderait des centaines de millions d'entrées, et ferait tomber l'onglet
 * avant qu'on ait pu s'en apercevoir.
 *
 * La descente ne s'arrête pas au zoom 10. C'était la première version, et le
 * plafond n'y était qu'un vœu : un parcours à l'échelle d'un continent tient
 * encore huit cent mille tuiles au zoom 10. Comme il y a toujours un zoom où
 * le monde entier tient en une tuile, descendre jusqu'à zéro fait du plafond
 * une garantie plutôt qu'une intention.
 */
function tilePlan(geometry, layers = 1) {
  if (!geometry?.length) return { levels: [], maxZoom: null }
  const bounds = boundsOf(geometry)

  // Le plafond porte sur le téléchargement entier, pas sur une couche : le fond
  // satellite en superpose deux (l'imagerie et les libellés), et compter
  // séparément reviendrait à doubler la note en silence.
  const budget = MAX_TILES / Math.max(1, layers)

  let top = TILE_ZOOM
  while (top > 0 && countPlan(bounds, top) > budget) top -= 1

  const levels = []
  for (let z = baseZoom(top); z <= top; z += 1) {
    const r = rangeAt(bounds, z, marginAt(z, top))
    const tiles = []
    for (let x = r.x0; x <= r.x1; x += 1) {
      for (let y = r.y0; y <= r.y1; y += 1) tiles.push({ x, y })
    }
    levels.push({ z, tiles })
  }
  return { levels, maxZoom: top }
}

/** Les adresses d'un niveau pour un gabarit donné. */
const urlsAt = (level, template) =>
  level.tiles.map(({ x, y }) =>
    mapKey(template.replace('{z}', level.z).replace('{x}', x).replace('{y}', y)),
  )

/** Le plan à plat, pour un seul gabarit. */
export function planTiles(geometry, template, layers = 1) {
  if (!geometry?.length || !template) return { urls: [], maxZoom: null }
  const { levels, maxZoom } = tilePlan(geometry, layers)
  const urls = levels.flatMap((level) => urlsAt(level, template))
  return { urls: [...new Set(urls)], maxZoom }
}

/** Les seules URL, pour qui n'a pas besoin du zoom atteint. */
export const tilesFor = (geometry, template) => planTiles(geometry, template).urls

// --- ce qu'il faut prendre --------------------------------------------------

/**
 * Lit le style pour en déduire tout ce que la carte demandera : les gabarits
 * d'URL des tuiles, les pictogrammes et les polices.
 *
 * On interroge le style plutôt que d'écrire ces adresses en dur : elles
 * changent avec le fond choisi, et un chemin figé se périmerait en silence — la
 * carte resterait vide hors ligne sans que rien ne le signale.
 *
 * Le style est tantôt une URL (les fonds CARTO), tantôt un objet décrit dans
 * `mapStyles.js` (Relief, Satellite). Et il peut empiler plusieurs couches :
 * le satellite superpose l'imagerie et les libellés, et n'en garder qu'une
 * donnerait hors ligne soit une photo muette, soit des noms flottant sur du
 * noir.
 */
async function describeStyle(source) {
  const shared = []
  let style = source
  if (typeof source === 'string') {
    shared.push(source)
    // `fetch` ne rejette pas sur un 404 ou un 503 : sans ce contrôle, le corps
    // d'erreur passait pour un style, et la carte était dite « non gardable ».
    const response = await fetch(source)
    if (!response.ok) throw new Error(`HTTP ${response.status} pour le style ${source}`)
    style = await response.json()
  }

  const templates = []
  for (const src of Object.values(style.sources || {})) {
    // Une couche qui s'arrête avant le zoom 10 — l'ombrage du globe entier des
    // fonds OpenFreeMap — n'a rien à montrer à l'échelle d'un parcours. La
    // compter faisait demander des centaines de tuiles inexistantes, et
    // divisait par deux le budget des vraies.
    if (src.maxzoom !== undefined && src.maxzoom < MIN_ZOOM) continue
    if (src.tiles?.length) {
      templates.push(src.tiles[0])
    } else if (src.url) {
      shared.push(src.url)
      // Un TileJSON en erreur ne doit pas disparaître en silence : la carte
      // serait gardée sans une de ses couches.
      const response = await fetch(src.url)
      if (!response.ok) throw new Error(`HTTP ${response.status} pour ${src.url}`)
      const tilejson = await response.json()
      if (tilejson.tiles?.length) templates.push(tilejson.tiles[0])
    }
  }

  if (style.sprite) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      shared.push(`${style.sprite}${suffix}`)
    }
  }

  if (style.glyphs) {
    const stacks = new Set()
    for (const layer of style.layers || []) {
      const font = layer.layout?.['text-font']
      if (font?.length) stacks.add(font.join(','))
    }
    for (const stack of stacks) {
      for (const range of GLYPH_RANGES) {
        // Le nom brut, comme MapLibre le demande : `mapKey` l'encode ensuite
        // de la seule façon que le réseau et le rendu partagent.
        shared.push(style.glyphs.replace('{fontstack}', stack).replace('{range}', range))
      }
    }
  }

  return { templates, shared: shared.map(mapKey) }
}

// --- téléchargement ---------------------------------------------------------

/**
 * Met de côté la carte d'un parcours. Rend les octets enregistrés et le zoom le
 * plus fin obtenu.
 *
 * Les niveaux partent du plus large vers le plus fin, et **la place occupée est
 * mesurée à mesure**. Avant d'attaquer un niveau, on estime ce qu'il coûtera
 * d'après la taille moyenne des tuiles déjà prises à cet endroit ; si cela fait
 * dépasser le plafond, on s'arrête là. Estimer avant de commencer était
 * impossible : une tuile pèse vingt kilooctets à la campagne et six cents en
 * ville, et rien dans son adresse ne le dit.
 *
 * On s'arrête toujours à une frontière de niveau, jamais au milieu : une carte
 * volontairement plus grossière reste lisible, une carte tronquée laisse des
 * carrés noirs à l'endroit exact où l'on court. Et le premier niveau est pris
 * quoi qu'il arrive : mieux vaut une carte du quartier très large que pas de
 * carte du tout.
 *
 * Les échecs isolés ne font pas échouer l'ensemble : une police manquante ou
 * une tuile de bordure absente laisse une carte imparfaite, ce qui vaut
 * infiniment mieux qu'un écran noir parce qu'un fichier sur cinquante n'a pas
 * répondu.
 *
 * `auto` marque une carte prise d'elle-même au départ d'une sortie
 * (`keepForRun`) : elle cédera sa place aux suivantes, pas une carte gardée à
 * la main.
 */
export async function download(route, mapStyle, onProgress, { auto = false } = {}) {
  if (!isAvailable()) throw new Error(t('Le stockage de l\'appareil ne répond pas : impossible de garder la carte.'))

  const { templates, shared } = await describeStyle(mapStyle.style)
  if (!templates.length) throw new Error(t('Ce fond de carte ne peut pas être gardé hors ligne.'))

  const { levels } = tilePlan(route.geometry, templates.length)
  const relief = reliefTiles(route.geometry)

  // En série plutôt qu'en rafale : ce sont des serveurs publics et gratuits, et
  // cinquante requêtes simultanées depuis chaque utilisateur seraient un abus.
  const planned =
    shared.length + relief.length + levels.reduce((n, l) => n + l.tiles.length * templates.length, 0)
  let done = 0

  async function take(urls) {
    let bytes = 0
    let count = 0
    for (const url of urls) {
      try {
        const response = await fetch(url, { mode: 'cors' })
        if (response.ok) {
          bytes += await keepFile(url, response)
          count += 1
        }
      } catch {
        /* un fichier manquant dégrade la carte, il ne l'annule pas */
      }
      done += 1
      onProgress?.(done / planned)
    }
    return { bytes, count }
  }

  const urls = [...shared]
  let bytes = (await take(shared)).bytes
  let perTile = GUESS_BYTES
  let maxZoom = null

  for (const level of levels) {
    const wanted = [...new Set(templates.flatMap((t) => urlsAt(level, t)))]
    if (maxZoom !== null && bytes + wanted.length * perTile > MAX_BYTES) break

    const got = await take(wanted)
    urls.push(...wanted)
    bytes += got.bytes
    // Un niveau dont rien n'est arrivé ne compte pas comme atteint. Sans cette
    // nuance, une coupure pendant le dernier palier faisait annoncer « zoom 14 »
    // à une carte qui s'arrête au 13 — et l'on ne s'en apercevait qu'une fois
    // dehors, sans réseau pour y remédier.
    if (got.count > 0) {
      perTile = got.bytes / got.count
      maxZoom = level.z
    }
  }

  // Pas une seule tuile — le réseau est tombé, ou n'était pas là : garder ce
  // parcours afficherait « hors ligne ✓ » sur une carte noire. Mieux vaut le
  // dire, et ne rien laisser derrière soi.
  if (maxZoom === null) {
    await dropUnused(urls, load().offlineMaps || {})
    throw new Error(t('Aucune tuile n\'est arrivée : la carte n\'a pas pu être gardée.'))
  }

  // Le relief, pour que le D+ d'une boucle cherchée ici sans réseau reste connu :
  // le moteur lit ces tuiles dans le même magasin (`environment.js`).
  bytes += (await take(relief)).bytes
  urls.push(...relief)
  onProgress?.(1)

  const journal = load().offlineMaps || {}
  const previous = journal[keyOf(route)]
  journal[keyOf(route)] = {
    urls,
    bytes,
    maxZoom,
    at: new Date().toISOString(),
    // On garde le fond avec lequel la carte a été prise. Les tuiles de « Sombre »
    // ne servent pas à « Satellite » : sans cette trace, changer de fond
    // donnerait un écran vide alors que l'app affiche « hors ligne ✓ ».
    styleKey: mapStyle.key,
    styleLabel: mapStyle.label,
    ...(auto && { auto: true }),
  }
  // Une carte reprise sous un autre fond laissait les tuiles de l'ancien sur
  // l'appareil, sans qu'aucun parcours ne les compte : de la place prise pour
  // rien, et invisible dans « Mon compte ».
  if (previous) await dropUnused(previous.urls, journal)
  save({ offlineMaps: journal })
  forgetStored()

  return { bytes, maxZoom }
}

// --- gardée au départ d'une sortie ------------------------------------------

// Le réseau tombe souvent là où l'on n'a jamais regardé la carte de près : en
// forêt, en montagne, au fond d'une vallée. Le départ garde donc la carte du
// parcours — mais seulement pour les cinq dernières sorties, la plus ancienne
// laissant sa place. Une boucle de campagne pèse moins d'un mégaoctet : autour
// de chez soi, quelques mégaoctets en tout. Les cartes gardées à la main, elles,
// ne partent jamais.
const AUTO_KEEP = 5

// Une rue change rarement : passé deux mois, la carte se reprend au départ
// suivant, pas avant. La reprendre à chaque retour du réseau coûterait du
// forfait pour rien.
const STALE_MS = 60 * 24 * 60 * 60 * 1000

/**
 * Garde la carte d'un parcours qu'on s'apprête à courir, sans rien demander.
 *
 * Rien ne part si la carte est déjà là, au même fond, depuis moins de deux mois.
 * Sans réseau, le téléchargement échoue sans toucher à ce qui était gardé : on
 * court avec ce qu'on avait.
 */
export async function keepForRun(route, mapStyle, now = Date.now()) {
  if (!isAvailable() || !route.geometry?.length) return
  const before = entryFor(route)
  const fresh = before && before.styleKey === mapStyle.key && now - Date.parse(before.at) < STALE_MS
  if (!fresh) {
    await download(route, mapStyle, undefined, { auto: before ? Boolean(before.auto) : true }).catch(() => null)
  }

  const journal = load().offlineMaps || {}
  const entry = journal[keyOf(route)]
  if (!entry?.auto) return
  // Le rang se compte à la dernière sortie, pas au téléchargement : la boucle
  // qu'on court chaque semaine ne doit pas partir avant celle d'un seul jour.
  entry.ranAt = new Date(now).toISOString()
  save({ offlineMaps: journal })

  const autos = Object.entries(journal)
    .filter(([, e]) => e.auto)
    .sort(([, a], [, b]) => (b.ranAt || b.at).localeCompare(a.ranAt || a.at))
  for (const [key] of autos.slice(AUTO_KEEP)) await removeKey(key)
}

/** Les tuiles d'altitude (Terrain Tiles, zoom 12) autour d'un parcours. */
export function reliefTiles(geometry) {
  if (!geometry?.length) return []
  const r = rangeAt(boundsOf(geometry), TERRAIN_ZOOM, RELIEF_MARGIN)
  if (countAt(r) > MAX_RELIEF_TILES) return []
  const urls = []
  for (let x = r.x0; x <= r.x1; x += 1) {
    for (let y = r.y0; y <= r.y1; y += 1) urls.push(mapKey(terrainTileUrl(x, y)))
  }
  return urls
}

const entryFor = (route) => (load().offlineMaps || {})[keyOf(route)] || null

/** Le parcours a-t-il sa carte ? */
export const isStored = (route) => Boolean(entryFor(route))

export const storedBytes = (route) => entryFor(route)?.bytes ?? 0

export const storedZoom = (route) => entryFor(route)?.maxZoom ?? null

export const storedStyleLabel = (route) => entryFor(route)?.styleLabel ?? null

export { TILE_ZOOM, MIN_ZOOM, MAX_TILES, MAX_BYTES }

/** Combien de parcours ont leur carte. */
export const storedCount = () => Object.keys(load().offlineMaps || {}).length

export function totalBytes() {
  return Object.values(load().offlineMaps || {}).reduce((sum, e) => sum + (e.bytes || 0), 0)
}

/**
 * Retire la carte d'un parcours — sans casser celle des autres.
 *
 * Deux boucles d'une même ville partagent leurs tuiles, et toutes partagent le
 * style et les polices. On n'efface donc que ce dont plus personne n'a besoin.
 */
export const remove = (route) => removeKey(keyOf(route))

async function removeKey(key) {
  const journal = load().offlineMaps || {}
  const entry = journal[key]
  if (!entry) return

  delete journal[key]
  await dropUnused(entry.urls, journal)
  save({ offlineMaps: journal })
  forgetStored()
}

/** Efface ceux de ces fichiers dont plus aucun parcours du journal n'a besoin. */
async function dropUnused(urls, journal) {
  const encoreUtiles = new Set(Object.values(journal).flatMap((e) => e.urls || []))
  for (const url of urls || []) {
    if (!encoreUtiles.has(url)) await deviceFiles.delete(url)
  }
}

/** Vide tout — appelé par l'effacement des données. */
export async function clear() {
  await deviceFiles.clear()
  save({ offlineMaps: {} })
  forgetStored()
}

// --- la carte lit ce qui est gardé -------------------------------------------

export const OFFLINE_PROTOCOL = 'lacet-carte'

// Le temps laissé au réseau pour une feuille de style, avant de prendre la
// copie gardée. Sans réseau du tout, la requête échoue sur-le-champ ; c'est la
// couverture qui faiblit — une barre, un relais saturé — qui laisse une requête
// pendre, et la carte resterait vide tout ce temps.
const STYLE_WAIT_MS = 4000

let storedUrls = null

/** Toutes les adresses gardées, pour un parcours ou un autre. Recalculé
 *  seulement quand le journal change : la carte le consulte à chaque tuile. */
function storedSet() {
  if (!storedUrls) {
    storedUrls = new Set(Object.values(load().offlineMaps || {}).flatMap((e) => e.urls || []))
  }
  return storedUrls
}

function forgetStored() {
  storedUrls = null
}

/**
 * `transformRequest` de la carte : détourne vers le stockage de l'appareil ce
 * qui y a été gardé, et laisse le reste partir normalement.
 *
 * Les tuiles, les pictogrammes et les polices sont lus **sur l'appareil
 * d'abord** : ils ne changent pas d'une semaine à l'autre, et les lire sur place
 * rend la carte instantanée sans coûter un octet de forfait. La feuille de style
 * et la description des tuiles passent **par le réseau d'abord** : ce sont elles
 * qui désignent les adresses des tuiles, et une copie figée continuerait de
 * pointer vers d'anciennes adresses partout ailleurs sur la carte, le jour où
 * le fournisseur en change.
 */
export function offlineRequest(url, resourceType) {
  if (!url.startsWith('http') || !storedSet().has(mapKey(url))) return undefined
  const first = resourceType === 'Style' || resourceType === 'Source' ? 'reseau' : 'appareil'
  return { url: `${OFFLINE_PROTOCOL}://${first}/${url}` }
}

/** Le chargeur de ces adresses détournées, enregistré par `maplibregl.addProtocol`. */
export async function loadOffline(params, abortController) {
  const rest = params.url.slice(OFFLINE_PROTOCOL.length + 3)
  const cut = rest.indexOf('/')
  const first = rest.slice(0, cut)
  const url = rest.slice(cut + 1)

  let file
  if (first === 'appareil') {
    file = (await deviceFiles.get(mapKey(url))) ?? (await fromNetwork(url, abortController.signal))
  } else {
    try {
      file = await fromNetwork(url, abortController.signal, STYLE_WAIT_MS)
    } catch (error) {
      if (abortController.signal.aborted) throw error
      file = await deviceFiles.get(mapKey(url))
      if (!file) throw error
    }
  }
  return { data: decode(file.bytes, params.type) }
}

async function fromNetwork(url, signal, waitMs) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  const timer = waitMs ? setTimeout(abort, waitMs) : null
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(t('{status} pour {url}', { status: response.status, url }))
    return { type: response.headers.get('content-type') || '', bytes: await response.arrayBuffer() }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function decode(bytes, type) {
  if (type === 'json') return JSON.parse(new TextDecoder().decode(bytes))
  if (type === 'string') return new TextDecoder().decode(bytes)
  return bytes
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
