/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Explore from './Explore.jsx'

/**
 * L'écran des propositions.
 *
 * Il porte six avertissements — départ déplacé, bord de zone manquant, relief
 * absent, tolérance élargie, calcul fait ailleurs, vent — et chacun **ne doit
 * paraître que s'il est vrai**. Un avertissement qui s'affiche à tort apprend à
 * ne plus les lire ; un avertissement manquant laisse croire à un bug. Ils ne
 * se voient pas dans les tests du moteur : ils vivent ici.
 *
 * Et deux chiffres doivent rester honnêtes quand le moteur n'a rien su dire :
 * une note absente s'écrit « — », pas « A », et un dénivelé inconnu ne s'écrit
 * pas « 0 m ».
 */

// La bande de propositions se recentre sur celle qu'on choisit ; jsdom ne sait
// pas faire défiler, et n'a de toute façon pas de largeur à faire défiler.
Element.prototype.scrollTo = () => {}

afterEach(cleanup)

const boucle = (extra = {}) => ({
  id: 'r1',
  name: 'Boucle est · Rue Principale',
  distance_m: 9900,
  duration_s: 3900,
  ascent_m: 66,
  grade: 'A',
  bearing: 90,
  laps: 1,
  protected_share: 0.98,
  surfaces: { asphalt_m: 9900 },
  geometry: [
    [7.2, 47.9],
    [7.21, 47.91],
    [7.2, 47.9],
  ],
  safety: { grade: 'A', exposed_m: 0, crossings: [], protected_share: 0.98, notes: [] },
  ...extra,
})

function afficher(props = {}) {
  const routes = props.routes ?? [boucle()]
  return render(
    <Explore
      start={{ lat: 47.9, lon: 7.2 }}
      startLabel="Guebwiller"
      geo={{ status: 'ready', position: [7.2, 47.9], accuracy: 8, following: false }}
      busy={false}
      error={null}
      result={{ routes, rejected: [], meta: props.meta ?? {}, request: {} }}
      selected={routes[0]}
      detail
      params={{ sport: 'run', surface: 'mixed', elevation: 'rolling', safety: 'safe', distance_km: 10, mode: 'distance' }}
      isFavorite={() => false}
      onToggleDetail={() => {}}
      onSearch={() => {}}
      onSelect={() => {}}
      onStart={() => {}}
      onFreeRun={() => {}}
      onFavorite={() => {}}
      onOpenFilters={() => {}}
      onOpenDetail={() => {}}
      onScrub={() => {}}
      onPlace={() => {}}
      onOpenSaved={() => {}}
      {...props}
    />,
  )
}

describe('les avertissements de l’écran', () => {
  it('se taisent quand tout s’est bien passé', () => {
    afficher()
    expect(screen.queryByText(/posé sur la rue/)).not.toBeInTheDocument()
    expect(screen.queryByText(/relief n'a pas répondu/)).not.toBeInTheDocument()
    expect(screen.queryByText(/bord de la zone/)).not.toBeInTheDocument()
  })

  it('disent de combien le départ a rejoint la rue', () => {
    afficher({ snapped: 118 })
    expect(screen.getByText(/posé sur la rue, à 118 m/)).toBeInTheDocument()
  })

  it('disent que le relief manque — et pourquoi le classement s’en est passé', () => {
    afficher({ meta: { elevation_skipped: true } })
    expect(screen.getByText(/relief n'a pas répondu à temps/)).toBeInTheDocument()
  })

  it('disent l’heure de retour si l’on part maintenant', () => {
    afficher()
    expect(screen.getByText(/Retour vers \d/)).toBeInTheDocument()
  })

  it('disent la météo du départ et la tenue qui va avec', () => {
    afficher({ meta: { weather: { temp_c: 1.6, rain_mm: 0 } } })
    expect(screen.getByText(/2 °C au départ : gants, bonnet/)).toBeInTheDocument()
  })

  it('disent qu’une bordure de la zone n’est pas arrivée', () => {
    afficher({ meta: { partial: true } })
    expect(screen.getByText(/bord de la zone n'est pas encore arrivé/)).toBeInTheDocument()
  })

  it('proposent la recherche qui répond, en un toucher', () => {
    const onSearchWith = vi.fn()
    const onSearch = vi.fn()
    afficher({
      onSearchWith,
      onSearch,
      meta: { partial: true },
      params: { sport: 'run', surface: 'mixed', elevation: 'rolling', climb_m: 300, safety: 'safe', distance_km: 10, mode: 'distance' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Viser 66 m' }))
    expect(onSearchWith).toHaveBeenCalledWith({ climb_m: 66 })
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }))
    expect(onSearch).toHaveBeenCalled()
  })

  it('« Partager » dit où envoyer la boucle, et comment', () => {
    afficher()
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer cette boucle' }))
    expect(screen.getByText('Garmin Connect')).toBeInTheDocument()
    // Komoot ne lit pas le partage d'iOS : la ligne ouvre un guide pas à pas.
    fireEvent.click(screen.getByRole('button', { name: /Komoot/ }))
    expect(screen.getByText('Pousser cette boucle sur Komoot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ouvrir Komoot' })).toBeInTheDocument()
  })

  it('n’inventent pas de note quand le moteur n’a pas pu juger', () => {
    // Le calculateur de secours ne regarde ni trottoirs ni traversées : sans
    // cette règle, la pastille affichait « A » et le tracé passait pour sûr.
    const { container } = afficher({ routes: [boucle({ grade: null, safety: null, ascent_m: null })] })
    const pastille = container.querySelector('.grade')
    expect(pastille).toHaveTextContent('—')
    expect(pastille.className).toContain('grade--unknown')
    expect(screen.queryByText('D+ 0 m')).not.toBeInTheDocument()
  })

})

describe('pendant la recherche', () => {
  it('propose d’abandonner', () => {
    const onCancel = vi.fn()
    afficher({ busy: 'search', result: null, onCancel })
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('ne propose rien quand l’attente ne s’abandonne pas', () => {
    afficher({ busy: 'work', result: null, onCancel: null })
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument()
  })
})

describe('la feuille de route', () => {
  it('montre sur la carte la consigne touchée', () => {
    // Le point s'allumait sous la feuille dépliée, sans que rien ne bouge : la
    // consigne passe maintenant son point à `App`, qui replie la feuille et y
    // amène la carte.
    const onShowStep = vi.fn()
    const instructions = [
      { text: 'Départ', dist_m: 0, turn: 'start', lon: 7.2, lat: 47.9 },
      { text: 'Tourne à droite sur Brunleweg', dist_m: 1200, turn: 'right', lon: 7.205, lat: 47.903 },
      { text: 'Te voilà rentré au départ.', dist_m: 9900, turn: 'finish', lon: 7.2, lat: 47.9 },
    ]
    afficher({ routes: [boucle({ instructions })], onShowStep })
    fireEvent.click(screen.getByRole('button', { name: /Brunleweg.*montrer sur la carte/ }))
    expect(onShowStep).toHaveBeenCalledWith([7.205, 47.903])
  })
})

describe('un « 8 »', () => {
  it('montre ses deux boucles, pas « × 2 »', () => {
    // Deux boucles différentes enchaînées au départ : « 4,6 km × 2 » laisserait
    // croire qu'on refait deux fois les mêmes rues.
    const huit = boucle({ laps: 2, lap_distance_m: 4950, lap_distances_m: [5120.4, 4779.6], figure_eight: true })
    const { container } = afficher({ routes: [huit] })
    expect(container.querySelector('.rcard__dir')).toHaveTextContent('5,1 + 4,8 km')
    expect(screen.getByText(/Deux boucles différentes/)).toBeInTheDocument()
    expect(screen.queryByText(/à parcourir/)).not.toBeInTheDocument()
  })

  it('laisse une boucle répétée dire combien de fois', () => {
    const tours = boucle({ laps: 2, lap_distance_m: 4950, lap_distances_m: [4950, 4950], figure_eight: false })
    const { container } = afficher({ routes: [tours] })
    expect(container.querySelector('.rcard__dir')).toHaveTextContent('5,0 km × 2')
    expect(screen.getByText(/à parcourir/)).toBeInTheDocument()
  })
})

/** L'accueil, sans proposition : la distance se règle d'un geste, sans ouvrir les filtres. */
describe('l’accueil : la distance en grand', () => {
  const accueil = (onQuickParams) =>
    render(
      <Explore
        start={[7.2, 47.9]}
        startLabel="Guebwiller"
        geo={{ status: 'ready', accuracy: 8 }}
        params={{ sport: 'run', mode: 'distance', distance_km: 10, surface: 'mixed', elevation: 'rolling', safety: 'safe' }}
        history={[]}
        onQuickParams={onQuickParams}
        onSearch={() => {}}
        onOpenFilters={() => {}}
        onFreeRun={() => {}}
      />,
    )

  it('affiche la distance choisie en grand', () => {
    accueil(vi.fn())
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('se règle à la règle, par demi-kilomètre : au défilement comme au clavier', () => {
    const onQuickParams = vi.fn()
    accueil(onQuickParams)
    const regle = screen.getByRole('slider', { name: 'Distance de la boucle' })
    // Vingt-trois crans de 12 px depuis 1 km : 12,5 km.
    regle.scrollLeft = 23 * 12
    fireEvent.scroll(regle)
    expect(onQuickParams).toHaveBeenLastCalledWith({ distance_km: 12.5, mode: 'distance' })
    fireEvent.keyDown(regle, { key: 'ArrowRight' })
    expect(onQuickParams).toHaveBeenLastCalledWith({ distance_km: 10.5, mode: 'distance' })
  })

  it('passe en durée, avec ses propres raccourcis', () => {
    const onQuickParams = vi.fn()
    accueil(onQuickParams)
    fireEvent.click(screen.getByRole('button', { name: 'Durée' }))
    expect(onQuickParams).toHaveBeenLastCalledWith({ mode: 'duration' })
  })
})

describe('une boucle importée', () => {
  afterEach(cleanup)

  it('se signale à son arrivée, et se referme pour revenir au générateur', () => {
    // Après un import, l'écran ne montrait que le fichier : sans bouton,
    // revenir à « Trouver ma boucle » demandait de deviner un autre chemin.
    const onBack = vi.fn()
    afficher({ routes: [boucle({ imported: true, matched: true })], freshImport: true, onBack })
    expect(screen.getByRole('status')).toHaveTextContent('importée et analysée')
    fireEvent.click(screen.getByRole('button', { name: 'Revenir au générateur' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

/**
 * « Aller à… » sans arrivée : le panneau ne pose qu'une question, pour laisser
 * la carte libre — et pendant qu'on pose l'arrivée, il n'en reste qu'une ligne.
 */
describe("l'écran Aller à", () => {
  const formulaire = (props) =>
    render(
      <Explore
        start={{ lat: 47.9, lon: 7.2 }}
        startLabel="Guebwiller"
        geo={{ status: 'ready', position: [7.2, 47.9], accuracy: 8, following: false }}
        busy={false}
        error={null}
        result={null}
        params={{ sport: 'run', surface: 'mixed', elevation: 'rolling', safety: 'safe', distance_km: 10, mode: 'distance' }}
        journey
        tripKind="stretch"
        onGoal={() => {}}
        onTripKind={() => {}}
        onQuickParams={() => {}}
        onPlaceDestination={() => {}}
        onClearDestination={() => {}}
        onSearch={() => {}}
        onFreeRun={() => {}}
        onOpenFilters={() => {}}
        {...props}
      />,
    )

  it("sans arrivée, cache la longueur, les filtres et la course libre", () => {
    formulaire()
    expect(screen.getByText('Où vas-tu ?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Filtres/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Courir libre/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /10 km/ })).toBeNull()
  })

  it("pendant la pose, ne garde que la ligne d'arrivée", () => {
    formulaire({ placingDest: true })
    expect(screen.getByText('touche la carte là où tu veux arriver')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choisir l'arrivée/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Plus long' })).toBeNull()
  })

  it("une fois l'arrivée posée, tout revient", () => {
    formulaire({ destination: { lat: 47.91, lon: 7.21, label: 'Parc' } })
    expect(screen.getByRole('button', { name: /Filtres/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Courir libre/ })).toBeInTheDocument()
  })
})

describe("l'accueil replié", () => {
  // Une fois la carte déplacée, l'accueil ne garde que le départ et le bouton :
  // la carte reprend la place, et rien ne disparaît pour de bon.
  it('garde le départ et « Trouver ma boucle », et le départ rouvre le reste', () => {
    const onExpand = vi.fn()
    const onSearch = vi.fn()
    render(
      <Explore
        start={{ lat: 47.9, lon: 7.2 }}
        startLabel="Guebwiller"
        geo={{ status: 'ready', position: [7.2, 47.9], accuracy: 8, following: false }}
        result={null}
        params={{ sport: 'run', surface: 'mixed', elevation: 'rolling', safety: 'safe', distance_km: 10, mode: 'distance' }}
        compact
        onExpand={onExpand}
        onSearch={onSearch}
        onQuickParams={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /Filtres/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Trouver ma boucle/ }))
    expect(onSearch).toHaveBeenCalled()
    const depart = screen.getByRole('button', { name: /Guebwiller/ })
    expect(depart).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(depart)
    expect(onExpand).toHaveBeenCalled()
  })
})

describe('les propositions réduites', () => {
  // Carte déplacée, les cartes de boucle se réduisent ; le premier toucher les
  // rouvre seulement, il n'ouvre pas le détail d'une carte à moitié lue.
  it('rouvrent au premier toucher sans ouvrir le détail', () => {
    const onExpand = vi.fn()
    const onOpenDetail = vi.fn()
    afficher({ compact: true, onExpand, onOpenDetail })
    fireEvent.click(screen.getByRole('button', { name: /10 km|9,9/ }))
    expect(onExpand).toHaveBeenCalled()
    expect(onOpenDetail).not.toHaveBeenCalled()
  })
})
