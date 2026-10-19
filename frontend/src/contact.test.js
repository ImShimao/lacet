/** @vitest-environment jsdom */
/** Les SMS du départ et du retour disent où, combien, et quand rentrer — sans rien inventer. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ openExternal: vi.fn(), shareText: vi.fn() }))
vi.mock('./native', () => native)

const { announceDeparture, announcing, arrivalText, departureText } = await import('./contact')
const { save } = await import('./storage')

describe('prévenir un proche', () => {
  beforeEach(() => localStorage.clear())

  it("annonce la boucle, d'où elle part et l'heure du retour", () => {
    const route = { geometry: [[7.2289, 47.8915], [7.23, 47.9]], distance_m: 10_240, duration_s: 3600 }
    const now = new Date(2026, 9, 19, 18, 40).getTime()
    const text = departureText({ route, sport: 'run', now })
    expect(text).toContain('Je pars courir 10,2 km depuis ici : https://www.google.com/maps?q=47.89150,7.22890.')
    expect(text).toContain('Retour prévu vers 19:40.')
  })

  it("à vélo, ou sans parcours, n'invente pas d'heure", () => {
    const text = departureText({ sport: 'bike', from: [7.2, 47.9] })
    expect(text).toMatch(/^Je pars rouler depuis ici : https:/)
    expect(text).not.toMatch(/Retour prévu/)
  })

  it('dit le retour avec ce qui a été fait', () => {
    expect(arrivalText({ actual_distance_m: 10_240, actual_duration_s: 3500 })).toBe(
      'De retour de ma sortie : 10,2 km en 58 min. Tout va bien.',
    )
  })

  it("ne s'annonce que réglé, et avec un numéro", () => {
    save({ notifyContact: true })
    expect(announcing()).toBe(false)
    save({ emergencyContact: '06 12 34 56 78' })
    expect(announcing()).toBe(true)
  })
})

describe('le départ annoncé', () => {
  it('attend le retour dans l’app avant de rendre la main', async () => {
    vi.useFakeTimers()
    native.openExternal.mockResolvedValue({ completed: true })
    save({ emergencyContact: '06 12 34 56 78', notifyContact: true })
    let hidden = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (hidden ? 'hidden' : 'visible'))
    let done = false
    announceDeparture({ sport: 'run', from: [7.2, 47.9] }).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(5000)
    expect(native.openExternal.mock.calls[0][0]).toMatch(/^sms:0612345678\?&body=Je%20pars%20courir/)
    expect(done).toBe(false)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})
