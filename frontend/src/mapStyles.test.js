import { describe, expect, it } from 'vitest'
import { frenchLabels, tintNight } from './mapStyles'

// La clarté se lit dans la troisième composante de `hsla(h, s%, l%, a)`.
const lightness = (hsla) => Number(/,\s*([\d.]+)%,\s*[\d.]+\)$/.exec(hsla)[1])

describe('tintNight', () => {
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0e0e0e' } },
      { id: 'water', type: 'fill', paint: { 'fill-color': '#2C353C', 'fill-opacity': 0.8 } },
      {
        id: 'road',
        type: 'line',
        paint: { 'line-color': { stops: [[5, '#1a1a1a'], [12, '#232323']] }, 'line-width': 2 },
      },
      {
        id: 'expr',
        type: 'line',
        paint: {
          'line-color': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            'rgba(65, 71, 88, 0.5)',
            10,
            'transparent',
          ],
        },
      },
      {
        id: 'label',
        type: 'symbol',
        layout: { 'text-field': '#ffffff' },
        paint: { 'text-color': '#666' },
      },
      { id: 'no-paint', type: 'symbol', layout: {} },
    ],
  }
  const out = tintNight(style, { hue: 262, water: 244 })
  const paint = (id) => out.layers.find((l) => l.id === id).paint

  it('garde la clarté de chaque couleur et ne change que la teinte', () => {
    expect(paint('background')['background-color']).toMatch(/^hsla\(262,/)
    expect(lightness(paint('background')['background-color'])).toBeCloseTo(5.5, 0)
    expect(lightness(paint('label')['text-color'])).toBeCloseTo(40, 0)
  })

  it("donne à l'eau sa propre teinte", () => {
    expect(paint('water')['fill-color']).toMatch(/^hsla\(244,/)
  })

  it('traverse les paliers et les expressions sans toucher au reste', () => {
    const stops = paint('road')['line-color'].stops
    expect(stops[0][0]).toBe(5)
    expect(stops[1][1]).toMatch(/^hsla\(262,/)

    const expr = paint('expr')['line-color']
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']])
    expect(expr[4]).toMatch(/, 0\.5\)$/) // l'opacité est conservée
    expect(expr[6]).toBe('transparent')
  })

  it('ne touche ni aux propriétés non colorées ni à la mise en page', () => {
    expect(paint('water')['fill-opacity']).toBe(0.8)
    expect(paint('road')['line-width']).toBe(2)
    expect(out.layers.find((l) => l.id === 'label').layout['text-field']).toBe('#ffffff')
    expect(out.layers.find((l) => l.id === 'no-paint')).toBe(style.layers[5])
  })

  it('rend une copie sans modifier le style reçu', () => {
    expect(style.layers[0].paint['background-color']).toBe('#0e0e0e')
    expect(out).not.toBe(style)
  })
})

describe('frenchLabels', () => {
  const FR = ['coalesce', ['get', 'name:fr'], ['get', 'name']]
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: 'city', type: 'symbol', layout: { 'text-field': '{name_en}', 'text-size': 12 } },
      { id: 'suburb', type: 'symbol', layout: { 'text-field': { stops: [[8, '{name_en}'], [13, '{name}']] } } },
      { id: 'street', type: 'symbol', layout: { 'text-field': '{name}' } },
      { id: 'number', type: 'symbol', layout: { 'text-field': '{housenumber}' } },
      { id: 'peak', type: 'symbol', layout: { 'text-field': '{name}\n{ele} m' } },
      { id: 'fill', type: 'fill', paint: { 'fill-color': '#000' } },
    ],
  }
  const out = frenchLabels(style)
  const field = (id) => out.layers.find((l) => l.id === id).layout?.['text-field']

  it('préfère le nom français, puis le nom local', () => {
    expect(field('city')).toEqual(FR)
    expect(field('street')).toEqual(FR)
    expect(field('suburb')).toEqual(FR)
  })

  it('garde le reste de la mise en page', () => {
    expect(out.layers[0].layout['text-size']).toBe(12)
  })

  it('laisse les libellés qui ne sont pas un simple nom', () => {
    expect(field('number')).toBe('{housenumber}')
    expect(field('peak')).toBe('{name}\n{ele} m')
    expect(out.layers.find((l) => l.id === 'fill')).toBe(style.layers[5])
  })
})

