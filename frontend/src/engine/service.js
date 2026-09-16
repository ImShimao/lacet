// Orchestration : de la demande aux itinéraires notés — portage fidèle de
// `backend/app/service.py` et de la validation de `models.py`.
//
// La réponse a exactement la forme de l'API (`LoopResponse`), clés comprises :
// l'interface ne voit pas la différence entre un calcul fait par le serveur et
// un calcul fait sur l'appareil.
//
// L'accès aux données est injecté (`deps`) : le même code tourne dans l'app,
// avec le téléchargement et le cache réels, et dans les tests de parité, avec
// l'extrait figé que Python a lui aussi reçu.

import { resample, haversineM } from './geo'
import { Candidate, generateLoops, repeatLoop, similarity } from './loops'
import { buildInstructions } from './navigation'
import { pyFixed, pyfloordiv, pymod, pyRound, pyRoundInt, sortByKey } from './py'
import { gradeRoute, runGate } from './safety'
import { buildProfile } from './weights'
import { ascentDescent, currentWind, fetchMany, isNight, smooth, tailwindFinish } from './environment'

export const SETTINGS = { sectors: 16, maxCandidates: 32, elevationSampleM: 100 }

const ELEVATION_TARGET_PER_KM = { flat: 3, rolling: 10, hilly: 22 }
const ELEVATION_TOLERANCE_PER_KM = 5
const ELEVATION_BAND_PER_KM = { flat: [0, 10], rolling: [3, 20], hilly: [12, Infinity] }
const OUT_OF_BAND_PENALTY = 0.8
const DUPLICATE_THRESHOLD = 0.55
const VARIETY_OVERLAP_WEIGHT = 0.45
const VARIETY_BEARING_WEIGHT = 0.3
const BEARING_SPREAD_DEG = 90
const WIND_WEIGHT = 0.1
const LAP_DIVISORS = [2, 3, 4]
const MIN_LAP_M = 1500
const LAP_PENALTY = 0.12
const MIN_ROUNDNESS = 0.12
const GRADE_PENALTY = 0.9
const GRADE_RANK = { A: 0, B: 1, C: 2 }
const CROSSINGS_REFERENCE = 3
const GOOD_ROUNDNESS = 0.55
const MAX_ELEVATION_SAMPLES = 300
const CARDINALS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

const shortlistSize = (limit) => limit + Math.max(6, limit)

/** Refus métier, à montrer tel quel à l'utilisateur. */
export class PlanningError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PlanningError'
  }
}

// === validation — `LoopRequest` ===============================================

const MAX_DISTANCE_KM = { run: 60, bike: 250 }
const ENUMS = {
  sport: ['run', 'bike'],
  surface: ['road', 'mixed', 'trail'],
  elevation: ['flat', 'rolling', 'hilly'],
  safety: ['safe', 'standard'],
  time_of_day: ['day', 'night', 'auto'],
}

function bounded(value, name, { min = -Infinity, max = Infinity, gt = -Infinity, integer = false }) {
  const n = Number(value)
  if (!Number.isFinite(n) || n > max || n < min || n <= gt || (integer && !Number.isInteger(n))) {
    throw new PlanningError(`Paramètre ${name} invalide.`)
  }
  return n
}

export function normalizeRequest(input) {
  const req = {
    lat: bounded(input.lat, 'lat', { min: -90, max: 90 }),
    lon: bounded(input.lon, 'lon', { min: -180, max: 180 }),
    sport: input.sport ?? 'run',
    distance_km: input.distance_km ?? null,
    duration_min: input.duration_min ?? null,
    tolerance: input.tolerance ?? 0.1,
    surface: input.surface ?? 'mixed',
    elevation: input.elevation ?? 'rolling',
    safety: input.safety ?? 'safe',
    time_of_day: input.time_of_day ?? 'auto',
    pace_sec_per_km: input.pace_sec_per_km ?? 390,
    speed_kmh: input.speed_kmh ?? 20,
    limit: input.limit ?? 5,
    with_elevation: input.with_elevation ?? true,
  }
  for (const [key, values] of Object.entries(ENUMS)) {
    if (!values.includes(req[key])) throw new PlanningError(`Paramètre ${key} invalide.`)
  }
  if (req.distance_km !== null) req.distance_km = bounded(req.distance_km, 'distance_km', { gt: 0.3, max: 250 })
  if (req.duration_min !== null) {
    req.duration_min = bounded(req.duration_min, 'duration_min', { min: 5, max: 900, integer: true })
  }
  req.tolerance = bounded(req.tolerance, 'tolerance', { min: 0.02, max: 0.35 })
  req.pace_sec_per_km = bounded(req.pace_sec_per_km, 'pace_sec_per_km', { min: 150, max: 1200, integer: true })
  req.speed_kmh = bounded(req.speed_kmh, 'speed_kmh', { min: 5, max: 60 })
  req.limit = bounded(req.limit, 'limit', { min: 1, max: 12, integer: true })

  req.seconds_per_km = req.sport === 'bike' ? 3600 / req.speed_kmh : req.pace_sec_per_km

  if (req.distance_km === null && req.duration_min === null) {
    throw new PlanningError('Indique une distance ou une durée.')
  }
  if (req.distance_km !== null && req.duration_min !== null) {
    throw new PlanningError('Choisis une distance ou une durée, pas les deux.')
  }
  if (req.distance_km === null) req.distance_km = (req.duration_min * 60) / req.seconds_per_km

  const ceiling = MAX_DISTANCE_KM[req.sport]
  if (req.distance_km > ceiling) {
    const label = req.sport === 'run' ? 'à pied' : 'à vélo'
    throw new PlanningError(
      `${pyFixed(req.distance_km, 0)} km, c'est au-delà de ce que l'app sait calculer ${label} (maximum ${pyFixed(ceiling, 0)} km).`,
    )
  }
  if (req.distance_km < 0.5) throw new PlanningError('Vise au moins 500 m.')
  return req
}

/** Rayon de l'extrait à télécharger — celui de `plan_loops`. */
export function extractRadiusM(targetM) {
  return Math.ceil(Math.max(1500, targetM * 0.62) / 1000) * 1000
}

// === orchestration ============================================================

/**
 * @param input  la demande, dans la forme de l'API
 * @param deps.loadGraph  async ({lat, lon, radiusM, targetM, sport, allowTrail}) → Graph
 * @param deps.onProgress (étape, fraction) — pour l'interface
 */
export async function planLoops(input, deps) {
  const {
    loadGraph,
    fetchElevations = fetchMany,
    wind: windOf = currentWind,
    now = () => new Date(),
    settings = SETTINGS,
    onProgress = () => {},
    // Points d'observation des tests de parité : le graphe construit, et chaque
    // lot de candidats bruts. Sans effet quand ils sont absents.
    trace = {},
  } = deps

  const started = performance.now()
  const timings = {}
  const lap = (name) => {
    const previous = Object.values(timings).reduce((a, b) => a + b, 0)
    timings[name] = pyRound((performance.now() - started) / 1000 - previous, 2)
  }

  const req = normalizeRequest(input)
  const targetM = req.distance_km * 1000

  const radiusM = extractRadiusM(targetM)
  const allowTrail = req.surface === 'trail'
  onProgress('data', 0)
  const graph = await loadGraph({ lat: req.lat, lon: req.lon, radiusM, targetM, sport: req.sport, allowTrail })
  trace.graph?.(graph)
  lap('fetch')
  lap('graph')

  if (!graph.edgeCount) {
    throw new PlanningError(
      "Aucune voie praticable n'a été trouvée autour de ce point. Essaie un départ plus proche d'une zone habitée.",
    )
  }

  let start = graph.nearestNode(req.lon, req.lat)
  if (start === null) {
    throw new PlanningError(
      'Impossible de raccorder ce point de départ au réseau piéton (aucune voie à moins de 2 km).',
    )
  }

  const probe = Math.max(2000, Math.trunc(graph.nodeCount / 20))
  if (graph.localComponentSize(start, probe) < probe) {
    const component = graph.largestComponent()
    if (!component[start]) {
      const relocated = graph.nearestNode(req.lon, req.lat, 2000, component)
      if (relocated === null) {
        throw new PlanningError(
          'Ce point de départ est sur une portion de réseau isolée, sans liaison praticable vers le reste. Décale-toi de quelques rues.',
        )
      }
      start = relocated
    }
  }

  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  const profile = buildProfile(req.surface, req.safety, night, req.sport)

  const windTask = windOf(req.lat, req.lon)

  onProgress('routing', 0)
  const raw = generateLoops(graph, start, targetM, profile, {
    sectors: settings.sectors,
    maxCandidates: settings.maxCandidates,
    tolerance: req.tolerance,
  })
  trace.raw?.(start, targetM, raw)
  lap('routing')

  const lo = targetM * (1 - req.tolerance)
  const hi = targetM * (1 + req.tolerance)

  let [unique, rejected, offTarget] = collect(raw, lo, hi, req.safety, req, graph, start, profile, targetM, trace)

  let relaxed = false
  if (!unique.length && req.safety === 'safe') {
    ;[unique] = collect(raw, lo, hi, 'standard', req, graph, start, profile, targetM, trace)
    relaxed = unique.length > 0
  }

  const shortlist = unique.slice(0, shortlistSize(req.limit))

  onProgress('elevation', 0)
  const profiles = new Map()
  const sampleM = Math.max(settings.elevationSampleM, targetM / MAX_ELEVATION_SAMPLES)
  if (req.with_elevation && shortlist.length) {
    const sampled = shortlist.map((cand) => resample(cand.geometry, sampleM).map(([, c]) => c))
    const fetched = await fetchElevations(sampled)
    fetched.forEach((elevations, i) => {
      if (elevations && elevations.length) {
        const smoothed = smooth(elevations)
        profiles.set(i, [smoothed, profilePoints(shortlist[i], smoothed, sampleM)])
      }
    })
  }
  lap('elevation')

  const wind = await windTask
  const scored = shortlist.map((cand, i) => {
    const elev = profiles.get(i)
    const gain = elev ? ascentDescent(elev[0])[0] : null
    return [finalScore(cand, targetM, req, gain, wind), cand, i]
  })
  sortByKey(scored, (t) => -t[0])
  const chosen = selectVaried(scored, req.limit)

  const names = nameRoutes(chosen.map(([, cand]) => cand))
  const routes = chosen.map(([score, cand, idx], rank) =>
    toModel(cand, score, req, profiles.get(idx) ?? null, rank, buildInstructions(graph, start, cand), names[rank]),
  )

  const rejectedBy = {}
  for (const r of rejected) rejectedBy[r.reason] = (rejectedBy[r.reason] ?? 0) + 1

  const meta = {
    night,
    graph_nodes: graph.nodeCount,
    graph_edges: graph.edgeCount,
    raw_candidates: raw.length,
    off_target: offTarget,
    rejected_by: rejectedBy,
    relaxed,
    wind:
      wind !== null && wind.matters
        ? { bearing: pyRoundInt(wind.bearing), speed_kmh: pyRound(wind.speedKmh, 1) }
        : null,
    elapsed_s: pyRound((performance.now() - started) / 1000, 2),
    timings_s: timings,
    lambda: profile.lam,
    engine: 'local',
  }
  if (relaxed) {
    meta.message =
      "Aucun itinéraire d'ici ne tient les seuils du mode Sûr : le réseau impose de longer la route. Voici ce qui existe malgré tout, avec le détail des portions exposées — à toi de juger."
  } else if (!routes.length) {
    meta.message = noResultMessage(req, rejected, offTarget)
  }

  return { routes, rejected: rejected.slice(0, 6), meta }
}

function collect(raw, lo, hi, mode, req, graph, start, profile, targetM, trace) {
  const [passed, rejected, offTarget] = applyGate(raw, lo, hi, mode, req.sport)
  sortByKey(passed, (c) => -preliminaryScore(c, targetM, req.tolerance))

  const unique = []
  for (const cand of passed) {
    if (unique.some((kept) => similarity(cand, kept) > DUPLICATE_THRESHOLD)) continue
    unique.push(cand)
  }

  if (unique.length < req.limit) {
    unique.push(...lapOptions(graph, start, req, profile, targetM, mode, req.limit - unique.length, trace))
  }
  return [unique, rejected, offTarget]
}

function lapOptions(graph, start, req, profile, targetM, mode, needed, trace) {
  const out = []
  for (const laps of LAP_DIVISORS) {
    if (out.length >= needed) break
    const lapTarget = targetM / laps
    if (lapTarget < MIN_LAP_M) break

    const raw = generateLoops(graph, start, lapTarget, profile, {
      sectors: SETTINGS.sectors,
      maxCandidates: SETTINGS.maxCandidates,
      tolerance: req.tolerance,
    })
    trace.raw?.(start, lapTarget, raw)
    const lo = lapTarget * (1 - req.tolerance)
    const hi = lapTarget * (1 + req.tolerance)
    const [passed] = applyGate(raw, lo, hi, mode, req.sport)
    sortByKey(passed, (c) => -preliminaryScore(c, lapTarget, req.tolerance))

    for (const cand of passed) {
      if (out.length >= needed) break
      if (out.some((kept) => similarity(cand, kept) > DUPLICATE_THRESHOLD)) continue
      const repeated = repeatLoop(graph, start, cand, laps)
      if (!runGate(repeated.stats, mode, req.sport).passed) continue
      out.push(repeated)
    }
  }
  return out
}

function applyGate(raw, lo, hi, mode, sport) {
  const passed = []
  const rejected = []
  let offTarget = 0
  for (const cand of raw) {
    const stats = cand.stats
    if (!(lo <= stats.distanceM && stats.distanceM <= hi)) {
      offTarget += 1
      continue
    }
    if (cand.roundness < MIN_ROUNDNESS) {
      rejected.push({
        reason: 'shape',
        label: "aller-retour déguisé plutôt qu'une vraie boucle",
        distance_m: pyRoundInt(stats.distanceM),
      })
      continue
    }
    const gate = runGate(stats, mode, sport)
    if (!gate.passed) {
      rejected.push({ reason: gate.failures[0].code, label: gate.firstLabel, distance_m: pyRoundInt(stats.distanceM) })
      continue
    }
    passed.push(cand)
  }
  return [passed, rejected, offTarget]
}

// === notation =================================================================

export function preliminaryScore(cand, targetM, tolerance) {
  const s = cand.stats
  const distError = Math.abs(s.distanceM - targetM) / Math.max(targetM * tolerance, 1)
  const distance = Math.max(0, 1 - distError)
  const safety =
    Math.max(0, 1 - s.exposedShare / 0.05) * 0.45 +
    s.protectedShare * 0.3 +
    Math.max(0, 1 - s.unprotectedCrossings / CROSSINGS_REFERENCE) * 0.25
  const variety = 1 - Math.min(1, s.overlapShare)
  const shape = Math.min(1, cand.roundness / GOOD_ROUNDNESS)
  return 0.32 * distance + 0.4 * safety + 0.1 * variety + 0.18 * shape
}

const gradePenalty = (cand) => GRADE_PENALTY * GRADE_RANK[gradeRoute(cand.stats)[0]]

export function finalScore(cand, targetM, req, ascentM, wind = null) {
  let quality = preliminaryScore(cand, targetM, req.tolerance)
  let offBand = 0

  if (ascentM !== null) {
    const perKm = ascentM / Math.max(cand.stats.distanceM / 1000, 0.1)
    const target = ELEVATION_TARGET_PER_KM[req.elevation]
    const elevation = 1 / (1 + Math.abs(perKm - target) / ELEVATION_TOLERANCE_PER_KM)
    quality = 0.72 * quality + 0.28 * elevation
    const [low, high] = ELEVATION_BAND_PER_KM[req.elevation]
    if (!(low <= perKm && perKm <= high)) offBand = OUT_OF_BAND_PENALTY
  }

  if (wind !== null && wind.matters) {
    const tail = tailwindFinish(cand.geometry, wind)
    quality += WIND_WEIGHT * wind.strength * (tail - 0.5) * 2
  }

  return quality - gradePenalty(cand) - offBand - LAP_PENALTY * (cand.laps - 1)
}

export function selectVaried(scored, limit) {
  const remaining = [...scored]
  const chosen = []
  while (remaining.length && chosen.length < limit) {
    let bestIndex = 0
    let bestValue = -Infinity
    remaining.forEach(([score, cand], i) => {
      const value = score - varietyPenalty(cand, chosen)
      if (value > bestValue) {
        bestValue = value
        bestIndex = i
      }
    })
    chosen.push(remaining.splice(bestIndex, 1)[0])
  }
  return chosen
}

function varietyPenalty(cand, chosen) {
  if (!chosen.length) return 0
  let overlap = -Infinity
  let closest = Infinity
  for (const [, kept] of chosen) {
    overlap = Math.max(overlap, similarity(cand, kept))
    closest = Math.min(closest, Math.abs(pymod(cand.bearing - kept.bearing + 180, 360) - 180))
  }
  const crowding = Math.max(0, 1 - closest / BEARING_SPREAD_DEG)
  return VARIETY_OVERLAP_WEIGHT * overlap + VARIETY_BEARING_WEIGHT * crowding
}

// === conversion vers la réponse ===============================================

function profilePoints(cand, elevations, step) {
  const spans = []
  let cursor = 0
  for (const seg of cand.segments) {
    spans.push([cursor, cursor + seg.lengthM, seg.surface])
    cursor += seg.lengthM
  }
  const out = []
  let spanIdx = 0
  elevations.forEach((ele, i) => {
    const dist = Math.min(i * step, cursor)
    while (spanIdx < spans.length - 1 && dist > spans[spanIdx][1]) spanIdx += 1
    const surface = spans.length ? spans[spanIdx][2] : 'unknown'
    out.push({ dist_m: pyRound(dist, 1), ele_m: pyRound(ele, 1), surface })
  })
  return out
}

const round6 = ([lon, lat]) => [pyRound(lon, 6), pyRound(lat, 6)]

function toModel(cand, score, req, elev, rank, steps, name) {
  const s = cand.stats
  const [grade, notes] = gradeRoute(s)
  let ascent = null
  let descent = null
  let profilePts = null
  if (elev) {
    ;[ascent, descent] = ascentDescent(elev[0])
    profilePts = elev[1]
  }

  const surfaces = { paved_m: 0, gravel_m: 0, trail_m: 0, unknown_m: 0 }
  for (const seg of cand.segments) surfaces[`${seg.surface}_m`] += seg.lengthM

  return {
    id: `r${rank}-${Math.trunc(s.distanceM)}`,
    name,
    distance_m: pyRound(s.distanceM, 1),
    duration_s: Math.trunc((s.distanceM / 1000) * req.seconds_per_km),
    ascent_m: ascent,
    descent_m: descent,
    geometry: cand.geometry.map(round6),
    segments: cand.segments.map((seg) => ({
      coords: seg.coords.map(round6),
      length_m: pyRound(seg.lengthM, 1),
      risk: pyRound(seg.risk, 3),
      level: seg.level,
      separation: seg.separation,
      speed_kmh: seg.speedKmh,
      surface: seg.surface,
      lit: seg.lit,
      road: seg.road,
      inferred: seg.inferred,
    })),
    crossings: cand.crossings.map((c) => ({
      lon: pyRound(c.lon, 6),
      lat: pyRound(c.lat, 6),
      protected: c.protected,
      speed_kmh: c.speedKmh,
      kind: c.kind,
    })),
    elevation_profile: profilePts,
    instructions: steps,
    safety: {
      grade,
      protected_share: pyRound(s.protectedShare, 4),
      exposed_m: pyRound(s.exposedM, 1),
      exposed_share: pyRound(s.exposedShare, 4),
      longest_exposed_m: pyRound(s.longestExposedM, 1),
      unprotected_crossings: s.unprotectedCrossings,
      protected_crossings: s.protectedCrossings,
      unlit_m: s.unlitM !== null ? pyRound(s.unlitM, 1) : null,
      inferred_share: pyRound(s.inferredShare, 4),
      notes,
    },
    surfaces,
    roundness: pyRound(cand.roundness, 3),
    bearing: pyRound(cand.bearing, 1),
    direction: directionOf(cand.bearing),
    shape: cand.shape,
    laps: cand.laps,
    lap_distance_m: pyRound(s.distanceM / cand.laps, 1),
    score: pyRound(score, 4),
  }
}

const directionOf = (bearing) => CARDINALS[Math.trunc(pyfloordiv(pymod(bearing + 22.5, 360), 45))]

export function nameRoutes(cands) {
  const perRoute = cands.map(roadLengths)
  const total = new Map()
  for (const lengths of perRoute) {
    for (const [road, m] of lengths) total.set(road, (total.get(road) ?? 0) + m)
  }

  const used = new Set()
  return cands.map((cand, i) => {
    const direction = directionOf(cand.bearing)
    const road = mostDistinctive(perRoute[i], total, used)
    if (road === null) return `Boucle ${direction}`
    used.add(road)
    return `Boucle ${direction} · ${road}`
  })
}

function roadLengths(cand) {
  const lengths = new Map()
  for (const seg of cand.segments) {
    if (seg.road) lengths.set(seg.road, (lengths.get(seg.road) ?? 0) + seg.lengthM)
  }
  return lengths
}

function mostDistinctive(lengths, total, used) {
  let best = null
  let bestScore = 0
  for (const [road, mine] of lengths) {
    if (used.has(road)) continue
    const score = 2 * mine - total.get(road)
    if (score > bestScore) {
      bestScore = score
      best = road
    }
  }
  if (best === null && lengths.size) {
    let longest = -Infinity
    for (const [road, m] of lengths) {
      if (m > longest) {
        longest = m
        best = road
      }
    }
  }
  return best
}

function noResultMessage(req, rejected, offTarget) {
  const reasons = new Map()
  for (const r of rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)

  if (!reasons.size) {
    if (offTarget) {
      return 'Aucune boucle ne tombe dans la fourchette de distance depuis ce point. Vise une distance un peu différente, ou élargis la tolérance.'
    }
    return "Aucune boucle n'a pu être tracée depuis ce point. Le réseau piéton y est peut-être trop peu maillé pour cette distance."
  }

  let top = null
  let topCount = -Infinity
  for (const [reason, count] of reasons) {
    if (count > topCount) {
      topCount = count
      top = reason
    }
  }
  if (top === 'shape') {
    return 'Les seuls trajets possibles à cette distance sont des allers-retours, pas des boucles. Essaie une autre distance ou un départ plus central.'
  }
  if (top === 'crossings') {
    return 'Toutes les boucles à cette distance traversent trop de routes rapides sans passage protégé. Une distance plus courte reste souvent dans le bourg ; le mode Standard, lui, te les montrera avec le détail.'
  }
  if (req.safety === 'safe') {
    return 'Tous les itinéraires possibles depuis ce point passent trop longtemps au contact du trafic pour le mode Sûr. Le mode Standard te montrera ce qui existe, avec le détail des zones exposées.'
  }
  return 'Aucun itinéraire ne satisfait les critères. Essaie une autre distance ou un autre point de départ.'
}

export { Candidate, haversineM }
