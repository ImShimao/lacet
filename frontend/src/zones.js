// Les zones à éviter : un quartier, une forêt de chasse, un chantier qui dure.
//
// Un signalement (`reports.js`) dit « cette rue-ci est barrée », fait en
// courant ; une zone dit « pas par là du tout », posée à tête reposée sur la
// carte. Le moteur les traite de la même façon — leurs rues pèsent comme un mur,
// voir `engine/blocked.js` — et elles restent, comme eux, sur l'appareil.
//
// **Un cercle, ou un contour posé point par point — jamais tracé au doigt.**
// Sur une carte plein écran, le doigt qui trace se bat avec le doigt qui
// déplace la carte : il faudrait un mode qui fige la carte, puis un tracé qu'on
// ne peut plus corriger qu'en recommençant. Un centre qu'on touche et un rayon
// au curseur se posent du premier coup. Le contour, lui, se pose toucher par
// toucher, la carte restant libre entre deux : un bois en longueur ou un
// quartier entre deux avenues, qu'un cercle déborderait (RunnrZ propose les
// deux).
//
// Contrairement aux signalements, une zone ne se périme pas : on l'a dessinée
// exprès. On la désactive le temps de la saison de chasse, plutôt que de la
// voir disparaître et devoir la redessiner.

import { load, save } from './storage'

import { t } from './i18n'
/** Les bornes du curseur de rayon, en mètres. */
export const ZONE_RADIUS = { min: 100, max: 2000, step: 50, initial: 300 }

// Au-delà, la carte serait plus hachurée que lisible, et le tri des arêtes se
// sentirait au lancement de chaque recherche.
const MAX = 30

/** Pourquoi on évite une zone : le nom par défaut, et ce que dit la liste. */
export const ZONE_REASONS = [
  { key: 'danger', label: 'Dangereuse', icon: 'warning' },
  { key: 'works', label: 'Travaux', icon: 'cone' },
  { key: 'private', label: 'Privé', icon: 'lock' },
  { key: 'impassable', label: 'Impraticable', icon: 'ban' },
  { key: 'other', label: 'Autre', icon: 'more' },
]

const isRing = (p) => Array.isArray(p) && p.length >= 3 && p.every((c) => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]))

/**
 * Les coins d'un contour, démêlés. Reliés dans l'ordre où on les touche, douze
 * points posés en désordre donnaient une étoile de traits croisés, et une
 * surface que le moteur aurait lue à moitié trouée. Les ranger par angle autour
 * du centre supprimait les croisements, mais refermait en éventail une forme
 * en creux, un L ou un bois en croissant. Ici, l'ordre des touchers est gardé,
 * et chaque paire de côtés qui se croisent est décroisée en retournant le
 * morceau entre eux (« 2-opt ») : le contour raccourcit à chaque fois, donc
 * la boucle s'arrête, et une forme déjà propre ne bouge pas.
 */
export function ringOf(points) {
  if (!Array.isArray(points) || points.length < 4) return points
  const ring = [...points]
  const n = ring.length
  // Les degrés de longitude rétrécissent avec la latitude : sans ce facteur,
  // les croisements seraient jugés sur une carte étirée.
  const k = Math.cos((ring.reduce((s, p) => s + p[1], 0) / n) * (Math.PI / 180))
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * k * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) * k)
  const cross = (a, b, c, d) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
  for (let pass = 0, changed = true; changed && pass < n * n; pass++) {
    changed = false
    for (let i = 0; i < n - 2 && !changed; i++) {
      for (let j = i + 2; j < n && !changed; j++) {
        if (i === 0 && j === n - 1) continue
        if (cross(ring[i], ring[i + 1], ring[j], ring[(j + 1) % n])) {
          // Retourner les coins de i+1 à j décroise ces deux côtés.
          ring.splice(i + 1, j - i, ...ring.slice(i + 1, j + 1).reverse())
          changed = true
        }
      }
    }
  }
  return ring
}

/** Toutes les zones, actives ou non, de la plus récente à la plus ancienne. */
export const listZones = () =>
  (load().zones || []).filter((z) => Number.isFinite(z?.lon) && Number.isFinite(z?.lat) && (!z.polygon || isRing(z.polygon)))

/** Ce que le moteur attend : les zones actives, en disques ou en contours. */
export const avoidedZones = () =>
  listZones()
    .filter((z) => z.on !== false)
    .map(({ lon, lat, radius_m, polygon }) => (polygon ? { polygon } : { lon, lat, radius_m }))

const defaultName = (reason) => (reason && reason !== 'other' ? t('Zone {v1}', { v1: ZONE_REASONS.find((r) => r.key === reason)?.label.toLowerCase() }) : t('Zone à éviter'))

const keep = (zones) => {
  save({ zones })
  return zones
}

/** Garde une zone. Rend la liste à jour. */
export function addZone({ lon, lat, radius_m, polygon = null, reason = null, name = '' }, now = Date.now()) {
  const base = { id: `z${now}`, name: name.trim().slice(0, 60) || defaultName(reason), on: true, at: now, ...(reason ? { reason } : {}) }
  if (polygon) {
    if (!isRing(polygon)) return listZones()
    // Le centre garde un repère pour la liste et le tri : la moyenne des sommets.
    const center = polygon.reduce((s, [x, y]) => [s[0] + x / polygon.length, s[1] + y / polygon.length], [0, 0])
    return keep([{ ...base, lon: center[0], lat: center[1], polygon: polygon.slice(0, 64) }, ...listZones()].slice(0, MAX))
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return listZones()
  const radius = Math.min(ZONE_RADIUS.max, Math.max(ZONE_RADIUS.min, Math.round(radius_m) || ZONE_RADIUS.initial))
  return keep([{ ...base, lon, lat, radius_m: radius }, ...listZones()].slice(0, MAX))
}

/** Renomme, active ou désactive une zone. */
export function updateZone(id, patch) {
  return keep(
    listZones().map((z) => {
      if (z.id !== id) return z
      const next = { ...z, ...patch }
      // Un nom vidé redevient le nom par défaut, plutôt qu'une ligne vide dans la liste.
      if ('name' in patch) next.name = String(patch.name).trim().slice(0, 60) || defaultName(z.reason)
      return next
    }),
  )
}

/** Supprime une zone. */
export const removeZone = (id) => keep(listZones().filter((z) => z.id !== id))
