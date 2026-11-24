import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { journeyRequest, planJourney } from './journey'

/**
 * De A à B, sur les rues de Beaune : ce que promet l'écran.
 *
 * Le trajet part de A et finit à B — pas à la porte —, chaque chemin a sa note,
 * ses consignes et son nom de variante, et le plus direct n'est jamais plus long
 * que le plus sûr : sinon le choix qu'on montre serait un mensonge.
 */
const dir = new URL('./__fixtures__/parity/', import.meta.url)
const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
const graph = buildGraph(extract, { sport: 'run' })
const deps = { loadGraph: async () => graph, fetchElevations: async () => [] }

const A = { lat: 47.0245, lon: 4.8395 }
const B = { lat: 47.0295, lon: 4.8455 }

describe('le trajet de A à B', () => {
  it('va de A à B, noté et guidé, du plus sûr au plus direct', async () => {
    const { routes, meta } = await planJourney({ ...A, to: B, sport: 'run' }, deps)
    expect(meta.journey).toBe(true)
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) {
      expect(haversineM(r.geometry[0], [A.lon, A.lat])).toBeLessThan(200)
      expect(haversineM(r.geometry.at(-1), [B.lon, B.lat])).toBeLessThan(200)
      expect(['A', 'B', 'C']).toContain(r.safety.grade)
      expect(r.instructions.length).toBeGreaterThan(0)
      expect(r.destination).toEqual(B)
      expect(r.imported).toBeUndefined()
    }
    expect(routes[0].journey).toBe('safe')
    const direct = routes.find((r) => r.journey === 'direct')
    if (direct) expect(direct.distance_m).toBeLessThanOrEqual(routes[0].distance_m)
    // Deux chemins identiques n'en font qu'un.
    expect(new Set(routes.map((r) => r.geometry.join(';'))).size).toBe(routes.length)
  })

  it("l'aller-retour passe par B et revient à A, par d'autres rues que l'aller", async () => {
    const { routes, meta } = await planJourney({ ...A, to: B, sport: 'run', roundtrip: true }, deps)
    expect(meta.roundtrip).toBe(true)
    expect(routes.length).toBeGreaterThan(0)
    const oneWay = (await planJourney({ ...A, to: B, sport: 'run' }, deps)).routes
    for (const r of routes) {
      expect(r.roundtrip).toBe(true)
      expect(haversineM(r.geometry[0], [A.lon, A.lat])).toBeLessThan(200)
      expect(haversineM(r.geometry.at(-1), [A.lon, A.lat])).toBeLessThan(200)
      expect(Math.min(...r.geometry.map((c) => haversineM(c, [B.lon, B.lat])))).toBeLessThan(200)
      // Plus long qu'un aller simple, mais pas l'aller refait deux fois à l'identique.
      const single = oneWay.find((o) => o.journey === r.journey)
      if (single) expect(r.distance_m).toBeGreaterThan(single.distance_m * 1.9)
      const half = Math.floor(r.geometry.length / 2)
      const out = new Set(r.geometry.slice(0, half).map((c) => c.join()))
      const shared = r.geometry.slice(half).filter((c) => out.has(c.join())).length
      expect(shared / (r.geometry.length - half)).toBeLessThan(0.6)
    }
  })

  it('allongé, il tient la distance demandée et finit quand même à B', async () => {
    const { routes } = await planJourney({ ...A, to: B, sport: 'run', stretch: true, distance_km: 4 }, deps)
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) {
      expect(haversineM(r.geometry.at(-1), [B.lon, B.lat])).toBeLessThan(200)
      expect(Math.abs(r.distance_m - 4000) / 4000).toBeLessThan(0.17)
      expect(r.name).toMatch(/^Par /)
    }
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length)
  })

  it('allongé, il refuse une longueur plus courte que le vol d’oiseau', () => {
    expect(() => journeyRequest({ ...A, to: B, stretch: true, distance_km: 0.5 })).toThrow(/demande plus long/)
  })

  it('refuse une arrivée au départ, ou trop loin', () => {
    expect(() => journeyRequest({ ...A, to: A })).toThrow(/arrivée est au départ/)
    expect(() => journeyRequest({ ...A, to: { lat: 47.5, lon: 4.84 } })).toThrow(/trop loin/)
    expect(() => journeyRequest({ ...A })).toThrow(/Choisis une arrivée/)
  })

  it('charge un disque autour de A qui contient B', () => {
    const { req, crow } = journeyRequest({ ...A, to: B, distance_km: 10 })
    // Rayon chargé ≈ distance × 1,1 / 2 : au moins B, plus un kilomètre.
    expect((req.distance_km * 1000 * 1.1) / 2).toBeGreaterThanOrEqual(crow + 990)
  })
})
