/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Challenges from './Challenges'

/** La carte des séries et du défi : ce qu'elle dit, et qu'elle se tait sans sortie. */
const at = (d) => new Date(2026, 10, d, 18).toISOString()
const run = (d, km) => ({ ranAt: at(d), actual_distance_m: km * 1000, sport: 'run' })
const now = new Date(2026, 10, 24, 12)

afterEach(cleanup)

describe('Challenges', () => {
  it('dit la série à tenir et le palier suivant du mois', () => {
    render(<Challenges history={[run(17, 30), run(10, 34)]} now={now} />)
    expect(screen.getByText("semaines d'affilée")).toBeTruthy()
    expect(screen.getByText(/Une sortie avant dimanche la garde\./)).toBeTruthy()
    expect(screen.getByText('Défi de novembre')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64')
    expect(screen.getByText(/64 km en 2 sorties · palier 50 atteint · encore 36 km en 7 jours, soit 5,1 par jour\./)).toBeTruthy()
  })

  it('ne montre rien sans sortie', () => {
    const { container } = render(<Challenges history={[]} now={now} />)
    expect(container.innerHTML).toBe('')
  })
})
