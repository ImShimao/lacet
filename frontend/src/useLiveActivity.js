import { useCallback, useEffect, useRef } from 'react'
import { lockScreenState, shouldRefresh } from './lockScreen'
import { isNative } from './platform'
import { nextInstruction } from './routeTracker'

/**
 * L'écran de verrouillage pendant une sortie guidée : la consigne à venir, sa
 * distance et l'heure d'arrivée, lisibles en allumant l'écran, sans
 * déverrouiller ni rouvrir l'app. Une activité en direct, dessinée par
 * l'extension `LacetWidgets` — et rien d'autre : ce qu'iOS refuse d'afficher,
 * « Mon compte » l'explique, plutôt que de le remplacer par un pis-aller.
 *
 * Rend `refresh(build, minMs)` : `build` fabrique l'état à montrer, et n'est
 * appelée que si l'activité tourne. L'écran n'est réveillé que si l'état a
 * vraiment changé, et pas plus souvent que `minMs`.
 */
export default function useLiveActivity(route) {
  const ready = useRef(false)
  const shown = useRef(null)
  const shownAt = useRef(0)
  // Le bilan à laisser sur l'écran de verrouillage en partant — voir
  // `finishedState`. Sans lui, l'activité s'efface d'un coup.
  const farewell = useRef(null)

  useEffect(() => {
    if (!isNative() || !route) return undefined
    let cancelled = false
    const native = import('./native')
    native.then(async (n) => {
      const first = lockScreenState({
        route,
        step: nextInstruction(route.instructions || [], 0, new Set()),
        along: 0,
        offRoute: false,
        travelled: 0,
        elapsedS: 0,
      })
      const { started } = await n.startLiveActivity(first)
      if (cancelled) {
        if (started) n.endLiveActivity()
        return
      }
      ready.current = started
      shown.current = first
      shownAt.current = Date.now()
    })
    return () => {
      cancelled = true
      ready.current = false
      const last = farewell.current
      farewell.current = null
      native.then((n) => n.endLiveActivity(last))
    }
  }, [route])

  const refresh = useCallback((build, minMs) => {
    if (!ready.current) return
    const next = build()
    const now = Date.now()
    if (!shouldRefresh(shown.current, next, now - shownAt.current, minMs)) return
    shown.current = next
    shownAt.current = now
    import('./native').then((n) => n.updateLiveActivity(next))
  }, [])
  const conclude = useCallback((state) => {
    farewell.current = state
  }, [])
  return { refresh, conclude }
}
