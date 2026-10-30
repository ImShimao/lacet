/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import FiltersSheet, { DEFAULTS } from './FiltersSheet.jsx'

/**
 * Le panneau des filtres, tel qu'on s'en sert.
 *
 * Trois choses à tenir. **Ce qu'on règle se voit tout de suite** : c'est toute
 * la raison du retour de l'allure ici — une heure de course ne veut rien dire
 * tant qu'on ignore à quelle allure, et le nombre de kilomètres doit bouger
 * sous les doigts. **Rien ne part avant « Rechercher »** : on ouvre souvent le
 * panneau pour regarder, et une recherche déclenchée par un réglage effleuré
 * coûterait dix secondes et des données. Et **« Annuler » annule vraiment** —
 * les réglages touchés ne doivent pas rester.
 */

afterEach(cleanup)

const ouvrir = (value = DEFAULTS) => {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(<FiltersSheet value={value} onApply={onApply} onClose={onClose} />)
  return { onApply, onClose }
}

/** Le texte de conversion « environ 9,2 km », sans se soucier des espaces. */
const conversion = () => screen.getByText(/Converti en distance/).textContent.replace(/\s+/g, ' ')

describe('le panneau des filtres', () => {
  it('convertit la durée en distance, et suit l’allure qu’on règle', () => {
    ouvrir({ ...DEFAULTS, mode: 'duration', duration_min: 60, pace_sec_per_km: 390 })
    expect(conversion()).toContain('environ 9,2 km')

    // Une allure plus lente, c'est moins de kilomètres dans la même heure.
    const plus = screen.getAllByRole('button', { name: 'Augmenter' })
    fireEvent.click(plus[plus.length - 1])
    expect(screen.getByText(/6:35 \/km/)).toBeInTheDocument()
    expect(conversion()).toContain('environ 9,1 km')
  })

  it('annonce la durée de la boucle quand on règle une distance', () => {
    ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 10, pace_sec_per_km: 390 })
    expect(screen.getByText(/environ 1 h 05 pour cette boucle/)).toBeInTheDocument()
  })

  it('ne lance rien tant qu’on n’a pas demandé', () => {
    const { onApply } = ouvrir()
    fireEvent.click(screen.getByRole('button', { name: /Sentier/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Vélo' }))
    // Le terrain change de nom avec l'activité — « Sentier » à pied, « VTT » à
    // vélo —, et le panneau le suit sans rien lancer.
    expect(screen.getByRole('button', { name: /VTT/ })).toHaveAttribute('aria-pressed', 'true')
    expect(onApply).not.toHaveBeenCalled()
  })

  it('applique tout d’un coup, et seulement à la demande', () => {
    const { onApply } = ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Vélo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toMatchObject({ sport: 'bike' })
  })

  it('oublie ce qu’on a touché si l’on renonce', () => {
    const { onApply, onClose } = ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Vélo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('choisit le côté où partir, « Auto » par défaut', () => {
    const { onApply } = ouvrir()
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/se répartissent autour du départ/)).toBeInTheDocument()

    // « NE » se lit « Nord-est » : deux lettres ne disent rien à une voix.
    fireEvent.click(screen.getByRole('button', { name: 'Nord-est' }))
    expect(screen.getByRole('button', { name: 'Nord-est' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/partent vers le nord-est/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ direction: 'NE' })
  })

  it('remet la direction sur « Auto » en réinitialisant', () => {
    ouvrir({ ...DEFAULTS, direction: 'O' })
    expect(screen.getByRole('button', { name: 'Ouest' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('demande un D+ précis à la place des trois réglages', () => {
    // « On ne peut pas demander un D+ en particulier », reprochait-on à RunnrZ.
    const { onApply } = ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 10 })
    fireEvent.click(screen.getByRole('checkbox', { name: /Un D\+ précis/ }))
    // On part de 10 m par kilomètre, la cible de Vallonné, qui se décoche.
    expect(screen.getByText('100 m de D+')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vallonné/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/entre 80 et 120 m passent devant/)).toBeInTheDocument()

    // Au clavier, comme la distance : « environ 150 m ».
    fireEvent.click(screen.getByText('100 m de D+'))
    const champ = screen.getByRole('textbox', { name: 'Valeur' })
    fireEvent.change(champ, { target: { value: '150' } })
    fireEvent.keyDown(champ, { key: 'Enter' })
    expect(screen.getByText(/entre 120 et 180 m passent devant/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ climb_m: 150 })
  })

  it('reprend une tuile de relief en oubliant le D+ précis', () => {
    const { onApply } = ouvrir({ ...DEFAULTS, climb_m: 150 })
    fireEvent.click(screen.getByRole('button', { name: /Plat/ }))
    expect(screen.queryByText(/m de D\+/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ elevation: 'flat', climb_m: null })
  })

  it('montre la vitesse et non l’allure à vélo', () => {
    ouvrir({ ...DEFAULTS, sport: 'bike', speedUnit: 'speed', speed_kmh: 20 })
    expect(screen.getByText('Vitesse')).toBeInTheDocument()
    expect(screen.getByText(/20 km\/h/)).toBeInTheDocument()
    // Le choix d'unité n'a pas de sens à vélo : c'est la vitesse qui part au
    // moteur, quoi qu'on affiche.
    expect(screen.queryByRole('button', { name: 'min/km' })).not.toBeInTheDocument()
  })

  it('n’affiche pas un filtre masqué dans les réglages, mais garde la longueur', () => {
    ouvrir({ ...DEFAULTS, hiddenFilters: ['terrain', 'direction'] })
    expect(screen.queryByText('Terrain')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nord-est' })).not.toBeInTheDocument()
    // Les essentiels et les autres filtres restent.
    expect(screen.getByText('Longueur')).toBeInTheDocument()
    expect(screen.getByText('Allure')).toBeInTheDocument()
    expect(screen.getByText('Dénivelé')).toBeInTheDocument()
  })

  it('choisit la forme, et dit la longueur de chaque tour', () => {
    // « Une boucle, deux boucles ou plusieurs tours » : le moteur choisissait seul.
    const { onApply } = ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 10 })
    expect(screen.getByRole('button', { name: 'Forme auto' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '2 boucles' }))
    expect(screen.getByText(/Deux boucles d'environ 5 km, de deux côtés du départ/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tours' }))
    expect(screen.getByText('2 tours')).toBeInTheDocument()
    // Le compteur de tours vient après la distance et l'allure.
    const plus = screen.getAllByRole('button', { name: 'Augmenter' })
    fireEvent.click(plus[2])
    expect(screen.getByText(/environ 3,3 km, à faire 3 fois/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ form: 'laps', laps: 3 })
  })

  it('prévient quand les tours seraient trop courts', () => {
    ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 5, form: 'laps', laps: 4 })
    expect(screen.getByText(/4 tours de 1,3 km : trop courts/)).toBeInTheDocument()
  })

  it('réinitialise les filtres sans réafficher ceux qu’on a masqués', () => {
    const { onApply } = ouvrir({ ...DEFAULTS, hiddenFilters: ['avoid'], count: 12, surface: 'trail' })
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    // Le nombre de propositions se règle dans « Mon compte » : il reste aussi.
    expect(onApply.mock.calls[0][0]).toMatchObject({ hiddenFilters: ['avoid'], count: 12, surface: 'mixed' })
  })
})
