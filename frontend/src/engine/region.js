// La carte régionale livrée avec l'app.
//
// Les rues de la région où l'on court sont préparées chaque semaine par
// `scripts/region_tiles.py`, sur un serveur de GitHub, et rangées dans l'app
// sous `region/` : une tuile par fichier, plus un index. Une recherche dans la
// région les lit sur place — une fraction de seconde — au lieu de les demander
// à Overpass, qui mettait de vingt secondes à plusieurs minutes.
//
// Hors de la région, ou dans une tuile à cheval sur sa limite, rien ne change :
// Overpass reste la source. Et une tuile livrée vieillit comme une autre :
// passé quatorze jours, elle est servie tout de suite puis rafraîchie en fond
// (voir `overpass.js`).

// Relatif à l'app, qui sert ces fichiers elle-même : `capacitor://localhost/…`
// sur l'iPhone, le serveur de développement ailleurs, où ils sont absents.
import { keptBarrier } from './safety'

const BASE = '/region/'

// La lecture de l'index, gardée comme promesse : les tuiles d'une zone le
// demandent toutes en même temps, et gardé comme valeur, il était relu par
// chacune avant que la première lecture n'aboutisse.
let index = null

/** L'index de la carte régionale, lu une fois — ou `null` s'il n'y en a pas. */
export function regionIndex(fetchImpl = fetch) {
  if (!index) {
    index = (async () => {
      try {
        const response = await fetchImpl(`${BASE}index.json`)
        const data = response.ok ? await response.json() : null
        return data?.v === 3 ? { ...data, set: new Set(data.tiles) } : null
      } catch {
        return null
      }
    })()
  }
  return index
}

/** Pour les tests : oublie l'index lu. */
export const resetRegion = () => {
  index = null
}

/**
 * La tuile (ix, iy) de la carte régionale, au format de l'app — ou `null`.
 *
 * Les tuiles livrées sont toujours au niveau de détail le plus fin (0) : c'est
 * à l'appelant d'en retirer ce qu'un niveau plus grossier ne prend pas.
 */
export async function regionTile(ix, iy, fetchImpl = fetch) {
  const region = await regionIndex(fetchImpl)
  if (!region?.set.has(`${ix}_${iy}`)) return null
  try {
    const response = await fetchImpl(`${BASE}${ix}_${iy}.json`)
    if (!response.ok) return null
    return { at: region.builtAt, extract: fromRegionTile(await response.json()) }
  } catch {
    return null
  }
}

/**
 * Décode une tuile régionale.
 *
 * Coordonnées en entiers de 1e-7 degré, chaque point écrit comme l'écart au
 * précédent ; numéros de nœuds de même. La division par 1e7 rend exactement
 * le nombre qu'aurait donné la lecture du texte d'Overpass, qui écrit sept
 * décimales : les deux sont l'arrondi correct du même décimal.
 */
export function fromRegionTile(data) {
  // Les nœuds d'une tuile : les passages piétons, et depuis septembre 2026 les
  // barrières qui ferment le passage. Une tuile plus ancienne n'a que les
  // premiers ; elle se relit pareil.
  const nodes = data.c.map(([id, x, y, tags]) => ({ id, lon: x / 1e7, lat: y / 1e7, tags }))
  return {
    ways: data.w.map(([id, tags, nodes, coords]) => ({ id, tags, nodes: undelta(nodes), flat: unpair(coords) })),
    landuse: data.l.map(([id, coords]) => ({ id, flat: unpair(coords) })),
    crossings: nodes.filter((n) => n.tags?.highway === 'crossing'),
    barriers: nodes.filter((n) => keptBarrier(n.tags)),
    // Parcs, bois, eau, et voies de sentiers balisés — depuis octobre 2026.
    // Une tuile plus ancienne n'en a pas ; elle se relit sans, et la voie
    // y perd seulement sa préférence pour la nature.
    green: (data.g ?? []).map(([id, fill, rings]) => ({ id, fill: fill === 1, rings: rings.map(unpair) })),
    marked: data.r ?? [],
  }
}

/**
 * Écrit une tuile au format des tuiles livrées.
 *
 * C'est aussi ce que le cache de l'appareil garde (`overpass.js`) : un texte,
 * et non des objets JavaScript. Trois raisons, mesurées sur une tuile de
 * Guebwiller de 4 Mo : le texte pèse trois fois moins que la même tuile rangée
 * par IndexedDB, il se relit en 44 ms au lieu de 100, et sa taille se connaît
 * exactement — ce qui permet de tenir un budget plutôt que de laisser le cache
 * gonfler jusqu'à ce qu'iOS le vide en entier, un jour de pluie, sans prévenir.
 */
export function toRegionTile(extract) {
  return {
    w: extract.ways.map((way) => [way.id, way.tags, delta(way.nodes), pair(way.flat)]),
    l: extract.landuse.map((area) => [area.id, pair(area.flat)]),
    c: nodesOf(extract).map((c) => [c.id, Math.round(c.lon * 1e7), Math.round(c.lat * 1e7), c.tags]),
    g: (extract.green ?? []).map((area) => [area.id, area.fill ? 1 : 0, area.rings.map(pair)]),
    r: extract.marked ?? [],
  }
}

/** Passages et barrières, sans doublon : un même nœud peut être les deux. */
function nodesOf(extract) {
  const seen = new Set()
  const out = []
  for (const n of [...extract.crossings, ...(extract.barriers ?? [])]) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  return out
}

function delta(values) {
  const out = new Array(values.length)
  let previous = 0
  for (let i = 0; i < values.length; i += 1) {
    out[i] = values[i] - previous
    previous = values[i]
  }
  return out
}

function pair(flat) {
  const out = new Array(flat.length)
  let x = 0
  let y = 0
  for (let i = 0; i < flat.length; i += 2) {
    const lx = Math.round(flat[i] * 1e7)
    const ly = Math.round(flat[i + 1] * 1e7)
    out[i] = lx - x
    out[i + 1] = ly - y
    x = lx
    y = ly
  }
  return out
}

function undelta(values) {
  const out = new Array(values.length)
  let current = 0
  for (let i = 0; i < values.length; i += 1) {
    current += values[i]
    out[i] = current
  }
  return out
}

function unpair(values) {
  const flat = new Float64Array(values.length)
  let x = 0
  let y = 0
  for (let i = 0; i < values.length; i += 2) {
    x += values[i]
    y += values[i + 1]
    flat[i] = x / 1e7
    flat[i + 1] = y / 1e7
  }
  return flat
}
