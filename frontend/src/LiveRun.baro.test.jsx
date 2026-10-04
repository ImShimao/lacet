/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le dénivelé mesuré pendant la sortie.
 *
 * Il servait de juge au dénivelé annoncé, et c'était un mauvais juge :
 * l'altitude du GPS tremble de plusieurs mètres. Le baromètre de l'iPhone le
 * mesure désormais, et le GPS ne prend le relais que s'il se tait. Le module
 * natif est remplacé ici par un faux qui rend le cumul qu'on lui dicte.
 */

const altimeter = vi.hoisted(() => ({ reading: null, started: 0, stopped: 0 }))
let fixes = null
vi.mock('./position', () => ({
  watchPosition: (ok) => {
    fixes = ok
    return () => {
      fixes = null
    }
  },
}))
vi.mock('./voice', () => ({
  available: false,
  speak: vi.fn(),
  stop: vi.fn(),
  unlock: vi.fn(),
  setEnabled: vi.fn(),
  phrase: () => '',
}))
vi.mock('./platform', () => ({ isNative: () => true }))
vi.mock('./native', () => ({
  startAltimeter: async () => {
    altimeter.started += 1
    return { available: Boolean(altimeter.reading) }
  },
  readAltimeter: async () => altimeter.reading,
  stopAltimeter: async () => {
    altimeter.stopped += 1
    return altimeter.reading
  },
  keepScreenOn: async () => {},
  allowScreenOff: async () => {},
  startLiveActivity: async () => null,
  updateLiveActivity: async () => null,
  endLiveActivity: async () => null,
  openExternal: async () => ({ completed: true }),
}))
vi.mock('./engine/client', () => ({ detourOnDevice: vi.fn() }))
vi.mock('./runState', () => ({ saveRun: vi.fn(), clearRun: vi.fn() }))

const LiveRun = (await import('./LiveRun.jsx')).default

const [lon, lat] = [7.2, 47.9]
const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
const est = (m) => [lon + m / kx, lat]

describe('le dénivelé mesuré', () => {
  let now = null
  beforeEach(() => {
    fixes = null
    altimeter.reading = null
    altimeter.started = 0
    altimeter.stopped = 0
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    now = vi.spyOn(Date, 'now')
  })
  afterEach(() => {
    cleanup()
    now.mockRestore()
    vi.useRealTimers()
  })

  /** Huit cents mètres en montée régulière, puis « Terminer ». */
  async function courir({ resuming = null, altitude = (m) => 200 + m * 0.05 } = {}) {
    const onStop = vi.fn()
    const t0 = 1_700_000_000_000
    now.mockReturnValue(t0)
    render(
      <LiveRun
        route={null}
        request={null}
        sport="run"
        stage={null}
        resuming={resuming}
        onPosition={() => {}}
        onStop={onStop}
      />,
    )
    for (let m = 0; m <= 800; m += 10) {
      const t = t0 + m * 300
      now.mockReturnValue(t)
      await act(async () => {
        fixes({
          coords: { longitude: est(m)[0], latitude: lat, accuracy: 5, altitude: altitude(m), altitudeAccuracy: 4, speed: 3 },
          timestamp: t,
        })
        await Promise.resolve()
      })
    }
    // Le cumul natif est relu de loin en loin.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    await act(async () => {
      screen.getByLabelText('Mettre en pause').click()
    })
    await act(async () => {
      screen.getByText('Terminer').click()
    })
    return onStop.mock.calls[0][0]
  }

  it('prend le baromètre quand il répond', async () => {
    altimeter.reading = { ascent: 41.6, descent: 3.2, samples: 240 }
    const bilan = await courir()
    expect(altimeter.started).toBe(1)
    expect(bilan.ascent).toBe(42)
    expect(bilan.ascentSource).toBe('baro')
  })

  it('se rabat sur le GPS quand le baromètre se tait', async () => {
    // Accès refusé : le module ne relève rien.
    altimeter.reading = { ascent: 0, descent: 0, samples: 0, error: 'refusé' }
    const bilan = await courir()
    expect(bilan.ascentSource).toBe('gps')
    // Quarante mètres de montée régulière, lus au GPS.
    expect(bilan.ascent).toBeGreaterThan(30)
    expect(bilan.ascent).toBeLessThan(45)
  })

  it('ne lit pas l’altitude d’un relevé que le GPS donne pour incertaine', async () => {
    altimeter.reading = null
    // Une altitude qui saute de vingt mètres, annoncée à ±40 m : ignorée.
    const onStop = vi.fn()
    const t0 = 1_700_000_000_000
    now.mockReturnValue(t0)
    render(<LiveRun route={null} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />)
    for (let m = 0; m <= 400; m += 10) {
      const t = t0 + m * 300
      now.mockReturnValue(t)
      await act(async () => {
        fixes({
          coords: { longitude: est(m)[0], latitude: lat, accuracy: 5, altitude: 200 + (m % 20 ? 20 : 0), altitudeAccuracy: 40, speed: 3 },
          timestamp: t,
        })
        await Promise.resolve()
      })
    }
    await act(async () => {
      screen.getByLabelText('Mettre en pause').click()
    })
    await act(async () => {
      screen.getByText('Terminer').click()
    })
    expect(onStop.mock.calls[0][0].ascent).toBe(0)
  })

  it('garde les côtes d’avant une coupure', async () => {
    altimeter.reading = { ascent: 12.2, descent: 0, samples: 200 }
    const bilan = await courir({
      resuming: { covered: 3000, elapsed: 900, trail: [est(0), est(10)], splits: [], ascent: 30, ascentSource: 'baro' },
    })
    expect(bilan.ascent).toBe(42)
    expect(bilan.ascentSource).toBe('baro')
  })
})
