/**
 * Combien de vraies boucles entières, différentes, la recherche rend-elle ?
 *
 * Lance `planLoops` hors ligne sur les rues d'Alsace livrées
 * (`frontend/public/region/`), depuis quatre départs autour de Soultz et de
 * Guebwiller, à 5, 9 et 15 km, 8 et 12 propositions, Plat et Vallonné, mode Sûr
 * et Standard — et relève, par recherche : boucles entières rendues, tours,
 * quasi-doublons écartés, candidats bruts, temps de calcul.
 *
 * Le relief de la zone vient de l'IGN, demandé une fois puis gardé dans
 * `scripts/.cache/` : sans lui, Plat et Vallonné traceraient les mêmes
 * polygones. Le profil des boucles retenues est lu sur cette même grille, et
 * non redemandé point par point : il ne sert ici qu'à les ranger.
 *
 *   (cd frontend && npx vite-node scripts/measure_loops.mjs)
 *   … -- --region <dossier des tuiles> --out mesure.json --only soultz --heading
 *
 * `--climb` mesure plutôt le D+ visé (« environ 150 m ») : combien de boucles
 * tombent à ±20 % du D+ demandé, avec la préférence la plus proche (Plat,
 * Vallonné, Côtes) puis avec le D+ lui-même. Le dénivelé y est celui de l'app,
 * sur l'altitude IGN fine, gardée dans `scripts/.cache/elevation.json`.
 *
 * Les budgets de temps de la recherche sont pensés pour l'iPhone, un peu plus
 * de deux fois plus lent qu'un PC de bureau (`docs/performances.md`) : ils sont
 * divisés par `--ratio` (2,2 par défaut), pour que le PC s'arrête là où
 * l'appareil s'arrêterait.
 *
 * Hors du code livré : rien ici n'est importé par l'app.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clipToDisk, emptyExtract, mergeExtracts } from '../src/engine/extract'
import { buildGraph } from '../src/engine/graph'
import { deriveLevel, detailLevel, tilesFor } from '../src/engine/overpass'
import { fromRegionTile } from '../src/engine/region'
import { Terrain, fetchMany } from '../src/engine/environment'
import { SETTINGS, WIDEN_BUDGET_MS, graphRequest, planLoops } from '../src/engine/service'
import { bearingGap, HEADING_WINDOW_DEG } from '../src/engine/loops'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const flag = (name) => args.includes(`--${name}`)

const REGION = resolve(option('region', join(here, '..', 'public', 'region')))
const CACHE = join(here, '.cache')
const OUT = option('out')
const RATIO = Number(option('ratio', 2.2))

const STARTS = {
  // Rue des Primevères : le départ des mesures de `generation.md`.
  soultz: { lat: 47.8915, lon: 7.2289 },
  guebwiller: { lat: 47.9097, lon: 7.2106 },
  // Dans la vallée de la Lauch : le réseau s'étire entre deux versants.
  buhl: { lat: 47.928, lon: 7.1835 },
  // En plaine, à l'est : des chemins agricoles, la Lauch.
  issenheim: { lat: 47.903, lon: 7.251 },
}
const DISTANCES = [5, 9, 15]
const LIMITS = [8, 12]
const ELEVATIONS = ['flat', 'rolling']
const SAFETIES = ['safe', 'standard']

if (!existsSync(join(REGION, 'index.json'))) {
  console.error(`Pas de carte régionale dans ${REGION} — passe --region <dossier>.`)
  process.exit(1)
}
const index = JSON.parse(readFileSync(join(REGION, 'index.json'), 'utf8'))
const shipped = new Set(index.tiles)

// --- les rues : comme `fetchArea`, mais seulement depuis la carte livrée -------

const tileCache = new Map()
function regionExtract(ix, iy) {
  const key = `${ix}_${iy}`
  if (!shipped.has(key)) return null
  if (!tileCache.has(key)) tileCache.set(key, fromRegionTile(JSON.parse(readFileSync(join(REGION, `${key}.json`), 'utf8'))))
  return tileCache.get(key)
}

const graphs = new Map()
function graphFor(a) {
  const key = `${a.lat},${a.lon},${a.radiusM},${detailLevel(a.targetM)},${a.allowTrail}`
  if (!graphs.has(key)) {
    const level = detailLevel(a.targetM)
    const tiles = tilesFor(a.lat, a.lon, a.radiusM)
    const missing = tiles.filter(([ix, iy]) => !shipped.has(`${ix}_${iy}`)).length
    const parts = tiles.map(([ix, iy]) => {
      const extract = regionExtract(ix, iy)
      return extract ? deriveLevel(extract, level) : emptyExtract()
    })
    const extract = clipToDisk(mergeExtracts(parts), a.lon, a.lat, a.radiusM)
    graphs.set(key, { graph: buildGraph(extract, { allowTrail: a.allowTrail, sport: a.sport }), missing })
  }
  return graphs.get(key)
}

// --- le relief : demandé une fois, gardé sur le disque -------------------------

mkdirSync(CACHE, { recursive: true })
const terrainFile = join(CACHE, 'terrain.json')
const terrainStore = existsSync(terrainFile) ? JSON.parse(readFileSync(terrainFile, 'utf8')) : {}

async function terrainFor(lat, lon, radiusM) {
  const grid = new Terrain(lat, lon, radiusM)
  const key = `${lat},${lon},${radiusM}`
  if (!terrainStore[key]) {
    const [relief] = await fetchMany([grid.points()])
    if (!relief?.values?.length) throw new Error(`Relief indisponible pour ${key}`)
    terrainStore[key] = relief.values
    writeFileSync(terrainFile, JSON.stringify(terrainStore))
  }
  grid.values = terrainStore[key]
  return grid
}

/** `fetchElevations` hors ligne : la grille de la zone, puis des lectures dessus. */
function offlineElevations(grid) {
  const gridPoints = grid.points()
  return async (routes) =>
    routes.map((coords) => {
      if (coords.length === gridPoints.length && coords[0][0] === gridPoints[0][0] && coords[0][1] === gridPoints[0][1]) {
        return { values: grid.values, coarse: false }
      }
      return { values: coords.map(([x, y]) => grid.at(x, y)), coarse: false }
    })
}

/**
 * `fetchElevations` réel, l'altitude IGN de chaque point, gardée sur le disque
 * au cent-millième de degré comme dans l'app : le D+ qu'on compte est celui
 * que l'app annoncerait. La grille de la zone, elle, reste celle du cache.
 */
const fineFile = join(CACHE, 'elevation.json')
const fineStore = existsSync(fineFile) ? JSON.parse(readFileSync(fineFile, 'utf8')) : {}
const fineKey = ([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`
function fineElevations(grid) {
  const terrain = offlineElevations(grid)
  return async (routes) => {
    if (routes.length === 1 && routes[0].length === grid.points().length) return terrain(routes)
    const unknown = [...new Set(routes.flat().map(fineKey))].filter((k) => !(k in fineStore))
    if (unknown.length) {
      const [relief] = await fetchMany([unknown.map((k) => k.split(',').map(Number))])
      if (!relief?.values?.length) throw new Error('Altitude IGN indisponible')
      unknown.forEach((k, i) => {
        fineStore[k] = relief.values[i]
      })
      writeFileSync(fineFile, JSON.stringify(fineStore))
    }
    return routes.map((coords) => ({ values: coords.map((c) => fineStore[fineKey(c)]), coarse: false }))
  }
}

// --- une recherche -------------------------------------------------------------

async function run(name, distanceKm, limit, elevation, safety, extra = {}) {
  const { lat, lon } = STARTS[name]
  const input = { lat, lon, distance_km: distanceKm, limit, elevation, safety, time_of_day: 'day', ...extra }
  const a = graphRequest(input)
  const { graph, missing } = graphFor(a)
  const grid = await terrainFor(lat, lon, a.radiusM)
  let raw = 0
  let duplicates = 0
  const t0 = performance.now()
  const result = await planLoops(input, {
    loadGraph: async () => graph,
    fetchElevations: flag('climb') ? fineElevations(grid) : offlineElevations(grid),
    wind: async () => null,
    settings: { ...SETTINGS, widenBudgetMs: WIDEN_BUDGET_MS / RATIO },
    trace: {
      raw: (_s, _t, batch) => {
        raw += batch.length
      },
      duplicate: () => {
        duplicates += 1
      },

    },
  })
  const seconds = (performance.now() - t0) / 1000
  const whole = result.routes.filter((r) => r.laps === 1)
  const grades = { A: 0, B: 0, C: 0 }
  for (const r of whole) grades[r.safety.grade] += 1
  return {
    name, distanceKm, limit, elevation, safety, ...extra,
    routes: result.routes.length,
    whole: whole.length,
    laps: result.routes.length - whole.length,
    grades,
    duplicates,
    eights: result.routes.filter((r) => r.figure_eight).length,
    raw,
    seconds: Math.round(seconds * 100) / 100,
    relaxed: Boolean(result.meta.relaxed),
    headingMissed: result.meta.heading_missed ?? null,
    missingTiles: missing,
    bearings: whole.map((r) => r.bearing),
    shapes: whole.map((r) => r.shape),
    ascents: result.routes.map((r) => r.ascent_m),
    routeGrades: result.routes.map((r) => r.safety.grade),
  }
}

// --- « environ 150 m » -------------------------------------------------------------

if (flag('climb')) {
  // Des D+ ronds, comme on les tape, de la plaine aux Vosges.
  const CLIMBS = { 5: [25, 50, 75, 100, 150], 9: [40, 75, 110, 150, 225, 300], 15: [60, 120, 180, 250, 375, 500] }
  // Les cibles de `ELEVATION_TARGET_PER_KM` : avant, on prenait la plus proche.
  const PRESETS = { flat: 3, rolling: 10, hilly: 22 }
  const nearest = (perKm) =>
    Object.keys(PRESETS).reduce((a, b) => (Math.abs(PRESETS[b] - perKm) < Math.abs(PRESETS[a] - perKm) ? b : a))
  const near = (ascent, climb) => ascent !== null && Math.abs(ascent - climb) <= 0.2 * climb
  const presetRuns = new Map()
  const cases = []
  for (const name of option('only')?.split(',') ?? Object.keys(STARTS)) {
    for (const [km, climbs] of Object.entries(CLIMBS)) {
      for (const climb of climbs) {
        const preset = nearest(climb / km)
        const key = `${name},${km},${preset}`
        if (!presetRuns.has(key)) presetRuns.set(key, await run(name, Number(km), 8, preset, 'safe'))
        const before = presetRuns.get(key)
        const after = await run(name, Number(km), 8, preset, 'safe', { climb_m: climb })
        const tally = (row) => ({
          near: row.ascents.filter((z) => near(z, climb)).length,
          first: near(row.ascents[0] ?? null, climb),
          routes: row.routes,
          a: row.routeGrades.filter((g) => g === 'A').length,
          seconds: row.seconds,
        })
        cases.push({ name, km: Number(km), climb, preset, before: tally(before), after: tally(after) })
        process.stderr.write(
          `${name} ${km} km ${climb} m (${preset}) : ±20 % ${tally(before).near} → ${tally(after).near} / 8, ` +
            `A ${tally(before).a} → ${tally(after).a}, D+ ${after.ascents.join(' ')}\n`,
        )
      }
    }
  }
  const add = (g, side, key) => g.reduce((t, c) => t + Number(c[side][key]), 0)
  const line = (label, g) =>
    `| ${label} | ${add(g, 'before', 'near')} / ${add(g, 'before', 'routes')} | ${add(g, 'after', 'near')} / ${add(g, 'after', 'routes')} | ` +
    `${add(g, 'before', 'first')} → ${add(g, 'after', 'first')} / ${g.length} | ${add(g, 'before', 'a')} → ${add(g, 'after', 'a')} |`
  console.log('\n| Demande | Boucles à ±20 %, avant | Après | 1ʳᵉ proposition à ±20 % | Notées A |')
  console.log('|---|---|---|---|---|')
  for (const [km, climbs] of Object.entries(CLIMBS)) {
    for (const climb of climbs) console.log(line(`${km} km, ${climb} m`, cases.filter((c) => c.km === Number(km) && c.climb === climb)))
  }
  for (const name of new Set(cases.map((c) => c.name))) console.log(line(name, cases.filter((c) => c.name === name)))
  console.log(line('Total', cases))
  if (OUT) writeFileSync(OUT, JSON.stringify(cases, null, 1))
  process.exit(0)
}

// --- le tableau ------------------------------------------------------------------

const only = option('only')
const names = only ? only.split(',') : Object.keys(STARTS)
const rows = []
for (const name of names) {
  for (const distanceKm of DISTANCES) {
    for (const elevation of ELEVATIONS) {
      for (const safety of SAFETIES) {
        for (const limit of LIMITS) {
          const row = await run(name, distanceKm, limit, elevation, safety)
          rows.push(row)
          process.stderr.write(
            `${name} ${distanceKm} km ${elevation} ${safety} ×${limit} : ${row.whole} entières, ${row.laps} tours, ` +
              `${row.duplicates} doublons, ${row.raw} bruts, ${row.seconds} s` +
              `${row.missingTiles ? ` (${row.missingTiles} tuiles hors carte)` : ''}\n`,
          )
        }
      }
    }
  }
}

const sum = (list, key) => list.reduce((t, r) => t + (typeof key === 'function' ? key(r) : r[key]), 0)
const median = (values) => {
  const s = [...values].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const fmt = (n) => String(n).replace('.', ',')

console.log('\n| Distance, propositions | Entières | Tours | Doublons écartés | Bruts | A / B / C | Temps médian (max) |')
console.log('|---|---|---|---|---|---|---|')
for (const distanceKm of DISTANCES) {
  for (const limit of LIMITS) {
    const g = rows.filter((r) => r.distanceKm === distanceKm && r.limit === limit)
    if (!g.length) continue
    const asked = g.length * limit
    console.log(
      `| ${distanceKm} km, ${limit} | ${sum(g, 'whole')} / ${asked} | ${sum(g, 'laps')} | ${sum(g, 'duplicates')} | ${sum(g, 'raw')} | ` +
        `${sum(g, (r) => r.grades.A)} / ${sum(g, (r) => r.grades.B)} / ${sum(g, (r) => r.grades.C)} | ` +
        `${fmt(median(g.map((r) => r.seconds)).toFixed(2))} s (${fmt(Math.max(...g.map((r) => r.seconds)).toFixed(2))} s) |`,
    )
  }
}
console.log('\n| Départ | Entières | Tours | Recherches complètes en entières |')
console.log('|---|---|---|---|')
for (const name of names) {
  const g = rows.filter((r) => r.name === name)
  console.log(`| ${name} | ${sum(g, 'whole')} / ${sum(g, 'limit')} | ${sum(g, 'laps')} | ${g.filter((r) => r.whole >= r.limit).length} / ${g.length} |`)
}
console.log(
  `\nTotal : ${sum(rows, 'whole')} entières / ${sum(rows, 'limit')} demandées, ${sum(rows, 'laps')} tours dont ${sum(rows, 'eights')} « 8 », ` +
    `${sum(rows, 'duplicates')} doublons, temps médian ${fmt(median(rows.map((r) => r.seconds)).toFixed(2))} s, ` +
    `max ${fmt(Math.max(...rows.map((r) => r.seconds)).toFixed(2))} s, ${rows.filter((r) => r.relaxed).length} repli(s) Standard.`,
)

// « Partir vers… » : chaque direction rend ses boucles, toutes de son côté.
if (flag('heading')) {
  console.log('\n| Départ, cap | Entières | Tours | Hors fenêtre | Repli |')
  console.log('|---|---|---|---|---|')
  for (const name of names) {
    for (const heading of [0, 90, 180, 270]) {
      const row = await run(name, 9, 8, 'flat', 'safe', { heading })
      const outside = row.bearings.filter((b) => bearingGap(b, heading) > HEADING_WINDOW_DEG).length
      console.log(`| ${name}, ${heading}° | ${row.whole} | ${row.laps} | ${outside} | ${row.headingMissed ? `rien vers le ${row.headingMissed}` : row.relaxed ? 'Standard' : ''} |`)
    }
  }
}

if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1))
