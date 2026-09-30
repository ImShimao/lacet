// Ce que l'interface demande au moteur, et ce qu'elle dit quand ça échoue.
//
// Il n'y a plus de serveur : les itinéraires se calculent sur l'appareil
// (`engine/`), et les seuls appels réseau restants partent directement vers les
// services publics — OpenStreetMap, l'altitude de l'IGN, la météo, la recherche
// d'adresse. Le nom du module reste, parce que c'est toujours la frontière entre
// l'interface et ce qui calcule.

import { planOnDevice } from './engine/client'
import { reverse, search } from './engine/geocode'
import { buildGpx, gpxFilename } from './engine/gpx'
import { buildRunGpx } from './runGpx'
import { saveTextFile } from './platform'

/**
 * Un échec de recherche, prêt à être montré.
 *
 * `offline` permet à l'interface de proposer autre chose que « réessaie » :
 * hors ligne, réessayer ne servira à rien, alors que les parcours déjà
 * enregistrés, eux, sont là.
 */
export class NetworkError extends Error {
  constructor(message, { offline = false } = {}) {
    super(message)
    this.name = 'NetworkError'
    this.offline = offline
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * Traduit un échec du moteur en message pour l'utilisateur.
 *
 * Un refus métier (départ isolé, distance hors limites) dit déjà ce qu'il faut
 * faire : son message passe tel quel. Hors ligne, en revanche, le message des
 * miroirs OpenStreetMap parlerait de serveurs saturés à quelqu'un qui a
 * simplement perdu le réseau — c'est ce cas-là qu'il faut reconnaître.
 */
export function explainFailure(error) {
  if (error?.name === 'PlanningError') return new NetworkError(error.message)
  if (isOffline()) {
    return new NetworkError(
      "Pas de connexion, et cette zone n'est pas encore sur l'appareil. Les zones déjà explorées se calculent hors ligne, et tes parcours enregistrés restent accessibles dans « Mes parcours ».",
      { offline: true },
    )
  }
  if (error?.name === 'OverpassError' || error?.name === 'EngineCrash') return new NetworkError(error.message)
  return new NetworkError(`La recherche a échoué : ${error?.message || 'erreur inconnue'}.`)
}

export async function generateLoops(params, onProgress) {
  try {
    return await planOnDevice(params, onProgress)
  } catch (error) {
    throw explainFailure(error)
  }
}

export async function downloadGpx(name, geometry, elevation, sport = 'run') {
  await saveTextFile(gpxFilename(name), buildGpx(name, geometry, elevation, sport), 'application/gpx+xml')
}

export async function searchPlaces(query, signal, near = null) {
  return search(query, { signal, near })
}

export async function describePlace(lat, lon) {
  return reverse(lat, lon)
}

/**
 * La trace d'une sortie terminée, avec l'heure de chaque point — ce qu'un
 * autre service (Garmin Connect, le site de Strava) demande pour y voir une
 * activité, et pas seulement un dessin. Voir `runGpx.js`.
 */
export async function downloadRun(entry) {
  await saveTextFile(gpxFilename(`${entry.name} — trace`), buildRunGpx(entry), 'application/gpx+xml')
}
