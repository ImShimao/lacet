// La pause automatique : s'arrêter à un feu ne doit ni gonfler le temps, ni
// ajouter de la distance.
//
// Sans elle, dix feux rouges ajoutaient quatre minutes à une sortie de dix
// kilomètres, et l'allure moyenne affichée perdait une demi-minute au
// kilomètre. Pire : immobile, le point GPS tremble de quelques mètres à chaque
// relevé, et ces tremblements s'additionnaient en distance parcourue.
//
// La difficulté est de ne jamais se tromper dans l'autre sens. Mettre en pause
// quelqu'un qui court fausse la sortie pour de bon ; rater une pause coûte
// quelques secondes. Tous les seuils penchent donc du même côté :
//
// - **l'arrêt se confirme sur huit secondes**, pas sur un relevé : un virage
//   serré ou une seconde d'hésitation ne suffisent pas ;
// - **marcher n'est pas s'arrêter.** Une côte avalée en marchant, à trois
//   kilomètres-heure, reste du mouvement : le seuil est sous l'allure du pas ;
// - **la reprise, elle, est immédiate** : deux relevés en mouvement, ou quinze
//   mètres loin du point d'arrêt, et le chrono repart.
//
// La vitesse que donne le téléphone est préférée quand elle existe : sur
// iPhone, elle est mesurée par effet Doppler et reste juste à l'arrêt, là où
// la position tremble. Sans elle (navigateurs), on juge sur les positions.

const STOP_WINDOW_MS = 8000
const STOP_SPEED = 0.5 // m/s — 1,8 km/h, bien sous l'allure du pas
const STOP_RADIUS_M = 6 // immobile : toutes les positions dans ce rayon…
const STOP_DRIFT_M = 4 // …et presque pas de dérive d'un bout à l'autre
const RESUME_SPEED = 1.2 // m/s — un pas décidé
const RESUME_DISTANCE_M = 15

/** Distance en mètres entre deux points [lon, lat] — assez précise à cette échelle. */
function metres(a, b) {
  const kx = Math.cos((a[1] * Math.PI) / 180) * 111320
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540)
}

function centroid(fixes) {
  let lon = 0
  let lat = 0
  for (const f of fixes) {
    lon += f.point[0]
    lat += f.point[1]
  }
  return [lon / fixes.length, lat / fixes.length]
}

const hasSpeed = (f) => Number.isFinite(f.speed) && f.speed >= 0

/**
 * Suit les relevés et dit quand on s'arrête, et quand on repart.
 *
 * `push({ t, point, speed })` rend `'stop'`, `'resume'` ou `null`. Seuls les
 * relevés assez précis doivent y entrer : un point à cinquante mètres près
 * ferait croire à un départ.
 */
export function motionTracker() {
  let fixes = []
  let stopped = false
  let anchor = null
  let since = null

  function detectStop(now) {
    // Pas encore huit secondes de relevés : on ne sait rien.
    if (now.t - fixes[0].t < STOP_WINDOW_MS - 500) return false
    if (fixes.every(hasSpeed)) {
      return fixes.every((f) => f.speed < STOP_SPEED) && metres(fixes[0].point, now.point) < STOP_RADIUS_M
    }
    const c = centroid(fixes)
    return (
      fixes.every((f) => metres(f.point, c) <= STOP_RADIUS_M) &&
      metres(fixes[0].point, now.point) <= STOP_DRIFT_M
    )
  }

  function detectResume(now) {
    const recent = fixes.slice(-2)
    const quick = recent.length === 2 && recent.every((f) => hasSpeed(f) && f.speed >= RESUME_SPEED)
    return quick || metres(anchor, now.point) >= RESUME_DISTANCE_M
  }

  return {
    get stopped() {
      return stopped
    },
    /** Le point où l'on s'est arrêté : la distance reprend de là. */
    get anchor() {
      return anchor
    },
    /** Quand l'arrêt a commencé — huit secondes avant qu'on en soit sûr. */
    get since() {
      return since
    },

    push(fix) {
      fixes.push(fix)
      // On garde juste de quoi couvrir la fenêtre : le relevé le plus ancien
      // qui la précède, et tout ce qui suit.
      while (fixes.length > 2 && fix.t - fixes[1].t >= STOP_WINDOW_MS) fixes.shift()

      if (!stopped) {
        if (!detectStop(fix)) return null
        stopped = true
        anchor = centroid(fixes)
        since = fixes[0].t
        return 'stop'
      }
      if (!detectResume(fix)) return null
      stopped = false
      anchor = null
      since = null
      // Une nouvelle fenêtre complète avant la prochaine pause : sans cela, les
      // secondes d'arrêt encore en mémoire remettaient en pause aussitôt reparti.
      fixes = [fix]
      return 'resume'
    },

    /** Oublie tout — après une pause à la main, par exemple. */
    reset() {
      fixes = []
      stopped = false
      anchor = null
      since = null
    },
  }
}
