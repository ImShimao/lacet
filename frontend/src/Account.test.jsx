/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
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
})
