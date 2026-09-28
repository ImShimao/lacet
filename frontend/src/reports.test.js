/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { activeReports, addReport, blockedPoints, kindLabel, removeReport } from './reports'
import { load } from './storage'

/**
 * Ce qu'on a signalé, et ce qu'on en garde.
 *
 * Un signalement écarte des rues pendant des mois : il vaut mieux qu'il
 * s'efface tout seul quand le chantier est fini, et qu'on puisse le retirer à
 * la main quand la grille a rouvert. Sans ces deux issues, la boucle du
 * dimanche se met un jour à faire un crochet que plus personne n'explique.
 */

const JOUR = 864e5

describe('les signalements', () => {
  beforeEach(() => localStorage.clear())

  it("garde ce qu'on signale, au point où l'on se trouve", () => {
    addReport({ lon: 7.2, lat: 47.9, kind: 'works' })
    const [garde] = activeReports()
    expect(garde.kind).toBe('works')
    expect(garde.lon).toBe(7.2)
    expect(blockedPoints()).toEqual([[7.2, 47.9]])
  })

  it('oublie au bout de six mois', () => {
    const vieux = Date.now() - 200 * JOUR
    addReport({ lon: 7.2, lat: 47.9, kind: 'closed' }, vieux)
    // Gardé sur le disque, mais plus compté : un chantier finit.
    expect(load().reports).toHaveLength(1)
    expect(activeReports()).toHaveLength(0)
    expect(blockedPoints()).toEqual([])
  })

  it('se retire à la main, quand la rue a rouvert', () => {
    addReport({ lon: 7.2, lat: 47.9, kind: 'danger' })
    const [garde] = activeReports()
    expect(removeReport(garde.id)).toHaveLength(0)
    expect(activeReports()).toHaveLength(0)
  })

  it('refuse ce qui n’est pas un signalement', () => {
    addReport({ lon: 7.2, lat: 47.9, kind: 'licorne' })
    addReport({ lon: NaN, lat: 47.9, kind: 'works' })
    addReport({ lon: 7.2, lat: undefined, kind: 'works' })
    expect(activeReports()).toHaveLength(0)
  })

  it('ne grossit pas sans fin', () => {
    for (let i = 0; i < 260; i += 1) addReport({ lon: 7 + i / 1000, lat: 47.9, kind: 'works' })
    expect(activeReports()).toHaveLength(200)
    // Ce sont les plus récents qui restent.
    expect(activeReports()[0].lon).toBeCloseTo(7.259, 3)
  })

  it('sait se nommer, même pour un genre inconnu', () => {
    expect(kindLabel('closed')).toBe('Passage fermé')
    expect(kindLabel('bidule')).toBe('Signalement')
  })
})
