import { useEffect, useRef, useState } from 'react'
import { isNative } from './platform'

import { t } from './i18n'
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

  // Le cercle se vide pendant chaque seconde : on voit le temps passer, pas
  // seulement le chiffre changer. Au « Partez ! », il est plein, et vert.
  const go = n === 0
  return (
    <div className={`countdown ${go ? 'countdown--go' : ''}`} role="status" aria-live="assertive">
      <div className="countdown__dial" key={n} style={{ '--step': `${go ? GO_MS : STEP_MS}ms` }}>
        <span className="countdown__wave" aria-hidden="true" />
        <svg className="countdown__ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="countdown__track" cx="60" cy="60" r="54" />
          <circle className="countdown__arc" cx="60" cy="60" r="54" pathLength="1" />
        </svg>
        <span className={`countdown__n ${go ? 'countdown__n--go' : ''}`}>{go ? t('Partez !') : n}</span>
      </div>
      {/* Trois points : où l'on en est, sans avoir à lire. */}
      <div className="countdown__steps" aria-hidden="true">
        {[3, 2, 1].map((i) => (
          <i key={i} className={n <= i ? 'countdown__step--done' : ''} />
        ))}
      </div>
      {note && <p className="countdown__note">{note}</p>}
      <button className="btn countdown__cancel" onClick={onCancel}>{t('Annuler')}</button>
    </div>
  )
}
