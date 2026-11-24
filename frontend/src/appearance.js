/**
 * L'apparence de l'app : la couleur d'accent, le thème, la taille du texte.
 *
 * Le choix se pose en attributs sur `<html>` (`data-accent`, `data-theme`,
 * `data-text`), que lisent les jetons de `styles/01-base.css` : rien d'autre à
 * repeindre, la CSS fait le reste. Il est appliqué avant le premier rendu
 * (`main.jsx`) — l'app s'ouvre directement dans ses couleurs, sans passer par
 * celles d'origine — et gardé dans le magasin de l'app, si bien que « Tout
 * effacer » l'emporte avec le reste.
 *
 * En thème automatique, `data-theme` porte le thème **résolu** (`dark` ou
 * `light`) et suit iOS en direct : la CSS n'a qu'un jeu de règles par thème, et
 * la carte, qui ne lit pas la CSS, apprend le changement par `useAppearance`.
 */

import { useSyncExternalStore } from 'react'
import { load, save } from './storage'

import { t } from './i18n'
/** Les accents proposés. La pastille se peint avec le jeton de l'accent lui-même. */
export const ACCENTS = [
  { key: 'blue', label: 'Bleu' },
  { key: 'violet', label: 'Violet' },
  { key: 'rose', label: 'Framboise' },
  { key: 'graphite', label: 'Graphite' },
]

export const THEMES = [
  { key: 'auto', label: 'Auto', title: "Comme l'iPhone" },
  { key: 'dark', label: 'Sombre' },
  { key: 'light', label: 'Clair' },
]

export const TEXT_SIZES = [
  { key: 'normal', label: 'Normale' },
  { key: 'large', label: 'Grande' },
]

export const APPEARANCE_DEFAULTS = { accent: 'blue', theme: 'auto', text: 'normal' }

const known = (list, key, fallback) => (list.some((o) => o.key === key) ? key : fallback)

/** Ce que le magasin garde, réduit aux valeurs connues : un réglage d'une autre version ne casse rien. */
function read() {
  const saved = load().appearance || {}
  return {
    accent: known(ACCENTS, saved.accent, APPEARANCE_DEFAULTS.accent),
    theme: known(THEMES, saved.theme, APPEARANCE_DEFAULTS.theme),
    text: known(TEXT_SIZES, saved.text, APPEARANCE_DEFAULTS.text),
  }
}

const lightQuery = () => (typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: light)') : null)

/** `dark` ou `light` : le thème choisi, ou celui d'iOS en automatique. */
export const resolveTheme = (theme) => (theme === 'auto' ? (lightQuery()?.matches ? 'light' : 'dark') : theme)

let current = null
const listeners = new Set()

function apply() {
  const root = document.documentElement
  current = { ...current, resolved: resolveTheme(current.theme) }
  root.dataset.accent = current.accent
  root.dataset.theme = current.resolved
  root.dataset.text = current.text
  for (const listener of listeners) listener(current)
}

let watching = false

/**
 * Relit le choix gardé et l'applique. Au lancement, puis après une
 * restauration ou un effacement : le magasin vient de changer sous l'app.
 */
export function startAppearance() {
  current = read()
  apply()
  if (!watching) {
    watching = true
    // iOS passe en sombre au coucher du soleil : en automatique, l'app suit.
    lightQuery()?.addEventListener?.('change', () => current.theme === 'auto' && apply())
  }
}

/** Change une partie de l'apparence, l'applique et la garde. */
export function setAppearance(patch) {
  if (!current) startAppearance()
  current = { ...current, ...patch }
  save({ appearance: { accent: current.accent, theme: current.theme, text: current.text } })
  apply()
}

export function getAppearance() {
  if (!current) startAppearance()
  return current
}

/** Être prévenu d'un changement — la barre d'état d'iOS, par exemple. Rend de quoi se désabonner. */
export function onAppearance(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** L'apparence du moment, dans un composant, mise à jour à chaque changement. */
export const useAppearance = () => useSyncExternalStore(onAppearance, getAppearance)
