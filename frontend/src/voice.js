// Guidage vocal, par la synthèse vocale du navigateur.
//
// Aucune dépendance, aucune clé, aucun réseau : `speechSynthesis` est présent
// sur iOS, Android et les navigateurs de bureau. Mais il a trois défauts qu'il
// faut traiter, sans quoi le guidage se tait au pire moment.
//
// **La liste des voix arrive en retard.** Sur Chrome, `getVoices()` rend un
// tableau vide au premier appel et se remplit ensuite, via un événement. Choisir
// la voix française au chargement donne donc, une fois sur deux, une voix
// anglaise qui lit « Tourne à gauche » comme un texte anglais.
//
// **iOS exige un geste de l'utilisateur.** La première `speak()` doit partir
// d'un gestionnaire d'événement tactile, sinon la synthèse reste muette pour le
// reste de la page — sans erreur. D'où `unlock()`, appelé au moment où la
// personne touche « Démarrer ».
//
// **La file d'attente ne se vide pas toute seule.** Deux consignes prononcées
// coup sur coup s'empilent, et on entend la seconde trente secondes plus tard,
// bien après avoir passé le carrefour. Une consigne de navigation périmée est
// pire que pas de consigne : on annule donc systématiquement ce qui reste.

import { isNative } from './platform'

// Dans l'app native, la voix est celle d'iOS : elle continue écran verrouillé et
// passe par-dessus la musique, là où celle du navigateur se tait dès que le
// téléphone part dans la poche. Aucune des trois précautions ci-dessus ne la
// concerne : pas de liste de voix tardive, pas de geste à attendre.
const native = isNative()
const nativeModule = native ? import('./native') : null

const synth = !native && typeof window !== 'undefined' ? window.speechSynthesis : null

let voice = null
let enabled = false
let unlocked = false
// Nombre de consignes en train d'être dites : voir `speak`.
let speaking = 0

export const available = native || Boolean(synth)

function pickVoice() {
  if (!synth) return null
  const voices = synth.getVoices()
  if (!voices.length) return null
  return (
    voices.find((v) => v.lang === 'fr-FR' && v.localService) ||
    voices.find((v) => v.lang === 'fr-FR') ||
    voices.find((v) => v.lang?.startsWith('fr')) ||
    null
  )
}

if (synth) {
  voice = pickVoice()
  // L'événement n'est pas garanti : on le prend s'il vient, et `speak` retente
  // de son côté à chaque phrase tant qu'aucune voix française n'a été trouvée.
  synth.addEventListener?.('voiceschanged', () => {
    voice = pickVoice()
  })
}

/**
 * À appeler depuis un vrai geste de l'utilisateur, une seule fois.
 * Prononce une phrase vide pour obtenir l'autorisation d'iOS.
 */
export function unlock() {
  if (!synth || unlocked) return
  try {
    const primer = new SpeechSynthesisUtterance('')
    primer.volume = 0
    synth.speak(primer)
    unlocked = true
  } catch {
    /* synthèse indisponible : le guidage restera visuel */
  }
}

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
  if (native) {
    if (enabled && text) {
      nativeModule.then(async (n) => {
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
    return
  }
  if (!synth || !enabled || !text) return
  if (!voice) voice = pickVoice()

  try {
    if (priority) synth.cancel()
    else if (synth.speaking || synth.pending) return

    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang || 'fr-FR'
    // Un peu plus rapide que la valeur par défaut : à l'allure de course, une
    // consigne dite trop lentement se termine après le carrefour.
    utterance.rate = 1.08
    utterance.pitch = 1
    synth.speak(utterance)
  } catch {
    /* la synthèse peut refuser (onglet masqué, batterie) : sans conséquence */
  }
}

export function stop() {
  if (native) {
    nativeModule.then((n) => {
      n.stopSpeechNative()
      speaking = 0
      n.unduckAudio()
    })
    return
  }
  try {
    synth?.cancel()
  } catch {
    /* rien à faire */
  }
}

/**
 * Formule la consigne à dire à `remaining` mètres d'une manœuvre.
 *
 * On ne dit pas « dans 87 mètres » : personne n'estime 87 mètres en courant.
 * Les distances sont arrondies à des repères que l'oreille retient, et
 * disparaissent quand la manœuvre est imminente.
 */
export function phrase(step, remaining) {
  // Départ, fin de tour, arrivée : ce sont déjà des phrases complètes. Les
  // préfixer d'une distance donnerait « dans 200 mètres, fin du premier tour »,
  // qui annonce un événement au lieu de le constater.
  if (step.turn === 'finish' || step.turn === 'start' || step.turn === 'lap') {
    return step.text
  }
  const rounded =
    remaining < 30
      ? null
      : remaining < 120
        ? `dans ${Math.round(remaining / 10) * 10} mètres`
        : `dans ${Math.round(remaining / 50) * 50} mètres`

  const warning = step.caution ? ' Traversée sans passage protégé.' : ''
  if (rounded) return `${rounded}, ${lower(step.text)}.${warning}`
  // **« Maintenant. »** Sans ce mot, l'annonce de loin et celle du moment
  // d'agir sont la même phrase, et l'on ne sait plus laquelle on vient
  // d'entendre : « tourne à droite » à cent mètres, puis « tourne à droite »
  // au carrefour. L'app dit deux fois la même chose et la seconde, la seule
  // qui compte, ne se distingue pas de la première.
  return `${step.text} maintenant.${warning}`
}

function lower(text) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
