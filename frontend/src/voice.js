// Guidage vocal, par la voix d'iOS.
//
// Elle continue écran verrouillé et passe par-dessus la musique — en la
// baissant le temps de la phrase, puis en la rendant. Aucune clé, aucun réseau.
//
// **La file d'attente ne se vide pas toute seule.** Deux consignes prononcées
// coup sur coup s'empilent, et on entendrait la seconde trente secondes plus
// tard, bien après avoir passé le carrefour. Une consigne de navigation périmée
// est pire que pas de consigne : chaque consigne coupe donc celle qui reste.
//
// **La musique se règle côté natif** (`VoicePlugin.swift`), sur ce que la voix
// fait vraiment. Elle était baissée ici, autour de chaque phrase, et remontée
// quand la synthèse signalait la fin : une seule fin perdue — une consigne qui
// en coupait une autre suffisait — et la musique restait en sourdine jusqu'au
// bout de la sortie.

import { load } from './storage'

import { t, locale } from './i18n'
const nativeModule = () => import('./native')

/**
 * Ce que la voix dit de confort, réglé dans « Mon compte › Pendant la sortie ».
 *
 * `km` : une borne sur combien (1, 2), 0 pour les taire. `lap`, `pace`,
 * `total` : le temps du dernier kilomètre, l'allure moyenne, le temps couru.
 * `target` : dire, à chaque kilomètre, l'écart à l'allure demandée — à part,
 * pour pouvoir la couper sans toucher aux kilomètres.
 * `lead` : l'annonce d'un virage plus tôt ou plus tard. Seul le confort se
 * règle : les alertes de traversée, l'écart du parcours et le « maintenant »
 * d'un virage se disent toujours, et au même moment.
 */
export const VOICE_DEFAULTS = {
  km: 1,
  lap: true,
  pace: true,
  total: false,
  target: true,
  lead: 'normal',
  // La voix de l'iPhone choisie (`voicesNative`), `null` pour celle du système,
  // et son débit : `slow`, `normal`, `fast` (`RATE`).
  voiceId: null,
  rate: 'normal',
  // Pendant une phrase, la musique baisse (`duck`) ou s'arrête (`pause`) ; et
  // le volume de la voix, relatif à celui de l'iPhone (`VOLUME`).
  music: 'duck',
  volume: 'high',
  // Le temps couru, redit toutes les N minutes (0 : jamais), en plus des bornes.
  timeEvery: 0,
}

/** Le débit de la voix, en multiple du débit d'origine. */
export const RATE = { slow: 0.85, normal: 1, fast: 1.15 }

/** Le volume de la voix : fort par défaut, comme avant ce réglage. */
export const VOLUME = { low: 0.5, medium: 0.75, high: 1 }

/** L'avance de l'annonce d'un virage : une trentaine de secondes, ou plus, ou moins. */
export const LEAD = { early: 1.5, normal: 1, late: 0.6 }

export const voiceSettings = () => ({ ...VOICE_DEFAULTS, ...load().voice })

let enabled = false

export function setEnabled(value) {
  enabled = Boolean(value)
  if (!enabled) stop()
}

/**
 * Dit une phrase, en annulant celle qui serait encore en cours.
 *
 * `priority` à false laisse passer une phrase en cours — pour les annonces de
 * confort (kilomètre franchi) qui ne doivent pas couper une consigne de
 * navigation.
 *
 * Rend `true` quand la phrase part vers la voix : c'est ce que garde le journal
 * de la sortie (`LiveRun.jsx`).
 */
export function speak(text, { priority = true } = {}) {
  if (!enabled || !text) return false
  nativeModule().then((n) => n.speakNative(text, { priority, ...spokenWith(voiceSettings()) }))
  return true
}

/**
 * Fait entendre la voix réglée, hors sortie : le bouton « Écouter » des
 * réglages. Passe outre `enabled`, qui ne vaut que pendant une sortie.
 */
export function preview(text = t('Dans deux cents mètres, tourne à gauche.')) {
  nativeModule().then((n) => n.speakNative(text, spokenWith(voiceSettings())))
}

/** Comment la voix parle, d'après les réglages : ce que reçoit le module natif. */
export const spokenWith = ({ voiceId, rate, music, volume }) => ({
  voice: voiceId,
  rate: RATE[rate] ?? 1,
  music: music === 'pause' ? 'pause' : 'duck',
  volume: VOLUME[volume] ?? 1,
  lang: locale(),
})

export function stop() {
  nativeModule().then((n) => n.stopSpeechNative())
}

// Ce qu'on dit, et à quel moment, est décidé dans `guidance.js` : ce module-ci
// ne fait que parler.
