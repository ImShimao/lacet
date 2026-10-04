import { describe, expect, it } from 'vitest'
import { DEFAULTS } from './FiltersSheet.jsx'
import { toRequest } from './request'

const start = { lat: 47.9, lon: 7.2 }

describe('la demande au moteur', () => {
  it('« Sûr » contourne de lui-même les grands axes', () => {
    // L'ancienne case « Grands axes » disait la même chose que « Sûr » : elle
    // a disparu, et « Sûr » en porte l'effet.
    const body = toRequest({ ...DEFAULTS, safety: 'safe', avoid: [] }, start)
    expect(body.avoid).toEqual(['busy'])
  })

  it('« Standard » ne contourne rien qu’on n’ait coché', () => {
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: [] }, start).avoid).toBeUndefined()
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: ['steps'] }, start).avoid).toEqual(['steps'])
  })

  it('oublie une case « Grands axes » restée cochée dans d’anciens réglages', () => {
    // Elle n'a plus d'interrupteur pour la décocher : en « Standard », elle
    // pèserait sans qu'on puisse savoir pourquoi.
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: ['busy', 'unlit'] }, start).avoid).toEqual(['unlit'])
    expect(toRequest({ ...DEFAULTS, safety: 'safe', avoid: ['busy', 'steps'] }, start).avoid).toEqual(['steps', 'busy'])
  })
})
