/**
 * Le relais de Lacet, sur Cloudflare Workers — la seule pièce qui tourne hors
 * du téléphone, et dans l'offre gratuite (100 000 requêtes par jour).
 *
 * - `/packs/<fichier>` : les archives de rues, rangées dans R2. GitHub tolère
 *   un dépôt servi comme CDN mais peut le couper en cas d'« usage excessif » ;
 *   R2 ne facture ni la sortie ni les 10 premiers gigaoctets. Les plages
 *   d'octets (`Range`) sont respectées au bit près : l'app ne lit que les
 *   tuiles qu'il lui faut (voir `frontend/src/engine/archive.js`).
 * - `/wind?lat=…&lon=…` : le vent, chez MET Norway. Open-Meteo, appelé avant,
 *   interdit son offre gratuite à une app commerciale ; MET Norway l'autorise
 *   mais demande qu'une app passe par un relais qui s'identifie et garde les
 *   réponses en cache jusqu'à leur expiration. C'est ce que fait celui-ci.
 *
 * Rien n'est journalisé : la position n'est arrondie qu'au centième de degré
 * (un kilomètre), ce qui sert aussi de clé de cache.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, If-None-Match',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag',
}
// MET Norway exige un nom d'app et un moyen de contact ; l'adresse du projet
// suffit, sans exposer celle de personne.
const USER_AGENT = 'Lacet/1.0 https://github.com/ImShimao/Lacet'
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'
const PACK_NAME = /^[A-Za-z0-9_.-]+$/

const text = (body, status) => new Response(body, { status, headers: CORS })

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD' } })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Méthode non permise', 405)
    const url = new URL(request.url)
    if (url.pathname.startsWith('/packs/')) return pack(decodeURIComponent(url.pathname.slice(7)), request, env)
    if (url.pathname === '/wind') return wind(url, ctx, env.CACHE ?? caches.default, env.FETCH ?? fetch)
    return text('Introuvable', 404)
  },
}

/** Une archive, entière ou par plage d'octets. */
async function pack(name, request, env) {
  // Un nom simple, sans dossier : rien d'autre que les archives n'est servi.
  // Sans bucket R2 (déploiement du vent seul), l'app retombe sur GitHub.
  if (!env.PACKS || !PACK_NAME.test(name) || name.startsWith('.')) return text('Introuvable', 404)
  const object = await env.PACKS.get(name, { range: request.headers, onlyIf: request.headers })
  if (object === null) return text('Introuvable', 404)

  const headers = new Headers(CORS)
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  // Les archives se refont une fois par mois : un jour de cache côté appareil
  // ne retarde rien d'utile.
  headers.set('Cache-Control', 'public, max-age=86400')
  // `onlyIf` satisfait : R2 rend l'objet sans corps.
  if (!('body' in object)) return new Response(null, { status: 304, headers })

  const range = request.headers.has('Range') ? object.range : null
  if (range && 'offset' in range) {
    const end = range.offset + range.length - 1
    headers.set('Content-Range', `bytes ${range.offset}-${end}/${object.size}`)
    headers.set('Content-Length', String(range.length))
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
  }
  headers.set('Content-Length', String(object.size))
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

/** Le vent du moment, en km/h, et d'où il vient, en degrés ; la température et la pluie de l'heure, quand MET Norway les donne. */
async function wind(url, ctx, cache, fetchImpl) {
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return text('Position invalide', 400)
  }
  const at = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const key = new Request(`https://lacet-wind.cache/${at}`)
  const hit = await cache.match(key)
  if (hit) return hit

  const [la, lo] = at.split(',')
  const answer = await fetchImpl(`${MET_URL}?lat=${la}&lon=${lo}`, { headers: { 'User-Agent': USER_AGENT } })
  if (!answer.ok) return text(`MET Norway : HTTP ${answer.status}`, 502)
  const now = (await answer.json())?.properties?.timeseries?.[0]?.data ?? {}
  const details = now.instant?.details ?? {}
  const speed = Number(details.wind_speed)
  const from = Number(details.wind_from_direction)
  if (!Number.isFinite(speed) || !Number.isFinite(from)) return text('Vent inconnu', 502)
  // La même réponse dit aussi la température et la pluie de l'heure qui vient :
  // de quoi conseiller la tenue sans une seconde question à MET Norway.
  const temp = Number(details.air_temperature)
  const rain = Number(now.next_1_hours?.details?.precipitation_amount)
  const weather = {
    ...(Number.isFinite(temp) ? { temp_c: Math.round(temp * 10) / 10 } : {}),
    ...(Number.isFinite(rain) ? { rain_mm: rain } : {}),
  }

  // MET Norway dit jusqu'à quand sa réponse vaut : on ne lui redemande rien avant.
  const expires = Date.parse(answer.headers.get('Expires') ?? '')
  const seconds = Number.isFinite(expires) ? Math.max(60, Math.min(3600, Math.round((expires - Date.now()) / 1000))) : 1800
  const response = new Response(JSON.stringify({ speed_kmh: Math.round(speed * 3.6 * 10) / 10, from_deg: from, ...weather }), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` },
  })
  ctx.waitUntil(cache.put(key, response.clone()))
  return response
}
