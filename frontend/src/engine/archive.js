// Les rues servies à l'octet près, depuis des archives préparées d'avance.
//
// Overpass est un **moteur de requêtes** : il calcule l'extraction des rues à la
// volée, sur des serveurs publics et gratuits. C'est ce qui rendait la première
// recherche dans un coin inconnu longue — cinq à quarante secondes quand tout va
// bien, rien du tout quand un serveur sature. Or les rues ne changent pas d'une
// heure à l'autre : elles peuvent être découpées une fois pour toutes, et
// servies comme des fichiers.
//
// C'est ce que fait déjà la carte livrée avec l'app pour l'Alsace. Ici, la même
// chose pour tout le reste, mais gardée en ligne plutôt que dans l'app : des
// archives d'un demi-degré (`scripts/pack_tiles.py`), et **on n'en lit que ce
// dont on a besoin**. Chaque archive commence par un répertoire — où est chaque
// tuile, et ce qu'elle pèse ; on le lit une fois, puis on demande les tuiles par
// plages d'octets. jsDelivr et GitHub servent les deux, et autorisent l'app à
// les lire (vérifié : « HTTP 206 » et « Access-Control-Allow-Origin : * »).
//
// Une sortie de 10 km dans une ville jamais visitée, ce sont trois ou quatre
// requêtes et trois mégaoctets — une seconde au lieu d'une minute. Et comme les
// tuiles voisines se suivent dans le fichier, celles d'une même recherche
// forment deux ou trois suites contiguës qu'on demande d'un bloc.
//
// Rien ici ne fait échouer une recherche : si l'archive n'existe pas, si le
// réseau tombe, si le format n'est pas celui attendu, on rend ce qu'on a et
// Overpass reprend la main.

import { fromRegionTile } from './region'
import { store } from './store'

const MAGIC = 'LACETILE'
const HEADER = 32
const ENTRY = 20
export const BLOCK_DEG = 0.5
const TILE_DEG = 0.05
const PER_BLOCK = Math.round(BLOCK_DEG / TILE_DEG)

// Où sont les archives.
//
// **Et pourquoi pas jsDelivr**, alors que c'est le CDN naturel d'un dépôt
// GitHub. Mesuré le 22 septembre 2026 : il répond bien « HTTP 206 » à une
// demande de plage, mais les octets rendus ne sont **pas** ceux du fichier. Il
// sert une version encodée et applique la plage dessus — il annonce d'ailleurs
// une taille totale de douze octets supérieure à la vraie. Le fichier entier
// est identique ; seules les plages mentent. Une archive lue ainsi donnerait des
// tuiles illisibles, silencieusement, et l'app retomberait sur Overpass sans
// que rien n'explique pourquoi.
//
// `raw.githubusercontent` rend, lui, exactement les octets demandés — vérifié au
// milieu d'un fichier, pas seulement au début — et autorise l'app à les lire
// (« Access-Control-Allow-Origin : * »). C'est donc lui, et c'est aussi un CDN.
const SOURCES = [
  import.meta.env?.VITE_TILES_URL,
  'https://raw.githubusercontent.com/ImShimao/lacet-data/main/packs',
].filter(Boolean)

// Les sources réellement interrogées. Les tests les vident : une suite de tests
// ne doit toucher à aucun réseau, et surtout pas à celui des autres.
let sources = SOURCES

/** Pour les tests, et pour une installation qui servirait ses propres archives. */
export const setArchiveSources = (list) => {
  sources = list
}

const REQUEST_TIMEOUT_MS = 15_000
// Deux tuiles séparées par moins que ça sont demandées ensemble : une requête de
// plus coûte plus cher que quelques kilooctets inutiles.
const STITCH_BYTES = 120_000
const DIRECTORY_TTL_MS = 7 * 86_400_000

const meta = store('osm')

/** Le bloc qui contient la tuile — mêmes maths que `block_of` en Python. */
export const blockOf = (ix, iy) => [Math.floor(ix / PER_BLOCK), Math.floor(iy / PER_BLOCK)]

// Les répertoires déjà lus, le temps de la session ; et sur l'appareil, pour que
// la première recherche du lendemain n'ait pas à les relire.
const directories = new Map()

async function get(path, range, fetchImpl) {
  for (const source of sources) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const headers = range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}
      const response = await fetchImpl(`${source.replace(/\/$/, '')}/${path}`, {
        headers,
        signal: controller.signal,
      })
      if (!response.ok) continue
      const buffer = await response.arrayBuffer()
      // Un serveur qui ignore la plage demandée rend tout le fichier (« 200 ») :
      // c'est correct, seulement plus lourd, et on y découpe ce qu'on voulait.
      if (range && response.status === 200 && buffer.byteLength > range[1] - range[0] + 1) {
        return buffer.slice(range[0], range[1] + 1)
      }
      return buffer
    } catch {
      /* source suivante */
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/** Le répertoire d'un bloc : pour chaque tuile, où elle est et ce qu'elle pèse. */
function directory(bx, by, fetchImpl) {
  const key = `${bx}_${by}`
  if (directories.has(key)) return directories.get(key)

  // Un échec passager — un tunnel, un portail wifi — ne doit pas condamner les
  // archives pour toute la session : on oublie la tentative ratée, et la
  // recherche suivante réessaiera.
  const task = (async () => {
    const kept = await meta.get(`meta:dir:${key}`)
    if (kept && Date.now() - kept.at < DIRECTORY_TTL_MS) return kept.book

    // Assez large pour l'en-tête et le répertoire entier d'un bloc ordinaire.
    const head = await get(`${key}.lct`, [0, 65_535], fetchImpl)
    if (!head || head.byteLength < HEADER) return null
    const view = new DataView(head)
    if (new TextDecoder().decode(new Uint8Array(head, 0, 8)) !== MAGIC) return null
    if (view.getUint16(8, true) !== 1) return null
    // Le niveau de détail de l'archive. Les nôtres sont au plus fin (0), mais
    // une archive plus grossière servie comme si elle était fine promettrait des
    // rues qu'elle ne contient pas — et l'app chercherait des boucles sur un
    // réseau troué sans le savoir.
    const level = view.getUint16(10, true)
    const count = view.getUint32(20, true)
    // La date de fabrication de l'archive devient l'âge des tuiles qu'on en
    // tire : elles vieillissent comme les autres, et se rafraîchissent chez
    // Overpass passé trois mois.
    const builtAt = Number(view.getBigUint64(24, true))

    let table = head
    const needed = HEADER + ENTRY * count
    if (needed > head.byteLength) {
      table = await get(`${key}.lct`, [0, needed - 1], fetchImpl)
      if (!table || table.byteLength < needed) return null
    }
    const entries = new Map()
    const tableView = new DataView(table)
    for (let i = 0; i < count; i += 1) {
      const at = HEADER + ENTRY * i
      entries.set(`${tableView.getInt32(at, true)}:${tableView.getInt32(at + 4, true)}`, {
        offset: Number(tableView.getBigUint64(at + 8, true)),
        length: tableView.getUint32(at + 16, true),
      })
    }
    const book = { builtAt, level, entries }
    meta.set(`meta:dir:${key}`, { at: Date.now(), book })
    return book
  })()

  directories.set(key, task)
  task.then((book) => {
    if (!book) directories.delete(key)
  })
  return task
}

async function gunzip(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Les suites contiguës à demander pour ces tuiles, dans l'ordre du fichier. */
function runsFor(found) {
  const runs = []
  for (const tile of found) {
    const last = runs[runs.length - 1]
    const gap = last ? tile.entry.offset - (last.end + 1) : Infinity
    if (last && gap >= 0 && gap <= STITCH_BYTES) {
      last.end = tile.entry.offset + tile.entry.length - 1
      last.tiles.push(tile)
    } else {
      runs.push({ start: tile.entry.offset, end: tile.entry.offset + tile.entry.length - 1, tiles: [tile] })
    }
  }
  return runs
}

/**
 * Les tuiles qu'on peut servir depuis les archives, décodées.
 *
 * `tiles` : une liste de `[ix, iy]`. Rend une `Map` de `"ix:iy"` vers
 * `{at, level, extract}` — `at` étant la date de fabrication de l'archive, pour
 * que ces tuiles vieillissent comme les autres, et `level` son niveau de détail.
 * Ce qui manque n'est pas une erreur : c'est à Overpass.
 */
export async function fetchArchived(tiles, { fetchImpl = fetch, onTile = null } = {}) {
  if (typeof DecompressionStream === 'undefined' || !tiles.length) return new Map()
  const out = new Map()

  const byBlock = new Map()
  for (const [ix, iy] of tiles) {
    const [bx, by] = blockOf(ix, iy)
    const key = `${bx}_${by}`
    if (!byBlock.has(key)) byBlock.set(key, { bx, by, tiles: [] })
    byBlock.get(key).tiles.push([ix, iy])
  }

  await Promise.all(
    [...byBlock.values()].map(async ({ bx, by, tiles: wanted }) => {
      const lus = await lireBloc(bx, by, wanted, fetchImpl, out, onTile)
      // Zéro tuile lue alors que le répertoire en annonçait : il est périmé.
      // Les archives sont refaites tous les mois, et les positions changent —
      // un répertoire gardé une semaine désignerait alors n'importe quoi. Plutôt
      // que de laisser l'app retomber sur Overpass sans savoir pourquoi, on
      // l'oublie et on relit une fois.
      if (lus === 0) {
        directories.delete(`${bx}_${by}`)
        await meta.delete(`meta:dir:${bx}_${by}`)
        await lireBloc(bx, by, wanted, fetchImpl, out, onTile)
      }
    }),
  )
  return out
}

/** Lit d'un bloc les tuiles voulues. Rend leur nombre, ou `null` sans répertoire. */
async function lireBloc(bx, by, wanted, fetchImpl, out, onTile) {
  const book = await directory(bx, by, fetchImpl).catch(() => null)
  if (!book) return null
  const { builtAt, level, entries } = book

  const found = wanted
    .map(([ix, iy]) => ({ ix, iy, entry: entries.get(`${ix}:${iy}`) }))
    .filter((tile) => tile.entry)
    .sort((a, b) => a.entry.offset - b.entry.offset)
  if (!found.length) return null

  let lus = 0
  await Promise.all(
    runsFor(found).map(async (run) => {
      const buffer = await get(`${bx}_${by}.lct`, [run.start, run.end], fetchImpl)
      if (!buffer) return
      for (const tile of run.tiles) {
        const from = tile.entry.offset - run.start
        if (from + tile.entry.length > buffer.byteLength) continue
        try {
          const text = await gunzip(buffer.slice(from, from + tile.entry.length))
          out.set(`${tile.ix}:${tile.iy}`, {
            at: builtAt,
            level,
            extract: fromRegionTile(JSON.parse(text)),
          })
          lus += 1
          onTile?.(out.size)
        } catch {
          /* une tuile illisible n'empêche pas les autres */
        }
      }
    }),
  )
  return lus
}

/** Pour les tests : oublie les répertoires lus. */
export const resetArchives = () => directories.clear()
