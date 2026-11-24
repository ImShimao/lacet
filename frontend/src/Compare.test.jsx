/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Compare from './Compare'

/**
 * La comparaison : la proposition affichée contre une autre au choix, la
 * meilleure valeur en avant, et « Voir la N » qui affiche l'autre.
 */
const route = (id, grade, duration_s) => ({
  id,
  distance_m: 10000,
  duration_s,
  ascent_m: 40,
  safety: { grade, protected_share: 0.8, unprotected_crossings: 2 },
})
const routes = [route('r1', 'A', 3900), route('r2', 'B', 3700), route('r3', 'C', 3600)]

afterEach(cleanup)

describe('Compare', () => {
  it('met la meilleure note en avant et dit le verdict', () => {
    render(<Compare routes={routes} selected={routes[0]} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText('La 1 contre la 2')).toBeTruthy()
    expect(screen.getByText('A').className).toBe('compare__best')
    expect(screen.getByText(/La 1 est plus sûre \(A contre B\) ; la 2 gagne 3 min\./)).toBeTruthy()
  })

  it("change d'adversaire, et affiche l'autre proposition", () => {
    const onSelect = vi.fn()
    render(<Compare routes={routes} selected={routes[0]} onSelect={onSelect} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByText('La 1 contre la 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Voir la 3' }))
    expect(onSelect).toHaveBeenCalledWith(routes[2])
  })
})
