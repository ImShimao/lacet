import { useCallback, useEffect, useRef, useState } from 'react'

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
  const watchId = useRef(null)

  // L'API Permissions dit si c'est refusé *avant* de déclencher une demande —
  // ça évite de proposer un bouton qui ne peut pas fonctionner.
  useEffect(() => {
    if (!navigator.permissions?.query) return
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

  const fail = useCallback((error) => {
    const denied = error.code === error.PERMISSION_DENIED
    setState((s) => ({
      ...s,
      status: denied ? 'denied' : 'error',
      message: denied
        ? DENIED
        : error.code === error.TIMEOUT
          ? "Le signal GPS n'arrive pas. À l'intérieur, ça peut prendre un moment."
          : 'Position indisponible pour le moment.',
    }))
  }, [])

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        status: 'unavailable',
        message: 'Ce navigateur ne donne pas accès à la position.',
      }))
      return
    }
    setState((s) => ({ ...s, status: 'locating', message: null }))
    navigator.geolocation.getCurrentPosition(apply, fail, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    })
  }, [apply, fail])

  // Le suivi continu ne tourne que quand on le demande : `watchPosition` garde
  // la puce GPS active, ce qui se paie en batterie.
  useEffect(() => {
    if (!following || !navigator.geolocation) return undefined
    watchId.current = navigator.geolocation.watchPosition(apply, fail, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    })
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
  }, [following, apply, fail])

  return { ...state, locate, following, setFollowing }
}

const DENIED =
  "L'accès à ta position est bloqué pour ce site. Rouvre-le dans les réglages du navigateur (l'icône à gauche de l'adresse), ou place le départ à la main sur la carte."
