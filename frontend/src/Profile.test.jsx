/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Le profil : le pseudo gardé à la frappe, la taille réglée comme le poids, et
 * le recadrage qui ne laisse jamais de bande vide dans le rond.
 */

vi.mock('./platform', () => ({ isNative: () => false, haptic: vi.fn() }))

const { ProfileSettings, clampOffset } = await import('./Profile.jsx')
const { load } = await import('./storage')

describe('le profil', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('garde le pseudo et règle la taille', () => {
    const onProfile = vi.fn()
    render(<ProfileSettings params={{ weight_kg: 70 }} onProfile={onProfile} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Pseudo' }), { target: { value: 'Shim' } })
    expect(load().profileName).toBe('Shim')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Augmenter taille' }))
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Augmenter taille' }))
    expect(onProfile).toHaveBeenCalledWith({ height_cm: 171 })
    // Sans photo, rien à retirer.
    expect(screen.queryByRole('button', { name: /^Retirer la photo/ })).toBeNull()
  })

  it('garde la photo sous tout le rond', () => {
    // Une image de 520 × 390 px dans un rond de 260 : ni trop à droite, ni trop haut.
    expect(clampOffset(40, -500, 520, 390)).toEqual({ x: 0, y: -130 })
    expect(clampOffset(-100, -60, 520, 390)).toEqual({ x: -100, y: -60 })
  })
})
