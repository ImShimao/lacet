/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    expect(screen.queryByText(/posé sur la rue la plus proche/)).not.toBeInTheDocument()
    expect(screen.queryByText(/relief n'a pas répondu/)).not.toBeInTheDocument()
    expect(screen.queryByText(/bord de la zone/)).not.toBeInTheDocument()
  })

  it('disent de combien le départ a rejoint la rue', () => {
    afficher({ snapped: 118 })
    expect(screen.getByText(/posé sur la rue la plus proche, à 118 m/)).toBeInTheDocument()
  })

  it('disent que le relief manque — et pourquoi le classement s’en est passé', () => {
    afficher({ meta: { elevation_skipped: true } })
    expect(screen.getByText(/relief n'a pas répondu à temps/)).toBeInTheDocument()
  })

  it('disent qu’une bordure de la zone n’est pas arrivée', () => {
    afficher({ meta: { partial: true } })
    expect(screen.getByText(/bord de la zone n'est pas encore arrivé/)).toBeInTheDocument()
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
