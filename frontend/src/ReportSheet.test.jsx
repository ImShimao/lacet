/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Un signalement de Mon compte s'ouvre sur sa carte, et se retire de là :
 * la liste ne donnait que des coordonnées, et l'on retirait à l'aveugle.
 */

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn(), haptic: vi.fn() }))
// Pas de WebGL sous jsdom : une carte factice qui retient où elle est centrée.
const centres = []
vi.mock('maplibre-gl', () => {
  class Map {
    constructor(options) { centres.push(options.center) }
    setStyle() {}
    on() {}
    remove() {}
  }
  class Marker {
    setLngLat() { return this }
    addTo() { return this }
  }
  return { default: { Map, Marker } }
})

const Account = (await import('./Account.jsx')).default
const { DEFAULTS } = await import('./FiltersSheet.jsx')
const { activeReports, addReport } = await import('./reports')

describe('les signalements de Mon compte', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('montre un signalement sur sa carte, et le retire de là', async () => {
    addReport({ lon: 7.2105, lat: 47.9097, kind: 'danger' })
    render(<Account page="zones" onPage={() => {}} params={DEFAULTS} poiPrefs={{}} onProfile={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /^Danger.*voir sur la carte/ }))
    expect(await screen.findByRole('dialog', { name: 'Danger' })).toBeTruthy()
    expect(centres.at(-1)).toEqual([7.2105, 47.9097])

    fireEvent.click(screen.getByRole('button', { name: /^Retirer ce signalement/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(activeReports()).toEqual([])
    expect(screen.getByText(/^Rien de signalé/)).toBeTruthy()
  })
})
