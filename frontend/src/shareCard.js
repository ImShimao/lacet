// La sortie en image, pour la partager.
//
// Le partage n'envoyait qu'une ligne de texte — « 8,3 km en 48:10 » —, que
// personne ne regarde dans une conversation. Une sortie se montre : sa trace,
// coloriée par allure, et ses trois chiffres. L'image est dessinée ici, sur
// l'appareil, aux couleurs de l'apparence choisie ; rien ne part ailleurs que
// là où la feuille de partage d'iOS l'envoie.

import { duration, km, pace } from './format'
import { bandPaths, sketch } from './routeDraw'
import { paceBands } from './runTrace'

// Le format portrait des réseaux et des messageries : il occupe l'écran d'un
// téléphone sans être rogné.
const W = 1080
const H = 1350

/** Le milieu de deux couleurs « #rrggbb » ; la première si l'une n'en est pas une. */
function mix(a, b) {
  const hex = /^#[0-9a-f]{6}$/i
  if (!hex.test(a) || !hex.test(b)) return a
  const part = (i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2)
  return `#${[1, 3, 5].map((i) => part(i).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Le canevas au format de la carte, ses couleurs (celles de l'apparence choisie)
 * et l'écriture de ses textes : commun à la carte d'une sortie et à celle du bilan.
 */
function painter(canvas) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const css = getComputedStyle(document.documentElement)
  const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  const write = (words, x, y, size, fill, { weight = 600, align = 'left' } = {}) => {
    ctx.font = `${weight} ${size}px ${family}`
    ctx.fillStyle = fill
    ctx.textAlign = align
    ctx.fillText(words, x, y)
  }
  return {
    ctx,
    write,
    bg: color('--bg', '#0b0d10'),
    text: color('--text', '#f3f5f7'),
    muted: color('--text-3', '#8b949e'),
    accent: color('--accent', '#2f6bff'),
    safe: color('--safe', '#2ed38a'),
    caution: color('--caution', '#ffd426'),
    risk: color('--risk', '#ff5c57'),
  }
}

/** Dessine la carte de la sortie sur `canvas`. `verdict` : la phrase de l'écran de fin, s'il y en a une. */
export function drawRunCard(canvas, entry, verdict = null) {
  const { ctx, write, bg, text, muted, accent, safe, caution, risk } = painter(canvas)

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  write('Lacet', 80, 110, 46, accent, { weight: 700 })
  const day = new Date(entry.ranAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  write(day, W - 80, 110, 34, muted, { align: 'right' })

  // La trace, dans le tiers haut : le fond d'un trait, les allures par-dessus.
  const drawn = sketch(entry.track, 920, 640, 20)
  if (drawn) {
    ctx.save()
    ctx.translate(80, 150)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 12
    ctx.strokeStyle = accent
    ctx.stroke(new Path2D(drawn.d))
    const bands = paceBands(entry.track, entry.track_t)
    const shades = [safe, mix(safe, caution), caution, mix(caution, risk), risk]
    for (const part of bands ? bandPaths(drawn.points, bands) : []) {
      ctx.strokeStyle = shades[part.band]
      ctx.stroke(new Path2D(part.d))
    }
    ctx.fillStyle = text
    ctx.beginPath()
    ctx.arc(drawn.start[0], drawn.start[1], 14, 0, 2 * Math.PI)
    ctx.fill()
    ctx.restore()
  }

  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  write(km(distance), 80, 990, 190, text, { weight: 700 })
  const wide = ctx.measureText(km(distance)).width
  write('km', 80 + wide + 24, 990, 64, muted)

  const figures = [
    [duration(seconds), 'Temps'],
    bike
      ? [(seconds > 0 ? (distance / seconds) * 3.6 : 0).toFixed(1).replace('.', ','), 'km/h']
      : [distance > 100 ? pace(seconds / (distance / 1000)) : '—', 'Allure /km'],
    [entry.actual_ascent_m != null ? `${entry.actual_ascent_m} m` : '—', 'Dénivelé +'],
  ]
  figures.forEach(([value, label], i) => {
    write(value, 80 + i * 320, 1120, 68, text, { weight: 700 })
    write(label, 80 + i * 320, 1168, 30, muted)
  })

  write(String(entry.name || 'Sortie').slice(0, 44), 80, 1256, 38, text)
  if (verdict) write(verdict.slice(0, 52), 80, 1308, 34, accent)
  return canvas
}

/** Dessine la carte et ouvre la feuille de partage d'iOS. Lève si l'image ne se fait pas. */
export async function shareRunCard(entry, verdict) {
  const canvas = drawRunCard(document.createElement('canvas'), entry, verdict)
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const { shareImage } = await import('./native')
  await shareImage('lacet-sortie.png', base64, entry.name || 'Ma sortie')
}

/** Le bilan d'un mois sur `canvas` : ses chiffres, sans trace (un mois n'en a pas une). `summary` : `monthSummary`. */
export function drawMonthCard(canvas, summary, label) {
  const { ctx, write, bg, text, muted, accent } = painter(canvas)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  write('Lacet', 80, 110, 46, accent, { weight: 700 })
  write(label, W - 80, 110, 34, muted, { align: 'right' })
  write('Bilan du mois', 80, 300, 56, muted)

  write(km(summary.distance_m), 80, 620, 190, text, { weight: 700 })
  const wide = ctx.measureText(km(summary.distance_m)).width
  write('km', 80 + wide + 24, 620, 64, muted)

  const figures = [
    [String(summary.count), summary.count > 1 ? 'sorties' : 'sortie'],
    [summary.ascent_m != null ? `${summary.ascent_m} m` : '—', 'Dénivelé +'],
    [summary.longest ? `${km(summary.longest.actual_distance_m, 1)} km` : '—', 'Plus longue'],
  ]
  figures.forEach(([value, lib], i) => {
    write(value, 80 + i * 320, 820, 68, text, { weight: 700 })
    write(lib, 80 + i * 320, 868, 30, muted)
  })
  const { active, total } = summary.weeks
  write(`${active} semaine${active > 1 ? 's' : ''} sur ${total} avec une sortie`, 80, 1000, 40, accent)
  return canvas
}

/** Dessine le bilan et ouvre la feuille de partage d'iOS. Lève si l'image ne se fait pas. */
export async function shareMonthCard(summary, label) {
  const canvas = drawMonthCard(document.createElement('canvas'), summary, label)
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const { shareImage } = await import('./native')
  await shareImage('lacet-bilan.png', base64, `Bilan ${label}`)
}
