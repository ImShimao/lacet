/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Le champ de recherche d'un départ.
 *
 * Ce qui compte ici n'est pas de trouver — c'est le travail du géocodeur, testé
 * ailleurs — mais de **dire la vérité sur ce qui s'est passé**. « Aucun lieu de
 * ce nom » et « la recherche n'a pas répondu » demandent deux gestes
 * différents : retaper autrement, ou se passer du réseau. Longtemps, les deux
 * se ressemblaient : rien ne s'affichait.
 *
 * Et le champ vide n'est pas vide : il porte les derniers départs, qui sont sur
 * l'appareil et marchent sans réseau.
 *
 * Les minuteries restent vraies : la frappe attend trois cent cinquante
 * millisecondes avant de partir sur le réseau, et `findBy…` sait patienter. Des
 * minuteries truquées obligeraient à les avancer à la main **à l'intérieur** de
 * chaque attente de la bibliothèque, qui, elle, s'en remet à l'horloge réelle.
 */

const cherche = vi.fn()
vi.mock('./api', () => ({ searchPlaces: (...args) => cherche(...args) }))

let SearchBar
beforeEach(async () => {
  localStorage.clear()
  cherche.mockReset()
  SearchBar = (await import('./SearchBar.jsx')).default
})
afterEach(cleanup)

function taper(texte) {
  const champ = screen.getByRole('combobox')
  fireEvent.focus(champ)
  fireEvent.change(champ, { target: { value: texte } })
}

/** Le temps qu'il faut pour être sûr que rien ne s'affichera. */
const patienter = () => new Promise((r) => setTimeout(r, 600))

const lieu = (short, extra = {}) => ({
  short,
  label: '68500 Guebwiller',
  kind: 'Ville',
  lat: 47.9,
  lon: 7.2,
  ...extra,
})

describe('la recherche d’un départ', () => {
  it('propose ce qu’elle a trouvé, et le choisit', async () => {
    cherche.mockResolvedValue([lieu('Guebwiller')])
    const onPick = vi.fn()
    render(<SearchBar onPick={onPick} />)

    taper('guebwiller')
    fireEvent.click(await screen.findByRole('option', { name: /Guebwiller/ }))
    expect(onPick).toHaveBeenCalledWith({ lat: 47.9, lon: 7.2, label: 'Guebwiller' })
  })

  it('dit qu’elle n’a rien trouvé, sans faire croire à une panne', async () => {
    cherche.mockResolvedValue([])
    render(<SearchBar onPick={() => {}} />)

    taper('qzxwvbnmklj')
    expect(await screen.findByText(/Aucun lieu trouvé pour « qzxwvbnmklj »/)).toBeInTheDocument()
  })

  it('distingue la panne du lieu introuvable', async () => {
    cherche.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SearchBar onPick={() => {}} />)

    taper('colmar')
    expect(await screen.findByText(/n’a pas répondu/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun lieu trouvé/)).not.toBeInTheDocument()
  })

  it('ne crie pas à la panne quand c’est la frappe qui a annulé', async () => {
    cherche.mockRejectedValue(new DOMException('annulé', 'AbortError'))
    render(<SearchBar onPick={() => {}} />)

    taper('col')
    await patienter()
    expect(screen.queryByText(/n’a pas répondu/)).not.toBeInTheDocument()
  })

  it('propose les derniers départs quand le champ est vide', async () => {
    cherche.mockResolvedValue([lieu('Colmar', { lat: 48.08, lon: 7.36 })])
    const onPick = vi.fn()
    render(<SearchBar onPick={onPick} />)

    taper('colmar')
    fireEvent.click(await screen.findByRole('option', { name: /Colmar/ }))

    // Le champ s'est vidé en choisissant : on le rouvre, et le départ est là.
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => expect(screen.getByText('Départs récents')).toBeInTheDocument())

    cherche.mockClear()
    fireEvent.click(screen.getByRole('option', { name: /Colmar/ }))
    expect(onPick).toHaveBeenLastCalledWith({ lat: 48.08, lon: 7.36, label: 'Colmar' })
    // Rien n'est reparti sur le réseau : c'est tout l'intérêt de cette liste.
    expect(cherche).not.toHaveBeenCalled()
  })
})
