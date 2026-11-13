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

import { bearingDeg, resample, haversineM } from './geo'
import { Candidate, GOLDEN, figureEight, generateLoops, measure, repeatLoop, reverseCandidate, similarity } from './loops'
import { blockedEdges, withZones } from './blocked'
import { carryBlocked, openDoor } from './door'
import { buildInstructions } from './navigation'
import { pyFixed, pyfloordiv, pymod, pyRound, pyRoundInt, pySum, sortByKey } from './py'
import { gradeRoute, runGate } from './safety'
import { AVOID_KEYS, buildProfile } from './weights'
import { planRejoin } from './reroute'
import { pathCoords, planSeance } from './seance'
import { describeSeance, effortMetres, normalizeSeance } from '../seanceSpec'
import { familiarTo } from '../knownRoutes'
import { ELEVATION_STEP_M, Terrain, ascentDescent, currentWind, fetchMany, isNight, shapeRelief, tailwindFinish } from './environment'

export const SETTINGS = {
  sectors: 16,
  maxCandidates: 32,
  elevationSampleM: ELEVATION_STEP_M,
  elevationBudgetMs: null,
  terrainWaitMs: null,
  widenBudgetMs: null,
}

const ELEVATION_TARGET_PER_KM = { flat: 3, rolling: 10, hilly: 22 }
const ELEVATION_TOLERANCE_PER_KM = 5
const ELEVATION_BAND_PER_KM = { flat: [0, 10], rolling: [3, 20], hilly: [12, Infinity] }
// Le D+ visé : la fourchette à 20 % près, jamais moins de 2 m/km de part et
// d'autre — voir `CLIMB_BAND_SHARE` en Python.
const CLIMB_BAND_SHARE = 0.2
const CLIMB_BAND_MIN_PER_KM = 2
// Hors de sa fourchette, une boucle passe derrière toutes les autres, de deux
// crans de note : les réglages avant la note — voir `OUT_OF_BAND_PENALTY` en
// Python.
const OUT_OF_BAND_PENALTY = 2
const OUT_OF_BAND_STEP = 0.8
// La part du tracé hors bitume que chaque terrain accepte — `SURFACE_BAND`.
const SURFACE_BAND = { road: [0, 0.1], mixed: [0.15, 0.85], trail: [0.5, 1] }
const SURFACE_STEP = 0.15
const UNPAVED = new Set(['gravel', 'trail'])
const DUPLICATE_THRESHOLD = 0.55
const VARIETY_OVERLAP_WEIGHT = 0.45
const VARIETY_BEARING_WEIGHT = 0.3
const BEARING_SPREAD_DEG = 90
// Ce qu'une graine (`seed`) ajoute au hasard à chaque candidat, au choix des
// propositions : de quoi changer l'ordre et le choix des boucles de qualité
// proche, rien qui passe un cran de note (0,9) ou une fourchette de réglages
// (2). Propre à l'app, comme `FAMILIAR_PENALTY`.
const SEED_JITTER = 0.1
// Ce que coûte au choix une boucle déjà vue — montrée récemment depuis ce
// départ, ou déjà courue (`familiar`). Moins qu'un cran de note : une boucle A
// déjà vue passe encore devant une B neuve ; plus que le hasard : elle ne
// revient pas en tête devant une neuve de qualité proche.
const FAMILIAR_PENALTY = 0.5
const WIND_WEIGHT = 0.1
const LAP_DIVISORS = [2, 3, 4]
// Tirages supplémentaires, polygones tournés, quand il manque des boucles
// entières. Le générateur s'arrête dès qu'il tient huit tracés à la bonne
// distance (`ENOUGH_IN_RANGE`) : les quasi-doublons retirés, il en restait
// quatre à six, et dès huit propositions demandées la liste se complétait de
// « 2 × 4,5 km ». On relance donc, tant qu'il manque des boucles distinctes :
// deux tirages toujours, puis jusqu'à huit tant que le tracé n'a pas dépassé
// `WIDEN_BUDGET_MS`. Propre à l'app : Python ne tourne pas ses polygones.
//
// Mesuré sur 96 recherches autour de Soultz et de Guebwiller
// (`scripts/measure_loops.mjs`) : deux tirages rendaient 797 boucles entières
// sur 960 demandées ; huit sans limite, 868, mais la plus lente passait de 1,2 à
// 2,5 s sur un PC — plus de cinq secondes sur un iPhone ; seize, 894 pour 4,6 s.
// Les tirages retraçaient surtout des boucles déjà trouvées. En sautant les
// polygones déjà tracés (`reuse`), huit tirages arrêtés au temps en rendent
// 896, et la plus lente redescend à 1,0 s — d'où ce réglage.
const WIDEN_ROUNDS = 8
// La rotation de chaque tirage, en part du pas entre deux orientations : la
// moitié, puis les quarts, puis les huitièmes. Les deux premiers sont donc
// toujours les plus éloignés de ce qu'on a déjà tracé.
const WIDEN_PHASES = [1 / 2, 1 / 4, 3 / 4, 1 / 8, 5 / 8, 3 / 8, 7 / 8, 1 / 16]
const WIDEN_MIN_ROUNDS = 2
// Compté depuis le début du tracé, sur l'appareil : avec le dernier tirage
// entamé, la recherche tient dans deux secondes.
export const WIDEN_BUDGET_MS = 1500
const MIN_LAP_M = 1500
// Le point de passage se rattache à la voie la plus proche dans ce rayon : posé
// au milieu d'un champ, il vise le chemin qui le borde, pas la route d'en face.
const VIA_SNAP_M = 300
// Une boucle qui passe par un point à vol d'oiseau `d` mesure au moins deux
// fois `d`, plus les détours des rues — un quart de plus en ville.
const VIA_MAX_SHARE = 0.42
// Écart de cap minimal entre les deux boucles d'un « 8 » — `EIGHT_MIN_GAP_DEG`.
const EIGHT_MIN_GAP_DEG = 90
const LAP_PENALTY = 0.12
const MIN_ROUNDNESS = 0.12
const GRADE_PENALTY = 0.9
const GRADE_RANK = { A: 0, B: 1, C: 2 }
const CROSSINGS_REFERENCE = 3
const GOOD_ROUNDNESS = 0.55
const BACKTRACK_WEIGHT = 1.6
// Six cents points par boucle : le pas de cinquante mètres tient jusqu'à 30 km.
// Au-delà il s'allonge, et l'IGN, qui prend cinq mille points par envoi, rend
// encore toute une recherche ordinaire — onze boucles de 20 km — en une fois.
const MAX_ELEVATION_SAMPLES = 600
// Ce qu'on accorde au relief avant de s'en passer. L'IGN répond en deux à
// quatre secondes ; mais quand il refuse, le repli part en dizaines de petites
// requêtes, puis chez un autre fournisseur qui met les siennes en file — et le
// dénivelé, qui n'est qu'un complément, finit par coûter plus cher que tout le
// reste de la recherche. Passé ce délai, on rend les boucles sans profil ; les
// altitudes continuent d'arriver et seront gardées pour la prochaine fois.
const ELEVATION_BUDGET_MS = 15_000
// Le relief de la zone part avec les rues ; une fois les rues là, on l'attend
// encore au plus ce délai, puis on trace sans lui, comme avant. Il reste en
// cache pour la recherche suivante.
const TERRAIN_WAIT_MS = 5000
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
  side: ['left', 'right', 'any'],
  form: ['auto', 'loop', 'eight', 'laps'],
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
    climb_m: input.climb_m ?? null,
    safety: input.safety ?? 'safe',
    time_of_day: input.time_of_day ?? 'auto',
    pace_sec_per_km: input.pace_sec_per_km ?? 390,
    speed_kmh: input.speed_kmh ?? 20,
    limit: input.limit ?? 5,
    with_elevation: input.with_elevation ?? true,
    // === ce que ce moteur-ci sait faire en plus ==============================
    //
    // `backend/` est la référence : les tests de parité comparent, demande par
    // demande, ce que rend ce fichier et ce que rend Python. Ces clés-là
    // n'existent que du côté JavaScript, et la parité ne les couvre donc pas —
    // elle vérifie le sous-ensemble commun, ce qui est exactement ce qu'on veut
    // tant que la liste reste courte et **écrite quelque part**. La voici.
    //
    // Laissées à leur valeur par défaut, la recherche est celle du moteur
    // Python, à l'identique — **sauf `doorstep`**, actif par défaut parce que
    // c'est ce que l'app veut toujours ; la parité le coupe explicitement.
    //
    //   variation, avoid_bearings  « Régénérer d'autres boucles » : tourner les
    //                              polygones d'un cran et fuir les directions
    //                              déjà montrées. Propre à l'écran.
    //   avoid                      Les cases « Éviter » (escaliers, rues non
    //                              éclairées), et les grands axes que « Sûr »
    //                              ajoute de lui-même — voir `weights.js` et
    //                              `toRequest`.
    //   blocked                    Les signalements faits en courant. Ils ne
    //                              quittent jamais l'appareil, et un serveur
    //                              n'aurait rien à en faire.
    //   zones                      Les zones à éviter dessinées sur la carte,
    //                              `{lon, lat, radius_m}` : leurs rues pèsent
    //                              comme un signalement — voir `blocked.js`.
    //   doorstep                   Partir de la rue devant le point choisi, et
    //                              non du carrefour le plus proche : la rue est
    //                              coupée au droit de la porte, et la boucle
    //                              part de là — voir `door.js`. Python part du
    //                              carrefour.
    //   street                     La rue de l'adresse choisie, quand la
    //                              recherche de lieux la donne : c'est elle
    //                              qu'on rejoint en sortant, même si une autre
    //                              voie passe plus près des murs.
    //   carfree                    « Voies sans voitures d'abord » : pistes,
    //                              chemins et allées coûtent moins qu'une rue —
    //                              voir `weights.js`. Actif par défaut, comme
    //                              `doorstep` ; la parité le coupe.
    //   widen                      Avant de proposer des tours, chercher d'autres
    //                              boucles entières, polygones tournés — voir
    //                              `WIDEN_ROUNDS`. Actif par défaut ; la parité
    //                              le coupe.
    //   heading                    La direction des filtres, en degrés : les
    //                              boucles partent de ce côté — voir
    //                              `HEADING_WINDOW_DEG`. `null` (« Auto ») par
    //                              défaut, et la recherche reste celle d'avant.
    //   via                        « Passer par ici » : un point, `{lat, lon}`,
    //                              par lequel toutes les boucles passent — voir
    //                              `threadVia`. Il oriente les polygones comme
    //                              une direction, qu'il remplace.
    //   seed                       Un entier tiré au sort à chaque recherche
    //                              (`App.jsx`) : les polygones tournent d'une
    //                              fraction de cran, et le hasard départage les
    //                              boucles de qualité proche — `SEED_JITTER`.
    //                              Même graine, même réponse ; 0 (par défaut),
    //                              la réponse de Python.
    //   familiar                   Des tracés déjà vus, `[[lon, lat], …]` par
    //                              boucle — montrées récemment depuis ce départ,
    //                              ou déjà courues : une boucle qui en suit un
    //                              recule (`FAMILIAR_PENALTY`). Vide par défaut.
    //
    // Chaque ajout ici est une divergence de plus : elle se paie en tests JS
    // propres, puisque la parité ne la verra pas.
    variation: input.variation ?? 0,
    avoid_bearings: input.avoid_bearings ?? [],
    avoid: input.avoid ?? [],
    blocked: input.blocked ?? [],
    zones: input.zones ?? [],
    doorstep: input.doorstep ?? true,
    street: typeof input.street === 'string' && input.street.trim() ? input.street.trim().slice(0, 120) : null,
    carfree: input.carfree !== false,
    // Préférer parcs, bois, eau et sentiers balisés — partagé avec Python
    // (`LoopRequest.nature`), donc vu par la parité.
    nature: input.nature !== false,
    // Le côté où l'on court : à gauche par défaut, face aux voitures — partagé
    // avec Python (`LoopRequest.side`), donc vu par la parité.
    side: input.side ?? 'left',
    // La forme de la sortie, et le nombre de tours — partagés avec Python
    // (`LoopRequest.form`, `laps`), donc vus par la parité.
    form: input.form ?? 'auto',
    laps: input.laps ?? 2,
    widen: input.widen !== false,
    heading: input.heading ?? null,
    via: input.via ?? null,
    seed: input.seed ?? 0,
    familiar: input.familiar ?? [],
  }
  for (const [key, values] of Object.entries(ENUMS)) {
    if (!values.includes(req[key])) throw new PlanningError(`Paramètre ${key} invalide.`)
  }
  if (req.climb_m !== null) req.climb_m = bounded(req.climb_m, 'climb_m', { min: 0, max: 5000 })
  if (req.distance_km !== null) req.distance_km = bounded(req.distance_km, 'distance_km', { gt: 0.3, max: 250 })
  if (req.duration_min !== null) {
    req.duration_min = bounded(req.duration_min, 'duration_min', { min: 5, max: 900, integer: true })
  }
  req.tolerance = bounded(req.tolerance, 'tolerance', { min: 0.02, max: 0.35 })
  req.pace_sec_per_km = bounded(req.pace_sec_per_km, 'pace_sec_per_km', { min: 150, max: 1200, integer: true })
  req.speed_kmh = bounded(req.speed_kmh, 'speed_kmh', { min: 5, max: 60 })
  req.limit = bounded(req.limit, 'limit', { min: 1, max: 12, integer: true })
  req.laps = bounded(req.laps, 'laps', { min: 2, max: 10, integer: true })
  req.variation = bounded(req.variation, 'variation', { min: 0, max: 1000, integer: true })
  if (!Array.isArray(req.avoid_bearings) || req.avoid_bearings.length > 24) {
    throw new PlanningError('Paramètre avoid_bearings invalide.')
  }
  req.avoid_bearings = req.avoid_bearings.map((b) => bounded(b, 'avoid_bearings', { min: 0, max: 360 }))
  if (req.heading !== null) req.heading = bounded(req.heading, 'heading', { min: 0, max: 360 })
  req.seed = bounded(req.seed, 'seed', { min: 0, max: 2 ** 32 - 1, integer: true })
  // Une trentaine de tracés au plus — dix montrés, vingt courus — de cent vingt
  // points : le double, pour la marge, pas davantage.
  if (!Array.isArray(req.familiar) || req.familiar.length > 60) throw new PlanningError('Paramètre familiar invalide.')
  req.familiar = req.familiar.map((trace) => {
    if (!Array.isArray(trace) || trace.length > 300) throw new PlanningError('Paramètre familiar invalide.')
    return trace.map((p) => [
      bounded(p?.[0], 'familiar', { min: -180, max: 180 }),
      bounded(p?.[1], 'familiar', { min: -90, max: 90 }),
    ])
  })
  if (req.via !== null) {
    req.via = {
      lat: bounded(req.via?.lat, 'via', { min: -90, max: 90 }),
      lon: bounded(req.via?.lon, 'via', { min: -180, max: 180 }),
    }
  }
  if (!Array.isArray(req.avoid)) throw new PlanningError('Paramètre avoid invalide.')
  // Un évitement inconnu est ignoré, pas refusé : une version plus récente de
  // l'app peut en avoir ajouté un, et une sauvegarde rouverte ici ne doit pas
  // faire échouer la recherche pour une case à cocher.
  req.avoid = req.avoid.filter((key) => AVOID_KEYS.includes(key))
  if (!Array.isArray(req.blocked) || req.blocked.length > 500) throw new PlanningError('Paramètre blocked invalide.')
  req.blocked = req.blocked.map((p) => [
    bounded(p?.[0], 'blocked', { min: -180, max: 180 }),
    bounded(p?.[1], 'blocked', { min: -90, max: 90 }),
  ])
  if (!Array.isArray(req.zones) || req.zones.length > 50) throw new PlanningError('Paramètre zones invalide.')
  // Le curseur (`zones.js`) va de 100 m à 2 km ; le moteur tolère un peu plus
  // large, mais pas une zone plus vaste que la ville : ce ne serait plus un
  // évitement, mais une recherche sans réseau.
  req.zones = req.zones.map((z) => ({
    lon: bounded(z?.lon, 'zones', { min: -180, max: 180 }),
    lat: bounded(z?.lat, 'zones', { min: -90, max: 90 }),
    radius_m: bounded(z?.radius_m, 'zones', { min: 25, max: 5000 }),
  }))

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

/**
 * Rayon de l'extrait à télécharger — celui de `plan_loops`.
 *
 * Une boucle de longueur L ne s'éloigne jamais de plus de L/2 à vol d'oiseau, et
 * la plus longue acceptée vaut la distance visée plus l'écart toléré : c'est
 * tout ce qu'il faut charger. Le rayon fixe d'avant — 0,62 fois la distance —
 * prenait la marge du mode le plus souple pour tout le monde, et chargeait un
 * tiers de surface en trop à chaque recherche.
 *
 * Arrondi au kilomètre supérieur : sans ça, faire glisser la distance de 10 à
 * 10,5 km changerait d'extrait et jetterait le cache alors que la zone est la
 * même. On télécharge un peu plus, une seule fois.
 */
export function extractRadiusM(targetM, tolerance = 0.1) {
  return Math.ceil(Math.max(1500, (targetM * (1 + tolerance)) / 2) / 1000) * 1000
}

/** Ce que la recherche demande au chargeur de graphe : la zone, le détail, le sport. */
function graphArgs(req) {
  const targetM = req.distance_km * 1000
  return {
    lat: req.lat,
    lon: req.lon,
    radiusM: extractRadiusM(targetM, req.tolerance),
    targetM,
    sport: req.sport,
    allowTrail: req.surface === 'trail',
  }
}

/**
 * La même chose, depuis une demande brute — pour préparer le graphe d'une
 * recherche avant qu'elle ne soit lancée. Passer par `graphArgs` garantit que
 * la préparation et la recherche demandent exactement la même zone : décalées
 * d'un kilomètre de rayon, la recherche retéléchargerait tout.
 */
export const graphRequest = (input) => graphArgs(normalizeRequest(input))

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
    // Ce qu'il faut pour retourner une boucle plus tard : le worker le garde,
    // les tests l'ignorent.
    onReversible = () => {},
    // Les boucles déjà montrées depuis la dernière recherche ordinaire, chacune
    // en ensemble de points (`pointKey`) — voir `freshFirst`.
    shown = [],
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

  let req = normalizeRequest(input)
  // La graine ajoute un tirage, polygones tournés d'une fraction de cran tirée
  // au sort (`collect`), et départage au hasard les boucles de qualité proche.
  const draw = req.seed ? seeded(req.seed) : null
  const seedTurn = draw ? draw() / GOLDEN : null
  const args = graphArgs(req)
  const { targetM } = args
  // Une forme trop courte pour ses tours se refuse avant tout téléchargement —
  // voir `_form_refusal`.
  const refusal = formRefusal(req, targetM)
  if (refusal) throw new PlanningError(refusal)
  onProgress('data', 0)
  // Le relief de la zone, pour tracer vers le terrain demandé — voir `Terrain`.
  const terrainTask = req.with_elevation ? fetchTerrain(req.lat, req.lon, args.radiusM, fetchElevations) : null
  const area = await loadGraph(args)
  let graph = area
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
  let component = null
  const mainMask = () => (component ??= area.largestComponent())
  if (graph.localComponentSize(start, probe) < probe) {
    if (!mainMask()[start]) {
      const relocated = graph.nearestNode(req.lon, req.lat, 2000, mainMask())
      if (relocated === null) {
        throw new PlanningError(
          'Ce point de départ est sur une portion de réseau isolée, sans liaison praticable vers le reste. Décale-toi de quelques rues.',
        )
      }
      start = relocated
    }
  }

  // Les signalements se rapprochent des rues du graphe partagé : le graphe
  // dérivé ci-dessous partage ses géométries, pas ses tranches de coordonnées.
  let blocked = withZones(graph, blockedEdges(graph, req.blocked), req.zones)

  // Le départ devant la porte, sur la rue — voir `door.js`. Le graphe de la
  // zone reste en cache tel quel ; la recherche travaille sur un dérivé qui
  // connaît le seuil.
  if (req.doorstep) {
    const door = openDoor(area, req.lon, req.lat, {
      inMain: (node) => area.localComponentSize(node, probe) >= probe || mainMask()[node] === 1,
      mainMask,
      sport: req.sport,
      street: req.street,
      connect: false,
    })
    if (door) {
      graph = door.graph
      start = door.start
      blocked = carryBlocked(graph, blocked)
    }
  }

  // Le point de passage, rattaché à la rue la plus proche du réseau principal.
  // Trop loin pour la distance demandée, il ne peut pas être atteint : mieux vaut
  // le dire tout de suite que chercher une minute pour rien.
  let via = null
  if (req.via) {
    const node = area.nearestNode(req.via.lon, req.via.lat, VIA_SNAP_M, mainMask())
    if (node === null) {
      throw new PlanningError('Le point de passage est loin de toute voie praticable : pose-le sur une rue ou un chemin.')
    }
    const from = graph.node(start)
    const to = graph.node(node)
    const straightM = haversineM(from, to)
    if (straightM > targetM * VIA_MAX_SHARE) {
      throw new PlanningError(
        `Ce point de passage est à ${pyFixed(straightM / 1000, 1).replace('.', ',')} km à vol d'oiseau : une boucle de ` +
          `${pyFixed(req.distance_km, 1).replace('.', ',')} km ne peut pas y aller et en revenir. Allonge la distance, ou rapproche le point.`,
      )
    }
    via = { node, straightM, bearing: bearingDeg(from, to) }
    // Il fixe le côté où partir : une direction en plus ne ferait que le contredire.
    req = { ...req, heading: null }
  }

  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  const terrain = terrainTask ? await within(terrainTask, settings.terrainWaitMs ?? TERRAIN_WAIT_MS) : null
  const profile = buildProfile(req.surface, req.safety, night, req.sport, {
    avoid: req.avoid,
    blocked,
    carfree: req.carfree,
    nature: req.nature,
    side: req.side,
    terrain: wantsFlat(req) ? terrain : null,
  })

  const windTask = windOf(req.lat, req.lon)

  onProgress('routing', 0)
  const deadline = performance.now() + (settings.widenBudgetMs ?? WIDEN_BUDGET_MS)
  // Ce que le premier tirage laisse aux suivants — voir `reuse` (`loops.js`).
  let reuse = {}
  // Un « 8 » ou des tours n'ont que faire des boucles de toute la distance :
  // on ne les trace pas — voir `plan_loops`.
  const generate = () => {
    if (!wholeLoops(req)) return []
    const batch = generateLoops(graph, start, targetM, profile, {
      reuse: (reuse = {}),
      sectors: settings.sectors,
      maxCandidates: settings.maxCandidates,
      tolerance: req.tolerance,
      variation: req.variation,
      terrain,
      climbFit: climbFit(req),
      heading: req.heading,
      via,
    })
    trace.raw?.(start, targetM, batch)
    return batch
  }
  let raw = generate()
  lap('routing')

  const lo = targetM * (1 - req.tolerance)
  const hi = targetM * (1 + req.tolerance)

  let [unique, rejected, offTarget] = collect(raw, lo, hi, req.safety, req, graph, start, profile, targetM, trace, terrain, { deadline, reuse, via, seedTurn })

  // **Rien de ce côté.** Une rivière sans pont, une voie ferrée, une frontière :
  // la direction demandée n'offre aucune boucle qui tienne les seuils. On le dit,
  // et on cherche de tous les côtés, comme en « Auto » — avant de relâcher la
  // sécurité, qui compte davantage que la direction.
  let missedHeading = null
  if (!unique.length && req.heading !== null) {
    missedHeading = req.heading
    req = { ...req, heading: null }
    raw = generate()
    ;[unique, rejected, offTarget] = collect(raw, lo, hi, req.safety, req, graph, start, profile, targetM, trace, terrain, { deadline, reuse, via, seedTurn })
  }

  let relaxed = false
  let salvaged = null
  if (!unique.length && req.safety === 'safe') {
    ;[unique] = collect(raw, lo, hi, 'standard', req, graph, start, profile, targetM, trace, terrain, { deadline, reuse, via, seedTurn })
    relaxed = unique.length > 0
  }

  // **Rien ne passe les seuils, mais des trajets existent.** C'est le cas d'un
  // village : les seules routes longent le trafic, ou ne se referment pas. Mesuré
  // à Bligny-lès-Beaune, 200 habitants — six candidats, tous écartés, et un écran
  // vide devant quelqu'un en tenue. On propose donc les meilleurs d'entre eux,
  // en disant franchement ce qui cloche : c'est à la personne de juger si elle
  // veut faire cet aller-retour, pas au programme de décider à sa place.
  if (!unique.length) {
    const repechables = rejected.filter((r) => r.cand).map((r) => r.cand)
    sortByKey(repechables, (cand) => -preliminaryScore(cand, targetM, req.tolerance))
    const gardes = []
    for (const cand of repechables) {
      if (gardes.some((autre) => similarity(cand, autre) > DUPLICATE_THRESHOLD)) continue
      gardes.push(cand)
      if (gardes.length >= req.limit) break
    }
    if (gardes.length) {
      unique = gardes
      // La raison la plus fréquente : c'est elle qu'on explique.
      const comptes = {}
      for (const r of rejected) comptes[r.reason] = (comptes[r.reason] ?? 0) + 1
      salvaged = Object.entries(comptes).sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  // La réserve se choisit d'abord sur les réglages : seule elle reçoit son
  // altitude — voir `shortlistKey`.
  // Une boucle déjà vue recule dès la réserve : sinon les neuves n'y entraient
  // pas, faute de place, et ne pouvaient plus passer devant au choix final.
  const known = req.familiar.length ? new Set(unique.filter((c) => familiarTo(c.geometry, req.familiar))) : null
  const familiarCost = (c) => (known?.has(c) ? FAMILIAR_PENALTY : 0)
  sortByKey(unique, (c) => -(shortlistKey(c, targetM, req, terrain) - familiarCost(c)))
  if (shown.length) unique = freshFirst(unique, shown, req.limit)
  const shortlist = unique.slice(0, shortlistSize(req.limit))

  onProgress('elevation', 0)
  const profiles = new Map()
  const sampleM = Math.max(settings.elevationSampleM, targetM / MAX_ELEVATION_SAMPLES)
  let elevationGaveUp = false
  if (req.with_elevation && shortlist.length) {
    const sampled = shortlist.map((cand) => resample(cand.geometry, sampleM).map(([, c]) => c))
    let timer = null
    const fetched = await Promise.race([
      Promise.resolve(fetchElevations(sampled)).catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), settings.elevationBudgetMs ?? ELEVATION_BUDGET_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    elevationGaveUp = fetched === null
    ;(fetched ?? []).forEach((relief, i) => {
      if (relief?.values?.length) {
        // Lissage et seuil voyagent avec le profil : c'est la source qui les
        // fixe — voir `shapeRelief`.
        const { values, threshold } = shapeRelief(relief, sampleM)
        profiles.set(i, [values, profilePoints(shortlist[i], values, sampleM), threshold, sampleM])
      }
    })
  }
  lap('elevation')

  const wind = await windTask
  const scored = shortlist.map((cand, i) => {
    const elev = profiles.get(i)
    const gain = elev ? ascentDescent(elev[0], elev[2])[0] : null
    return [finalScore(cand, targetM, req, gain, wind), cand, i]
  })
  sortByKey(scored, (t) => -t[0])
  // Le hasard de la graine, et le recul des boucles déjà vues : ils pèsent sur
  // le choix, pas sur la note rendue.
  const adjust = new Map()
  for (const [, cand] of scored) {
    const delta = (draw ? SEED_JITTER * draw() : 0) - familiarCost(cand)
    if (delta) adjust.set(cand, delta)
  }
  const chosen = selectVaried(scored, req.limit, req.avoid_bearings, adjust)

  const names = nameRoutes(chosen.map(([, cand]) => cand))
  const routes = chosen.map(([score, cand, idx], rank) =>
    toModel(cand, score, req, profiles.get(idx) ?? null, rank, buildInstructions(graph, start, cand, req.sport), names[rank], graph),
  )
  // De quoi retourner une boucle sans tout recalculer : le graphe, le nœud de
  // départ, et ce qui a servi à décrire chaque proposition. Passé par un rappel
  // et non par la réponse : ces objets ne sont ni sérialisables ni publics, et
  // la réponse doit rester exactement celle du moteur Python.
  onReversible({
    graph,
    start,
    req,
    night,
    routes: chosen.map(([score, cand, idx], rank) => ({
      id: routes[rank].id,
      cand,
      elev: profiles.get(idx) ?? null,
      score,
      rank,
    })),
  })

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
    elevation_skipped: elevationGaveUp || undefined,
    elapsed_s: pyRound((performance.now() - started) / 1000, 2),
    timings_s: timings,
    lambda: profile.lam,
    engine: 'local',
  }
  if (salvaged) {
    meta.relaxed = true
    meta.salvaged = salvaged
    meta.message = SALVAGED_MESSAGE[salvaged] ?? SALVAGED_MESSAGE.default
  } else if (relaxed) {
    meta.message =
      "Aucun itinéraire d'ici ne tient les seuils du mode Sûr : le réseau impose de longer la route. Voici ce qui existe malgré tout, avec le détail des portions exposées — à toi de juger."
  } else if (!routes.length) {
    meta.message = via
      ? `Aucune boucle de ${pyFixed(req.distance_km, 1).replace('.', ',')} km ne passe par ce point en tenant les seuils. Essaie une autre distance, ou déplace le point de passage.`
      : formMessage(req, targetM, noResultMessage(req, rejected, offTarget))
  }
  if (missedHeading !== null) {
    meta.heading_missed = directionOf(missedHeading)
    meta.message = [missedHeadingMessage(meta.heading_missed, req, routes.length > 0), meta.message]
      .filter(Boolean)
      .join(' ')
  }

  // Le candidat attaché à chaque rejet ne sort pas d'ici : c'est un objet
  // lourd, qui n'a rien à faire dans la réponse ni dans le passage d'un fil à
  // l'autre.
  return { routes, rejected: rejected.slice(0, 6).map(({ cand, ...reste }) => reste), meta }
}

/**
 * Le chemin qui ramène sur la boucle, pendant la sortie — voir `reroute.js`.
 *
 * `input.request` est la demande qui a produit le parcours : c'est elle qui
 * désigne le graphe à employer — celui de la recherche, encore en mémoire le
 * plus souvent — et le profil, pour que le raccord suive les mêmes
 * préférences que la boucle.
 */
export async function planDetour(input, { loadGraph, now = () => new Date() }) {
  const req = normalizeRequest(input.request)
  const graph = await loadGraph(graphArgs(req))
  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  // Le retour sur la boucle suit les mêmes refus que la boucle elle-même — et
  // surtout le signalement qu'on vient de faire : c'est souvent lui qui a
  // déclenché ce recalcul.
  const profile = buildProfile(req.surface, req.safety, night, req.sport, {
    avoid: req.avoid,
    blocked: withZones(graph, blockedEdges(graph, req.blocked), req.zones),
    carfree: req.carfree,
    nature: req.nature,
    side: req.side,
  })
  return planRejoin(graph, profile.precompute(graph), { ...input, blocked: req.blocked, sport: req.sport })
}

function collect(
  raw, lo, hi, mode, req, graph, start, profile, targetM, trace, terrain = null,
  { deadline = Infinity, reuse = {}, via = null, seedTurn = null } = {},
) {
  const [passed, rejected, offTarget] = applyGate(raw, lo, hi, mode, req.sport)
  sortByKey(passed, (c) => -preliminaryScore(c, targetM, req.tolerance))

  const unique = []
  const keep = (cands) => {
    for (const cand of cands) {
      if (unique.some((kept) => similarity(cand, kept) > DUPLICATE_THRESHOLD)) {
        trace.duplicate?.(cand)
        continue
      }
      unique.push(cand)
    }
  }
  keep(passed)

  // D'autres boucles entières avant des tours : voir `WIDEN_ROUNDS`. Chaque
  // appel repart de ce qu'a laissé le premier tirage : relâché en Standard, un
  // polygone écarté en Sûr mérite d'être retracé.
  const shared = { scale: reuse.scale, seen: new Set(reuse.seen) }
  const draw = (variation) => {
    const more = generateLoops(graph, start, targetM, profile, {
      sectors: SETTINGS.sectors,
      maxCandidates: SETTINGS.maxCandidates,
      tolerance: req.tolerance,
      variation,
      reuse: shared,
      terrain,
      climbFit: climbFit(req),
      heading: req.heading,
      via,
    })
    trace.raw?.(start, targetM, more)
    const [extra] = applyGate(more, lo, hi, mode, req.sport)
    sortByKey(extra, (c) => -preliminaryScore(c, targetM, req.tolerance))
    keep(extra)
  }

  // La graine **ajoute** un tirage, polygones tournés d'une fraction de cran
  // tirée au sort, au lieu de remplacer le premier : remplacé, le lot changeait
  // du tout au tout, et sur trois recherches autour de Guebwiller sa meilleure
  // boucle tombait parfois d'une fourchette de relief — note moyenne de −1,73 à
  // −2,58 à 5 km. Ajouté, il ne retire rien : la meilleure boucle du tirage
  // ordinaire reste là, et d'autres de qualité proche s'y mêlent.
  if (seedTurn !== null && wholeLoops(req)) draw(req.variation + seedTurn)

  for (let round = 1; req.widen && wholeLoops(req) && round <= WIDEN_ROUNDS && unique.length < req.limit; round += 1) {
    if (round > WIDEN_MIN_ROUNDS && performance.now() > deadline) break
    // Une rotation fractionnaire : jamais celle d'un « Régénérer », qui tourne
    // d'un cran entier à chaque fois. Divisée par le nombre d'or, que
    // `generateLoops` remultiplie : chaque tirage tombe au milieu du plus grand
    // écart laissé par les précédents — voir `WIDEN_PHASES`.
    draw(req.variation + WIDEN_PHASES[round - 1] / GOLDEN)
  }

  // « Une boucle » ne se complète jamais de tours — voir `_collect`.
  if (unique.length < req.limit && req.form !== 'loop') {
    unique.push(...lapOptions(graph, start, req, profile, targetM, mode, req.limit - unique.length, trace, terrain, via))
  }
  return [unique, rejected, offTarget]
}

/** Une suite de tirages reproductible : même graine, même suite (mulberry32). */
function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * « 6 × 400 m » : la boucle de la séance, en parcours affichable. Le relief est
 * obligatoire — sans lui, la planéité ne se vérifie pas — et son absence se dit
 * à l'écran plutôt que de rendre une boucle au hasard. Le parcours porte
 * `seance.straight`, le tracé de la ligne droite, pour la carte.
 */
export async function planSeanceRoute(input, { loadGraph, fetchElevations = fetchMany, now = () => new Date() }) {
  const spec = normalizeSeance(input.seance)
  const req = normalizeRequest(input)
  const args = graphArgs(req)
  const terrainTask = fetchTerrain(req.lat, req.lon, args.radiusM, fetchElevations)
  const graph = await loadGraph(args)
  const terrain = await terrainTask
  const start = graph.nearestNode(req.lon, req.lat)
  const empty = (message) => ({ routes: [], rejected: [], meta: { engine: 'local', message } })
  if (start === null) return empty("Impossible de raccorder ce point au réseau de rues. Essaie un départ plus proche d'une rue.")
  if (!terrain) return empty("Le relief de la zone n'est pas disponible : la séance ne peut pas vérifier que la ligne droite est plate.")

  const night = req.time_of_day === 'auto' ? isNight(req.lat, req.lon, now()) : req.time_of_day === 'night'
  const profile = buildProfile(req.surface, req.safety, night, req.sport, { terrain })
  const straightM = effortMetres(spec.effort)
  const found = planSeance(graph, start, { straightM, terrain, profile, night, targetM: req.distance_km * 1000 })
  if (!found) return empty(`Aucune ligne droite plate de ${straightM} m à moins de 1 km de ce point. Essaie un autre départ.`)

  const { cand, straight } = found
  const route = matchedRoute(graph, start, { edges: cand.edges, nodes: cand.nodes }, { req, name: `Fractionné · ${describeSeance(spec)}`, night })
  return {
    routes: [{ ...route, seance: { straight: pathCoords(graph, straight.from, straight.edges), spec } }],
    rejected: [],
    meta: { engine: 'local' },
  }
}

/** La clé d'un point de tracé : les sommets viennent du graphe, au bit près. */
export const pointKey = ([lon, lat]) => `${lon},${lat}`

/**
 * « Régénérer » : ce qui n'a pas encore été montré passe devant.
 *
 * Tourner les polygones change les sommets visés, pas les meilleures rues : la
 * recherche suivante retrouvait les mêmes boucles par d'autres sommets. Mesuré
 * sur Beaune et Lyon, une régénération sur deux remontrait une boucle déjà vue
 * à plus de 80 % — on appuyait, et rien ne changeait. Une boucle dont plus de
 * la moitié des points a déjà été montrée compte comme déjà vue : assez de
 * neuves, et aucune ne revient ; sinon, toutes les neuves, complétées par les
 * meilleures des déjà vues.
 */
function freshFirst(unique, shown, limit) {
  const fresh = []
  const seen = []
  for (const cand of unique) {
    const points = cand.geometry
    const again = shown.some((keys) => {
      let hits = 0
      for (const p of points) if (keys.has(pointKey(p))) hits += 1
      return hits > points.length * DUPLICATE_THRESHOLD
    })
    ;(again ? seen : fresh).push(cand)
  }
  return fresh.length >= limit ? fresh : [...fresh, ...seen.slice(0, limit - fresh.length)]
}

function lapOptions(graph, start, req, profile, targetM, mode, needed, trace, terrain = null, via = null) {
  const out = []
  for (const laps of lapDivisors(req)) {
    if (out.length >= needed) break
    const lapTarget = targetM / laps
    if (lapTarget < MIN_LAP_M) break

    const raw = generateLoops(graph, start, lapTarget, profile, {
      sectors: SETTINGS.sectors,
      maxCandidates: SETTINGS.maxCandidates,
      tolerance: req.tolerance,
      variation: req.variation,
      terrain,
      climbFit: climbFit(req),
      // Un tour garde le cap de sa boucle : lui aussi part du côté demandé, et
      // passe par le point demandé.
      heading: req.heading,
      via,
    })
    trace.raw?.(start, lapTarget, raw)
    const lo = lapTarget * (1 - req.tolerance)
    const hi = lapTarget * (1 + req.tolerance)
    const [passed] = applyGate(raw, lo, hi, mode, req.sport)
    sortByKey(passed, (c) => -preliminaryScore(c, lapTarget, req.tolerance))

    // Un « 8 » quand on veut deux boucles, ou que le moteur choisit seul ;
    // jamais quand on a demandé deux tours de la même.
    if (laps === 2 && req.form !== 'laps') out.push(...figureEights(graph, start, passed, mode, req, needed - out.length))
    if (req.form === 'eight') continue

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

/** Les boucles de toute la distance : en « Auto » et pour « Une boucle » seulement. */
const wholeLoops = (req) => req.form === 'auto' || req.form === 'loop'

/** Les nombres de tours à essayer — voir `_lap_divisors`. */
function lapDivisors(req) {
  if (req.form === 'eight') return [2]
  if (req.form === 'laps') return [req.laps]
  return LAP_DIVISORS
}

const kmText = (m) => pyFixed(m / 1000, 1).replace('.', ',')

/** Pourquoi la forme demandée ne peut pas faire cette distance, ou `null` — voir `_form_refusal`. */
function formRefusal(req, targetM) {
  const floor = kmText(MIN_LAP_M)
  if (req.form === 'eight' && targetM / 2 < MIN_LAP_M) {
    return (
      `Deux boucles de ${kmText(targetM / 2)} km : sous ${floor} km, une boucle n'est plus qu'un tour ` +
      `de pâté de maisons. Vise au moins ${pyFixed((2 * MIN_LAP_M) / 1000, 0)} km, ou choisis une seule boucle.`
    )
  }
  if (req.form === 'laps' && targetM / req.laps < MIN_LAP_M) {
    return (
      `${req.laps} tours de ${kmText(targetM / req.laps)} km : sous ${floor} km, un tour n'est plus une boucle ` +
      'mais une séance de piste. Choisis moins de tours, ou une distance plus longue.'
    )
  }
  return null
}

/** Ce qu'on dit quand la forme demandée ne donne rien — voir `_form_message`. */
function formMessage(req, targetM, fallback) {
  if (req.form === 'eight') {
    return (
      `Pas de « 8 » de ${kmText(targetM)} km d'ici : il faut deux boucles d'environ ${kmText(targetM / 2)} km, ` +
      'de deux côtés du départ, qui tiennent chacune les seuils, et le réseau ne les offre pas. ' +
      'Choisis « Auto », ou une autre distance.'
    )
  }
  if (req.form === 'laps') {
    return (
      `Pas de boucle d'environ ${kmText(targetM / req.laps)} km à faire ${req.laps} fois d'ici qui tienne les ` +
      'seuils. Choisis « Auto », un autre nombre de tours ou une autre distance.'
    )
  }
  if (req.form === 'loop') {
    return `${fallback} En « Auto », Lacet peut proposer à la place une boucle plus courte, à faire plusieurs fois.`
  }
  return fallback
}

/**
 * Des « 8 » plutôt que deux fois la même boucle — voir `_figure_eights`. Une
 * boucle ne sert qu'à un seul 8, ni elle ni ses quasi-doublons.
 */
function figureEights(graph, start, passed, mode, req, needed) {
  const out = []
  const lobes = []
  const fresh = (cand) => lobes.every((lobe) => similarity(cand, lobe) <= DUPLICATE_THRESHOLD)
  for (const first of passed) {
    if (out.length >= needed) break
    if (!fresh(first)) continue
    for (const second of passed) {
      if (second === first || !fresh(second)) continue
      const gap = Math.abs(pymod(first.bearing - second.bearing + 180, 360) - 180)
      if (gap < EIGHT_MIN_GAP_DEG || similarity(first, second) > DUPLICATE_THRESHOLD) continue
      const eight = figureEight(graph, start, first, second)
      if (!runGate(eight.stats, mode, req.sport).passed) continue
      lobes.push(first, second)
      out.push(eight)
      break
    }
  }
  return out
}

// Ce qu'on dit quand on repêche : la vérité, et ce qu'elle laisse comme choix.
// Rangé sous les codes de refus de `runGate`, pas sous les noms des mesures :
// rangés sous `longest_exposed_m` et `unprotected_crossings`, deux de ces
// messages n'étaient jamais trouvés, et l'on retombait sur le message général.
export const SALVAGED_MESSAGE = {
  shape:
    "Il n'y a pas de vraie boucle d'ici à cette distance — le réseau n'en offre pas. Voici les meilleurs trajets possibles : ils reviennent en partie par le même chemin.",
  exposed_share:
    "Tout ce qui part d'ici longe la route plus que les seuils ne l'autorisent. Voici les moins exposés, avec le détail des portions concernées — à toi de juger.",
  longest_exposed:
    "Chaque trajet d'ici comporte une longue portion au contact du trafic. Voici les plus courtes, avec le détail — à toi de juger.",
  crossings:
    "Les trajets d'ici traversent des routes sans passage protégé. Voici ceux qui en comptent le moins, avec le détail — à toi de juger.",
  default:
    "Aucun itinéraire d'ici ne tient les seuils. Voici ce qui existe malgré tout, avec le détail de ce qui cloche — à toi de juger.",
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
    // Le candidat reste attaché à son rejet : dans un village, ce sont parfois
    // les seuls trajets qui existent, et un écran vide ne vaut pas mieux qu'un
    // aller-retour annoncé comme tel. Il est retiré avant de rendre la réponse.
    if (cand.roundness < MIN_ROUNDNESS) {
      rejected.push({
        reason: 'shape',
        label: "aller-retour déguisé plutôt qu'une vraie boucle",
        distance_m: pyRoundInt(stats.distanceM),
        cand,
      })
      continue
    }
    const gate = runGate(stats, mode, sport)
    if (!gate.passed) {
      rejected.push({
        reason: gate.failures[0].code,
        label: gate.firstLabel,
        distance_m: pyRoundInt(stats.distanceM),
        cand,
      })
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
  // Le crochet en U — voir `preliminary_score` en Python.
  return 0.32 * distance + 0.4 * safety + 0.1 * variety + 0.18 * shape - BACKTRACK_WEIGHT * cand.backtrack
}

/**
 * Le D+ par kilomètre visé, et sa fourchette : ceux de la préférence, ou ceux du
 * D+ visé rapporté à la distance — voir `elevation_goal` en Python.
 */
function elevationGoal(req) {
  if (req.climb_m === null) return [ELEVATION_TARGET_PER_KM[req.elevation], ELEVATION_BAND_PER_KM[req.elevation]]
  const target = req.climb_m / req.distance_km
  const half = Math.max(CLIMB_BAND_SHARE * target, CLIMB_BAND_MIN_PER_KM)
  return [target, [Math.max(0, target - half), target + half]]
}

/** « Plat », et seulement lui, fait payer la pente — `wants_flat`. */
const wantsFlat = (req) => req.climb_m === null && req.elevation === 'flat'

/**
 * Ce que vaut un polygone selon ce qu'il montera au moins, en m/km — plus bas,
 * mieux c'est. Voir `_climb_fit` en Python.
 */
function climbFit(req) {
  if (wantsFlat(req)) return (perKm) => perKm
  const [target] = elevationGoal(req)
  return (perKm) => Math.floor(Math.abs(perKm - target) / ELEVATION_TOLERANCE_PER_KM)
}

/** Le relief de la zone, ou `null` : sans lui, on trace comme avant. */
async function fetchTerrain(lat, lon, radiusM, fetchElevations) {
  const grid = new Terrain(lat, lon, radiusM)
  try {
    const [relief] = await fetchElevations([grid.points()])
    if (!relief?.values?.length) return null
    grid.values = relief.values
    return grid
  } catch {
    return null
  }
}

/** La valeur de `task` si elle arrive à temps, `null` sinon. */
async function within(task, ms) {
  let timer = null
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([task, late])
  } finally {
    clearTimeout(timer)
  }
}

const gradePenalty = (cand) => GRADE_PENALTY * GRADE_RANK[gradeRoute(cand.stats)[0]]

/** Part du tracé hors bitume, ou `null` pour un tracé sans segments. */
function unpavedShare(cand) {
  const total = pySum(cand.segments.map((seg) => seg.lengthM))
  if (total <= 0) return null
  return pySum(cand.segments.filter((seg) => UNPAVED.has(seg.surface)).map((seg) => seg.lengthM)) / total
}

function bandPenalty(value, [low, high], step) {
  const gap = Math.max(low - value, value - high, 0)
  if (gap <= 0) return 0
  return OUT_OF_BAND_PENALTY + (OUT_OF_BAND_STEP * gap) / step
}

/** Ce que coûte de ne pas tenir les réglages — voir `preference_penalty`. */
function preferencePenalty(cand, req, perKm) {
  let off = 0
  if (perKm !== null) off += bandPenalty(perKm, elevationGoal(req)[1], ELEVATION_TOLERANCE_PER_KM)
  const share = unpavedShare(cand)
  if (share !== null) off += bandPenalty(share, SURFACE_BAND[req.surface], SURFACE_STEP)
  return off
}

/** Le score d'avant l'altitude, réglages compris — voir `_shortlist_key`. */
function shortlistKey(cand, targetM, req, terrain) {
  const perKm = terrain ? terrain.climb(cand.geometry) / 2 / Math.max(cand.stats.distanceM / 1000, 0.1) : null
  return preliminaryScore(cand, targetM, req.tolerance) - preferencePenalty(cand, req, perKm)
}

export function finalScore(cand, targetM, req, ascentM, wind = null) {
  let quality = preliminaryScore(cand, targetM, req.tolerance)
  let perKm = null

  if (ascentM !== null) {
    perKm = ascentM / Math.max(cand.stats.distanceM / 1000, 0.1)
    const [target] = elevationGoal(req)
    const elevation = 1 / (1 + Math.abs(perKm - target) / ELEVATION_TOLERANCE_PER_KM)
    quality = 0.72 * quality + 0.28 * elevation
  }

  if (wind !== null && wind.matters) {
    const tail = tailwindFinish(cand.geometry, wind)
    quality += WIND_WEIGHT * wind.strength * (tail - 0.5) * 2
  }

  return quality - gradePenalty(cand) - preferencePenalty(cand, req, perKm) - LAP_PENALTY * (cand.laps - 1)
}

/**
 * `adjust` : ce que le hasard et le déjà-vu ajoutent ou retirent à chaque
 * candidat, au choix seulement — voir `SEED_JITTER`, `FAMILIAR_PENALTY`.
 */
export function selectVaried(scored, limit, avoidBearings = [], adjust = null) {
  const remaining = [...scored]
  const chosen = []
  while (remaining.length && chosen.length < limit) {
    let bestIndex = 0
    let bestWhole = false
    let bestValue = -Infinity
    remaining.forEach(([score, cand], i) => {
      // Les boucles entières d'abord, toutes : les tours ne font que compléter
      // la liste — voir `LAP_PENALTY` en Python.
      const whole = cand.laps === 1
      const value = score + (adjust?.get(cand) ?? 0) - varietyPenalty(cand, chosen, avoidBearings)
      if ((whole && !bestWhole) || (whole === bestWhole && value > bestValue)) {
        bestWhole = whole
        bestValue = value
        bestIndex = i
      }
    })
    chosen.push(remaining.splice(bestIndex, 1)[0])
  }
  return chosen
}

/**
 * Ce qu'un candidat partage avec les boucles déjà retenues.
 *
 * `avoidBearings` : les directions des boucles montrées juste avant, quand on
 * demande d'autres boucles. Elles comptent comme déjà prises pour la
 * direction — pas pour le tracé, qu'on n'a plus. Un cran de note retire 0,9,
 * la ressemblance au plus 0,75 : à qualité égale, une boucle moins sûre ne
 * passe pas devant parce qu'elle part ailleurs.
 */
function varietyPenalty(cand, chosen, avoidBearings = []) {
  if (!chosen.length && !avoidBearings.length) return 0
  let overlap = chosen.length ? -Infinity : 0
  let closest = Infinity
  for (const [, kept] of chosen) {
    overlap = Math.max(overlap, similarity(cand, kept))
    closest = Math.min(closest, Math.abs(pymod(cand.bearing - kept.bearing + 180, 360) - 180))
  }
  for (const bearing of avoidBearings) {
    closest = Math.min(closest, Math.abs(pymod(cand.bearing - bearing + 180, 360) - 180))
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

function toModel(cand, score, req, elev, rank, steps, name, graph) {
  const s = cand.stats
  const [grade, notes] = gradeRoute(s)
  let ascent = null
  let descent = null
  let profilePts = null
  if (elev) {
    ;[ascent, descent] = ascentDescent(elev[0], elev[2])
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
    lap_distances_m: lapDistances(graph, cand),
    figure_eight: Boolean(cand.lapBreaks?.length),
    score: pyRound(score, 4),
  }
}

/** La longueur de chaque tour — `_lap_distances`. */
function lapDistances(graph, cand) {
  if (!cand.lapBreaks?.length) return new Array(cand.laps).fill(pyRound(cand.stats.distanceM / cand.laps, 1))
  const bounds = [0, ...cand.lapBreaks, cand.edges.length]
  return bounds.slice(1).map((b, k) => pyRound(pySum(cand.edges.slice(bounds[k], b).map((e) => graph.edgeLen[e])), 1))
}

const directionOf = (bearing) => CARDINALS[Math.trunc(pyfloordiv(pymod(bearing + 22.5, 360), 45))]

/**
 * Le modèle d'un parcours importé **reconnu sur le réseau**.
 *
 * L'accrochage (`matcher.js`) a rendu la suite d'arêtes que la trace emprunte ;
 * à partir de là, ce n'est plus un parcours étranger. On le décrit comme
 * n'importe quelle boucle — mêmes segments, mêmes traversées, même note —, et
 * les consignes sont construites par le même constructeur que les autres.
 *
 * Le nom, lui, reste celui du fichier : c'est celui que la personne reconnaît.
 */
export function matchedRoute(graph, start, matched, { req, name, elev = null, night = false }) {
  const cand = new Candidate(matched.edges, matched.nodes)
  measure(graph, start, cand, { night })
  // Le profil se dessine sur le chemin reconnu, pas sur la trace : c'est
  // seulement ici qu'on a la géométrie définitive. Sans ce calcul, le dénivelé
  // s'affichait bien et la courbe restait vide.
  const relief = elev && !elev[1] ? [elev[0], profilePoints(cand, elev[0], elev[3]), elev[2], elev[3]] : elev
  const route = toModel(cand, 0, req, relief, 0, buildInstructions(graph, start, cand, req.sport), name, graph)
  return { ...route, imported: true, matched: true }
}

/**
 * Le modèle d'une boucle retournée, prêt pour l'écran.
 *
 * Tout est recalculé comme à la recherche — consignes, nom, note — sauf le
 * relief, qui n'a pas à être redemandé : ce sont les mêmes points dans l'ordre
 * inverse. Seuls le D+ et le D− échangent leur rôle.
 */
export function reverseRoute(graph, start, cand, { req, elev, score, rank, night }) {
  const flipped = reverseCandidate(graph, start, cand, { night })
  const mirrored = elev
    ? [[...elev[0]].reverse(), profilePoints(flipped, [...elev[0]].reverse(), elev[3]), elev[2], elev[3]]
    : null
  const [name] = nameRoutes([flipped])
  const route = toModel(flipped, score, req, mirrored, rank, buildInstructions(graph, start, flipped, req.sport), name, graph)
  // Le nom ne dit pas le sens — le cap moyen d'une boucle est le même dans les
  // deux — et la carte le montre par ses chevrons. L'écran, lui, a besoin de le
  // savoir : c'est ce drapeau qui fait du bouton une bascule.
  return { route: { ...route, reversed: flipped.reversed }, cand: flipped }
}

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

/** « Aucune boucle sûre ne part vers l'est d'ici… » — voir `missedHeading`. */
function missedHeadingMessage(direction, req, found) {
  const toward = /^[eo]/.test(direction) ? `vers l'${direction}` : `vers le ${direction}`
  const safe = req.safety === 'safe' ? ' sûre' : ''
  const others = found ? ' Voici celles des autres directions.' : ''
  return `Aucune boucle${safe} ne part ${toward} d'ici : une rivière, une voie ferrée ou une frontière ferme peut-être ce côté.${others}`
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
