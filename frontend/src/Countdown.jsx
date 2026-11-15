import { useEffect, useRef, useState } from 'react'
import { isNative } from './platform'

/**
 * Trois, deux, un — le temps de ranger le téléphone.
 *
 * Le chrono partait à l'instant du doigt sur « Démarrer » : les premières
 * secondes d'une sortie se passaient donc à glisser le téléphone dans sa poche,
 * et le premier kilomètre commençait toujours par dix mètres de marche. Trois
 * secondes suffisent à lever la tête et à partir vraiment.
 *
 * Le compte peut s'annuler d'une touche — on lance parfois par erreur — et il
 * ne fait rien de plus que ce qu'il montre : c'est `onDone` qui démarre la
 * sortie, et rien n'est enregistré avant.
 *
 * `note` : ce qui a changé pendant le décompte — le départ recalé sur la
 * position (`restart.js`) —, dit en une ligne sous le chiffre.
 */

// Une seconde pleine par chiffre : plus court, on ne suit plus ; plus long, on
// attend. Le « Partez ! » est bref, il n'a qu'à lancer le geste.
const STEP_MS = 900
const GO_MS = 650

export default function Countdown({ onDone, onCancel, note = null }) {
  // 3, 2, 1, puis 0 pour « Partez ! ».
  const [n, setN] = useState(3)
  const done = useRef(false)

  useEffect(() => {
    const finir = () => {
      if (done.current) return
      done.current = true
      onDone()
    }
    const timer = setTimeout(() => (n > 0 ? setN(n - 1) : finir()), n > 0 ? STEP_MS : GO_MS)
    return () => clearTimeout(timer)
  }, [n, onDone])

  // Une vibration par chiffre : on peut partir sans regarder l'écran.
  useEffect(() => {
    if (isNative()) import('./native').then((m) => m.tickHaptic())
    else navigator.vibrate?.(n > 0 ? 40 : 120)
  }, [n])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="countdown" role="status" aria-live="assertive">
      <div className="countdown__ring" key={n}>
        <span className={`countdown__n ${n > 0 ? '' : 'countdown__n--go'}`}>
          {n > 0 ? n : 'Partez !'}
        </span>
      </div>
      {note && <p className="countdown__note">{note}</p>}
      <button className="btn countdown__cancel" onClick={onCancel}>
        Annuler
      </button>
    </div>
  )
}
