/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import RouteStrip from './RouteStrip.jsx'

/**
 * La bande parcourue du doigt.
 *
 * Feuille dépliée, le point qu'elle allume sur la carte tombait sous la feuille.
 * Pendant le geste, la bande se marque `strip--live`, et la feuille s'efface
 * autour d'elle (`09-sheet.css`). Ce qui compte ici : la marque vient avec le
 * doigt et repart avec lui — y compris quand iOS reprend le geste, sans quoi la
 * feuille resterait vide.
 */

afterEach(cleanup)

const route = {
  distance_m: 2000,
  geometry: [
    [7.2, 47.9],
    [7.21, 47.9],
    [7.22, 47.9],
  ],
  segments: [{ length_m: 2000, level: 'safe' }],
  crossings: [],
  elevation_profile: null,
}

function afficher(onScrub) {
  const { container } = render(<RouteStrip route={route} onScrub={onScrub} />)
  const svg = container.querySelector('svg')
  // jsdom ne mesure rien : la bande fait ici 300 px de large.
  svg.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 60 })
  return { strip: container.querySelector('.strip'), svg }
}

describe('la bande parcourue du doigt', () => {
  it('se marque pendant le geste, et montre le point touché', () => {
    const onScrub = vi.fn()
    const { strip, svg } = afficher(onScrub)
    expect(strip.className).not.toContain('strip--live')

    fireEvent.touchStart(svg, { touches: [{ clientX: 300 }] })
    expect(strip.className).toContain('strip--live')
    expect(onScrub).toHaveBeenLastCalledWith([7.22, 47.9])

    fireEvent.touchEnd(svg)
    expect(strip.className).not.toContain('strip--live')
    expect(onScrub).toHaveBeenLastCalledWith(null)
  })

  it('rend la feuille quand iOS reprend le geste', () => {
    const onScrub = vi.fn()
    const { strip, svg } = afficher(onScrub)
    fireEvent.touchStart(svg, { touches: [{ clientX: 150 }] })
    fireEvent.touchCancel(svg)
    expect(strip.className).not.toContain('strip--live')
    expect(onScrub).toHaveBeenLastCalledWith(null)
  })
})
