// Ce que l'écran de course écrit et ce que la voix dit : des chiffres mis en
// forme pour être lus d'un coup d'œil, ou entendus en courant.

/** L'allure demandée au moteur, en secondes par kilomètre. */
export function plannedPerKm(request, bike) {
  if (!request) return 0
  if (bike || request.speed_kmh) return request.speed_kmh ? 3600 / request.speed_kmh : 0
  return request.pace_sec_per_km || 0
}

/** « 42 min », « 1 h 05 » — jamais « 1:05:00 », qu'on lit comme un chrono. */
export function minutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** L'heure qu'il sera, dans l'écriture du téléphone. */
export const clockTime = (at) =>
  new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** « 120 m », « 1,4 km » : la distance du prochain virage, arrondie pour l'œil. */
export function roundedDistance(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1).replace('.', ',')} km`
  return `${Math.round(metres / 10) * 10} m`
}

/** Le pictogramme d'une manœuvre. */
export function turnIcon(turn) {
  if (turn === 'finish') return 'flag'
  if (turn === 'lap') return 'refresh'
  if (turn === 'start') return 'navigation'
  if (turn === 'uturn') return 'uturn'
  if (turn.includes('left')) return 'turnLeft'
  if (turn.includes('right')) return 'turnRight'
  return 'straight'
}

/** « 00:12:07 » : le chrono de course, comme sur une montre. */
export function clock(seconds) {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

/** « 11,4 » km/h. */
export function speed(metres, seconds) {
  if (metres < 50 || seconds <= 0) return '—'
  return ((metres / seconds) * 3.6).toFixed(1).replace('.', ',')
}

/** « 5 minutes 30 » — la synthèse vocale lit « 5:30 » comme une heure. */
export function spoken(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return 'inconnue'
  // Arrondi d'abord, découpage ensuite : sinon on annonce « 4 minutes 60 ».
  const total = Math.round(secondsPerKm)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (!m) return `${s} secondes`
  const whole = m > 1 ? `${m} minutes` : '1 minute'
  return s ? `${whole} ${s}` : whole
}

const UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

/** Un nombre de 1 à 999 en toutes lettres, à l'ancienne : « vingt et un », « quatre-vingts ». */
function cardinal(n) {
  if (n >= 100) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    const head = hundreds > 1 ? `${UNITS[hundreds]} cent${rest ? '' : 's'}` : 'cent'
    return rest ? `${head} ${cardinal(rest)}` : head
  }
  if (n <= 16) return UNITS[n]
  if (n < 20) return `dix-${UNITS[n - 10]}`
  // Soixante-dix et quatre-vingt-dix se comptent sur la dizaine d'avant.
  const ten = n < 70 ? Math.floor(n / 10) : n < 80 ? 6 : 8
  const unit = n - (ten === 8 ? 80 : ten * 10)
  const word = ten === 8 ? 'quatre-vingt' : TENS[ten]
  if (!unit) return ten === 8 ? 'quatre-vingts' : word
  if ((unit === 1 || unit === 11) && ten < 8) return `${word} et ${cardinal(unit)}`
  return `${word}-${cardinal(unit)}`
}

/**
 * « premier », « troisième », « vingt et unième » — un rang dit en toutes
 * lettres.
 *
 * La synthèse vocale lit « 3e » comme « trois e » selon la voix choisie : les
 * mots, eux, se prononcent toujours.
 */
export function ordinal(n) {
  if (!Number.isInteger(n) || n < 1 || n > 999) return `${n}e`
  if (n === 1) return 'premier'
  // « quatre-vingts » et « deux cents » perdent leur s : « quatre-vingtième ».
  const word = cardinal(n).replace(/(vingt|cent)s$/, '$1')
  if (word.endsWith('cinq')) return `${word}uième`
  if (word.endsWith('neuf')) return `${word.slice(0, -1)}vième`
  if (word.endsWith('e')) return `${word.slice(0, -1)}ième`
  return `${word}ième`
}

/** « 24,5 kilomètres-heure ». */
export function spokenSpeed(kmh) {
  if (!Number.isFinite(kmh) || kmh <= 0) return 'inconnue'
  return `${String(Math.round(kmh * 10) / 10).replace('.', ',')} kilomètres-heure`
}

export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)
