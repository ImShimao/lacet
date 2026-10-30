/** @vitest-environment jsdom */
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSheetDrag } from './Sheet.jsx'

/**
 * L'en-tête de la feuille dépliée : on le tire pour refermer, et il porte la
 * pastille d'activité, seul accès aux filtres depuis le détail.
 *
 * Les deux se gênaient : l'en-tête capturait le doigt dès qu'il se posait, et
 * le toucher n'arrivait plus à la pastille. Un bouton reçoit maintenant son
 * toucher ; il ne cède le doigt au geste qu'une fois sûr qu'il tire vers le bas.
 */

// jsdom n'a pas d'événement de pointeur ; celui de la souris porte `clientY`.
window.PointerEvent ??= class extends MouseEvent {}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Feuille({ setSheet, onPill }) {
  const shell = useRef(document.createElement('div'))
  const drag = useSheetDrag('full', setSheet, shell)
  return (
    <header data-testid="tete" {...drag()}>
      <button type="button" className="grabber" aria-label="Replier le détail" />
      <button type="button" onClick={onPill}>
        Course · 10 km
      </button>
    </header>
  )
}

function afficher() {
  const setSheet = vi.fn()
  const onPill = vi.fn()
  render(<Feuille setSheet={setSheet} onPill={onPill} />)
  const tete = screen.getByTestId('tete')
  tete.setPointerCapture = vi.fn()
  return { setSheet, onPill, tete, pill: screen.getByText('Course · 10 km') }
}

describe('l’en-tête de la feuille dépliée', () => {
  it('laisse un toucher atteindre la pastille d’activité', () => {
    const { setSheet, onPill, tete, pill } = afficher()
    fireEvent.pointerDown(pill, { clientY: 100 })
    fireEvent.pointerUp(pill, { clientY: 101 })
    fireEvent.click(pill)
    expect(tete.setPointerCapture).not.toHaveBeenCalled()
    expect(onPill).toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(setSheet).not.toHaveBeenCalled()
  })

  it('referme quand même la feuille tirée depuis la pastille', () => {
    const { setSheet, tete, pill } = afficher()
    fireEvent.pointerDown(pill, { clientY: 100 })
    fireEvent.pointerMove(pill, { clientY: 190 })
    expect(tete.setPointerCapture).toHaveBeenCalled()
    fireEvent.pointerUp(pill, { clientY: 190 })
    vi.advanceTimersByTime(300)
    expect(setSheet).toHaveBeenCalledWith('peek')
  })

  it('prend le doigt d’emblée ailleurs dans l’en-tête', () => {
    const { tete } = afficher()
    fireEvent.pointerDown(tete, { clientY: 100 })
    expect(tete.setPointerCapture).toHaveBeenCalled()
  })
})
