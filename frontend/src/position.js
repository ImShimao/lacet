// La position, d'où qu'elle vienne : le navigateur, ou l'iPhone.
//
// Deux écrans en ont besoin — le choix du départ et la sortie — et ils ne
// doivent pas savoir d'où elle vient. Les erreurs sont donc ramenées à une forme
// commune : `denied` quand l'accès est refusé une fois pour toutes (réessayer ne
// sert à rien, il faut aller dans les réglages), `timeout` quand le signal
// tarde, et un message lisible.
//
// Dans l'app native, `background` garde le suivi écran verrouillé : c'est ce
// qu'il faut à une sortie, et seulement à elle.

import { isNative } from './platform'

function webError(error) {
  const denied = error.code === error.PERMISSION_DENIED
  const timeout = error.code === error.TIMEOUT
  return {
    denied,
    timeout,
    message: denied
      ? "L'accès à ta position est bloqué pour ce site. Rouvre-le dans les réglages du navigateur (l'icône à gauche de l'adresse), ou place le départ à la main sur la carte."
      : timeout
        ? "Le signal GPS n'arrive pas. À l'intérieur, ça peut prendre un moment."
        : 'Position indisponible pour le moment.',
  }
}

const UNAVAILABLE = { denied: false, timeout: false, message: 'Ce navigateur ne donne pas accès à la position.' }

/** Suivi continu. `onFix` reçoit un objet au format de l'API Geolocation. Rend l'arrêt. */
export function watchPosition(onFix, onError, { background = false } = {}) {
  if (isNative()) {
    let stop = null
    let cancelled = false
    import('./native').then((native) => {
      if (!cancelled) stop = native.watchPosition(onFix, onError, { background })
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }

  if (!navigator.geolocation) {
    onError(UNAVAILABLE)
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(onFix, (e) => onError(webError(e)), {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000,
  })
  return () => navigator.geolocation.clearWatch(id)
}

/** Une seule position, dès qu'elle est disponible. */
export function locateOnce(onFix, onError, { timeoutMs = 12000 } = {}) {
  if (isNative()) {
    let done = false
    const stop = watchPosition(
      (fix) => {
        if (done) return
        done = true
        clearTimeout(timer)
        stop()
        onFix(fix)
      },
      (error) => {
        if (done) return
        done = true
        clearTimeout(timer)
        stop()
        onError(error)
      },
    )
    const timer = setTimeout(() => {
      if (done) return
      done = true
      stop()
      onError({ denied: false, timeout: true, message: "Le signal GPS n'arrive pas. À l'intérieur, ça peut prendre un moment." })
    }, timeoutMs)
    return
  }

  if (!navigator.geolocation) {
    onError(UNAVAILABLE)
    return
  }
  navigator.geolocation.getCurrentPosition(onFix, (e) => onError(webError(e)), {
    enableHighAccuracy: true,
    timeout: timeoutMs,
    maximumAge: 30000,
  })
}
