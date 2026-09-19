// Recherche de lieu : adresses, mais aussi commerces, salles, gares, parcs.
//
// **Photon d'abord.** Nominatim, le géocodeur historique d'OpenStreetMap, sait
// trouver une adresse, mais pas « one fitness » : il cherche des mots exacts,
// n'importe où dans le monde, et répond une salle de Lucerne avant celle de
// Colmar. Photon (Komoot, sur les mêmes données) est fait pour la saisie au fil
// des touches : il tolère les fautes, indexe chaque commerce par son nom et
// son genre, et **classe par proximité** quand on lui donne une position —
// « burger king » depuis Guebwiller répond Cernay, puis Kingersheim, puis
// Mulhouse. Pas de compte, pas de clé, et pas de limite d'une requête par
// seconde : la frappe n'attend plus.
//
// **Mapbox en renfort**, quand l'app a un token (le même que les fonds de
// carte). Les deux premiers ne connaissent que ce qu'OpenStreetMap contient ;
// un commerce ouvert cette année peut n'y être pas encore — le One Fitness de
// Kingersheim, par exemple, n'y figure pas, alors que son adresse, elle, y est.
// Mapbox tient sa propre base de commerces, plus fraîche sur ce point. Les deux
// listes sont fondues : à nom égal, le lieu n'apparaît qu'une fois, et c'est le
// plus proche qui passe devant. Sans token, rien ne change.
//
// **Nominatim en secours**, si Photon ne répond pas — et pour l'inverse (d'un
// point au nom de sa rue), où il reste le meilleur. Sa charte demande une
// requête par seconde au plus : la cadence est tenue ici.
//
// **Et les surnoms.** Personne ne tape « McDonald's » : on tape « macdo ». Aucun
// géocodeur ne le devine ; une petite table les traduit avant d'interroger.

const PHOTON_URL = 'https://photon.komoot.io/api/'
const MAPBOX_URL = 'https://api.mapbox.com/search/searchbox/v1/forward'
// `import.meta.env` n'existe pas partout (tests hors Vite) : on se garde.
const MAPBOX_TOKEN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN) || ''
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const CACHE_MAX = 500
// Deux résultats du même nom à moins de ça sont le même lieu : la gare et son
// quai, le bâtiment et le commerce qu'il abrite.
const SAME_PLACE_M = 150

const cache = new Map()
let lastCall = 0
let chain = Promise.resolve()

/**
 * Ce qu'on tape, et ce que les cartes écrivent. Clés en minuscules et sans
 * accents ; remplacées seulement comme mots entiers.
 */
const NICKNAMES = [
  [/\b(?:macdo|mcdo|mac ?do|mc ?do|mac ?donald'?s?|mc ?donald'?s?)\b/g, "McDonald's"],
  [/\bbk\b/g, 'Burger King'],
  [/\bdecat\b/g, 'Decathlon'],
  [/\bcarrouf\b/g, 'Carrefour'],
]

/**
 * « macdo guebwiller » → « McDonald's guebwiller ». Sans surnom, la saisie
 * part telle quelle, accents et majuscules compris.
 */
export function expandNicknames(query) {
  const folded = fold(query)
  let text = folded
  for (const [pattern, name] of NICKNAMES) text = text.replace(pattern, name)
  return (text === folded ? query : text).replace(/\s+/g, ' ').trim()
}

/** Minuscules, sans accents, apostrophes droites. */
const fold = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")

/** Une requête par seconde au plus vers Nominatim, tous appels confondus. */
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

/**
 * Cherche un lieu. `near` ({lat, lon}) : là où l'on est — les lieux proches
 * passent devant, et chaque résultat porte sa distance.
 */
export async function search(query, { limit = 7, near = null, signal, fetchImpl = fetch, token = MAPBOX_TOKEN } = {}) {
  const text = query.trim()
  if (text.length < 2) return []
  // La position entre dans la clé, arrondie au kilomètre : la même recherche
  // faite ailleurs ne rend pas les mêmes « plus proches ».
  const key = `${fold(text)}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`
  if (cache.has(key)) {
    const hit = cache.get(key)
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const asked = expandNicknames(text)
  // Les deux sources partent ensemble : l'attente est celle de la plus lente,
  // pas leur somme. Celle qui échoue ne fait pas échouer la recherche.
  const [free, extra] = await Promise.all([
    attempt(() => photon(asked, { limit, near, signal, fetchImpl })),
    token ? attempt(() => mapbox(asked, { limit, near, signal, fetchImpl, token })) : Promise.resolve(null),
  ])
  if (signal?.aborted) throw new DOMException('annulé', 'AbortError')

  let results
  if (free === null && extra === null) {
    // Photon muet et pas de renfort : Nominatim, sur les mêmes données.
    try {
      results = await nominatim(asked, { limit, near, signal })
    } catch (error) {
      if (error.name === 'AbortError') throw error
      return []
    }
  } else {
    results = rankPlaces([...(free ?? []), ...(extra ?? [])], near).slice(0, limit)
  }

  cache.set(key, results)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return results
}

/** Rend `null` plutôt que d'échouer — sauf si la frappe a continué. */
async function attempt(task) {
  try {
    return await task()
  } catch (error) {
    if (error.name === 'AbortError') throw error
    return null
  }
}

async function photon(text, { limit, near, signal, fetchImpl }) {
  // On en demande plus qu'on n'en montre : les doublons (une gare et ses
  // quais) et le bruit (défibrillateurs, panneaux) partent au tri.
  const params = new URLSearchParams({ q: text.slice(0, 120), limit: String(limit * 2), lang: 'fr' })
  if (near) {
    params.set('lat', near.lat.toFixed(5))
    params.set('lon', near.lon.toFixed(5))
  }
  const response = await fetchImpl(`${PHOTON_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return (data.features ?? []).map(fromPhoton).filter(Boolean)
}

async function mapbox(text, { limit, near, signal, fetchImpl, token }) {
  const params = new URLSearchParams({
    q: text.slice(0, 120),
    access_token: token,
    language: 'fr',
    limit: String(Math.min(10, limit)),
  })
  if (near) params.set('proximity', `${near.lon.toFixed(5)},${near.lat.toFixed(5)}`)
  const response = await fetchImpl(`${MAPBOX_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return (data.features ?? []).map(fromMapbox).filter(Boolean)
}

/** Un résultat de Mapbox, au format de l'app. */
export function fromMapbox(feature) {
  const p = feature?.properties ?? {}
  // La position arrive deux fois, en géométrie GeoJSON et dans les propriétés.
  const coords = feature?.geometry?.coordinates
  const lon = Array.isArray(coords) ? coords[0] : p.coordinates?.longitude
  const lat = Array.isArray(coords) ? coords[1] : p.coordinates?.latitude
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  const short = p.name_preferred || p.name
  if (!short) return null
  const place = p.feature_type === 'place' || p.feature_type === 'locality' || p.feature_type === 'region' || p.feature_type === 'country'
  // `place_formatted` est l'adresse sans le nom : « 83 Rue de Guebwiller,
  // 68260 Kingersheim, France » — exactement ce qu'on veut en dessous.
  const label = (p.place_formatted || p.full_address || '')
    .split(', ')
    .filter((part) => part && part !== short && part !== 'France')
    .join(', ')
  return {
    short,
    label,
    kind: MAPBOX_KINDS[p.poi_category?.[0]] ?? (p.feature_type === 'address' ? 'Adresse' : place ? 'Ville' : null),
    lat,
    lon,
    group: `${fold(short)}|${place ? 'lieu' : 'poi'}`,
  }
}

// Les catégories Mapbox qui reviennent dans une recherche de point de départ.
const MAPBOX_KINDS = {
  fitness_center: 'Salle de sport',
  gym: 'Salle de sport',
  sports_club: 'Club de sport',
  stadium: 'Stade',
  park: 'Parc',
  trail: 'Sentier',
  restaurant: 'Restaurant',
  fast_food: 'Restauration rapide',
  cafe: 'Café',
  bakery: 'Boulangerie',
  grocery: 'Supermarché',
  supermarket: 'Supermarché',
  shopping_mall: 'Centre commercial',
  train_station: 'Gare',
  bus_station: 'Gare routière',
  parking_lot: 'Parking',
  school: 'École',
  university: 'Université',
  hospital: 'Hôpital',
  pharmacy: 'Pharmacie',
  swimming_pool: 'Piscine',
  lake: 'Lac',
  mountain: 'Sommet',
}

async function nominatim(text, { limit, near, signal }) {
  const params = { q: text.slice(0, 120), format: 'jsonv2', limit: String(limit), addressdetails: '1' }
  // Une préférence, pas une frontière : `bounded` à 0 laisse passer Paris
  // quand on cherche Paris depuis Colmar.
  if (near) {
    params.viewbox = [near.lon - 0.5, near.lat + 0.3, near.lon + 0.5, near.lat - 0.3].map((v) => v.toFixed(4)).join(',')
    params.bounded = '0'
  }
  const raw = await throttled(NOMINATIM_URL, params, signal)
  const places = raw
    .filter((item) => item.lat && item.lon)
    .map((item) => ({
      label: item.display_name ?? '',
      short: shortLabel(item),
      kind: null,
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
  return rankPlaces(places, near)
}

// Ce qui n'est pas un lieu où l'on donne rendez-vous pour courir.
const NOISE = new Set([
  'emergency:*',
  'tourism:information',
  'highway:bus_stop',
  'highway:platform',
  'public_transport:platform',
  'public_transport:stop_position',
  'railway:platform',
  'railway:stop',
  'railway:halt',
  'amenity:vending_machine',
  'amenity:waste_basket',
  'amenity:bench',
])

/** Un résultat de Photon, au format de l'app — ou `null` s'il n'est que du bruit. */
export function fromPhoton(feature) {
  const p = feature?.properties ?? {}
  const [lon, lat] = feature?.geometry?.coordinates ?? []
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  if (NOISE.has(`${p.osm_key}:${p.osm_value}`) || NOISE.has(`${p.osm_key}:*`)) return null

  const city = p.city || p.town || p.village || p.locality || p.district || p.county
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : null
  // Une ville, une région : on la situe par sa région, pas par une rue. Une
  // adresse, elle, arrive aussi comme `place` — mais `place=house`.
  const place = p.osm_key === 'boundary' || (p.osm_key === 'place' && p.osm_value !== 'house')
  // Une adresse n'a pas de nom : c'est son numéro et sa rue qui la désignent.
  const short = p.name || street || city || ''
  if (!short) return null
  const parts = place
    ? [p.state, p.country]
    : [p.name ? street : null, [p.postcode, city].filter(Boolean).join(' ') || null, p.country !== 'France' ? p.country : null]
  return {
    short,
    label: [...new Set(parts.filter(Boolean))].filter((part) => part !== short).join(', '),
    kind: kindOf(p),
    lat,
    lon,
    // Le genre, en deux familles seulement — une ville ou le reste. Plus fin,
    // le même lieu vu par deux sources ne se reconnaîtrait pas : « salle de
    // sport » d'un côté, « bâtiment » de l'autre.
    group: `${fold(short)}|${place ? 'lieu' : 'poi'}`,
  }
}

/**
 * Le classement final.
 *
 * L'ordre de Photon mêle pertinence et proximité ; il est gardé, à une
 * exception près : **entre lieux du même nom et du même genre**, le plus
 * proche passe devant. Quand on cherche une enseigne, c'est celle d'à côté
 * qu'on veut — quelle que soit la façon dont le géocodeur a départagé. Le
 * nom seul ne suffirait pas : « Paris » la ville et « Paris » le coiffeur de
 * la rue d'à côté ne se comparent pas.
 *
 * Et les doublons partent : même nom, à moins de 150 m.
 */
export function rankPlaces(places, near) {
  const withDistance = places.map((p) => ({ ...p, distance_m: near ? metres(near, p) : null }))
  const groups = new Map()
  for (const place of withDistance) {
    const key = place.group ?? `${fold(place.short)}|`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(place)
  }
  const out = []
  for (const members of groups.values()) {
    if (near) members.sort((a, b) => a.distance_m - b.distance_m)
    for (const place of members) {
      const twin = out.some((kept) => fold(kept.short) === fold(place.short) && metres(kept, place) < SAME_PLACE_M)
      if (!twin) out.push(place)
    }
  }
  return out.map(({ group, ...place }) => place)
}

// Le genre d'un lieu, en mots de tous les jours. Ce qui manque ici reste sans
// étiquette : mieux vaut rien qu'un « amenity=fast_food ».
const KINDS = {
  fast_food: 'Restauration rapide',
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  pub: 'Bar',
  bakery: 'Boulangerie',
  fitness_centre: 'Salle de sport',
  sports_centre: 'Centre sportif',
  stadium: 'Stade',
  pitch: 'Terrain de sport',
  track: 'Piste',
  swimming_pool: 'Piscine',
  water_park: 'Piscine',
  park: 'Parc',
  garden: 'Jardin',
  nature_reserve: 'Réserve naturelle',
  forest: 'Forêt',
  wood: 'Bois',
  peak: 'Sommet',
  viewpoint: 'Point de vue',
  lake: 'Lac',
  station: 'Gare',
  train_station: 'Gare',
  supermarket: 'Supermarché',
  sports: 'Magasin de sport',
  mall: 'Centre commercial',
  pharmacy: 'Pharmacie',
  hospital: 'Hôpital',
  school: 'École',
  university: 'Université',
  college: 'Lycée',
  townhall: 'Mairie',
  place_of_worship: 'Lieu de culte',
  church: 'Église',
  castle: 'Château',
  museum: 'Musée',
  parking: 'Parking',
  hotel: 'Hôtel',
  city: 'Ville',
  town: 'Ville',
  village: 'Village',
  hamlet: 'Hameau',
  suburb: 'Quartier',
  neighbourhood: 'Quartier',
  house: 'Adresse',
}

function kindOf(p) {
  if (p.type === 'street' || p.osm_key === 'highway') return 'Rue'
  if (p.type === 'house' && !p.name) return 'Adresse'
  return KINDS[p.osm_value] ?? null
}

function metres(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
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
