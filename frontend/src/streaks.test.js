import { describe, expect, it } from 'vitest'
import { monthChallenge, streaks } from './streaks'

/**
 * Séries et défis : une série n'est pas perdue avant la fin de sa période, le
 * record tient compte des trous, et le défi du mois vise toujours le palier
 * suivant, avec le rythme qu'il demande.
 */
const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString()
const run = (ranAt, km = 5, sport = 'run') => ({ ranAt, actual_distance_m: km * 1000, sport })

describe('les séries', () => {
  // Le mardi 24 novembre 2026, à midi.
  const now = new Date(2026, 10, 24, 12)

  it("compte les semaines d'affilée, et garde la série tant que la semaine n'est pas finie", () => {
    const history = [run(at(2026, 11, 17)), run(at(2026, 11, 10)), run(at(2026, 11, 3)), run(at(2026, 10, 20))]
    // Rien encore cette semaine : la série de trois tient jusqu'à dimanche.
    expect(streaks(history, now).weeks).toEqual({ current: 3, best: 3 })
    // Une semaine sautée la casse.
    expect(streaks([run(at(2026, 11, 10)), run(at(2026, 11, 3))], now).weeks.current).toBe(0)
  })

  it("compte les jours d'affilée, plusieurs sorties le même jour n'en font qu'un", () => {
    const history = [run(at(2026, 11, 23, 7)), run(at(2026, 11, 23, 19)), run(at(2026, 11, 22)), run(at(2026, 11, 21)), run(at(2026, 11, 15)), run(at(2026, 11, 14)), run(at(2026, 11, 13)), run(at(2026, 11, 12))]
    const { days, ranToday } = streaks(history, now)
    expect(ranToday).toBe(false)
    expect(days).toEqual({ current: 3, best: 4 })
  })

  it('rend zéro sans historique', () => {
    expect(streaks([], now)).toEqual({ weeks: { current: 0, best: 0 }, days: { current: 0, best: 0 }, ranToday: false, ranThisWeek: false })
  })
})

describe('le défi du mois', () => {
  const now = new Date(2026, 10, 24, 12)

  it('vise le palier suivant, avec ce qu’il faut par jour', () => {
    const history = [run(at(2026, 11, 2), 30), run(at(2026, 11, 20), 34), run(at(2026, 10, 30), 50), run(at(2026, 11, 5), 40, 'bike')]
    const c = monthChallenge(history, 'run', now)
    expect(c).toMatchObject({ km: 64, runs: 2, reached: 50, target: 100, daysLeft: 7 })
    expect(c.perDayKm).toBeCloseTo(36 / 7)
  })

  it('compte le vélo à part, à ses propres paliers', () => {
    const c = monthChallenge([run(at(2026, 11, 5), 40, 'bike')], 'bike', now)
    expect(c).toMatchObject({ km: 40, reached: null, target: 100 })
  })
})
