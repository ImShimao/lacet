// Le pont vers l'iPhone : ce que l'app native sait faire et qu'une page web ne
// peut pas.
//
// Trois choses justifient l'app, et elles ont toutes trait à la sortie :
//
// - **le GPS continue écran verrouillé.** Dans Safari, le suivi s'arrête dès que
//   le téléphone part dans la poche : la distance se fige, le guidage aussi.
//   L'app native garde la position à jour en arrière-plan, comme n'importe
//   quelle app de course ;
// - **la voix aussi.** La synthèse vocale du navigateur se tait en arrière-plan ;
//   celle d'iOS continue, et passe par-dessus la musique ;
// - **l'écran reste allumé** pour de bon, quand on le souhaite, là où le verrou
//   du navigateur saute au moindre changement d'onglet.
//
// Ce module n'est chargé que dans l'app native : dans un navigateur, rien de
// tout ça n'existe, et l'importer ferait charger Capacitor pour rien.

import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { AppLauncher } from '@capacitor/app-launcher'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Share } from '@capacitor/share'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech'

// Ce module-là ne s'importe pas : il se déclare, sous le nom qu'il porte côté natif.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

// Celui-ci est écrit pour Lacet, dans l'app elle-même
// (`ios-overlay/live-activity/App/LiveActivityPlugin.swift`).
const LiveActivity = registerPlugin('LiveActivity')

// --- démarrage ----------------------------------------------------------------

export async function bootNative() {
  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: Style.Dark })
  } catch {
    /* barre d'état : purement cosmétique */
  }
  // L'écran de lancement s'efface dès le premier rendu. Il s'effacerait de
  // lui-même au bout de trois secondes (`capacitor.config.json`) : c'est le
  // filet, pour qu'une erreur au démarrage laisse voir l'écran d'erreur de
  // l'app plutôt qu'un logo figé qui a l'air d'un téléphone planté.
  requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {}))
}

// --- position -----------------------------------------------------------------

/**
 * Suivi de position natif. Rend une fonction d'arrêt.
 *
 * `background` à true garde le suivi écran verrouillé — c'est ce que réclame
 * une sortie en cours, et seulement elle : en arrière-plan le GPS se paie en
 * batterie, et iOS affiche un indicateur bleu pour le signaler.
 */
export function watchPosition(onFix, onError, { background = false } = {}) {
  let id = null
  let stopped = false

  BackgroundGeolocation.addWatcher(
    {
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
      ...(background
        ? { backgroundTitle: 'Lacet', backgroundMessage: 'Suivi de ta sortie en cours.' }
        : {}),
    },
    (location, error) => {
      if (stopped) return
      if (error) {
        onError?.({
          denied: error.code === 'NOT_AUTHORIZED',
          message:
            error.code === 'NOT_AUTHORIZED'
              ? "L'accès à ta position est refusé. Autorise-le dans Réglages → Lacet → Position."
              : 'Position indisponible pour le moment.',
        })
        return
      }
      onFix({
        coords: {
          longitude: location.longitude,
          latitude: location.latitude,
          accuracy: location.accuracy,
          altitude: location.altitude,
          speed: location.speed,
          heading: location.bearing ?? null,
        },
        timestamp: location.time ?? Date.now(),
      })
    },
  ).then((watcherId) => {
    id = watcherId
    if (stopped) BackgroundGeolocation.removeWatcher({ id }).catch(() => {})
  })

  return () => {
    stopped = true
    if (id !== null) BackgroundGeolocation.removeWatcher({ id }).catch(() => {})
  }
}

export const openLocationSettings = () => BackgroundGeolocation.openSettings().catch(() => {})

// --- voix ---------------------------------------------------------------------

/**
 * Consigne dite par la voix d'iOS. `QueueStrategy.Flush` coupe la phrase en
 * cours : une consigne de navigation périmée est pire que pas de consigne.
 *
 * La session audio (lecture en arrière-plan, mélange avec la musique, mode
 * silencieux ignoré) est réglée au lancement de l'app, côté natif : le module
 * de synthèse ne le fait pas lui-même.
 */
export function speakNative(text, { priority = true } = {}) {
  return TextToSpeech.speak({
    text,
    lang: 'fr-FR',
    rate: 1.05,
    pitch: 1,
    volume: 1,
    queueStrategy: priority ? QueueStrategy.Flush : QueueStrategy.Add,
  }).catch(() => {})
}

export const stopSpeechNative = () => TextToSpeech.stop().catch(() => {})

/**
 * Baisse la musique le temps d'une consigne, et la remet ensuite.
 *
 * Sans ça, la voix passe *par-dessus* le morceau sans le baisser : au volume
 * où l'on écoute en courant, « tourne à droite » se perd dans le refrain.
 */
export const duckAudio = () => LiveActivity.duck().catch(() => {})
export const unduckAudio = () => LiveActivity.unduck().catch(() => {})

// --- écran, vibration ---------------------------------------------------------

export const keepScreenOn = () => KeepAwake.keepAwake().catch(() => {})
export const allowScreenOff = () => KeepAwake.allowSleep().catch(() => {})

/** L'alerte de traversée : une vibration d'avertissement, perceptible en courant. */
export const warnHaptic = () => Haptics.notification({ type: NotificationType.Warning }).catch(() => {})

/** La pause automatique : un seul coup, franc, distinct de l'alerte de traversée. */
export const pulseHaptic = () => Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})

// --- écran de verrouillage ------------------------------------------------------

/**
 * L'activité en direct d'une sortie guidée : la consigne à venir et le temps
 * restant, sur l'écran de verrouillage et dans la Dynamic Island.
 *
 * Rend `{ started, reason }`. L'échec n'arrête rien — le guidage vocal et
 * l'écran de l'app n'en dépendent pas — mais il se raconte : sans la raison,
 * un écran de verrouillage vide n'a aucune explication, et on ne sait pas s'il
 * faut changer un réglage, mettre iOS à jour, ou réinstaller l'app.
 */
export async function startLiveActivity(state) {
  try {
    const { available } = await LiveActivity.available()
    if (!available) return { started: false, reason: 'coupées dans Réglages, ou iOS trop ancien' }
    const { started, count, reason } = await LiveActivity.start(state)
    return started === true
      ? { started: true, count: count ?? null, reason: null }
      : { started: false, reason: reason || 'refus sans explication d’iOS' }
  } catch (error) {
    return { started: false, reason: error?.message || 'module natif injoignable' }
  }
}

export const updateLiveActivity = (state) => LiveActivity.update(state).catch(() => {})
export const endLiveActivity = () => LiveActivity.end().catch(() => {})

/**
 * Ce que l'écran de verrouillage peut afficher — ou `null` si l'app a été
 * compilée sans le module :
 *
 * - `supported` : iOS 16.2 ou plus ;
 * - `enabled` : les activités en direct autorisées dans Réglages ;
 * - `extension` : le paquet qui les dessine est bien dans l'app installée ;
 * - `nested` : et il lui est encore **rattaché**. Un installateur hors App
 *   Store qui renomme l'app rompt ce lien sans rien retirer : iOS accepte alors
 *   l'activité et ne dessine rien ;
 * - `signedExtension` : et elle a reçu **sa** signature. Un installateur qui
 *   signe l'app sans signer son extension donne une activité acceptée par iOS
 *   et dessinée par personne ;
 * - `bundle`, `extensionBundle` : les deux identifiants, pour le dire en clair.
 */
export const lockScreenStatus = () => LiveActivity.status().catch(() => null)

/**
 * La version de l'app installée : `{ version, build }`.
 *
 * Celle du paquet iOS, pas celle de l'interface web qu'il contient. Comparer
 * les deux dit tout de suite si un téléphone tourne sur une vieille
 * installation, ou sur une page gardée en cache.
 */
export const appVersion = () => App.getInfo().catch(() => null)

// --- fichiers, liens ----------------------------------------------------------

/** Ouvre un lien d'une autre app — la messagerie pour le SOS. */
export const openExternal = (url) => AppLauncher.openUrl({ url })

/** Écrit un fichier et ouvre la feuille de partage d'iOS pour l'emporter. */
export async function shareTextFile(filename, text, mime) {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  await Share.share({ title: filename, url: uri, dialogTitle: mime })
}

export async function shareText(title, text) {
  await Share.share({ title, text })
}
