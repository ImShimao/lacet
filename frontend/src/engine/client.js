// Le côté fil principal du moteur : une promesse par demande, et la progression.
//
// Un seul worker pour toute l'app, créé à la première recherche : c'est lui qui
// garde les graphes en mémoire, et en créer un par recherche les perdrait.

let worker = null
let nextId = 1
const pending = new Map()

function reset(reason) {
  for (const { reject } of pending.values()) reject(reason)
  pending.clear()
  worker?.terminate()
  worker = null
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id)
    if (!job) return
    if (data.type === 'progress') {
      job.onProgress?.(data.stage, data.fraction)
      return
    }
    pending.delete(data.id)
    if (data.type === 'result') job.resolve(data.result)
    else {
      const error = new Error(data.error.message)
      error.name = data.error.name
      job.reject(error)
    }
  }
  // Un worker qui plante — mémoire épuisée sur un extrait géant, typiquement —
  // ne doit pas laisser les demandes suspendues pour toujours : on les rejette,
  // et le prochain appel en recrée un propre.
  worker.onerror = (event) => {
    event.preventDefault?.()
    const error = new Error("Le calcul s'est interrompu. Essaie une distance plus courte.")
    error.name = 'EngineCrash'
    reset(error)
  }
  return worker
}

function request(type, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextId
    nextId += 1
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ id, type, payload })
  })
}

/** Calcule des boucles sur l'appareil. `onProgress(étape, fraction)`. */
export const planOnDevice = (params, onProgress) => request('plan', params, onProgress)

/**
 * Prépare en fond les rues d'une recherche à venir. Ne rejette jamais : un
 * échec ici n'a rien à dire à l'écran, la recherche elle-même s'en chargera.
 */
export const prefetchOnDevice = (params) =>
  request('prefetch', params).then(
    (result) => result?.ready === true,
    () => false,
  )

/**
 * Le chemin qui ramène sur la boucle, depuis là où l'on est — voir
 * `engine/reroute.js`. Rend `null` s'il n'y en a pas.
 */
export const detourOnDevice = (payload) => request('detour', payload)

/** La même boucle dans l'autre sens, tant qu'elle est à l'écran. */
export const reverseOnDevice = (id) => request('reverse', { id })

/** Oublie les données OpenStreetMap gardées et les graphes en mémoire. */
export const clearEngineData = () => request('clear', null)
