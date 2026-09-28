/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La fin d'une sortie, et le signalement — les deux gestes qu'on ne fait pas.
 *
 * Le premier parce qu'on arrive essoufflé et qu'on oublie d'appuyer ; le second
 * parce qu'on ne va pas sortir le téléphone pour désigner une barrière. Ce sont
 * donc les deux qui doivent marcher sans qu'on y pense, et c'est ce qui se
 * vérifie ici : un GPS de laboratoire fait le tour de la boucle, et l'app doit
 * terminer d'elle-même en repassant sur le départ.
 */

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
vi.mock('./platform', () => ({ isNative: () => false }))
vi.mock('./engine/client', () => ({ detourOnDevice: vi.fn() }))
vi.mock('./runState', () => ({ saveRun: vi.fn(), clearRun: vi.fn() }))

const LiveRun = (await import('./LiveRun.jsx')).default
const { activeReports } = await import('./reports')

/** Un carré de cent mètres de côté, refermé sur son départ. */
function carre(lon = 7.2, lat = 47.9, coteM = 100) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const dx = coteM / kx
  const dy = coteM / 110_540
  const coins = [
    [lon, lat],
    [lon + dx, lat],
    [lon + dx, lat + dy],
    [lon, lat + dy],
    [lon, lat],
  ]
  // Un point tous les vingt mètres : ce que verrait un vrai relevé.
  const out = []
  for (let i = 1; i < coins.length; i += 1) {
    for (let t = 0; t < 5; t += 1) {
      out.push([
        coins[i - 1][0] + ((coins[i][0] - coins[i - 1][0]) * t) / 5,
        coins[i - 1][1] + ((coins[i][1] - coins[i - 1][1]) * t) / 5,
      ])
    }
  }
  out.push([lon, lat])
  return out
}

const geometry = carre()
const boucle = {
  id: 'test',
  name: 'Le tour du pâté',
  distance_m: 400,
  geometry,
  instructions: [],
  crossings: [],
  segments: [],
  elevation_profile: null,
}

/** Envoie un relevé GPS, comme le ferait le téléphone. */
async function relever(point, t) {
  await act(async () => {
    fixes({ coords: { longitude: point[0], latitude: point[1], accuracy: 6, altitude: null, speed: 3 }, timestamp: t })
    await Promise.resolve()
  })
}

describe('la sortie guidée', () => {
  beforeEach(() => {
    localStorage.clear()
    fixes = null
  })
  afterEach(() => {
    cleanup()
  })

  it("se termine d'elle-même en revenant au départ", async () => {
    const onStop = vi.fn()
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />,
    )
    expect(fixes).not.toBeNull()

    // Le tour complet, deux secondes entre chaque point.
    let t = Date.now()
    for (const point of geometry) {
      t += 2000
      await relever(point, t)
    }
    // Arrivé sur le départ, il faut encore le relevé qui s'en éloigne — c'est
    // lui qui dit que le point le plus proche est passé.
    expect(onStop).not.toHaveBeenCalled()
    t += 2000
    await relever([geometry[1][0], geometry[1][1]], t)

    expect(onStop).toHaveBeenCalledTimes(1)
    const bilan = onStop.mock.calls[0][0]
    // Ce qui est enregistré est bien la sortie faite : le tour du carré.
    expect(bilan.distance).toBeGreaterThan(350)
    expect(bilan.distance).toBeLessThan(500)
  })

  it('ne se termine pas au milieu du tour', async () => {
    const onStop = vi.fn()
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={onStop} />,
    )
    let t = Date.now()
    for (const point of geometry.slice(0, 8)) {
      t += 2000
      await relever(point, t)
    }
    // Retour sur ses pas jusqu'au départ, sans avoir fait la boucle : on est
    // sur le point d'arrivée, mais la sortie n'est pas finie.
    for (const point of geometry.slice(0, 8).reverse()) {
      t += 2000
      await relever(point, t)
    }
    expect(onStop).not.toHaveBeenCalled()
  })

  it('garde le signalement fait en courant', async () => {
    render(
      <LiveRun route={boucle} request={null} sport="run" stage={null} onPosition={() => {}} onStop={vi.fn()} />,
    )
    await relever(geometry[2], Date.now())

    await act(async () => {
      screen.getByText('Signaler un problème ici').click()
    })
    await act(async () => {
      screen.getByText('Passage fermé').click()
    })

    const gardes = activeReports()
    expect(gardes).toHaveLength(1)
    expect(gardes[0].kind).toBe('closed')
    // À l'endroit où l'on se trouvait, pas ailleurs.
    expect(gardes[0].lon).toBeCloseTo(geometry[2][0], 5)
  })
})
