import { useState } from 'react'
import { keyOf } from './offlineMaps'
import { MAX_FAVORITES, MAX_HISTORY, MAX_PLACES, MAX_TRACKS, brief, load, save, slim, wipe } from './storage'

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
 * toute l'app, et c'est ce qui dicte leurs plafonds — définis dans
 * `storage.js`, à côté du quota et de leur mesure.
 *
 * Un plafond atteint ne retire plus rien en silence. Le favori le plus ancien
 * et le départ nommé de trop partaient sans un mot — souvent le premier gardé,
 * « Chez moi », celui qu'on refait le plus : on refuse donc le nouveau, et on
 * dit où faire de la place. Une sortie, elle, se garde toujours ; c'est la plus
 * ancienne qui part, et l'app le dit. Ce qu'elle dit attend dans `notice`.
 */

export default function useLibrary(stored = load()) {
  const [saved, setSaved] = useState(stored.favorites || [])
  const [history, setHistory] = useState(stored.history || [])
  const [places, setPlaces] = useState(stored.places || [])
  // Ce qu'un plafond vient de refuser ou de retirer, à dire : `{ list, text }`.
  const [notice, setNotice] = useState(null)

/**
 * Reconnaître une sortie dans la liste.
 *
 * L'identité de l'objet ne suffit pas : renommer une sortie en crée une copie,
 * et l'écran qui la montre garde alors la copie. Supprimer juste après ne
 * trouvait plus rien à supprimer. L'instant de départ, lui, ne change jamais.
 */
const meme = (a, b) => a === b || (Boolean(a?.ranAt) && a.ranAt === b?.ranAt)

/**
 * Pose une liste **et** l'écrit : les deux ne doivent jamais se séparer. Ce
 * qu'un plafond avait dit auparavant ne vaut plus : la liste a bougé.
 */
  const put = (cle, valeur, poser) => {
    poser(valeur)
    save({ [cle]: valeur })
    setNotice(null)
    return valeur
  }

  /** Le favori de trop : refusé, et l'on dit où faire de la place. */
  const favoritesFull = (route) => {
    setNotice({
      list: 'favorites',
      text: `${MAX_FAVORITES} favoris, c'est le plafond : « ${route.name} » n'est pas gardé. Retire d'abord un favori — glisse sa ligne vers la gauche.`,
    })
    return saved
  }

  return {
    saved,
    history,
    places,
    notice,

    /** L'avis lu, ou devenu sans objet. */
    dismiss: () => setNotice(null),

    /** Ce parcours est-il en favori ? Comparé par emprise, pas par identifiant. */
    isFavorite: (route) => Boolean(route) && saved.some((r) => keyOf(r) === keyOf(route)),

    /** Met un parcours en favori, ou l'en retire. */
    toggleFavorite(route) {
      if (!route) return saved
      const cle = keyOf(route)
      if (saved.some((r) => keyOf(r) === cle)) return put('favorites', saved.filter((r) => keyOf(r) !== cle), setSaved)
      if (saved.length >= MAX_FAVORITES) return favoritesFull(route)
      return put('favorites', [slim(route), ...saved], setSaved)
    },

    /** Garde un parcours en favori, en remplaçant sa version précédente. */
    keepRoute(route) {
      const autres = saved.filter((r) => r.id !== route.id)
      if (autres.length >= MAX_FAVORITES) return favoritesFull(route)
      return put('favorites', [slim(route), ...autres], setSaved)
    },

    /**
     * Range une sortie terminée, et rend l'entrée telle qu'elle a été gardée.
     *
     * Au-delà des vingt-cinq dernières, une sortie n'est plus que son résumé
     * (`brief`) : la trace, la voix et le parcours prévu en faisaient l'essentiel
     * du poids. Au plafond, la plus ancienne laisse sa place — jamais la
     * nouvelle, qu'on vient de courir —, et l'app le dit.
     */
    remember(entry) {
      const toutes = [entry, ...history]
      const suite = toutes.slice(0, MAX_HISTORY).map((sortie, i) => (i < MAX_TRACKS ? sortie : brief(sortie)))
      put('history', suite, setHistory)
      const partie = toutes[MAX_HISTORY]
      if (partie) {
        const jour = new Date(partie.ranAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        setNotice({
          list: 'history',
          text: `Lacet garde les ${MAX_HISTORY.toLocaleString('fr-FR')} dernières sorties : celle du ${jour}, la plus ancienne, a laissé sa place à celle-ci.`,
        })
      }
      return entry
    },

    /**
     * Renomme une sortie, ou un favori.
     *
     * Vingt lignes « Sortie libre » ne se distinguent que par leur date. Le nom
     * est ce qu'on lit d'abord dans la liste, et c'est le seul champ qu'on
     * puisse vouloir corriger après coup — « Course du club », « Le tour du
     * lac », « Reconnaissance du parcours ». Un favori gardait à vie son nom
     * automatique, « Boucle est · Orschwihrerweg ».
     *
     * Une sortie a une heure de départ, un favori n'en a pas : c'est ce qui dit
     * dans quelle liste chercher. Le renommé garde sa clé d'avant (`keyOf`), sans
     * quoi il perdait sa carte hors ligne et son cœur.
     */
    rename(entry, nom) {
      const propre = String(nom ?? '').trim().slice(0, 60)
      if (!propre || propre === entry.name) return
      const renomme = (r) => ({ ...r, name: propre, key: keyOf(r) })
      if (entry.ranAt) return put('history', history.map((s) => (meme(s, entry) ? renomme(s) : s)), setHistory)
      const cle = keyOf(entry)
      return put('favorites', saved.map((r) => (keyOf(r) === cle ? renomme(r) : r)), setSaved)
    },

    /** Note une sortie après coup : son ressenti, une ligne libre. */
    annotate(entry, patch) {
      return put('history', history.map((s) => (meme(s, entry) ? { ...s, ...patch } : s)), setHistory)
    },

    /** Retire une sortie — un test, un départ déclenché dans la poche — ou un favori. */
    forget(entry) {
      if (entry.ranAt) return put('history', history.filter((sortie) => !meme(sortie, entry)), setHistory)
      const cle = keyOf(entry)
      return put('favorites', saved.filter((r) => keyOf(r) !== cle), setSaved)
    },

    /** Garde un départ sous un nom : « chez moi », « le club ». */
    keepPlace(place) {
      if (places.length >= MAX_PLACES) {
        setNotice({
          list: 'places',
          text: `${MAX_PLACES} départs nommés, c'est le plafond : « ${place.name} » n'est pas gardé. Oublie d'abord un départ, avec la croix à côté de son nom dans le menu du départ.`,
        })
        return places
      }
      return put('places', [place, ...places], setPlaces)
    },

    dropPlace(id) {
      return put('places', places.filter((p) => p.id !== id), setPlaces)
    },

    /** Tout effacer, quand « Mon compte » le demande — voir `wipe`. */
    clear() {
      wipe()
      setSaved([])
      setHistory([])
      setPlaces([])
      setNotice(null)
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
