/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ce que l'écran montre de Strava, selon l'état de la connexion — et l'envoi
 * automatique, qui doit partir une fois, et une seule.
 */

let etat
const upload = vi.fn()
vi.mock('./strava', () => ({
  status: () => etat,
  subscribe: () => () => {},
  connect: vi.fn(),
  disconnect: vi.fn(),
  setAuto: vi.fn(),
  upload: (...args) => upload(...args),
  activityUrl: (id) => `https://www.strava.com/activities/${id}`,
}))

const { StravaButton, StravaSetting } = await import('./Strava.jsx')

const SORTIE = { name: 'Boucle', ranAt: '2026-09-30T08:00:00.000Z', track: [[2, 48], [2.001, 48]] }

beforeEach(() => {
  upload.mockReset()
})
afterEach(() => cleanup())

describe('le réglage', () => {
  it('dit ce qu’il faut quand l’app n’a pas d’application Strava', () => {
    etat = { configured: false, connected: false }
    render(<StravaSetting />)
    expect(screen.getByText(/STRAVA_CLIENT_ID/)).toBeTruthy()
  })

  it('propose de se connecter', () => {
    etat = { configured: true, connected: false, error: null }
    render(<StravaSetting />)
    expect(screen.getByRole('button', { name: /Connecter Strava/ })).toBeTruthy()
  })

  it('montre le compte et le choix de l’envoi', () => {
    etat = { configured: true, connected: true, athlete: { name: 'Camille Martin' }, auto: true }
    render(<StravaSetting />)
    expect(screen.getByText('Camille Martin')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Envoi automatique' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('le bouton d’envoi', () => {
  it('n’apparaît pas sans connexion', () => {
    etat = { configured: true, connected: false }
    const { container } = render(<StravaButton entry={SORTIE} />)
    expect(container.textContent).toBe('')
  })

  it('part tout seul sur l’écran de fin, une seule fois, et le garde', async () => {
    etat = { configured: true, connected: true, auto: true }
    upload.mockResolvedValue({ activityId: 42 })
    const onSent = vi.fn()
    const { rerender } = render(<StravaButton entry={SORTIE} auto onSent={onSent} />)
    await act(async () => {})
    rerender(<StravaButton entry={SORTIE} auto onSent={onSent} />)
    await act(async () => {})
    expect(upload).toHaveBeenCalledTimes(1)
    expect(onSent).toHaveBeenCalledWith(42)
    expect(screen.getByRole('button', { name: /Sur Strava — voir/ })).toBeTruthy()
  })

  it('attend qu’on le demande hors de l’envoi automatique', async () => {
    etat = { configured: true, connected: true, auto: false }
    render(<StravaButton entry={SORTIE} auto />)
    await act(async () => {})
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Envoyer à Strava/ })).toBeTruthy()
  })

  it('présente une sortie déjà envoyée comme telle, pas comme une panne', async () => {
    etat = { configured: true, connected: true, auto: false }
    upload.mockRejectedValue(Object.assign(new Error('Cette sortie est déjà sur Strava.'), { duplicate: 777 }))
    const onSent = vi.fn()
    render(<StravaButton entry={SORTIE} onSent={onSent} />)
    await act(async () => {
      screen.getByRole('button', { name: /Envoyer à Strava/ }).click()
    })
    expect(onSent).toHaveBeenCalledWith(777)
    expect(screen.getByRole('button', { name: /Sur Strava/ })).toBeTruthy()
  })
})
