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
    expect(screen.getByRole('button', { name: 'Exporter la trace en GPX' })).toBeTruthy()
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
    expect(screen.getByText(/n'ont donné l'altitude/)).toBeTruthy()
    expect(screen.queryByText(/au plus vite/)).toBeNull()
    expect(screen.getByText(/plus gardée/)).toBeTruthy()
    // Sans trace, rien à exporter.
    expect(screen.queryByRole('button', { name: 'Exporter la trace en GPX' })).toBeNull()
  })

  it('dit d’où vient le dénivelé mesuré', () => {
    // Au baromètre, il se compare au prévu ; au GPS, ce n'est qu'un ordre de
    // grandeur — et une sortie d'avant le baromètre n'a pas de source : GPS.
    rendre(sortie({ actual_ascent_m: 162, actual_ascent_source: 'baro', ascent_m: 158.4 }))
    expect(screen.getByText(/mesuré au baromètre du téléphone — 158 m étaient prévus/)).toBeTruthy()
    cleanup()
    rendre(sortie({ actual_ascent_m: 162, ascent_m: 158.4 }))
    expect(screen.getByText(/altitude du GPS/)).toBeTruthy()
  })

  it('garde ce que la voix a dit, pour vérifier une sortie écran verrouillé', () => {
    const spoken = [
      { t: Date.parse('2026-09-14T17:42:03Z'), lon: 7.2, lat: 47.9, m: 0, text: 'Départ — pars vers le nord.' },
      { t: Date.parse('2026-09-14T17:43:41Z'), lon: 7.201, lat: 47.9, m: 312, text: 'Maintenant, tourne à gauche.' },
    ]
    rendre(sortie({ spoken }))
    expect(screen.getByText('Ce que la voix a dit · 2 phrases')).toBeTruthy()
    expect(screen.getByText('Maintenant, tourne à gauche.')).toBeTruthy()
    expect(screen.getByText('0,31 km')).toBeTruthy()
    cleanup()
    // Une sortie sans voix, ou d'avant le journal : rien.
    rendre(sortie())
    expect(screen.queryByText(/Ce que la voix a dit/)).toBeNull()
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
