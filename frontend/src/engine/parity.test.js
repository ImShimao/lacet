import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Wind, isNight } from './environment'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { pymod, pySum } from './py'
import { planLoops } from './service'

/**
 * Le moteur JavaScript contre le moteur Python, sur les mêmes données.
 *
 * C'est le test qui autorise à faire tourner le calcul d'itinéraires sur le
 * téléphone. Le moteur note la **sécurité** des parcours : un portage
 * subtilement faux proposerait un « A » là où la référence dit « C », et rien
 * à l'écran ne le montrerait.
 *
 * `__fixtures__/parity/expected.json.gz` est écrit par
 * `backend/scripts/parity_dump.py` : pour chaque cas, le graphe construit par
 * Python, chaque candidat brut arête par arête, et la réponse finale. On compare
 * dans cet ordre, pour qu'une divergence soit localisée là où elle naît.
 *
 * Les nombres sont comparés à 1e-9 près, pas au bit près. Mesuré : sinus,
 * cosinus et arc-tangente diffèrent d'une unité de précision entre le Python de
 * Windows et le JavaScript de Node dans 2 à 4 % des cas — ce sont les
 * bibliothèques mathématiques des deux plateformes, pas le portage. Tout le
 * reste — arêtes empruntées, notes, noms, consignes — doit être identique.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const readGz = (name) => JSON.parse(gunzipSync(readFileSync(new URL(name, dir))).toString('utf8'))
const expected = readGz('expected.json.gz')

/** Même relief artificiel que `fake_elevation` en Python — sans trigonométrie. */
const fakeElevation = (lon, lat) => 100 + pymod(lon * 100000, 97) + pymod(lat * 100000, 53) * 0.5

async function fakeFetchMany(routes) {
  // Le moteur Python n'a qu'une source à cet endroit, et c'est la fine : la
  // parité se juge à lissage et seuil égaux.
  return routes.map((coords) =>
    coords.length ? { values: coords.map(([lon, lat]) => fakeElevation(lon, lat)), coarse: false } : null,
  )
}

const TOLERANCE = 1e-9

/** Premier écart entre deux valeurs JSON, ou null. Nombres comparés à tolérance près. */
function firstDifference(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(1, Math.abs(a), Math.abs(b))
    return Math.abs(a - b) <= TOLERANCE * scale ? null : `${path} : ${a} ≠ ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} : longueur ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const d = firstDifference(a[key], b[key], `${path}.${key}`)
      if (d) return d
    }
    return null
  }
  return Object.is(a, b) || a === b ? null : `${path} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`
}

async function runCase(entry) {
  const { case: c } = entry
  const extract = fromCompact(readGz(`extract-${c.extract}.json.gz`))
  const seen = { graph: null, raw: [] }

  // Le départ devant la porte est propre à l'app (voir `door.js`) : Python part
  // du carrefour, et c'est ce départ-là qu'on compare. La préférence pour les
  // voies sans voitures aussi (`weights.js`) : Python n'en a pas.
  const response = await planLoops(
    { with_elevation: false, time_of_day: 'day', doorstep: false, carfree: false, widen: false, ...c.req },
    {
      loadGraph: async ({ sport, allowTrail }) => buildGraph(extract, { sport, allowTrail }),
      fetchElevations: fakeFetchMany,
      wind: async () => (c.wind ? new Wind(75, 24) : null),
      trace: {
        graph: (graph) => {
          seen.graph = {
            nodes: graph.nodeCount,
            edges: graph.edgeCount,
            length_m: pySum(graph.edgeLen),
            crossings: graph.crossings.size,
            first_edges: [...graph.edgeA.slice(0, 20)].map((a, i) => [a, graph.edgeB[i], graph.edgeLen[i]]),
          }
        },
        raw: (start, targetM, raw) => {
          seen.raw.push({
            start,
            target_m: targetM,
            candidates: raw.map((cand) => ({
              edges: cand.edges,
              distance_m: cand.stats.distanceM,
              roundness: cand.roundness,
              bearing: cand.bearing,
              shape: cand.shape,
            })),
          })
        },
      },
    },
  )

  for (const key of ['elapsed_s', 'timings_s', 'graph_cache', 'engine']) delete response.meta[key]
  return { seen, response }
}

describe('parité avec le moteur Python', () => {
  for (const entry of expected.cases) {
    describe(entry.case.name, () => {
      let result
      const ready = runCase(entry).then((r) => {
        result = r
      })

      it('construit le même graphe', async () => {
        await ready
        expect(firstDifference(result.seen.graph, entry.trace.graph, 'graphe')).toBe(null)
      })

      it('génère les mêmes candidats bruts, arête par arête', async () => {
        await ready
        expect(firstDifference(result.seen.raw, entry.trace.raw, 'bruts')).toBe(null)
      })

      it('rend la même réponse', async () => {
        await ready
        expect(firstDifference(result.response, entry.response, 'réponse')).toBe(null)
      })
    })
  }
})

describe('le calcul jour / nuit', () => {
  it('bascule aux mêmes heures que Python, partout sur le globe', () => {
    const faux = expected.solar.filter(([lat, lon, iso, night]) => isNight(lat, lon, new Date(iso)) !== night)
    expect(faux.slice(0, 5)).toEqual([])
  })
})

describe('« Régénérer d’autres boucles »', () => {
  /**
   * Le bouton relançait exactement le même calcul : le moteur est déterministe,
   * et l'écran reproposait les mêmes boucles. Une régénération tourne désormais
   * les polygones et s'écarte des directions déjà montrées — sans rien céder sur
   * la sécurité.
   */
  const beaune = expected.cases.find((c) => c.case.name === 'beaune-course')
  const extract = fromCompact(readGz('extract-beaune.json.gz'))
  const graph = buildGraph(extract, {})
  const plan = (extra) =>
    planLoops(
      { ...beaune.case.req, with_elevation: false, time_of_day: 'day', ...extra },
      { loadGraph: async () => graph, wind: async () => null },
    )

  it('propose d’autres boucles que la recherche d’origine', async () => {
    const first = await plan({})
    const again = await plan({ variation: 1, avoid_bearings: first.routes.map((r) => r.bearing) })
    const shapes = (res) => new Set(res.routes.map((r) => r.geometry.length + ':' + r.distance_m))
    const before = shapes(first)
    const nouvelles = [...shapes(again)].filter((k) => !before.has(k))
    expect(nouvelles.length).toBeGreaterThanOrEqual(Math.ceil(again.routes.length / 2))
  })

  it('ne recule jamais sur la note pour faire du neuf', async () => {
    const first = await plan({})
    const again = await plan({ variation: 1, avoid_bearings: first.routes.map((r) => r.bearing) })
    const rank = { A: 0, B: 1, C: 2 }
    const worst = (res) => Math.max(...res.routes.map((r) => rank[r.safety.grade]))
    const best = (res) => Math.min(...res.routes.map((r) => rank[r.safety.grade]))
    // La meilleure note proposée reste au moins aussi bonne, et les notes
    // restent triées : une boucle moins sûre ne passe pas devant.
    expect(best(again)).toBeLessThanOrEqual(best(first))
    const grades = again.routes.map((r) => rank[r.safety.grade])
    expect([...grades].sort((a, b) => a - b)).toEqual(grades)
    expect(worst(again)).toBeLessThanOrEqual(2)
  })

  it('sans demande de variation, rien ne change', async () => {
    const a = await plan({})
    const b = await plan({ variation: 0, avoid_bearings: [] })
    expect(firstDifference(a.routes, b.routes, 'routes')).toBe(null)
  })
})
