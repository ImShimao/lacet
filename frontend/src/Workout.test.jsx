/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * La page « Séance fractionnée » : la séance dessinée en tête, et des séries
 * qu'on ajoute, règle et retire — gardées pour la sortie suivante.
 */

vi.mock('./platform', () => ({ isNative: () => false, haptic: vi.fn() }))

const WorkoutSetting = (await import('./Workout.jsx')).default
const { load } = await import('./storage')

const choisir = (ligne, choix, n = 0) => {
  fireEvent.click(screen.getAllByRole('button', { name: new RegExp('^' + ligne) })[n])
  fireEvent.click(screen.getByRole('option', { name: choix }))
}

describe('la séance fractionnée', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('dessine la séance et la règle en plusieurs séries', () => {
    localStorage.clear()
    render(<WorkoutSetting pace={300} />)
    fireEvent.click(screen.getByRole('switch', { name: /^Guider une séance/ }))
    // 8 × 400 m par défaut : l'aperçu donne la durée et les répétitions.
    expect(screen.getByLabelText('Aperçu de la séance').textContent).toMatch(/8 répétitions/)

    // On repart du classique pour le retoucher, puis on ajoute une série.
    fireEvent.click(screen.getByRole('button', { name: /^Modifier cette séance/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter une série/ }))
    expect(screen.getByLabelText('Série 2')).toBeTruthy()
    choisir('Répétitions', '3', 1)
    // « Effort » suivi de sa valeur : « Effort mesuré en » commence pareil.
    choisir('Effort\\s*\\d', '1 km', 1)
    choisir('Entre deux séries', '4 min')

    expect(load().workout).toMatchObject({
      on: true,
      preset: 'custom',
      custom: { set_rest_s: 240, series: [expect.objectContaining({ reps: 8, work_m: 400 }), expect.objectContaining({ reps: 3, work_m: 1000 })] },
    })
    expect(screen.getByLabelText('Aperçu de la séance').textContent).toMatch(/11 répétitions/)

    // Une série se retire ; la dernière, jamais.
    fireEvent.click(screen.getAllByRole('button', { name: /^Retirer cette série/ })[0])
    expect(load().workout.custom.series).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Retirer cette série/ })).toBeNull()
  })
})
