/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Un signalement ou une zone de Mon compte s'ouvre sur sa carte, et se retire
 * de là : la liste ne donnait qu'un nom ou une date, et l'on retirait à l'aveugle.
 */

vi.mock('./platform', () => ({ isNative: () => false, saveTextFile: vi.fn(), haptic: vi.fn() }))
// Pas de WebGL sous jsdom : une carte factice qui retient ce qu'elle cadre.
const cadres = []
vi.mock('maplibre-gl', () => {
  class Map {
    constructor(options) { cadres.push(options.bounds) }
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
const { addZone, listZones } = await import('./zones')

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
    // Le cadre entoure le point : le cercle de vingt-cinq mètres, pas le monde.
    const [[w, s], [e, n]] = cadres.at(-1)
    expect(w < 7.2105 && 7.2105 < e && s < 47.9097 && 47.9097 < n).toBe(true)
    expect(e - w).toBeLessThan(0.001)

    fireEvent.click(screen.getByRole('button', { name: /^Retirer ce signalement/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(activeReports()).toEqual([])
    expect(screen.getByText(/^Rien de signalé/)).toBeTruthy()
  })

  it('montre une zone sur sa carte, et la supprime de là', async () => {
    addZone({ lon: 7.2, lat: 47.9, radius_m: 150, name: 'Zone dangereuse' })
    let zones = listZones()
    const onZones = (next) => { zones = next }
    render(<Account page="zones" onPage={() => {}} params={DEFAULTS} poiPrefs={{}} onProfile={() => {}} zones={zones} onZones={onZones} />)

    fireEvent.click(screen.getByRole('button', { name: 'Voir Zone dangereuse sur la carte' }))
    expect(await screen.findByRole('dialog', { name: 'Zone dangereuse' })).toBeTruthy()
    const [[w], [e]] = cadres.at(-1)
    expect(w).toBeLessThan(7.2)
    expect(e).toBeGreaterThan(7.2)

    fireEvent.click(screen.getByRole('button', { name: /^Supprimer cette zone/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(zones).toEqual([])
  })
})
