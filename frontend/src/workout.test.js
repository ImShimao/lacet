import { describe, expect, it } from 'vitest'
import { blocksOf, createCoach, customFromPreset, durationWords, estimate } from './workout'

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

  it('enchaîne plusieurs séries, avec la récupération entre séries', () => {
    const settings = {
      preset: 'custom',
      warmup_min: 0,
      cooldown_min: 0,
      custom: {
        set_rest_s: 240,
        series: [
          { reps: 2, unit: 'm', work_m: 400, rest_s: 60 },
          { reps: 2, unit: 's', work_s: 30, rest_s: 30 },
        ],
      },
    }
    const { blocks, spoken, label } = blocksOf(settings)
    expect(blocks.map((b) => [b.kind, b.m ?? b.s])).toEqual([
      ['work', 400],
      ['rest', 60],
      ['work', 400],
      ['rest', 240],
      ['work', 30],
      ['rest', 30],
      ['work', 30],
    ])
    // Les répétitions se comptent sur toute la séance.
    expect(blocks.filter((b) => b.kind === 'work').map((b) => `${b.rep}/${b.reps}`)).toEqual(['1/4', '2/4', '3/4', '4/4'])
    expect(label).toBe('2 × 400 m / 1 min + 2 × 30 s / 30 s')
    expect(spoken).toBe('2 fois 400 mètres, récupération 1 minute, puis 2 fois 30 secondes, récupération 30 secondes')
  })

  it('relit une séance personnalisée d’avant les séries comme sa première série', () => {
    const { blocks } = blocksOf({ preset: 'custom', warmup_min: 0, cooldown_min: 0, custom: { reps: 3, unit: 's', work_s: 60, rest_s: 45 } })
    expect(blocks.map((b) => [b.kind, b.s])).toEqual([
      ['work', 60],
      ['rest', 45],
      ['work', 60],
      ['rest', 45],
      ['work', 60],
    ])
  })

  it('reprend un classique pour le retoucher', () => {
    expect(customFromPreset('1000').series).toEqual([expect.objectContaining({ reps: 5, unit: 'm', work_m: 1000, rest_s: 120 })])
  })

  it('estime la durée de la séance à l’allure donnée', () => {
    // 1 km d'effort à 5:00 × 0,85 = 255 s, 60 s de récupération, 5 min de calme.
    const e = estimate({ preset: 'custom', warmup_min: 0, cooldown_min: 5, custom: { series: [{ reps: 2, unit: 'm', work_m: 500, rest_s: 60 }] } }, 300)
    expect(e.reps).toBe(2)
    expect(e.seconds).toBeCloseTo(255 + 60 + 300)
    expect(e.blocks.map((b) => b.kind)).toEqual(['work', 'rest', 'work', 'cooldown'])
  })

  it('dit les durées comme on les dit', () => {
    expect(durationWords(45)).toBe('45 secondes')
    expect(durationWords(60)).toBe('1 minute')
    expect(durationWords(150)).toBe('2 minutes 30')
  })
})

describe('la séance personnalisée', () => {
  const perso = (custom) => ({ on: true, preset: 'custom', warmup_min: 0, cooldown_min: 0, custom })

  it('se découpe en blocs comme un classique, à la distance', () => {
    const { label, blocks } = blocksOf(perso({ reps: 3, unit: 'm', work_m: 1500, rest_s: 75 }))
    expect(label).toBe('3 × 1,5 km / 1 min 15')
    expect(blocks.map((b) => b.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work'])
    expect(blocks[0]).toMatchObject({ m: 1500, rep: 1, reps: 3 })
    expect(blocks[1]).toMatchObject({ s: 75 })
  })

  it('se court aussi à la durée, et garde ses valeurs par défaut pour un champ absent', () => {
    const { label, blocks } = blocksOf(perso({ unit: 's', work_s: 45 }))
    expect(label).toBe('6 × 45 s / 1 min 30')
    expect(blocks[0]).toMatchObject({ s: 45, reps: 6 })
  })
})
