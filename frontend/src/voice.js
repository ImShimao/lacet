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

const nativeModule = () => import('./native')

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
 */
export function speak(text, { priority = true } = {}) {
  if (!enabled || !text) return
  nativeModule().then((n) => n.speakNative(text, { priority }))
}

export function stop() {
  nativeModule().then((n) => n.stopSpeechNative())
}

// Ce qu'on dit, et à quel moment, est décidé dans `guidance.js` : ce module-ci
// ne fait que parler.
