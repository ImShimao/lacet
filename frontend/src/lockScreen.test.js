import { describe, expect, it } from 'vitest'
import { cardOf, fallbackCard, lockScreenMode, lockScreenState, noticeOf, paceEstimate, shortDistance, shouldRefresh, wantsActivity, wantsNotice } from './lockScreen'
import { bearing, buildTrack, headingAt } from './routeTracker'

/**
 * L'écran de verrouillage et la carte orientée pendant la course.
 *
 * Deux choses qu'on ne vérifie pas en courant : l'heure d'arrivée annoncée
 * — une estimation folle au premier feu rouge ferait douter de tout le reste —
 * et le sens de la carte, qui ne doit pas tourner sur le bruit du GPS.
 */

const ROUTE = {
  name: 'Boucle nord',
  distance_m: 6000,
  duration_s: 2340,
  instructions: [],
}

const NOW = Date.UTC(2026, 8, 18, 18, 0, 0)

describe('les distances affichées', () => {
  it('arrondissent à ce qu’on lit en courant', () => {
    expect(shortDistance(124)).toBe('120 m')
    expect(shortDistance(1260)).toBe('1,3 km')
    expect(shortDistance(12)).toBe('maintenant')
  })
})

describe('l’heure d’arrivée', () => {
  it('suit l’allure prévue tant que l’allure réelle ne veut rien dire', () => {
    // 90 secondes pour 150 m : un feu rouge au départ, pas une allure.
    const pace = paceEstimate({ route: ROUTE, travelled: 150, elapsedS: 90 })
    expect(pace).toBeCloseTo(2340 / 6000)
  })

  it('suit l’allure réelle ensuite', () => {
    const pace = paceEstimate({ route: ROUTE, travelled: 2000, elapsedS: 600 })
    expect(pace).toBeCloseTo(0.3)
  })

  it('annonce l’arrivée d’après ce qui reste', () => {
    const state = lockScreenState({
      route: ROUTE,
      step: { step: { text: 'Tourne à gauche', turn: 'left' }, remaining: 84 },
      along: 4000,
      offRoute: false,
      travelled: 4000,
      elapsedS: 1200,
      now: NOW,
    })
    // 2 km restants à 0,3 s/m : dix minutes.
    expect(state.arrival).toBe(NOW + 600_000)
    expect(state.remaining).toBe('2,0 km')
    expect(state.distance).toBe('80 m')
    expect(state.instruction).toBe('Tourne à gauche')
    expect(state.turn).toBe('left')
    expect(state.progress).toBeCloseTo(4000 / 6000)
  })

  it('annonce l’arrivée quand il n’y a plus de consigne', () => {
    const state = lockScreenState({ route: ROUTE, step: null, along: 5990, travelled: 5990, elapsedS: 2300, now: NOW })
    expect(state.turn).toBe('finish')
    expect(state.instruction).toBe('Arrivée')
  })
})

describe('la fréquence des mises à jour', () => {
  const base = { instruction: 'Tourne à gauche', distance: '120 m', remaining: '2,0 km', offRoute: false }

  it('suit tout de suite une nouvelle consigne', () => {
    expect(shouldRefresh(base, { ...base, instruction: 'Tourne à droite' }, 200)).toBe(true)
  })

  it('suit tout de suite une pause, et la reprise', () => {
    expect(shouldRefresh(base, { ...base, paused: true }, 200)).toBe(true)
    expect(shouldRefresh({ ...base, paused: true }, { ...base, paused: false }, 200)).toBe(true)
  })

  it('suit tout de suite une sortie du tracé', () => {
    expect(shouldRefresh(base, { ...base, offRoute: true }, 200)).toBe(true)
  })

  it('ne réveille pas l’écran à chaque mètre', () => {
    expect(shouldRefresh(base, { ...base, distance: '110 m' }, 1200)).toBe(false)
    expect(shouldRefresh(base, { ...base, distance: '110 m' }, 6000)).toBe(true)
  })

  it('ne renvoie rien qui n’ait changé', () => {
    expect(shouldRefresh(base, { ...base }, 60_000)).toBe(false)
  })
})

describe('le sens de la carte', () => {
  // Un L : 500 m plein est, puis 500 m plein nord.
  const est = [2.35 + 500 / (111320 * Math.cos((48.85 * Math.PI) / 180)), 48.85]
  const L = buildTrack([[2.35, 48.85], est, [est[0], 48.85 + 500 / 111320]])

  it('mesure les caps dans le sens des aiguilles d’une montre', () => {
    expect(bearing([2.35, 48.85], [2.35, 48.86])).toBeCloseTo(0, 0)
    expect(bearing([2.35, 48.85], [2.36, 48.85])).toBeCloseTo(90, 0)
  })

  it('suit le tracé, pas le bruit', () => {
    expect(headingAt(L, 100)).toBeCloseTo(90, 0)
    expect(headingAt(L, 800)).toBeCloseTo(0, 0)
  })

  it('anticipe le virage de quelques mètres', () => {
    // À 10 m du coin, on vise déjà la branche nord : la carte pivote à temps.
    const cap = headingAt(L, 490)
    expect(cap).toBeGreaterThan(10)
    expect(cap).toBeLessThan(80)
  })
})

describe('la notification de secours', () => {
  const state = {
    instruction: 'Tourne à droite sur Rue de la Gare',
    distance: '120 m',
    remaining: '4,2 km',
    arrival: new Date(2026, 8, 19, 18, 5).getTime(),
    offRoute: false,
    paused: false,
  }

  it('dit le virage, sa distance, et l’heure d’arrivée plutôt qu’un compte à rebours', () => {
    expect(noticeOf({ ...state, turn: 'right' })).toEqual({
      title: 'Tourne à droite sur Rue de la Gare',
      subtitle: 'Dans 120 m',
      body: 'Reste 4,2 km · arrivée vers 18h05',
      icon: 'right',
    })
  })

  it('au moment d’agir, le sous-titre le dit', () => {
    expect(noticeOf({ ...state, distance: 'maintenant' }).subtitle).toBe('Maintenant')
  })

  it('porte la flèche du virage — celle d’un avertissement hors parcours', () => {
    expect(noticeOf({ ...state, offRoute: true }).icon).toBe('warning')
  })

  it('hors parcours ou en pause, le dit', () => {
    expect(noticeOf({ ...state, offRoute: true }).title).toBe('Hors parcours')
    expect(noticeOf({ ...state, paused: true }).title).toBe('Sortie en pause')
  })
})

describe('l’avancée après un détour', () => {
  it('ne repart pas de zéro : elle suit la part de sortie faite', () => {
    const route = { distance_m: 3000, duration_s: 1200 }
    const next = lockScreenState({ route, step: null, along: 0, offRoute: false, travelled: 5000, elapsedS: 1800, share: 0.62 })
    expect(next.progress).toBeCloseTo(0.62)
  })
})

/**
 * Qui tient l'écran de verrouillage pendant la sortie.
 *
 * Le cas qui a coûté une sortie entière : iOS accepte l'activité en direct —
 * `started: true` — sans jamais promettre de la dessiner. L'app le prenait pour
 * une réussite, ne posait pas la notification de secours, et l'écran restait
 * noir du départ à l'arrivée. Tant que personne n'a vu l'activité sur cet
 * iPhone, on tient donc les deux.
 */
describe("ce qui tient l'écran de verrouillage", () => {
  it('tente l’activité en direct, sauf si le réglage dit « notification »', () => {
    expect(wantsActivity('auto')).toBe(true)
    expect(wantsActivity('notice')).toBe(false)
  })

  it('veut la notification tant que l’activité n’a pas fait ses preuves ici', () => {
    expect(wantsNotice({ started: true, seen: false })).toBe(true)
    expect(wantsNotice({ started: false, seen: true })).toBe(true)
    expect(wantsNotice({ started: true, seen: true })).toBe(false)
  })

  it('tient les deux quand iOS accepte l’activité sans qu’on l’ait jamais vue', () => {
    const mode = lockScreenMode({ setting: 'auto', started: true, noticeAllowed: true, seen: false })
    expect(mode).toBe('both')
  })

  it('n’affiche plus que l’activité une fois qu’elle a été vue', () => {
    expect(lockScreenMode({ setting: 'auto', started: true, noticeAllowed: true, seen: true })).toBe('activity')
  })

  it('se rabat sur la notification quand iOS refuse l’activité', () => {
    expect(lockScreenMode({ setting: 'auto', started: false, noticeAllowed: true, seen: false })).toBe('notice')
    expect(lockScreenMode({ setting: 'notice', started: false, noticeAllowed: true, seen: true })).toBe('notice')
  })

  it('garde l’activité plutôt que rien, quand les notifications sont refusées', () => {
    expect(lockScreenMode({ setting: 'auto', started: true, noticeAllowed: false, seen: false })).toBe('activity')
  })

  it('ne promet rien quand ni l’une ni l’autre n’est possible', () => {
    expect(lockScreenMode({ setting: 'auto', started: false, noticeAllowed: false, seen: false })).toBe(null)
  })
})

/**
 * La carte du lecteur : l'autre façon de tenir l'écran de verrouillage.
 *
 * Elle ne demande aucune extension — c'est l'app qui la remplit, comme un
 * lecteur de musique — et se lit dans la place d'un titre et d'un artiste.
 */
describe('la carte du lecteur', () => {
  const state = {
    instruction: 'Tourne à droite sur Rue de la Gare',
    distance: '120 m',
    remaining: '4,2 km',
    turn: 'right',
    arrival: Date.now() + 1000,
    offRoute: false,
    paused: false,
  }

  it('met la consigne en titre et la distance en sous-titre', () => {
    const now = Date.now()
    expect(cardOf({ ...state, arrival: now + 26 * 60_000 }, { elapsedS: 18 * 60, now })).toEqual({
      title: 'Tourne à droite sur Rue de la Gare',
      subtitle: '120 m · reste 4,2 km',
      icon: 'right',
      // La barre du lecteur : 18 minutes courues sur 44 estimées.
      elapsed: 18 * 60,
      duration: 44 * 60,
    })
  })

  it('dit la pause et le hors-parcours à la place de la consigne', () => {
    expect(cardOf({ ...state, paused: true }).title).toBe('Sortie en pause')
    expect(cardOf({ ...state, paused: true }).duration).toBeGreaterThanOrEqual(0)
    expect(cardOf({ ...state, offRoute: true }).icon).toBe('warning')
  })

  it('n’est prise que si on l’a choisie — elle confisque le lecteur', () => {
    expect(lockScreenMode({ setting: 'auto', started: true, noticeAllowed: true, seen: true, card: true })).toBe('activity')
    expect(lockScreenMode({ setting: 'card', started: false, noticeAllowed: true, card: true })).toBe('card')
    // Refusée par iOS : la notification prend le relais plutôt que rien.
    expect(lockScreenMode({ setting: 'card', started: false, noticeAllowed: true, card: false })).toBe('notice')
  })
})

describe('le mode automatique', () => {
  it('prend la carte du lecteur quand l’activité échoue et que rien ne joue', () => {
    expect(fallbackCard({ setting: 'auto', started: false, otherAudio: false })).toBe(true)
  })

  it('ne coupe pas la musique de quelqu’un qui court en musique', () => {
    expect(fallbackCard({ setting: 'auto', started: false, otherAudio: true })).toBe(false)
  })

  it('ne la prend pas quand l’activité en direct s’affiche', () => {
    expect(fallbackCard({ setting: 'auto', started: true, otherAudio: false })).toBe(false)
  })
})

