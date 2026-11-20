/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ShareSheet from './ShareSheet.jsx'
import { figuresOf, templatesFor } from './shareCard'

vi.mock('./contact', () => ({ shareText: vi.fn() }))

/**
 * La page de partage : les modèles offerts selon ce que la sortie a gardé, le
 * choix d'un modèle, et le texte qui part quand l'image ne se fait pas.
 */

const ancienne = { ranAt: '2026-10-02T08:00:00Z', name: 'Boucle nord', sport: 'run', actual_distance_m: 8000, actual_duration_s: 2880 }
const complete = {
  ...ancienne,
  actual_ascent_m: 48,
  track: [[7.21, 47.91], [7.22, 47.92], [7.23, 47.91]],
  splits: [{ km: 1, seconds: 360 }, { km: 2, seconds: 350 }],
}

describe('templatesFor', () => {
  it('n’offre ni la trace ni les kilomètres à une sortie qui ne les a plus', () => {
    expect(templatesFor(ancienne).map((t) => t.key)).toEqual(['card', 'figures', 'band'])
  })

  it('offre tout à une sortie complète, la carte en premier', () => {
    expect(templatesFor(complete).map((t) => t.key)).toEqual(['card', 'trace', 'figures', 'band', 'splits'])
  })

  it('dit le dénivelé seulement s’il a été mesuré', () => {
    expect(figuresOf(ancienne).map(([, l]) => l)).toEqual(['Distance', 'Allure', 'Temps'])
    expect(figuresOf(complete)[3]).toEqual(['48 m', 'Dénivelé +'])
  })
})

describe('ShareSheet', () => {
  // jsdom ne dessine pas : sans canevas, les images restent vides, comme sur un
  // système qui refuserait le dessin.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = () => null
  })
  afterEach(cleanup)

  it('ouvre sur la carte et change d’explication avec le modèle', () => {
    render(<ShareSheet entry={complete} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Carte' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Trace' }))
    expect(screen.getByText(/colle-la sur une photo de ta story/)).toBeTruthy()
  })

  it('partage le texte quand l’image ne se fait pas', async () => {
    const { shareText } = await import('./contact')
    render(<ShareSheet entry={complete} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Partager' }))
    await waitFor(() => expect(shareText).toHaveBeenCalled())
    expect(shareText.mock.calls[0][0]).toBe('Boucle nord — 8,00 km · 6:00 /km · 48:00 · 48 m — avec Lacet')
  })

  it('se ferme d’Échap', () => {
    const onClose = vi.fn()
    render(<ShareSheet entry={ancienne} onClose={onClose} />)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
