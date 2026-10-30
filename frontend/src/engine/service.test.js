import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { RouteStats, runGate } from './safety'
import { SALVAGED_MESSAGE, SETTINGS, extractRadiusM, planLoops, pointKey, reverseRoute, selectVaried } from './service'
import { Candidate, bearingGap } from './loops'
import { familiarTo, traceOf } from '../knownRoutes'

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

  it('trouve encore des boucles quand tout est coché', async () => {
    // Le risque d'un évitement : rendre la recherche stérile. Trois cases
    // cochées d'un coup — escaliers, grands axes, rues non éclairées — doivent
    // rendre des boucles, pas un écran vide, parce qu'un évitement pénalise
    // sans interdire.
    const result = await planLoops(
      {
        lat: 47.0245,
        lon: 4.8395,
        distance_km: 5,
        sport: 'run',
        limit: 3,
        avoid: ['steps', 'busy', 'unlit'],
      },
      deps,
    )
    expect(result.routes.length).toBeGreaterThan(0)
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

  it('contourne une zone à éviter dessinée sur la carte', async () => {
    // Le cas visé : un quartier, une forêt de chasse. La zone est posée sur la
    // boucle qu'on obtenait sans elle ; aucune proposition n'y entre plus.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 3 }
    const avant = await planLoops({ ...demande, limit: 1 }, deps)
    const chemin = avant.routes[0].geometry
    const [lon, lat] = chemin[Math.floor(chemin.length / 2)]
    const zone = { lon, lat, radius_m: 150 }

    const apres = await planLoops({ ...demande, zones: [zone] }, deps)
    expect(apres.routes.length).toBeGreaterThan(0)
    for (const route of apres.routes) {
      expect(Math.min(...route.geometry.map((c) => haversineM(c, [lon, lat])))).toBeGreaterThan(zone.radius_m)
      expect(route.geometry.at(-1)).toEqual(route.geometry[0])
    }
  }, 60_000)

  it('trouve encore des boucles quand le départ est dans la zone', async () => {
    // Interdire la zone, ce serait n'avoir aucune boucle depuis chez soi : elle
    // pèse lourd, et la boucle en sort par le plus court au lieu d'y tourner.
    const zone = { lon: 4.8395, lat: 47.0245, radius_m: 300 }
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 3, zones: [zone] },
      deps,
    )
    expect(result.routes.length).toBeGreaterThan(0)
    for (const route of result.routes) {
      const inside = route.geometry.filter((c) => haversineM(c, [zone.lon, zone.lat]) < zone.radius_m).length
      expect(inside / route.geometry.length).toBeLessThan(0.25)
    }
  }, 60_000)

  it('cherche d’autres boucles entières avant de proposer des tours', async () => {
    // Douze propositions : le premier tirage n'en tient qu'une poignée de
    // distinctes, et la liste se complétait de tours. À 7 km depuis Beaune, il
    // en tient neuf, et les tirages en plus complètent la liste.
    //
    // Pas en dessous : depuis le départ devant la porte et les épingles rognées
    // (`trimSpurs`), le premier tirage y tient déjà onze ou douze boucles,
    // l'élargissement ne se lance pas — à raison —, et « plus qu'avant » ne
    // pouvait plus être vrai. D'où la première vérification : sans elle, le
    // test échouait sans dire que c'était sa prémisse qui ne tenait plus.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 7, sport: 'run', limit: 12 }
    const entieres = (r) => r.routes.filter((route) => route.laps === 1).length
    const sans = await planLoops({ ...demande, widen: false }, deps)
    expect(entieres(sans), 'le premier tirage remplit déjà la liste : rien à élargir').toBeLessThan(demande.limit)
    const avec = await planLoops(demande, deps)
    expect(entieres(avec)).toBeGreaterThan(entieres(sans))
  }, 60_000)

  it('part du côté demandé', async () => {
    // La direction des filtres : le centre de gravité de chaque boucle — la
    // direction qu'affichent les cartes — tombe à moins de 45° du cap, et il
    // en reste autant qu'en « Auto ». Filtrer les polygones ordinaires n'en
    // laissait qu'un sur quatre de ce côté.
    for (const heading of [0, 90, 180, 270]) {
      const result = await planLoops(
        { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 5, heading },
        deps,
      )
      expect(result.routes).toHaveLength(5)
      for (const route of result.routes) expect(bearingGap(route.bearing, heading)).toBeLessThanOrEqual(45)
      expect(result.meta.heading_missed).toBeUndefined()
    }
  }, 30_000)

  it('dit quand rien ne part du côté demandé, et propose les autres', async () => {
    // Au bord nord de l'extrait, plus une rue au-delà : comme une rivière sans
    // pont ou une frontière. Un écran vide ne dirait pas pourquoi.
    const result = await planLoops(
      { lat: 47.055, lon: 4.84, distance_km: 5, sport: 'run', limit: 5, heading: 0 },
      deps,
    )
    expect(result.meta.heading_missed).toBe('nord')
    expect(result.meta.message).toMatch(/Aucune boucle sûre ne part vers le nord.*autres directions/)
    expect(result.routes.length).toBeGreaterThan(0)
  }, 30_000)

  it('passe par le point demandé, et reste une boucle', async () => {
    // « Passer par ici » : un point à un kilomètre et demi au nord-est du départ.
    // Chaque proposition y passe — à la rue près, le point étant posé à côté —
    // et revient à la porte.
    const via = { lat: 47.0345, lon: 4.8505 }
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 6, sport: 'run', limit: 5, via },
      deps,
    )
    expect(result.routes).toHaveLength(5)
    for (const route of result.routes) {
      const closest = Math.min(...route.geometry.map((c) => haversineM(c, [via.lon, via.lat])))
      expect(closest).toBeLessThan(120)
      expect(route.geometry.at(-1)).toEqual(route.geometry[0])
    }
  }, 60_000)

  it('dit tout de suite quand le point est trop loin pour la distance', async () => {
    await expect(
      planLoops({ lat: 47.0245, lon: 4.8395, distance_km: 3, sport: 'run', via: { lat: 47.0445, lon: 4.8395 } }, deps),
    ).rejects.toThrow(/2,\d km à vol d'oiseau.*boucle de 3,0 km/)
  })

  it('« Régénérer » ne remontre pas une boucle déjà vue', async () => {
    // Tourner les polygones ne suffisait pas : les meilleures rues restaient
    // les meilleures, et une régénération sur deux remontrait une boucle déjà
    // affichée. Ce que le worker garde des boucles montrées les fait passer
    // après les neuves.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 4, sport: 'run', limit: 5 }
    const vues = []
    let gardees = null
    const garder = (r) => {
      gardees = r
    }
    await planLoops(demande, { ...deps, onReversible: garder })
    for (const { cand } of gardees.routes) vues.push(new Set(cand.geometry.map(pointKey)))

    await planLoops({ ...demande, variation: 1 }, { ...deps, onReversible: garder, shown: vues })
    expect(gardees.routes).toHaveLength(5)
    for (const { cand } of gardees.routes) {
      const dejaVue = Math.max(...vues.map((cles) => cand.geometry.filter((p) => cles.has(pointKey(p))).length))
      expect(dejaVue / cand.geometry.length).toBeLessThanOrEqual(0.55)
    }
  }, 30_000)

  it('tient la forme demandée, avec les réglages de l’app', async () => {
    // La parité vérifie les formes sur le damier, sans ce que l'app ajoute :
    // le départ devant la porte, et surtout les tirages en plus (`widen`), qui
    // ajouteraient des boucles entières à une demande de « 8 ».
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 6, sport: 'run', limit: 4 }
    const huits = await planLoops({ ...demande, form: 'eight' }, deps)
    expect(huits.routes.length).toBeGreaterThan(0)
    for (const r of huits.routes) expect(r.figure_eight).toBe(true)
    const tours = await planLoops({ ...demande, form: 'laps', laps: 3 }, deps)
    expect(tours.routes.length).toBeGreaterThan(0)
    for (const r of tours.routes) expect([r.laps, r.figure_eight]).toEqual([3, false])
    const une = await planLoops({ ...demande, form: 'loop', limit: 12 }, deps)
    for (const r of une.routes) expect(r.laps).toBe(1)
  }, 60_000)

  it('varie d’une recherche à l’autre, et pas à graine égale', async () => {
    // « Quand on génère des boucles deux fois, ce ne sont pas les mêmes qui
    // sortent, qui plus est dans le même ordre » : sans graine, le moteur
    // rendait exactement la même liste à chaque fois.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 4, sport: 'run', limit: 5 }
    const liste = (r) => r.routes.map((route) => route.geometry.length + ':' + route.distance_m).join(' ')
    const a = await planLoops({ ...demande, seed: 11 }, deps)
    expect(liste(await planLoops({ ...demande, seed: 11 }, deps))).toBe(liste(a))
    const autres = await Promise.all([12, 13, 14].map((seed) => planLoops({ ...demande, seed }, deps)))
    for (const b of autres) expect(liste(b)).not.toBe(liste(a))
    // Le hasard départage des boucles de qualité proche, jamais une note.
    for (const r of [a, ...autres]) {
      const notes = r.routes.map((route) => route.safety.grade)
      expect([...notes].sort()).toEqual(notes)
    }
  }, 60_000)

  it('ne remet pas en tête une boucle qu’on vient de montrer', async () => {
    // En « Route », Beaune offre bien plus de cinq boucles notées A et dans la
    // fourchette : les déjà vues passent toutes après les neuves.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 4, sport: 'run', limit: 5, surface: 'road', seed: 21 }
    const avant = await planLoops(demande, deps)
    const vues = avant.routes.map((r) => traceOf(r.geometry, r.distance_m))
    const apres = await planLoops({ ...demande, seed: 22, familiar: vues }, deps)
    expect(apres.routes.filter((r) => familiarTo(r.geometry, vues))).toEqual([])
    expect(apres.routes.map((r) => r.safety.grade)).toEqual(['A', 'A', 'A', 'A', 'A'])
  }, 60_000)

  it('garde en tête une boucle déjà vue quand elle seule tient les réglages', async () => {
    // En « Mixte », une seule boucle de 4 km a sa part de chemins : déjà vue, elle
    // reste devant des boucles toutes goudronnées. Varier ne coûte pas un réglage.
    const demande = { lat: 47.0245, lon: 4.8395, distance_km: 4, sport: 'run', limit: 5, seed: 21 }
    const avant = await planLoops(demande, deps)
    const vues = avant.routes.map((r) => traceOf(r.geometry, r.distance_m))
    const apres = await planLoops({ ...demande, seed: 22, familiar: vues }, deps)
    expect(apres.routes[0].score).toBe(Math.max(...apres.routes.map((r) => r.score)))
  }, 60_000)

  it('refuse tout de suite une forme aux tours trop courts', async () => {
    await expect(planLoops({ lat: 47.0245, lon: 4.8395, distance_km: 5, form: 'laps', laps: 5 }, deps)).rejects.toThrow(
      /5 tours de 1,0 km : sous 1,5 km/,
    )
    // En durée aussi : 15 min à 6:30/km, c'est 2,3 km, deux boucles de 1,2 km.
    await expect(planLoops({ lat: 47.0245, lon: 4.8395, duration_min: 15, form: 'eight' }, deps)).rejects.toThrow(
      /Deux boucles de 1,2 km/,
    )
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
    // recherche — ni le profil des boucles, ni le relief de la zone, qu'on
    // n'attend qu'un temps avant de tracer sans lui.
    const jamais = () => new Promise(() => {})
    const result = await planLoops(
      { lat: 47.0245, lon: 4.8395, distance_km: 5, sport: 'run', limit: 3 },
      {
        loadGraph: async () => graph,
        fetchElevations: jamais,
        wind: async () => null,
        settings: { ...SETTINGS, elevationBudgetMs: 50, terrainWaitMs: 50 },
      },
    )
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.meta.elevation_skipped).toBe(true)
    expect(result.routes[0].elevation_profile).toBeNull()
  }, 2_000)

  it('va chercher le D+ demandé', async () => {
    // « Environ 60 m » : un coteau à 5 % à l'est du départ, la plaine à l'ouest.
    // Avec les réglages de l'app — départ devant la porte, tirages
    // supplémentaires —, que la parité ne voit pas.
    const height = ([lon]) => 200 + Math.max(0, lon - 4.8395) * 111_320 * Math.cos((47 * Math.PI) / 180) * 0.05
    const deps = {
      loadGraph: async () => graph,
      fetchElevations: async (routes) => routes.map((coords) => ({ values: coords.map(height), coarse: false })),
      wind: async () => null,
    }
    const ascents = async (climb) =>
      (await planLoops({ lat: 47.0245, lon: 4.8395, distance_km: 5, limit: 4, climb_m: climb }, deps)).routes.map(
        (r) => r.ascent_m,
      )
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length
    const plat = await ascents(0)
    const coteau = await ascents(60)
    expect(Math.abs(coteau[0] - 60)).toBeLessThan(Math.abs(plat[0] - 60))
    expect(mean(coteau)).toBeGreaterThan(mean(plat) + 20)
  }, 30_000)

  it('refuse un D+ négatif', async () => {
    await expect(
      planLoops({ lat: 47.0245, lon: 4.8395, distance_km: 5, climb_m: -10 }, { loadGraph: async () => graph }),
    ).rejects.toThrow('Paramètre climb_m invalide.')
  })
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
  // À 7 km et de nuit, toute boucle d'ici longe encore la départementale. À
  // 5 km, plus depuis que les voies communales comptent à 60 et non à 80 —
  // voir le test suivant.
  //
  // **L'heure est fixée**, de jour comme de nuit : laissée à `auto`, elle était
  // lue sur l'horloge. À midi, Bligny a ses boucles A et B à 7 km, rien à
  // repêcher, et ces tests échouaient — la CI ne restait verte que parce que
  // ses deux derniers passages tombaient avant l'aube.
  //
  // **Les tirages en plus sont coupés** (`widen`) : poussés jusqu'à huit, ils
  // trouvent désormais à 7 km la boucle qui manquait — voir le test suivant. Le
  // repêchage, lui, reste ce qu'on montre quand ils n'en trouvent pas.
  const sansBoucle = {
    ...bligny, distance_km: 7, sport: 'run', limit: 5, with_elevation: false, time_of_day: 'night', widen: false,
  }

  it("cherche assez loin pour trouver la boucle qui manquait", async () => {
    // Deux tirages tournés ne rendaient que des trajets le long de la
    // départementale ; les suivants tracent une boucle de 6,7 km, sans un mètre
    // exposé — et la recherche n'en est pas plus longue, 0,16 s sur un PC.
    // Sans limite de temps : sur une machine lente, l'arrêt au temps couperait
    // les tirages avant elle, et le test dépendrait de la CI.
    const result = await planLoops(
      { ...sansBoucle, widen: true },
      { loadGraph: async () => graph, wind: async () => null, settings: { ...SETTINGS, widenBudgetMs: Infinity } },
    )
    expect(result.meta.salvaged).toBeUndefined()
    expect(result.meta.relaxed).toBe(false)
    expect(result.routes[0].laps).toBe(1)
    expect(result.routes[0].safety.grade).toBe('A')
  }, 30_000)

  it('trouve désormais une vraie boucle par les routes des vignes', async () => {
    // Les voies communales comptaient comme une départementale : à 5 km, il
    // n'y avait que des trajets repêchés. Ce sont elles qui font la boucle.
    const result = await planLoops(
      { ...bligny, distance_km: 5, sport: 'run', limit: 5, with_elevation: false, time_of_day: 'day' },
      { loadGraph: async () => graph, wind: async () => null },
    )
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.meta.salvaged).toBeUndefined()
    expect(result.routes[0].safety.grade).toBe('A')
  }, 30_000)

  it('propose les moins mauvais plutôt que rien', async () => {
    const result = await planLoops(sansBoucle, { loadGraph: async () => graph, wind: async () => null })
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.meta.salvaged).toBe('exposed_share')
    // Et le dit : l'avertissement est le même que pour un repli de mode.
    expect(result.meta.relaxed).toBe(true)
    expect(result.meta.message).toMatch(/longe la route/i)
  }, 30_000)

  it('a un message pour chaque refus, rangé sous son code', () => {
    // Deux messages étaient rangés sous le nom de la mesure plutôt que sous le
    // code du refus : un village où tout traversait la départementale lisait le
    // message général, jamais celui qui parlait des traversées.
    const base = {
      distanceM: 10_000, exposedM: 0, longestExposedM: 0, unprotectedCrossings: 0, protectedCrossings: 0,
      tunnelUnlitM: 0, closureM: 0, overlapShare: 0, protectedM: 10_000, inferredM: 0,
    }
    for (const overrides of [
      { exposedM: 500, longestExposedM: 100 },
      { exposedM: 200, longestExposedM: 200 },
      { unprotectedCrossings: 3 },
    ]) {
      const { code } = runGate(new RouteStats({ ...base, ...overrides }), 'safe').failures[0]
      expect(SALVAGED_MESSAGE, code).toHaveProperty(code)
    }
  })

  it('ne fait pas passer un repêchage pour une recommandation', async () => {
    const result = await planLoops(sansBoucle, { loadGraph: async () => graph, wind: async () => null })
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
          routes.map((coords) => ({ values: coords.map(([lon], i) => 100 + i + lon), coarse: false })),
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

    // Ce qui montait descend — à un palier près. Le cumul ne compte une montée
    // qu'une fois le seuil franchi (deux mètres ici), en partant du début du
    // profil : le dernier bout de pente, sous le seuil, n'est jamais compté, et
    // à l'envers ce bout-là est à l'autre extrémité. L'écart est donc borné par
    // le seuil, pas nul.
    expect(Math.abs(envers.ascent_m - route.descent_m)).toBeLessThan(2)
    expect(Math.abs(envers.descent_m - route.ascent_m)).toBeLessThan(2)

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

/**
 * Les tours complètent la liste, ils ne la mènent pas. Depuis la rue des
 * Primevères, à Soultz, douze propositions de 9 km en mettaient cinq en tours
 * en tête : notés A, ils passaient devant des boucles entières notées B.
 */
describe('les tours', () => {
  const boucle = (edges, bearing, laps = 1) => {
    const cand = new Candidate(edges, [])
    cand.bearing = bearing
    cand.laps = laps
    return cand
  }

  it('passent après toutes les boucles entières, même mieux notés', () => {
    const tours = boucle([1, 2, 3], 0, 2)
    const entiere = boucle([7, 8, 9], 180)
    const choisis = selectVaried([[0.6, tours, 0], [-1.5, entiere, 1]], 2)
    expect(choisis.map(([, cand]) => cand)).toEqual([entiere, tours])
  })

  it('complètent une liste trop courte', () => {
    expect(selectVaried([[0.6, boucle([1, 2, 3], 0, 2), 0]], 5)).toHaveLength(1)
  })
})

/**
 * Le « 8 » : deux boucles différentes enchaînées au départ, plutôt que deux fois
 * la même. Sur le damier de la parité, à 6 km, deux « 2 × 2,9 km » devenaient
 * un seul 8 — la parité vérifie ses consignes et ses longueurs. Le retourner,
 * lui, n'existe que dans l'app.
 */
describe('le huit', () => {
  const dir = new URL('./__fixtures__/parity/', import.meta.url)
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-grid9.json.gz', dir))).toString('utf8')))
  const graph = buildGraph(extract, { sport: 'run' })

  async function huit() {
    let gardé = null
    // Les réglages de la parité : c'est ce cas-là qu'elle vérifie.
    const req = { lat: 48.806, lon: 2.306, distance_km: 6, limit: 6, with_elevation: false, time_of_day: 'day' }
    const result = await planLoops(
      { ...req, doorstep: false, carfree: false, widen: false },
      {
        loadGraph: async () => graph,
        wind: async () => null,
        onReversible: (r) => {
          gardé = r
        },
      },
    )
    const rank = result.routes.findIndex((r) => r.figure_eight)
    return { route: result.routes[rank], kept: gardé.routes[rank], gardé }
  }

  it('dit où finit la première boucle, et de quel côté repart la seconde', async () => {
    const { route } = await huit()
    expect(route.laps).toBe(2)
    const [premiere, seconde] = route.lap_distances_m
    expect(premiere + seconde).toBeCloseTo(route.distance_m, 0)
    const repere = route.instructions.find((step) => step.turn === 'lap')
    expect(repere.dist_m).toBe(premiere)
  })

  it('se retourne en commençant par sa seconde boucle', async () => {
    const { route, kept, gardé } = await huit()
    const { route: envers } = reverseRoute(gardé.graph, gardé.start, kept.cand, {
      req: gardé.req, elev: kept.elev, score: kept.score, rank: kept.rank, night: gardé.night,
    })
    expect(envers.figure_eight).toBe(true)
    expect(envers.lap_distances_m).toEqual([...route.lap_distances_m].reverse())
    expect(envers.instructions.find((step) => step.turn === 'lap').dist_m).toBe(envers.lap_distances_m[0])
  })
})
