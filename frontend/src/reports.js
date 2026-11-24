// Ce qu'on a vu sur le terrain et qu'aucune carte ne dit.
//
// Une benne de chantier posée ce matin, le portail du parc fermé le soir, la
// passerelle en travaux : rien de tout cela n'est dans OpenStreetMap, et c'est
// pourtant ce qui fait faire un kilomètre pour rien puis demi-tour devant une
// grille. Un appui pendant la sortie suffit à le dire ; le point est gardé, et
// le routage passe ailleurs — tout de suite pour la fin de la sortie en cours
// (voir `LiveRun.jsx`), et pour toutes les boucles suivantes (`blocked.js`).
//
// **Ces signalements restent sur l'appareil.** Les partager demanderait un
// serveur et des comptes, que Lacet n'a pas ; et un signalement anonyme qu'on
// ne peut ni vérifier ni contredire barre des rues pour tout le monde sur la
// foi d'un appui. Ce qui est gardé ici est donc *ta* connaissance du terrain —
// celle qui vaut, parce que tu y étais.

import { load, save } from './storage'

import { t } from './i18n'
/**
 * Ce qu'on peut signaler.
 *
 * Les trois écartent le point de la même façon : la différence est ce qu'on
 * relit un mois plus tard dans « Mon compte », quand il faut décider si le
 * signalement tient toujours. « Travaux » se périme, « passage fermé » rarement.
 */
export const REPORT_KINDS = [
  { key: 'works', label: 'Travaux', icon: 'cone', spoken: 'Travaux signalés.' },
  { key: 'closed', label: 'Passage fermé', icon: 'close', spoken: 'Passage fermé, noté.' },
  { key: 'danger', label: 'Danger', icon: 'warning', spoken: 'Danger signalé.' },
]

const KEYS = new Set(REPORT_KINDS.map((k) => k.key))

// Six mois. Un chantier finit, une grille se rouvre, et un point gardé pour
// toujours interdirait une rue des années après la fin des travaux — sans que
// personne comprenne pourquoi la boucle du dimanche fait un crochet.
const LIFE_MS = 180 * 864e5

// Au-delà, ce n'est plus une connaissance du terrain mais une carte parallèle,
// et le tri des arêtes commencerait à se sentir au lancement d'une recherche.
const MAX = 200

/** Les signalements encore valables, du plus récent au plus ancien. */
export function activeReports(now = Date.now()) {
  return (load().reports || []).filter((r) => KEYS.has(r.kind) && now - r.at < LIFE_MS)
}

/** Ce que le moteur attend : des points, rien d'autre. */
export const blockedPoints = (now = Date.now()) => activeReports(now).map((r) => [r.lon, r.lat])

/**
 * Garde un signalement. Rend la liste à jour.
 *
 * Le point est celui où l'on se trouve, pas celui de l'obstacle : on signale
 * en arrivant devant, à quelques mètres. C'est assez près pour que la rue
 * barrée soit écartée (voir `BLOCK_RADIUS_M`), et personne ne va viser une
 * barrière sur une carte en courant.
 */
export function addReport({ lon, lat, kind, note = '' }, now = Date.now()) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !KEYS.has(kind)) return activeReports(now)
  const entry = { id: `r${now}`, lon, lat, kind, note, at: now }
  const next = [entry, ...activeReports(now)].slice(0, MAX)
  save({ reports: next })
  return next
}

/** Retire un signalement — la rue a rouvert, ou l'appui était de trop. */
export function removeReport(id) {
  const next = activeReports().filter((r) => r.id !== id)
  save({ reports: next })
  return next
}

/** Le libellé d'un genre de signalement. */
export const kindLabel = (kind) => t(REPORT_KINDS.find((k) => k.key === kind)?.label ?? 'Signalement')
