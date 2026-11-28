/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Tour, { placeBubble } from './Tour.jsx'

/**
 * La visite guidée : une bulle par élément présent à l'écran, sautant ceux qui
 * manquent, une seule fois ; et une bulle qui ne sort jamais de l'écran.
 */

describe('la visite guidée', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('montre les éléments présents, puis ne revient plus', async () => {
    vi.useFakeTimers()
    // Seuls la recherche et le bouton de recherche sont à l'écran.
    document.body.innerHTML = '<div class="search"></div><div class="panel"><button class="btn--big"></button></div>'
    const onDone = vi.fn()
    render(<Tour onDone={onDone} />)
    await act(async () => vi.advanceTimersByTime(2000))

    expect(screen.getByRole('heading', { name: 'Le départ' })).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(screen.getByRole('heading', { name: 'Trouver ma boucle' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "C'est parti" }))
    expect(onDone).toHaveBeenCalled()
    expect(localStorage.getItem('lacet.visite')).toBe('oui')

    cleanup()
    render(<Tour />)
    await act(async () => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('pose la bulle dessous, ou dessus près du bas, sans sortir de l’écran', () => {
    const view = { w: 390, h: 844 }
    const top = placeBubble({ left: 12, top: 12, bottom: 56, width: 310, height: 44 }, view)
    expect(top).toMatchObject({ below: true, left: 16, width: 320 })
    const low = placeBubble({ left: 360, top: 700, bottom: 744, width: 20, height: 44 }, view)
    expect(low.below).toBe(false)
    expect(low.left + low.width).toBeLessThanOrEqual(374)
    // La flèche vise encore l'élément, collé au bord droit.
    expect(low.left + low.arrow).toBeGreaterThan(340)
  })
})
