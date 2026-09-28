import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRun, loadRun, saveRun } from './runState'

/**
 * La sortie en cours, gardée sur le disque.
 *
 * C'est la seule donnée de l'app qu'on ne peut pas refaire : une app fermée par
 * iOS en pleine sortie emportait tout. On la réécrit donc régulièrement, et on
 * ne propose de la reprendre que tant que ça a un sens.
 */

function fauxStockage() {
  const donnees = new Map()
  return {
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => donnees.set(k, v),
    removeItem: (k) => donnees.delete(k),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fauxStockage())
})

const sortie = { covered: 3200, elapsed: 1080, trail: [[7.2, 47.9]], free: true, sport: 'run' }

describe('la sortie interrompue', () => {
  it('se retrouve telle qu’on l’a laissée', () => {
    saveRun(sortie)
    expect(loadRun()).toMatchObject({ covered: 3200, elapsed: 1080 })
  })

  it('ne se propose plus le lendemain', () => {
    saveRun(sortie)
    expect(loadRun(Date.now() + 13 * 3_600_000)).toBeNull()
  })

  it('ignore un démarrage par erreur', () => {
    saveRun({ ...sortie, covered: 40 })
    expect(loadRun()).toBeNull()
  })

  it('s’oublie quand la sortie se termine', () => {
    saveRun(sortie)
    clearRun()
    expect(loadRun()).toBeNull()
  })

  it('n’écrit pas dans le magasin des favoris et des sorties', () => {
    // C'est le point de toute la séparation : écrire la sortie en cours ne doit
    // plus relire ni réécrire l'historique, qui pèse mille fois plus lourd et
    // que le navigateur peut refuser.
    localStorage.setItem('lacet.v1', JSON.stringify({ favorites: [], history: [{ ranAt: 'hier' }] }))
    const avant = localStorage.getItem('lacet.v1')
    saveRun(sortie)
    expect(localStorage.getItem('lacet.v1')).toBe(avant)
    expect(loadRun()).toMatchObject({ covered: 3200 })
  })

  it('retrouve une sortie laissée dans l’ancien emplacement', () => {
    // La mise à jour de l'app ne doit pas emporter la seule donnée qu'on ne
    // peut pas refaire : une sortie interrompue juste avant.
    localStorage.setItem(
      'lacet.v1',
      JSON.stringify({ run: { ...sortie, at: Date.now() }, favorites: [], history: [] }),
    )
    expect(loadRun()).toMatchObject({ covered: 3200 })
    // Et une fois reprise ou abandonnée, elle ne revient pas hanter les
    // lancements suivants.
    clearRun()
    expect(loadRun()).toBeNull()
  })

  it('ne casse rien quand le navigateur refuse d’écrire', () => {
    const plein = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      },
      removeItem: () => {},
    }
    vi.stubGlobal('localStorage', plein)
    expect(saveRun(sortie)).toBe(false)
    expect(loadRun()).toBeNull()
  })
})
