// Le modèle de sécurité : L0 exclusion, L1+L2 risque, L3 portail, L4 nuit.
//
// Portage fidèle de `backend/app/safety/` — `exclusion.py`, `risk.py`,
// `gate.py` et `night.py`. Les raisons de chaque seuil, de chaque vitesse par
// défaut et de chaque règle du doute y sont expliquées ; c'est la référence.
// Ce fichier doit en rester le reflet exact : les tests de parité le vérifient.

import { pyFixed, pyRoundInt } from './py'

// --- chaînes Python -----------------------------------------------------------

/** Caractères que `str.strip()` retire, énumérés : le `\s` de JavaScript en
 *  diffère dans les deux sens — il inclut le BOM (U+FEFF), que Python garde, et
 *  ignore les séparateurs \x1c–\x1f et \x85, que Python retire. */
const PY_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const STRIP = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, 'g')
const pyStrip = (s) => s.replace(STRIP, '')

/**
 * `float(str)` de Python, ou `null` là où il lèverait `ValueError`.
 *
 * `Number()` n'est pas un équivalent : il rend 0 pour une chaîne vide, 16 pour
 * « 0x10 », et refuse « 5_0 » que Python accepte. Sur un tag `maxspeed`, ce sont
 * autant de vitesses fausses.
 */
const DIGITS = '\\d(?:_?\\d)*'
const PY_FLOAT = new RegExp(
  `^[+-]?(?:(?:(?:${DIGITS})?\\.${DIGITS}|${DIGITS}\\.?)(?:[eE][+-]?${DIGITS})?|inf|infinity|nan)$`,
  'i',
)
export function pyFloat(raw) {
  const s = pyStrip(raw)
  if (!PY_FLOAT.test(s)) return null
  const lower = s.toLowerCase().replace(/^[+-]/, '')
  const sign = s.startsWith('-') ? -1 : 1
  if (lower === 'inf' || lower === 'infinity') return sign * Infinity
  if (lower === 'nan') return NaN
  return Number(s.replace(/_/g, ''))
}

const has = (set, value) => value !== undefined && set.has(value)

// === L0 — exclusion ===========================================================

const EXCLUDED_HIGHWAY = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed',
  'raceway', 'bus_guideway', 'escape', 'corridor', 'elevator',
])
const ALLOWED = new Set(['yes', 'designated', 'permissive', 'destination', 'official'])
const SAC_FORBIDDEN = new Set([
  'demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking',
])
const NON_ROUTABLE = new Set(['platform', 'rest_area', 'services', 'emergency_bay'])
const PEDESTRIAN_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'living_street'])

/** Motif d'exclusion, ou `null` si la voie est admissible. */
export function isExcluded(tags, { allowTrail = false, sport = 'run' } = {}) {
  const highway = tags.highway ?? ''

  if (sport === 'bike') {
    if (highway === 'steps') return 'escaliers'
    if (tags.bicycle === 'no' || tags.bicycle === 'private') return `bicycle=${tags.bicycle}`
  }

  if (EXCLUDED_HIGHWAY.has(highway)) return `highway=${highway}`
  if (NON_ROUTABLE.has(highway)) return `highway=${highway}`

  // Chacun ses droits : à vélo, `foot=no` ne ferme rien — c'est le marquage
  // d'une piste cyclable interdite aux piétons —, et `access=no` se rouvre par
  // `bicycle`. Voir `exclusion.py`.
  const own = sport === 'bike' ? tags.bicycle : tags.foot
  if (sport !== 'bike' && (own === 'no' || own === 'private')) return `foot=${own}`

  const access = tags.access
  if ((access === 'no' || access === 'private') && !has(ALLOWED, own)) return `access=${access}`

  if (tags.route === 'ferry') return 'route=ferry'
  if (tunnelIsUnprotected(tags)) return 'tunnel sans trottoir'
  if (!allowTrail && has(SAC_FORBIDDEN, tags.sac_scale)) return `sac_scale=${tags.sac_scale}`

  // Chemins disparus, dans tous les modes ; mal tracés, hors mode Sentier.
  // Exclus plutôt que pénalisés : voir la mesure dans `exclusion.py`.
  for (const state of ['abandoned', 'disused']) {
    if (tags[state] === 'yes' || tags[`${state}:highway`] === highway) return state
  }
  if (tags.trail_visibility === 'horrible' || tags.trail_visibility === 'no') {
    return `trail_visibility=${tags.trail_visibility}`
  }
  if (tags.smoothness === 'impassable' && (sport === 'bike' || !allowTrail)) return 'smoothness=impassable'
  if (!allowTrail) {
    if (tags.trail_visibility === 'bad') return 'trail_visibility=bad'
    if (tags.informal === 'yes') return 'informal=yes'
  }

  if (tags.highway === 'road' && tags.area === 'yes') return 'surface indéfinie'
  return null
}

// === sens unique ==============================================================

const ONEWAY_FORWARD = new Set(['yes', '1', 'true'])
const ONEWAY_BACKWARD = new Set(['-1', 'reverse'])
const CONTRAFLOW = new Set(['opposite', 'opposite_lane', 'opposite_track', 'opposite_share_busway'])
const CYCLEWAY_KEYS = ['cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both']
const CYCLEWAY_ONEWAY_KEYS = ['cycleway:left:oneway', 'cycleway:right:oneway', 'cycleway:both:oneway']
// L'anneau d'un rond-point, dessiné dans le sens de la circulation — `RING_JUNCTIONS`.
export const RING_JUNCTIONS = new Set(['roundabout', 'circular'])

/** Le sens permis : 1 dans le sens de la voie, -1 à rebours, 0 les deux — `oneway_for`. */
export function onewayFor(tags, sport = 'run') {
  if (sport !== 'bike') return 0
  const own = tags['oneway:bicycle']
  if (own === undefined) {
    if (CYCLEWAY_KEYS.some((key) => has(CONTRAFLOW, tags[key]))) return 0
    if (CYCLEWAY_ONEWAY_KEYS.some((key) => tags[key] === 'no' || tags[key] === '-1')) return 0
  }
  const value = own !== undefined ? own : tags.oneway
  if (has(ONEWAY_FORWARD, value)) return 1
  if (has(ONEWAY_BACKWARD, value)) return -1
  if (value === undefined && has(RING_JUNCTIONS, tags.junction)) return 1
  return 0
}

// === barrières ================================================================
//
// Propre au moteur de l'app. Un portail fermé au bout de sept cents mètres de
// boucle, c'est un demi-tour et un détour improvisé : signalé au retour d'une
// sortie. OpenStreetMap le sait souvent — `barrier=gate` avec `access=private`,
// ou `locked=yes` — mais le moteur ne lisait des nœuds que les passages piétons.
//
// On ne retient que ce qui **ferme** : une barrière sans restriction (la
// plupart des portails de parc, les chicanes, les bornes) se franchit à pied, et
// l'écarter viderait les parcs de leurs allées. Le fichier des tuiles
// (`scripts/region_tiles.py`) garde ces nœuds-là avec les mêmes règles.

const CLOSED_ACCESS = new Set(['no', 'private'])
const OPEN_ACCESS = new Set(['yes', 'designated', 'permissive', 'official'])
// Ce qu'on ne franchit pas avec un vélo, même quand le passage est ouvert.
const NO_BIKE_BARRIERS = new Set(['stile', 'turnstile', 'full-height_turnstile', 'kissing_gate'])

/** Une barrière qui ferme le passage — à pied, ou à vélo selon `sport`. */
export function closedBarrier(tags, sport = 'run') {
  if (!tags?.barrier) return false
  const mode = sport === 'bike' ? tags.bicycle : tags.foot
  if (OPEN_ACCESS.has(mode)) return false
  if (CLOSED_ACCESS.has(mode)) return true
  if (sport === 'bike' && NO_BIKE_BARRIERS.has(tags.barrier)) return true
  return tags.locked === 'yes' || CLOSED_ACCESS.has(tags.access)
}

/** Une barrière à garder dans l'extrait : fermée pour l'un des deux sports. */
export const keptBarrier = (tags) => closedBarrier(tags, 'run') || closedBarrier(tags, 'bike')

export function tunnelIsUnprotected(tags) {
  if (tags.tunnel !== 'yes' && tags.tunnel !== 'building_passage') return false
  if (has(PEDESTRIAN_HIGHWAY, tags.highway)) return false
  return !hasSidewalkTag(tags)
}

const NO_SIDEWALK = new Set(['no', 'none'])
const NO_SIDEWALK_SIDE = new Set(['no', 'none', 'separate'])

function hasSidewalkTag(tags) {
  if (tags.sidewalk !== undefined && !NO_SIDEWALK.has(tags.sidewalk)) return true
  for (const key of ['sidewalk:left', 'sidewalk:right', 'sidewalk:both']) {
    if (tags[key] !== undefined && !NO_SIDEWALK_SIDE.has(tags[key])) return true
  }
  return tags.footway === 'sidewalk'
}

// === L1 + L2 — risque =========================================================

export const DEFAULT_SPEED_KMH = new Map([
  ['primary', 80], ['primary_link', 60], ['secondary', 80], ['secondary_link', 60],
  // Les voies communales à 60 et non 80 — voir `DEFAULT_SPEED_KMH` en Python.
  ['tertiary', 80], ['tertiary_link', 50], ['unclassified', 60], ['residential', 50],
  ['living_street', 20], ['service', 30], ['track', 30], ['pedestrian', 10],
  ['footway', 10], ['path', 10], ['cycleway', 20], ['steps', 5], ['bridleway', 10],
  ['road', 50],
])
const URBAN_DEFAULT_KMH = 50
const DEDICATED_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'bridleway', 'living_street', 'track'])
const SIDEWALK_PRESENT = new Set(['both', 'left', 'right', 'yes', 'separate'])
const SIDEWALK_ABSENT = new Set(['no', 'none'])
const SIDEWALK_SIDES = ['sidewalk:left', 'sidewalk:right', 'sidewalk:both']
const CYCLEWAY_SIDES = ['cycleway:left', 'cycleway:right', 'cycleway:both']
const SHOULDER_PRESENT = new Set(['yes', 'both', 'left', 'right'])
const CYCLEWAY_PRESENT = new Set(['track', 'lane', 'opposite_track', 'opposite_lane', 'share_busway', 'yes'])
const BIKE_DESIGNATED = new Set(['designated', 'yes'])
// La zone piétonne ouverte aux vélos en est une aussi — voir `has_cycleway`.
const BIKE_PATHS = new Set(['path', 'footway', 'track', 'pedestrian'])
// Le motif de séparation d'une voie ouverte aux vélos : `weights.js` le lit.
export const CYCLE_FACILITY = 'aménagement cyclable'
const NO_TRAFFIC = new Set(['path', 'track', 'bridleway', 'living_street', 'pedestrian'])

const PAVED_SURFACES = new Set([
  'asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones',
  'sett', 'cobblestone', 'chipseal', 'metal', 'wood',
])
const GRAVEL_SURFACES = new Set(['compacted', 'gravel', 'fine_gravel', 'pebblestone', 'unpaved', 'rock'])
const TRAIL_SURFACES = new Set(['ground', 'dirt', 'earth', 'grass', 'mud', 'sand', 'woodchips', 'snow', 'ice'])

const FREE_SPEED_KMH = 40
const RISK_SCALE_KMH = 30
export const EXPOSED_RISK = 1.5
const MAX_RISK = 8

export function speedOf(tags, { inBuiltup = false } = {}) {
  const raw = tags.maxspeed
  if (raw) {
    const parsed = parseMaxspeed(raw)
    if (parsed !== null) return parsed
  }
  if ((tags['zone:maxspeed'] ?? '').endsWith(':30')) return 30
  const highway = tags.highway ?? ''
  const fallback = DEFAULT_SPEED_KMH.has(highway) ? DEFAULT_SPEED_KMH.get(highway) : 50
  return inBuiltup ? Math.min(fallback, URBAN_DEFAULT_KMH) : fallback
}

const FR_SPEEDS = new Map([['fr:urban', 50], ['fr:rural', 80], ['fr:motorway', 130]])

function parseMaxspeed(input) {
  const raw = pyStrip(input).toLowerCase()
  if (raw === 'none' || raw === 'signals' || raw === 'variable') return null
  if (raw === 'walk') return 10
  if (raw.endsWith('mph')) {
    const value = pyFloat(raw.replaceAll('mph', ''))
    return value === null ? null : value * 1.60934
  }
  if (raw.startsWith('fr:')) return FR_SPEEDS.has(raw) ? FR_SPEEDS.get(raw) : null
  return pyFloat(raw.replaceAll('km/h', ''))
}

export function hasSidewalk(tags) {
  const main = tags.sidewalk
  if (has(SIDEWALK_PRESENT, main)) return true
  if (has(SIDEWALK_ABSENT, main)) return false
  for (const key of SIDEWALK_SIDES) if (has(SIDEWALK_PRESENT, tags[key])) return true
  if (tags.footway === 'sidewalk') return true
  return null
}

export function hasCycleway(tags) {
  if (tags.highway === 'cycleway') return true
  if (has(BIKE_DESIGNATED, tags.bicycle) && has(BIKE_PATHS, tags.highway)) return true
  if (has(CYCLEWAY_PRESENT, tags.cycleway)) return true
  for (const key of CYCLEWAY_SIDES) if (has(CYCLEWAY_PRESENT, tags[key])) return true
  return false
}

function separationBike(tags, inBuiltup) {
  const highway = tags.highway ?? ''
  if (hasCycleway(tags)) return [2, false, CYCLE_FACILITY]
  if (NO_TRAFFIC.has(highway)) return [2, false, 'voie sans trafic motorisé']
  if (has(SHOULDER_PRESENT, tags.shoulder)) return [1, false, 'accotement']
  if (speedOf(tags, { inBuiltup }) <= 30) return [1, false, 'rue apaisée']
  return [0, false, 'chaussée partagée']
}

function separation(tags, inBuiltup) {
  const highway = tags.highway ?? ''
  if (DEDICATED_HIGHWAY.has(highway)) return [2, false, 'voie dédiée']
  // Pas de voitures sur une piste cyclable — voir `separation` dans `risk.py`.
  if (highway === 'cycleway') return [2, false, 'piste cyclable, sans voitures']
  const sidewalk = hasSidewalk(tags)
  if (sidewalk === true) return [2, false, 'trottoir tagué']
  if (has(SHOULDER_PRESENT, tags.shoulder)) return [1, false, 'accotement']
  if (sidewalk === false) return [0, false, 'absence de trottoir taguée']

  const speed = speedOf(tags, { inBuiltup })
  if (inBuiltup && speed <= 50) return [1.5, true, 'trottoir probable (bâti dense)']
  return [0, true, 'aucun trottoir supposé']
}

export function riskScore(speedKmh, sep) {
  const exposure = Math.max(0, 1 - sep / 2)
  const over = Math.max(0, speedKmh - FREE_SPEED_KMH) / RISK_SCALE_KMH
  return Math.min(MAX_RISK, over * over * exposure)
}

export function classifySurface(tags) {
  const surface = (tags.surface ?? '').toLowerCase()
  if (PAVED_SURFACES.has(surface)) return 'paved'
  if (GRAVEL_SURFACES.has(surface)) return 'gravel'
  if (TRAIL_SURFACES.has(surface)) return 'trail'

  const highway = tags.highway ?? ''
  // Une voie verte sans revêtement tagué n'est pas un sentier — voir `risk.py`.
  if (highway === 'path' && tags.bicycle === 'designated') return 'paved'
  if (highway === 'path' || highway === 'bridleway') return 'trail'
  if (highway === 'track') {
    return tags.tracktype === 'grade1' || tags.tracktype === 'grade2' ? 'gravel' : 'trail'
  }
  if (highway === 'footway' || highway === 'pedestrian' || highway === 'steps' || highway === 'cycleway') {
    return 'paved'
  }
  if (DEFAULT_SPEED_KMH.has(highway)) return 'paved'
  return 'unknown'
}

function isLit(tags) {
  const lit = tags.lit
  if (lit === undefined) return null
  if (lit === 'no' || lit === 'disused') return false
  return true
}

export function levelOf(risk) {
  if (risk >= EXPOSED_RISK) return 'risk'
  if (risk >= 0.4) return 'caution'
  return 'safe'
}

/** Évaluation complète d'un tronçon. Objet figé : partagé par toutes les arêtes d'une voie. */
export function evaluateEdge(tags, { inBuiltup, sport = 'run' }) {
  const speed = speedOf(tags, { inBuiltup })
  const [sep, inferred, reason] =
    sport === 'bike' ? separationBike(tags, inBuiltup) : separation(tags, inBuiltup)
  const risk = riskScore(speed, sep)
  return Object.freeze({
    risk,
    separation: sep,
    speedKmh: speed,
    surface: classifySurface(tags),
    lit: isLit(tags),
    inferred,
    reason,
    highway: tags.highway ?? '',
    inBuiltup,
    level: levelOf(risk),
    carFree: isCarFree(tags, sport),
  })
}

// === sans voitures ============================================================
//
// Propre au moteur de l'app : la préférence « voies sans voitures » des filtres
// (`weights.js`). Pas le trottoir dessiné à part (`footway=sidewalk`) : il longe
// la rue, son bruit et ses portières. À vélo, ni le trottoir ni la zone
// piétonne, sauf ouverts aux vélos : on y roule au pas.
const CAR_FREE = new Set(['cycleway', 'footway', 'path', 'pedestrian', 'track', 'bridleway'])
const CAR_FREE_BIKE = new Set(['cycleway', 'path', 'track', 'bridleway'])

function isCarFree(tags, sport) {
  if (tags.footway === 'sidewalk') return false
  const highway = tags.highway ?? ''
  if (sport !== 'bike') return CAR_FREE.has(highway)
  if (CAR_FREE_BIKE.has(highway)) return true
  return (highway === 'footway' || highway === 'pedestrian') && has(BIKE_DESIGNATED, tags.bicycle)
}

// === L4 — nuit ================================================================

const REMOTE_HIGHWAY = new Set(['path', 'track', 'bridleway', 'footway'])

export function nightFactor(s) {
  let factor = 1
  if (s.lit === true) factor *= 0.7
  else if (s.lit === false) factor *= 1.8
  else factor *= s.inBuiltup ? 1.15 : 1.6

  if (REMOTE_HIGHWAY.has(s.highway) && !s.inBuiltup) factor *= 2.2
  if ((s.highway === 'residential' || s.highway === 'living_street') && s.inBuiltup) factor *= 0.9
  return factor
}

export const unlitLength = (s, lengthM) => (s.lit === false ? lengthM : 0)

// === L3 — portail =============================================================

class Threshold {
  constructor({
    exposedShare, longestExposedM, unprotectedCrossings, crossingsPer10km = 0,
    closureM = 50, overlapShare = 0.25, tunnelUnlitM = 0,
  }) {
    Object.assign(this, {
      exposedShare, longestExposedM, unprotectedCrossings, crossingsPer10km,
      closureM, overlapShare, tunnelUnlitM,
    })
  }

  crossingsBudget(distanceM) {
    const extra = Math.max(0, distanceM / 1000 - 10) / 10
    // `round()` de Python arrondit au pair : un budget de 2,5 vaut 2, pas 3.
    return this.unprotectedCrossings + pyRoundInt(this.crossingsPer10km * extra)
  }
}

export const THRESHOLDS = {
  run: {
    safe: new Threshold({ exposedShare: 0.03, longestExposedM: 150, unprotectedCrossings: 2, crossingsPer10km: 4 }),
    standard: new Threshold({ exposedShare: 0.08, longestExposedM: 400, unprotectedCrossings: 5, crossingsPer10km: 10 }),
  },
  bike: {
    safe: new Threshold({ exposedShare: 0.08, longestExposedM: 1000, unprotectedCrossings: 3, crossingsPer10km: 5 }),
    standard: new Threshold({ exposedShare: 0.2, longestExposedM: 2500, unprotectedCrossings: 6, crossingsPer10km: 10 }),
  },
}

export function thresholdsFor(mode, sport = 'run') {
  const bySport = THRESHOLDS[sport] ?? THRESHOLDS.run
  return bySport[mode] ?? bySport.safe
}

/** Mesures brutes d'un candidat — `RouteStats`. */
export class RouteStats {
  constructor(fields) {
    Object.assign(this, fields)
    if (this.unlitM === undefined) this.unlitM = null
  }

  get exposedShare() {
    return this.distanceM ? this.exposedM / this.distanceM : 0
  }

  get protectedShare() {
    return this.distanceM ? this.protectedM / this.distanceM : 0
  }

  get inferredShare() {
    return this.distanceM ? this.inferredM / this.distanceM : 0
  }
}

export function runGate(stats, mode, sport = 'run') {
  const th = thresholdsFor(mode, sport)
  const failures = []

  if (stats.exposedShare > th.exposedShare) {
    failures.push({
      code: 'exposed_share',
      label: `${pyFixed(stats.exposedShare * 100, 0)} % du parcours exposé au trafic (maximum ${pyFixed(th.exposedShare * 100, 0)} %)`,
    })
  }
  if (stats.longestExposedM > th.longestExposedM) {
    failures.push({
      code: 'longest_exposed',
      label: `${pyFixed(stats.longestExposedM, 0)} m d'affilée sans trottoir (maximum ${pyFixed(th.longestExposedM, 0)} m)`,
    })
  }
  const budget = th.crossingsBudget(stats.distanceM)
  if (stats.unprotectedCrossings > budget) {
    failures.push({
      code: 'crossings',
      label: `${stats.unprotectedCrossings} traversées non protégées (maximum ${budget})`,
    })
  }
  if (stats.tunnelUnlitM > th.tunnelUnlitM) {
    failures.push({ code: 'tunnel', label: `${pyFixed(stats.tunnelUnlitM, 0)} m de tunnel sans trottoir` })
  }
  if (stats.closureM > th.closureM) {
    failures.push({
      code: 'closure',
      label: `la boucle ne se referme pas (${pyFixed(stats.closureM, 0)} m d'écart)`,
    })
  }
  if (stats.overlapShare > th.overlapShare) {
    failures.push({
      code: 'overlap',
      label: `${pyFixed(stats.overlapShare * 100, 0)} % du tracé parcouru deux fois`,
    })
  }

  return { passed: failures.length === 0, failures, firstLabel: failures[0]?.label ?? '' }
}

/** Traversées non protégées que la note A tolère encore — `MAX_CROSSINGS_FOR_A`. */
export const MAX_CROSSINGS_FOR_A = 1

/** Note affichée et commentaires — `grade_route`. */
export function gradeRoute(stats) {
  const notes = []

  if (stats.protectedShare >= 0.95) {
    notes.push('Presque intégralement sur trottoir ou voie propre.')
  } else if (stats.protectedShare >= 0.8) {
    notes.push(`${pyFixed(stats.protectedShare * 100, 0)} % sur trottoir ou voie propre.`)
  }

  if (stats.exposedM > 0) {
    notes.push(
      `${pyFixed(stats.exposedM, 0)} m au contact du trafic, dont ${pyFixed(stats.longestExposedM, 0)} m d'un seul tenant.`,
    )
  } else {
    notes.push('Aucune portion au contact direct du trafic.')
  }

  if (stats.unprotectedCrossings) {
    notes.push(
      `${stats.unprotectedCrossings} traversée(s) sans passage protégé — l'app te préviendra 120 m avant.`,
    )
  }
  if (stats.protectedCrossings) {
    notes.push(`${stats.protectedCrossings} traversée(s) protégée(s).`)
  }

  if (stats.inferredShare > 0.35) {
    notes.push(
      `Attention : sur ${pyFixed(stats.inferredShare * 100, 0)} % du tracé, la présence d'un trottoir est estimée et non confirmée par OpenStreetMap.`,
    )
  }

  // Une traversée isolée garde le A : voir `grade_route` pour la mesure.
  if (stats.exposedShare <= 0.01 && stats.unprotectedCrossings <= MAX_CROSSINGS_FOR_A) return ['A', notes]
  if (stats.exposedShare <= 0.03) return ['B', notes]
  return ['C', notes]
}
