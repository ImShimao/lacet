/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { QUOTA_BYTES, dropTracks, forgetTrim, load, save, usage } from './storage'

/**
 * Savoir ce qu'on garde, et l'apprendre quand ça déborde.
 *
 * L'app sacrifie des sorties anciennes quand le navigateur refuse d'écrire.
 * C'est défendable ; le faire sans que personne l'apprenne ne l'est pas. Ces
 * tests tiennent les deux bouts : la mesure doit être juste, et l'élagage doit
 * laisser une trace lisible.
 */

const sortie = (i, avecTrace = true) => ({
  id: 'h' + i,
  name: 'Boucle ' + i,
  ranAt: new Date(2026, 8, 1 + i).toISOString(),
  actual_distance_m: 10_000,
  actual_duration_s: 3600,
  track: avecTrace ? Array.from({ length: 200 }, (_, k) => [7.2 + k / 1e4, 47.9]) : null,
})

describe('le poids de ce qui est gardé', () => {
  beforeEach(() => localStorage.clear())

  it('compte deux octets par caractère, comme le navigateur', () => {
    save({ history: [sortie(1)] })
    const brut = localStorage.getItem('lacet.v1').length
    expect(usage().bytes).toBe(brut * 2)
    expect(usage().quota).toBe(QUOTA_BYTES)
  })

  it('dit de quoi le poids est fait', () => {
    save({ history: [sortie(1), sortie(2, false)], favorites: [{ id: 'f', geometry: [] }] })
    const u = usage()
    expect(u.counts).toEqual({ favorites: 1, history: 2, traces: 1 })
    // Les traces pèsent l'essentiel d'une sortie enregistrée.
    expect(u.parts.traces).toBeGreaterThan(u.parts.history / 2)
  })

  it('allège sans perdre un chiffre', () => {
    save({ history: [sortie(1), sortie(2)] })
    const avant = usage()
    const libere = dropTracks()
    const apres = usage()
    expect(libere).toBeGreaterThan(0)
    expect(apres.bytes).toBeLessThan(avant.bytes)
    expect(apres.counts.traces).toBe(0)
    // Ce qui compte pour la personne est toujours là.
    expect(load().history).toHaveLength(2)
    expect(load().history[0].actual_distance_m).toBe(10_000)
  })

  it('laisse une trace lisible quand il a fallu élaguer', () => {
    // Un stockage qui refuse tout ce qui dépasse une taille : le navigateur
    // plein, en somme.
    const donnees = new Map()
    const petit = {
      getItem: (k) => donnees.get(k) ?? null,
      setItem: (k, v) => {
        if (v.length > 25_000) throw new DOMException('QuotaExceededError')
        donnees.set(k, v)
      },
      removeItem: (k) => donnees.delete(k),
      clear: () => donnees.clear(),
    }
    const vrai = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: petit, configurable: true })
    try {
      save({ history: Array.from({ length: 40 }, (_, i) => sortie(i)) })
      const u = usage()
      expect(u.trimmed).not.toBeNull()
      expect(u.trimmed.from).toBe(40)
      expect(u.trimmed.to).toBeLessThan(40)
      // Les plus récentes sont celles qui restent.
      expect(load().history[0].id).toBe('h0')
      forgetTrim()
      expect(usage().trimmed).toBeNull()

      // Et quand même l'élagage ne suffit pas, il n'y a plus de disque où
      // noter quoi que ce soit : l'échec se garde alors en mémoire, sans quoi
      // l'écran laisserait croire que tout est enregistré.
      save({ history: Array.from({ length: 40 }, (_, i) => sortie(i)), favorites: [{ gros: 'x'.repeat(30_000) }] })
      expect(usage().refusedAt).not.toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: vrai, configurable: true })
    }
  })
})
