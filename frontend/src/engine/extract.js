// L'extrait OpenStreetMap — portage de `backend/app/osm/extract.py`.
//
// Une différence de forme, et une seule : la géométrie d'une voie est rangée
// **à plat** dans un `Float64Array` — `[lon, lat, lon, lat, …]` — au lieu d'une
// liste de couples. Sur un extrait parisien de 2,6 millions de points, des
// couples feraient autant de petits tableaux : plusieurs centaines de
// mégaoctets sur un téléphone, pour exactement les mêmes nombres.

import { keptBarrier } from './safety'

// Ce qu'on compte comme verdure ou eau — `GREEN_TAGS` en Python.
export const GREEN_TAGS = {
  leisure: ['park'],
  landuse: ['forest'],
  natural: ['wood', 'water'],
  waterway: ['river', 'canal'],
}
const BUILTUP_LANDUSE = new Set(['residential', 'retail', 'commercial', 'industrial', 'education'])

export const isGreen = (tags) => Object.entries(GREEN_TAGS).some(([key, values]) => values.includes(tags[key]))

const toFlat = (geometry) => {
  const flat = new Float64Array(geometry.length * 2)
  for (let i = 0; i < geometry.length; i += 1) {
    flat[2 * i] = geometry[i].lon
    flat[2 * i + 1] = geometry[i].lat
  }
  return flat
}

/** Range une réponse Overpass brute : `{ways, landuse, crossings, barriers, green, marked}`. */
export function fromOverpass(payload, into = emptyExtract()) {
  const routes = new Set()
  const ways = new Set()
  for (const el of payload.elements ?? []) {
    const tags = el.tags ?? {}

    if (el.type === 'relation') {
      const members = el.members ?? []
      if (tags.route) {
        for (const m of members) if (m.type === 'way') routes.add(m.ref)
      } else if (isGreen(tags)) {
        // Identifiant négatif : une relation et une voie peuvent porter le même
        // numéro, et la fusion des tuiles dédoublonne par identifiant.
        const rings = members.filter((m) => m.type === 'way' && m.geometry?.length).map((m) => toFlat(m.geometry))
        if (rings.length) into.green.push({ id: -Math.trunc(el.id), fill: true, rings })
      }
      continue
    }

    if (el.type === 'node') {
      if (tags.highway === 'crossing') {
        into.crossings.push({ id: el.id, lon: el.lon, lat: el.lat, tags })
      }
      if (keptBarrier(tags)) into.barriers.push({ id: el.id, lon: el.lon, lat: el.lat, tags })
      continue
    }

    const geometry = el.geometry
    if (el.type !== 'way' || !geometry || !geometry.length) continue

    const flat = toFlat(geometry)

    if (tags.highway) {
      const id = Math.trunc(el.id ?? 0)
      ways.add(id)
      into.ways.push({ id, tags, nodes: el.nodes ?? [], flat })
    } else if (BUILTUP_LANDUSE.has(tags.landuse)) {
      into.landuse.push({ id: Math.trunc(el.id ?? 0), flat })
    } else if (isGreen(tags)) {
      // Une rivière est un trait ; un bois, un anneau fermé qu'on remplit.
      const n = geometry.length
      const fill =
        !tags.waterway && n > 2 && flat[0] === flat[2 * n - 2] && flat[1] === flat[2 * n - 1]
      into.green.push({ id: Math.trunc(el.id ?? 0), fill, rings: [flat] })
    }
  }
  // Seules les voies présentes comptent : une relation de grande randonnée
  // cite des milliers de voies, d'un bout à l'autre de la région.
  for (const id of routes) if (ways.has(id)) into.marked.push(id)
  return into
}

// `barriers` : les portails fermés et ce qui ferme le passage — propres au
// moteur de l'app (voir `closedBarrier` dans `safety.js`) ; Python n'en a pas.
// `green` : parcs, bois et eau — `[{id, fill, rings}]` ; `marked` : les voies de
// sentiers balisés, par identifiant. Voir `green.js`.
export const emptyExtract = () => ({ ways: [], landuse: [], crossings: [], barriers: [], green: [], marked: [] })

/**
 * Relit la forme compacte écrite par le moteur Python (`to_cache`, version 2).
 *
 * Elle sert aux tests de parité : les deux moteurs doivent partir exactement du
 * même extrait. Les polygones n'y portent pas d'identifiant ; leur rang en tient
 * lieu, ce qui suffit puisqu'aucune fusion n'a lieu sur un extrait déjà complet.
 */
export function fromCompact(data) {
  if (data.v !== 2) return null
  return {
    ways: data.ways.map(([id, tags, nodes, flat]) => ({ id, tags, nodes, flat: Float64Array.from(flat) })),
    landuse: data.landuse.map((flat, i) => ({ id: -(i + 1), flat: Float64Array.from(flat) })),
    crossings: data.crossings.map(([id, lon, lat, tags]) => ({ id, lon, lat, tags })),
    barriers: [],
    green: (data.green ?? []).map(([id, fill, rings]) => ({ id, fill, rings: rings.map((r) => Float64Array.from(r)) })),
    marked: data.marked ?? [],
  }
}

/**
 * Ne garde que ce qui touche le disque demandé.
 *
 * Les rues arrivent par tuiles de 0,05°, et une tuile est prise dès qu'elle
 * **effleure** le disque : autour d'un départ, les tuiles couvrent deux fois la
 * surface demandée, et tout ce débord était construit en graphe puis parcouru
 * par Dijkstra pour rien — une boucle ne s'éloigne jamais de plus de la moitié
 * de sa longueur, et le rayon est déjà calculé pour ça. Mesuré à Guebwiller,
 * pour 10 km : 14 062 voies reçues, 7 550 à portée, et un graphe construit en
 * 144 ms au lieu de 251.
 *
 * Une voie qui déborde est gardée **entière** : on ne coupe pas les rues, on
 * écarte seulement celles qui sont hors d'atteinte de bout en bout.
 */
export function clipToDisk(extract, lon, lat, radiusM) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  // Le point de l'emprise le plus proche du départ : s'il est trop loin, toute
  // la géométrie l'est.
  const reaches = (flat) => {
    let west = Infinity
    let south = Infinity
    let east = -Infinity
    let north = -Infinity
    for (let i = 0; i < flat.length; i += 2) {
      if (flat[i] < west) west = flat[i]
      if (flat[i] > east) east = flat[i]
      if (flat[i + 1] < south) south = flat[i + 1]
      if (flat[i + 1] > north) north = flat[i + 1]
    }
    const dx = (Math.min(Math.max(lon, west), east) - lon) * kx
    const dy = (Math.min(Math.max(lat, south), north) - lat) * ky
    return dx * dx + dy * dy <= radiusM * radiusM
  }
  const inside = (c) => {
    const dx = (c.lon - lon) * kx
    const dy = (c.lat - lat) * ky
    return dx * dx + dy * dy <= radiusM * radiusM
  }
  return {
    ways: extract.ways.filter((way) => reaches(way.flat)),
    landuse: extract.landuse.filter((area) => reaches(area.flat)),
    crossings: extract.crossings.filter(inside),
    barriers: (extract.barriers ?? []).filter(inside),
    green: (extract.green ?? []).filter((area) => area.rings.some(reaches)),
    marked: extract.marked ?? [],
  }
}

/** Couple (lon, lat) du i-ème point d'une géométrie à plat. */
export const pointAt = (flat, i) => [flat[2 * i], flat[2 * i + 1]]

/** Géométrie à plat → liste de couples, pour les calculs qui en ont besoin. */
export function pairs(flat) {
  const out = new Array(flat.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = [flat[2 * i], flat[2 * i + 1]]
  return out
}

/**
 * Fusionne des extraits pris tuile par tuile, sans doublon.
 *
 * Overpass rend une voie **entière** dès qu'elle touche la zone demandée : une
 * rue à cheval sur deux tuiles revient deux fois, un polygone de quartier
 * quatre fois. On garde la première occurrence de chaque identifiant — l'ordre
 * d'arrivée des tuiles reste celui des voies, ce qui garde le graphe stable
 * d'une recherche à l'autre.
 */
export function mergeExtracts(parts) {
  const out = emptyExtract()
  const ways = new Set()
  const crossings = new Set()
  const barriers = new Set()
  const landuse = new Set()
  const green = new Set()
  const marked = new Set()
  for (const part of parts) {
    for (const way of part.ways) {
      if (ways.has(way.id)) continue
      ways.add(way.id)
      out.ways.push(way)
    }
    for (const area of part.landuse) {
      if (landuse.has(area.id)) continue
      landuse.add(area.id)
      out.landuse.push(area)
    }
    for (const c of part.crossings) {
      if (crossings.has(c.id)) continue
      crossings.add(c.id)
      out.crossings.push(c)
    }
    for (const b of part.barriers ?? []) {
      if (barriers.has(b.id)) continue
      barriers.add(b.id)
      out.barriers.push(b)
    }
    for (const area of part.green ?? []) {
      if (green.has(area.id)) continue
      green.add(area.id)
      out.green.push(area)
    }
    for (const id of part.marked ?? []) marked.add(id)
  }
  out.marked = [...marked]
  return out
}
