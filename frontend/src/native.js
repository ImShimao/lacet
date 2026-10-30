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

// Ce module-là ne s'importe pas : il se déclare, sous le nom qu'il porte côté natif.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

// Ceux-ci sont écrits pour Lacet, dans l'app elle-même
// (`ios-overlay/live-activity/App/` : `LiveActivityPlugin.swift`,
// `AltimeterPlugin.swift`, `VoicePlugin.swift`, `CompassPlugin.swift`).
const LiveActivity = registerPlugin('LiveActivity')
const Altimeter = registerPlugin('Altimeter')
const Voice = registerPlugin('Voice')
const Compass = registerPlugin('Compass')

// --- démarrage ----------------------------------------------------------------

/**
 * Le texte de la barre d'état selon le thème de l'app : `Style.Dark` désigne,
 * chez Capacitor, un texte **clair** pour un fond sombre.
 */
export function setStatusBarTheme(theme) {
  StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark }).catch(() => {
    /* barre d'état : purement cosmétique */
  })
}

export async function bootNative() {
  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
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
          altitudeAccuracy: location.altitudeAccuracy ?? null,
          speed: location.speed,
          heading: location.bearing ?? null,
        },
        timestamp: location.time ?? Date.now(),
      })
    },
  ).then(
    (watcherId) => {
      id = watcherId
      if (stopped) BackgroundGeolocation.removeWatcher({ id }).catch(() => {})
    },
    // Le module lui-même refuse — pas une position manquante, un suivi qui ne
    // démarrera jamais. Sans ce retour, l'écran de course restait sur
    // « Acquisition du signal GPS… » pour toujours, sans une explication.
    () => {
      if (!stopped) onError?.({ denied: false, message: 'Le suivi de position ne démarre pas. Ferme et rouvre l’app.' })
    },
  )

  return () => {
    stopped = true
    if (id !== null) BackgroundGeolocation.removeWatcher({ id }).catch(() => {})
  }
}

// --- boussole -----------------------------------------------------------------

/**
 * Où pointe le téléphone, en degrés depuis le nord : `onHeading(cap)` à chaque
 * changement de plus de trois degrés. Rend une fonction d'arrêt.
 *
 * Une installation d'avant la boussole, ou un appareil sans magnétomètre, ne
 * rappelle jamais : le point reste un point.
 */
export function watchCompass(onHeading) {
  let stopped = false
  let listener = null
  Compass.addListener('heading', ({ heading }) => {
    if (!stopped) onHeading(heading)
  }).then(
    (handle) => {
      listener = handle
      if (stopped) handle.remove()
    },
    () => {},
  )
  Compass.start().catch(() => {})
  return () => {
    stopped = true
    listener?.remove()
    Compass.stop().catch(() => {})
  }
}

// --- voix ---------------------------------------------------------------------

/**
 * Consigne dite par la voix d'iOS, en français.
 *
 * `priority` coupe la phrase en cours — une consigne périmée est pire que pas
 * de consigne ; sans lui, la phrase attend son tour. La musique baisse le temps
 * de la phrase et remonte dès que la voix s'est tue : c'est le module natif qui
 * s'en charge (`VoicePlugin.swift`), sur ce que la voix fait vraiment.
 */
export const speakNative = (text, { priority = true } = {}) =>
  Voice.speak({ text, flush: priority }).catch(() => {})

/** Se tait, et rend le son aux autres apps. */
export const stopSpeechNative = () => Voice.stop().catch(() => {})

// --- écran, vibration ---------------------------------------------------------

export const keepScreenOn = () => KeepAwake.keepAwake().catch(() => {})
export const allowScreenOff = () => KeepAwake.allowSleep().catch(() => {})

/** L'alerte de traversée : une vibration d'avertissement, perceptible en courant. */
export const warnHaptic = () => Haptics.notification({ type: NotificationType.Warning }).catch(() => {})

/** La pause automatique : un seul coup, franc, distinct de l'alerte de traversée. */
export const pulseHaptic = () => Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {})

/** Le compte à rebours : un tapotement léger par chiffre, pas un coup. */
export const tickHaptic = () => Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})

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
/** Termine l'activité — sur `final`, laissé un quart d'heure, ou tout de suite. */
export const endLiveActivity = (final = null) => LiveActivity.end(final ?? {}).catch(() => {})

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

// --- baromètre ------------------------------------------------------------------

/**
 * Le dénivelé mesuré au baromètre, cumulé côté natif pendant la sortie.
 *
 * `startAltimeter` remet le cumul à zéro et rend `{ available }` ;
 * `readAltimeter` et `stopAltimeter` rendent `{ ascent, descent, samples,
 * error? }`. Tous rendent `null` quand le module manque — une installation
 * d'avant le baromètre : la sortie se rabat alors sur l'altitude du GPS.
 */
export const startAltimeter = () => Altimeter.start().catch(() => null)
export const readAltimeter = () => Altimeter.read().catch(() => null)
export const stopAltimeter = () => Altimeter.stop().catch(() => null)

// --- fichiers, liens ----------------------------------------------------------

/**
 * Ouvre un lien d'une autre app — la messagerie, pour le SOS. Rend
 * `{ completed }` : faux quand aucune app ne sait l'ouvrir.
 */
export const openExternal = (url) => AppLauncher.openUrl({ url })

// La copie des favoris, des sorties et des réglages — voir `storage.js`. Dans
// `Library` sans sauvegarde iCloud : iOS ne la vide pas comme le stockage de la
// WebView, elle n'apparaît pas dans l'app Fichiers, et elle ne quitte pas
// l'appareil — ce que « Mon compte » promet.
const STORE_COPY = { path: 'lacet-store.json', directory: Directory.LibraryNoCloud, encoding: Encoding.UTF8 }

export const writeStoreCopy = (text) => Filesystem.writeFile({ ...STORE_COPY, data: text }).catch(() => {})

/** Le texte de la copie, ou `null` s'il n'y en a pas. */
export const readStoreCopy = () => Filesystem.readFile(STORE_COPY).then(({ data }) => data, () => null)

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
