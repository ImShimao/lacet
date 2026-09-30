// Guidage vocal, par la voix d'iOS.
//
// Elle continue écran verrouillé et passe par-dessus la musique — en la
// baissant le temps de la phrase. Aucune clé, aucun réseau.
//
// **La file d'attente ne se vide pas toute seule.** Deux consignes prononcées
// coup sur coup s'empilent, et on entendrait la seconde trente secondes plus
// tard, bien après avoir passé le carrefour. Une consigne de navigation périmée
// est pire que pas de consigne : chaque consigne coupe donc celle qui reste.

const nativeModule = () => import('./native')

let enabled = false
// Nombre de consignes en train d'être dites : voir `speak`.
let speaking = 0

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
  nativeModule().then(async (n) => {
    // La musique baisse le temps de la phrase, et se relève après. Le
    // compteur sert aux consignes qui s'enchaînent : la première à finir ne
    // doit pas remonter le son pendant que la suivante parle.
    speaking += 1
    await n.duckAudio()
    try {
      await n.speakNative(text, { priority })
    } finally {
      speaking -= 1
      if (speaking <= 0) {
        speaking = 0
        n.unduckAudio()
      }
    }
  })
}

export function stop() {
  nativeModule().then((n) => {
    n.stopSpeechNative()
    speaking = 0
    n.unduckAudio()
  })
}

// Ce qu'on dit, et à quel moment, est décidé dans `guidance.js` : ce module-ci
// ne fait que parler.
