// La trace de ce qu'on a réellement couru.
//
// Le parcours proposé est un plan ; la trace est ce qui s'est passé. Les deux
// diffèrent toujours un peu — un trottoir pris de l'autre côté, un détour par
// la boulangerie — et c'est la seconde qu'on veut revoir après coup, exporter
// vers sa montre, ou comparer au plan.
//
// Trois soins, tirés de ce que donne vraiment un GPS de téléphone :
//
// **On ne garde pas tout.** Un relevé par seconde sur une heure fait 3 600
// points, dont l'immense majorité sont alignés. Rangés tels quels, quelques
// sorties suffiraient à saturer le stockage du navigateur. On garde donc un
// point tous les huit mètres, plus tous ceux qui marquent un changement de
// direction (voir `simplify`).
//
// **L'altitude du GPS est du bruit.** Elle saute de cinq mètres d'un relevé à
// l'autre, immeuble ou pas. Additionner les écarts positifs donnerait des
// centaines de mètres de dénivelé sur un parcours plat. On lisse, puis on ne
// compte une montée qu'au-delà d'un seuil. Ce n'est plus qu'un repli : le
// dénivelé d'une sortie vient du baromètre (voir `LiveRun.jsx`) dès qu'il
// répond, et celui-ci ne sert qu'à un iPhone qui le refuse.
//
// **L'arrêt ne se trace pas.** En pause — à un feu, à la fontaine — le
// tremblement du GPS dessinerait une pelote de trois mètres de large.

// Distance minimale entre deux points gardés.
const KEEP_EVERY_M = 8
// Écart au segment au-delà duquel un point est gardé quoi qu'il arrive : c'est
// ce qui préserve les virages.
const CORNER_M = 4
// Ce qu'il faut monter, une fois l'altitude lissée, pour que ça compte.
const CLIMB_M = 3
// Au-delà de cette incertitude verticale annoncée par le GPS — sous les arbres,
// entre deux immeubles —, l'altitude du relevé n'est pas lue : elle ferait des
// bonds de vingt mètres que le lissage ne rattrape pas.
const ALTITUDE_ACCURACY_LIMIT_M = 15
// Lissage de l'altitude : moyenne mobile exponentielle.
const SMOOTH = 0.25

const RAD = Math.PI / 180

/** Distance en mètres entre deux points [lon, lat]. */
function metres(a, b) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD) * 111_320
  const ky = 110_540
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)
}

/**
 * Enregistre la trace d'une sortie, point par point.
 *
 * `push` ne retient un relevé que s'il apporte quelque chose ; `points` rend la
 * trace, `ascent` le dénivelé positif mesuré. `ascent` repart de `climbed` :
 * une sortie reprise après une coupure ne perd pas ses côtes d'avant.
 */
export function trailRecorder(initial = [], climbed = 0, { times: knownTimes, alts: knownAlts } = {}) {
  const points = initial.map((p) => [p[0], p[1]])
  // L'heure et l'altitude de chaque point gardé, rangées à part : la trace reste
  // une liste de [lon, lat], que la carte, le croquis et « déjà couru » lisent
  // tels quels. Sans elles, l'écran de fin ne pouvait ni colorier la trace par
  // allure ni dessiner ce qu'on avait réellement monté, et le GPX lissait
  // l'allure entre deux bornes.
  const times = points.map((_, i) => knownTimes?.[i] ?? null)
  const alts = points.map((_, i) => knownAlts?.[i] ?? null)
  let smoothed = null
  let reference = null
  let ascent = climbed || 0

  return {
    get points() {
      return points
    },
    get ascent() {
      return Math.round(ascent)
    },
    get times() {
      return times
    },
    get alts() {
      return alts
    },
    /** L'altitude lissée du GPS, ou `null` tant qu'il n'en a pas donné. */
    get altitude() {
      return smoothed
    },
    /**
     * Rend `true` si le point a été gardé. `t` : les secondes écoulées depuis le
     * départ, à l'horloge ; `alt` : une altitude plus sûre que celle du GPS — le
     * baromètre —, qui la remplace alors dans le profil.
     */
    push(point, altitude = null, altitudeAccuracy = null, { t = null, alt = null } = {}) {
      const trusted = !(altitudeAccuracy > ALTITUDE_ACCURACY_LIMIT_M)
      if (altitude !== null && Number.isFinite(altitude) && trusted) {
        smoothed = smoothed === null ? altitude : smoothed + SMOOTH * (altitude - smoothed)
        if (reference === null) reference = smoothed
        else if (smoothed - reference >= CLIMB_M) {
          ascent += smoothed - reference
          reference = smoothed
        } else if (smoothed < reference) {
          reference = smoothed
        }
      }
      const last = points[points.length - 1]
      if (last && metres(last, point) < KEEP_EVERY_M) return false
      points.push([point[0], point[1]])
      times.push(t)
      const kept = alt ?? smoothed
      alts.push(kept == null ? null : Math.round(kept * 10) / 10)
      return true
    },
  }
}

/**
 * Allège une trace sans la déformer : Douglas-Peucker, tolérance en mètres.
 *
 * Les longues lignes droites perdent leurs points intermédiaires, les virages
 * gardent les leurs — c'est exactement ce qu'on veut d'un tracé qu'on reverra
 * sur une carte.
 */
export function simplify(points, toleranceM = CORNER_M) {
  return keptIndices(points, toleranceM).map((i) => round5(points[i]))
}

/**
 * Les rangs des points que `simplify` garde : ce qui accompagne la trace —
 * l'heure et l'altitude de chaque point — s'allège avec elle, rang pour rang.
 */
export function keptIndices(points, toleranceM = CORNER_M) {
  if (!points || points.length < 3) return (points || []).map((_, i) => i)
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()
    let worst = 0
    let index = -1
    for (let i = from + 1; i < to; i += 1) {
      const gap = distanceToSegment(points[i], points[from], points[to])
      if (gap > worst) {
        worst = gap
        index = i
      }
    }
    if (index > 0 && worst > toleranceM) {
      keep[index] = 1
      stack.push([from, index], [index, to])
    }
  }

  const out = []
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(i)
  return out
}

/** Cinq décimales : le mètre. Au-delà, on stocke du bruit GPS. */
const round5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]

function distanceToSegment(p, a, b) {
  const kx = Math.cos(a[1] * RAD) * 111_320
  const ky = 110_540
  const px = (p[0] - a[0]) * kx
  const py = (p[1] - a[1]) * ky
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * ky
  const length = bx * bx + by * by
  const t = length > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / length)) : 0
  return Math.hypot(px - bx * t, py - by * t)
}
