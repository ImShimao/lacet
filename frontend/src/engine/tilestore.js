// Les rues gardées sur l'appareil : ce qu'on garde, et ce qu'on jette.
//
// Le cache des tuiles OpenStreetMap n'avait ni forme ni limite : chaque tuile
// était rangée telle quelle par IndexedDB — des objets JavaScript, un
// dictionnaire d'étiquettes par voie —, et rien n'était jamais effacé. Deux
// ennuis, et le second est le pire. Une tuile de ville pèse alors une dizaine
// de mégaoctets là où son texte serré en pèse trois. Et un cache sans plafond
// grossit jusqu'à ce que le système décide, un jour, de le vider **en entier** :
// on revient d'un voyage, on rouvre l'app chez soi, et tout est à retélécharger.
//
// D'où ces deux règles, qui tiennent lieu de gestion — il n'y a rien à épingler,
// rien à choisir :
//
// **Le même format que les tuiles livrées** (`region.js`) : un texte, trois fois
// plus léger, relu en 44 ms au lieu de 100 sur une tuile de 4 Mo, et dont on
// connaît la taille exacte — sans quoi aucun budget n'est possible.
//
// **Un budget, et le plus ancien s'en va.** Deux cent cinquante mégaoctets, soit
// environ trois fois l'Alsace : de quoi garder son coin, celui du travail, et
// deux ou trois endroits de vacances. Au-delà, ce sont les tuiles dont on ne
// s'est pas servi depuis le plus longtemps qui partent — celles d'un séjour
// d'il y a six mois avant celles d'hier.

import { fromRegionTile, toRegionTile } from './region'
import { store } from './store'

const tiles = store('osm')

export const BUDGET_BYTES = 250_000_000
// Jamais plus du quart de ce que le navigateur accorde : sur un téléphone
// presque plein, garder deux cent cinquante mégaoctets de rues, c'est se faire
// vider par le système — et perdre du même coup les cartes hors ligne, qui
// vivent dans le même quota.
const QUOTA_SHARE = 0.25
const USAGE_KEY = 'meta:usage'

let budget = null

async function allowance() {
  if (budget !== null) return budget
  budget = BUDGET_BYTES
  try {
    const { quota } = (await navigator.storage.estimate()) ?? {}
    if (quota) budget = Math.min(BUDGET_BYTES, Math.round(quota * QUOTA_SHARE))
  } catch {
    /* pas d'estimation : le plafond fixe suffit */
  }
  return budget
}

/** Pour les tests, et pour le jour où l'on voudra le régler à la main. */
export const setBudget = (bytes) => {
  budget = bytes
}

/**
 * Le journal du cache : une entrée par tuile, son poids et son dernier usage.
 *
 * Gardé dans le même magasin, sous une clé à part. Il est **autorisé à se
 * tromper** : une entrée sans tuile se jette, une tuile sans entrée se
 * retrouvera à la prochaine écriture. Ce qui compte, c'est qu'il permette de
 * décider quoi effacer sans relire deux cents mégaoctets pour le savoir.
 */
let usage = null

async function journal() {
  if (!usage) usage = (await tiles.get(USAGE_KEY)) ?? { total: 0, tiles: {} }
  return usage
}

// Les écritures du journal se suivent : deux recherches à la fois lisaient la
// même version et la réécrivaient chacune, perdant les comptes de l'autre.
let queue = Promise.resolve()
const enqueue = (task) => {
  queue = queue.then(task, task)
  return queue
}

/** La tuile gardée, décodée — ou `null`. */
export async function readTile(key) {
  const copy = await tiles.get(key)
  if (!copy) return null
  // Les caches d'avant gardaient l'extrait tel quel : ils restent lisibles, et
  // se réécrivent au format serré au premier rafraîchissement.
  if (copy.extract) return { at: copy.at, extract: copy.extract }
  try {
    return { at: copy.at, extract: fromRegionTile(JSON.parse(copy.data)) }
  } catch {
    return null
  }
}

/** Range une tuile, et fait de la place si le budget est dépassé. */
export async function writeTile(key, at, extract) {
  const data = JSON.stringify(toRegionTile(extract))
  await tiles.set(key, { at, data })
  await enqueue(async () => {
    const book = await journal()
    const previous = book.tiles[key]
    book.total += data.length - (previous?.bytes ?? 0)
    book.tiles[key] = { bytes: data.length, used: at }
    await evict(book, await allowance())
    await tiles.set(USAGE_KEY, book)
  })
}

/** Note que ces tuiles viennent de servir : ce sont les dernières à jeter. */
export async function touchTiles(keys, at = Date.now()) {
  if (!keys.length) return
  await enqueue(async () => {
    const book = await journal()
    let changed = false
    for (const key of keys) {
      if (book.tiles[key] && book.tiles[key].used !== at) {
        book.tiles[key].used = at
        changed = true
      }
    }
    if (changed) await tiles.set(USAGE_KEY, book)
  })
}

async function evict(book, limit) {
  if (book.total <= limit) return
  // Du plus ancien usage au plus récent, jusqu'à repasser sous neuf dixièmes du
  // budget : se contenter de revenir pile dessous ferait recommencer le ménage
  // à chaque tuile écrite.
  const ordered = Object.entries(book.tiles).sort((a, b) => a[1].used - b[1].used)
  for (const [key, entry] of ordered) {
    if (book.total <= limit * 0.9) break
    await tiles.delete(key)
    delete book.tiles[key]
    book.total -= entry.bytes
  }
}

/** Ce que pèsent les rues gardées, pour l'écran « Mon compte ». */
export async function tileUsage() {
  const book = await journal()
  return { bytes: Math.max(0, book.total), count: Object.keys(book.tiles).length, budget: await allowance() }
}

/** Oublie tout ce qui est gardé. */
export async function clearTiles() {
  usage = { total: 0, tiles: {} }
  await tiles.clear()
}

/** Pour les tests : relit le journal depuis le magasin. */
export const resetUsage = () => {
  usage = null
}
