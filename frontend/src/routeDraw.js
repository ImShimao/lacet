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
