/** @vitest-environment jsdom */
/**
 * L'accueil de première ouverture : il attend la fin du lancement, se parcourt
 * en trois pages dans les deux sens, et ne revient plus une fois terminé. Le
 * stockage peut être refusé (navigation privée) : l'accueil reste utilisable.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Welcome from './Welcome.jsx'

const titre = () => screen.getByRole('heading').textContent
const ouvrir = () => {
  render(<Welcome />)
  act(() => vi.advanceTimersByTime(1900))
}

describe('Welcome', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("n'apparaît qu'après le lancement, puis se parcourt jusqu'au bout", () => {
    render(<Welcome />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => vi.advanceTimersByTime(1900))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem('lacet.accueil')).toBe('oui')
  })

  it('revient à la page précédente', () => {
    ouvrir()
    const premier = titre()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(titre()).toBe('Chaque boucle est notée')
    fireEvent.click(screen.getByRole('button', { name: /Retour/ }))
    expect(titre()).toBe(premier)
  })

  it('détaille les trois notes sur la page sécurité', () => {
    ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    const lignes = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(lignes.map((l) => l[0])).toEqual(['A', 'B', 'C'])
    expect(lignes[0]).toMatch(/Au plus 1 %/)
    expect(lignes[1]).toMatch(/Au plus 3 %/)
    expect(screen.getByText(/80 km\/h/)).toBeTruthy()
  })

  it('ne revient pas une fois vu', () => {
    localStorage.setItem('lacet.accueil', 'oui')
    render(<Welcome />)
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reste utilisable quand le stockage refuse', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    set.mockRestore()
  })
})
