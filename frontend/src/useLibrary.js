import { useState } from 'react'
import { keyOf } from './offlineMaps'
import { load, save, slim } from './storage'

/**
 * Ce que l'app garde de toi : les favoris, les sorties, les départs nommés.
 *
 * Ces trois listes vivaient dans `App.jsx`, au milieu de quarante autres
 * états, et chaque endroit qui les modifiait réécrivait la même paire de
 * lignes — poser l'état, puis appeler `save`. Oublier la seconde ne cassait
 * rien de visible : tout marchait jusqu'au prochain lancement.
 *
 * Elles sont ici parce qu'elles partagent une contrainte que le reste de
 * l'app n'a pas : **la place**. Le navigateur n'accorde que cinq mégaoctets à
 * toute l'app, un parcours gardé en pèse cinquante kilooctets, et c'est ce qui
 * dicte les trois plafonds ci-dessous. Les garder au même endroit que les
 * listes qu'ils bornent est la seule façon qu'ils restent cohérents.
 */

// Quarante favoris, deux cents sorties : au-delà, la liste ne se parcourt plus
// et la place manque. Les traces, elles, ne suivent que les vingt-cinq
// dernières sorties — c'est la partie lourde, et celle qu'on ne rouvre pas.
const MAX_FAVORITES = 40
const MAX_HISTORY = 200
const MAX_TRACKS = 25
// Chez soi, le bureau, le club, deux coins de vacances : huit suffit, et une
// liste plus longue ne se lirait plus d'un coup d'œil.
const MAX_PLACES = 8

export default function useLibrary(stored = load()) {
  const [saved, setSaved] = useState(stored.favorites || [])
  const [history, setHistory] = useState(stored.history || [])
  const [places, setPlaces] = useState(stored.places || [])

/**
 * Reconnaître une sortie dans la liste.
 *
 * L'identité de l'objet ne suffit pas : renommer une sortie en crée une copie,
 * et l'écran qui la montre garde alors la copie. Supprimer juste après ne
 * trouvait plus rien à supprimer. L'instant de départ, lui, ne change jamais.
 */
const meme = (a, b) => a === b || (Boolean(a?.ranAt) && a.ranAt === b?.ranAt)

/** Pose une liste **et** l'écrit : les deux ne doivent jamais se séparer. */
  const put = (cle, valeur, poser) => {
    poser(valeur)
    save({ [cle]: valeur })
    return valeur
  }

  return {
    saved,
    history,
    places,

    /** Ce parcours est-il en favori ? Comparé par emprise, pas par identifiant. */
    isFavorite: (route) => Boolean(route) && saved.some((r) => keyOf(r) === keyOf(route)),

    /** Met un parcours en favori, ou l'en retire. */
    toggleFavorite(route) {
      if (!route) return saved
      const cle = keyOf(route)
      const existe = saved.some((r) => keyOf(r) === cle)
      const suite = existe
        ? saved.filter((r) => keyOf(r) !== cle)
        : [slim(route), ...saved].slice(0, MAX_FAVORITES)
      return put('favorites', suite, setSaved)
    },

    /** Garde un parcours en favori, en remplaçant sa version précédente. */
    keepRoute(route) {
      const suite = [slim(route), ...saved.filter((r) => r.id !== route.id)].slice(0, MAX_FAVORITES)
      return put('favorites', suite, setSaved)
    },

    /**
     * Range une sortie terminée, et rend l'entrée telle qu'elle a été gardée.
     *
     * Les traces des sorties anciennes tombent : une trace pèse quelques
     * dizaines de kilooctets, et c'est par elles que le stockage se remplit.
     */
    remember(entry) {
      const suite = [entry, ...history]
        .map((sortie, i) => (i < MAX_TRACKS ? sortie : { ...sortie, track: null }))
        .slice(0, MAX_HISTORY)
      put('history', suite, setHistory)
      return entry
    },

    /**
     * Renomme une sortie.
     *
     * Vingt lignes « Sortie libre » ne se distinguent que par leur date. Le nom
     * est ce qu'on lit d'abord dans la liste, et c'est le seul champ qu'on
     * puisse vouloir corriger après coup — « Course du club », « Le tour du
     * lac », « Reconnaissance du parcours ».
     */
    rename(entry, nom) {
      const propre = String(nom ?? '').trim().slice(0, 60)
      if (!propre || propre === entry.name) return history
      return put('history', history.map((s) => (meme(s, entry) ? { ...s, name: propre } : s)), setHistory)
    },

    /**
     * Ajoute des champs à une sortie gardée — son envoi sur Strava.
     *
     * Relue sur le disque plutôt que dans l'état : l'envoi se termine quelques
     * secondes après avoir été lancé, et une sortie rangée entre-temps ne doit
     * pas disparaître sous une liste d'avant.
     */
    patch(entry, fields) {
      const current = load().history || history
      return put('history', current.map((s) => (meme(s, entry) ? { ...s, ...fields } : s)), setHistory)
    },

    /** Retire une sortie — un test, un départ déclenché dans la poche. */
    forget(entry) {
      return put('history', history.filter((sortie) => !meme(sortie, entry)), setHistory)
    },

    /** Garde un départ sous un nom : « chez moi », « le club ». */
    keepPlace(place) {
      return put('places', [place, ...places].slice(0, MAX_PLACES), setPlaces)
    },

    dropPlace(id) {
      return put('places', places.filter((p) => p.id !== id), setPlaces)
    },

    /** Tout effacer, quand « Mon compte » le demande. */
    clear() {
      save({ favorites: [], history: [] })
      setSaved([])
      setHistory([])
    },

    /**
     * Relit les trois listes sur le disque — après la restauration d'une
     * sauvegarde, qui les y a écrites sans passer par ici.
     *
     * Sans cette relecture, l'écran gardait les listes d'avant, et la première
     * écriture suivante — un favori, une sortie terminée — les réécrivait
     * par-dessus celles qu'on venait de restaurer.
     */
    reload() {
      const disk = load()
      setSaved(disk.favorites || [])
      setHistory(disk.history || [])
      setPlaces(disk.places || [])
    },
  }
}
