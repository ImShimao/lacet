/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunSummary from './RunSummary.jsx'

/**
 * L'écran de fin : ce qu'on lit en arrivant, essoufflé. Les temps au kilomètre
 * et la comparaison avec les passages d'avant n'y étaient pas — il fallait
 * rouvrir la sortie depuis l'historique pour savoir si l'on avait battu
 * dimanche dernier.
 */

// Deux kilomètres en ligne droite, un point tous les vingt mètres.
const trace = Array.from({ length: 101 }, (_, i) => [7.2 + (i * 20) / 74_600, 47.9])

const sortie = (extra = {}) => ({
  id: 'x',
  name: 'Boucle des Vignes',
  ranAt: '2026-10-05T17:42:00.000Z',
  distance_m: 2000,
  geometry: trace,
  track: trace,
  actual_distance_m: 2010,
  actual_duration_s: 600,
  actual_ascent_m: 12,
  paused_s: 45,
  splits: [
    { km: 1, seconds: 305 },
    { km: 2, seconds: 290 },
  ],
  sport: 'run',
  ...extra,
})

describe('l’écran de fin', () => {
  afterEach(cleanup)

  it('écrit la distance à la française', () => {
    render(<RunSummary entry={sortie()} onClose={vi.fn()} />)
    expect(screen.getByText('2,01')).toBeTruthy()
  })

  it('donne les temps au kilomètre et le temps passé à l’arrêt', () => {
    render(<RunSummary entry={sortie()} onClose={vi.fn()} />)
    expect(screen.getByText(/au plus vite 4:50/)).toBeTruthy()
    expect(screen.getByText(/Chrono arrêté 0:45/)).toBeTruthy()
  })

  it('dit quand on vient de battre son meilleur passage sur ce chemin', () => {
    const avant = sortie({ ranAt: '2026-09-28T08:00:00.000Z', actual_duration_s: 660 })
    const maintenant = sortie()
    render(<RunSummary entry={maintenant} history={[maintenant, avant]} onClose={vi.fn()} />)
    expect(screen.getByText('Ton meilleur passage')).toBeTruthy()
  })

  it('se tait la première fois', () => {
    const maintenant = sortie()
    render(<RunSummary entry={maintenant} history={[maintenant]} onClose={vi.fn()} />)
    expect(screen.queryByText(/passage/)).toBeNull()
  })
})
