import { describe, expect, it } from 'vitest'
import { MAX_TILES, MIN_ZOOM, formatBytes, keyOf, planTiles, tilesFor } from './offlineMaps'

/**
 * Le calcul des tuiles à mettre de côté.
 *
 * C'est de l'arithmétique de projection, le genre de code qui a l'air juste et
 * se trompe d'un facteur deux ou d'un signe sans que rien ne le montre : une
 * carte hors ligne décalée d'une tuile a l'air de marcher jusqu'au jour où l'on
 * en a besoin, en pleine campagne, sans réseau pour corriger.
 *
 * Le piège principal est l'axe des ordonnées : en projection Web Mercator, y
 * croît vers le **sud**, à l'inverse de la latitude. Inverser les bornes donne
 * une plage vide — donc aucune tuile, donc un écran noir.
 */

const MODELE = 'https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt'

/** Un carré d'environ 4 km de côté au centre de Paris. */
const PARIS = [
  [2.32, 48.84],
  [2.38, 48.84],
  [2.38, 48.88],
  [2.32, 48.88],
  [2.32, 48.84],
]

const zoomDe = (url) => Number(url.match(/\/v1\/(\d+)\//)[1])
const coordsDe = (url) => url.match(/\/v1\/\d+\/(\d+)\/(\d+)\./).slice(1).map(Number)

describe('tilesFor', () => {
  it('couvre du zoom 10 au zoom 14', () => {
    const zooms = new Set(tilesFor(PARIS, MODELE).map(zoomDe))
    expect([...zooms].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14])
  })

  it('ne descend pas plus bas que le zoom des tuiles', () => {
    // Les tuiles de CARTO s'arrêtent à 14 : demander 15 rendrait des 404.
    expect(Math.max(...tilesFor(PARIS, MODELE).map(zoomDe))).toBe(14)
  })

  it('reste d’un volume raisonnable pour une boucle urbaine', () => {
    // C'est tout l'intérêt du vectoriel : une poignée de tuiles, pas des
    // centaines. Si ce nombre explose, la fonctionnalité devient inacceptable.
    expect(tilesFor(PARIS, MODELE).length).toBeLessThan(60)
  })

  it('englobe réellement le parcours', () => {
    const urls = tilesFor(PARIS, MODELE)
    const z14 = urls.filter((u) => zoomDe(u) === 14).map(coordsDe)

    // Tuile attendue pour le coin sud-ouest, calculée indépendamment.
    const x = Math.floor(((2.32 + 180) / 360) * 2 ** 14)
    const rad = (48.84 * Math.PI) / 180
    const y = Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** 14,
    )
    expect(z14).toContainEqual([x, y])
  })

  it('prend une marge autour du parcours', () => {
    const z14 = tilesFor(PARIS, MODELE).filter((u) => zoomDe(u) === 14).map(coordsDe)
    const xs = z14.map(([x]) => x)
    const ys = z14.map(([, y]) => y)
    // Le carré fait ~4 km, soit deux tuiles ; avec une marge de chaque côté on
    // attend au moins quatre colonnes.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(3)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(2)
  })

  it('n’oublie aucune tuile intermédiaire', () => {
    const z14 = tilesFor(PARIS, MODELE).filter((u) => zoomDe(u) === 14).map(coordsDe)
    const xs = [...new Set(z14.map(([x]) => x))].sort((a, b) => a - b)
    const ys = [...new Set(z14.map(([, y]) => y))].sort((a, b) => a - b)
    expect(z14).toHaveLength(xs.length * ys.length)
  })

  it('range les tuiles sous un seul sous-domaine', () => {
    // Les quatre sous-domaines sont équivalents et le rendu en choisit un au
    // hasard : sans cette normalisation, une tuile gardée serait introuvable.
    const urls = tilesFor(
      PARIS,
      'https://tiles-c.basemaps.cartocdn.com/vectortiles/v1/{z}/{x}/{y}.mvt',
    )
    expect(urls.every((u) => u.includes('//tiles.basemaps'))).toBe(true)
  })

  it('ne rend rien sans parcours ni gabarit', () => {
    expect(tilesFor([], MODELE)).toEqual([])
    expect(tilesFor(PARIS, null)).toEqual([])
    expect(tilesFor(undefined, MODELE)).toEqual([])
  })

  it('ne sort jamais de la grille', () => {
    // Un parcours près de l'antiméridien ou d'un pôle ne doit pas produire
    // d'indices négatifs ou hors bornes, qui donneraient des 404 en série.
    const bords = [
      [179.95, 84.0],
      [179.99, 84.05],
    ]
    for (const url of tilesFor(bords, MODELE)) {
      const [x, y] = coordsDe(url)
      const max = 2 ** zoomDe(url)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(max)
      expect(y).toBeLessThan(max)
    }
  })

  it('ne rend pas deux fois la même tuile', () => {
    const urls = tilesFor(PARIS, MODELE)
    expect(new Set(urls).size).toBe(urls.length)
  })
})

describe('le budget de tuiles', () => {
  /** Un carré de `cote` degrés de latitude, centré sur Paris. */
  const carre = (cote) => [
    [2.35 - cote, 48.86 - cote],
    [2.35 + cote, 48.86 - cote],
    [2.35 + cote, 48.86 + cote],
    [2.35 - cote, 48.86 + cote],
    [2.35 - cote, 48.86 - cote],
  ]

  it('garde le zoom le plus fin pour une boucle urbaine', () => {
    expect(planTiles(PARIS, MODELE).maxZoom).toBe(14)
  })

  it('n’est jamais dépassé, quelle que soit la taille du parcours', () => {
    for (const cote of [0.02, 0.1, 0.5, 1.5, 5, 20, 60]) {
      const { urls } = planTiles(carre(cote), MODELE)
      expect(urls.length).toBeLessThanOrEqual(MAX_TILES)
    }
  })

  it('renonce au détail plutôt que de trouer la carte', () => {
    // Une sortie vélo de 250 km demanderait 5 500 tuiles au zoom 14. On
    // descend d'un cran plutôt que de couper la liste : une carte grossière
    // reste utilisable, une carte trouée laisse des zones noires.
    const { urls, maxZoom } = planTiles(carre(0.5), MODELE)
    expect(maxZoom).toBeLessThan(14)
    // Complète malgré tout : tous les zooms jusqu'au plafond retenu.
    const zooms = new Set(urls.map(zoomDe))
    for (let z = MIN_ZOOM; z <= maxZoom; z += 1) expect(zooms.has(z)).toBe(true)
  })

  it('descend sous le zoom de base plutôt que de laisser filer le budget', () => {
    // La première version s'arrêtait au zoom 10, ce qui faisait du plafond un
    // vœu pieux : à l'échelle d'un continent, le zoom 10 coûte à lui seul des
    // centaines de milliers de tuiles. Mieux vaut une carte volontairement
    // grossière qu'un téléchargement qu'on ne verra jamais finir.
    const { maxZoom, urls } = planTiles(carre(60), MODELE)
    expect(maxZoom).toBeLessThan(MIN_ZOOM)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.length).toBeLessThanOrEqual(MAX_TILES)
  })

  it('rend une carte même au-delà des limites de Mercator', () => {
    // La projection s'arrête vers 85° : au-delà la formule prend le logarithme
    // d'un nombre négatif et rend `NaN`, qui ne déclenche aucune erreur et se
    // contente de ne produire aucune tuile — exactement le trou noir qu'on
    // cherchait à éviter.
    const { urls } = planTiles([[10, 89.9], [10.05, 89.99]], MODELE)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).not.toContain('NaN')
  })

  it('répond vite même sur une géométrie aberrante', () => {
    // Le compte se fait avant de construire la liste : sinon une coordonnée
    // inversée demanderait des centaines de millions d'entrées et ferait
    // tomber l'onglet.
    const debut = Date.now()
    planTiles(
      [
        [-179.9, -84],
        [179.9, 84],
      ],
      MODELE,
    )
    expect(Date.now() - debut).toBeLessThan(500)
  })
})

describe('keyOf', () => {
  it('identifie un parcours par son nom et sa distance', () => {
    expect(keyOf({ name: 'Boucle nord', distance_m: 10_012.4 })).toBe('Boucle nord|10012')
  })
})

describe('formatBytes', () => {
  it('reste lisible à toutes les échelles', () => {
    expect(formatBytes(512)).toBe('512 o')
    expect(formatBytes(2048)).toBe('2 Ko')
    expect(formatBytes(3_500_000)).toBe('3.3 Mo')
  })
})
