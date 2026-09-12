// Persistance locale. En V1 tout tient dans le navigateur ; c'est ce que
// remplacera Postgres quand il y aura des comptes. Chaque accès est protégé :
// le stockage peut être refusé (navigation privée, réglages du navigateur) et
// l'app doit continuer de fonctionner sans.

const KEY = 'lacet.v1'

const DEFAULTS = { favorites: [], history: [], params: null }

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
    segments: (route.segments || []).map((s) => ({
      length_m: s.length_m,
      level: s.level,
      surface: s.surface,
      road: s.road,
    })),
    geometry: route.geometry,
    savedAt: new Date().toISOString(),
  }
}
