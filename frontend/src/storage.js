// Persistance locale. En V1 tout tient dans le navigateur ; c'est ce que
// remplacera Postgres quand il y aura des comptes. Chaque accès est protégé :
// le stockage peut être refusé (navigation privée, réglages du navigateur) et
// l'app doit continuer de fonctionner sans.

import { haversineM } from './engine/geo'

const KEY = 'lacet.v1'

const DEFAULTS = { favorites: [], history: [], params: null, recentPlaces: [], reports: [] }

// Assez pour retrouver chez soi, le travail, le coin du dimanche et deux
// endroits de vacances. Au-delà, la liste demanderait à être lue.
const RECENT_MAX = 5
// Deux départs à moins de ça sont le même endroit : on ne garde pas deux fois
// la même place de village parce qu'on a cliqué à trois mètres près.
const SAME_START_M = 200

/**
 * Se souvenir d'un départ choisi.
 *
 * On revient courir aux mêmes endroits, et on retapait le même nom à chaque
 * fois — parfois sans réseau, là où la recherche ne répond pas. Ce qui est
 * gardé tient en quatre nombres et deux mots : de quoi repartir d'un geste.
 */
export function rememberPlace(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
  const kept = {
    label: place.label || place.short || '',
    sub: place.sub || '',
    lat: place.lat,
    lon: place.lon,
    at: Date.now(),
  }
  if (!kept.label) return
  const others = (load().recentPlaces || []).filter(
    (other) => haversineM([other.lon, other.lat], [kept.lon, kept.lat]) > SAME_START_M,
  )
  save({ recentPlaces: [kept, ...others].slice(0, RECENT_MAX) })
}

/** Les départs déjà choisis, du plus récent au plus ancien. */
export const recentPlaces = () => load().recentPlaces || []


export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Écrit dans le stockage local, en faisant de la place si nécessaire.
 *
 * Le quota du navigateur (~5 Mo) finit par être atteint : chaque parcours
 * conservé pèse quelques dizaines de kilooctets, et l'historique s'accumule.
 * Échouer en silence ferait disparaître un favori sans que personne le sache —
 * on préfère sacrifier les sorties les plus anciennes, qui ont le moins de
 * valeur, et prévenir seulement si même ça ne suffit pas.
 */
export function save(patch) {
  let next = { ...load(), ...patch }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    } catch {
      const history = next.history || []
      if (history.length <= 5) break
      next = { ...next, history: history.slice(0, Math.floor(history.length / 2)) }
    }
  }

  console.warn('Lacet — stockage local saturé, la dernière modification n’a pas été gardée.')
  return load()
}

/**
 * Version allégée d'un itinéraire, pour le stockage local.
 *
 * On garde tout ce qui se lit — profil, sécurité, revêtements — mais **pas les
 * coordonnées de chaque tronçon** : sur un parcours de 10 km elles pèsent à
 * elles seules plusieurs centaines de kilooctets, et quelques favoris
 * suffiraient à saturer le stockage du navigateur. Conséquence assumée : un
 * parcours rouvert depuis les favoris s'affiche d'un seul tenant sur la carte
 * au lieu d'être colorié tronçon par tronçon. Le détail, lui, reste complet.
 */
export function slim(route) {
  return {
    id: route.id,
    name: route.name,
    distance_m: route.distance_m,
    duration_s: route.duration_s,
    ascent_m: route.ascent_m,
    descent_m: route.descent_m,
    grade: route.safety?.grade ?? null,
    safety: route.safety,
    surfaces: route.surfaces,
    crossings: route.crossings,
    elevation_profile: route.elevation_profile,
    // Les consignes sont gardées : sans elles, un favori relancé perd le
    // guidage vocal, et l'écran reste sur « en attente du signal GPS » sans
    // jamais rien dire. Elles pèsent quelques kilooctets, contre plusieurs
    // centaines pour la géométrie — que l'on garde déjà.
    instructions: route.instructions,
    direction: route.direction,
    bearing: route.bearing,
    shape: route.shape,
    roundness: route.roundness,
    // Un parcours à tours oublié en favori devenait une boucle simple : plus de
    // compteur de tours pendant la sortie, et une longueur de tour absente de
    // la carte. Deux nombres suffisent à le restituer.
    laps: route.laps ?? 1,
    lap_distance_m: route.lap_distance_m ?? route.distance_m,
    segments: (route.segments || []).map((s) => ({
      length_m: s.length_m,
      level: s.level,
      surface: s.surface,
      road: s.road,
    })),
    geometry: route.geometry,
    // Un parcours venu d'un fichier ne sera jamais noté : le rouvrir doit le
    // dire, sinon l'absence de note passerait pour un calcul qui a échoué.
    imported: route.imported || undefined,
    savedAt: new Date().toISOString(),
  }
}

/**
 * Toutes les données locales, en un fichier.
 *
 * Elles ne vivent que dans cet appareil : supprimer l'app — ce que demande
 * parfois une réinstallation — les emporte. Une sauvegarde à soi, qu'on garde
 * où l'on veut, évite d'avoir à choisir entre réinstaller et garder ses
 * parcours.
 */
export function exportAll() {
  const data = load()
  return JSON.stringify({ app: 'lacet', v: 1, savedAt: new Date().toISOString(), data }, null, 2)
}

/**
 * Remet une sauvegarde en place. Rend le nombre de parcours et de sorties
 * retrouvés, ou lève si le fichier n'en est pas une.
 *
 * Les listes sont **fusionnées**, pas remplacées : restaurer après avoir
 * recouru ne doit pas effacer les sorties faites entre-temps.
 */
export function importAll(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde Lacet.")
  }
  const data = parsed?.app === 'lacet' ? parsed.data : null
  if (!data || typeof data !== 'object') throw new Error("Ce fichier n'est pas une sauvegarde Lacet.")

  const current = load()
  const merge = (mine, theirs, key) => {
    const out = [...(theirs || [])]
    const seen = new Set(out.map(key))
    for (const item of mine || []) {
      if (!seen.has(key(item))) out.push(item)
    }
    return out
  }
  const favorites = merge(current.favorites, data.favorites, (r) => `${r.id}|${r.distance_m}`)
  const history = merge(current.history, data.history, (r) => r.ranAt || `${r.id}`)
  const reports = merge(current.reports, data.reports, (r) => r.id)
  history.sort((a, b) => String(b.ranAt || '').localeCompare(String(a.ranAt || '')))

  save({ ...data, favorites: favorites.slice(0, 40), history: history.slice(0, 200), reports: reports.slice(0, 200) })
  return { favorites: favorites.length, history: history.length }
}

