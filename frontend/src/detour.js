// Recoudre le parcours après un recalcul.
//
// Le moteur (`engine/reroute.js`) rend le raccord seul : de la position au point
// où l'on retrouve la boucle. Ce module en fait un parcours complet — raccord,
// puis la fin de la boucle depuis la jonction — que le guidage suit comme
// n'importe quel autre : ses consignes, ses couleurs de sécurité, ses traversées.

import { haversine } from './format'

/**
 * Le nouveau parcours à suivre.
 *
 * @param route     le parcours suivi jusqu'ici
 * @param detour    le raccord : `{ coords, connectM, joinIndex, steps }`
 * @param joinAlong où tombe la jonction sur `route`, en mètres depuis son début
 * @param home      le raccord rentre au départ : il n'y a plus de boucle après
 *   lui, et l'arrivée se dit au départ — pas « les trois tours sont terminés »
 */
export function spliceRoute(route, detour, joinAlong, { home = false } = {}) {
  const tail = route.geometry.slice(detour.joinIndex + 1)
  const geometry = [...detour.coords, ...tail]
  // Ce qui était à `d` mètres sur l'ancien tracé est désormais à `d + shift`.
  const shift = detour.connectM - joinAlong

  const kept = home
    ? [{ dist_m: Math.round(detour.connectM * 10) / 10, turn: 'finish', angle: 0, road: null, text: 'Te voilà rentré au départ.', lon: geometry.at(-1)[0], lat: geometry.at(-1)[1], caution: false }]
    : (route.instructions || [])
        .filter((s) => s.turn !== 'start' && s.dist_m > joinAlong + 5)
        .map((s) => ({ ...s, dist_m: Math.round((s.dist_m + shift) * 10) / 10 }))

  const connector = {
    coords: detour.coords,
    length_m: Math.round(detour.connectM * 10) / 10,
    level: 'safe',
    detour: true,
  }
  const rest = sliceSegments(route.segments, joinAlong)

  return {
    ...route,
    geometry,
    instructions: [...detour.steps, ...kept],
    home: home || Boolean(route.home),
    // Sans coordonnées de tronçons — un favori, qui ne les garde pas — le tracé
    // se dessine d'un seul tenant, comme avant le détour.
    segments: rest ? [connector, ...rest] : [],
    crossings: crossingsAhead(route, detour.joinIndex),
    distance_m: Math.round(lengthOf(geometry) * 10) / 10,
    rerouted: true,
    // De combien avancer une distance du nouveau tracé pour la retrouver sur
    // le parcours prévu : le profil altimétrique et le compteur de tours sont
    // ceux du parcours d'origine.
    plan_offset_m: (route.plan_offset_m ?? 0) - shift,
  }
}

/** Les tronçons au-delà de `along`, le premier coupé à la bonne longueur. */
function sliceSegments(segments, along) {
  if (!segments?.length || !segments[0]?.coords?.length) return null
  const out = []
  let cursor = 0
  for (const segment of segments) {
    const coords = segment.coords
    let length = 0
    for (let i = 1; i < coords.length; i += 1) length += haversine(coords[i - 1], coords[i])
    if (cursor + length <= along) {
      cursor += length
      continue
    }
    if (cursor >= along) {
      out.push(segment)
      cursor += length
      continue
    }
    // La jonction tombe dans ce tronçon : on n'en garde que la fin.
    let walked = cursor
    let cut = coords.length - 1
    for (let i = 1; i < coords.length; i += 1) {
      walked += haversine(coords[i - 1], coords[i])
      if (walked > along) {
        cut = i
        break
      }
    }
    const tail = coords.slice(cut)
    if (tail.length >= 1) out.push({ ...segment, coords: [coords[cut - 1], ...tail], length_m: Math.round((cursor + length - along) * 10) / 10 })
    cursor += length
  }
  return out
}

/** Les traversées encore devant, après la jonction. */
function crossingsAhead(route, joinIndex) {
  const geometry = route.geometry
  return (route.crossings || []).filter((c) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < geometry.length; i += 1) {
      const d = haversine(geometry[i], [c.lon, c.lat])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best >= joinIndex
  })
}

function lengthOf(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) total += haversine(coords[i - 1], coords[i])
  return total
}
