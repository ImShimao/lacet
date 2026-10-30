/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import useLibrary from './useLibrary'
import { exportAll, importAll, load, save } from './storage'

/**
 * Les listes qu'on garde, et les plafonds qui les bornent.
 *
 * Ces règles étaient dispersées dans `App.jsx` : chaque endroit qui touchait
 * une liste réécrivait la même paire de lignes, et rien ne les vérifiait.
 * Elles sont désormais à un seul endroit — donc éprouvables.
 */

let api = null
function Sonde({ stored }) {
  api = useLibrary(stored)
  return null
}
const monter = (stored = { favorites: [], history: [], places: [] }) => render(<Sonde stored={stored} />)
const parcours = (i) => ({ id: 'r' + i, name: 'Boucle ' + i, distance_m: 10_000 + i, geometry: [[7.2, 47.9]] })
const sortie = (i) => ({ id: 'h' + i, name: 'Sortie ' + i, ranAt: '2026-09-0' + (i % 9), track: [[7.2, 47.9]] })

describe('ce que l’app garde', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('écrit sur le disque à chaque fois, sans qu’on ait à y penser', () => {
    monter()
    act(() => api.toggleFavorite(parcours(1)))
    expect(load().favorites).toHaveLength(1)
    act(() => api.toggleFavorite(parcours(1)))
    expect(load().favorites).toHaveLength(0)
  })

  it('reconnaît un favori par son emprise, pas par son identifiant', () => {
    // Le même parcours recalculé porte un autre identifiant : le cœur doit
    // rester plein.
    monter()
    act(() => api.toggleFavorite(parcours(1)))
    expect(api.isFavorite({ ...parcours(1), id: 'autre' })).toBe(true)
    expect(api.isFavorite(parcours(2))).toBe(false)
    expect(api.isFavorite(null)).toBe(false)
  })

  it('réduit à leur résumé les sorties d’avant les vingt-cinq dernières', () => {
    // La trace, la voix et le parcours prévu : 63 Ko sur 64 d'une sortie, et
    // c'est par eux que le stockage du navigateur se remplit.
    const entiere = (i) => ({ ...sortie(i), ...parcours(i), ranAt: sortie(i).ranAt, spoken: [{ text: 'Tourne à gauche' }], actual_distance_m: 10_000 })
    monter({ favorites: [], history: Array.from({ length: 30 }, (_, i) => entiere(i)), places: [] })
    act(() => api.remember(entiere(99)))
    const gardees = load().history
    expect(gardees).toHaveLength(31)
    expect(gardees[24].track).toBeTruthy()
    expect(gardees[24].geometry).toBeTruthy()
    expect(gardees[25]).toEqual({ id: 'r24', name: 'Boucle 24', ranAt: gardees[25].ranAt, distance_m: 10_024, actual_distance_m: 10_000 })
  })

  it('garde mille sorties, et dit laquelle laisse sa place au-delà', () => {
    // Deux cents effaçaient en un an, à quatre sorties par semaine, les
    // totaux mensuels de l'année d'avant — et sans un mot.
    const vieilles = Array.from({ length: 1000 }, (_, i) => ({ id: 'h' + i, name: 'S', ranAt: new Date(Date.UTC(2026, 9, 1) - i * 864e5 * 2).toISOString() }))
    monter({ favorites: [], history: vieilles, places: [] })
    expect(api.notice).toBeNull()
    act(() => api.remember(sortie(1000)))
    expect(load().history).toHaveLength(1000)
    expect(load().history[0].id).toBe('h1000')
    expect(load().history.at(-1).id).toBe('h998')
    expect(api.notice.list).toBe('history')
    expect(api.notice.text).toMatch(/celle du \d+ \S+ 2021, la plus ancienne, a laissé sa place/)
    act(() => api.dismiss())
    expect(api.notice).toBeNull()
  })

  it('refuse le quarante et unième favori au lieu d’effacer le plus ancien', () => {
    // Le plus ancien est souvent le premier gardé : celui qu'on refait le plus.
    monter({ favorites: Array.from({ length: 40 }, (_, i) => parcours(i)), history: [], places: [] })
    act(() => api.toggleFavorite(parcours(500)))
    expect(api.saved).toHaveLength(40)
    expect(api.saved.at(-1).id).toBe('r39')
    expect(api.isFavorite(parcours(500))).toBe(false)
    expect(api.notice.list).toBe('favorites')
    expect(api.notice.text).toMatch(/« Boucle 500 » n'est pas gardé/)
    // Un import refusé de même ; remplacer un favori déjà là, non.
    act(() => api.keepRoute(parcours(501)))
    expect(api.saved).toHaveLength(40)
    act(() => api.keepRoute({ ...parcours(3), name: 'Boucle 3 (corrigée)' }))
    expect(api.saved[0].name).toBe('Boucle 3 (corrigée)')
    expect(api.notice).toBeNull()
    // Une place faite, il passe.
    act(() => api.forget(parcours(0)))
    act(() => api.toggleFavorite(parcours(500)))
    expect(api.isFavorite(parcours(500))).toBe(true)
  })

  it('refuse le neuvième départ nommé au lieu d’oublier « Chez moi »', () => {
    const lieux = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: i === 7 ? 'Chez moi' : 'Lieu ' + i }))
    monter({ favorites: [], history: [], places: lieux })
    act(() => api.keepPlace({ id: 'p500', name: 'Le club' }))
    expect(api.places.map((p) => p.name)).toContain('Chez moi')
    expect(api.places).toHaveLength(8)
    expect(api.notice.list).toBe('places')
    expect(api.notice.text).toMatch(/« Le club » n'est pas gardé/)
    act(() => api.dropPlace('p0'))
    act(() => api.keepPlace({ id: 'p500', name: 'Le club' }))
    expect(api.places[0].name).toBe('Le club')
  })

  it('remplace un parcours rouvert au lieu de le doubler', () => {
    monter({ favorites: [parcours(1)], history: [], places: [] })
    act(() => api.keepRoute({ ...parcours(1), name: 'Boucle 1 (corrigée)' }))
    expect(load().favorites).toHaveLength(1)
    expect(load().favorites[0].name).toBe('Boucle 1 (corrigée)')
  })

  it('renomme une sortie, et la reconnaît encore après', () => {
    // Le piège : renommer crée une copie, et l'écran qui l'affiche garde la
    // copie. Supprimer juste après ne trouvait plus rien à supprimer.
    const une = sortie(1)
    monter({ favorites: [], history: [une, sortie(2)], places: [] })
    act(() => api.rename(une, '  Course du club  '))
    expect(load().history[0].name).toBe('Course du club')
    const copie = { ...une, name: 'Course du club' }
    act(() => api.forget(copie))
    expect(load().history).toHaveLength(1)
    expect(load().history[0].id).toBe('h2')
  })

  it('renomme un favori sans le détacher de sa carte ni de son cœur', () => {
    // La clé d'une carte hors ligne est faite du nom : renommé, le favori
    // perdait sa carte, et la même boucle retrouvée par une recherche n'avait
    // plus le cœur plein.
    monter({ favorites: [parcours(1), parcours(2)], history: [], places: [] })
    act(() => api.rename(parcours(1), 'Tour du Bollenberg'))
    expect(load().favorites.map((r) => r.name)).toEqual(['Tour du Bollenberg', 'Boucle 2'])
    expect(api.isFavorite(parcours(1))).toBe(true)
    // Et le renommé se retire encore, sous son nouveau nom.
    act(() => api.forget(load().favorites[0]))
    expect(load().favorites.map((r) => r.id)).toEqual(['r2'])
  })

  it('renomme une sortie sans toucher au favori du même parcours', () => {
    // Une sortie faite sur un favori en partage la clé : seule l'heure de
    // départ dit lequel des deux on renomme.
    const une = { ...parcours(1), ranAt: '2026-09-01T08:00:00Z' }
    monter({ favorites: [parcours(1)], history: [une], places: [] })
    act(() => api.rename(une, 'Course du club'))
    expect(load().history[0].name).toBe('Course du club')
    expect(api.saved[0].name).toBe('Boucle 1')
  })

  it('refuse un nom vide et borne sa longueur', () => {
    const une = sortie(1)
    monter({ favorites: [], history: [une], places: [] })
    act(() => api.rename(une, '   '))
    expect(load().history).toHaveLength(0) // rien n'a été écrit
    act(() => api.rename(une, 'x'.repeat(200)))
    expect(load().history[0].name).toHaveLength(60)
  })

  it('oublie une sortie, et sait tout effacer', () => {
    const une = sortie(1)
    monter({ favorites: [parcours(1)], history: [une, sortie(2)], places: [] })
    act(() => api.forget(une))
    expect(load().history).toHaveLength(1)
    act(() => api.clear())
    expect(load().history).toHaveLength(0)
    expect(load().favorites).toHaveLength(0)
  })

  it('efface aussi ce qui dit où l’on habite, et qui prévenir', () => {
    // « Chez moi », les adresses cherchées et le contact d'urgence restaient
    // après « Tout effacer », qui annonçait pourtant l'app comme neuve.
    const chezMoi = { id: 'p1', name: 'Chez moi', lat: 47.9, lon: 7.2 }
    save({
      places: [chezMoi],
      recentPlaces: [{ label: '3 rue des Vignes', lat: 47.9, lon: 7.2 }],
      reports: [{ id: 'x', lat: 47.9, lon: 7.2, kind: 'closed' }],
      emergencyContact: '0612345678',
      params: { sport: 'bike' },
    })
    monter(load())
    expect(api.places).toHaveLength(1)
    act(() => api.clear())
    expect(api.places).toHaveLength(0)
    const disque = load()
    expect(disque.places ?? []).toHaveLength(0)
    expect(disque.recentPlaces).toHaveLength(0)
    expect(disque.reports).toHaveLength(0)
    expect(disque.emergencyContact).toBeUndefined()
    expect(disque.params).toBeNull()
  })

  it('ne réécrit pas ses vieilles listes par-dessus une sauvegarde restaurée', () => {
    // Une sauvegarde qui contient un favori, restaurée pendant que l'écran
    // tient une liste vide : sans relecture, le favori suivant effaçait le
    // restauré en réécrivant la liste d'avant.
    save({ favorites: [parcours(1)], history: [], places: [] })
    const copie = exportAll()
    save({ favorites: [] })
    monter()
    importAll(copie)
    act(() => api.reload())
    act(() => api.toggleFavorite(parcours(2)))
    expect(load().favorites.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
  })
})
