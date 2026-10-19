// Les zones à éviter : un quartier, une forêt de chasse, un chantier qui dure.
//
// Un signalement (`reports.js`) dit « cette rue-ci est barrée », fait en
// courant ; une zone dit « pas par là du tout », posée à tête reposée sur la
// carte. Le moteur les traite de la même façon — leurs rues pèsent comme un mur,
// voir `engine/blocked.js` — et elles restent, comme eux, sur l'appareil.
//
// **Un cercle, pas un contour tracé au doigt.** Sur une carte plein écran, le
// doigt qui trace se bat avec le doigt qui déplace la carte : il faudrait un
// mode qui fige la carte, puis un tracé qu'on ne peut plus corriger qu'en
// recommençant. Un centre qu'on touche et un rayon au curseur se posent du
// premier coup, se corrigent d'un geste, et couvrent ce qu'on veut éviter — un
// quartier, un bois — à quelques rues près.
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

/** Toutes les zones, actives ou non, de la plus récente à la plus ancienne. */
export const listZones = () => (load().zones || []).filter((z) => Number.isFinite(z?.lon) && Number.isFinite(z?.lat))

/** Ce que le moteur attend : les zones actives, en disques. */
export const avoidedZones = () =>
  listZones()
    .filter((z) => z.on !== false)
    .map(({ lon, lat, radius_m }) => ({ lon, lat, radius_m }))

const keep = (zones) => {
  save({ zones })
  return zones
}

/** Garde une zone. Rend la liste à jour. */
export function addZone({ lon, lat, radius_m, name = '' }, now = Date.now()) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return listZones()
  const radius = Math.min(ZONE_RADIUS.max, Math.max(ZONE_RADIUS.min, Math.round(radius_m) || ZONE_RADIUS.initial))
  const entry = { id: `z${now}`, lon, lat, radius_m: radius, name: name.trim().slice(0, 60) || 'Zone à éviter', on: true, at: now }
  return keep([entry, ...listZones()].slice(0, MAX))
}

/** Renomme, active ou désactive une zone. */
export function updateZone(id, patch) {
  return keep(
    listZones().map((z) => {
      if (z.id !== id) return z
      const next = { ...z, ...patch }
      // Un nom vidé redevient le nom par défaut, plutôt qu'une ligne vide dans la liste.
      if ('name' in patch) next.name = String(patch.name).trim().slice(0, 60) || 'Zone à éviter'
      return next
    }),
  )
}

/** Supprime une zone. */
export const removeZone = (id) => keep(listZones().filter((z) => z.id !== id))
