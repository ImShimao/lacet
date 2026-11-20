/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/** Les réglages se replient en une ligne (nom, valeur, flèche) : on les ouvre comme au doigt. */
const déplier = (nom) => fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + nom) }))

/** Le texte de conversion « environ 9,2 km », sans se soucier des espaces. */
const conversion = () => screen.getByText(/Converti en distance/).textContent.replace(/\s+/g, ' ')

describe('le panneau des filtres', () => {
  it('convertit la durée en distance, et suit l’allure qu’on règle', () => {
    ouvrir({ ...DEFAULTS, mode: 'duration', duration_min: 60, pace_sec_per_km: 390 })
    expect(conversion()).toContain('environ 9,2 km')

    // Une allure plus lente, c'est moins de kilomètres dans la même heure.
    déplier('Allure')
    const plus = screen.getAllByRole('button', { name: 'Augmenter' })
    fireEvent.click(plus[plus.length - 1])
    expect(screen.getAllByText(/6:35 \/km/).length).toBeGreaterThan(0)
    expect(conversion()).toContain('environ 9,1 km')
  })

  it('annonce la durée de la boucle quand on règle une distance', () => {
    ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 10, pace_sec_per_km: 390 })
    déplier('Allure')
    expect(screen.getByText(/environ 1 h 05 pour cette boucle/)).toBeInTheDocument()
  })

  it('ne lance rien tant qu’on n’a pas demandé', () => {
    const { onApply } = ouvrir()
    // Le terrain se lit sans rien ouvrir : un rond, le nom, ce qu'il donne.
    fireEvent.click(screen.getByRole('radio', { name: /Sentier/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Vélo' }))
    // Le terrain change de nom avec l'activité — « Sentier » à pied, « VTT » à
    // vélo —, et le panneau le suit sans rien lancer.
    expect(screen.getByRole('radio', { name: /^VTT/ })).toHaveAttribute('aria-checked', 'true')
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

  it('laisse la direction, la sécurité et la forme à « Mon compte »', () => {
    // Réglés une fois pour toutes, ils ne sont plus dans le panneau, et
    // « Réinitialiser » n'y touche pas.
    const { onApply } = ouvrir({ ...DEFAULTS, direction: 'O', safety: 'standard', form: 'laps', avoid: ['known'] })
    expect(screen.queryByText('Direction')).not.toBeInTheDocument()
    expect(screen.queryByText('Sécurité')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ direction: 'O', safety: 'standard', form: 'laps', avoid: ['known'] })
  })

  it('propose des allures toutes faites, et la sienne', () => {
    const { onApply } = ouvrir({ ...DEFAULTS, pace_sec_per_km: 360 })
    expect(screen.getByRole('button', { name: /^Allure/ }).textContent).toContain('Intermédiaire')
    déplier('Allure')
    fireEvent.click(screen.getByRole('radio', { name: /Débutant/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ pace_sec_per_km: 450, speedUnit: 'pace' })
  })

  it('demande un D+ précis à la place des trois réglages', () => {
    // « On ne peut pas demander un D+ en particulier », reprochait-on à RunnrZ.
    const { onApply } = ouvrir({ ...DEFAULTS, mode: 'distance', distance_km: 10 })
    déplier('Relief')
    fireEvent.click(screen.getByRole('radio', { name: /Un D\+ précis/ }))
    // On part de 10 m par kilomètre, la cible de Vallonné, qui se décoche.
    expect(screen.getAllByText('100 m de D+').length).toBe(2)
    expect(screen.getByRole('radio', { name: /Vallonné/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/entre 80 et 120 m passent devant/)).toBeInTheDocument()

    // Au clavier, comme la distance : « environ 150 m ».
    fireEvent.click(screen.getAllByText('100 m de D+').at(-1))
    const champ = screen.getByRole('textbox', { name: 'Valeur' })
    fireEvent.change(champ, { target: { value: '150' } })
    fireEvent.keyDown(champ, { key: 'Enter' })
    expect(screen.getByText(/entre 120 et 180 m passent devant/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ climb_m: 150 })
  })

  it('reprend une tuile de relief en oubliant le D+ précis', () => {
    const { onApply } = ouvrir({ ...DEFAULTS, climb_m: 150 })
    déplier('Relief')
    fireEvent.click(screen.getByRole('radio', { name: /Plat/ }))
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
    ouvrir({ ...DEFAULTS, hiddenFilters: ['terrain'] })
    expect(screen.queryByText('Préférences de parcours')).not.toBeInTheDocument()
    // Les essentiels et les autres filtres restent.
    expect(screen.getByText('Longueur')).toBeInTheDocument()
    expect(screen.getByText('Allure')).toBeInTheDocument()
    expect(screen.getByText('Relief')).toBeInTheDocument()
  })

  it('propose à vélo des distances et des durées de cycliste', () => {
    ouvrir({ ...DEFAULTS, sport: 'bike', speedUnit: 'speed', mode: 'distance', distance_km: 40 })
    expect(screen.queryByRole('button', { name: 'Semi' })).not.toBeInTheDocument()
    const usuelles = within(screen.getByRole('group', { name: 'Distances usuelles' }))
    fireEvent.click(usuelles.getByRole('button', { name: '75 km' }))
    expect(usuelles.getByRole('button', { name: '75 km' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Durée' }))
    expect(screen.getByRole('button', { name: '3 h' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '30 min' })).not.toBeInTheDocument()
  })

  it('réinitialise les filtres sans réafficher ceux qu’on a masqués', () => {
    const { onApply } = ouvrir({ ...DEFAULTS, hiddenFilters: ['relief'], count: 12, surface: 'trail' })
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    // Le nombre de propositions se règle dans « Mon compte » : il reste aussi.
    expect(onApply.mock.calls[0][0]).toMatchObject({ hiddenFilters: ['relief'], count: 12, surface: 'mixed' })
  })
})
