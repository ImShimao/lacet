// Ce que la trace d'une sortie raconte, une fois qu'elle a ses heures et ses
// altitudes (`trail.js`) : où l'on a couru vite, où l'on a coulé, et ce qu'on a
// réellement monté. Rien ici ne dessine : ce sont des mesures, que l'écran de
// fin et l'image de partage mettent en forme.

import { haversine } from './format'

// L'allure d'un tronçon se lit sur deux cents mètres autour de lui : en dessous,
// c'est le tremblement du GPS qu'on colorie ; au-dessus, une côte de trois cents
// mètres disparaît dans la moyenne.
const WINDOW_M = 200
// Sous cette vitesse, on n'avance pas : un feu, une fontaine. Ces secondes-là ne
// font pas l'allure — sinon chaque carrefour serait peint en rouge.
const STOPPED_MS = 0.5
// Les cinq bandes, en écart à l'allure médiane de la sortie. Relatives à la
// médiane et non aux extrêmes : une sortie régulière reste d'une seule couleur,
// au lieu d'étirer deux secondes d'écart du vert au rouge.
const BANDS = [0.88, 0.96, 1.04, 1.12]

/**
 * La bande d'allure de chaque tronçon de la trace : 0 pour le plus rapide, 4
 * pour le plus lent, `null` quand l'heure manque. Rend `null` si la trace n'a
 * pas ses heures, ou trop peu pour en dire quelque chose.
 */
export function paceBands(track, times) {
  if (!(track?.length > 2) || times?.length !== track.length) return null
  const d = [0]
  for (let i = 1; i < track.length; i += 1) d.push(d[i - 1] + haversine(track[i - 1], track[i]))

  // Le temps et la distance de chaque tronçon parcouru en mouvement.
  const moving = track.map((_, i) => {
    if (i === 0) return null
    const [a, b] = [times[i - 1], times[i]]
    const metres = d[i] - d[i - 1]
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
    return metres / (b - a) >= STOPPED_MS ? { s: b - a, m: metres } : null
  })

  const paces = []
  let from = 1
  let to = 1
  for (let i = 1; i < track.length; i += 1) {
    const middle = (d[i - 1] + d[i]) / 2
    while (from < i && d[from] < middle - WINDOW_M / 2) from += 1
    while (to < track.length - 1 && d[to] < middle + WINDOW_M / 2) to += 1
    let s = 0
    let m = 0
    for (let j = from; j <= to; j += 1) {
      if (!moving[j]) continue
      s += moving[j].s
      m += moving[j].m
    }
    paces.push(m >= WINDOW_M / 4 ? s / m : null)
  }

  const known = paces.filter((p) => p !== null).sort((a, b) => a - b)
  if (known.length < paces.length / 2) return null
  const median = known[Math.floor(known.length / 2)]
  return paces.map((p) => (p === null ? null : BANDS.filter((limit) => p / median > limit).length))
}

// En dessous, ce n'est pas un profil : c'est le bruit de la mesure sur du plat.
const RELIEF_MIN_M = 5

/**
 * Le profil réellement monté, cadré dans `width` × `height` : la ligne, la
 * surface sous elle, le point bas et le point haut, et où est le sommet.
 * `null` sans assez d'altitudes, ou sur du plat.
 */
export function climbProfile(track, alts, width, height, pad = 4) {
  if (!(track?.length > 2) || alts?.length !== track.length) return null
  const points = []
  let along = 0
  for (let i = 0; i < track.length; i += 1) {
    if (i > 0) along += haversine(track[i - 1], track[i])
    if (Number.isFinite(alts[i])) points.push([along, alts[i]])
  }
  if (points.length < 10 || along <= 0) return null
  const low = Math.min(...points.map((p) => p[1]))
  const high = Math.max(...points.map((p) => p[1]))
  if (high - low < RELIEF_MIN_M) return null

  const x = (m) => Math.round((m / along) * width * 10) / 10
  const y = (alt) => Math.round((pad + (1 - (alt - low) / (high - low)) * (height - 2 * pad)) * 10) / 10
  const line = points.map(([m, alt]) => `${x(m)} ${y(alt)}`).join('L')
  const top = points.find((p) => p[1] === high)
  return {
    d: `M${line}`,
    area: `M${x(points[0][0])} ${height}L${line}L${x(points[points.length - 1][0])} ${height}Z`,
    low,
    high,
    // Par rapport au départ : le baromètre mesure des écarts, pas une altitude.
    gain: high - points[0][1],
    topM: top[0],
  }
}

// Une pente se lit sur cinquante mètres : en dessous, le bruit de l'altitude
// (un GPS qui tremble de un mètre) ferait passer du plat pour une côte.
const SLOPE_BLOCK_M = 50
// Au-delà de trois pour cent, on monte ou on descend ; en deçà, c'est du plat.
const SLOPE_FLAT = 0.03
// Une classe n'a son allure qu'avec deux cents mètres : sinon, la moyenne d'un
// tronçon de trente mètres dirait une allure qu'on n'a pas vraiment tenue.
const SLOPE_MIN_M = 200

/**
 * L'allure en montée, sur le plat et en descente : `{ up, flat, down }`, chacune
 * en secondes au kilomètre, ou `null` sans assez de tronçon de cette pente.
 * Rend `null` si la trace n'a ni ses heures ni ses altitudes.
 */
export function paceBySlope(track, times, alts) {
  if (!(track?.length > 2) || times?.length !== track.length || alts?.length !== track.length) return null
  const sum = { up: { s: 0, m: 0 }, flat: { s: 0, m: 0 }, down: { s: 0, m: 0 } }
  let m = 0
  let s = 0
  let dh = 0
  for (let i = 1; i < track.length; i += 1) {
    const [a, b] = [times[i - 1], times[i]]
    const metres = haversine(track[i - 1], track[i])
    const dt = b - a
    // Un arrêt ne se mesure pas en pente : feu, pause, attente.
    if (!Number.isFinite(a) || !Number.isFinite(b) || dt <= 0 || metres / dt < STOPPED_MS) continue
    if (!Number.isFinite(alts[i]) || !Number.isFinite(alts[i - 1])) continue
    m += metres
    s += dt
    dh += alts[i] - alts[i - 1]
    if (m < SLOPE_BLOCK_M) continue
    const grade = dh / m
    const key = grade >= SLOPE_FLAT ? 'up' : grade <= -SLOPE_FLAT ? 'down' : 'flat'
    sum[key].s += s
    sum[key].m += m
    m = 0
    s = 0
    dh = 0
  }
  const pace = (k) => (sum[k].m >= SLOPE_MIN_M ? (sum[k].s / sum[k].m) * 1000 : null)
  const out = { up: pace('up'), flat: pace('flat'), down: pace('down') }
  return out.up === null && out.flat === null && out.down === null ? null : out
}
