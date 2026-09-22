import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { SETTINGS, extractRadiusM, planLoops } from './service'

/**
 * Ce qu'on télécharge autour du départ.
 *
 * C'est le réglage le plus cher de toute l'app : la surface croît avec le carré
 * du rayon, et tout ce qui est téléchargé est ensuite décodé, construit en
 * graphe, puis parcouru. Mille mètres de trop sur une recherche de 10 km, ce
 * sont trente pour cent de rues en plus, à chaque fois.
 */
describe("le rayon de l'extrait", () => {
  it('suit la plus longue boucle acceptée', () => {
    // Une boucle ne s'éloigne jamais de plus de la moitié de sa longueur, et la
    // plus longue acceptée vaut la distance visée plus l'écart toléré.
    expect(extractRadiusM(10_000, 0.1)).toBe(6000)
    expect(extractRadiusM(10_000, 0.025)).toBe(6000)
    // Un mode très souple demande, lui, de chercher plus loin.
    expect(extractRadiusM(10_000, 0.35)).toBe(7000)
  })

  it('ne bouge pas quand la distance glisse un peu', () => {
    // Arrondi au kilomètre : faire glisser le curseur de 10 à 10,5 km ne doit
    // pas jeter les rues déjà sur l'appareil.
    expect(extractRadiusM(10_500, 0.1)).toBe(extractRadiusM(10_000, 0.1))
  })

  it("garde un minimum pour les très petites distances", () => {
    expect(extractRadiusM(1000, 0.1)).toBe(2000)
  })
})

describe('le relief', () => {
  const dir = new URL('./__fixtures__/parity/', import.meta.url)
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
  const graph = buildGraph(extract, { sport: 'run' })

  it("rend les boucles sans profil plutôt que de faire attendre", async () => {
    // L'IGN répond en deux à quatre secondes ; mais quand il refuse, le repli
    // part en dizaines de petites requêtes, puis chez un fournisseur qui met les
    // siennes en file. Le dénivelé est un complément : il ne doit pas coûter la
    // recherche.
    const jamais = () => new Promise(() => {})
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 3 },
      {
        loadGraph: async () => graph,
        fetchElevations: jamais,
        wind: async () => null,
        settings: { ...SETTINGS, elevationBudgetMs: 50 },
      },
    )
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.meta.elevation_skipped).toBe(true)
    expect(result.routes[0].elevation_profile).toBeNull()
  }, 20_000)
})
