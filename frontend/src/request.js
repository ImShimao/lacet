// Des réglages de l'écran à la demande faite au moteur, et d'une sortie
// terminée à son entrée d'historique. Rien ici ne dépend de React : ce sont des
// traductions, et elles se testent comme telles.

import { directionOf, estimateKm, formatKm, raceOf, secondsPerKm } from './FiltersSheet.jsx'
import { pace } from './format'
import { slim } from './storage'

// « Distance exacte » : l'écart toléré entre la boucle et la distance visée.
const PRECISE_TOLERANCE = 0.025
// Les allures que le moteur accepte (`normalizeRequest`), en secondes par km.
const MIN_PACE = 150
const MAX_PACE = 1200

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
  // « Boucles déjà courues » ne part pas en évitement : ce sont les sorties
  // passées, envoyées à part (`familiar`, `App.jsx`).
  const avoid = (p.avoid ?? []).filter((key) => key !== 'busy' && key !== 'known')
  if (p.safety === 'safe') avoid.push('busy')
  if (avoid.length) body.avoid = avoid
  // Actif par défaut dans le moteur : seul le refus se dit.
  if (p.carfree === false) body.carfree = false
  // La gauche, face aux voitures, est le côté par défaut du moteur : seul
  // l'autre choix se dit.
  if (p.side === 'right' || p.side === 'any') body.side = p.side
  // Un D+ visé remplace Plat, Vallonné, Côtes dans le moteur.
  if (p.climb_m != null) body.climb_m = p.climb_m
  // « Auto » ne se dit pas : sans cap, la recherche est celle d'avant.
  const direction = directionOf(p.direction)
  if (direction) body.heading = direction.deg
  // « Auto » non plus : c'est la forme que le moteur choisit de lui-même.
  if (p.form && p.form !== 'auto') body.form = p.form
  if (p.form === 'laps') body.laps = p.laps ?? 2
  if (point.street) body.street = point.street
  if (p.mode === 'distance') body.distance_km = p.distance_km
  else body.duration_min = p.duration_min
  // Viser un semi à ±10 %, c'est viser à deux kilomètres près.
  if (p.mode === 'distance' && p.precise) body.tolerance = PRECISE_TOLERANCE
  // Le moteur lit la vitesse d'un cycliste, l'allure d'un coureur : un coureur
  // qui compte en km/h envoie donc l'allure équivalente. Envoyée telle quelle,
  // sa vitesse était ignorée — « 1 h à 12 km/h », annoncé ≈12 km dans les
  // filtres, donnait des boucles de 9 km, comptées à 6:30 du kilomètre.
  if (p.sport === 'bike') body.speed_kmh = p.speed_kmh
  else body.pace_sec_per_km = Math.min(MAX_PACE, Math.max(MIN_PACE, Math.round(secondsPerKm(p))))
  return body
}

// La forme choisie, dite sur la pastille : « Auto » ne se dit pas.
const FORM_WORDS = { loop: 'une boucle', eight: 'deux boucles' }

/** « 10 km · 3 tours · 6:30/km » — ce que dit la pastille d'activité. */
export function summarise(p) {
  // « Semi » se dit d'une course ; à vélo, 21,0975 km restent des kilomètres.
  const race = p.mode === 'distance' && p.sport !== 'bike' ? raceOf(p.distance_km) : null
  const dist = race
    ? race.label
    : p.mode === 'distance'
      ? `${formatKm(p.distance_km)} km`
      : `≈${Math.round(estimateKm(p))} km`
  const speed =
    p.sport === 'bike' || p.speedUnit === 'speed'
      ? `${p.speed_kmh} km/h`
      : `${pace(p.pace_sec_per_km)}/km`
  const form = p.form === 'laps' ? `${p.laps ?? 2} tours` : FORM_WORDS[p.form]
  // « Éviter › Boucles déjà courues » : ce qu'on cherche, ce sont des inédites.
  const fresh = (p.avoid ?? []).includes('known') ? 'inédites' : null
  return [dist, form, fresh, speed].filter(Boolean).join(' · ')
}

/** Entrée d'historique d'une sortie sans itinéraire. */
export function freeRunEntry(params, startedAt = Date.now()) {
  return {
    id: `free-${Date.now()}`,
    name: freeRunName(params.sport, startedAt),
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

/**
 * « Course du soir », « Vélo du matin » : vingt lignes « Sortie libre » ne se
 * distinguaient que par leur date. Le moment du départ suffit à les reconnaître,
 * et le nom se corrige toujours dans le détail de la sortie.
 */
export function freeRunName(sport, startedAt) {
  const h = new Date(startedAt).getHours()
  const moment = h < 5 ? 'de nuit' : h < 11 ? 'du matin' : h < 14 ? 'de midi' : h < 18 ? "de l'après-midi" : h < 22 ? 'du soir' : 'de nuit'
  return `${sport === 'bike' ? 'Vélo' : 'Course'} ${moment}`
}

/** L'entrée d'historique d'une sortie terminée. */
export function runEntry(stats, { route, free, sport }, params) {
  const base = free ? freeRunEntry({ ...params, sport }, Date.now() - (stats.elapsed || 0) * 1000) : slim(route)
  return {
    ...base,
    ranAt: new Date().toISOString(),
    actual_distance_m: Math.round(stats.distance),
    actual_duration_s: Math.round(stats.elapsed),
    actual_ascent_m: stats.ascent ?? null,
    // « baro » ou « gps » : un dénivelé au baromètre se compare au prévu, celui
    // du GPS beaucoup moins — l'écran le dit.
    actual_ascent_source: stats.ascent != null ? (stats.ascentSource ?? 'gps') : null,
    // Ce qu'on a réellement couru, allégé — voir `trail.js`.
    track: stats.trail?.length > 1 ? stats.trail : null,
    // Le temps de chaque kilomètre, et le temps passé à l'arrêt : relevés
    // pendant la sortie, impossibles à retrouver après coup.
    splits: stats.splits?.length ? stats.splits : null,
    paused_s: stats.pausedS || 0,
    // Ce que la voix a dit, phrase par phrase — voir `RunDetail.jsx`.
    spoken: stats.spoken?.length ? stats.spoken : null,
    rerouted: Boolean(stats.rerouted),
    // Terminée d'elle-même, en revenant au départ — voir `arrival.js`.
    arrived: Boolean(stats.arrived),
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
