/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Library, { timeTotal } from './Library.jsx'
import { keyOf } from './offlineMaps'
import { load, save } from './storage'
import useLibrary from './useLibrary'

/** Le temps cumulé de « Mes parcours », dit dans l'unité qui convient. */
describe('timeTotal', () => {
  it('compte en minutes sous l’heure, plutôt que « 0 heures »', () => {
    expect(timeTotal(57 * 60)).toEqual([57, 'minutes'])
    expect(timeTotal(60)).toEqual([1, 'minute'])
  })

  it('accorde les heures', () => {
    expect(timeTotal(65 * 60)).toEqual([1, 'heure'])
    expect(timeTotal(5 * 3600)).toEqual([5, 'heures'])
  })
})

/**
 * Renommer et retirer depuis la liste, d'un glissé.
 *
 * Un favori gardait à vie son nom automatique, et le retirer demandait de
 * l'ouvrir sur la carte pour décocher son cœur. Le glissé lui-même est le
 * défilement natif de la ligne (voir `Item`) : jsdom ne défile pas, mais les
 * deux boutons qu'il découvre sont là, et c'est eux qu'on touche.
 */

/** La liste branchée sur les vraies listes gardées, comme dans `App.jsx`. */
function Ecran({ stored }) {
  const lib = useLibrary(stored)
  return (
    <Library
      saved={lib.saved}
      history={lib.history}
      onRename={lib.rename}
      onForget={lib.forget}
      onOpen={() => {}}
      onOpenRun={() => {}}
    />
  )
}

const favori = { id: 'r1', name: 'Boucle est · Orschwihrerweg', distance_m: 10383, ascent_m: 81, grade: 'A', geometry: [[7.21, 47.91], [7.22, 47.92]] }
const sortie = { ...favori, ranAt: '2026-10-28T17:30:00.000Z', actual_distance_m: 10420, actual_duration_s: 3900, sport: 'run' }
const carte = { urls: [], bytes: 1258291, maxZoom: 14, at: '2026-10-28T17:00:00.000Z', styleKey: 'dark', styleLabel: 'Sombre' }

describe('glisser une ligne de « Mes parcours »', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('renomme un favori, qui garde sa carte et son cœur', () => {
    render(<Ecran stored={{ favorites: [favori], history: [], places: [] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Renommer' }))
    const champ = screen.getByRole('textbox', { name: 'Nom du favori' })
    expect(document.activeElement).toBe(champ)
    fireEvent.change(champ, { target: { value: '  Tour du Bollenberg ' } })
    fireEvent.keyDown(champ, { key: 'Enter' })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Tour du Bollenberg')).toBeTruthy()
    const garde = load().favorites[0]
    expect(garde.name).toBe('Tour du Bollenberg')
    // La clé d'avant : celle de la carte hors ligne, et celle de la même
    // boucle quand une recherche la retrouve.
    expect(keyOf(garde)).toBe(keyOf(favori))
  })

  it('renonce au nouveau nom sur Échap', () => {
    // Échap enregistrait quand même : le champ, quitté aussitôt, gardait
    // l'état d'avant l'annulation.
    render(<Ecran stored={{ favorites: [favori], history: [], places: [] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Renommer' }))
    const champ = screen.getByRole('textbox', { name: 'Nom du favori' })
    fireEvent.change(champ, { target: { value: 'Faute de frappe' } })
    fireEvent.keyDown(champ, { key: 'Escape' })

    expect(screen.getByText(favori.name)).toBeTruthy()
    expect(load().favorites).toHaveLength(0) // rien n'a été écrit
  })

  it('retire un favori après confirmation, et sa carte hors ligne avec', async () => {
    save({ favorites: [favori], offlineMaps: { [keyOf(favori)]: carte } })
    render(<Ecran stored={load()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    const question = screen.getByRole('group', { name: 'Retirer le favori' })
    expect(question.textContent).toMatch(/Sa carte hors ligne \(1[.,]2 Mo\) part avec/)
    // Annuler rend la ligne telle quelle.
    fireEvent.click(within(question).getByRole('button', { name: 'Annuler' }))
    expect(load().favorites).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Retirer' }))
    expect(load().favorites).toHaveLength(0)
    expect(screen.getByText(/Aucun parcours en favori/)).toBeTruthy()
    await waitFor(() => expect(load().offlineMaps).toEqual({}))
  })

  it('laisse la carte qu’une sortie du même parcours montre encore, et le dit', async () => {
    save({ favorites: [favori], history: [sortie], offlineMaps: { [keyOf(favori)]: carte } })
    render(<Ecran stored={load()} />)
    fireEvent.click(screen.getByRole('button', { name: /Favoris/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    const question = screen.getByRole('group', { name: 'Retirer le favori' })
    expect(question.textContent).toMatch(/Sa carte hors ligne reste/)
    fireEvent.click(within(question).getByRole('button', { name: 'Retirer' }))

    expect(load().favorites).toHaveLength(0)
    expect(load().history).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(load().offlineMaps)).toEqual([keyOf(favori)])
  })

  it('supprime une sortie du même geste', () => {
    render(<Ecran stored={{ favorites: [], history: [sortie, { ...sortie, ranAt: '2026-10-21T17:30:00.000Z' }], places: [] }} />)
    const lignes = screen.getAllByRole('button', { name: 'Supprimer' })
    expect(lignes).toHaveLength(2)

    fireEvent.click(lignes[0])
    const question = screen.getByRole('group', { name: 'Supprimer la sortie' })
    expect(question.textContent).toMatch(/Ses kilomètres quittent les totaux/)
    fireEvent.click(within(question).getByRole('button', { name: 'Supprimer' }))

    expect(load().history.map((s) => s.ranAt)).toEqual(['2026-10-21T17:30:00.000Z'])
    // La confirmation est partie avec sa ligne, pas passée à la suivante.
    expect(screen.queryByRole('group')).toBeNull()
  })
})
