// Le filet de secours : une boucle calculée ailleurs, quand on n'a pas les rues.
//
// Lacet calcule tout sur le téléphone, et c'est ce qui lui permet de noter la
// sécurité d'un parcours et de fonctionner sans réseau. Mais il lui faut les
// rues, et il reste des endroits où elles n'arrivent pas : l'étranger, que les
// archives ne couvrent pas encore, et les jours où Overpass ne répond à
// personne. Là, jusqu'ici, l'écran restait vide.
//
// **Un tracé sans note vaut mieux qu'un écran vide.** On demande donc une boucle
// à un calculateur d'itinéraires public — le service Valhalla de FOSSGIS, qui
// fait tourner l'infrastructure d'OpenStreetMap. Sans compte ni clé, en trois
// dixièmes de seconde, et avec les consignes déjà en français.
//
// Ce qui en revient est **annoncé pour ce que c'est** : un tracé, pas une
// recommandation. Aucune note A/B/C, aucune part exposée au trafic, aucun
// revêtement — ce calculateur ne regarde ni les trottoirs, ni les vitesses, ni
// les passages protégés. C'est exactement ce que font les applications qui
// n'ont pas de moteur embarqué, et c'est pourquoi ce n'est ici qu'un recours.
//
// On reste poli avec un service offert : quelques requêtes par recherche, un
// nom d'agent qui dit qui appelle, et jamais quand les rues sont là.

import { ELEVATION_STEP_M, ascentDescent, fetchMany, shapeRelief } from './environment'
import { haversineM, resample } from './geo'
import { headings, turnOf, turnPhrase } from './navigation'
import { pymod, pyRound } from './py'

const VALHALLA = 'https://valhalla1.openstreetmap.de/route'
const AGENT = 'Lacet/1.0 (application de course à pied ; itinéraires de secours)'
const TIMEOUT_MS = 12_000

// Les formes essayées, et dans combien de directions. Quatre départs suffisent à
// proposer des boucles différentes sans multiplier les requêtes sur un service
// qu'on ne paie pas.
const SHAPES = [4, 3]
// Le relief se demande comme pour les autres itinéraires — même service
// d'altitudes, même pas (`ELEVATION_STEP_M`) : un dénivelé connu ne coûte
// qu'une requête de plus.
const HEADINGS = [0, 90, 180, 270]
// Une route n'est jamais droite : le périmètre réel dépasse celui du polygone
// visé d'environ un quart. On vise donc plus petit, puis on corrige.
const DETOUR = 1.25
const MAX_ROUNDS = 2

const costingFor = (sport) => (sport === 'bike' ? 'bicycle' : 'pedestrian')

/** Les sommets d'un polygone dont le départ est un sommet, orienté par `heading`. */
function waypoints(lat, lon, targetM, sides, heading) {
  const radius = targetM / (2 * sides * Math.sin(Math.PI / sides)) / DETOUR
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  // Le centre du polygone, à `radius` du départ dans la direction demandée.
  const a = (heading * Math.PI) / 180
  const cx = lon + (radius * Math.sin(a)) / kx
  const cy = lat + (radius * Math.cos(a)) / ky

  const out = []
  for (let k = 1; k < sides; k += 1) {
    const angle = a + Math.PI + (k * 2 * Math.PI) / sides
    out.push({
      lat: cy + (radius * Math.cos(angle)) / ky,
      lon: cx + (radius * Math.sin(angle)) / kx,
    })
  }
  return out
}

/** Décode une forme Valhalla (polyligne à six décimales). */
export function decodeShape(encoded, precision = 1e6) {
  const points = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0
      let shift = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lon += delta
    }
    points.push([lon / precision, lat / precision])
  }
  return points
}

async function ask(locations, sport, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetchImpl(VALHALLA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': AGENT },
      signal: controller.signal,
      body: JSON.stringify({
        locations,
        costing: costingFor(sport),
        directions_options: { language: 'fr-FR', units: 'kilometers' },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    if (!data?.trip?.legs?.length) return null
    return data.trip
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Les manœuvres Valhalla (`type`) qui sont des virages, dans nos mots.
const VALHALLA_TURNS = {
  9: 'slight_right',
  10: 'right',
  11: 'sharp_right',
  12: 'uturn',
  13: 'uturn',
  14: 'sharp_left',
  15: 'left',
  16: 'slight_left',
  18: 'slight_right',
  19: 'slight_left',
  20: 'right',
  21: 'left',
  23: 'slight_right',
  24: 'slight_left',
}
// Tout droit, la rue qui change de nom, une bretelle droite : rien à dire.
const VALHALLA_QUIET = new Set([7, 8, 17, 22, 25])
const CARDINALS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest']

const instruction = (distM, turn, road, text, [lon, lat]) => ({
  dist_m: distM, turn, angle: 0, road, text, lon, lat, caution: false,
})

/**
 * Le tracé complet d'un trajet, et ses consignes, mis à notre forme.
 *
 * **Les consignes du calculateur ne se lisent pas telles quelles.** Elles ne
 * disent pas où elles tombent — le guidage, qui compare la distance courue à
 * celle de chaque consigne, annonçait « dans NaN mètres » —, elles vouvoient,
 * et chaque point de passage demandé pour dessiner la boucle y est une
 * arrivée : « Vous êtes arrivé à destination », trois fois par sortie. On
 * garde donc ce qu'elles savent — où tourner, et de quel côté — et on le dit
 * comme le reste de l'app : départ, virages, arrivée.
 */
export function readTrip(trip) {
  const geometry = []
  const marks = []
  trip.legs.forEach((leg, l) => {
    const points = decodeShape(leg.shape)
    // Le dernier point d'un tronçon est le premier du suivant.
    const offset = geometry.length ? geometry.length - 1 : 0
    for (const point of geometry.length ? points.slice(1) : points) geometry.push(point)
    const maneuvers = leg.maneuvers ?? []
    maneuvers.forEach((m, k) => {
      // Le départ et l'arrivée d'un tronçon intermédiaire ne sont que des
      // points de passage : on n'y part ni n'y arrive.
      const opens = k === 0
      const closes = k === maneuvers.length - 1 && k > 0
      if ((opens && l > 0) || (closes && l < trip.legs.length - 1)) return
      marks.push({ m, index: offset + (m.begin_shape_index ?? 0), start: opens && l === 0, finish: closes && l === trip.legs.length - 1 })
    })
  })
  if (geometry.length < 2) return { geometry, instructions: [] }

  const cumulative = [0]
  for (let i = 1; i < geometry.length; i += 1) cumulative.push(cumulative[i - 1] + haversineM(geometry[i - 1], geometry[i]))
  const total = cumulative[cumulative.length - 1]
  const last = geometry.length - 1

  const instructions = []
  for (const { m, index, start, finish } of marks) {
    const i = Math.max(0, Math.min(last, index))
    const road = m.street_names?.[0] ?? null
    if (start) {
      const [heading] = headings(geometry)
      const words = CARDINALS[Math.trunc(pymod(heading + 22.5, 360) / 45)]
      instructions.push(instruction(0, 'start', road, `Départ — pars vers ${words}${road ? ` sur ${road}` : ''}.`, geometry[0]))
      continue
    }
    if (finish) {
      instructions.push(instruction(pyRound(total, 1), 'finish', null, 'Tu es revenu au point de départ. Boucle terminée.', geometry[0]))
      continue
    }
    if (VALHALLA_QUIET.has(m.type) || i === 0 || i === last) continue
    let turn = VALHALLA_TURNS[m.type]
    if (!turn) {
      // Une manœuvre qu'on ne sait pas nommer — un rond-point, un type
      // inconnu : l'angle du tracé à cet endroit dit de quel côté tourner.
      const [, arrival] = headings(geometry.slice(Math.max(0, i - 8), i + 1))
      const [departure] = headings(geometry.slice(i, i + 9))
      turn = turnOf(pymod(departure - arrival + 180, 360) - 180).turn
    }
    if (turn === 'straight') continue
    instructions.push(instruction(pyRound(cumulative[i], 1), turn, road, turnPhrase(turn, road), geometry[i]))
  }
  return { geometry, instructions }
}

/** Longueur d'un tracé, en mètres. */
const lengthOf = (geometry) => {
  let total = 0
  for (let i = 1; i < geometry.length; i += 1) total += haversineM(geometry[i - 1], geometry[i])
  return total
}

/** Cap moyen de la première moitié, pour écarter deux boucles jumelles. */
function bearingOf(geometry) {
  if (geometry.length < 2) return 0
  const [x0, y0] = geometry[0]
  const [x1, y1] = geometry[Math.trunc(geometry.length / 2)]
  const kx = Math.cos((y0 * Math.PI) / 180)
  return (((Math.atan2((x1 - x0) * kx, y1 - y0) * 180) / Math.PI) + 360) % 360
}

/**
 * Le modèle d'itinéraire de l'app, rempli de ce qu'on sait — et **uniquement**
 * de ce qu'on sait. Pas de note, pas de part exposée, pas de revêtement : le
 * calculateur ne les connaît pas, et les inventer serait pire que de les taire.
 */
function toModel(trip, geometry, instructions, req, rank) {
  const distanceM = lengthOf(geometry)
  return {
    id: `x${rank}-${Math.trunc(distanceM)}`,
    name: `Boucle ${['A', 'B', 'C', 'D', 'E', 'F'][rank] ?? rank + 1}`,
    distance_m: pyRound(distanceM, 1),
    duration_s: Math.trunc((distanceM / 1000) * req.seconds_per_km),
    ascent_m: null,
    descent_m: null,
    geometry,
    // Un seul tronçon, sans risque connu : la carte le dessinera d'un trait
    // neutre plutôt que de laisser croire à une évaluation.
    segments: [
      {
        coords: geometry,
        length_m: pyRound(distanceM, 1),
        risk: null,
        // « unknown » et non `null` : sans niveau, la carte retombe sur sa
        // couleur par défaut — le vert des voies protégées — et ferait croire à
        // une évaluation qui n'a pas eu lieu.
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
    instructions,
    safety: null,
    surfaces: { paved_m: 0, gravel_m: 0, trail_m: 0, unknown_m: pyRound(distanceM, 1) },
    roundness: null,
    bearing: pyRound(bearingOf(geometry), 1),
    laps: 1,
    graded: false,
    // Calculé ailleurs : le moteur de l'appareil n'en garde rien, et ne saurait
    // ni le retourner ni le recalculer.
    remote: true,
  }
}

/**
 * Des boucles calculées par le service public, quand on n'a pas les rues.
 *
 * `req` est la demande déjà normalisée. Rend `{routes, meta}` comme `planLoops`,
 * avec `meta.remote` pour que l'écran le dise.
 */
export async function planRemote(req, { fetchImpl = fetch } = {}) {
  const targetM = req.distance_km * 1000
  const lo = targetM * (1 - req.tolerance)
  const hi = targetM * (1 + req.tolerance)
  const found = []
  const start = { lat: req.lat, lon: req.lon }

  for (const sides of SHAPES) {
    for (const heading of HEADINGS) {
      if (found.length >= req.limit) break
      let aim = targetM
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const points = waypoints(req.lat, req.lon, aim, sides, heading)
        const trip = await ask([start, ...points, start], req.sport, fetchImpl)
        if (!trip) break
        const { geometry, instructions } = readTrip(trip)
        if (geometry.length < 4) break
        const distanceM = lengthOf(geometry)
        if (lo <= distanceM && distanceM <= hi) {
          found.push({ trip, geometry, instructions, distanceM })
          break
        }
        // Trop court ou trop long : on corrige la visée une fois, en gardant la
        // même direction, plutôt que de demander au hasard.
        const correction = targetM / Math.max(distanceM, 1)
        if (correction < 0.5 || correction > 2) break
        aim *= correction
      }
    }
    if (found.length >= req.limit) break
  }

  if (!found.length) return null

  // Les plus proches de la distance voulue d'abord, et pas deux fois la même
  // direction.
  found.sort((a, b) => Math.abs(a.distanceM - targetM) - Math.abs(b.distanceM - targetM))
  const kept = []
  const ecart = (a, b) => Math.abs((((a - b + 540) % 360) - 180))
  for (const candidate of found) {
    const cap = bearingOf(candidate.geometry)
    // Deux boucles qui partent dans la même direction se ressemblent trop pour
    // mériter deux cartes.
    if (kept.some((other) => ecart(bearingOf(other.geometry), cap) < 45)) continue
    kept.push(candidate)
    if (kept.length >= req.limit) break
  }

  const routes = kept.map((c, rank) => toModel(c.trip, c.geometry, c.instructions, req, rank))
  await addElevation(routes, fetchImpl)
  return {
    routes,
    rejected: [],
    meta: {
      remote: 'valhalla',
      graph_nodes: 0,
      graph_edges: 0,
      raw_candidates: found.length,
      off_target: 0,
      rejected_by: {},
      relaxed: false,
      night: false,
      wind: null,
      engine: 'valhalla',
      message:
        "Les rues de ce coin ne sont pas encore arrivées : ces boucles viennent d'un calculateur public. Elles t'emmènent quelque part, mais Lacet n'a pas pu juger leur sécurité — ni trottoirs, ni vitesses, ni traversées.",
    },
  }
}

/**
 * Le dénivelé et le profil, ajoutés après coup.
 *
 * Un échec ne coûte rien : les boucles restent affichables sans leur courbe,
 * comme quand l'IGN ne répond pas à une recherche ordinaire.
 */
async function addElevation(routes, fetchImpl) {
  try {
    const sampled = routes.map((route) => resample(route.geometry, ELEVATION_STEP_M).map(([, c]) => c))
    const fetched = await fetchMany(sampled, { fetchImpl })
    // Chaque tracé revient avec ses altitudes **et le seuil de sa source**
    // (`{values, threshold}`), comme pour les boucles calculées ici. Lu comme
    // une simple liste, il ne donnait jamais rien : les boucles de secours
    // restaient sans dénivelé.
    fetched.forEach((relief, i) => {
      if (!relief?.values?.length) return
      const { values: lissees, threshold } = shapeRelief(relief, ELEVATION_STEP_M)
      const [ascent, descent] = ascentDescent(lissees, threshold)
      routes[i].ascent_m = pyRound(ascent, 1)
      routes[i].descent_m = pyRound(descent, 1)
      routes[i].elevation_profile = lissees.map((ele, k) => ({
        // Le dernier point est la fin du tracé, pas un pas de plus.
        dist_m: pyRound(Math.min(k * ELEVATION_STEP_M, routes[i].distance_m), 1),
        ele_m: pyRound(ele, 1),
        surface: 'unknown',
      }))
    })
  } catch {
    /* sans relief, mais avec des boucles */
  }
}

