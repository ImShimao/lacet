import { describe, expect, it } from 'vitest'
import { alreadyRun } from './knownRoutes'

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
