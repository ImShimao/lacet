import { useCallback, useEffect, useState } from 'react'
import { isNative } from './platform'
import { locateOnce, watchPosition } from './position'

/**
 * Géolocalisation du navigateur, avec ses états réels.
 *
 * Un `getCurrentPosition` isolé ne suffit pas : il ne dit pas si l'autorisation
 * a été refusée une fois pour toutes, il ne donne pas la précision, et il ne
 * met rien à jour ensuite. Or ces trois informations changent tout ce que
 * l'interface doit afficher — un point net à 400 m près est un mensonge, et
 * « réessayer » n'a aucun sens si l'utilisateur a bloqué l'accès.
 */
export default function useGeolocation() {
  const [state, setState] = useState({
    position: null, // [lon, lat]
    accuracy: null, // mètres
    status: 'idle', // idle | locating | ready | denied | unavailable | error
    message: null,
    at: null,
  })
  const [following, setFollowing] = useState(false)

  // L'API Permissions dit si c'est refusé *avant* de déclencher une demande —
  // ça évite de proposer un bouton qui ne peut pas fonctionner.
  useEffect(() => {
    // Dans l'app native, l'autorisation se demande au premier suivi, par iOS.
    if (isNative() || !navigator.permissions?.query) return
    let cancelled = false
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) return
        if (status.state === 'denied') {
          setState((s) => ({ ...s, status: 'denied', message: DENIED }))
        }
        status.onchange = () => {
          if (status.state === 'denied') {
            setState((s) => ({ ...s, status: 'denied', message: DENIED }))
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const apply = useCallback((geo) => {
    setState({
      position: [geo.coords.longitude, geo.coords.latitude],
      accuracy: geo.coords.accuracy,
      status: 'ready',
      message: null,
      at: Date.now(),
    })
  }, [])

  // Les erreurs arrivent déjà ramenées à une forme commune par `position.js`,
  // qu'elles viennent du navigateur ou de l'iPhone.
  const fail = useCallback((error) => {
    setState((s) => ({
      ...s,
      status: error.denied ? 'denied' : 'error',
      message: error.message,
    }))
  }, [])

  const locate = useCallback(() => {
    setState((s) => ({ ...s, status: 'locating', message: null }))
    locateOnce(apply, fail)
  }, [apply, fail])

  // Le suivi continu ne tourne que quand on le demande : il garde la puce GPS
  // active, ce qui se paie en batterie.
  useEffect(() => {
    if (!following) return undefined
    return watchPosition(apply, fail)
  }, [following, apply, fail])

  return { ...state, locate, following, setFollowing }
}

const DENIED =
  "L'accès à ta position est bloqué pour ce site. Rouvre-le dans les réglages du navigateur (l'icône à gauche de l'adresse), ou place le départ à la main sur la carte."
