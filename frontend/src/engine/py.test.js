import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  degrees,
  pyFixed,
  pyHypot,
  pyMax,
  pyMin,
  pyRound,
  pyRoundInt,
  pySum,
  pyfloordiv,
  pymod,
  radians,
  sortByKey,
} from './py'

/**
 * L'arithmétique de CPython, vérifiée contre CPython.
 *
 * `__fixtures__/numbers.json` est écrit par `backend/scripts/parity_numbers.py` :
 * des milliers d'opérations calculées par Python lui-même, rejouées ici. Tout
 * écart se compte au bit près — `Object.is` distingue même 0 de -0 — parce que
 * c'est à ce niveau que deux moteurs finissent par choisir deux itinéraires
 * différents.
 */

const N = JSON.parse(readFileSync(new URL('./__fixtures__/numbers.json', import.meta.url), 'utf8'))

const identique = (a, b) => Object.is(a, b) || (a === 0 && b === 0 && Object.is(a, b))

describe('le modulo', () => {
  it('suit CPython sur tous les cas', () => {
    const faux = N.mod.filter(([a, b, r]) => !Object.is(pymod(a, b), r))
    expect(faux.slice(0, 5)).toEqual([])
  })

  it('ramène un écart de cap négatif dans [0, 360[', () => {
    // C'est l'opération la plus fréquente du moteur, et celle où JavaScript
    // rend un résultat négatif là où Python n'en rend jamais.
    expect(pymod(-10, 360)).toBe(350)
  })
})

describe('la division entière', () => {
  it('suit CPython sur tous les cas', () => {
    const faux = N.floordiv.filter(([a, b, r]) => !Object.is(pyfloordiv(a, b), r))
    expect(faux.slice(0, 5)).toEqual([])
  })

  it('ne plancher pas un quotient arrondi par excès', () => {
    expect(pyfloordiv(1, 0.1)).toBe(9)
  })
})

describe("l'arrondi", () => {
  it('sans décimales, arrondit au pair comme CPython', () => {
    const faux = N.round_int.filter(([x, r]) => pyRoundInt(x) !== r)
    expect(faux.slice(0, 5)).toEqual([])
    expect(pyRoundInt(2.5)).toBe(2)
    expect(pyRoundInt(-2.5)).toBe(-2)
  })

  it('avec décimales, arrondit la valeur binaire exacte', () => {
    const faux = N.round.filter(([x, n, r]) => !identique(pyRound(x, n), r) && pyRound(x, n) !== r)
    expect(faux.slice(0, 5)).toEqual([])
  })

  it('formate comme `format(x, ".nf")`', () => {
    const faux = N.fixed.filter(([x, n, r]) => pyFixed(x, n) !== r)
    expect(faux.slice(0, 5)).toEqual([])
    // 0,125 est exactement représentable : c'est une vraie égalité, départagée au pair.
    expect(pyFixed(0.125, 2)).toBe('0.12')
  })
})

describe('la somme', () => {
  it('compense comme `sum()` depuis Python 3.12', () => {
    const faux = N.sum.filter(([values, r]) => !Object.is(pySum(values), r))
    expect(faux.slice(0, 3)).toEqual([])
  })

  it('ne perd pas un petit terme noyé entre deux grands', () => {
    expect(pySum([1e16, 1, -1e16])).toBe(1)
  })
})

describe('les conversions d’angle', () => {
  it('suivent CPython au bit près', () => {
    const faux = N.trig.filter((t) => !Object.is(radians(t.x), t.radians) || !Object.is(degrees(t.x), t.degrees))
    expect(faux.slice(0, 5)).toEqual([])
  })

  it('la racine carrée est exacte, par norme IEEE', () => {
    const faux = N.trig.filter((t) => !Object.is(Math.sqrt(Math.abs(t.x)), t.sqrt))
    expect(faux).toEqual([])
  })
})

describe("l'hypoténuse", () => {
  it('suit `math.hypot` de CPython au bit près', () => {
    // `Math.hypot` en diffère dans 40 % des cas : c'est ce qui a imposé de
    // reproduire l'algorithme de CPython plutôt que d'utiliser celui du langage.
    const faux = N.trig.filter((t) => !Object.is(pyHypot(t.x, 3.3), t.hypot))
    expect(faux.slice(0, 5)).toEqual([])
  })
})

describe('min, max et tri', () => {
  it('en cas d’égalité, le premier rencontré gagne', () => {
    const a = { v: 1 }
    const b = { v: 1 }
    const par = (xs) => xs.map((x) => x.v)
    expect(pyMax(par([a, b]))).toBe(1)
    expect(pyMin([3, 1, 1])).toBe(1)
    const tri = sortByKey([a, b], (x) => -x.v)
    expect(tri[0]).toBe(a)
  })
})
