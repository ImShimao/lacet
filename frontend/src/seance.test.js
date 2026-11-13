import { describe, expect, it } from 'vitest'
import { SEANCE, startSeance, stepSeance } from './seance'

/**
 * La séance « 6 × 400 m, récup 1 min » : quand la voix parle, et quand elle se tait.
 *
 * Une phrase au mauvais moment est pire que pas de phrase : on dit « récupération »
 * au kilomètre où l'on accélère, ou « effort » pendant la pause au feu. D'où des
 * tests sur les seuils exacts (400 m, 60 s) et sur la dernière répétition.
 */

const at = (metres, seconds) => ({ metres, seconds })

describe('la séance', () => {
  it('commence par la première répétition, au point de départ', () => {
    const { state, say } = startSeance(at(1000, 30))
    expect(state.rep).toBe(1)
    expect(state.phase).toBe('effort')
    expect(say).toContain('Répétition 1 sur 6')
    expect(say).toContain('400 mètres')
  })

  it("ne passe à la récupération qu'à 400 m courus, pas avant", () => {
    const { state } = startSeance(at(1000, 0))
    const before = stepSeance(state, at(1399, 90))
    expect(before.say).toBeNull()
    expect(before.state.phase).toBe('effort')
    const after = stepSeance(state, at(1400, 95))
    expect(after.state.phase).toBe('rest')
    expect(after.say).toBe('Récupération, 60 secondes.')
  })

  it('compte la récupération en temps, à partir de la fin de l’effort', () => {
    const rest = stepSeance(startSeance(at(0, 0)).state, at(400, 100)).state
    expect(stepSeance(rest, at(400, 159)).say).toBeNull()
    const next = stepSeance(rest, at(420, 160))
    expect(next.state.phase).toBe('effort')
    expect(next.state.rep).toBe(2)
    expect(next.say).toBe('Répétition 2 sur 6. Effort, 400 mètres.')
  })

  it('reporte la distance du départ de l’effort suivant', () => {
    const rest = stepSeance(startSeance(at(0, 0)).state, at(400, 100)).state
    const next = stepSeance(rest, at(430, 160)).state
    // Un nouvel effort de 400 m part de 430 m, pas de 0 : 799 m ne suffisent pas.
    expect(stepSeance(next, at(829, 200)).say).toBeNull()
    expect(stepSeance(next, at(830, 200)).say).toBe('Récupération, 60 secondes.')
  })

  it('annonce chacune des six répétitions et leurs six récupérations, sauf après la dernière', () => {
    const said = []
    let state = startSeance(at(0, 0)).state
    let metres = 0
    let seconds = 0
    // Simule la sortie : 400 m en 100 s, puis 60 s d'arrêt, six fois.
    for (let i = 0; i < SEANCE.reps; i += 1) {
      metres += 400
      seconds += 100
      const end = stepSeance(state, at(metres, seconds))
      state = end.state
      if (end.say) said.push(end.say)
      if (state.phase === 'rest') {
        seconds += 60
        const back = stepSeance(state, at(metres, seconds))
        state = back.state
        if (back.say) said.push(back.say)
      }
    }
    expect(said.filter((s) => s.startsWith('Récupération'))).toHaveLength(SEANCE.reps - 1)
    expect(said.filter((s) => s.startsWith('Répétition'))).toHaveLength(SEANCE.reps - 1)
    expect(said.at(-1)).toBe('Séance terminée.')
    expect(state.over).toBe(true)
  })

  it('ne dit plus rien une fois terminée', () => {
    const done = { ...startSeance(at(0, 0)).state, rep: SEANCE.reps }
    const finished = stepSeance(done, at(400, 100))
    expect(finished.say).toBe('Séance terminée.')
    expect(stepSeance(finished.state, at(2000, 900))).toEqual({ state: finished.state, say: null })
  })
})
