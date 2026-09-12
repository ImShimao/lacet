// Chemin relatif : le serveur de développement Vite relaie `/api` vers le
// backend (voir vite.config.js). L'app fonctionne donc à l'identique depuis le
// PC, depuis un téléphone sur le réseau local, et en HTTPS — sans CORS ni
// contenu mixte. `VITE_API_URL` permet de pointer ailleurs si besoin.
const BASE = import.meta.env.VITE_API_URL || '/api'

/**
 * Une panne de réseau, distinguée d'une panne de serveur.
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

/**
 * Ce qu'on dit quand la requête n'aboutit pas.
 *
 * L'ancien message donnait la commande à taper pour lancer le serveur. C'est
 * juste sur un poste de développement, et absurde sur un téléphone au milieu
 * d'un chemin : la personne n'a pas de serveur à lancer, elle a perdu le
 * réseau. Le calcul d'itinéraire a besoin d'OpenStreetMap, donc d'une
 * connexion ; ses parcours enregistrés, non.
 */
function networkFailure() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new NetworkError(
      "Pas de connexion. Calculer un itinéraire demande le réseau — mais tes parcours enregistrés restent accessibles dans « Mes parcours ».",
      { offline: true },
    )
  }
  const hint = import.meta.env.DEV
    ? ' Lance-le depuis le dossier backend : « python -m uvicorn app.main:app --reload ».'
    : ' Réessaie dans un moment.'
  return new NetworkError(`Le serveur ne répond pas.${hint}`)
}

async function post(path, body) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw networkFailure()
  }

  if (!response.ok) {
    // Le backend explique lui-même ses refus métier (départ isolé, miroirs
    // OpenStreetMap muets…) : quand il le fait, c'est son message qui parle.
    let detail = null
    try {
      const payload = await response.json()
      if (payload.detail) detail = payload.detail
    } catch {
      /* réponse non-JSON : il n'y a rien à en tirer */
    }
    throw new NetworkError(detail || statusMessage(response.status))
  }
  return response
}

/**
 * Ce qu'on dit quand le serveur répond mal sans rien expliquer.
 *
 * « Erreur 500 » n'apprend rien à personne. Et en développement, un 5xx signifie
 * neuf fois sur dix que le backend n'est pas lancé — le relais de Vite renvoie
 * alors une erreur de passerelle plutôt que de laisser `fetch` échouer, si bien
 * que le message de perte de réseau ne s'affiche jamais dans ce cas.
 */
function statusMessage(status) {
  if (status >= 500) {
    const hint = import.meta.env.DEV
      ? ' Vérifie que le backend tourne : « python -m uvicorn app.main:app --reload ».'
      : ' Réessaie dans un moment.'
    return `Le serveur ne répond pas.${hint}`
  }
  if (status === 429) return 'Trop de recherches à la suite. Attends quelques secondes.'
  return `La recherche a échoué (erreur ${status}).`
}

export async function generateLoops(params) {
  const response = await post('/loops', params)
  return response.json()
}

export async function downloadGpx(name, geometry, elevation, sport = 'run') {
  const response = await post('/gpx', { name, geometry, elevation, sport })
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\w-]+/g, '-')}.gpx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function searchPlaces(query, signal) {
  const response = await fetch(`${BASE}/places?q=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) return []
  return response.json()
}

export async function describePlace(lat, lon) {
  try {
    const response = await fetch(`${BASE}/place?lat=${lat}&lon=${lon}`)
    if (!response.ok) return null
    const payload = await response.json()
    return payload.label
  } catch {
    return null
  }
}
