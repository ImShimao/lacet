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
import { paceLabel, unitLabel } from './units'

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
 * Le canevas au format voulu (la carte par défaut), ses couleurs (celles de
 * l'apparence choisie) et l'écriture de ses textes : commun à toutes les images.
 */
function painter(canvas, w = W, h = H) {
  canvas.width = w
  canvas.height = h
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
  // Une lueur de l'accent derrière la trace : sur un noir plat, la carte
  // ressemblait à une capture d'écran plutôt qu'à une image qu'on a envie
  // d'envoyer.
  const glow = ctx.createRadialGradient(W / 2, 470, 30, W / 2, 470, 720)
  glow.addColorStop(0, accent)
  glow.addColorStop(1, bg)
  ctx.globalAlpha = 0.22
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = 1
  write('Lacet', 80, 110, 46, accent, { weight: 700 })
  const day = new Date(entry.ranAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  write(day, W - 80, 110, 34, muted, { align: 'right' })

  // La trace, dans le tiers haut : le fond d'un trait, les allures par-dessus.
  drawTrace(ctx, entry, { x: 80, y: 150, w: 920, h: 640, width: 12, base: accent, dot: text, glow: true, shades: [safe, mix(safe, caution), caution, mix(caution, risk), risk] })

  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  write(km(distance), 80, 990, 190, text, { weight: 700 })
  const wide = ctx.measureText(km(distance)).width
  write(unitLabel(), 80 + wide + 24, 990, 64, muted)

  const figures = [
    [duration(seconds), 'Temps'],
    bike
      ? [(seconds > 0 ? (distance / seconds) * 3.6 : 0).toFixed(1).replace('.', ','), 'km/h']
      : [distance > 100 ? pace(seconds / (distance / 1000)) : '—', `Allure ${paceLabel()}`],
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

/**
 * La trace de `entry` dans le cadre `x, y, w, h` : un trait de fond, les
 * tronçons par allure par-dessus quand la trace a ses heures, un point au départ.
 * Rien sans trace.
 */
function drawTrace(ctx, entry, { x, y, w, h, width, base, dot, shades, glow = false }) {
  const drawn = sketch(entry.track, w, h, width * 2)
  if (!drawn) return
  ctx.save()
  ctx.translate(x, y)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = width
  ctx.strokeStyle = base
  // Un halo sous le trait, sur la carte seulement : les autocollants se posent
  // sur une photo, où il salirait le fond.
  if (glow) {
    ctx.shadowColor = base
    ctx.shadowBlur = width * 2.5
  }
  ctx.stroke(new Path2D(drawn.d))
  ctx.shadowBlur = 0
  const bands = paceBands(entry.track, entry.track_t)
  for (const part of bands ? bandPaths(drawn.points, bands) : []) {
    ctx.strokeStyle = shades[part.band]
    ctx.stroke(new Path2D(part.d))
  }
  ctx.fillStyle = dot
  ctx.beginPath()
  ctx.arc(drawn.start[0], drawn.start[1], width * 1.15, 0, 2 * Math.PI)
  ctx.fill()
  ctx.restore()
}

/** Les chiffres d'une sortie, `[valeur, libellé]`, dans l'ordre où on les lit. */
export function figuresOf(entry) {
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  return [
    [`${km(distance)} ${unitLabel()}`, 'Distance'],
    bike
      ? [`${(seconds > 0 ? (distance / seconds) * 3.6 : 0).toFixed(1).replace('.', ',')} km/h`, 'Vitesse']
      : [distance > 100 ? `${pace(seconds / (distance / 1000))} ${paceLabel()}` : '—', 'Allure'],
    [duration(seconds), 'Temps'],
    ...(entry.actual_ascent_m != null ? [[`${entry.actual_ascent_m} m`, 'Dénivelé +']] : []),
  ]
}

// Les autocollants : fond transparent, à poser sur une photo dans une story.
// Écrits en blanc avec une ombre douce — on ne sait pas sur quoi ils tomberont,
// et un texte clair sans ombre disparaît sur un ciel. Chacun est rogné à son
// contenu : collé dans Instagram, un grand cadre vide se placerait mal.
const WHITE = '#ffffff'
const SOFT = 'rgba(255, 255, 255, 0.78)'

function sticker(canvas, w, h) {
  const p = painter(canvas, w, h)
  p.ctx.clearRect(0, 0, w, h)
  p.ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  p.ctx.shadowBlur = 16
  p.ctx.shadowOffsetY = 2
  // Un tracé blanc et les allures aux couleurs de l'app : le vert, le jaune et
  // le rouge se lisent sur une photo, l'accent sombre de certains thèmes non.
  p.shades = [p.safe, mix(p.safe, p.caution), p.caution, mix(p.caution, p.risk), p.risk]
  return p
}

/** La trace en grand, la distance dessous, puis allure, temps et dénivelé. */
function drawTraceSticker(canvas, entry) {
  const S = 1080
  const { ctx, write, shades } = sticker(canvas, S, 1460)
  drawTrace(ctx, entry, { x: 60, y: 20, w: 960, h: 960, width: 16, base: WHITE, dot: WHITE, shades })
  const [first, ...rest] = figuresOf(entry)
  write(first[0], S / 2, 1170, 160, WHITE, { weight: 800, align: 'center' })
  write(rest.map(([v]) => v).join('   ·   '), S / 2, 1280, 50, WHITE, { weight: 600, align: 'center' })
  write('Lacet', S / 2, 1400, 44, WHITE, { weight: 800, align: 'center' })
  return canvas
}

/** Les chiffres empilés, libellé au-dessus de chaque valeur. */
function drawFiguresSticker(canvas, entry) {
  const figures = figuresOf(entry)
  const S = 900
  const step = 250
  const { write } = sticker(canvas, S, 120 + figures.length * step + 60)
  figures.forEach(([value, label], i) => {
    const top = 60 + i * step
    write(label, S / 2, top + 50, 40, SOFT, { weight: 600, align: 'center' })
    write(value, S / 2, top + 160, 108, WHITE, { weight: 800, align: 'center' })
  })
  write('Lacet', S / 2, 60 + figures.length * step + 60, 44, WHITE, { weight: 800, align: 'center' })
  return canvas
}

/** Un bandeau : les chiffres côte à côte, à glisser en bas d'une photo. */
function drawBandSticker(canvas, entry) {
  const figures = figuresOf(entry)
  const S = 1080
  const { ctx, write } = sticker(canvas, S, 360)
  write('Lacet', 50, 80, 44, WHITE, { weight: 800 })
  const day = new Date(entry.ranAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  write(day, S - 50, 80, 34, SOFT, { align: 'right' })
  ctx.fillStyle = SOFT
  ctx.fillRect(50, 116, S - 100, 3)
  const col = (S - 100) / figures.length
  // Une taille pour toutes les valeurs, la plus grande qui laisse la plus large
  // tenir dans sa colonne : à taille fixe, « 13,45 km » mordait sur l'allure.
  write('', 0, 0, 100, WHITE, { weight: 800 })
  const widest = Math.max(...figures.map(([value]) => ctx.measureText(value).width))
  const size = Math.min(76, Math.floor((100 * (col - 28)) / widest))
  figures.forEach(([value, label], i) => {
    write(value, 50 + i * col, 240, size, WHITE, { weight: 800 })
    write(label, 50 + i * col, 300, 32, SOFT, { weight: 600 })
  })
  return canvas
}

/** Le temps de chaque kilomètre en barres, le plus rapide en vert, comme sur l'écran de fin. */
function drawSplitsSticker(canvas, entry) {
  const splits = entry.splits
  const S = 1080
  const row = 62
  const top = 170
  const { ctx, write, safe } = sticker(canvas, S, top + splits.length * row + 110)
  write(entry.sport === 'bike' ? 'Temps au kilomètre' : 'Allure au kilomètre', 50, 90, 56, WHITE, { weight: 800 })
  const times = splits.map((s) => s.seconds)
  const [lo, hi] = [Math.min(...times), Math.max(...times)]
  const x0 = 140
  const span = S - 50 - 170 - x0
  splits.forEach((s, i) => {
    const y = top + i * row
    write(String(s.km), 110, y + 14, 36, SOFT, { weight: 600, align: 'right' })
    // Plus long = plus lent, comme sur l'écran : la barre la plus courte saute aux yeux.
    const len = span * (0.35 + 0.65 * ((s.seconds - lo) / (hi - lo || 1)))
    ctx.fillStyle = s.seconds === lo ? safe : WHITE
    ctx.beginPath()
    ctx.roundRect(x0, y - 12, len, 26, 13)
    ctx.fill()
    write(pace(s.seconds), S - 50, y + 14, 40, WHITE, { weight: 700, align: 'right' })
  })
  write('Lacet', 50, top + splits.length * row + 70, 44, WHITE, { weight: 800 })
  return canvas
}

/**
 * Les images qu'on peut partager pour cette sortie, la carte en premier : la
 * seule qui se lit seule, dans une conversation. Ce qui demande la trace ou les
 * temps au kilomètre n'est offert que si la sortie les a gardés.
 */
export function templatesFor(entry) {
  const track = entry.track?.length > 1
  const splits = entry.splits?.length > 1
  return [
    { key: 'card', label: 'Carte', clear: false, hint: 'Une image complète, à envoyer telle quelle.', draw: drawRunCard },
    track && { key: 'trace', label: 'Trace', clear: true, hint: 'Fond transparent : copie-la, puis colle-la sur une photo de ta story.', draw: drawTraceSticker },
    { key: 'figures', label: 'Chiffres', clear: true, hint: 'Fond transparent : tes chiffres, à poser sur une photo.', draw: drawFiguresSticker },
    { key: 'band', label: 'Bandeau', clear: true, hint: 'Fond transparent : une ligne à glisser en bas d’une photo.', draw: drawBandSticker },
    splits && { key: 'splits', label: 'Kilomètres', clear: true, hint: 'Fond transparent : ton allure à chaque kilomètre.', draw: drawSplitsSticker },
  ].filter(Boolean)
}

/** Ouvre la feuille de partage d'iOS sur une image `data:image/png`. */
export async function shareDataUrl(url, title) {
  const { shareImage } = await import('./native')
  await shareImage('lacet-sortie.png', url.split(',')[1], title)
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
    [summary.longest ? `${km(summary.longest.actual_distance_m, 1)} ${unitLabel()}` : '—', 'Plus longue'],
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
