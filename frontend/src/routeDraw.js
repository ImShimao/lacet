/**
 * Le tracé qui se dessine : la part d'un parcours déjà « tracée » à l'instant
 * `fraction` de l'animation, tronçon par tronçon.
 *
 * La carte posait la boucle d'un bloc ; dessinée depuis le départ, dans son
 * sens, elle dit d'un seul coup d'œil par où elle part et par où elle revient —
 * ce que les chevrons ne montrent qu'en les cherchant.
 */

import { haversine } from './format'

/** Longueur d'une ligne, en degrés corrigés de la latitude : seul le rapport compte ici. */
function lengthOf(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) total += step(coords[i - 1], coords[i])
  return total
}

function step([x1, y1], [x2, y2]) {
  const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180)
  return Math.hypot((x2 - x1) * k, y2 - y1)
}

/** Prépare un GeoJSON de `MapView` (une ligne, ou une collection de tronçons). */
export function drawPlan(data) {
  const features = data?.type === 'Feature' ? [data] : (data?.features ?? [])
  const lengths = features.map((f) => lengthOf(f.geometry.coordinates))
  return { features, lengths, total: lengths.reduce((a, b) => a + b, 0) }
}

/** Le début du parcours, jusqu'à `fraction` (0 à 1) de sa longueur. */
export function drawnPart({ features, lengths, total }, fraction) {
  let left = Math.max(0, Math.min(1, fraction)) * total
  const out = []
  for (let i = 0; i < features.length && left > 0; i += 1) {
    if (lengths[i] <= left) {
      out.push(features[i])
      left -= lengths[i]
      continue
    }
    const coords = features[i].geometry.coordinates
    const cut = [coords[0]]
    for (let j = 1; j < coords.length; j += 1) {
      const d = step(coords[j - 1], coords[j])
      if (d < left) {
        cut.push(coords[j])
        left -= d
        continue
      }
      const t = d ? left / d : 0
      cut.push([coords[j - 1][0] + (coords[j][0] - coords[j - 1][0]) * t, coords[j - 1][1] + (coords[j][1] - coords[j - 1][1]) * t])
      break
    }
    out.push({ ...features[i], geometry: { type: 'LineString', coordinates: cut } })
    left = 0
  }
  return { type: 'FeatureCollection', features: out }
}

/**
 * Le survol : un point qui avance le long de la boucle, en mètres depuis le
 * départ, et le cap à suivre — celui d'un point un peu plus loin, pour que la
 * caméra prenne les virages au lieu de pivoter à chaque coin de rue.
 */
export function alongLine(line) {
  const cum = [0]
  for (let i = 1; i < line.length; i += 1) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]))
  const total = cum[cum.length - 1]
  const at = (metres) => {
    const d = Math.max(0, Math.min(total, metres))
    let lo = 0
    let hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= d) lo = mid
      else hi = mid
    }
    const span = cum[hi] - cum[lo]
    const t = span ? (d - cum[lo]) / span : 0
    return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t]
  }
  return { total, at }
}

/** Le cap de `a` vers `b`, en degrés depuis le nord. */
export function bearingOf(a, b) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI
}

/**
 * Le cap de la caméra du survol, qui rattrape `target` par le plus court
 * chemin, en un temps qui ne dépend pas de la cadence d'affichage : avec un pas
 * fixe par image, un iPhone à 120 Hz tournait deux fois plus vite qu'à 60 Hz,
 * et une image sautée donnait un à-coup au virage.
 */
export function easeBearing(current, target, dtMs, tauMs = 500) {
  const turn = ((((target - current) % 360) + 540) % 360) - 180
  return current + turn * (1 - Math.exp(-Math.max(0, dtMs) / tauMs))
}

/** L'altitude à `metres` du départ, interpolée dans le profil de la boucle, ou `null`. */
export function profileAt(profile, metres) {
  if (!profile?.length) return null
  if (metres <= profile[0].dist_m) return profile[0].ele_m
  for (let i = 1; i < profile.length; i += 1) {
    const [a, b] = [profile[i - 1], profile[i]]
    if (metres > b.dist_m) continue
    const span = b.dist_m - a.dist_m
    return span ? a.ele_m + ((b.ele_m - a.ele_m) * (metres - a.dist_m)) / span : b.ele_m
  }
  return profile[profile.length - 1].ele_m
}

/**
 * La trace d'une sortie en croquis SVG, cadrée dans `width` × `height` : le
 * chemin `d` d'un `<path>`, et le point de départ. `null` sans trace.
 */
export function sketch(track, width, height, pad = 6) {
  if (!(track?.length > 1)) return null
  const k = Math.cos((track[0][1] * Math.PI) / 180)
  const xs = track.map(([lon]) => lon * k)
  const ys = track.map(([, lat]) => lat)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = Math.min((width - 2 * pad) / (x1 - x0 || 1e-9), (height - 2 * pad) / (y1 - y0 || 1e-9))
  // Centré : une trace étroite ne colle pas au bord gauche.
  const ox = (width - (x1 - x0) * scale) / 2
  const oy = (height - (y1 - y0) * scale) / 2
  const at = (i) => [ox + (xs[i] - x0) * scale, oy + (y1 - ys[i]) * scale].map((v) => Math.round(v * 10) / 10)
  const points = track.map((_, i) => at(i))
  return { d: `M${points.map((p) => p.join(' ')).join('L')}`, start: points[0], points }
}

/**
 * Le croquis découpé par bande (`paceBands`) : un chemin par suite de tronçons
 * de la même bande, `[{ band, d }]`. Les tronçons sans bande restent au tracé
 * de fond.
 */
export function bandPaths(points, bands) {
  const out = []
  for (let i = 1; i < points.length; i += 1) {
    const band = bands[i - 1]
    if (band === null || band === undefined) continue
    const last = out[out.length - 1]
    if (last && last.band === band && last.end === i - 1) {
      last.d += `L${points[i].join(' ')}`
      last.end = i
    } else {
      out.push({ band, end: i, d: `M${points[i - 1].join(' ')}L${points[i].join(' ')}` })
    }
  }
  return out
}
