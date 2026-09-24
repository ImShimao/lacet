/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Countdown from './Countdown.jsx'

/**
 * Le compte à rebours qui précède une sortie.
 *
 * Deux propriétés, et la seconde est la plus importante. **Il compte
 * réellement** : trois secondes, pas deux ni quatre, sinon autant partir tout
 * de suite. Et **il ne démarre rien tout seul** — un compte annulé, ou démonté
 * parce qu'on a quitté l'écran, ne doit pas lancer une sortie dans le dos de
 * celui qui vient de renoncer. C'est le genre de bug qu'on ne voit qu'une fois
 * l'enregistrement commencé.
 */

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Avance le temps comme le ferait une horloge, en laissant React réagir. */
const avancer = (ms) => act(() => vi.advanceTimersByTime(ms))

describe('le compte à rebours', () => {
  it('compte trois, deux, un, puis lance la sortie', () => {
    const onDone = vi.fn()
    render(<Countdown onDone={onDone} onCancel={() => {}} />)

    expect(screen.getByText('3')).toBeInTheDocument()
    avancer(900)
    expect(screen.getByText('2')).toBeInTheDocument()
    avancer(900)
    expect(screen.getByText('1')).toBeInTheDocument()
    avancer(900)
    expect(screen.getByText('Partez !')).toBeInTheDocument()
    // Le « Partez ! » s'affiche avant de rendre la main : sans ce dernier
    // délai, le mot n'aurait jamais le temps d'être lu.
    expect(onDone).not.toHaveBeenCalled()
    avancer(650)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('ne lance qu’une sortie, même si le temps continue de passer', () => {
    const onDone = vi.fn()
    render(<Countdown onDone={onDone} onCancel={() => {}} />)
    avancer(900)
    avancer(900)
    avancer(900)
    avancer(650)
    expect(onDone).toHaveBeenCalledTimes(1)
    avancer(5000)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('renonce sans rien démarrer', () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<Countdown onDone={onDone} onCancel={onCancel} />)

    avancer(900)
    screen.getByRole('button', { name: 'Annuler' }).click()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('renonce aussi à la touche Échap', () => {
    const onCancel = vi.fn()
    render(<Countdown onDone={() => {}} onCancel={onCancel} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ne démarre pas une sortie après avoir quitté l’écran', () => {
    // On renonce, l'écran se démonte, et le dernier délai arrive quand même :
    // sans garde, la sortie partait alors sans personne devant.
    const onDone = vi.fn()
    const { unmount } = render(<Countdown onDone={onDone} onCancel={() => {}} />)
    avancer(2700)
    unmount()
    avancer(5000)
    expect(onDone).not.toHaveBeenCalled()
  })
})
