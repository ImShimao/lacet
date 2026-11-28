/**
 * La langue de l'app : français ou anglais.
 *
 * **Le français est la référence et sert de clé** : `t('Mes parcours')` rend
 * « Mes parcours » en français et « My routes » en anglais. Le texte reste lisible
 * dans le code, une clé qui manque en anglais retombe d'elle-même sur le
 * français, et rien ne s'écrit deux fois. Seul `en` (`locales/en.js`) est un
 * dictionnaire ; `fr` est l'identité. Une variable s'écrit `{nom}` :
 * `t('{n} tours', { n: 3 })`.
 *
 * Par défaut, la langue d'iOS (français si elle commence par `fr`, sinon
 * anglais). Le choix est gardé dans le magasin de l'app, avec les autres
 * préférences, et change à chaud : `useLang()` fait re-rendre un composant,
 * `onLang()` prévient le reste (la voix, la carte).
 */

import { useSyncExternalStore } from 'react'
import { load, save } from './storage'
import en from './locales/en'

export const LANGUAGES = [
  { key: 'fr', label: 'Français' },
  { key: 'en', label: 'English' },
]

export const DICTIONARIES = { fr: {}, en }

/** La langue d'iOS, réduite à ce que l'app parle. */
export const systemLang = () => {
  const raw = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'fr'
  return String(raw).toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

const known = (key) => (LANGUAGES.some((l) => l.key === key) ? key : null)

let current = null
const listeners = new Set()

const resolve = () => known(load().language) ?? systemLang()

function apply(lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of listeners) listener(lang)
}

/** La langue du moment. */
export function lang() {
  if (!current) current = resolve()
  return current
}

/** Relit le choix gardé : au lancement, et quand le magasin change sous l'app. */
export function startLang() {
  apply(resolve())
}

/** Change la langue et la garde. */
export function setLang(key) {
  if (!known(key)) return
  save({ language: key })
  apply(key)
}

/** Être prévenu d'un changement. Rend de quoi se désabonner. */
export function onLang(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** La langue du moment, dans un composant : il se redessine au changement. */
export const useLang = () => useSyncExternalStore(onLang, lang)

/** La locale des dates et des nombres (`toLocaleDateString`). */
export const locale = () => (lang() === 'en' ? 'en-GB' : 'fr-FR')

/**
 * Traduit une clé (le texte français). Une variable absente de `vars` reste
 * telle quelle, avec ses accolades : on la voit, donc on la corrige.
 */
export function t(key, vars) {
  const text = (lang() === 'en' && DICTIONARIES.en[key]) || key
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? (vars[name] === false || vars[name] == null ? '' : vars[name]) : all)) : text
}

/** Le pluriel : `tn('{n} tour', '{n} tours', 2)`. Le français compte 0 et 1 au singulier, l'anglais 1 seulement. */
export const tn = (one, many, n, vars = {}) => t(n === 1 || (lang() === 'fr' && n === 0) ? one : many, { ...vars, n })

/** Traduit si c'est un texte (une étiquette peut aussi être un morceau de JSX). */
export const tx = (value) => (typeof value === 'string' ? t(value) : value)

/** Le séparateur décimal : « , » en français, « . » en anglais. */
export const dec = () => (lang() === 'en' ? '.' : ',')
