import { beforeEach, describe, expect, it, vi } from 'vitest'
import { load, save, slim } from './storage'

/**
 * La persistance locale.
 *
 * Deux choses s'y jouent, et toutes deux échouent en silence quand elles
 * échouent. **Ce qu'on garde** : un favori amputé de ses consignes se rouvre
 * sans guidage, et l'écran reste sur « en attente du signal GPS » sans jamais
 * rien dire. **Ce qu'on fait quand il n'y a plus de place** : le quota du
 * navigateur finit toujours par être atteint, et perdre un favori sans le dire
 * est le pire des comportements.
 */

/** Un faux `localStorage`, avec un quota qu'on peut resserrer à volonté. */
function fauxStockage({ quota = Infinity } = {}) {
  const donnees = new Map()
  return {
    donnees,
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => {
      if (v.length > quota) {
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      donnees.set(k, v)
    },
    removeItem: (k) => donnees.delete(k),
  }
}

const routeComplete = {
  id: 'r0-10000',
  name: 'Boucle nord · Rue du Temple',
  distance_m: 10_012,
  duration_s: 3905,
  ascent_m: 37,
  descent_m: 37,
  geometry: [
    [2.35, 48.85],
    [2.36, 48.86],
    [2.35, 48.85],
  ],
  segments: [
    { coords: [[2.35, 48.85]], length_m: 500, level: 'safe', surface: 'paved', road: 'Rue A' },
  ],
  crossings: [{ lon: 2.355, lat: 48.855, protected: false, speed_kmh: 80, kind: 'untagged' }],
  elevation_profile: [{ dist_m: 0, ele_m: 35, surface: 'paved' }],
  instructions: [
    { dist_m: 0, turn: 'start', angle: 0, road: 'Rue A', text: 'Départ', lon: 2.35, lat: 48.85, caution: false },
    { dist_m: 500, turn: 'left', angle: -90, road: 'Rue B', text: 'Tourne à gauche', lon: 2.36, lat: 48.86, caution: true },
  ],
  safety: { grade: 'A', protected_share: 0.95, exposed_m: 0, unprotected_crossings: 0 },
  surfaces: { paved_m: 10_012, gravel_m: 0, trail_m: 0, unknown_m: 0 },
  direction: 'nord',
  bearing: 12.5,
  shape: 4,
  roundness: 0.52,
  score: 0.91,
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fauxStockage())
})

describe('slim', () => {
  it('garde les consignes de navigation', () => {
    // Le bug corrigé : sans elles, un favori relancé n'a aucun guidage vocal
    // et l'écran reste indéfiniment « en attente du signal GPS ».
    expect(slim(routeComplete).instructions).toHaveLength(2)
    expect(slim(routeComplete).instructions[1].text).toBe('Tourne à gauche')
  })

  it('garde la géométrie, les traversées et le profil', () => {
    const s = slim(routeComplete)
    expect(s.geometry).toHaveLength(3)
    expect(s.crossings).toHaveLength(1)
    expect(s.elevation_profile).toHaveLength(1)
  })

  it('garde de quoi présenter la boucle', () => {
    const s = slim(routeComplete)
    expect(s).toMatchObject({ direction: 'nord', shape: 4, grade: 'A' })
    expect(s.bearing).toBe(12.5)
  })

  it('jette les coordonnées des tronçons', () => {
    // C'est le seul poste vraiment lourd : sur 10 km il pèse à lui seul des
    // centaines de kilooctets, et la géométrie d'ensemble suffit à tracer.
    const s = slim(routeComplete)
    expect(s.segments[0].coords).toBeUndefined()
    expect(s.segments[0].length_m).toBe(500)
  })

  it('supporte un parcours sans bloc de sécurité', () => {
    // Une sortie libre n'en a pas : `slim` ne doit pas s'y casser.
    expect(() => slim({ ...routeComplete, safety: null })).not.toThrow()
    expect(slim({ ...routeComplete, safety: null }).grade).toBeNull()
  })

  it('horodate l’enregistrement', () => {
    expect(Date.parse(slim(routeComplete).savedAt)).not.toBeNaN()
  })
})

describe('load et save', () => {
  it('rend les valeurs par défaut sur un stockage vide', () => {
    expect(load()).toEqual({ favorites: [], history: [], params: null })
  })

  it('relit ce qui a été écrit', () => {
    save({ favorites: [slim(routeComplete)] })
    expect(load().favorites[0].name).toBe(routeComplete.name)
  })

  it('fusionne au lieu de remplacer', () => {
    save({ favorites: [1] })
    save({ history: [2] })
    expect(load()).toMatchObject({ favorites: [1], history: [2] })
  })

  it('survit à un stockage inaccessible', () => {
    // Navigation privée, réglages du navigateur : l'app doit continuer.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('refusé')
      },
      setItem: () => {
        throw new Error('refusé')
      },
    })
    expect(load()).toEqual({ favorites: [], history: [], params: null })
    expect(() => save({ favorites: [] })).not.toThrow()
  })

  it('survit à un contenu corrompu', () => {
    const s = fauxStockage()
    s.setItem('lacet.v1', '{ceci n’est pas du JSON')
    vi.stubGlobal('localStorage', s)
    expect(load()).toEqual({ favorites: [], history: [], params: null })
  })

  it('sacrifie l’historique quand le quota est atteint', () => {
    // La règle : les sorties les plus anciennes ont le moins de valeur, ce sont
    // elles qui partent — pas les favoris, que l'on a choisis exprès.
    const historique = Array.from({ length: 40 }, (_, i) => ({ id: i, bourrage: 'x'.repeat(200) }))
    vi.stubGlobal('localStorage', fauxStockage({ quota: 4000 }))

    const apres = save({ favorites: [{ id: 'garde-moi' }], history: historique })
    expect(apres.favorites).toHaveLength(1)
    expect(apres.history.length).toBeLessThan(40)
  })

  it('renonce plutôt que de perdre les données déjà en place', () => {
    // Quota si serré que même l'historique réduit ne passe pas : `save` doit
    // rendre l'état d'avant, pas un état à moitié écrit.
    const s = fauxStockage({ quota: 10 })
    vi.stubGlobal('localStorage', s)
    const apres = save({ favorites: [{ id: 'trop-gros', bourrage: 'x'.repeat(500) }] })
    expect(apres).toEqual({ favorites: [], history: [], params: null })
  })
})
