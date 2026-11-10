import { describe, expect, it } from 'vitest'
import { alreadyRun, familiarTo, ranFrom, records, sameRoute, standing, traceOf } from './knownRoutes'

/**
 * Reconnaître un chemin déjà parcouru.
 *
 * Deux erreurs coûtent ici, et la seconde plus que la première. Ne pas
 * reconnaître sa boucle du dimanche, c'est une occasion manquée. La
 * reconnaître à tort, c'est écarter une proposition qu'on n'a jamais courue —
 * et deux boucles de dix kilomètres au même départ peuvent n'avoir aucune rue
 * en commun.
 */

/** Une boucle en anneau autour d'un point, échantillonnée finement. */
function anneau(lon, lat, rayonM, { depuis = 0, points = 200 } = {}) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const out = []
  for (let i = 0; i <= points; i += 1) {
    const a = depuis + (2 * Math.PI * i) / points
    out.push([lon + (rayonM * Math.cos(a)) / kx, lat + (rayonM * Math.sin(a)) / 110_540])
  }
  return out
}

const longueur = (rayonM) => 2 * Math.PI * rayonM

const sortie = (geometry, extra = {}) => ({
  ranAt: '2026-09-14T09:00:00.000Z',
  actual_distance_m: extra.distance ?? Math.round(longueur(800)),
  actual_duration_s: 3600,
  track: geometry,
  ...extra,
})

describe('se comparer à soi-même', () => {
  const trace = anneau(7.2, 47.9, 800)
  const passage = (jour, secondes, extra = {}) => ({
    ranAt: `2026-09-${String(jour).padStart(2, '0')}T09:00:00.000Z`,
    actual_distance_m: Math.round(longueur(800)),
    actual_duration_s: secondes,
    track: trace,
    ...extra,
  })

  it('retrouve les autres passages sur le même chemin, le plus récent d’abord', () => {
    const aujourdhui = passage(20, 1500)
    const trouvés = sameRoute(aujourdhui, [passage(14, 1600), passage(7, 1450), aujourdhui])
    expect(trouvés).toHaveLength(2)
    expect(trouvés[0].ranAt).toContain('-14')
    // La sortie qu'on regarde ne se compare pas à elle-même.
    expect(trouvés.some((r) => r.ranAt === aujourdhui.ranAt)).toBe(false)
  })

  it('écarte les boucles d’ailleurs, même de même longueur', () => {
    const ailleurs = { ...passage(14, 1600), track: anneau(7.25, 47.95, 800) }
    expect(sameRoute(passage(20, 1500), [ailleurs])).toHaveLength(0)
  })

  it('dit qu’un record est un record, et de combien', () => {
    // 1450 s pour 5,03 km, contre 1600 la fois d'avant : plus rapide.
    const rang = standing(passage(20, 1450), [passage(14, 1600), passage(7, 1550)])
    expect(rang.record).toBe(true)
    expect(rang.count).toBe(3)
    expect(rang.vsPrevious).toBeLessThan(0)
  })

  it('situe une sortie moins bonne sans la juger', () => {
    const rang = standing(passage(20, 1700), [passage(14, 1600), passage(7, 1450)])
    expect(rang.record).toBe(false)
    expect(rang.best.actual_duration_s).toBe(1450)
    expect(rang.previous.ranAt).toContain('-14')
    expect(rang.vsBest).toBeGreaterThan(0)
  })

  it('ne dit rien la première fois', () => {
    expect(standing(passage(20, 1500), [])).toBeNull()
    // Ni quand les autres passages n'ont pas de temps à comparer.
    expect(standing(passage(20, 1500), [passage(14, 0)])).toBeNull()
  })
})

describe('déjà couru', () => {
  const boucle = { distance_m: Math.round(longueur(800)), geometry: anneau(7.2, 47.9, 800) }

  it('reconnaît le même chemin, même parcouru un peu différemment', () => {
    // La trace réelle serpente : un GPS urbain se trompe de quelques mètres, et
    // l'on contourne parfois une voiture mal garée.
    const bruitée = anneau(7.2, 47.9, 800).map(([lon, lat], i) => [
      lon + (i % 3 === 0 ? 0.00008 : -0.00005),
      lat + (i % 2 === 0 ? 0.00006 : -0.00007),
    ])
    const trouvé = alreadyRun(boucle, [sortie(bruitée)])
    expect(trouvé).not.toBeNull()
    expect(trouvé.share).toBeGreaterThan(0.9)
  })

  it('reconnaît le chemin parcouru dans l’autre sens', () => {
    // C'est la même boucle : les rues sont les mêmes, seul l'ordre change.
    const envers = [...anneau(7.2, 47.9, 800)].reverse()
    expect(alreadyRun(boucle, [sortie(envers)])).not.toBeNull()
  })

  it('ne confond pas deux boucles de même longueur au même départ', () => {
    // Même départ, même distance, mais l'une part au nord et l'autre au sud :
    // elles ne partagent que le point de départ.
    const ailleurs = anneau(7.23, 47.93, 800)
    expect(alreadyRun(boucle, [sortie(ailleurs)])).toBeNull()
  })

  it('ne retient pas une sortie de longueur trop différente', () => {
    const courte = anneau(7.2, 47.9, 400)
    expect(alreadyRun(boucle, [sortie(courte, { actual_distance_m: Math.round(longueur(400)) })])).toBeNull()
  })

  it('ne retient pas une sortie partie d’ailleurs', () => {
    const loin = anneau(7.3, 47.9, 800)
    expect(alreadyRun(boucle, [sortie(loin)])).toBeNull()
  })

  it('ne dit rien quand il n’y a pas d’historique', () => {
    expect(alreadyRun(boucle, [])).toBeNull()
    expect(alreadyRun(boucle, null)).toBeNull()
    expect(alreadyRun({ geometry: [] }, [sortie(anneau(7.2, 47.9, 800))])).toBeNull()
  })

  it('se contente de la géométrie prévue quand la trace manque', () => {
    // Une sortie enregistrée avant que l'app ne garde les traces, ou un parcours
    // lancé puis arrêté tout de suite.
    const sansTrace = { ...sortie(null), track: null, geometry: anneau(7.2, 47.9, 800) }
    expect(alreadyRun(boucle, [sansTrace])).not.toBeNull()
  })
})

describe('les records', () => {
  const run = (ranAt, km, minutes, sport = 'run') => ({
    ranAt,
    sport,
    actual_distance_m: km * 1000,
    actual_duration_s: minutes * 60,
  })
  const avant = [run('2026-10-02T08:00:00Z', 8, 48), run('2026-09-20T08:00:00Z', 12, 75), run('2026-10-05T08:00:00Z', 30, 70, 'bike')]

  it('reconnaît la plus longue et la plus rapide, entre sorties du même sport', () => {
    const sortie = run('2026-10-19T08:00:00Z', 13, 70)
    const r = records(sortie, [sortie, ...avant])
    expect(r.list).toEqual(['longest', 'fastest'])
    // Octobre : celle du 2, et celle-ci — pas le vélo.
    expect(r.monthCount).toBe(2)
    expect(r.monthM).toBe(21_000)
  })

  it('ne fête rien sans sortie à battre, ni une allure sur un kilomètre', () => {
    expect(records(run('2026-10-19T08:00:00Z', 5, 20), []).list).toEqual([])
    expect(records(run('2026-10-19T08:00:00Z', 1, 3), avant).list).toEqual([])
  })
})

describe('les boucles déjà vues, pour le moteur', () => {
  // Un anneau de 800 m de rayon : 5 km, comme une boucle proposée.
  const boucle = anneau(7.2, 47.9, 800)
  const distance = Math.round(longueur(800))

  it('garde un tracé léger : un point tous les cent mètres, au mètre près', () => {
    const trace = traceOf(boucle, distance)
    expect(trace.length).toBeGreaterThan(45)
    expect(trace.length).toBeLessThanOrEqual(52)
    for (const [lon, lat] of trace) {
      expect(lon).toBe(Math.round(lon * 1e5) / 1e5)
      expect(lat).toBe(Math.round(lat * 1e5) / 1e5)
    }
    // Une sortie de 60 km n'en garde pas plus de cent vingt, départ et arrivée en plus.
    expect(traceOf(anneau(7.2, 47.9, 9500, { points: 2000 }), longueur(9500)).length).toBeLessThanOrEqual(122)
  })

  it('reconnaît la même boucle dans son tracé léger, pas sa voisine', () => {
    const vues = [traceOf(boucle, distance)]
    expect(familiarTo(boucle, vues)).toBe(true)
    // La même, partie d'ailleurs sur l'anneau : c'est le chemin qui compte.
    expect(familiarTo(anneau(7.2, 47.9, 800, { depuis: 1.3 }), vues)).toBe(true)
    // Un anneau parallèle, deux rues plus loin, n'est pas la même boucle.
    expect(familiarTo(anneau(7.2, 47.9, 1000), vues)).toBe(false)
    expect(familiarTo(boucle, [])).toBe(false)
  })

  it('ne retient que les sorties de ce départ, à peu près de cette longueur', () => {
    const ici = { lon: boucle[0][0], lat: boucle[0][1] }
    const history = [
      sortie(boucle),
      sortie(anneau(7.3, 47.9, 800)),
      sortie(boucle, { distance: 15_000 }),
    ]
    const traces = ranFrom(history, ici, distance)
    expect(traces).toHaveLength(1)
    expect(familiarTo(boucle, traces)).toBe(true)
  })
})

describe('les records par distance', () => {
  const tours = (...seconds) => seconds.map((s, i) => ({ km: i + 1, seconds: s }))
  const course = (ranAt, splits, extra = {}) => ({ ranAt, sport: 'run', splits, ...extra })

  it('trouve le meilleur 5 km au milieu d’une sortie plus longue', async () => {
    const { distanceRecords } = await import('./knownRoutes')
    const avant = course('2026-10-01', tours(330, 330, 330, 330, 330))
    const maintenant = course('2026-10-08', tours(360, 320, 320, 320, 320, 320, 360))
    expect(distanceRecords(maintenant, [maintenant, avant])).toEqual([
      { km: 1, seconds: 320 },
      { km: 5, seconds: 1600 },
    ])
  })

  it('ne fête rien la première fois, ni contre un autre sport', async () => {
    const { distanceRecords } = await import('./knownRoutes')
    const maintenant = course('2026-10-08', tours(300, 300))
    const velo = course('2026-10-01', tours(400, 400), { sport: 'bike' })
    expect(distanceRecords(maintenant, [maintenant, velo])).toEqual([])
  })

  it('ne recolle pas des bornes qui ne se suivent pas', async () => {
    const { distanceRecords } = await import('./knownRoutes')
    const avant = course('2026-10-01', tours(330, 330, 330, 330, 330))
    const trouee = course('2026-10-08', [1, 2, 6, 7, 8].map((km) => ({ km, seconds: 200 })))
    expect(distanceRecords(trouee, [avant]).map((r) => r.km)).toEqual([1])
  })
})
