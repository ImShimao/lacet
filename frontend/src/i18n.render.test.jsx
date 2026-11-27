/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

/**
 * Des écrans rendus en anglais, et la bascule à chaud : changer la langue dans
 * « Mon compte › Apparence » redessine l'écran, sans le recharger ni le
 * remonter — le réglage touché est celui qui garde son menu ouvert, et la voix
 * (`voice.test.js`) lit la même langue.
 */

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn() }))

const Account = (await import('./Account.jsx')).default
const Countdown = (await import('./Countdown.jsx')).default
const { DEFAULTS } = await import('./FiltersSheet.jsx')
const { lang, setLang } = await import('./i18n')
const { wipe, load } = await import('./storage')

const account = (page) => (
  <Account
    page={page}
    onPage={() => {}}
    params={DEFAULTS}
    geo={{ status: 'idle' }}
    history={[]}
    poiPrefs={{}}
    onPoiPrefs={() => {}}
    onProfile={() => {}}
    onClearData={async () => {}}
    onRestored={() => {}}
  />
)

describe('l’app en anglais', () => {
  afterEach(() => {
    cleanup()
    wipe()
    setLang('fr')
  })

  it('bascule la page Apparence du français à l’anglais, et la langue est gardée', () => {
    render(account('appearance'))
    expect(screen.getByText('Affichage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Langue/ })).toHaveTextContent('Français')

    fireEvent.click(screen.getByRole('button', { name: /^Langue/ }))
    fireEvent.click(screen.getByRole('option', { name: 'English' }))

    expect(lang()).toBe('en')
    expect(load().language).toBe('en')
    expect(screen.getByText('Display')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Language/ })).toHaveTextContent('English')
    expect(screen.getByRole('button', { name: /^Theme/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Text size/ })).toHaveTextContent('Normal')
    expect(screen.queryByText('Affichage')).toBeNull()

    // Et retour : la langue se change aussi depuis l'anglais.
    fireEvent.click(screen.getByRole('button', { name: /^Language/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Français' }))
    expect(screen.getByText('Affichage')).toBeInTheDocument()
  })

  it('montre le sommaire de Mon compte en anglais', () => {
    setLang('en')
    render(account(null))
    for (const title of ['Guidance and voice', 'Safety', 'Appearance']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    // La sauvegarde et « À propos » vivent sous l'onglet « Data ».
    fireEvent.click(screen.getByRole('tab', { name: 'Data' }))
    for (const title of ['Backup', 'About']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.queryByText('Guidage et voix')).toBeNull()
    expect(screen.getByText('No account. Favorites, runs and settings never leave this device.')).toBeInTheDocument()
  })

  it('montre le compte à rebours en anglais', () => {
    setLang('en')
    render(<Countdown onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
