import { useEffect, useState } from 'react'
import { alongRoute, KINDS, poisIn, routeBox } from './pois'

/**
 * Les points d'eau qui bordent `route`, s'ils sont cochés dans « Mon compte »
 * (`prefs`, par exemple `{ water: true }`).
 *
 * Rien n'est demandé tant que rien n'est coché : c'est une requête de plus, et
 * tout le monde n'en veut pas. Une réponse arrivée pour un parcours qu'on a
 * quitté entre-temps est jetée.
 */
export default function usePois(route, prefs) {
  const [found, setFound] = useState({ key: null, stops: [], complete: true, offline: false })
  const kinds = Object.keys(KINDS).filter((k) => prefs?.[k])
  const geometry = route?.geometry
  const key = geometry?.length > 1 && kinds.length ? `${route.id}|${geometry.length}|${kinds.join(',')}` : null

  useEffect(() => {
    if (!key) return undefined
    let current = true
    poisIn(routeBox(geometry)).then(
      ({ pois, complete, offline = false }) => {
        if (!current) return
        const wanted = pois.filter((p) => kinds.includes(p.kind))
        setFound({ key, stops: alongRoute(geometry, wanted), complete, offline })
      },
      () => current && setFound({ key, stops: [], complete: false, offline: false }),
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key) return { stops: [], loading: false, complete: true, offline: false }
  if (found.key !== key) return { stops: [], loading: true, complete: true, offline: false }
  return { stops: found.stops, loading: false, complete: found.complete, offline: found.offline }
}
