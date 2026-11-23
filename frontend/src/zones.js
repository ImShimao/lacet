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

/** Toutes les zones, actives ou non, de la plus récente à la plus ancienne. */
export const listZones = () =>
  (load().zones || []).filter((z) => Number.isFinite(z?.lon) && Number.isFinite(z?.lat) && (!z.polygon || isRing(z.polygon)))

/** Ce que le moteur attend : les zones actives, en disques ou en contours. */
export const avoidedZones = () =>
  listZones()
    .filter((z) => z.on !== false)
    .map(({ lon, lat, radius_m, polygon }) => (polygon ? { polygon } : { lon, lat, radius_m }))

const defaultName = (reason) => (reason && reason !== 'other' ? `Zone ${ZONE_REASONS.find((r) => r.key === reason)?.label.toLowerCase()}` : 'Zone à éviter')

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
