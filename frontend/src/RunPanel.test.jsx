/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RunStats } from './RunPanel.jsx'
import { setUnits } from './units'

/**
 * Les chiffres de course, lus en courant : un mot sous chaque chiffre, l'unité
 * collée à lui — et la bonne unité, kilomètres ou miles.
 */
afterEach(() => {
  cleanup()
  setUnits('km')
})

const stats = (props = {}) =>
  render(
    <RunStats bike={false} state={{ distance: 2500, elapsed: 900 }} moving={360} left={null} remaining={1500} paused={null} laps={1} lap={1} {...props} />,
  )

describe('les chiffres de course', () => {
  it('disent distance, allure et restant, l’unité à côté du chiffre', () => {
    const { container } = stats()
    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Allure')).toBeInTheDocument()
    expect(screen.getByText('Restant')).toBeInTheDocument()
    const values = [...container.querySelectorAll('.stats--live b')].map((b) => b.textContent)
    expect(values).toEqual(['2,50km', '6:00/km', '1,5km'])
  })

  it('passent en miles, allure comprise', () => {
    setUnits('mi')
    const { container } = stats()
    const values = [...container.querySelectorAll('.stats--live b')].map((b) => b.textContent)
    expect(values[0]).toMatch(/mi$/)
    expect(values[1]).toMatch(/\/mi$/)
  })

  it('en course libre, montrent la vitesse à la place du restant', () => {
    stats({ remaining: null })
    expect(screen.getByText('Vitesse')).toBeInTheDocument()
    expect(screen.queryByText('Restant')).not.toBeInTheDocument()
  })

  it('disent la pause, et le tour en cours sur un parcours à tours', () => {
    stats({ paused: 'auto', laps: 3, lap: 2 })
    expect(screen.getByText('Pause automatique')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.className === 'lapcount' && el.textContent === 'Tour 2 sur 3')).toBeInTheDocument()
  })
})
