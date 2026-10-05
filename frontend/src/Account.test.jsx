/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Le sommaire de « Mon compte ».
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

  it('ne propose plus Strava', () => {
    render(<Ecran />)
    expect(screen.queryByText('Strava')).toBeNull()
  })
})
