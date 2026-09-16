// L'extrait OpenStreetMap — portage de `backend/app/osm/extract.py`.
//
// Une différence de forme, et une seule : la géométrie d'une voie est rangée
// **à plat** dans un `Float64Array` — `[lon, lat, lon, lat, …]` — au lieu d'une
// liste de couples. Sur un extrait parisien de 2,6 millions de points, des
// couples feraient autant de petits tableaux : plusieurs centaines de
// mégaoctets sur un téléphone, pour exactement les mêmes nombres.

/** Range une réponse Overpass brute : `{ways, landuse, crossings}`. */
export function fromOverpass(payload, into = emptyExtract()) {
  for (const el of payload.elements ?? []) {
    const tags = el.tags ?? {}

    if (el.type === 'node') {
      if (tags.highway === 'crossing') {
        into.crossings.push({ id: el.id, lon: el.lon, lat: el.lat, tags })
      }
      continue
    }

    const geometry = el.geometry
    if (el.type !== 'way' || !geometry || !geometry.length) continue

    const flat = new Float64Array(geometry.length * 2)
    for (let i = 0; i < geometry.length; i += 1) {
      flat[2 * i] = geometry[i].lon
      flat[2 * i + 1] = geometry[i].lat
    }

    if (tags.highway) {
      into.ways.push({ id: Math.trunc(el.id ?? 0), tags, nodes: el.nodes ?? [], flat })
    } else if (tags.landuse) {
      into.landuse.push({ id: Math.trunc(el.id ?? 0), flat })
    }
  }
  return into
}

export const emptyExtract = () => ({ ways: [], landuse: [], crossings: [] })

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
  const landuse = new Set()
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
  }
  return out
}
