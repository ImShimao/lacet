import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportAll, importAll, load, mirrorTo, recentPlaces, rememberPlace, restoreFrom, save, slim, wipe } from './storage'

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

describe('les départs récents', () => {
  it('garde le dernier choisi devant, sans doublon de lieu', () => {
    rememberPlace({ label: 'Guebwiller', sub: 'Haut-Rhin', lat: 47.9097, lon: 7.2106 })
    rememberPlace({ label: 'Colmar', sub: 'Haut-Rhin', lat: 48.0794, lon: 7.3585 })
    // Le même village, cliqué à quelques mètres près : c'est le même départ.
    rememberPlace({ label: 'Guebwiller centre', sub: '', lat: 47.9098, lon: 7.2107 })
    expect(recentPlaces().map((p) => p.label)).toEqual(['Guebwiller centre', 'Colmar'])
  })

  it('n’en garde que cinq : au-delà, la liste demanderait à être lue', () => {
    for (let i = 0; i < 8; i += 1) rememberPlace({ label: `Lieu ${i}`, lat: 45 + i, lon: 3, sub: '' })
    expect(recentPlaces().map((p) => p.label)).toEqual(['Lieu 7', 'Lieu 6', 'Lieu 5', 'Lieu 4', 'Lieu 3'])
  })

  it('ignore ce qui n’a ni nom ni position', () => {
    rememberPlace({ label: '', lat: 47, lon: 7 })
    rememberPlace({ label: 'Nulle part', lat: NaN, lon: 7 })
    rememberPlace(null)
    expect(recentPlaces()).toEqual([])
  })
})

describe('load et save', () => {
  it('rend les valeurs par défaut sur un stockage vide', () => {
    expect(load()).toEqual({ favorites: [], history: [], params: null, recentPlaces: [], reports: [] })
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
    expect(load()).toEqual({ favorites: [], history: [], params: null, recentPlaces: [], reports: [] })
    expect(() => save({ favorites: [] })).not.toThrow()
  })

  it('survit à un contenu corrompu', () => {
    const s = fauxStockage()
    s.setItem('lacet.v1', '{ceci n’est pas du JSON')
    vi.stubGlobal('localStorage', s)
    expect(load()).toEqual({ favorites: [], history: [], params: null, recentPlaces: [], reports: [] })
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
    expect(apres).toEqual({ favorites: [], history: [], params: null, recentPlaces: [], reports: [] })
  })
})

/**
 * La sauvegarde : ce qui permet de réinstaller l'app sans tout perdre.
 *
 * Elle est **fusionnée** à la restauration, jamais substituée : on restaure
 * souvent après avoir déjà recouru, et effacer ces sorties-là serait le
 * contraire de ce qu'on attend d'une sauvegarde.
 */
describe('la sauvegarde', () => {
  const sortie = (ranAt, m) => ({ id: `h-${ranAt}`, ranAt, actual_distance_m: m, actual_duration_s: 1800 })

  it('emporte favoris, sorties et réglages', () => {
    save({ favorites: [slim(routeComplete)], history: [sortie('2026-09-01T10:00:00.000Z', 10_000)], params: { sport: 'bike' } })
    const copie = JSON.parse(exportAll())
    expect(copie.app).toBe('lacet')
    expect(copie.data.favorites).toHaveLength(1)
    expect(copie.data.params.sport).toBe('bike')
  })

  it('remet tout en place, sans effacer ce qui a été fait depuis', () => {
    save({ favorites: [], history: [sortie('2026-09-01T10:00:00.000Z', 10_000)], params: null })
    const copie = exportAll()
    save({ history: [sortie('2026-09-20T10:00:00.000Z', 5000)] })
    const { history } = importAll(copie)
    expect(history).toBe(2)
    // La plus récente d'abord, comme dans l'historique.
    expect(load().history[0].ranAt).toBe('2026-09-20T10:00:00.000Z')
  })

  it('garde les départs nommés enregistrés depuis la sauvegarde', () => {
    save({ places: [{ id: 'p1', name: 'Le club', lat: 47.9, lon: 7.2 }] })
    const copie = exportAll()
    save({ places: [{ id: 'p2', name: 'Chez moi', lat: 47.91, lon: 7.21, street: 'Rue des Tonneliers' }] })
    importAll(copie)
    expect(load().places.map((p) => p.name).sort()).toEqual(['Chez moi', 'Le club'])
  })

  it('ne reprend pas les cartes hors ligne d’un autre téléphone', () => {
    // Leurs fichiers sont restés sur l'appareil d'où vient la sauvegarde.
    save({ offlineMaps: { ailleurs: { bytes: 1, urls: ['https://tuiles/1.png'] } } })
    const copie = exportAll()
    save({ offlineMaps: { ici: { bytes: 2, urls: [] } } })
    importAll(copie)
    expect(Object.keys(load().offlineMaps)).toEqual(['ici'])
  })

  it('refuse un fichier qui n’en est pas une', () => {
    expect(() => importAll('{"app":"autre"}')).toThrow(/sauvegarde Lacet/)
    expect(() => importAll('pas du json')).toThrow(/sauvegarde Lacet/)
  })
})

/**
 * La copie sur fichier : iOS peut vider le stockage de la WebView quand le
 * téléphone manque de place, et l'historique des sorties partirait avec.
 */
describe('la copie sur fichier', () => {
  it('recopie les écritures, groupées', () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      mirrorTo(write)
      save({ params: { sport: 'run' } })
      save({ history: [{ name: 'Boucle du dimanche' }] })
      expect(write).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(write).toHaveBeenCalledTimes(1)
      const copie = JSON.parse(write.mock.calls[0][0])
      expect(copie.history[0].name).toBe('Boucle du dimanche')
      expect(copie.params.sport).toBe('run')
    } finally {
      mirrorTo(null)
      vi.useRealTimers()
    }
  })

  it('remet en place un magasin vidé par iOS', async () => {
    const copie = JSON.stringify({ history: [{ name: 'Boucle du dimanche' }] })
    expect(await restoreFrom(async () => copie)).toBe(true)
    expect(load().history[0].name).toBe('Boucle du dimanche')
  })

  it('ne remplace jamais un magasin présent', async () => {
    save({ history: [{ name: 'Plus récente' }] })
    const read = vi.fn(async () => JSON.stringify({ history: [] }))
    expect(await restoreFrom(read)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(load().history[0].name).toBe('Plus récente')
  })

  it('ne fait pas revenir par la copie ce qu’on a effacé', async () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      mirrorTo(write)
      save({ history: [{ name: 'Boucle du dimanche' }] })
      wipe()
      vi.advanceTimersByTime(1000)
      expect(JSON.parse(write.mock.calls.at(-1)[0]).history).toEqual([])
    } finally {
      mirrorTo(null)
      vi.useRealTimers()
    }
    // Une copie plus ancienne, si elle traînait encore, ne remplace pas un
    // magasin effacé : il est vide, pas absent.
    const ancienne = JSON.stringify({ history: [{ name: 'Boucle du dimanche' }] })
    expect(await restoreFrom(async () => ancienne)).toBe(false)
    expect(load().history).toEqual([])
  })

  it('ignore une copie absente ou abîmée', async () => {
    expect(await restoreFrom(async () => null)).toBe(false)
    expect(await restoreFrom(async () => '{tronqué')).toBe(false)
    expect(localStorage.getItem('lacet.v1')).toBeNull()
  })
})

