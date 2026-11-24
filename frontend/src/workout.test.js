import { describe, expect, it } from 'vitest'
import { blocksOf, createCoach, durationWords } from './workout'

/**
 * La séance fractionnée : les blocs dans l'ordre, et ce que la voix dit — une
 * fois par début de bloc, un avertissement avant la fin, le temps de chaque
 * répétition courue à la distance, puis la fin de la séance.
 */
describe('la séance fractionnée', () => {
  it('enchaîne échauffement, répétitions, récupérations et retour au calme', () => {
    const { blocks } = blocksOf({ preset: '400', warmup_min: 10, cooldown_min: 5 })
    expect(blocks.map((b) => b.kind)).toEqual([
      'warmup',
      ...Array.from({ length: 8 }, (_, i) => (i < 7 ? ['work', 'rest'] : ['work'])).flat(),
      'cooldown',
    ])
  })

  it('dit chaque bloc à son début, et le temps de la répétition', () => {
    const coach = createCoach(blocksOf({ preset: '400', warmup_min: 1, cooldown_min: 0 }))
    expect(coach.update(0, 0).said).toEqual([
      "Séance fractionnée : 8 fois 400 mètres, récupération 1 minute 30. D'abord 1 minute d'échauffement, tranquille.",
    ])
    expect(coach.update(50, 150).said).toEqual(['Dix secondes.'])
    expect(coach.update(60, 180).said).toEqual(['Répétition 1 sur 8 : 400 mètres. Vas-y !'])
    expect(coach.update(80, 300).status).toMatchObject({ title: 'Répétition 1/8', left: 280, unit: 'm' })
    expect(coach.update(120, 500).said).toEqual(['Plus que 100 mètres.'])
    expect(coach.update(152, 580).said).toEqual(['Terminé en 1 minute 32. Récupère : 1 minute 30, en trottinant.'])
    // Rien à dire entre deux débuts de bloc, hors l'avertissement.
    expect(coach.update(160, 600).said).toEqual([])
  })

  it('finit la séance, et se tait ensuite', () => {
    const coach = createCoach(blocksOf({ preset: '30-30', warmup_min: 0, cooldown_min: 0 }))
    let end = null
    for (let t = 0; t <= 600 && end?.status !== null; t += 1) end = coach.update(t, t * 4)
    expect(end.said.at(-1)).toBe('Séance terminée. Bravo !')
    expect(end.status).toBeNull()
    expect(coach.update(10_100, 30_100).said).toEqual([])
  })

  it("reprend, après un arrêt de l'app, au bloc où elle en était", () => {
    const plan = blocksOf({ preset: '400', warmup_min: 1, cooldown_min: 0 })
    const first = createCoach(plan)
    first.update(0, 0)
    first.update(60, 180)
    const saved = JSON.parse(JSON.stringify(first.snapshot()))
    const again = createCoach(plan, saved)
    // Pas de nouvelle présentation : la répétition en cours continue.
    expect(again.update(90, 400)).toMatchObject({ said: [], status: { title: 'Répétition 1/8', left: 180 } })
    expect(again.update(150, 580).said).toEqual(['Terminé en 1 minute 30. Récupère : 1 minute 30, en trottinant.'])
  })

  it('dit les durées comme on les dit', () => {
    expect(durationWords(45)).toBe('45 secondes')
    expect(durationWords(60)).toBe('1 minute')
    expect(durationWords(150)).toBe('2 minutes 30')
  })
})
