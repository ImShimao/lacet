// Quand parler, et quoi dire.
//
// Le guidage répond à deux questions à chaque relevé : faut-il annoncer la
// prochaine manœuvre, et avec quels mots. Elles vivaient dans l'écran de course
// sous forme de deux distances fixes — 110 m pour l'annonce, 25 m pour
// « maintenant » — et d'une phrase construite à part pour la voix, une autre
// pour l'écran de verrouillage. Trois défauts en sortaient, tous entendus en
// courant :
//
// **Les distances ne dépendaient pas de la vitesse.** Vingt-cinq mètres, c'est
// huit secondes à pied — assez pour tourner une rue trop tôt — et trois à vélo,
// moins que le temps de dire la phrase. Ce qui compte, c'est le **temps** qu'il
// reste avant le carrefour : on le convertit en distance à la vitesse du moment.
//
// **Deux virages rapprochés se coupaient la parole.** La consigne dite au
// carrefour était aussitôt interrompue par l'annonce du virage suivant, soixante
// mètres plus loin : une consigne chasse l'autre, c'est voulu, et l'on
// n'entendait que la moitié de chacune. Désormais le second virage est dit
// **avec** le premier : « Maintenant, tourne à droite, puis dans 60 mètres, à
// gauche sur rue Pasteur. » Le départ en profite aussi : sa phrase était coupée
// par l'annonce du premier virage.
//
// **L'arrivée et les fins de tour étaient dites trop tôt.** « Tu es revenu au
// point de départ » tombait à cent mètres de l'arrivée, au moment de l'annonce.
// L'annonce dit maintenant « arrivée dans 100 mètres », et le constat vient
// au bon moment — pour l'arrivée, c'est `arrival.js` qui le dit.

import { on } from './engine/navigation'

// Allure par défaut, en mètres par seconde, tant qu'aucune vitesse n'est
// mesurée : six minutes au kilomètre à pied, vingt kilomètres-heure à vélo.
export const DEFAULT_SPEED = { run: 2.8, bike: 5.5 }

// L'annonce : une trentaine de secondes avant. Assez pour lire le nom de la rue
// et se placer du bon côté, pas assez pour l'oublier. Jamais sous cent mètres —
// la marche lente ne doit pas repousser l'annonce au carrefour —, jamais
// au-delà de trois cent cinquante : à vélo en descente, plus loin, elle ne
// désigne plus rien de visible.
const PREVIEW_S = 35
const PREVIEW_MIN_M = 100
const PREVIEW_MAX_M = 350

// « Maintenant » : cinq secondes avant le carrefour. Le relevé GPS a une
// seconde de retard, la phrase en prend deux à dire, il en reste deux pour
// tourner. À pied, cela fait une quinzaine de mètres — la rue d'avant n'est
// plus à portée de la consigne ; à vélo, trente-cinq.
const ACT_S = 5
const ACT_MIN_M = 15
const ACT_MAX_M = 50

// En dessous, deux manœuvres n'en font qu'une à dire : « puis tout de suite ».
const RIGHT_AFTER_M = 30

// Au-delà, après un virage, on dit combien de temps on garde la direction :
// « puis continue pendant 600 mètres ». Savoir ce qu'on a devant soi dispense
// de guetter chaque carrefour. Huit cents mètres d'abord : sous ce seuil, on ne
// savait jamais si le silence venait d'une longue ligne droite ou d'un oubli.
const QUIET_STRETCH_M = 300

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** La vitesse retenue, en m/s : celle mesurée si elle a un sens, sinon celle du sport. */
export function speedOr(measured, sport = 'run') {
  return Number.isFinite(measured) && measured > 0.5 ? measured : DEFAULT_SPEED[sport] ?? DEFAULT_SPEED.run
}

/** À quelle distance annoncer une manœuvre. */
export const previewAt = (speed) => clamp(speed * PREVIEW_S, PREVIEW_MIN_M, PREVIEW_MAX_M)

/** À quelle distance dire « maintenant » — et afficher « Maintenant ». */
export const actAt = (speed) => clamp(speed * ACT_S, ACT_MIN_M, ACT_MAX_M)

/** La manœuvre qui suit `index` dans la liste, ou `null`. */
export function followingStep(instructions, index) {
  const next = instructions?.[index + 1]
  return next ? { index: index + 1, step: next, gap: next.dist_m - instructions[index].dist_m } : null
}

/**
 * Faut-il dire la manœuvre suivante en même temps que celle-ci ?
 *
 * Oui quand son annonce tomberait avant la fin de celle-ci — c'est-à-dire
 * quand elle est plus proche que la distance d'annonce. Jamais pour une fin de
 * tour, qui n'est pas une manœuvre.
 */
export function chains(following, speed) {
  if (!following || following.step.turn === 'lap' || following.step.turn === 'start') return false
  return following.gap <= previewAt(speed)
}

/** La manœuvre suivante est-elle dite « tout de suite », dans la même phrase que celle-ci ? */
export const rightAfter = (following, speed) => chains(following, speed) && following.gap <= RIGHT_AFTER_M

/**
 * La phrase à dire, ou `null` s'il n'y a rien à dire à ce moment-là.
 *
 * @param step       la manœuvre
 * @param remaining  mètres jusqu'à elle
 * @param stage      'preview' (l'annonce) ou 'act' (« maintenant »)
 * @param following  la manœuvre d'après (`followingStep`), dite dans la foulée
 *                   quand elle est proche — voir `chains`
 * @param speed      la vitesse du moment, en m/s
 */
export function announcement(step, remaining, { stage = 'act', following = null, speed = DEFAULT_SPEED.run } = {}) {
  const warning = step.caution ? ' Attention, traversée sans passage protégé.' : ''
  // À l'annonce, on ne dit la suivante que si elle est collée à celle-ci : le
  // reste le sera au carrefour. Au carrefour — et au départ, dit d'emblée —,
  // tout ce qui viendra avant la prochaine annonce. L'arrivée qui suit, elle, se
  // dit dès l'annonce : la détection d'arrivée peut devancer le carrefour. Sur
  // les pentes de la Croix-Rousse, la boucle passe au pied du départ, sous un
  // escalier, avant un dernier demi-tour à 31 m de la fin — on arrivait sans
  // l'avoir entendue annoncer.
  const now = stage === 'act' || step.turn === 'start'
  const joined = chains(following, speed) && (now || following.gap <= RIGHT_AFTER_M || following.step.turn === 'finish')
  const calm = now && !joined ? quietStretch(following) : null
  // La ligne droite qui suit se dit dans la phrase de la manœuvre ; l'arrivée,
  // elle, garde sa phrase à elle.
  const after = joined ? thenClause(following) : calm && !calm.finish ? `, puis continue pendant ${calm.distance}` : ''
  const tail = calm?.finish ? ` Arrivée dans ${calm.distance}.` : ''

  if (step.turn === 'start') return `${trimDot(step.text)}${after}.${tail}`
  if (step.turn === 'finish') {
    // Le constat — « arrivée, sortie terminée » — est dit par la détection
    // d'arrivée, au point le plus proche : le dire ici le doublerait, et trop tôt.
    return stage === 'preview' ? `Arrivée dans ${distanceWords(remaining)}.` : null
  }
  if (step.turn === 'lap') {
    if (stage !== 'act') return null
    // La manœuvre qui suit de près se dit ici, comme après un virage : on la
    // donnait pour annoncée, sans la dire, et le premier virage du second tour
    // n'avait que son « maintenant ».
    return calm && !calm.finish ? `${step.text} Continue pendant ${calm.distance}.` : `${trimDot(step.text)}${after}.${tail}`
  }

  if (stage === 'preview') {
    return `Dans ${distanceWords(remaining)}, ${lower(step.text)}${after}.${warning}`
  }
  // **« Maintenant », en tête.** Sans ce mot, l'annonce de loin et celle du
  // carrefour étaient la même phrase, et l'on ne savait pas laquelle on venait
  // d'entendre. Placé en fin de phrase, il fallait encore écouter toute la
  // consigne avant de l'apprendre ; en tête, on tourne pendant qu'elle se dit.
  return `Maintenant, ${lower(step.text)}${after}.${warning}${tail}`
}

/** « , puis tout de suite à gauche dans la rue Pasteur » */
function thenClause({ step, gap }) {
  if (step.turn === 'finish') {
    return gap <= RIGHT_AFTER_M ? ', puis tu arrives' : `, puis arrivée dans ${distanceWords(gap)}`
  }
  const move = `${SHORT[step.turn] ?? 'continue'}${on(step.road)}`
  return gap <= RIGHT_AFTER_M ? `, puis tout de suite ${move}` : `, puis dans ${distanceWords(gap)}, ${move}`
}

/** Après un virage, la longueur sans consigne qui suit, si elle vaut d'être dite. */
function quietStretch(following) {
  if (!following || following.gap < QUIET_STRETCH_M || following.step.turn === 'lap') return null
  return { finish: following.step.turn === 'finish', distance: distanceWords(following.gap) }
}

/**
 * La suite, en quelques mots, pour l'écran : « puis à gauche · rue Pasteur ».
 * `null` quand la manœuvre suivante est trop loin pour concerner celle-ci.
 */
export function thenLabel(following, speed) {
  if (!chains(following, speed)) return null
  const { step, gap } = following
  if (step.turn === 'finish') return gap <= RIGHT_AFTER_M ? 'puis arrivée' : `puis arrivée à ${metres(gap)}`
  const move = SHORT[step.turn] ?? 'tout droit'
  const where = gap <= RIGHT_AFTER_M ? 'tout de suite' : `à ${metres(gap)}`
  return `puis ${move} ${where}${step.road ? ` · ${step.road}` : ''}`
}

// Les virages en deux ou trois mots — ce qu'on garde de la seconde manœuvre
// quand on la dit dans la foulée de la première.
const SHORT = {
  left: 'à gauche',
  right: 'à droite',
  slight_left: 'légèrement à gauche',
  slight_right: 'légèrement à droite',
  sharp_left: 'franchement à gauche',
  sharp_right: 'franchement à droite',
  uturn: 'demi-tour',
  straight: 'tout droit',
}

/**
 * Une distance comme on la dit : des repères que l'oreille retient.
 *
 * Personne n'estime 87 mètres en courant : à la dizaine sous cent vingt
 * mètres, au cinquante au-delà, au dixième de kilomètre passé le kilomètre.
 */
export function distanceWords(m) {
  const d = Math.max(0, m)
  if (d < 120) return `${Math.max(10, Math.round(d / 10) * 10)} mètres`
  if (d < 1000) {
    const r = Math.round(d / 50) * 50
    return r >= 1000 ? '1 kilomètre' : `${r} mètres`
  }
  const km = d >= 10_000 ? Math.round(d / 1000) : Math.round(d / 100) / 10
  const text = String(km).replace('.', ',')
  return `${text} kilomètre${km >= 2 ? 's' : ''}`
}

/** « 60 m », pour l'écran. */
const metres = (m) => `${Math.max(10, Math.round(m / 10) * 10)} m`

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1)
const trimDot = (text) => text.replace(/[.\s]+$/, '')
