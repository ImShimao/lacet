/** @vitest-environment jsdom */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
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

  it('un doigt levé au milieu d\'un pincement ne fait pas tomber l\'app', async () => {
    // Plantage vu sur l'iPhone (1.1.21) : React jouait la mise à jour du zoom
    // après le `pointerup`, qui avait déjà effacé le geste en cours.
    vi.stubGlobal('Image', class {
      naturalWidth = 520
      naturalHeight = 390
      set src(_) { queueMicrotask(() => this.onload()) }
    })
    const { PhotoCropper } = await import('./Profile.jsx')
    render(<PhotoCropper src="blob:photo" onCancel={() => {}} onDone={() => {}} />)
    await screen.findByRole('button', { name: /Valider/ })
    await act(async () => {})
    const area = document.querySelector('.crop__view')
    const pointer = (type, id, x) => {
      const event = createEvent[type](area)
      Object.assign(event, { pointerId: id, clientX: x, clientY: 100 })
      fireEvent(area, event)
    }
    pointer('pointerDown', 1, 100)
    pointer('pointerDown', 2, 140)
    // Le premier mouvement à deux doigts fixe l'écart de départ.
    pointer('pointerMove', 2, 140)
    // Le mouvement et la levée dans le même lot : la mise à jour du zoom ne
    // se joue qu'après la levée, comme sous le doigt.
    act(() => {
      pointer('pointerMove', 2, 200)
      pointer('pointerUp', 2, 200)
    })
    expect(screen.getByRole('slider', { name: 'Zoom' }).value).not.toBe('1')
    vi.unstubAllGlobals()
  })

  it('garde la photo sous tout le rond', () => {
    // Une image de 520 × 390 px dans un rond de 260 : ni trop à droite, ni trop haut.
    expect(clampOffset(40, -500, 520, 390)).toEqual({ x: 0, y: -130 })
    expect(clampOffset(-100, -60, 520, 390)).toEqual({ x: -100, y: -60 })
  })
})
