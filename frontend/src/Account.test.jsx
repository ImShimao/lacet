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

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn(), haptic: vi.fn() }))

const Account = (await import('./Account.jsx')).default
const { DEFAULTS } = await import('./FiltersSheet.jsx')
const { voiceSettings } = await import('./voice')
const { load } = await import('./storage')

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

/** Une ligne de réglage ouvre son menu ; on y touche le choix. */
function choisir(ligne, choix) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + ligne) }))
  fireEvent.click(screen.getByRole('option', { name: choix }))
}
const interrupteur = (nom) => screen.getByRole('switch', { name: new RegExp('^' + nom) })

describe('Mon compte', () => {
  afterEach(() => cleanup())

  it('retrouve le sommaire là où on l’avait laissé', async () => {
    render(<Ecran />)
    const corps = screen.getByTestId('corps')
    // jsdom ne fait pas défiler : le défilement est simulé par une valeur.
    Object.defineProperty(corps, 'scrollTop', { value: 0, writable: true, configurable: true })
    corps.scrollTop = 640

    // « À propos » est sous l'onglet « Données ».
    fireEvent.click(screen.getByRole('tab', { name: 'Données' }))
    await act(async () => {
      screen.getByText('À propos').closest('button').click()
    })
    // La page s'ouvre en haut…
    expect(corps.scrollTop).toBe(0)
    expect(screen.getByText('Sources')).toBeTruthy()
    // La note n'est jamais présentée comme une garantie.
    expect(screen.getByText(/estimation, pas une garantie/)).toBeTruthy()

    await act(async () => {
      screen.getByText('Retour au sommaire').click()
    })
    // … et le sommaire revient où l'on était.
    expect(corps.scrollTop).toBe(640)
    // … sur l'onglet qu'on avait quitté.
    expect(screen.getByRole('tab', { name: 'Données' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Paramètres' }))
  })

  it('range le sommaire en trois onglets, le profil réglable sur place', () => {
    const onProfile = vi.fn()
    render(<Account page={null} onPage={() => {}} params={DEFAULTS} poiPrefs={{}} onProfile={onProfile} />)
    expect(screen.getByRole('button', { name: /^Parcours/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Stockage/ })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Profil' }))
    expect(screen.queryByRole('button', { name: /^Parcours/ })).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: /Augmenter poids/i }))
    fireEvent.pointerUp(screen.getByRole('button', { name: /Augmenter poids/i }))
    expect(onProfile).toHaveBeenCalledWith({ weight_kg: (DEFAULTS.weight_kg || 70) + 1 })

    fireEvent.click(screen.getByRole('tab', { name: 'Données' }))
    expect(screen.getByRole('button', { name: /^Stockage/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Paramètres' }))
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
    choisir('Kilomètres', 'Tous les 2 km')
    fireEvent.click(interrupteur('Temps du km'))
    fireEvent.click(interrupteur('Temps couru'))
    choisir('Anticipation des instructions', /^Tôt/)
    choisir('Débit', 'Rapide')
    expect(voiceSettings()).toMatchObject({ km: 2, lap: false, pace: true, total: true, target: true, lead: 'early', rate: 'fast' })

    // L'écart à l'allure visée se coupe à part, sans toucher aux kilomètres.
    fireEvent.click(interrupteur("Écart à l'allure"))
    expect(voiceSettings()).toMatchObject({ km: 2, target: false })

    // Rouverte, la page montre ce qui a été gardé.
    cleanup()
    page()
    expect(screen.getByRole('button', { name: /^Kilomètres/ }).textContent).toContain('Tous les 2 km')
    expect(interrupteur('Temps du km').getAttribute('aria-checked')).toBe('false')

    // Kilomètres tus : ce qu'ils diraient n'a plus à se régler.
    choisir('Kilomètres', 'Jamais')
    expect(screen.queryByRole('switch', { name: /^Allure/ })).toBeNull()
    expect(voiceSettings().km).toBe(0)
    localStorage.clear()
  })

  it('coupe le recalcul et l’arrêt automatiques', () => {
    localStorage.clear()
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
    expect(interrupteur('Recalcul automatique').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(interrupteur('Recalcul automatique'))
    fireEvent.click(interrupteur("Arrêt automatique à l'arrivée"))
    expect(load()).toMatchObject({ autoReroute: false, autoFinish: false })
    localStorage.clear()
  })

  it('masque un filtre en le remettant à sa valeur par défaut', () => {
    const onProfile = vi.fn()
    const page = (params) =>
      render(
        <Account
          page="search"
          params={params}
          geo={{ status: 'idle' }}
          history={[]}
          poiPrefs={{}}
          onPoiPrefs={() => {}}
          onProfile={onProfile}
          onClearData={async () => {}}
          onRestored={() => {}}
        />,
      )
    page({ ...DEFAULTS, surface: 'trail', carfree: false })
    // La longueur ne se décoche pas : sans elle, pas de recherche.
    expect(screen.getByText(/La longueur et l'allure y restent toujours/)).toBeTruthy()

    // Un « Sentier » masqué ne doit pas continuer d'agir sans qu'on le voie.
    fireEvent.click(screen.getByRole('switch', { name: /^Terrain/ }))
    expect(onProfile).toHaveBeenLastCalledWith({ hiddenFilters: ['terrain'], surface: 'mixed', carfree: true })

    // Masqué, la case dit la valeur qui s'applique ; recochée, elle réapparaît.
    cleanup()
    page({ ...DEFAULTS, hiddenFilters: ['terrain'] })
    const terrain = screen.getByRole('switch', { name: /^Terrain/ })
    expect(terrain.getAttribute('aria-checked')).toBe('false')
    expect(terrain.textContent).toContain('Masqué. Mixte')
    fireEvent.click(terrain)
    expect(onProfile).toHaveBeenLastCalledWith({ hiddenFilters: [] })
  })

  it('laisse l’écran se mettre en veille si on le demande', () => {
    localStorage.clear()
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
    expect(interrupteur('Écran toujours allumé').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(interrupteur('Écran toujours allumé'))
    expect(load().keepScreenOn).toBe(false)
    localStorage.clear()
  })

  it('règle le côté de la route, à gauche par défaut, et dit pourquoi', async () => {
    const onProfile = vi.fn()
    render(
      <Account
        page="search"
        onPage={() => {}}
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
    // Une ligne qui dit déjà le choix : « Côté de la route · Gauche », et pourquoi.
    const ligne = screen.getByRole('button', { name: /^Côté de la route/ })
    expect(ligne.textContent).toContain('Gauche')
    fireEvent.click(ligne)
    expect(screen.getByText(/R412-36/)).toBeTruthy()
    expect(screen.getByRole('option', { name: /^Gauche/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: 'Droite' }))
    expect(onProfile).toHaveBeenCalledWith({ side: 'right' })
  })

  it('règle la direction, la forme et ce qu’on évite une fois pour toutes', () => {
    const onProfile = vi.fn()
    render(
      <Account
        page="search"
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
    // « NE » se lit « Nord-est » : deux lettres ne disent rien.
    choisir('Direction', 'Nord-est')
    expect(onProfile).toHaveBeenLastCalledWith({ direction: 'NE' })
    choisir('Forme', /^Deux boucles/)
    expect(onProfile).toHaveBeenLastCalledWith({ form: 'eight' })
    fireEvent.click(interrupteur('Boucles déjà courues'))
    expect(onProfile).toHaveBeenLastCalledWith({ avoid: ['known'] })
  })
})
