/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Le sommaire de « Mon compte », et le retour depuis une de ses pages.
 *
 * Descendu jusqu'à « À propos », on ouvrait la page, on revenait… tout en haut
 * du sommaire, et il fallait redescendre. Une page s'ouvre en haut ; le
 * sommaire, lui, se retrouve là où on l'avait laissé.
 */

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn() }))

const Account = (await import('./Account.jsx')).default
const { DEFAULTS } = await import('./FiltersSheet.jsx')
const { voiceSettings } = await import('./voice')

/** L'écran de l'app, réduit à ce qui compte ici : le corps qui défile, et le retour de l'en-tête. */
function Ecran() {
  const [page, setPage] = useState(null)
  return (
    <div className="side__body" data-testid="corps">
      <button onClick={() => setPage(null)}>Retour au sommaire</button>
      <Account
        page={page}
        onPage={setPage}
        params={DEFAULTS}
        geo={{ status: 'idle' }}
        history={[]}
        poiPrefs={{}}
        onPoiPrefs={() => {}}
        onProfile={() => {}}
        onClearData={async () => {}}
        onRestored={() => {}}
      />
    </div>
  )
}

describe('Mon compte', () => {
  afterEach(() => cleanup())

  it('retrouve le sommaire là où on l’avait laissé', async () => {
    render(<Ecran />)
    const corps = screen.getByTestId('corps')
    // jsdom ne fait pas défiler : le défilement est simulé par une valeur.
    Object.defineProperty(corps, 'scrollTop', { value: 0, writable: true, configurable: true })
    corps.scrollTop = 640

    await act(async () => {
      screen.getByText('À propos').closest('button').click()
    })
    // La page s'ouvre en haut…
    expect(corps.scrollTop).toBe(0)
    expect(screen.getByText('Sources')).toBeTruthy()

    await act(async () => {
      screen.getByText('Retour au sommaire').click()
    })
    // … et le sommaire revient où l'on était.
    expect(corps.scrollTop).toBe(640)
    expect(screen.getByText('Paramètres')).toBeTruthy()
  })

  it('ne propose plus Strava', () => {
    render(<Ecran />)
    expect(screen.queryByText('Strava')).toBeNull()
  })

  it('arrête de compter quand on lâche, même posé à deux doigts', async () => {
    vi.useFakeTimers()
    try {
      const onProfile = vi.fn()
      render(
        <Account
          page="profile"
          params={DEFAULTS}
          geo={{ status: 'idle' }}
          history={[]}
          poiPrefs={{}}
          onPoiPrefs={() => {}}
          onProfile={onProfile}
          onClearData={async () => {}}
          onRestored={() => {}}
        />,
      )
      const plus = screen.getByRole('button', { name: 'Augmenter poids' })
      fireEvent.pointerDown(plus)
      fireEvent.pointerDown(plus)
      fireEvent.pointerUp(plus)
      const auLacher = onProfile.mock.calls.length
      await act(async () => vi.advanceTimersByTime(3000))
      expect(onProfile.mock.calls.length).toBe(auLacher)
    } finally {
      vi.useRealTimers()
    }
  })

  it('garde les réglages de la voix pour la sortie suivante', () => {
    localStorage.clear()
    const page = () =>
      render(
        <Account
          page="run"
          params={DEFAULTS}
          geo={{ status: 'idle' }}
          history={[]}
          poiPrefs={{}}
          onPoiPrefs={() => {}}
          onProfile={() => {}}
          onClearData={async () => {}}
          onRestored={() => {}}
        />,
      )
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Tous les 2 km' }))
    fireEvent.click(screen.getByRole('button', { name: 'Temps du km' }))
    fireEvent.click(screen.getByRole('button', { name: 'Temps couru' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plus tôt' }))
    expect(voiceSettings()).toEqual({ km: 2, lap: false, pace: true, total: true, lead: 'early' })

    // Rouverte, la page montre ce qui a été gardé.
    cleanup()
    page()
    expect(screen.getByRole('button', { name: 'Tous les 2 km' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Temps du km' }).getAttribute('aria-pressed')).toBe('false')

    // Kilomètres tus : ce qu'ils diraient n'a plus à se régler.
    fireEvent.click(screen.getByRole('button', { name: 'Jamais' }))
    expect(screen.queryByRole('button', { name: 'Allure' })).toBeNull()
    expect(voiceSettings().km).toBe(0)
    localStorage.clear()
  })
})
