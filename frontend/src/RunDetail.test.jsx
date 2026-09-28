/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunDetail from './RunDetail.jsx'

/**
 * Ce qu'on lit d'une sortie passée.
 *
 * L'écran doit montrer **ce qui a été fait**, pas ce qui avait été prévu, et ne
 * rien inventer quand la mesure manque : une sortie sans altitude GPS n'a pas
 * de dénivelé, une sortie d'avant les temps au kilomètre n'en a pas.
 */

const sortie = (extra = {}) => ({
  id: 'x',
  name: 'Boucle des Vignes',
  ranAt: '2026-09-14T17:42:00.000Z',
  distance_m: 10_000,
  ascent_m: 120,
  grade: 'A',
  geometry: [[7.2, 47.9], [7.21, 47.9]],
  actual_distance_m: 10_180,
  actual_duration_s: 3122,
  actual_ascent_m: 137,
  paused_s: 96,
  track: [[7.2, 47.9], [7.21, 47.9]],
  splits: [
    { km: 1, seconds: 312 },
    { km: 2, seconds: 298 },
  ],
  sport: 'run',
  ...extra,
})

const rendre = (entry, props = {}) =>
  render(
    <RunDetail entry={entry} onReplay={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} {...props} />,
  )

describe('le détail d’une sortie', () => {
  afterEach(cleanup)

  it('montre ce qui a été couru, avant ce qui était prévu', () => {
    rendre(sortie())
    expect(screen.getByText('10,18')).toBeTruthy()
    expect(screen.getByText('52:02')).toBeTruthy()
    expect(screen.getByText('137 m')).toBeTruthy()
    // L'allure : 3122 s pour 10,18 km.
    expect(screen.getByText('5:07')).toBeTruthy()
    // Le prévu est là, mais comme repère — et l'écart est dit.
    expect(screen.getByText('10,0 km')).toBeTruthy()
    expect(screen.getByText(/180 m/)).toBeTruthy()
  })

  it('donne les temps au kilomètre, et repère le plus rapide', () => {
    rendre(sortie())
    expect(screen.getByText(/au plus vite 4:58/)).toBeTruthy()
    expect(screen.getByText(/au plus lent 5:12/)).toBeTruthy()
  })

  it('dit le temps passé à l’arrêt, qui explique l’allure', () => {
    rendre(sortie())
    expect(screen.getByText(/Chrono arrêté 1:36/)).toBeTruthy()
  })

  it('n’invente ni dénivelé ni tours quand ils manquent', () => {
    rendre(sortie({ actual_ascent_m: null, splits: null, track: null }))
    expect(screen.getByText(/pas donné l'altitude/)).toBeTruthy()
    expect(screen.queryByText(/au plus vite/)).toBeNull()
    expect(screen.getByText(/plus gardée/)).toBeTruthy()
    // Sans trace, rien à exporter.
    expect(screen.queryByText('Exporter la trace')).toBeNull()
  })

  it('ne compare pas une sortie libre à un plan qui n’existe pas', () => {
    rendre(sortie({ free: true, distance_m: 0, grade: null, geometry: [] }))
    expect(screen.queryByText('Prévu')).toBeNull()
    expect(screen.queryByText('Refaire ce parcours')).toBeNull()
  })

  it('demande confirmation avant de supprimer', () => {
    const onDelete = vi.fn()
    rendre(sortie(), { onDelete })
    act(() => screen.getByText('Supprimer cette sortie').click())
    expect(onDelete).not.toHaveBeenCalled()
    act(() => screen.getByText('Supprimer définitivement').click())
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
