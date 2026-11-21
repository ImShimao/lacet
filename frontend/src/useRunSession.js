import { useState } from 'react'
import { clearRun, loadRun } from './runState'

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

    /** Le compte à rebours avant le départ. */
    countdown(kind) {
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
            {
              distance: pending.covered,
              elapsed: pending.elapsed,
              trail: pending.trail,
              trailT: pending.trailT,
              trailAlt: pending.trailAlt,
              splits: pending.splits,
              spoken: pending.spoken,
              diag: pending.diag,
              pausedS: pending.pausedS,
              rerouted: pending.rerouted,
              // Elle s'est arrêtée à sa dernière écriture, pas à l'instant où
              // on la range.
              endedAt: pending.at,
              ascent: pending.ascent ?? null,
              ascentSource: pending.ascentSource ?? null,
            },
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
    /**
     * « Pas fini » : l'arrivée s'est déclenchée, mais on repart — un tour de
     * plus, un retour au calme. La sortie rangée est retirée de l'historique
     * (`drop`) et reprend où elle s'était arrêtée, comme une sortie
     * interrompue : le temps passé devant le bilan ne compte pas.
     */
    continueRun(entry, drop) {
      if (!entry) return
      drop?.(entry)
      setSummary(null)
      setFreeRun(Boolean(entry.free))
      setResume({
        covered: entry.actual_distance_m,
        elapsed: entry.actual_duration_s,
        trail: entry.track ?? [],
        trailT: entry.track_t ?? null,
        trailAlt: entry.track_alt ?? null,
        pausedS: entry.paused_s ?? 0,
        rerouted: Boolean(entry.rerouted),
        splits: entry.splits ?? [],
        spoken: entry.spoken ?? [],
        diag: entry.diag ?? undefined,
        ascent: entry.actual_ascent_m ?? null,
        ascentSource: entry.actual_ascent_source ?? null,
      })
      setRunning(true)
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
