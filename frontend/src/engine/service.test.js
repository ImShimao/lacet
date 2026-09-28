import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { SETTINGS, extractRadiusM, planLoops, reverseRoute } from './service'

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

describe('la boucle', () => {
  const dir = new URL('./__fixtures__/parity/', import.meta.url)
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
  const graph = buildGraph(extract, { sport: 'run' })
  const deps = { loadGraph: async () => graph, fetchElevations: async () => [], wind: async () => null }

  it('finit exactement là où elle commence', async () => {
    // Pas « à quelques mètres près » : le même point, au chiffre près. C'est ce
    // qui permet de dire qu'on est arrivé (voir `arrival.js`), et un écart de
    // trente mètres entre le départ et l'arrivée se voit sur la carte.
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 5 },
      deps,
    )
    expect(result.routes.length).toBeGreaterThan(0)
    for (const route of result.routes) {
      const [depart] = route.geometry
      const fin = route.geometry[route.geometry.length - 1]
      expect(fin).toEqual(depart)
    }
  }, 30_000)

  it('évite une rue signalée', async () => {
    // Le cas vécu : un chemin qui finit sur un portail fermé. Une fois signalé,
    // il ne doit plus être proposé — et la boucle doit rester une boucle.
    const avant = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 1 },
      deps,
    )
    const chemin = avant.routes[0].geometry
    const barre = chemin[Math.floor(chemin.length / 2)]

    const apres = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 1, blocked: [barre] },
      deps,
    )
    expect(apres.routes.length).toBeGreaterThan(0)
    const passe = apres.routes[0].geometry.some((c) => haversineM(c, barre) < 20)
    expect(passe).toBe(false)
    const fin = apres.routes[0].geometry[apres.routes[0].geometry.length - 1]
    expect(fin).toEqual(apres.routes[0].geometry[0])
  }, 30_000)
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

describe('un village sans boucle', () => {
  /**
   * Bligny-lès-Beaune, deux cents habitants : six trajets possibles, tous
   * écartés — ils longent la route départementale plus que les seuils ne
   * l'autorisent. L'app affichait « aucun itinéraire ne satisfait les
   * critères », c'est-à-dire un écran vide devant quelqu'un en tenue, alors
   * qu'elle avait de quoi proposer. Elle propose maintenant, en disant ce qui
   * cloche : c'est à la personne de juger, pas au programme.
   */
  const dir = new URL('./__fixtures__/parity/', import.meta.url)
  const extract = fromCompact(
    JSON.parse(gunzipSync(readFileSync(new URL('extract-bligny.json.gz', dir))).toString('utf8')),
  )
  const graph = buildGraph(extract, { sport: 'run' })
  const bligny = { lat: 46.966, lon: 4.834 }

  it('propose les moins mauvais plutôt que rien', async () => {
    const result = await planLoops(
      { ...bligny, distance_km: 5, sport: 'run', limit: 5, with_elevation: false },
      { loadGraph: async () => graph, wind: async () => null },
    )
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.meta.salvaged).toBe('exposed_share')
    // Et le dit : l'avertissement est le même que pour un repli de mode.
    expect(result.meta.relaxed).toBe(true)
    expect(result.meta.message).toMatch(/longe la route/i)
  }, 30_000)

  it('ne fait pas passer un repêchage pour une recommandation', async () => {
    const result = await planLoops(
      { ...bligny, distance_km: 5, sport: 'run', limit: 5, with_elevation: false },
      { loadGraph: async () => graph, wind: async () => null },
    )
    // La note de sécurité reste celle du trajet : on ne l'embellit pas.
    expect(['A', 'B', 'C']).toContain(result.routes[0].safety.grade)
    // Et les motifs d'écart restent visibles.
    expect(Object.keys(result.meta.rejected_by).length).toBeGreaterThan(0)
  }, 30_000)
})

/**
 * La même boucle, dans l'autre sens.
 *
 * Le sens n'est pas décoratif : il décide des côtes qu'on prend en montant, du
 * vent qu'on a dans le dos à la fin, et de chaque consigne de virage. Ce qui ne
 * doit pas changer, c'est le chemin lui-même — mêmes rues, même longueur, même
 * note. Une inversion qui se contenterait de retourner la géométrie sans
 * refaire les consignes enverrait à gauche là où il faut tourner à droite.
 */
describe('parcourir à l’envers', () => {
  const dir = new URL('./__fixtures__/parity/', import.meta.url)
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
  const graph = buildGraph(extract, { sport: 'run' })

  async function boucle() {
    let gardé = null
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 3 },
      {
        loadGraph: async () => graph,
        fetchElevations: async (routes) =>
          routes.map((coords) => ({ values: coords.map(([lon], i) => 100 + i + lon), threshold: 2 })),
        wind: async () => null,
        onReversible: (r) => {
          gardé = r
        },
      },
    )
    return { route: result.routes[0], gardé }
  }

  it('garde le chemin et retourne le sens', async () => {
    const { route, gardé } = await boucle()
    const premier = gardé.routes[0]
    const { route: envers } = reverseRoute(gardé.graph, gardé.start, premier.cand, {
      req: gardé.req,
      elev: premier.elev,
      score: premier.score,
      rank: premier.rank,
      night: gardé.night,
    })

    // Le même chemin : même longueur au décimètre, même note, mêmes rues.
    expect(envers.distance_m).toBeCloseTo(route.distance_m, 1)
    expect(envers.grade).toBe(route.grade)
    // Les mêmes revêtements, au millimètre : les longueurs sont additionnées
    // dans l'ordre inverse, et le flottant s'en souvient à la dixième décimale.
    for (const clef of Object.keys(route.surfaces)) {
      expect(envers.surfaces[clef]).toBeCloseTo(route.surfaces[clef], 3)
    }

    // Mais parcouru à l'envers : la boucle part du même point et repasse par
    // l'avant-dernier point d'abord.
    expect(envers.geometry[0]).toEqual(route.geometry[0])
    expect(envers.geometry[1]).toEqual(route.geometry[route.geometry.length - 2])

    // Ce qui montait descend.
    expect(envers.ascent_m).toBeCloseTo(route.descent_m, 1)
    expect(envers.descent_m).toBeCloseTo(route.ascent_m, 1)

    // Et les consignes sont refaites, pas recopiées.
    expect(envers.instructions[0].turn).toBe('start')
    expect(envers.instructions[envers.instructions.length - 1].turn).toBe('finish')
    expect(envers.reversed).toBe(true)
  }, 20_000)

  it('revient au sens d’origine si on retourne deux fois', async () => {
    const { route, gardé } = await boucle()
    const premier = gardé.routes[0]
    const args = { req: gardé.req, elev: premier.elev, score: premier.score, rank: premier.rank, night: gardé.night }
    const { cand: envers } = reverseRoute(gardé.graph, gardé.start, premier.cand, args)
    const { route: endroit } = reverseRoute(gardé.graph, gardé.start, envers, args)

    expect(endroit.geometry).toEqual(route.geometry)
    expect(endroit.reversed).toBe(false)
  }, 20_000)
})
