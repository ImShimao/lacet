/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SafetyPanel from './SafetyPanel.jsx'

/**
 * Le détail de la note. Une boucle courue entièrement sur trottoir, au pied des
 * Vosges, affichait « 51 % » de trottoir ou voie propre et rien d'autre : les
 * rues calmes dont le trottoir manque sur la carte ne figuraient nulle part, et
 * l'autre moitié paraissait sur la chaussée.
 */

afterEach(cleanup)

const safety = {
  grade: 'B',
  protected_share: 0.51,
  exposed_m: 4,
  exposed_share: 0.0004,
  longest_exposed_m: 4,
  unprotected_crossings: 1,
  protected_crossings: 0,
  unlit_m: null,
  notes: [],
}
const surfaces = { paved_m: 9100, gravel_m: 0, trail_m: 0, unknown_m: 0 }
const segment = (length_m, separation, inferred) => ({ length_m, separation, inferred })
const segments = [segment(4640, 2, false), segment(4100, 1.5, true), segment(360, 0, true)]

describe('le détail de la note', () => {
  it('compte à part les rues calmes au trottoir probable', () => {
    render(<SafetyPanel safety={safety} surfaces={surfaces} segments={segments} distance={9100} />)
    expect(screen.getByText('Rue calme, trottoir probable')).toBeTruthy()
    expect(screen.getByText('45 %')).toBeTruthy()
  })

  it('ne le dit pas à vélo, où un trottoir ne protège personne', () => {
    render(<SafetyPanel safety={safety} surfaces={surfaces} segments={segments} distance={9100} sport="bike" />)
    expect(screen.queryByText('Rue calme, trottoir probable')).toBeNull()
  })
})
