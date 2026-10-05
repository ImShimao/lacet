import { describe, expect, it, vi } from 'vitest'

/**
 * Le fil du moteur, vu de l'écran : ce qu'il dit d'une recherche quand d'autres
 * demandes tournent en même temps.
 *
 * La préparation d'avance (`prefetch`) charge les rues d'un départ pendant qu'on
 * règle ses filtres ; elle peut finir au milieu d'une recherche. Ses mesures
 * vivaient dans des variables « du dernier chargement », et la recherche
 * annonçait alors la bordure manquante de la préparation : « le bord de la zone
 * n'est pas encore arrivé », sur une zone complète.
 */

const state = vi.hoisted(() => {
  const deferred = () => {
    let resolve
    const promise = new Promise((r) => {
      resolve = r
    })
    return { promise, resolve }
  }
  return { deferred, zones: new Map(), gate: null }
})

vi.mock('./overpass', () => ({
  detailLevel: () => 0,
  tilesFor: (lat) => [[lat, 0]],
  clearTiles: async () => {},
  fetchArea: ({ lat }) => state.zones.get(lat).promise,
}))
vi.mock('./graph', () => ({ buildGraph: () => ({ nodeCount: 1 }) }))
vi.mock('./environment', () => ({
  ELEVATION_STEP_M: 50,
  currentWind: async () => null,
  fetchMany: async () => [],
  shapeRelief: () => ({}),
}))
vi.mock('./remote', () => ({ planRemote: async () => null }))
vi.mock('./service', () => {
  const args = (lat) => ({ lat, lon: 0, radiusM: 1000, targetM: 1000, sport: 'run', allowTrail: false })
  return {
    normalizeRequest: (x) => x,
    graphRequest: (payload) => args(payload.lat),
    planLoops: async (payload, { loadGraph }) => {
      await loadGraph(args(payload.lat))
      await state.gate.promise
      return { routes: [{ id: 'r0' }], meta: { timings_s: { fetch: 0 } } }
    },
    matchedRoute: () => null,
    planDetour: async () => null,
    reverseRoute: () => null,
  }
})

const posted = []
globalThis.self = { postMessage: (message) => posted.push(message) }
await import('./worker.js')
const send = (data) => self.onmessage({ data })

describe('le fil du moteur', () => {
  it("ne prête pas à une recherche la bordure manquante d'une préparation", async () => {
    const ici = state.deferred()
    const ailleurs = state.deferred()
    state.zones.set(1, ici)
    state.zones.set(2, ailleurs)
    state.gate = state.deferred()

    // La recherche charge une zone complète, puis calcule…
    const recherche = send({ id: 1, type: 'plan', payload: { lat: 1 } })
    ici.resolve({ partial: false, sources: { livrée: 4 } })
    await new Promise((r) => setTimeout(r, 0))

    // … pendant qu'une préparation, ailleurs, finit sans sa bordure.
    const preparation = send({ id: 2, type: 'prefetch', payload: { lat: 2 } })
    ailleurs.resolve({ partial: true, sources: { Overpass: 1 } })
    await preparation

    state.gate.resolve()
    await recherche
    const { result } = posted.find((m) => m.id === 1 && m.type === 'result')
    expect(result.meta.partial).toBeUndefined()
    expect(result.meta.sources).toEqual({ livrée: 4 })
  })
})
