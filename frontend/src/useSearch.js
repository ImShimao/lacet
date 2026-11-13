import { useEffect, useMemo, useRef, useState } from 'react'
import { generateLoops } from './api'
import { prefetchOnDevice } from './engine/client'
import { haversineM } from './engine/geo'
import { formatKm } from './FiltersSheet.jsx'
import { save } from './storage'

/**
 * Chercher des boucles, et ce qu'il faut tenir pendant ce temps-là.
 *
 * Le calcul se fait sur l'appareil et dure de une à dix secondes selon qu'il
 * faut d'abord télécharger les rues. Pendant ce temps, l'écran doit montrer
 * une étape, encaisser une deuxième demande, et finir par afficher **la
 * bonne** — pas la plus lente. Trois règles sortent de là, qui vivaient au
 * milieu d'App.jsx :
 *
 * **Le jeton.** Une recherche lancée pendant qu'une autre calcule la remplace.
 * Sans lui, la plus lente des deux gagnait, et l'écran montrait des boucles
 * pour un réglage qu'on venait de changer.
 *
 * **L'élargissement.** Rien à ±2,5 % ? Plutôt qu'un écran vide, on refait la
 * demande sans la tolérance et on le dit : le réseau de rues ne se plie pas
 * toujours au mètre près, et une boucle de 20,4 km vaut mieux que pas de sortie.
 *
 * **Le repère qui rejoint la rue.** La boucle part de la rue, devant le point
 * posé — le trottoir devant la maison, pas le salon (voir `engine/door.js`) —,
 * et le repère l'y rejoint. Quelques mètres ne se remarquent pas ; au-delà de
 * cinquante — un point posé au milieu d'un champ —, l'écart est annoncé
 * plutôt que subi.
 */

// Sous cinquante mètres, le repère bouge de l'épaisseur d'un doigt et personne
// ne le remarque. Au-delà, il saute sous les yeux : mieux vaut dire pourquoi.
const VISIBLE_SNAP_M = 50

export default function useSearch() {
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  // Ce qui occupe : `'search'`, une recherche — qu'on peut abandonner —, ou
  // `'work'`, la reconnaissance d'un fichier importé, qui ne s'abandonne pas.
  const [busy, setBusy] = useState(false)
  // L'étape en cours et son avancement. Sans indication, une première recherche
  // dans une grande ville ressemblerait à une app bloquée.
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  // De combien le repère a rejoint la rue, quand c'est assez pour se voir.
  const [snapped, setSnapped] = useState(null)
  // La position lue sur le profil d'altitude, montrée sur la carte.
  const [scrub, setScrub] = useState(null)
  const token = useRef(0)

  /**
   * Oublie les propositions : le départ a bougé, et elles ne répondent plus à
   * la question posée. Elles restaient pourtant à l'écran — on choisissait un
   * village suisse et la carte montrait le Valais sous une carte intitulée
   * « Boucle sud-ouest · avenue des Gobelins ».
   */
  const forget = () => {
    setResult(null)
    setSelected(null)
    setScrub(null)
    setSnapped(null)
  }

  /**
   * Abandonne la recherche en cours et revient à l'accueil. Hors des archives,
   * l'attente peut durer une minute, et l'écran le dit lui-même : sans ce
   * geste, il ne restait qu'à fermer l'app. Le calcul, lui, continue dans le
   * worker, que rien n'interrompt ; mais le jeton change, et sa réponse, quand
   * elle arrive, ne trouve plus personne pour l'afficher.
   */
  const cancel = () => {
    token.current += 1
    setBusy(false)
    setProgress(null)
    forget()
  }

  return {
    result,
    selected,
    busy,
    progress,
    error,
    snapped,
    scrub,

    setSelected,
    setScrub,
    forget,
    // Seulement pendant une recherche : la reconnaissance d'un fichier finit,
    // elle, par l'ouvrir, abandonnée ou non.
    cancel: busy === 'search' ? cancel : null,

    /** Montre un parcours seul — un favori rouvert, un fichier importé. */
    show(route) {
      setResult({ routes: [route], rejected: [], meta: {} })
      setSelected(route)
    },
    /**
     * Remplace un parcours de la liste par sa nouvelle version — la même
     * boucle retournée, par exemple, qui garde sa place et reste choisie.
     */
    swap(id, route) {
      setResult((r) => (r ? { ...r, routes: r.routes.map((x) => (x.id === id ? route : x)) } : r))
      setSelected(route)
    },
    fail(message, offline = false) {
      setError({ message, offline })
    },
    /**
     * Un travail long qui n'est pas une recherche — reconnaître les rues d'un
     * fichier importé. Même barre d'attente, mêmes étapes.
     */
    async working(tache) {
      setBusy('work')
      setProgress({ stage: 'data', fraction: 0 })
      try {
        return await tache((stage, fraction) => setProgress({ stage, fraction }))
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },

    /**
     * Lance une recherche. `onStart` reçoit le point où la boucle commence
     * vraiment, quand il diffère de celui qu'on avait posé.
     *
     * Rend le résultat affiché, ou `null` si une autre recherche a pris la
     * main entre-temps.
     */
    async run(request, { from = null, onStart = null } = {}) {
      setBusy('search')
      setProgress(null)
      setError(null)
      setResult(null)
      setSelected(null)
      setSnapped(null)
      setScrub(null)

      const mien = ++token.current
      const etape = (stage, fraction) => {
        if (mien === token.current) setProgress({ stage, fraction })
      }
      try {
        let payload = await generateLoops(request, etape)
        if (!payload.routes.length && request.tolerance) {
          const { tolerance, ...large } = request
          const relache = await generateLoops(large, etape)
          if (relache.routes.length) {
            payload = {
              ...relache,
              meta: {
                ...relache.meta,
                relaxed: true,
                message: `Aucune boucle à ±2,5 % de ${formatKm(request.distance_km)} km depuis ce départ : voici les plus proches, à ±10 %.`,
              },
            }
          }
        }
        if (mien !== token.current) return null

        // Le détail du temps passé, gardé pour « Mon compte ». Mesurer sur le
        // téléphone est le seul moyen de savoir ce qui traîne vraiment : un PC
        // de bureau construit un graphe trois fois plus vite qu'un iPhone.
        if (payload.meta?.timings_s) {
          save({
            lastSearch: {
              at: Date.now(),
              km: request.distance_km,
              total: payload.meta.elapsed_s,
              ...payload.meta.timings_s,
              nodes: payload.meta.graph_nodes,
              sources: payload.meta.sources ?? null,
            },
          })
        }

        const commence = payload.routes[0]?.geometry?.[0]
        if (commence) {
          const point = { lat: commence[1], lon: commence[0] }
          const ecart = from ? haversineM([from.lon, from.lat], [point.lon, point.lat]) : 0
          if (ecart > 1) onStart?.(point)
          setSnapped(ecart > VISIBLE_SNAP_M ? Math.round(ecart) : null)
        }

        // La demande reste attachée au résultat : c'est avec elle qu'un chemin
        // de retour se calcule, en course, si l'on s'écarte du parcours.
        const affiche = { ...payload, request }
        setResult(affiche)
        setSelected(payload.routes[0] || null)
        return affiche
      } catch (err) {
        if (mien !== token.current) return null
        // On garde l'erreur entière : hors ligne, « réessayer » ne sert à rien
        // et il vaut mieux renvoyer vers les parcours déjà enregistrés.
        setError({ message: err.message, offline: Boolean(err.offline) })
        return null
      } finally {
        if (mien === token.current) {
          setBusy(false)
          setProgress(null)
        }
      }
    },
  }
}

// Une demi-seconde suffit à ne pas déclencher dix téléchargements pour un
// repère qu'on traîne sur la carte, et c'est une demi-seconde de moins à
// rattraper pour qui ouvre l'app et lance sa recherche dans la foulée — le cas
// d'un coin jamais visité, justement celui où les rues sont longues à venir.
const PREFETCH_DELAY_MS = 600

/**
 * Les rues de la zone, téléchargées et mises en graphe **avant** qu'on cherche.
 *
 * La recherche qui suit les trouve prêts — voir `engine/worker.js`. Rien sans
 * réseau, ni quand le téléphone demande d'économiser les données : préparer est
 * un confort, et il ne doit jamais coûter un forfait.
 */
export function usePrefetch(key, paused = false) {
  const [prepared, setPrepared] = useState(null)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!key || paused) return undefined
    const reseau = typeof navigator !== 'undefined' ? navigator : {}
    if (reseau.onLine === false || reseau.connection?.saveData) return undefined
    let annule = false
    const minuteur = setTimeout(async () => {
      // Le dire pendant que ça se fait : dans un coin jamais visité, la
      // préparation dure quelques secondes, et une app qui s'active sans rien
      // annoncer inquiète plus qu'elle ne rassure.
      setPreparing(true)
      const pret = await prefetchOnDevice(JSON.parse(key))
      if (annule) return
      setPreparing(false)
      if (pret) setPrepared(key)
    }, PREFETCH_DELAY_MS)
    return () => {
      annule = true
      setPreparing(false)
      clearTimeout(minuteur)
    }
  }, [key, paused])

  return useMemo(() => ({ prepared, preparing }), [prepared, preparing])
}
