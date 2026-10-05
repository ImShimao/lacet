/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le bouton SOS : il ne doit partir que sur un appui maintenu, et quand il part,
 * il doit aboutir. Les deux échecs sont silencieux — une alerte partie d'un
 * frôlement, ou une alerte voulue qui n'ouvre rien —, et c'est un bouton qu'on
 * presse le jour où quelque chose ne va pas.
 */

const native = vi.hoisted(() => ({ openExternal: vi.fn(), shareText: vi.fn() }))
vi.mock('./native', () => native)

const SosButton = (await import('./SosButton.jsx')).default
const { save } = await import('./storage')

const here = { current: [7.35, 48.08] }
const appuyer = () => fireEvent.pointerDown(screen.getByRole('button', { name: /Alerter un proche/ }))
const lacher = () => fireEvent.pointerUp(screen.getByRole('button', { name: /Alerter un proche/ }))

describe('le bouton SOS', () => {
  beforeEach(() => {
    localStorage.clear()
    save({ emergencyContact: '06 12 34 56 78' })
    native.openExternal.mockReset().mockResolvedValue({ completed: true })
    native.shareText.mockReset().mockResolvedValue(undefined)
    vi.useFakeTimers()
    render(<SosButton position={here} distance={5200} elapsed={1800} />)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('part sur un appui maintenu, vers Messages', async () => {
    appuyer()
    await act(async () => vi.advanceTimersByTime(1000))
    await vi.waitFor(() => expect(native.openExternal).toHaveBeenCalledTimes(1))
    expect(native.openExternal.mock.calls[0][0]).toMatch(/^sms:0612345678\?&body=/)
  })

  it('ne part pas quand deux doigts se posent puis se lèvent', async () => {
    appuyer()
    appuyer()
    lacher()
    await act(async () => vi.advanceTimersByTime(2000))
    expect(native.openExternal).not.toHaveBeenCalled()
  })

  it('passe par la feuille de partage quand Messages ne s’ouvre pas', async () => {
    native.openExternal.mockResolvedValue({ completed: false })
    appuyer()
    await act(async () => vi.advanceTimersByTime(1000))
    await vi.waitFor(() => expect(native.shareText).toHaveBeenCalledTimes(1))
    expect(native.shareText.mock.calls[0][1]).toMatch(/besoin d'aide.*48\.08000,7\.35000/)
  })
})
