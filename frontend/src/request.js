// Des réglages de l'écran à la demande faite au moteur, et d'une sortie
// terminée à son entrée d'historique. Rien ici ne dépend de React : ce sont des
// traductions, et elles se testent comme telles.

import { estimateKm, formatKm, raceOf } from './FiltersSheet.jsx'
import { pace } from './format'
import { slim } from './storage'

// « Distance exacte » : l'écart toléré entre la boucle et la distance visée.
const PRECISE_TOLERANCE = 0.025

/**
 * Le point demandé. Après une recherche, le repère rejoint la rue, là où la
 * boucle commence (voir `engine/door.js`) ; `asked` garde le point choisi —
 * la maison, et la rue de son adresse — d'où les recherches suivantes partent.
 */
export const askedOf = (start) => start.asked ?? start

/** Un lieu choisi (recherche, départ enregistré) comme départ : sa position, et sa rue. */
export const placeOf = (place) => ({ lat: place.lat, lon: place.lon, ...(place.street ? { street: place.street } : {}) })

/** La demande au moteur, pour ces réglages et ce départ. */
export function toRequest(p, start) {
  const point = askedOf(start)
  const body = {
    lat: point.lat,
    lon: point.lon,
    sport: p.sport,
    surface: p.surface,
    elevation: p.elevation,
    safety: p.safety,
    time_of_day: p.time_of_day,
    limit: p.count || 5,
  }
  // « Sûr » contourne aussi, tronçon par tronçon, ce qui longe le trafic :
  // c'est l'ancienne case « Grands axes », qui disait la même chose que lui
  // sans qu'on voie la différence. Mesuré sur vingt-quatre recherches autour de
  // Guebwiller : 22 m exposés en moyenne par boucle avant, 1 m après, même
  // justesse sur la distance. Une case restée cochée dans d'anciens réglages ne
  // compte plus — elle n'a plus d'interrupteur pour la décocher.
  const avoid = (p.avoid ?? []).filter((key) => key !== 'busy')
  if (p.safety === 'safe') avoid.push('busy')
  if (avoid.length) body.avoid = avoid
  if (point.street) body.street = point.street
  if (p.mode === 'distance') body.distance_km = p.distance_km
  else body.duration_min = p.duration_min
  // Viser un semi à ±10 %, c'est viser à deux kilomètres près.
  if (p.mode === 'distance' && p.precise) body.tolerance = PRECISE_TOLERANCE
  if (p.sport === 'bike' || p.speedUnit === 'speed') body.speed_kmh = p.speed_kmh
  else body.pace_sec_per_km = p.pace_sec_per_km
  return body
}

/** « 10 km · 6:30/km » — ce que dit la pastille d'activité. */
export function summarise(p) {
  const race = p.mode === 'distance' ? raceOf(p.distance_km) : null
  const dist = race
    ? race.label
    : p.mode === 'distance'
      ? `${formatKm(p.distance_km)} km`
      : `≈${Math.round(estimateKm(p))} km`
  const speed =
    p.sport === 'bike' || p.speedUnit === 'speed'
      ? `${p.speed_kmh} km/h`
      : `${pace(p.pace_sec_per_km)}/km`
  return `${dist} · ${speed}`
}

/** Entrée d'historique d'une sortie sans itinéraire. */
export function freeRunEntry(params) {
  return {
    id: `free-${Date.now()}`,
    name: params.sport === 'bike' ? 'Sortie libre à vélo' : 'Sortie libre',
    free: true,
    distance_m: 0,
    duration_s: 0,
    ascent_m: null,
    grade: null,
    safety: null,
    surfaces: null,
    segments: [],
    geometry: [],
  }
}

/** L'entrée d'historique d'une sortie terminée. */
export function runEntry(stats, { route, free, sport }, params) {
  const base = free ? freeRunEntry({ ...params, sport }) : slim(route)
  return {
    ...base,
    ranAt: new Date().toISOString(),
    actual_distance_m: Math.round(stats.distance),
    actual_duration_s: Math.round(stats.elapsed),
    actual_ascent_m: stats.ascent ?? null,
    // Ce qu'on a réellement couru, allégé — voir `trail.js`.
    track: stats.trail?.length > 1 ? stats.trail : null,
    // Le temps de chaque kilomètre, et le temps passé à l'arrêt : relevés
    // pendant la sortie, impossibles à retrouver après coup.
    splits: stats.splits?.length ? stats.splits : null,
    paused_s: stats.pausedS || 0,
    rerouted: Boolean(stats.rerouted),
    free: Boolean(free),
    sport,
  }
}

/**
 * La demande d'où vient un parcours. Celle de la recherche s'il en sort ; pour
 * un parcours rouvert depuis les favoris, on la reconstitue : son départ, sa
 * longueur, les réglages du moment. C'est avec elle qu'un détour se calcule.
 */
export function requestFor(route, result, params) {
  if (!route?.geometry?.length) return null
  if (result?.request && result.routes?.some((r) => r.id === route.id)) return result.request
  const [lon, lat] = route.geometry[0]
  const distanceKm = Math.max(0.5, Math.round((route.distance_m || 0) / 100) / 10)
  return toRequest({ ...params, mode: 'distance', distance_km: distanceKm }, { lat, lon })
}
