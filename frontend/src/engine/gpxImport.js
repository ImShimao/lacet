// Suivre un parcours venu d'ailleurs : la trace d'un ami, une course balisée,
// un tracé dessiné sur un autre site.
//
// Ce qu'on en fait est volontairement modeste. Le fichier donne une suite de
// points, rien d'autre : ni les rues qu'ils empruntent, ni les trottoirs, ni
// les traversées. **On ne note donc pas sa sécurité et on ne dicte pas ses
// virages** — les deux demanderaient de reconnaître chaque point sur notre
// réseau de rues, ce que nous ne faisons pas. L'app sait en revanche le
// dessiner, dire où l'on en est, prévenir quand on s'en écarte, et en mesurer
// le relief : c'est ce qu'on attend d'un parcours qu'on suit.
//
// Le format est du XML, et les fichiers du monde réel le prennent de haut :
// espaces de noms fantaisistes, extensions propriétaires, points sans altitude,
// segments multiples, virgules décimales. On lit donc au plus simple — les
// balises qu'on connaît, dans l'ordre où elles viennent — et on refuse
// clairement ce qui n'est pas lisible plutôt que de rendre une trace à moitié
// juste.

import { haversineM } from './geo'
import { pyRound } from './py'

/** Deux points plus proches que ça sont le même : un GPS à l'arrêt en produit des centaines. */
const SAME_POINT_M = 1

/** Au-delà, ce n'est plus une trace : c'est un fichier qui contient un voyage. */
const MAX_POINTS = 60_000

export class GpxError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GpxError'
  }
}

/**
 * Lit un fichier GPX : ses points, son nom, et ses altitudes si elles y sont.
 *
 * Accepte une trace (`trk`) comme un itinéraire (`rte`) : les montres écrivent
 * la première, les sites de tracé la seconde, et celui qui reçoit le fichier ne
 * sait pas laquelle il a. Les segments multiples d'une même trace sont mis bout
 * à bout — une pause longue coupe un segment sans couper le parcours.
 */
export function parseGpx(text, { name = null } = {}) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new GpxError("Ce fichier n'est pas un GPX lisible.")

  const points = [...doc.getElementsByTagName('trkpt')]
  const route = points.length ? points : [...doc.getElementsByTagName('rtept')]
  if (!route.length) throw new GpxError('Ce fichier ne contient aucun tracé.')
  if (route.length > MAX_POINTS) throw new GpxError('Ce fichier est trop gros pour être suivi.')

  const coords = []
  const elevations = []
  let manquantes = 0
  for (const node of route) {
    const lat = number(node.getAttribute('lat'))
    const lon = number(node.getAttribute('lon'))
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const dernier = coords[coords.length - 1]
    // Un GPS immobile écrit des centaines de points au même endroit : ils
    // n'ajoutent rien au tracé et alourdissent tout ce qui le parcourt.
    if (dernier && haversineM(dernier, [lon, lat]) < SAME_POINT_M) continue
    coords.push([lon, lat])
    const ele = number(node.getElementsByTagName('ele')[0]?.textContent)
    if (ele === null) manquantes += 1
    elevations.push(ele)
  }

  if (coords.length < 2) throw new GpxError('Ce fichier ne contient pas assez de points pour un parcours.')

  return {
    // Le nom du fichier vaut mieux que « Parcours » : c'est celui que la
    // personne a choisi en l'enregistrant.
    name: text_(doc, 'name') ?? name ?? 'Parcours importé',
    coords,
    // Tout ou rien : un profil à trous se lirait comme une descente en falaise.
    elevations: manquantes ? null : elevations,
  }
}

const number = (v) => {
  if (v === null || v === undefined) return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function text_(doc, tag) {
  const el = doc.getElementsByTagName(tag)[0]
  const value = el?.textContent?.trim()
  return value || null
}

/** La longueur d'une suite de points, en mètres. */
export function lengthOf(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) total += haversineM(coords[i - 1], coords[i])
  return total
}

/**
 * Le parcours importé, au format que l'app sait afficher et suivre.
 *
 * Un tracé que le moteur n'a pas calculé : pas de note, pas de traversées, un seul tronçon de niveau « inconnu » pour que la
 * carte ne le peigne pas en vert comme une voie protégée.
 */
export function toRoute({ name, coords, elevations }, { sport = 'run', secondsPerKm = 390 } = {}) {
  const distanceM = lengthOf(coords)
  const [ascent, descent] = elevations ? ascentOf(elevations) : [null, null]
  return {
    id: `gpx-${Math.trunc(distanceM)}-${Math.trunc(coords[0][0] * 1e4)}`,
    name,
    distance_m: pyRound(distanceM, 1),
    duration_s: Math.trunc((distanceM / 1000) * secondsPerKm),
    ascent_m: ascent === null ? null : pyRound(ascent, 1),
    descent_m: descent === null ? null : pyRound(descent, 1),
    geometry: coords,
    segments: [
      {
        coords,
        length_m: pyRound(distanceM, 1),
        risk: null,
        level: 'unknown',
        separation: null,
        speed_kmh: null,
        surface: 'unknown',
        lit: null,
        road: null,
        inferred: true,
      },
    ],
    crossings: [],
    elevation_profile: null,
    // Aucune consigne : les points ne disent pas les rues, et inventer des
    // virages sans nom serait pire que de se taire.
    instructions: [],
    safety: null,
    surfaces: { paved_m: 0, gravel_m: 0, trail_m: 0, unknown_m: pyRound(distanceM, 1) },
    roundness: null,
    bearing: 0,
    laps: 1,
    graded: false,
    imported: true,
    sport,
  }
}

/** D+ et D− d'un profil fourni par le fichier, avec le seuil des sources fines. */
function ascentOf(elevations, threshold = 2) {
  let ascent = 0
  let descent = 0
  let reference = elevations[0]
  for (const value of elevations.slice(1)) {
    const delta = value - reference
    if (delta >= threshold) {
      ascent += delta
      reference = value
    } else if (delta <= -threshold) {
      descent -= delta
      reference = value
    }
  }
  return [ascent, descent]
}
