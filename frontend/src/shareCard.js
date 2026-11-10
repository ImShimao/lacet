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

/** Dessine la carte de la sortie sur `canvas`. `verdict` : la phrase de l'écran de fin, s'il y en a une. */
export function drawRunCard(canvas, entry, verdict = null) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const css = getComputedStyle(document.documentElement)
  const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback
  const [bg, text, muted, accent] = [color('--bg', '#0b0d10'), color('--text', '#f3f5f7'), color('--text-3', '#8b949e'), color('--accent', '#2f6bff')]
  const [safe, caution, risk] = [color('--safe', '#2ed38a'), color('--caution', '#ffd426'), color('--risk', '#ff5c57')]
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  const write = (words, x, y, size, fill, { weight = 600, align = 'left' } = {}) => {
    ctx.font = `${weight} ${size}px ${family}`
    ctx.fillStyle = fill
    ctx.textAlign = align
    ctx.fillText(words, x, y)
  }

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
