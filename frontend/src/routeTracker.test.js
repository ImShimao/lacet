import { describe, expect, it } from 'vitest'
import { buildTrack, locate, nextInstruction, OFF_ROUTE_M, runsBack, wrongWay } from './routeTracker'

/**
 * Le suivi de parcours.
 *
 * C'est le seul code de l'application qui tourne pendant qu'on court, sans
 * personne pour le regarder. S'il se trompe, la consigne arrive après le
 * carrefour, l'alerte de traversée ne part pas, ou l'app annonce un
 * hors-parcours à quelqu'un qui suit exactement le tracé — et on cesse de lui
 * faire confiance. D'où ces tests, qui portent surtout sur ce qui rate en vrai :
 * les boucles qui se longent, les positions aberrantes, les segments longs.
 */

const LAT = 48.85
// ~0,0009° de latitude font 100 m ; on garde des nombres ronds pour que les
// distances attendues se lisent dans les tests.
const PAS = 0.0009
const CENT_METRES = 100

/** Une ligne droite plein nord, `n` points espacés de ~100 m. */
function ligne(n, lon = 2.35, lat = LAT) {
  return Array.from({ length: n }, (_, i) => [lon, lat + i * PAS])
}

describe('buildTrack', () => {
  it('cumule les distances le long du tracé', () => {
    const track = buildTrack(ligne(4))
    expect(track.cumulative[0]).toBe(0)
    expect(track.total).toBeCloseTo(3 * CENT_METRES, -1)
  })

  it('supporte une géométrie vide sans casser', () => {
    expect(buildTrack([]).total).toBe(0)
    expect(buildTrack(undefined).total).toBe(0)
  })

  it('rend une longueur nulle pour un point isolé', () => {
    expect(buildTrack([[2.35, LAT]]).total).toBe(0)
  })
})

describe('locate', () => {
  it('rend null quand le tracé ne fait pas une ligne', () => {
    expect(locate(buildTrack([[2.35, LAT]]), [2.35, LAT], null)).toBeNull()
  })

  it('projette une position pile sur le tracé', () => {
    const track = buildTrack(ligne(5))
    const fix = locate(track, [2.35, LAT + 2 * PAS], null)
    expect(fix.offset).toBeLessThan(1)
    expect(fix.along).toBeCloseTo(2 * CENT_METRES, -1)
    expect(fix.offRoute).toBe(false)
  })

  it('projette **sur le segment**, pas sur le sommet le plus proche', () => {
    // À mi-chemin entre deux points distants de 100 m, se rabattre sur le
    // sommet donnerait un écart de 50 m — de quoi déclencher une fausse alerte
    // de hors-parcours alors qu'on est exactement sur le tracé.
    const track = buildTrack([
      [2.35, LAT],
      [2.35, LAT + PAS],
    ])
    const fix = locate(track, [2.35, LAT + PAS / 2], null)
    expect(fix.offset).toBeLessThan(1)
    expect(fix.along).toBeCloseTo(CENT_METRES / 2, -1)
  })

  it('corrige la longitude selon la latitude', () => {
    // Un degré de longitude est plus court qu'un degré de latitude : sans
    // correction, l'écart serait surestimé de moitié sur un segment est-ouest.
    const track = buildTrack([
      [2.35, LAT],
      [2.36, LAT],
    ])
    const fix = locate(track, [2.355, LAT + 0.0009], null)
    expect(fix.offset).toBeCloseTo(CENT_METRES, -1)
  })

  it('signale le hors-parcours au-delà du seuil', () => {
    const track = buildTrack(ligne(5))
    const proche = locate(track, [2.35 + 0.0004, LAT + 2 * PAS], null)
    const loin = locate(track, [2.35 + 0.004, LAT + 2 * PAS], null)
    expect(proche.offRoute).toBe(false)
    expect(loin.offset).toBeGreaterThan(OFF_ROUTE_M)
    expect(loin.offRoute).toBe(true)
  })

  it('avance de façon monotone quand on suit le tracé', () => {
    const track = buildTrack(ligne(20))
    let fix = null
    const positions = []
    for (let i = 0; i < 20; i += 1) {
      fix = locate(track, [2.35, LAT + i * PAS], fix)
      positions.push(fix.along)
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('ne saute pas sur le passage parallèle d’une boucle', () => {
    // Le piège des boucles : l'aller et le retour se longent à 60 m. Sans
    // fenêtre de recherche, une position au début serait projetée sur le
    // retour — le plus proche dans l'absolu — et le guidage sauterait des
    // kilomètres d'un coup.
    const aller = ligne(30)
    const retour = ligne(30, 2.3508).reverse()
    const track = buildTrack([...aller, ...retour])

    let fix = locate(track, aller[0], null)
    fix = locate(track, aller[3], fix)
    expect(fix.along).toBeLessThan(10 * CENT_METRES)

    // Une position exactement entre les deux brins doit rester sur l'aller,
    // puisque c'est là qu'on se trouvait au relevé précédent.
    const entre = [2.3504, LAT + 4 * PAS]
    fix = locate(track, entre, fix)
    expect(fix.along).toBeLessThan(15 * CENT_METRES)
  })

  it('garde le dernier point connu si rien ne convient', () => {
    const track = buildTrack(ligne(5))
    const premier = locate(track, [2.35, LAT], null)
    const ailleurs = locate(track, [2.35, LAT], premier)
    expect(ailleurs).not.toBeNull()
  })

  it('ne suit pas un reflet tombé sur le tracé deux cents mètres plus loin', () => {
    // Un relevé par seconde : on n'a pu courir qu'une trentaine de mètres. Le
    // reflet, pile sur le tracé mais deux cents mètres devant, est loin de
    // tout ce qu'on a pu atteindre — et la fenêtre tient tout entière dans un
    // segment de cent mètres, sans qu'on cesse pour autant d'y chercher.
    const track = buildTrack(ligne(10))
    const avant = locate(track, [2.35, LAT + 3 * PAS], null)
    const reflet = locate(track, [2.35, LAT + 5 * PAS], avant, { reach: 27 })
    expect(reflet.along).toBeLessThan(3 * CENT_METRES + 30)
    expect(reflet.offRoute).toBe(true)
    // Revenu à sa place, le relevé suivant y retombe.
    expect(locate(track, [2.35, LAT + 3.03 * PAS], avant, { reach: 27 }).offset).toBeLessThan(1)
  })

  it('suit le retour d’un aller-retour dans le sens où l’on court', () => {
    // Une impasse : on monte jusqu'au bout, on redescend par la même rue. Dix
    // mètres après le demi-tour, l'aller et le retour sont au même écart, et
    // l'aller est le plus près de l'avancée attendue si celle-ci retarde un
    // peu. Le cap du GPS — on descend, plein sud — tranche.
    const track = buildTrack([...ligne(3), [2.35, LAT + PAS], [2.35, LAT]])
    const avant = { along: 195, offRoute: false }
    const ici = [2.35, LAT + 1.9 * PAS]
    expect(locate(track, ici, avant, { reach: 27, ahead: 3 }).along).toBeCloseTo(190, -1)
    expect(locate(track, ici, avant, { reach: 27, ahead: 3, course: 180 }).along).toBeCloseTo(210, -1)
  })
})

describe('runsBack', () => {
  it('voit qu’on remonte le tracé, et seulement alors', () => {
    const track = buildTrack(ligne(5))
    expect(runsBack(track, 150, 180)).toBe(true)
    expect(runsBack(track, 150, 10)).toBe(false)
    // À angle droit, ce n'est pas un demi-tour : une rue qu'on traverse.
    expect(runsBack(track, 150, 90)).toBe(false)
  })
})

describe('nextInstruction', () => {
  const consignes = [
    { dist_m: 0, turn: 'start' },
    { dist_m: 500, turn: 'left' },
    { dist_m: 1200, turn: 'right' },
    { dist_m: 2000, turn: 'finish' },
  ]

  it('rend la première consigne non encore annoncée', () => {
    const faites = new Set()
    const suivante = nextInstruction(consignes, 100, faites)
    expect(suivante.index).toBe(1)
    expect(suivante.remaining).toBe(400)
  })

  it('saute celles déjà annoncées', () => {
    const faites = new Set([0, 1])
    expect(nextInstruction(consignes, 100, faites).index).toBe(2)
  })

  it('classe comme faite une consigne dépassée', () => {
    // Sans ça, une consigne manquée bloquerait toutes les suivantes et le
    // guidage s'arrêterait sans rien dire pour le reste de la sortie.
    const faites = new Set()
    const suivante = nextInstruction(consignes, 700, faites)
    expect(faites.has(1)).toBe(true)
    expect(suivante.index).toBe(2)
  })

  it('tolère un léger dépassement sans abandonner la consigne', () => {
    const faites = new Set()
    const suivante = nextInstruction(consignes, 510, faites)
    expect(suivante.index).toBe(1)
    expect(suivante.remaining).toBeLessThan(0)
  })

  it('rend null une fois tout annoncé', () => {
    const faites = new Set([0, 1, 2, 3])
    expect(nextInstruction(consignes, 100, faites)).toBeNull()
  })

  it('rend null sur une liste vide', () => {
    expect(nextInstruction([], 0, new Set())).toBeNull()
  })
})

describe('wrongWay', () => {
  // Un carré de 300 m de côté, parcouru nord, est, sud, puis ouest jusqu'au
  // départ : en partant vers l'est, on court sur le dernier côté, à rebours.
  const EST = 0.00137 // ~100 m de longitude à cette latitude
  const DEPART = [2.35, LAT]
  const carre = buildTrack([
    DEPART,
    [2.35, LAT + 3 * PAS],
    [2.35 + 3 * EST, LAT + 3 * PAS],
    [2.35 + 3 * EST, LAT],
    DEPART,
  ])

  it('voit le départ pris du mauvais côté', () => {
    expect(wrongWay(carre, DEPART, [2.35 + EST, LAT], 0)).toBe(true)
  })

  it('se tait dans le bon sens', () => {
    expect(wrongWay(carre, DEPART, [2.35, LAT + PAS], 0)).toBe(false)
  })

  it('se tait sur un raccourci pris dans le sens du tracé', () => {
    expect(wrongWay(carre, [2.35 + 3 * EST, LAT], [2.35 + 2 * EST, LAT], 0)).toBe(false)
  })

  it('attend un vrai déplacement, pas le tremblement du GPS', () => {
    expect(wrongWay(carre, DEPART, [2.35 + 0.00005, LAT], 0)).toBe(false)
  })

  it('laisse le demi-tour en pleine course à « Tu reviens sur tes pas »', () => {
    // Déjà au bout du deuxième côté : revenir sur le premier n'est pas devant.
    expect(wrongWay(carre, [2.35, LAT + 3 * PAS], [2.35, LAT + 2 * PAS], 600)).toBe(false)
  })
})
