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
    vi.advanceTimersByTime(600)
    expect(setSheet).not.toHaveBeenCalled()
  })

  it('referme quand même la feuille tirée depuis la pastille', () => {
    const { setSheet, tete, pill } = afficher()
    fireEvent.pointerDown(pill, { clientY: 100 })
    fireEvent.pointerMove(pill, { clientY: 190 })
    expect(tete.setPointerCapture).toHaveBeenCalled()
    fireEvent.pointerUp(pill, { clientY: 190 })
    vi.advanceTimersByTime(600)
    expect(setSheet).toHaveBeenCalledWith('peek')
  })

  it('prend le doigt d’emblée ailleurs dans l’en-tête', () => {
    const { tete } = afficher()
    fireEvent.pointerDown(tete, { clientY: 100 })
    expect(tete.setPointerCapture).toHaveBeenCalled()
  })

  it('se referme sur un coup sec, même court', () => {
    const { setSheet, tete } = afficher()
    fireEvent.pointerDown(tete, { clientY: 100 })
    vi.advanceTimersByTime(16)
    fireEvent.pointerMove(tete, { clientY: 115 })
    vi.advanceTimersByTime(16)
    fireEvent.pointerMove(tete, { clientY: 130 })
    fireEvent.pointerUp(tete, { clientY: 130 })
    vi.advanceTimersByTime(600)
    expect(setSheet).toHaveBeenCalledWith('peek')
  })

  it('revient en place quand on la lâche doucement avant le seuil', () => {
    const { setSheet, tete } = afficher()
    fireEvent.pointerDown(tete, { clientY: 100 })
    fireEvent.pointerMove(tete, { clientY: 140 })
    vi.advanceTimersByTime(300)
    fireEvent.pointerUp(tete, { clientY: 140 })
    vi.advanceTimersByTime(1000)
    expect(setSheet).not.toHaveBeenCalled()
  })
})

/**
 * Repliée, la feuille s'ouvre en la tirant vers le haut depuis les cartes de
 * boucle ; un glissement de côté, lui, reste aux cartes.
 */
function Repliee({ setSheet, canOpen = true }) {
  const shell = useRef(document.createElement('div'))
  const drag = useSheetDrag('peek', setSheet, shell, { canOpen })
  return (
    <div data-testid="cartes" {...drag(true)}>
      Boucle nord · 10 km
    </div>
  )
}

function replier(canOpen) {
  const setSheet = vi.fn()
  render(<Repliee setSheet={setSheet} canOpen={canOpen} />)
  const cartes = screen.getByTestId('cartes')
  cartes.setPointerCapture = vi.fn()
  return { setSheet, cartes }
}

describe('la feuille repliée', () => {
  it('s’ouvre quand on la tire vers le haut', () => {
    const { setSheet, cartes } = replier()
    fireEvent.pointerDown(cartes, { clientX: 100, clientY: 500 })
    fireEvent.pointerMove(cartes, { clientX: 102, clientY: 380 })
    fireEvent.pointerUp(cartes, { clientX: 102, clientY: 380 })
    expect(setSheet).toHaveBeenCalledWith('full')
  })

  it('laisse les cartes défiler de côté', () => {
    const { setSheet, cartes } = replier()
    fireEvent.pointerDown(cartes, { clientX: 300, clientY: 500 })
    fireEvent.pointerMove(cartes, { clientX: 150, clientY: 470 })
    fireEvent.pointerUp(cartes, { clientX: 100, clientY: 470 })
    expect(cartes.setPointerCapture).not.toHaveBeenCalled()
    expect(setSheet).not.toHaveBeenCalled()
  })

  it('ne s’ouvre pas sans boucle à détailler', () => {
    const { setSheet, cartes } = replier(false)
    fireEvent.pointerDown(cartes, { clientX: 100, clientY: 500 })
    fireEvent.pointerMove(cartes, { clientX: 100, clientY: 300 })
    fireEvent.pointerUp(cartes, { clientX: 100, clientY: 300 })
    expect(setSheet).not.toHaveBeenCalled()
  })
})
