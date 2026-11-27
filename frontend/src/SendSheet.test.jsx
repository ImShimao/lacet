/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SendSheet from './SendSheet.jsx'

/**
 * « Envoyer cette boucle » : l'image part par son propre geste, le GPX par le
 * sien, et la ligne de l'image n'apparaît que si l'écran sait la dessiner.
 */
afterEach(cleanup)

describe('envoyer une boucle', () => {
  it('partage une image ou le GPX, chacun par sa ligne', () => {
    const onSend = vi.fn()
    const onImage = vi.fn()
    render(<SendSheet onSend={onSend} onImage={onImage} />)
    fireEvent.click(screen.getByRole('button', { name: /Une image/ }))
    expect(onImage).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Fichier GPX/ }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('n’offre pas l’image sans quoi la dessiner', () => {
    render(<SendSheet onSend={() => {}} />)
    expect(screen.queryByRole('button', { name: /Une image/ })).toBeNull()
  })
})
