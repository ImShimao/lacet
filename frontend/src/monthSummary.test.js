/**
 * Le bilan d'un mois : ce qui compte, ce qui est écarté, et ce qui reste vide
 * quand une donnée manque. Les dates sont sans fuseau : l'heure locale de la
 * machine de test rend le même mois que celle de l'app.
 */
import { describe, expect, it } from 'vitest'
import { monthKey, monthLabel, monthSummary } from './monthSummary'

const run = (ranAt, km, extra = {}) => ({
  ranAt,
  actual_distance_m: km * 1000,
  actual_duration_s: km * 300,
  actual_ascent_m: 10,
  sport: 'run',
  ...extra,
})

describe('monthSummary', () => {
  // Septembre 2026 commence un mardi : la semaine du 31 août compte pour septembre.
  const history = [
    run('2026-09-01T08:00:00', 5, { actual_ascent_m: 40 }),
    run('2026-09-08T08:00:00', 12, { actual_ascent_m: 110 }),
    run('2026-09-16T08:00:00', 8, { actual_ascent_m: null }),
    run('2026-10-02T08:00:00', 30), // octobre : hors du bilan
  ]

  it('additionne les kilomètres, le temps et le dénivelé du seul mois', () => {
    const s = monthSummary(history, '2026-09')
    expect(s.count).toBe(3)
    expect(s.distance_m).toBe(25000)
    expect(s.time_s).toBe(25 * 300)
    expect(s.ascent_m).toBe(150)
  })

  it('garde la plus longue sortie du mois', () => {
    expect(monthSummary(history, '2026-09').longest.actual_distance_m).toBe(12000)
  })

  it('compte les semaines actives sur les semaines qui touchent le mois', () => {
    // Semaines du 31 août, du 7, du 14, du 21 et du 28 septembre : cinq. Actives : celles du 1er, du 8 et du 16.
    expect(monthSummary(history, '2026-09').weeks).toEqual({ active: 3, total: 5 })
  })

  it('rend le dénivelé à null quand aucune sortie ne l’a mesuré', () => {
    const s = monthSummary([run('2026-09-05T08:00:00', 4, { actual_ascent_m: null })], '2026-09')
    expect(s.ascent_m).toBeNull()
  })

  it('rend des zéros et pas de plus longue sortie pour un mois vide', () => {
    expect(monthSummary(history, '2026-11')).toEqual({
      count: 0,
      distance_m: 0,
      time_s: 0,
      ascent_m: null,
      longest: null,
      // Novembre 2026 : du lundi 26 octobre au lundi 30 novembre, six semaines.
      weeks: { active: 0, total: 6 },
    })
  })
})

describe('monthKey et monthLabel', () => {
  it('rend le mois d’une date, et null sans date valable', () => {
    expect(monthKey('2026-09-16T08:00:00')).toBe('2026-09')
    expect(monthKey('pas une date')).toBeNull()
    expect(monthKey(null)).toBeNull()
  })

  it('écrit le mois en français, avec une majuscule', () => {
    expect(monthLabel('2026-09')).toBe('Septembre 2026')
    expect(monthLabel(null)).toBe('Sans date')
  })
})

describe('la distance par jour', () => {
  it('compte chaque jour du mois, et laisse les jours sans sortie à zéro', async () => {
    const { dailyMetres } = await import('./monthSummary')
    const runs = [
      { ranAt: new Date(2026, 8, 3, 9).toISOString(), actual_distance_m: 5000 },
      { ranAt: new Date(2026, 8, 3, 18).toISOString(), actual_distance_m: 2000 },
      { ranAt: new Date(2026, 8, 20, 9).toISOString(), actual_distance_m: 10000 },
    ]
    const jours = dailyMetres(runs, '2026-09')
    expect(jours).toHaveLength(30)
    expect(jours[2]).toBe(7000)
    expect(jours[19]).toBe(10000)
    expect(jours[0]).toBe(0)
  })
})

describe('les objectifs', () => {
  // Semaine du calendrier, depuis lundi : la sortie de dimanche dernier ne
  // compte pas pour cette semaine, mais compte pour le mois.
  it('comptent la semaine depuis lundi et le mois en cours', async () => {
    const { goalProgress } = await import('./monthSummary')
    const now = new Date(2026, 10, 27, 12) // vendredi 27 novembre 2026
    const runs = [
      { ranAt: new Date(2026, 10, 23, 8).toISOString(), actual_distance_m: 10000 }, // lundi
      { ranAt: new Date(2026, 10, 22, 8).toISOString(), actual_distance_m: 5000 }, // dimanche d'avant
      { ranAt: new Date(2026, 9, 31, 8).toISOString(), actual_distance_m: 8000 }, // octobre
    ]
    expect(goalProgress(runs, now)).toEqual({ week_m: 10000, month_m: 15000 })
  })
})
