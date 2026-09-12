import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { duration, haversine, km, pace } from './format'
import { buildTrack, locate, nextInstruction } from './routeTracker'
import * as voice from './voice'
import SosButton from './SosButton.jsx'

// Distance à laquelle on prévient d'une traversée à venir.
const CROSSING_ALERT_M = 120

// En dessous de cette précision GPS, le point est trop douteux pour compter.
const ACCURACY_LIMIT_M = 35

// Les deux temps du guidage : l'annonce, puis le rappel au moment d'agir.
// Un seul message ne suffit pas — trop tôt on l'a oublié, trop tard on a déjà
// dépassé la rue.
const PREVIEW_M = 110
const ACT_M = 25

// Nombre de relevés consécutifs hors du tracé avant d'alerter. Un seul point
// aberrant est banal en ville, entre deux immeubles ; trois de suite, non.
const OFF_ROUTE_FIXES = 3

/**
 * Suivi de la sortie : distance, allure, guidage, alertes.
 *
 * Fonctionne avec ou sans itinéraire. Sans (`route` à null), c'est une course
 * libre : on enregistre, on ne guide pas.
 */
export default function LiveRun({ route, onPosition, onStop }) {
  const [state, setState] = useState({ distance: 0, elapsed: 0, points: 0 })
  const [error, setError] = useState(null)
  const [alert, setAlert] = useState(null)
  const [progress, setProgress] = useState(null)
  const [speaking, setSpeaking] = useState(() => voice.available)
  const [current, setCurrent] = useState(null)
  const [offRoute, setOffRoute] = useState(false)

  const last = useRef(null)
  const here = useRef(null)
  const startedAt = useRef(Date.now())
  // La distance est tenue dans une référence en plus de l'état : `setState`
  // est différé, et les annonces kilométriques ont besoin de la valeur au
  // moment même du relevé, pas au rendu suivant.
  const covered = useRef(0)
  const announced = useRef(new Set())
  const previewed = useRef(new Set())
  const acted = useRef(new Set())
  const warned = useRef(new Set())
  const fix = useRef(null)
  const strayCount = useRef(0)
  const lastSplit = useRef(0)

  const track = useMemo(() => buildTrack(route?.geometry), [route])
  const instructions = route?.instructions || []
  const laps = route?.laps || 1
  const lapLength = (route?.lap_distance_m || route?.distance_m || 1)

  useEffect(() => {
    voice.setEnabled(speaking)
  }, [speaking])

  // Garder l'écran allumé pendant la sortie. Le verrou saute dès que l'onglet
  // passe en arrière-plan : il faut le reprendre au retour, sinon l'écran
  // s'éteint dès le premier coup d'œil au téléphone.
  useEffect(() => {
    let lock = null
    let cancelled = false

    const acquire = async () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        /* refusé (batterie faible, onglet masqué) : sans conséquence */
      }
    }

    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Ce navigateur ne donne pas accès à la position.')
      return undefined
    }

    const tick = setInterval(() => {
      setState((s) => ({ ...s, elapsed: (Date.now() - startedAt.current) / 1000 }))
    }, 1000)

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        setError(null)
        const { longitude, latitude, accuracy } = position.coords
        const point = [longitude, latitude]
        here.current = point
        onPosition(point)

        if (accuracy > ACCURACY_LIMIT_M) return

        if (last.current) {
          const step = haversine(last.current, point)
          // Un saut de plus de 100 m entre deux relevés est un artefact GPS,
          // pas un déplacement : le compter fausserait toute la distance.
          if (step < 100) {
            covered.current += step
            setState((s) => ({ ...s, distance: covered.current, points: s.points + 1 }))
            announceSplit(covered.current)
          }
        }
        last.current = point
        if (route) {
          followRoute(point)
          warnCrossing(point)
        }
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Accès à la position refusé. Autorise-le dans les réglages du site pour suivre la sortie."
            : `Position indisponible (${err.message}).`,
        )
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )

    return () => {
      clearInterval(tick)
      navigator.geolocation.clearWatch(watch)
      voice.stop()
      onPosition(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  /** Chaque kilomètre franchi, dit à voix haute — sans couper une consigne. */
  function announceSplit(travelled) {
    const done = Math.floor(travelled / 1000)
    if (done <= lastSplit.current) return
    lastSplit.current = done
    const elapsed = (Date.now() - startedAt.current) / 1000
    const perKm = elapsed / (travelled / 1000)
    voice.speak(
      `${done} kilomètre${done > 1 ? 's' : ''}. Allure ${spoken(perKm)} au kilomètre.`,
      { priority: false },
    )
  }

  /** Position sur le tracé, consigne à venir, et détection du hors-parcours. */
  function followRoute(point) {
    const found = locate(track, point, fix.current)
    if (!found) return
    fix.current = found
    setProgress(found)

    if (found.offRoute) {
      strayCount.current += 1
      if (strayCount.current === OFF_ROUTE_FIXES) {
        setOffRoute(true)
        voice.speak("Tu t'es écarté du parcours. Reviens sur le tracé.")
      }
    } else {
      if (strayCount.current >= OFF_ROUTE_FIXES) voice.speak('Te revoilà sur le parcours.')
      strayCount.current = 0
      setOffRoute(false)
    }

    const upcoming = nextInstruction(instructions, found.along, announced.current)
    setCurrent(upcoming)
    if (!upcoming || found.offRoute) return

    const { index, step, remaining } = upcoming
    if (remaining <= ACT_M && !acted.current.has(index)) {
      acted.current.add(index)
      announced.current.add(index)
      voice.speak(voice.phrase(step, remaining))
    } else if (remaining <= PREVIEW_M && !previewed.current.has(index)) {
      previewed.current.add(index)
      voice.speak(voice.phrase(step, remaining))
    }
  }

  /** L'alerte de traversée — la seule fois où l'app parle d'elle-même. */
  function warnCrossing(point) {
    const upcoming = (route?.crossings || [])
      .map((c, i) => ({ ...c, i, d: haversine(point, [c.lon, c.lat]) }))
      .filter((c) => c.d < CROSSING_ALERT_M && !warned.current.has(c.i))
      .sort((a, b) => a.d - b.d)[0]

    if (!upcoming) return
    warned.current.add(upcoming.i)
    setAlert(upcoming)
    if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    setTimeout(() => setAlert(null), 8000)
  }

  const currentPace = state.distance > 50 ? state.elapsed / (state.distance / 1000) : 0
  const remaining = route
    ? Math.max(0, (route.distance_m || 0) - (progress?.along ?? state.distance))
    : null
  const share = route && track.total ? Math.min(1, (progress?.along ?? 0) / track.total) : 0

  return (
    <div className="live">
      {route && (
        <div className="live__bar" aria-hidden="true">
          <i style={{ width: `${share * 100}%` }} />
        </div>
      )}

      <div className="live__big">
        <b>{km(state.distance)}</b>
        <span>KILOMÈTRES</span>
      </div>

      {/* Sur un parcours à tours, la question qu'on se pose en courant n'est pas
          « combien de kilomètres » mais « quel tour ». Les trois tours sont
          identiques : sans compteur, rien ne les distingue. */}
      {laps > 1 && (
        <div className="lapcount" role="status">
          Tour <b>{Math.min(laps, Math.floor((progress?.along ?? 0) / lapLength) + 1)}</b>
          {' '}sur <b>{laps}</b>
        </div>
      )}

      <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div>
          <b>{pace(currentPace)}</b>
          <span>Allure /km</span>
        </div>
        <div>
          <b>{duration(state.elapsed)}</b>
          <span>Temps</span>
        </div>
        <div>
          <b>{remaining === null ? '—' : km(remaining, 1)}</b>
          <span>Restants (km)</span>
        </div>
      </div>

      {route && instructions.length > 0 && (
        <NextStep step={current} offRoute={offRoute} />
      )}
      {route && instructions.length === 0 && (
        <div className="step step--idle">
          <em>
            Parcours enregistré avant l'ajout du guidage : la carte et les alertes de
            traversée fonctionnent, mais il n'y a pas de consignes à annoncer.
          </em>
        </div>
      )}

      {alert && (
        <div className="live__alert" role="alert">
          <Icon name="warning" size={17} />
          <span>
            Traversée dans {Math.round(alert.d)} m
            {alert.protected ? ' — passage protégé' : ' — pas de passage protégé'}
          </span>
        </div>
      )}

      {error && <div className="live__error">{error}</div>}
      {!error && state.points === 0 && (
        <div className="live__wait">Acquisition du signal GPS…</div>
      )}

      {/* Collés au bas du panneau : « Terminer » et le SOS doivent rester à
          portée de pouce en courant, pas sous le pli à aller chercher. */}
      <div className="row live__controls">
        {voice.available && (
          <button
            className={`btn btn--icon ${speaking ? 'btn--on' : ''}`}
            onClick={() => {
              voice.unlock()
              setSpeaking((v) => !v)
            }}
            title={speaking ? 'Couper le guidage vocal' : 'Activer le guidage vocal'}
            aria-pressed={speaking}
          >
            <Icon name={speaking ? 'volume' : 'volumeOff'} size={19} />
          </button>
        )}
        <SosButton position={here} distance={state.distance} elapsed={state.elapsed} />
        <button className="btn btn--primary" onClick={() => onStop(state)}>
          <Icon name="stop" size={16} />
          Terminer
        </button>
      </div>
    </div>
  )
}

/** La consigne du moment, en grand — c'est ce qu'on regarde en courant. */
function NextStep({ step, offRoute }) {
  if (offRoute) {
    return (
      <div className="step step--stray" role="status">
        <Icon name="warning" size={20} />
        <div>
          <b>Hors parcours</b>
          <em>Reviens sur le tracé pour reprendre le guidage.</em>
        </div>
      </div>
    )
  }
  if (!step) {
    return (
      <div className="step step--idle">
        <em>Guidage en attente du signal GPS…</em>
      </div>
    )
  }
  return (
    <div className="step" role="status">
      <Icon name={turnIcon(step.step.turn)} size={22} />
      <div>
        <b>{step.step.text}</b>
        <em>
          {step.remaining > 20 ? `dans ${Math.round(step.remaining / 10) * 10} m` : 'maintenant'}
          {step.step.caution ? ' · traversée non protégée' : ''}
        </em>
      </div>
    </div>
  )
}

function turnIcon(turn) {
  if (turn === 'finish') return 'flag'
  if (turn === 'lap') return 'refresh'
  if (turn === 'start') return 'play'
  if (turn.includes('left')) return 'turnLeft'
  if (turn.includes('right')) return 'turnRight'
  return 'straight'
}

/** « 5 minutes 30 » — la synthèse vocale lit « 5:30 » comme une heure. */
function spoken(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return 'inconnue'
  // Arrondi d'abord, découpage ensuite : sinon on annonce « 4 minutes 60 ».
  const total = Math.round(secondsPerKm)
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m} minutes ${s}` : `${m} minutes`
}
