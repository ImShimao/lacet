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
//
// **Deux nombres collés sont un point**, pas une recherche : ils ne partent pas
// sur le réseau.
//
// **Un second tour, quand le premier ne ressemble à rien.** La question posée
// d'abord est « près d'ici » : neuf recherches sur dix visent le coin, et une
// seule requête suffit. Mais quand rien de ce qui revient ne ressemble à ce qui
// a été tapé, deux autres partent ensemble :
//
// - *sans biais de proximité* — depuis l'Alsace, « stade de france » répondait
//   le stade de l'Ill à Mulhouse, et « gare de lyon » la route de Lyon à
//   Erstein : classés par distance, les lieux connus n'avaient aucune chance ;
// - *avec le mot le plus long raccourci de deux lettres* — Photon cherche par
//   préfixe, donc une faute en fin de mot se pardonne, mais pas au milieu :
//   « rivolli » ne trouve pas la rue de Rivoli, « rivol » oui.
//
// Les listes sont fondues, puis **classées par ressemblance avec ce qui a été
// tapé**, la distance n'intervenant qu'entre résultats comparables. C'est ce
// classement qui rend la seconde chance inoffensive : ses résultats, plus
// lâches, ne remontent que là où rien de mieux n'existe. Et attendre d'en avoir
// besoin garde la main légère sur un service gratuit — une requête par
// recherche dans le cas courant, trois seulement quand ça coince.

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

/**
 * Ce qui, dans un résultat, ressemble à ce qu'on a tapé — de 0 à 1.
 *
 * Deux questions, pas une. **Ce qu'on a tapé s'y retrouve-t-il ?** Mot à mot :
 * chaque mot cherche son meilleur correspondant dans le nom et l'adresse du
 * lieu, et pèse selon sa longueur — « paris » compte plus que « de », une faute
 * sur un mot long coûte moins qu'une faute sur un mot court. **Et le nom
 * dit-il autre chose ?** Sans cette seconde question, « Ancienne Gare de
 * Lyon-Saint-Clair » collait aussi bien que « Gare de Lyon » à qui tapait
 * « gare de lyon », « Colmar-Ribeauvillé » aussi bien que Colmar, et l'hôtel
 * devant le parc de la Tête d'Or aussi bien que le parc. Ce qui déborde du nom
 * compte donc contre lui — sans l'écraser : on cherche souvent un lieu par un
 * bout de son nom.
 */
export function similarity(query, place) {
  const asked = words(query)
  const name = words(place.short ?? '')
  const haystack = [...name, ...words(place.label ?? '')]
  if (!asked.length || !haystack.length) return 0
  const retrouvé = coverage(asked, haystack)
  const expliqué = name.length ? coverage(name, asked) : 1
  return retrouvé * (0.8 + 0.2 * expliqué)
}

/** La part de `mots` qui se retrouve dans `parmi`, au poids des lettres. */
function coverage(mots, parmi) {
  let total = 0
  let weight = 0
  for (const mot of mots) {
    let best = 0
    for (const candidat of parmi) {
      best = Math.max(best, closeness(mot, candidat))
      if (best === 1) break
    }
    total += best * mot.length
    weight += mot.length
  }
  return weight ? total / weight : 0
}

const words = (text) => fold(text).split(/[^a-z0-9]+/).filter(Boolean)

/** Deux mots : 1 s'ils sont le même, 0 s'ils n'ont rien à voir. */
function closeness(asked, found) {
  if (asked === found) return 1
  // Un mot commencé, pas encore fini : « guebwil » vaut Guebwiller — mais moins
  // qu'un mot entier, et d'autant moins qu'il en reste. C'est ce qui sépare
  // Versailles de Versailleux quand on tape « versaille ».
  if (found.startsWith(asked)) return 0.5 + (0.5 * asked.length) / found.length
  const longest = Math.max(asked.length, found.length)
  return Math.max(0, 1 - editDistance(asked, found) / longest)
}

/** Levenshtein, sur deux lignes : les mots comparés ici font dix lettres. */
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * La seconde chance : le mot le plus long, amputé de deux lettres.
 *
 * Photon cherche par préfixe, donc une faute en fin de mot se pardonne d'elle-
 * même — mais pas une faute au milieu. Amputer ramène la faute hors du préfixe :
 * « rivolli » → « rivol » retrouve la rue de Rivoli, « franse » → « fran » le
 * Stade de France. Le mot le plus long est le plus distinctif, et c'est aussi
 * celui qu'on écorche. Rend `null` quand il n'y a rien à raccourcir.
 */
export function shorten(query) {
  const parts = query.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  let index = -1
  for (let i = 0; i < parts.length; i += 1) {
    if (fold(parts[i]).replace(/[^a-z0-9]/g, '').length < 5) continue
    if (index === -1 || parts[i].length > parts[index].length) index = i
  }
  if (index === -1) return null
  const cut = parts[index].slice(0, -2)
  const shortened = [...parts.slice(0, index), cut, ...parts.slice(index + 1)].join(' ')
  return shortened === query.trim() ? null : shortened
}

/**
 * Deux nombres collés dans le champ : un point, pas une recherche.
 *
 * « 46.2578, 7.3856 » — c'est ce qu'on reçoit d'un ami, d'une capture d'écran,
 * d'une trace GPX ouverte ailleurs. Aucun géocodeur n'en fait rien : Photon
 * répondait « FUEL MAXX 46 ». On les reconnaît donc avant de partir sur le
 * réseau, dans l'ordre des cartes — latitude d'abord —, virgule décimale
 * comprise quand le séparateur lève l'ambiguïté (« 46,2578 ; 7,3856 »).
 *
 * Rend `null` dès que ce n'est pas exactement ça : mieux vaut chercher un nom
 * que poser un départ au milieu de nulle part.
 */
export function asCoordinates(text) {
  const parts = separate(text.trim())
  if (!parts) return null
  const [lat, lon] = parts.map((part) => Number(part.replace(',', '.')))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  // Deux entiers, ce n'est pas une position : c'est un numéro de rue, une année,
  // un code postal. On exige au moins une décimale quelque part.
  if (!/[.,]/.test(parts[0]) && !/[.,]/.test(parts[1])) return null
  return {
    // Au dix-millième de degré près, soit une dizaine de mètres : au-delà, les
    // zéros de `toFixed` donnaient « 46,25780 », qui se lit mal et promet une
    // précision que personne n'a tapée.
    short: `${degré(lat)} · ${degré(lon)}`,
    label: 'coordonnées',
    kind: 'Point',
    lat,
    lon,
    distance_m: null,
  }
}

const degré = (v) => String(Number(v.toFixed(5))).replace('.', ',')

/** Les deux nombres, sans confondre la virgule décimale et le séparateur. */
function separate(text) {
  const nombre = /^-?\d{1,3}(?:[.,]\d+)?$/
  // « 46,2578 ; 7,3856 » ou « 46.2578 ; 7.3856 » : le point-virgule tranche.
  for (const sep of [';', /\s+/]) {
    const parts = text.split(sep).map((part) => part.trim()).filter(Boolean)
    if (parts.length === 2 && parts.every((part) => nombre.test(part))) return parts
  }
  // « 46.2578, 7.3856 » : la virgule sépare, donc le point décime.
  const parts = text.split(',').map((part) => part.trim())
  if (parts.length === 2 && parts.every((part) => /^-?\d{1,3}(?:\.\d+)?$/.test(part))) return parts
  return null
}

/** Une requête par seconde au plus vers Nominatim, tous appels confondus. */
function throttled(url, params, signal, fetchImpl = fetch) {
  const run = chain.then(async () => {
    const wait = 1050 - (Date.now() - lastCall)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    if (signal?.aborted) throw new DOMException('annulé', 'AbortError')
    lastCall = Date.now()
    const response = await fetchImpl(`${url}?${new URLSearchParams(params)}`, {
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
  const point = asCoordinates(text)
  if (point) return [point]
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
  const found = await Promise.all([
    attempt(() => photon(asked, { limit, near, signal, fetchImpl })),
    token ? attempt(() => mapbox(asked, { limit, near, signal, fetchImpl, token })) : Promise.resolve(null),
  ])
  if (signal?.aborted) throw new DOMException('annulé', 'AbortError')

  const lists = [...found]
  let results = merge(lists, near, asked, limit)
  if (!good(results, asked)) {
    const retry = shorten(asked)
    const second = await Promise.all([
      near ? attempt(() => photon(asked, { limit, near: null, signal, fetchImpl })) : Promise.resolve(null),
      retry ? attempt(() => photon(retry, { limit, near, signal, fetchImpl })) : Promise.resolve(null),
    ])
    if (signal?.aborted) throw new DOMException('annulé', 'AbortError')
    lists.push(...second)
    results = merge(lists, near, asked, limit)
  }
  if (!results.length) {
    // Personne n'a répondu, ou personne n'a rien trouvé : Nominatim, sur les
    // mêmes données mais un autre index — il lui arrive de trouver seul.
    try {
      results = await nominatim(asked, { limit, near, signal, fetchImpl })
    } catch (error) {
      if (error.name === 'AbortError') throw error
      // Si personne n'a répondu, ce n'est pas « aucun lieu de ce nom » : c'est
      // une panne, et le champ doit pouvoir le dire plutôt que d'envoyer
      // chercher ailleurs un nom qui existe peut-être.
      if (lists.every((list) => list === null)) throw error
      return []
    }
  }

  cache.set(key, results)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return results
}

const merge = (lists, near, query, limit) =>
  rankPlaces(lists.filter(Boolean).flat(), near, query).slice(0, limit)

// En dessous, le meilleur résultat ne ressemble pas assez à ce qui a été tapé
// pour qu'on s'en contente : un mot entier de travers, ou un nom qui déborde
// largement. Au-dessus, poser deux questions de plus ne changerait que l'ordre.
const GOOD_ENOUGH = 0.9

// Et un lieu à l'autre bout du monde ne clôt pas la question, même s'il porte
// exactement ce qu'on a tapé : « tour eifel » répondait une école de Bingerville
// — qui s'appelle bel et bien ainsi, faute comprise — à quatre mille huit cents
// kilomètres, pendant qu'un « Tour Eiffel » dort à trois kilomètres d'ici. On
// cherche un départ de course, pas une destination de voyage.
const FAR_M = 1_000_000

function good(results, query) {
  const best = results[0]
  if (!best || similarity(query, best) < GOOD_ENOUGH) return false
  return best.distance_m == null || best.distance_m <= FAR_M
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

async function nominatim(text, { limit, near, signal, fetchImpl = fetch }) {
  const params = { q: text.slice(0, 120), format: 'jsonv2', limit: String(limit), addressdetails: '1' }
  // Une préférence, pas une frontière : `bounded` à 0 laisse passer Paris
  // quand on cherche Paris depuis Colmar.
  if (near) {
    params.viewbox = [near.lon - 0.5, near.lat + 0.3, near.lon + 0.5, near.lat - 0.3].map((v) => v.toFixed(4)).join(',')
    params.bounded = '0'
  }
  const raw = await throttled(NOMINATIM_URL, params, signal, fetchImpl)
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
 * L'éloignement, en douceur : de 1 sur place à 0,82 à l'autre bout du monde.
 *
 * Un seuil aurait tranché au mauvais endroit — « la boulangerie à 9 km bat
 * celle à 11 km » est vrai, « le Stade de France à 375 km perd contre le stade
 * de l'Ill à 20 km » ne l'est pas. En multipliant la ressemblance par ce
 * facteur, la distance ne départage que ce qui se ressemble déjà : il faut à
 * peu près quatre cents kilomètres pour rattraper un nom qui colle un peu mieux.
 */
const nearness = (metres) => 1 - 0.18 * (1 - Math.exp(-metres / 600_000))

// Une ville ou un village passe devant le commerce qui en porte le nom : c'est
// le lieu qu'on cherchait dans neuf cas sur dix. Le bonus vaut environ cinq
// cents kilomètres — au-delà, le commerce d'à côté repasse devant, et c'est
// juste : on ne part pas courir à l'autre bout du monde.
const PLACE_BONUS = 1.12

/**
 * Le classement final : ce qui ressemble le plus, puis ce qui est le plus près.
 *
 * Les listes arrivent de trois questions différentes et leurs ordres ne se
 * comparent pas ; c'est ici qu'on décide. Un seul nombre, et pas de tranches :
 * la ressemblance avec ce qui a été tapé, amortie par l'éloignement, majorée
 * pour une ville. Le Stade de France passe devant le stade de l'Ill, « Paris »
 * la capitale devant « Paris » le coiffeur — mais le Burger King de Cernay
 * reste devant celui de Mulhouse.
 *
 * Sans `query`, l'ordre reçu est gardé — seules la distance, à nom et genre
 * égaux, et la fusion des doublons s'appliquent.
 *
 * Et les doublons partent : même nom, à moins de 150 m.
 */
export function rankPlaces(places, near, query = null) {
  const scored = places.map((place, index) => ({
    ...place,
    distance_m: near ? metres(near, place) : null,
    index,
    match: query ? similarity(query, place) : 0,
  }))
  const groups = new Map()
  for (const place of scored) {
    const key = place.group ?? `${fold(place.short)}|`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(place)
  }
  const kept = []
  for (const members of groups.values()) {
    if (near) members.sort((a, b) => a.distance_m - b.distance_m)
    for (const place of members) {
      const twin = kept.some((other) => fold(other.short) === fold(place.short) && metres(other, place) < SAME_PLACE_M)
      if (!twin) kept.push(place)
    }
  }
  if (query) {
    for (const place of kept) {
      place.score =
        place.match *
        (place.distance_m == null ? 1 : nearness(place.distance_m)) *
        (place.group?.endsWith('|lieu') ? PLACE_BONUS : 1)
    }
    // À égalité parfaite — deux fois le même lieu, vu par deux sources —,
    // l'ordre d'arrivée tranche : il est stable d'une frappe à l'autre.
    kept.sort((a, b) => b.score - a.score || a.index - b.index)
  }
  return kept.map(({ group, index, match, score, ...place }) => place)
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
