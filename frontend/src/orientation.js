/**
 * Garder l'app en portrait, même téléphone couché.
 *
 * Aucun navigateur de téléphone ne laisse une page verrouiller son écran.
 * Android le fait pour l'app installée — le manifeste le demande — mais Safari
 * l'ignore, sur la page comme sur l'écran d'accueil. Alors quand le téléphone
 * se couche, c'est l'app qui tourne en sens inverse : elle reste dans le sens
 * du téléphone, comme si l'écran n'avait pas pivoté.
 *
 * Seul le **décor** tourne. La carte reste droite par rapport à l'écran et fait
 * pivoter son contenu (son cap, `bearing`) : MapLibre lit les gestes en
 * coordonnées d'écran, et une carte tournée en CSS partirait de travers sous le
 * doigt — glisser vers le haut la ferait défiler de côté.
 *
 * `data-turn` sur <html> porte l'angle à appliquer à l'app, en degrés CSS (sens
 * horaire) ; il est absent quand il n'y a rien à compenser.
 */

// Un téléphone couché : écran tactile, en paysage, de faible hauteur. Une
// tablette couchée a la place d'une vraie mise en page en largeur, et ne
// tourne pas.
const PHONE_LANDSCAPE = '(pointer: coarse) and (orientation: landscape) and (max-height: 560px)'

let turn = 0
const listeners = new Set()

/**
 * L'angle à appliquer à l'app pour annuler la rotation de l'écran.
 *
 * `screen.orientation.angle` — ou `window.orientation`, sur les Safari qui
 * n'ont que lui — vaut 90 quand le téléphone a pivoté dans le sens antihoraire :
 * le navigateur a redressé la page d'un quart de tour horaire, on la ramène
 * d'un quart de tour antihoraire. Et inversement à 270, que `window.orientation`
 * écrit −90.
 */
export function turnFor(angle, isPhoneLandscape) {
  if (!isPhoneLandscape) return 0
  const a = (((Number(angle) || 0) % 360) + 360) % 360
  if (a === 90) return -90
  if (a === 270) return 90
  return 0
}

function measure() {
  const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0
  return turnFor(angle, window.matchMedia(PHONE_LANDSCAPE).matches)
}

function apply() {
  const next = measure()
  if (next === turn) return
  turn = next
  const root = document.documentElement
  if (turn) root.dataset.turn = String(turn)
  else delete root.dataset.turn
  for (const fn of listeners) fn(turn)
}

export const currentTurn = () => turn

/** Prévient à chaque changement ; renvoie de quoi se désabonner. */
export function onTurn(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** À lancer avant le premier rendu, pour que l'app s'ouvre déjà dans le bon sens. */
export function startOrientationLock() {
  // Là où c'est permis — l'app installée sur Android —, le vrai verrou. Ailleurs
  // la promesse est rejetée, ou la fonction n'existe pas : on compense alors.
  try {
    window.screen?.orientation?.lock?.('portrait')?.catch?.(() => {})
  } catch {
    // Non pris en charge : la compensation prend le relais.
  }
  apply()
  window.screen?.orientation?.addEventListener?.('change', apply)
  window.addEventListener('orientationchange', apply)
  window.addEventListener('resize', apply)
}

/**
 * Où tombe un point de l'écran dans le repère d'un élément de l'app, de 0 à 1
 * sur chaque axe.
 *
 * Quand l'app est tournée, l'axe horizontal d'un élément court le long de la
 * verticale de l'écran : lire `clientX` seul désignerait un point faux — la
 * bande de profil allumerait un endroit sans rapport avec le doigt.
 */
export function localRatio(rect, t, clientX, clientY) {
  if (t === -90) {
    return { x: (rect.bottom - clientY) / rect.height, y: (clientX - rect.left) / rect.width }
  }
  if (t === 90) {
    return { x: (clientY - rect.top) / rect.height, y: (rect.right - clientX) / rect.width }
  }
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
}

/** Le déplacement vertical, dans le sens de l'app, d'un geste mesuré à l'écran. */
export function appDeltaY(t, dx, dy) {
  if (t === -90) return dx
  if (t === 90) return -dx
  return dy
}
