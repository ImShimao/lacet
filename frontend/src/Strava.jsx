import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import * as strava from './strava'

/** L'état de la connexion à Strava, tenu à jour. */
function useStrava() {
  const [state, setState] = useState(() => strava.status())
  useEffect(() => strava.subscribe(setState), [])
  return state
}

const open = (url) => import('./native').then((n) => n.openExternal(url)).catch(() => {})

/**
 * Le réglage de « Mon compte » : se connecter, choisir l'envoi automatique, se
 * déconnecter. Absent d'une app compilée sans application Strava, où il dit
 * seulement ce qu'il faudrait pour l'avoir.
 */
export function StravaSetting() {
  const s = useStrava()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!s.configured) {
    return (
      <p className="muted small">
        L'envoi vers Strava n'est pas activé dans cette version. Il demande une application
        Strava (strava.com/settings/api, domaine de retour « localhost ») et ses deux clés
        dans les secrets du dépôt : <b>STRAVA_CLIENT_ID</b> et <b>STRAVA_CLIENT_SECRET</b>.
      </p>
    )
  }

  if (!s.connected) {
    return (
      <>
        <p className="muted small">
          Chaque sortie part sur Strava avec sa trace, son temps et l'allure de chaque
          kilomètre. Apple Santé ne peut pas servir de relais : Strava n'y reprend que les
          séances de l'app Exercice d'Apple.
        </p>
        {(error || s.error) && <div className="notice notice--warn">{error || s.error}</div>}
        <button
          className="btn strava-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await strava.connect()
            } catch (err) {
              setError(err.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon name="upload" size={16} />
          Connecter Strava
        </button>
      </>
    )
  }

  return (
    <>
      <p className="muted small">
        Connecté à Strava{s.athlete?.name ? <> — <b>{s.athlete.name}</b></> : null}.
      </p>
      <div className="seg" role="radiogroup" aria-label="Envoi vers Strava">
        {[
          [true, 'Envoi automatique'],
          [false, 'À la demande'],
        ].map(([value, label]) => (
          <button key={String(value)} role="radio" aria-checked={s.auto === value} onClick={() => strava.setAuto(value)}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {s.auto
          ? 'Chaque sortie terminée part sur Strava dès l’écran de fin, sans rien toucher.'
          : 'Un bouton « Envoyer à Strava » attend sur l’écran de fin et sur chaque sortie relue.'}
      </p>
      <button className="btn" onClick={() => strava.disconnect()}>
        Déconnecter Strava
      </button>
    </>
  )
}

/**
 * Envoyer une sortie terminée — ou dire qu'elle y est déjà.
 *
 * `auto` : l'écran de fin, qui part tout seul quand l'envoi automatique est
 * choisi. `onSent(activityId)` garde la trace de l'envoi dans l'historique,
 * pour ne pas proposer de renvoyer une sortie qui y est déjà.
 */
export function StravaButton({ entry, auto = false, onSent }) {
  const s = useStrava()
  const [state, setState] = useState(entry.strava?.id ? { sent: entry.strava.id } : null)
  const started = useRef(false)

  const send = async () => {
    setState({ sending: true })
    try {
      const { activityId } = await strava.upload(entry)
      setState({ sent: activityId })
      onSent?.(activityId)
    } catch (error) {
      if (error.duplicate) {
        const id = typeof error.duplicate === 'number' ? error.duplicate : null
        setState({ sent: id ?? true })
        if (id) onSent?.(id)
      } else {
        setState({ error: error.message })
      }
    }
  }

  useEffect(() => {
    if (!auto || started.current || !s.connected || !s.auto || entry.strava?.id || !(entry.track?.length > 1)) return
    started.current = true
    send()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, s.connected, s.auto])

  if (!s.connected || !(entry.track?.length > 1)) return null

  if (state?.sent) {
    return (
      <button
        className="btn strava-btn strava-btn--sent"
        onClick={() => typeof state.sent === 'number' && open(strava.activityUrl(state.sent))}
      >
        <Icon name="check" size={16} />
        Sur Strava{typeof state.sent === 'number' ? ' — voir' : ''}
      </button>
    )
  }
  return (
    <>
      <button className="btn strava-btn" disabled={state?.sending} onClick={send}>
        <Icon name="upload" size={16} />
        {state?.sending ? 'Envoi à Strava…' : 'Envoyer à Strava'}
      </button>
      {state?.error && <p className="muted small strava-error">{state.error}</p>}
    </>
  )
}
