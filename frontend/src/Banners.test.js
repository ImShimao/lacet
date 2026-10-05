import { describe, expect, it } from 'vitest'
import { ago } from './Banners.jsx'

/** Quand la sortie interrompue s'est arrêtée — dit comme on le dirait. */
describe('ago', () => {
  it('dit « à l’instant » au relancement immédiat, plutôt que « 0 min »', () => {
    expect(ago(20_000)).toBe("à l'instant")
  })

  it('compte en minutes, puis en heures', () => {
    expect(ago(25 * 60_000)).toBe('il y a 25 min')
    expect(ago(9 * 3_600_000)).toBe('il y a 9 h')
  })
})
