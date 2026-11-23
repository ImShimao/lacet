// Les raccourcis sous la règle de l'accueil : 3, 5, 10, 15 km, ou 30, 45, 60,
// 90 min, réglés dans « Mon compte › Itinéraire ». La règle demande plusieurs
// gestes pour aller de 5 à 15 km ; la distance de tous les jours en mérite un
// seul (Roovr le fait, et c'est le geste le plus fréquent de l'app).
//
// Rangés dans l'unité affichée : en miles, « 3, 5, 10 » veut dire des miles, et
// c'est la demande qui les convertit en kilomètres.

const KEY = 'lacet.presets'
const MAX = 6

export const DEFAULT_PRESETS = {
  run: [3, 5, 10, 15],
  bike: [20, 40, 60, 100],
  duration: [30, 45, 60, 90],
}

function stored() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {}
  } catch {
    return {}
  }
}

/** Les raccourcis d'un genre : `run`, `bike` ou `duration`. */
export function presets(kind) {
  const list = stored()[kind]
  return Array.isArray(list) && list.length ? list : DEFAULT_PRESETS[kind]
}

export function setPresets(kind, list) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), [kind]: list }))
  } catch {
    // Sans stockage, les raccourcis par défaut restent.
  }
}

/**
 * « 3, 5 ; 10,5 15 » → [3, 5, 10.5, 15]. La virgule décimale française est
 * lue comme telle quand elle est collée à des chiffres des deux côtés ; le reste
 * (espaces, points-virgules, virgules suivies d'un espace) sépare. Rien de
 * valide : `null`, et l'appelant garde l'ancienne liste.
 */
export function parsePresets(text) {
  const numbers = String(text)
    .replace(/(\d),(\d)/g, '$1.$2')
    .split(/[\s,;]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
  const unique = [...new Set(numbers)].sort((a, b) => a - b).slice(0, MAX)
  return unique.length ? unique : null
}

/** La liste comme on la tape : « 3, 5, 10,5, 15 ». */
export const formatPresets = (list) => list.map((n) => String(n).replace('.', ',')).join(' · ')
