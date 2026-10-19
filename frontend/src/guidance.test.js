import { describe, expect, it } from 'vitest'
import { actAt, announcement, chains, distanceWords, followingStep, previewAt, rightAfter, speedOr, thenLabel } from './guidance'

/**
 * Ce que le guidage dit, et quand.
 *
 * Une consigne vocale ne se relit pas. Si elle est mal formulée, on la comprend
 * de travers une fois et on ne peut pas revenir en arrière — d'où des tests sur
 * la formulation elle-même, et pas seulement sur le fait qu'une phrase sorte.
 *
 * Deux règles centrales : **personne n'estime 87 mètres en courant**, et **une
 * consigne ne doit jamais en couper une autre**.
 */

const step = (dist_m, turn, text, extra = {}) => ({ dist_m, turn, text, road: null, caution: false, ...extra })
const gauche = step(500, 'left', 'Tourne à gauche sur Rue de Rivoli', { road: 'Rue de Rivoli' })
const PIED = 2.8
const VELO = 7

describe('le moment de parler', () => {
  it('dit « maintenant » cinq secondes avant le carrefour, pas huit', () => {
    // Vingt-cinq mètres fixes, c'était huit secondes à pied : assez pour
    // prendre la rue d'avant.
    expect(actAt(PIED)).toBe(15)
    expect(actAt(3.5)).toBeCloseTo(17.5)
  })

  it('le dit assez tôt à vélo pour avoir le temps de tourner', () => {
    // Trois secondes à vingt-cinq kilomètres-heure, moins que le temps de
    // dire la phrase : il faut partir de plus loin.
    expect(actAt(VELO)).toBe(35)
    expect(actAt(20)).toBe(50)
  })

  it('annonce une trentaine de secondes avant, jamais sous cent mètres', () => {
    expect(previewAt(1.2)).toBe(100)
    expect(previewAt(PIED)).toBe(100)
    expect(previewAt(VELO)).toBe(245)
    expect(previewAt(15)).toBe(350)
  })

  it('suppose une allure de course tant que rien n’est mesuré', () => {
    expect(speedOr(null, 'run')).toBe(2.8)
    expect(speedOr(null, 'bike')).toBe(5.5)
    // À l'arrêt, la vitesse mesurée ne dit rien de celle de la reprise.
    expect(speedOr(0.1, 'run')).toBe(2.8)
    expect(speedOr(3.4, 'run')).toBe(3.4)
  })
})

describe('les phrases', () => {
  it('commence par « maintenant » au moment d’agir', () => {
    // En tête, pas en fin de phrase : on tourne pendant qu'elle se dit, au lieu
    // d'attendre la fin de la consigne pour savoir que c'est la bonne.
    expect(announcement(gauche, 12, { stage: 'act' })).toBe('Maintenant, tourne à gauche sur Rue de Rivoli.')
  })

  it('annonce de loin avec une distance qu’on retient', () => {
    expect(announcement(gauche, 104, { stage: 'preview' })).toBe('Dans 100 mètres, tourne à gauche sur Rue de Rivoli.')
    expect(announcement(gauche, 87, { stage: 'preview' })).toContain('Dans 90 mètres')
    expect(announcement(gauche, 243, { stage: 'preview' })).toContain('Dans 250 mètres')
  })

  it('prévient d’une traversée non protégée, et seulement alors', () => {
    const traversee = step(300, 'right', 'Tourne à droite', { caution: true })
    expect(announcement(traversee, 100, { stage: 'preview' })).toContain('traversée sans passage protégé')
    expect(announcement(traversee, 10, { stage: 'act' })).toContain('traversée sans passage protégé')
    expect(announcement(gauche, 100, { stage: 'preview' })).not.toContain('traversée')
  })

  it('termine toujours par un point', () => {
    // Sans ponctuation finale, la synthèse enchaîne sur la phrase suivante sans
    // respirer, et les deux consignes se mélangent.
    for (const stage of ['preview', 'act']) expect(announcement(gauche, 100, { stage }).endsWith('.')).toBe(true)
  })
})

describe('deux virages rapprochés', () => {
  const liste = [
    step(0, 'start', 'Départ — rejoins Rue des Tonneliers et pars à droite.', { road: 'Rue des Tonneliers' }),
    step(97, 'right', 'Tourne à droite sur Rue de Lorraine', { road: 'Rue de Lorraine' }),
    step(157, 'left', 'Tourne à gauche sur Rue Pasteur', { road: 'Rue Pasteur' }),
    step(175, 'right', 'Tourne à droite'),
    step(1675, 'left', 'Tourne à gauche sur Avenue Foch', { road: 'Avenue Foch' }),
    step(2600, 'finish', 'Tu es revenu au point de départ. Boucle terminée.'),
  ]

  it('dit le second avec le premier, au lieu de le laisser le couper', () => {
    // L'annonce du virage à soixante mètres tombait un relevé après la
    // consigne du premier, et la coupait : on n'entendait la fin d'aucune.
    const following = followingStep(liste, 1)
    expect(chains(following, PIED)).toBe(true)
    expect(announcement(liste[1], 10, { stage: 'act', following, speed: PIED })).toBe(
      'Maintenant, tourne à droite sur Rue de Lorraine, puis dans 60 mètres, à gauche dans la rue Pasteur.',
    )
  })

  it('dit « tout de suite » quand le second est collé au premier', () => {
    const following = followingStep(liste, 2)
    expect(announcement(liste[2], 8, { stage: 'act', following, speed: PIED })).toBe(
      'Maintenant, tourne à gauche sur Rue Pasteur, puis tout de suite à droite.',
    )
    // Et dès l'annonce : on se place pour les deux.
    expect(announcement(liste[2], 100, { stage: 'preview', following, speed: PIED })).toBe(
      'Dans 100 mètres, tourne à gauche sur Rue Pasteur, puis tout de suite à droite.',
    )
  })

  it('n’encombre pas l’annonce d’un virage qui sera dit au carrefour', () => {
    const following = followingStep(liste, 1)
    expect(announcement(liste[1], 100, { stage: 'preview', following, speed: PIED })).toBe(
      'Dans 100 mètres, tourne à droite sur Rue de Lorraine.',
    )
  })

  it('complète le départ du premier virage, qui le coupait aussi', () => {
    const following = followingStep(liste, 0)
    expect(announcement(liste[0], 0, { stage: 'act', following, speed: PIED })).toBe(
      'Départ — rejoins Rue des Tonneliers et pars à droite, puis dans 100 mètres, à droite dans la rue de Lorraine.',
    )
  })

  it('dit, après un virage, qu’il n’y a plus rien avant longtemps', () => {
    const following = followingStep(liste, 3)
    expect(announcement(liste[3], 5, { stage: 'act', following, speed: PIED })).toBe(
      'Maintenant, tourne à droite, puis continue pendant 1,5 kilomètre.',
    )
  })

  it('attend plus loin à vélo avant de lier deux virages', () => {
    // À vélo, l'annonce part de plus loin : deux virages à deux cents mètres
    // l'un de l'autre se disent ensemble.
    const loin = [step(0, 'right', 'Tourne à droite'), step(200, 'left', 'Tourne à gauche sur Rue Haute', { road: 'Rue Haute' })]
    expect(chains(followingStep(loin, 0), PIED)).toBe(false)
    expect(chains(followingStep(loin, 0), VELO)).toBe(true)
  })

  it('l’écrit pour le bandeau et l’écran de verrouillage', () => {
    expect(thenLabel(followingStep(liste, 1), PIED)).toBe('puis à gauche à 60 m · Rue Pasteur')
    expect(thenLabel(followingStep(liste, 2), PIED)).toBe('puis à droite tout de suite')
    expect(thenLabel(followingStep(liste, 3), PIED)).toBe(null)
  })
})

describe('l’arrivée et les tours', () => {
  const fin = step(4000, 'finish', 'Tu es revenu au point de départ. Boucle terminée.')
  const tour = step(2000, 'lap', 'Fin du premier tour. Dernier tour. Repars vers le nord.')

  it('annonce l’arrivée à distance, sans dire qu’on y est', () => {
    // « Tu es revenu au point de départ » tombait à cent mètres de l'arrivée.
    expect(announcement(fin, 104, { stage: 'preview' })).toBe('Arrivée dans 100 mètres.')
    // Le constat est dit par la détection d'arrivée, au bon moment.
    expect(announcement(fin, 10, { stage: 'act' })).toBe(null)
  })

  it('dit la fin du tour quand on y est, pas avant', () => {
    expect(announcement(tour, 100, { stage: 'preview' })).toBe(null)
    expect(announcement(tour, 5, { stage: 'act' })).toBe(tour.text)
  })

  it('enchaîne le virage qui suit de près la fin du tour', () => {
    // Le guidage le donnait pour annoncé dans cette phrase, sans l'y dire : le
    // premier virage du second tour n'avait que son « maintenant ».
    const droite = { index: 4, step: step(2060, 'right', 'Tourne à droite'), gap: 60 }
    expect(announcement(tour, 5, { stage: 'act', following: droite, speed: PIED })).toBe(
      'Fin du premier tour. Dernier tour. Repars vers le nord, puis dans 60 mètres, à droite.',
    )
    expect(rightAfter(droite, PIED)).toBe(false)
    expect(rightAfter({ ...droite, gap: 20 }, PIED)).toBe(true)
  })
})

describe('les distances dites', () => {
  it('arrondit à ce que l’oreille retient', () => {
    expect(distanceWords(87)).toBe('90 mètres')
    expect(distanceWords(137)).toBe('150 mètres')
    expect(distanceWords(980)).toBe('1 kilomètre')
    expect(distanceWords(1500)).toBe('1,5 kilomètre')
    expect(distanceWords(2300)).toBe('2,3 kilomètres')
    expect(distanceWords(12_400)).toBe('12 kilomètres')
  })

  it('ne dit jamais « dans 0 mètre »', () => {
    expect(distanceWords(-5)).toBe('10 mètres')
    expect(distanceWords(3)).toBe('10 mètres')
  })
})
