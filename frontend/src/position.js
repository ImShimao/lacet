// La position, par le GPS de l'iPhone.
//
// Deux écrans en ont besoin — le choix du départ et la sortie — et ils ne
// doivent pas savoir comment elle arrive. Les erreurs sont donc ramenées à une
// forme commune : `denied` quand l'accès est refusé une fois pour toutes
// (réessayer ne sert à rien, il faut aller dans les réglages), `timeout` quand
// le signal tarde, et un message lisible.
//
// `background` garde le suivi écran verrouillé : c'est ce qu'il faut à une
// sortie, et seulement à elle.

const TIMEOUT = { denied: false, timeout: true, message: "Le signal GPS n'arrive pas. À l'intérieur, ça peut prendre un moment." }

/** Suivi continu. `onFix` reçoit un objet au format de l'API Geolocation. Rend l'arrêt. */
export function watchPosition(onFix, onError, { background = false } = {}) {
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

/** Une seule position, dès qu'elle est disponible. */
export function locateOnce(onFix, onError, { timeoutMs = 12000 } = {}) {
  let done = false
  const finish = (then) => (value) => {
    if (done) return
    done = true
    clearTimeout(timer)
    stop()
    then(value)
  }
  const stop = watchPosition(finish(onFix), finish(onError))
  const timer = setTimeout(() => finish(onError)(TIMEOUT), timeoutMs)
}
