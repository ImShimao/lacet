/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import useLibrary from './useLibrary'
import { load } from './storage'

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

  it('ne garde les traces que des vingt-cinq dernières sorties', () => {
    // C'est par elles que le stockage du navigateur se remplit.
    monter({ favorites: [], history: Array.from({ length: 30 }, (_, i) => sortie(i)), places: [] })
    act(() => api.remember(sortie(99)))
    const gardees = load().history
    expect(gardees[0].track).not.toBeNull()
    expect(gardees[24].track).not.toBeNull()
    expect(gardees[25].track).toBeNull()
  })

  it('borne les trois listes', () => {
    monter({
      favorites: Array.from({ length: 40 }, (_, i) => parcours(i)),
      history: Array.from({ length: 200 }, (_, i) => sortie(i)),
      places: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'Lieu ' + i })),
    })
    act(() => api.keepRoute(parcours(500)))
    act(() => api.remember(sortie(500)))
    act(() => api.keepPlace({ id: 'p500', name: 'Chez moi' }))
    expect(load().favorites).toHaveLength(40)
    expect(load().history).toHaveLength(200)
    expect(load().places).toHaveLength(8)
    // Et c'est bien le nouveau qui est en tête.
    expect(load().places[0].name).toBe('Chez moi')
  })

  it('remplace un parcours rouvert au lieu de le doubler', () => {
    monter({ favorites: [parcours(1)], history: [], places: [] })
    act(() => api.keepRoute({ ...parcours(1), name: 'Boucle 1 (corrigée)' }))
    expect(load().favorites).toHaveLength(1)
    expect(load().favorites[0].name).toBe('Boucle 1 (corrigée)')
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
})
