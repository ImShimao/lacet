import { useState } from 'react'
import { clearRun, loadRun } from './runState'
import * as voice from './voice'

/**
 * La sortie, du premier appui au bilan.
 *
 * Ce n'est pas une liste d'états : c'est une machine, et elle était éparpillée
 * dans `App.jsx` en neuf `useState` et trois poignées de boutons. Chaque
 * transition devait alors être réécrite à la main — « terminer » remettait six
 * choses à zéro, et l'on ne voyait nulle part qu'elles allaient ensemble.
 * Oublier `setLiveRoute(null)` laissait la carte dessiner le détour de la
 * sortie précédente par-dessus la suivante.
 *
 * Les états possibles, et rien d'autre :
 *
 *     au repos ──(compte à rebours)──► décompte ──► en course ──► bilan ──► au repos
 *         ▲                                                                    │
 *         └────────────────────────────────────────────────────────────────────┘
 *
 * Plus un cas de côté, qui ne vient pas d'un geste mais du disque : une sortie
 * interrompue par une fermeture de l'app, retrouvée au lancement suivant. On
 * peut la reprendre, la garder telle quelle, ou l'oublier.
 */
export default function useRunSession({ toEntry, remember }) {
  const [running, setRunning] = useState(false)
  // `false`, ou `'route'` / `'free'` selon ce qui démarrera une fois le compte
  // à rebours fini.
  const [starting, setStarting] = useState(false)
  // Course libre : on enregistre sans itinéraire. C'est ce que fait la moitié
  // des sorties — on part sans savoir où l'on va.
  const [freeRun, setFreeRun] = useState(false)
  // La sortie interrompue retrouvée au lancement, et celle qu'on reprend.
  const [pending, setPending] = useState(() => loadRun())
  const [resume, setResume] = useState(null)
  // La sortie qui vient de se terminer : ses chiffres, et sa trace sur la carte.
  const [summary, setSummary] = useState(null)
  const [position, setPosition] = useState(null)
  // La direction de course, pour la carte orientée comme un GPS de voiture.
  const [heading, setHeading] = useState(null)
  // Le tracé suivi, quand un recalcul a remplacé celui du départ.
  const [route, setRoute] = useState(null)

  /** Range la sortie et rend l'app au repos. Un seul endroit, pour de bon. */
  const settle = (stats, contexte) => {
    // Une sortie de moins de cent mètres est un démarrage par erreur, pas une
    // sortie : l'enregistrer polluerait les statistiques et l'historique.
    if (stats && stats.distance >= 100) setSummary(remember(toEntry(stats, contexte)))
    clearRun()
    setResume(null)
    setRunning(false)
    setFreeRun(false)
    setPosition(null)
    setHeading(null)
    setRoute(null)
  }

  return {
    running,
    starting,
    freeRun,
    pending,
    resume,
    summary,
    position,
    heading,
    route,

    /**
     * Le compte à rebours avant le départ.
     *
     * Le doigt sur « Démarrer » est le seul geste que le navigateur accepte
     * pour autoriser la voix : c'est ici qu'on la débloque, pas au premier
     * virage — où il serait trop tard, et où rien ne serait dit.
     */
    countdown(kind) {
      voice.unlock()
      setStarting(kind)
    },
    cancelCountdown() {
      setStarting(false)
    },
    /** Le décompte est fini : on part. */
    begin() {
      setFreeRun(starting === 'free')
      setStarting(false)
      setRunning(true)
    },

    /** Reprend la sortie interrompue. `onAdopt` reçoit son parcours, s'il y en a un. */
    resumePending(onAdopt) {
      if (!pending) return
      if (pending.route) onAdopt?.(pending.route)
      setFreeRun(!pending.route)
      setResume(pending)
      setPending(null)
      setRunning(true)
    },
    /**
     * Reprise impossible ou pas voulue : on garde au moins ce qui a été couru,
     * plutôt que de le jeter.
     */
    keepPending(sport) {
      if (!pending) return
      setSummary(
        remember(
          toEntry(
            // Les temps de chaque kilomètre sont gardés avec le reste : ils ne se
            // retrouvent pas après coup.
            { distance: pending.covered, elapsed: pending.elapsed, trail: pending.trail, splits: pending.splits },
            { route: pending.route, free: !pending.route, sport: pending.sport || sport },
          ),
        ),
      )
      clearRun()
      setPending(null)
    },
    dropPending() {
      clearRun()
      setPending(null)
    },

    /** La sortie est finie — au bouton, ou en revenant sur le départ. */
    finish(stats, contexte) {
      settle(stats, { ...contexte, free: freeRun })
    },
    closeSummary() {
      setSummary(null)
    },

    /** Où l'on est, et dans quel sens — à chaque relevé. */
    track(point, cap) {
      setPosition(point)
      setHeading(cap ?? null)
    },
    /** Un nouveau tracé calculé en route. */
    reroute(next) {
      setRoute(next)
    },
  }
}
