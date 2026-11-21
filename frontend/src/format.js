// La virgule française, partout : chaque écran la remettait — ou l'oubliait —
// à sa façon, et la même sortie s'affichait « 5,23 » dans l'historique et
// « 5.23 » sur l'écran de fin.
//
// Dans l'unité réglée (`units.js`) : le nom reste `km`, mais en miles c'est
// des miles qu'il écrit. L'unité qui suit le chiffre vient de `unitLabel()`.
import { perUnit, unitM } from './units'

export const km = (metres, digits = 2) => (metres / unitM()).toFixed(digits).replace('.', ',')

export function duration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function pace(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—'
  secondsPerKm = perUnit(secondsPerKm)
  // Arrondir **avant** de séparer les minutes des secondes. L'inverse —
  // `floor(x/60)` d'un côté, `round(x%60)` de l'autre — affiche « 4:60 » dès
  // que l'allure tombe dans la dernière demi-seconde d'une minute. Ça n'a rien
  // d'exotique : l'allure se recalcule à chaque relevé GPS, donc ça se produit
  // plusieurs fois par sortie, en gros chiffres au milieu de l'écran.
  const total = Math.round(secondsPerKm)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const percent = (share) => `${Math.round(share * 100)} %`

// Une boucle plate doit avoir l'air plate. Resserré sur l'amplitude réelle —
// vingt mètres sur dix kilomètres, à Colmar —, l'axe des altitudes donnait à la
// moindre bosse l'allure d'un col, et l'on doutait d'avoir demandé « plat ».
const MIN_PROFILE_RANGE_M = 60

/**
 * Les bornes de l'axe des altitudes d'un profil : au moins soixante mètres, et
 * le profil posé vers le bas, comme un terrain — pas flottant au milieu.
 */
export function profileRange(elevations) {
  let lo = Infinity
  let hi = -Infinity
  for (const e of elevations) {
    if (e < lo) lo = e
    if (e > hi) hi = e
  }
  if (hi - lo >= MIN_PROFILE_RANGE_M) return [lo, hi]
  const floor = lo - (MIN_PROFILE_RANGE_M - (hi - lo)) / 4
  return [floor, floor + MIN_PROFILE_RANGE_M]
}

const SURFACE_LABELS = {
  // revêtements constatés sur le tracé. « Bitume », pas « route » : un trottoir
  // est revêtu, et « 53 % route » à côté de « 71 % hors chaussée » se lisait
  // comme une contradiction.
  paved: 'bitume',
  gravel: 'chemin',
  trail: 'sentier',
  unknown: 'indéterminé',
  // préférences de terrain choisies par l'utilisateur
  road: 'Route',
  mixed: 'Mixte',
}
export const surfaceLabel = (key) => SURFACE_LABELS[key] || key

/** Distance orthodromique en mètres — sert au suivi GPS. */
export function haversine(a, b) {
  const R = 6371008.8
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)))
}
