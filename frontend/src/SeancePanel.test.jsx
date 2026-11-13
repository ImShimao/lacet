/** @vitest-environment jsdom */
/**
 * Le réglage du fractionné : un champ vidé puis ressaisi garde ce qu'on tape
 * (il affichait « 0 », puis « 08 »), et la séance lancée est bornée.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SeancePanel from './SeancePanel.jsx'
import { DEFAULT_SEANCE } from './seanceSpec'

describe('SeancePanel', () => {
  it('laisse vider puis ressaisir un champ, et lance la séance réglée', () => {
    const onStart = vi.fn()
    render(<SeancePanel spec={DEFAULT_SEANCE} onStart={onStart} />)
    const reps = screen.getByLabelText('Répétitions')
    fireEvent.change(reps, { target: { value: '' } })
    expect(reps.value).toBe('')
    fireEvent.change(reps, { target: { value: '8' } })
    expect(reps.value).toBe('8')
    fireEvent.change(screen.getByLabelText('Récupération, valeur'), { target: { value: '1.5' } })
    expect(screen.getByText('8 × 400 m, récup 1 min 30 s')).toBeTruthy()
    fireEvent.click(screen.getByText('Lancer le fractionné'))
    expect(onStart).toHaveBeenCalledWith({ reps: 8, effort: { unit: 'm', value: 400 }, rest: { unit: 's', value: 90 } })
  })
})
