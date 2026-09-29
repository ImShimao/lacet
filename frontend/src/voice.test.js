import { describe, expect, it } from 'vitest'
import { phrase } from './voice'

/**
 * Ce que le guidage dit à voix haute.
 *
 * Une consigne vocale ne se relit pas. Si elle est mal formulée, on la comprend
 * de travers une fois et on ne peut pas revenir en arrière — d'où des tests sur
 * la formulation elle-même, et pas seulement sur le fait qu'une phrase sorte.
 *
 * La règle centrale : **personne n'estime 87 mètres en courant.** Les distances
 * sont arrondies à des repères que l'oreille retient, et disparaissent quand la
 * manœuvre est imminente — à ce moment-là, seule compte l'action.
 */

const gauche = { turn: 'left', text: 'Tourne à gauche sur Rue de Rivoli', caution: false }
const traversee = { turn: 'right', text: 'Tourne à droite', caution: true }

describe('phrase', () => {
  it('dit « maintenant » au moment d’agir', () => {
    // De loin et au carrefour, c'était la même phrase : on ne savait pas
    // laquelle on venait d'entendre, ni s'il fallait tourner tout de suite.
    expect(phrase(gauche, 100)).toBe('dans 100 mètres, tourne à gauche sur Rue de Rivoli.')
    expect(phrase(gauche, 12)).toBe('Tourne à gauche sur Rue de Rivoli maintenant.')
    expect(phrase(gauche, 0)).toBe('Tourne à gauche sur Rue de Rivoli maintenant.')
  })

  it('annonce la distance au-delà de trente mètres', () => {
    expect(phrase(gauche, 100)).toMatch(/^dans 100 mètres, tourne à gauche/)
  })

  it('arrondit à la dizaine sous cent vingt mètres', () => {
    expect(phrase(gauche, 87)).toContain('dans 90 mètres')
    expect(phrase(gauche, 44)).toContain('dans 40 mètres')
  })

  it('arrondit au cinquante au-delà', () => {
    expect(phrase(gauche, 137)).toContain('dans 150 mètres')
    expect(phrase(gauche, 220)).toContain('dans 200 mètres')
  })

  it('n’annonce plus de distance quand c’est imminent', () => {
    // À vingt mètres, « dans vingt mètres » est du bruit : il faut tourner.
    const dit = phrase(gauche, 20)
    expect(dit).not.toMatch(/mètres/)
    expect(dit).toBe('Tourne à gauche sur Rue de Rivoli maintenant.')
  })

  it('met la consigne en minuscule après la distance', () => {
    // « dans 100 mètres, Tourne à gauche » se dit mal, et certaines voix
    // marquent une pause sur la majuscule.
    expect(phrase(gauche, 100)).toContain(', tourne à gauche')
  })

  it('prévient d’une traversée non protégée', () => {
    expect(phrase(traversee, 100)).toContain('Traversée sans passage protégé.')
  })

  it('ne parle de traversée que s’il y en a une', () => {
    expect(phrase(gauche, 100)).not.toContain('Traversée')
  })

  it('laisse le départ et l’arrivée tels quels', () => {
    // Ces deux-là sont déjà des phrases complètes : « dans 200 mètres, tu es
    // revenu au point de départ » n'aurait aucun sens.
    const depart = { turn: 'start', text: 'Départ — pars vers le nord.', caution: false }
    const arrivee = { turn: 'finish', text: 'Boucle terminée.', caution: false }
    expect(phrase(depart, 500)).toBe('Départ — pars vers le nord.')
    expect(phrase(arrivee, 500)).toBe('Boucle terminée.')
  })

  it('termine toujours par un point', () => {
    // Sans ponctuation finale, la synthèse enchaîne sur la phrase suivante sans
    // respirer, et les deux consignes se mélangent.
    for (const reste of [10, 50, 200]) {
      expect(phrase(gauche, reste).endsWith('.')).toBe(true)
    }
  })

  it('supporte une consigne déjà dépassée', () => {
    expect(() => phrase(gauche, -5)).not.toThrow()
    expect(phrase(gauche, -5)).not.toMatch(/mètres/)
  })
})
