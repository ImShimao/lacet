// Où tourne l'app, et ce qu'elle y propose.
//
// Deux usages, deux versions :
//
// - **sur un ordinateur**, on prépare : chercher des boucles, les comparer,
//   lire le détail de leur sécurité, garder ses favoris, exporter un GPX. On ne
//   court pas avec un ordinateur — lancer un parcours, le suivi GPS, le guidage
//   vocal, le bouton SOS ou l'historique des sorties n'y ont aucun sens ;
// - **sur un téléphone**, tout : la préparation, et la sortie elle-même.
//
// La détection se trompe parfois — une tablette, un écran tactile de PC — et un
// réglage de « Mon compte » permet donc de forcer l'une ou l'autre.

import { useEffect, useState } from 'react'
import { load, save } from './storage'

/** L'app native iPhone (Capacitor), par opposition au navigateur. */
export const isNative = () =>
  typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true

/**
 * Un appareil avec lequel on court : l'app native, ou un navigateur mobile.
 *
 * Le pointeur grossier seul ne suffit pas — des PC ont un écran tactile — et la
 * largeur seule non plus — une fenêtre de navigateur peut être étroite. On
 * exige les deux, ou un navigateur qui se déclare lui-même mobile.
 */
export function detectPhone() {
  if (isNative()) return true
  if (typeof window === 'undefined') return false
  const mobileAgent = /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const small = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 600
  return mobileAgent || (coarse && small)
}

/** 'auto' | 'full' | 'planner' — le réglage choisi, pas le mode effectif. */
export const readModeSetting = () => load().appMode ?? 'auto'

export function resolveMode(setting = readModeSetting()) {
  if (setting === 'full' || setting === 'planner') return setting
  return detectPhone() ? 'full' : 'planner'
}

const listeners = new Set()

export function setModeSetting(setting) {
  save({ appMode: setting })
  for (const listener of listeners) listener()
}

/** Le mode effectif, et sa mise à jour quand le réglage change. */
export function useAppMode() {
  const [mode, setMode] = useState(() => resolveMode())
  useEffect(() => {
    const update = () => setMode(resolveMode())
    listeners.add(update)
    return () => listeners.delete(update)
  }, [])
  return mode
}

/**
 * Enregistre un fichier texte là où l'utilisateur peut le reprendre.
 *
 * Dans un navigateur, un lien de téléchargement suffit. Dans l'app native, ce
 * lien ne fait rien — WebKit ignore l'attribut `download` — et c'est la feuille
 * de partage d'iOS qui prend le relais : Fichiers, AirDrop, Strava, une montre…
 */
export async function saveTextFile(filename, text, mime) {
  if (isNative()) {
    const { shareTextFile } = await import('./native')
    return shareTextFile(filename, text, mime)
  }
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
