import { describe, expect, it } from 'vitest'
import { startSeance, stepSeance } from './seance'
import { DEFAULT_SEANCE, describeSeance, normalizeSeance } from './seanceSpec'

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
    expect(after.say).toBe('Récupération, 1 minute.')
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
    expect(stepSeance(next, at(830, 200)).say).toBe('Récupération, 1 minute.')
  })

  it('annonce chacune des répétitions et leurs récupérations, sauf après la dernière', () => {
    const said = []
    let state = startSeance(at(0, 0)).state
    let metres = 0
    let seconds = 0
    // Simule la sortie : 400 m en 100 s, puis 60 s d'arrêt, six fois.
    for (let i = 0; i < DEFAULT_SEANCE.reps; i += 1) {
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
    expect(said.filter((s) => s.startsWith('Récupération'))).toHaveLength(DEFAULT_SEANCE.reps - 1)
    expect(said.filter((s) => s.startsWith('Répétition'))).toHaveLength(DEFAULT_SEANCE.reps - 1)
    expect(said.at(-1)).toBe('Fractionné terminé.')
    expect(state.over).toBe(true)
  })

  it('ne dit plus rien une fois terminée', () => {
    const done = { ...startSeance(at(0, 0)).state, rep: DEFAULT_SEANCE.reps }
    const finished = stepSeance(done, at(400, 100))
    expect(finished.say).toBe('Fractionné terminé.')
    expect(stepSeance(finished.state, at(2000, 900))).toEqual({ state: finished.state, say: null })
  })
})

describe('la séance réglée', () => {
  it('un effort en temps se mesure en secondes, pas en mètres', () => {
    const spec = { reps: 3, effort: { unit: 's', value: 120 }, rest: { unit: 's', value: 60 } }
    const { state, say } = startSeance(at(0, 0), spec)
    expect(say).toBe('Fractionné. Répétition 1 sur 3. Effort, 2 minutes.')
    // 1 000 m en 100 s n'ont pas fini un effort de deux minutes.
    expect(stepSeance(state, at(1000, 100)).say).toBeNull()
    expect(stepSeance(state, at(300, 120)).say).toBe('Récupération, 1 minute.')
  })

  it('une récupération en mètres se mesure en distance courue', () => {
    const spec = { reps: 2, effort: { unit: 'm', value: 200 }, rest: { unit: 'm', value: 100 } }
    const rest = stepSeance(startSeance(at(0, 0), spec).state, at(200, 40)).state
    expect(stepSeance(rest, at(299, 300)).say).toBeNull()
    expect(stepSeance(rest, at(300, 300)).say).toBe('Répétition 2 sur 2. Effort, 200 mètres.')
  })

  it('une seule répétition : pas de récupération, la séance finit à son effort', () => {
    const spec = { reps: 1, effort: { unit: 'm', value: 400 }, rest: { unit: 's', value: 60 } }
    const { state } = startSeance(at(0, 0), spec)
    expect(stepSeance(state, at(400, 90)).say).toBe('Fractionné terminé.')
  })
})

describe('le réglage de la séance', () => {
  it('garde une valeur valide et ramène le reste à la valeur par défaut', () => {
    expect(normalizeSeance({ reps: 'x', effort: { unit: 'km', value: 'x' } })).toEqual(DEFAULT_SEANCE)
    expect(normalizeSeance({ reps: 500 }).reps).toBe(30)
    expect(normalizeSeance({ effort: { unit: 's', value: 5 } }).effort).toEqual({ unit: 's', value: 10 })
  })

  it('décrit la séance comme elle se lit à l’écran', () => {
    expect(describeSeance(DEFAULT_SEANCE)).toBe('6 × 400 m, récup 1 min')
    expect(describeSeance(normalizeSeance({ reps: 4, effort: { unit: 's', value: 90 }, rest: { unit: 'm', value: 200 } }))).toBe(
      '4 × 1 min 30 s, récup 200 m',
    )
  })
})
