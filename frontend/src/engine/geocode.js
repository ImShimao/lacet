// Recherche de lieu, via Nominatim — portage de `backend/app/geocode.py`.
//
// Le backend relayait les appels pour respecter la charte de Nominatim : une
// requête par seconde, et un agent identifiable. L'appareil appelle désormais
// directement ; la cadence est donc tenue ici, et le cache aussi, puisque la
// barre de recherche interroge à chaque pause de frappe.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const CACHE_MAX = 500

const cache = new Map()
let lastCall = 0
let chain = Promise.resolve()

/** Une requête par seconde au plus, tous appels confondus. */
function throttled(url, params, signal) {
  const run = chain.then(async () => {
    const wait = 1050 - (Date.now() - lastCall)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    if (signal?.aborted) throw new DOMException('annulé', 'AbortError')
    lastCall = Date.now()
    const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
      headers: { 'Accept-Language': 'fr' },
      signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
  chain = run.catch(() => undefined)
  return run
}

export async function search(query, { limit = 5, signal } = {}) {
  const key = query.trim().toLowerCase()
  if (key.length < 2) return []
  if (cache.has(key)) {
    const hit = cache.get(key)
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  let raw
  try {
    raw = await throttled(
      NOMINATIM_URL,
      { q: query.trim().slice(0, 120), format: 'jsonv2', limit: String(limit), addressdetails: '1' },
      signal,
    )
  } catch (error) {
    if (error.name === 'AbortError') throw error
    return []
  }

  const results = raw
    .filter((item) => item.lat && item.lon)
    .map((item) => ({
      label: item.display_name ?? '',
      short: shortLabel(item),
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
  cache.set(key, results)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return results
}

export async function reverse(lat, lon) {
  try {
    const raw = await throttled(REVERSE_URL, { lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '16' })
    return raw ? shortLabel(raw) : null
  } catch {
    return null
  }
}

/** « Rue de Rivoli, Paris » plutôt que l'adresse administrative complète. */
export function shortLabel(item) {
  const address = item.address ?? {}
  const street = address.road || address.pedestrian || address.footway || item.name
  const city = address.city || address.town || address.village || address.municipality || address.county
  const unique = [...new Set([street, city].filter(Boolean))]
  if (unique.length) return unique.join(', ')
  return (item.display_name || '').split(',')[0]
}
