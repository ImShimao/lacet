// Primitives géométriques — portage fidèle de `backend/app/geo.py`.
//
// Coordonnées en (lon, lat), degrés WGS84 ; distances en mètres. Les raisons des
// choix sont expliquées dans le module Python, qui reste la référence. Ne sont
// commentés ici que les points où JavaScript impose une écriture particulière.

import { degrees, pyHypot, pymod, pySum, radians } from './py'

export const EARTH_RADIUS_M = 6_371_008.8

export function haversineM(a, b) {
  const p1 = radians(a[1])
  const p2 = radians(b[1])
  const dp = radians(b[1] - a[1])
  const dl = radians(b[0] - a[0])
  // `x ** 2` en Python appelle `pow(x, 2)`, qui rend le carré arrondi au plus
  // près — exactement `x * x`, que JavaScript garantit sans passer par `pow`.
  const s1 = Math.sin(dp / 2)
  const s2 = Math.sin(dl / 2)
  const h = s1 * s1 + Math.cos(p1) * Math.cos(p2) * (s2 * s2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** Distance plane locale — voir `planar_distance`. */
export function planarDistance(lat0) {
  const kx = (EARTH_RADIUS_M * Math.cos(radians(lat0)) * Math.PI) / 180
  const ky = (EARTH_RADIUS_M * Math.PI) / 180
  return (a, b) => {
    const dx = (a[0] - b[0]) * kx
    const dy = (a[1] - b[1]) * ky
    return Math.sqrt(dx * dx + dy * dy)
  }
}

export function bearingDeg(a, b) {
  const p1 = radians(a[1])
  const p2 = radians(b[1])
  const dl = radians(b[0] - a[0])
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return pymod(degrees(Math.atan2(y, x)) + 360, 360)
}

/** (sud, ouest, nord, est) autour d'un point. */
export function bboxAround(lat, lon, radiusM) {
  const dlat = degrees(radiusM / EARTH_RADIUS_M)
  const cosLat = Math.max(0.01, Math.cos(radians(lat)))
  const dlon = degrees(radiusM / (EARTH_RADIUS_M * cosLat))
  return [lat - dlat, lon - dlon, lat + dlat, lon + dlon]
}

/** Quotient isopérimétrique 4πA / P² — voir `roundness`. */
export function roundness(coords) {
  if (coords.length < 3) return 0

  const lat0 = pySum(coords.map((c) => c[1])) / coords.length
  const lon0 = pySum(coords.map((c) => c[0])) / coords.length
  const kx = (EARTH_RADIUS_M * Math.cos(radians(lat0)) * Math.PI) / 180
  const ky = (EARTH_RADIUS_M * Math.PI) / 180
  const n = coords.length

  // Coordonnées centrées : voir le module Python, où la raison est expliquée —
  // sans centrage, la formule du lacet perd huit chiffres significatifs.
  let area2 = 0
  let perimeter = 0
  for (let i = 0; i < n; i += 1) {
    const x1 = (coords[i][0] - lon0) * kx
    const y1 = (coords[i][1] - lat0) * ky
    const j = (i + 1) % n
    const x2 = (coords[j][0] - lon0) * kx
    const y2 = (coords[j][1] - lat0) * ky
    area2 += x1 * y2 - x2 * y1
    perimeter += pyHypot(x2 - x1, y2 - y1)
  }

  if (perimeter <= 0) return 0
  const area = Math.abs(area2) / 2
  return Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter))
}

// Le crochet en U — voir `backtrack_share` dans `geo.py`, où les seuils sont
// justifiés. Les écarts sont en échantillons entiers, pour que les deux moteurs
// n'arrondissent pas différemment.
const BACKTRACK_STEP_M = 20
const BACKTRACK_NEAR_M = 40
const BACKTRACK_GAP_MIN = 13
const BACKTRACK_GAP_MAX = 75
const BACKTRACK_STEM = 10
const BACKTRACK_OPPOSITE_DEG = 135

/** Part du tracé qui revient sur ses pas par une voie voisine — `backtrack_share`. */
export function backtrackShare(coords) {
  const samples = resample(coords, BACKTRACK_STEP_M).map(([, c]) => c)
  const n = samples.length
  if (n < BACKTRACK_GAP_MIN + 2) return 0
  const heads = []
  for (let k = 0; k < n - 1; k += 1) heads.push(bearingDeg(samples[k], samples[k + 1]))
  let hits = 0
  for (let j = BACKTRACK_GAP_MIN; j < n - 1; j += 1) {
    for (let i = j - BACKTRACK_GAP_MIN; i > Math.max(-1, j - BACKTRACK_GAP_MAX - 1); i -= 1) {
      if (i < BACKTRACK_STEM && j >= n - 1 - BACKTRACK_STEM) continue
      const turn = Math.abs(pymod(heads[i] - heads[j] + 180, 360) - 180)
      if (turn > BACKTRACK_OPPOSITE_DEG && haversineM(samples[i], samples[j]) < BACKTRACK_NEAR_M) {
        hits += 1
        break
      }
    }
  }
  return hits / (n - 1)
}

/** Lancer de rayon. `ring` : liste de (lon, lat), fermée ou non. */
export function pointInRing(pt, ring) {
  const [x, y] = pt
  const n = ring.length
  if (n < 3) return false
  let inside = false
  let j = n - 1
  for (let i = 0; i < n; i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y) {
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (xCross > x) inside = !inside
    }
    j = i
  }
  return inside
}

/** (min_lon, min_lat, max_lon, max_lat) */
export function ringBbox(ring) {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  // `min(lons)` rend la première valeur minimale ; pour des nombres, laquelle des
  // égales est gardée ne change rien.
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }
  return [minLon, minLat, maxLon, maxLat]
}

/** Échantillonne un tracé tous les `stepM` : liste de (index d'origine, coordonnée). */
export function resample(coords, stepM) {
  if (!coords.length) return []
  const out = [[0, coords[0]]]
  let carried = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i]
    const b = coords[i + 1]
    const seg = haversineM(a, b)
    if (seg <= 0) continue
    let pos = stepM - carried
    while (pos < seg) {
      const t = pos / seg
      out.push([i, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]])
      pos += stepM
    }
    carried = pymod(carried + seg, stepM)
  }
  const last = out[out.length - 1][1]
  const end = coords[coords.length - 1]
  if (last[0] !== end[0] || last[1] !== end[1]) out.push([coords.length - 1, end])
  return out
}
