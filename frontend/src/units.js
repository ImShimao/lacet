// Kilomètres ou miles, réglé dans « Mon compte › Apparence ».
//
// Tout ce que l'app garde et tout ce que le moteur calcule reste en mètres et en
// secondes par kilomètre : seul l'affichage change d'unité. Un historique ne se
// convertit donc jamais, et repasser en kilomètres ne perd rien.

const KEY = 'lacet.units'
export const MILE_M = 1609.344

/** « km » ou « mi ». */
export function units() {
  try {
    return localStorage.getItem(KEY) === 'mi' ? 'mi' : 'km'
  } catch {
    return 'km'
  }
}

export function setUnits(value) {
  try {
    localStorage.setItem(KEY, value === 'mi' ? 'mi' : 'km')
  } catch {
    // Sans stockage, l'app reste en kilomètres.
  }
}

/** La longueur d'une unité, en mètres. */
export const unitM = () => (units() === 'mi' ? MILE_M : 1000)
/** « km » ou « mi », à écrire après un nombre. */
export const unitLabel = () => units()
/** « /km » ou « /mi », après une allure. */
export const paceLabel = () => `/${units()}`
/** « km/h » ou « mph ». */
export const speedLabel = () => (units() === 'mi' ? 'mph' : 'km/h')
/** Une allure en secondes par kilomètre, ramenée à l'unité affichée. */
export const perUnit = (secondsPerKm) => (secondsPerKm * unitM()) / 1000
/** Une vitesse en km/h, ramenée à l'unité affichée. */
export const speedIn = (kmh) => (kmh * 1000) / unitM()
/** Des kilomètres (ce que garde la demande) dans l'unité affichée, et retour. */
export const fromKm = (kmValue) => (kmValue * 1000) / unitM()
export const toKm = (value) => (value * unitM()) / 1000
