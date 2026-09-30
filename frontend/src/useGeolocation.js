import { useCallback, useEffect, useState } from 'react'
import { locateOnce, watchPosition } from './position'

/**
 * La position de l'iPhone, avec ses états réels.
 *
 * Une position isolée ne suffit pas : il faut savoir si l'autorisation a été
 * refusée une fois pour toutes, avec quelle précision on est placé, et suivre
 * ensuite. Ces trois informations changent tout ce que l'interface doit
 * afficher — un point net à 400 m près est un mensonge, et « réessayer » n'a
 * aucun sens si l'accès est refusé dans les Réglages.
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

  const apply = useCallback((geo) => {
    setState({
      position: [geo.coords.longitude, geo.coords.latitude],
      accuracy: geo.coords.accuracy,
      status: 'ready',
      message: null,
      at: Date.now(),
    })
  }, [])

  // Les erreurs arrivent déjà ramenées à une forme commune par `position.js`.
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
