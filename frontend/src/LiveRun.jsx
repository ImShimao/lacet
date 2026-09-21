import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import ElevationSheet from './ElevationSheet.jsx'
import { haversine, km, pace } from './format'
import { bearing, buildTrack, headingAt, locate, nextInstruction } from './routeTracker'
import { lockScreenState, shouldRefresh } from './lockScreen'
import { motionTracker } from './autoPause'
import { load } from './storage'
import * as voice from './voice'
import SosButton from './SosButton.jsx'
import { isNative } from './platform'
import { watchPosition } from './position'
import { detourOnDevice } from './engine/client'
import { spliceRoute } from './detour'

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

// Hors du tracé, le temps de le retrouver seul avant qu'un nouveau chemin soit
// proposé : un détour pour éviter des travaux, une fontaine, un pont qu'on
// voulait voir ne réclament pas d'itinéraire. Et s'il n'y en a pas, on
// réessaie un peu plus tard — on aura bougé.
const REROUTE_AFTER_MS = 20_000
const REROUTE_RETRY_MS = 30_000

// Hors du tracé, le cap se lit sur le déplacement — à condition qu'il soit assez
// long pour dépasser l'imprécision du GPS, sinon la carte tourne sur du bruit.
const MOVE_FOR_HEADING_M = 8

const guideOf = (route) => ({ route, track: buildTrack(route?.geometry) })

/**
 * Suivi de la sortie : chrono, distance, allure, guidage, alertes.
 *
 * Fonctionne avec ou sans itinéraire. Sans (`route` à null), c'est une course
 * libre : on enregistre, on ne guide pas.
 *
 * La consigne à venir se lit **en haut de l'écran**, sur la carte, en grand —
 * c'est elle qu'on cherche des yeux en courant. Le panneau du bas garde les
 * chiffres et les commandes. `stage` est la zone de la carte, où ce bandeau
 * est rendu.
 *
 * `request` est la demande qui a produit le parcours : c'est avec elle qu'un
 * chemin de retour se calcule quand on s'est écarté.
 */
export default function LiveRun({ route, request, sport, stage, speaking, onPosition, onReroute, onStop }) {
  const [state, setState] = useState({ distance: 0, elapsed: 0, points: 0 })
  const [error, setError] = useState(null)
  const [alert, setAlert] = useState(null)
  const [progress, setProgress] = useState(null)
  const [current, setCurrent] = useState(null)
  const [offRoute, setOffRoute] = useState(false)
  // null en course ; 'auto' arrêté à un feu ; 'manual' mis en pause au bouton.
  const [paused, setPaused] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)

  // Le tracé suivi : le parcours choisi, puis, après un recalcul, le raccord et
  // la fin de la boucle. Tenu aussi en référence : les relevés GPS arrivent
  // dans un rappel créé une fois pour toutes, qui doit lire le tracé du moment.
  const [guide, setGuide] = useState(() => guideOf(route))
  const guideRef = useRef(guide)
  const [rerouting, setRerouting] = useState(false)
  const [rerouteDue, setRerouteDue] = useState(null)
  const detouring = useRef(false)
  const dueAt = useRef(null)
  const lastOnAlong = useRef(0)

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
  const heading = useRef(null)
  const moved = useRef(null)
  // L'écran de verrouillage : prêt ou non, et ce qu'on lui a envoyé en dernier.
  const lockReady = useRef(false)
  const shown = useRef(null)
  const shownAt = useRef(0)
  const upcomingStep = useRef(null)
  // Les pauses : leur genre, depuis quand, et le temps déjà passé à l'arrêt.
  // Tenues en références : le relevé GPS qui les déclenche doit lire la valeur
  // du moment, pas celle du dernier rendu.
  const pausedKind = useRef(null)
  const pausedAt = useRef(null)
  const pausedMs = useRef(0)
  const resumedAt = useRef(Date.now())
  const motion = useRef(null)
  if (!motion.current) motion.current = motionTracker()
  // La distance des dernières secondes, relevé par relevé : l'arrêt n'est sûr
  // qu'au bout de huit secondes, et le tremblement du GPS pendant ce temps —
  // une dizaine de mètres mesurés — doit être retiré, pas compté.
  const trail = useRef([])
  const autoPause = useRef(load().autoPause !== false)

  const plannedM = route?.distance_m || 0
  const canDetour = Boolean(route && request && route.geometry?.length > 1)
  const laps = route?.laps || 1
  const lapLength = route?.lap_distance_m || route?.distance_m || 1

  useEffect(() => {
    voice.setEnabled(speaking)
  }, [speaking])

  // Un autre parcours — ce qui n'arrive qu'au démarrage : on repart de lui.
  useEffect(() => {
    const g = guideOf(route)
    guideRef.current = g
    setGuide(g)
  }, [route])

  // Garder l'écran allumé pendant la sortie. Le verrou saute dès que l'onglet
  // passe en arrière-plan : il faut le reprendre au retour, sinon l'écran
  // s'éteint dès le premier coup d'œil au téléphone.
  useEffect(() => {
    // Dans l'app native, le verrou tient pour de bon, onglet ou pas.
    if (isNative()) {
      const native = import('./native')
      native.then((n) => n.keepScreenOn())
      return () => {
        native.then((n) => n.allowScreenOff())
      }
    }

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
    const tick = setInterval(() => {
      setState((s) => ({ ...s, elapsed: movingSeconds() }))
    }, 1000)

    // `background` : dans l'app native, le suivi continue écran verrouillé,
    // téléphone dans la poche — c'est toute la différence avec Safari.
    const stopWatching = watchPosition(
      (position) => {
        setError(null)
        const { longitude, latitude, accuracy } = position.coords
        const point = [longitude, latitude]
        here.current = point

        // Un point trop imprécis déplace le repère, mais ne compte pas et ne
        // réoriente pas la carte.
        if (accuracy > ACCURACY_LIMIT_M) {
          onPosition(point, heading.current)
          return
        }

        // La pause automatique. Une pause mise à la main, elle, ne se lève
        // qu'à la main : on peut marcher jusqu'à la fontaine sans que le chrono
        // reparte.
        if (autoPause.current && pausedKind.current !== 'manual') {
          const anchor = motion.current.anchor
          const event = motion.current.push({
            t: position.timestamp ?? Date.now(),
            point,
            speed: position.coords.speed,
          })
          if (event === 'stop') pause('auto', motion.current.since)
          if (event === 'resume') {
            resume()
            // La distance reprend du point d'arrêt : les mètres faits pour
            // repartir comptent, le tremblement de l'arrêt non.
            last.current = anchor
          }
        }

        // En pause, le repère suit, mais rien ne compte.
        if (pausedKind.current) {
          onPosition(point, heading.current)
          return
        }

        if (last.current) {
          const step = haversine(last.current, point)
          // Un saut de plus de 100 m entre deux relevés est un artefact GPS,
          // pas un déplacement : le compter fausserait toute la distance.
          if (step < 100) {
            covered.current += step
            setState((s) => ({ ...s, distance: covered.current, points: s.points + 1 }))
            announceSplit(covered.current)
          }
          const now = Date.now()
          trail.current.push({ t: now, covered: covered.current })
          while (trail.current.length && now - trail.current[0].t > 20_000) trail.current.shift()
        }
        last.current = point
        if (route) {
          followRoute(point)
          warnCrossing(point)
        }
        heading.current = runHeading(point) ?? heading.current
        onPosition(point, heading.current)
      },
      (err) => setError(err.message),
      { background: true },
    )

    return () => {
      clearInterval(tick)
      stopWatching()
      voice.stop()
      onPosition(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  // L'écran de verrouillage, dans l'app iPhone : la consigne à venir, sa
  // distance et l'heure d'arrivée, lisibles en allumant l'écran, sans
  // déverrouiller ni rouvrir l'app. Une activité en direct, dessinée par
  // l'extension `LacetWidgets` — et rien d'autre : ce qu'iOS refuse d'afficher,
  // « Mon compte » l'explique, plutôt que de le remplacer par un pis-aller.
  useEffect(() => {
    if (!isNative() || !route) return undefined
    let cancelled = false
    const native = import('./native')
    native.then(async (n) => {
      const first = lockScreenState({
        route,
        step: nextInstruction(route.instructions || [], 0, new Set()),
        along: 0,
        offRoute: false,
        travelled: 0,
        elapsedS: 0,
      })
      const { started } = await n.startLiveActivity(first)
      if (cancelled) {
        if (started) n.endLiveActivity()
        return
      }
      lockReady.current = started
      shown.current = first
      shownAt.current = Date.now()
    })
    return () => {
      cancelled = true
      lockReady.current = false
      native.then((n) => n.endLiveActivity())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  /** Le temps en mouvement, pauses déduites — celui qui fait l'allure. */
  function movingSeconds(now = Date.now()) {
    const current = pausedAt.current ? now - pausedAt.current : 0
    return Math.max(0, (now - startedAt.current - pausedMs.current - current) / 1000)
  }

  /**
   * Arrête le chrono. `since` : l'arrêt détecté a commencé avant qu'on en soit
   * sûr — huit secondes plus tôt — et ces secondes-là ne sont pas de la course.
   */
  function pause(kind, since = Date.now()) {
    if (pausedKind.current) {
      // Déjà en pause : un appui sur le bouton la rend simplement manuelle.
      if (kind === 'manual') {
        pausedKind.current = 'manual'
        setPaused('manual')
      }
      return
    }
    pausedKind.current = kind
    pausedAt.current = Math.min(Date.now(), Math.max(since, resumedAt.current))
    // La distance revient, elle aussi, au moment de l'arrêt.
    const before = trail.current.filter((p) => p.t <= pausedAt.current).at(-1)
    if (kind === 'auto' && before && before.covered < covered.current) covered.current = before.covered
    setPaused(kind)
    setState((s) => ({ ...s, elapsed: movingSeconds(), distance: covered.current }))
    if (kind === 'auto') {
      voice.speak('Pause automatique.', { priority: false })
      if (isNative()) import('./native').then((n) => n.pulseHaptic())
    }
    refreshLockScreen(upcomingStep.current, fix.current?.along ?? 0)
  }

  function resume({ spoken = true } = {}) {
    if (!pausedKind.current) return
    pausedMs.current += Date.now() - pausedAt.current
    pausedAt.current = null
    pausedKind.current = null
    resumedAt.current = Date.now()
    setPaused(null)
    if (spoken) voice.speak('Reprise.', { priority: false })
    refreshLockScreen(upcomingStep.current, fix.current?.along ?? 0)
  }

  /** Le bouton : pause à la main, ou reprise de n'importe quelle pause. */
  function togglePause() {
    motion.current.reset()
    if (pausedKind.current) {
      resume({ spoken: false })
      // Ce qu'on a parcouru pendant une pause voulue ne compte pas.
      last.current = null
    } else {
      pause('manual')
    }
  }

  /** L'avancée de toute la sortie, de 0 à 1 — détours compris. */
  function outingShare(along) {
    const left = Math.max(0, (guideRef.current.route?.distance_m || 0) - along)
    const done = covered.current
    return done + left > 0 ? done / (done + left) : 0
  }

  /** Met l'écran de verrouillage à jour, sans le réveiller pour rien. */
  function refreshLockScreen(upcoming, along) {
    if (!lockReady.current) return
    const next = lockScreenState({
      route: guideRef.current.route,
      step: upcoming,
      along,
      offRoute: strayCount.current >= OFF_ROUTE_FIXES,
      paused: Boolean(pausedKind.current),
      travelled: covered.current,
      elapsedS: movingSeconds(),
      share: outingShare(along),
    })
    const now = Date.now()
    if (!shouldRefresh(shown.current, next, now - shownAt.current)) return
    shown.current = next
    shownAt.current = now
    import('./native').then((n) => n.updateLiveActivity(next))
  }

  /**
   * Où l'on court, pour orienter la carte comme un GPS de voiture.
   *
   * Sur le tracé, c'est le tracé qui le dit : voir `headingAt`. Hors du tracé —
   * course libre, ou détour — on le lit sur le déplacement depuis le dernier
   * point retenu, et on ne répond rien tant qu'on n'a pas assez bougé.
   */
  function runHeading(point) {
    const onTrack = fix.current && strayCount.current < OFF_ROUTE_FIXES
    if (route && onTrack) {
      moved.current = point
      return headingAt(guideRef.current.track, fix.current.along)
    }
    const from = moved.current
    if (!from) {
      moved.current = point
      return null
    }
    if (haversine(from, point) < MOVE_FOR_HEADING_M) return null
    moved.current = point
    return bearing(from, point)
  }

  /** Chaque kilomètre franchi, dit à voix haute — sans couper une consigne. */
  function announceSplit(travelled) {
    const done = Math.floor(travelled / 1000)
    if (done <= lastSplit.current) return
    lastSplit.current = done
    const perKm = movingSeconds() / (travelled / 1000)
    voice.speak(
      `${done} kilomètre${done > 1 ? 's' : ''}. Allure ${spoken(perKm)} au kilomètre.`,
      { priority: false },
    )
  }

  /** Position sur le tracé, consigne à venir, et détection du hors-parcours. */
  function followRoute(point) {
    const { track, route: guided } = guideRef.current
    const instructions = guided?.instructions || []
    const found = locate(track, point, fix.current)
    if (!found) return
    fix.current = found
    setProgress(found)

    if (found.offRoute) {
      strayCount.current += 1
      if (strayCount.current === OFF_ROUTE_FIXES) {
        setOffRoute(true)
        if (canDetour) {
          dueAt.current = Date.now() + REROUTE_AFTER_MS
          setRerouteDue(dueAt.current)
          voice.speak("Tu t'es écarté du parcours. Si tu ne le retrouves pas, je t'en propose un nouveau.")
        } else {
          voice.speak("Tu t'es écarté du parcours. Reviens sur le tracé.")
        }
      }
      if (strayCount.current >= OFF_ROUTE_FIXES && canDetour && dueAt.current && Date.now() >= dueAt.current) {
        detour(point)
      }
    } else {
      lastOnAlong.current = found.along
      if (strayCount.current >= OFF_ROUTE_FIXES) voice.speak('Te revoilà sur le parcours.')
      strayCount.current = 0
      dueAt.current = null
      setOffRoute(false)
      setRerouteDue(null)
    }

    const upcoming = nextInstruction(instructions, found.along, announced.current)
    setCurrent(upcoming)
    upcomingStep.current = upcoming
    refreshLockScreen(upcoming, found.along)
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

  /**
   * Un nouveau chemin, depuis là où l'on est, pour finir la boucle — voir
   * `engine/reroute.js`. Calculé sur l'appareil, avec les rues de la
   * recherche : hors réseau aussi.
   */
  async function detour(point = here.current) {
    if (!canDetour || detouring.current || !point) return
    detouring.current = true
    dueAt.current = null
    setRerouting(true)
    const { route: guided, track } = guideRef.current
    try {
      const found = await detourOnDevice({
        request,
        position: point,
        heading: heading.current,
        geometry: guided.geometry,
        fromAlong: lastOnAlong.current,
        travelledM: covered.current,
        plannedM,
      })
      if (!found) throw new Error('Aucun chemin')
      // Revenu sur le tracé pendant le calcul : rien à changer.
      if (strayCount.current < OFF_ROUTE_FIXES) return
      const next = spliceRoute(guided, found, track.cumulative[found.joinIndex] ?? 0)
      adopt(next)
      // La consigne s'affiche tout de suite, sans attendre le relevé suivant.
      const first = nextInstruction(next.instructions, 0, announced.current)
      setCurrent(first)
      upcomingStep.current = first
      refreshLockScreen(first, 0)
      // La première consigne est dite tout de suite, avec l'annonce : on ne la
      // répète pas au relevé suivant.
      acted.current.add(0)
      previewed.current.add(0)
      voice.speak(`Nouvel itinéraire. ${next.instructions[0]?.text ?? ''}`)
      if (isNative()) import('./native').then((n) => n.pulseHaptic())
      onReroute?.(next)
    } catch {
      if (strayCount.current >= OFF_ROUTE_FIXES) {
        dueAt.current = Date.now() + REROUTE_RETRY_MS
        setRerouteDue(dueAt.current)
        voice.speak("Pas de chemin de retour trouvé d'ici. Je réessaie dans un instant.", { priority: false })
      }
    } finally {
      detouring.current = false
      setRerouting(false)
    }
  }

  /** Suit désormais `next` : le guidage repart de son début. */
  function adopt(next) {
    const g = guideOf(next)
    guideRef.current = g
    setGuide(g)
    fix.current = null
    strayCount.current = 0
    lastOnAlong.current = 0
    announced.current = new Set()
    previewed.current = new Set()
    acted.current = new Set()
    setOffRoute(false)
    setRerouteDue(null)
    setCurrent(null)
    setProgress(null)
  }

  /** L'alerte de traversée — la seule fois où l'app parle d'elle-même. */
  function warnCrossing(point) {
    // Repérées par leur position, pas par leur rang : un recalcul renumérote la
    // liste, et une traversée déjà signalée le serait deux fois.
    const upcoming = (guideRef.current.route?.crossings || [])
      .map((c) => ({ ...c, key: `${c.lon},${c.lat}`, d: haversine(point, [c.lon, c.lat]) }))
      .filter((c) => c.d < CROSSING_ALERT_M && !warned.current.has(c.key))
      .sort((a, b) => a.d - b.d)[0]

    if (!upcoming) return
    warned.current.add(upcoming.key)
    setAlert(upcoming)
    if (isNative()) import('./native').then((n) => n.warnHaptic())
    else if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    setTimeout(() => setAlert(null), 8000)
  }

  const finish = () => onStop({ ...state, elapsed: movingSeconds() })

  const bike = sport === 'bike'
  const moving = state.distance > 50 ? state.elapsed / (state.distance / 1000) : 0
  const along = progress?.along ?? 0
  const remaining = route ? Math.max(0, (guide.route?.distance_m || 0) - along) : null
  const share = route ? (state.distance + remaining > 0 ? state.distance / (state.distance + remaining) : 0) : 0
  // Sur le parcours prévu : un détour décale les distances du tracé suivi.
  const planAlong = along + (guide.route?.plan_offset_m ?? 0)
  const hasProfile = Boolean(route?.elevation_profile?.length > 1)
  const hasGuidance = Boolean(guide.route?.instructions?.length)
  const rerouteIn = rerouteDue ? Math.max(0, Math.ceil((rerouteDue - Date.now()) / 1000)) : null

  return (
    <div className="live">
      {stage && route &&
        createPortal(
          <RunBanner
            step={current}
            offRoute={offRoute}
            rerouting={rerouting}
            rerouteIn={canDetour ? rerouteIn : null}
            onReroute={canDetour ? () => detour() : null}
            hasGuidance={hasGuidance}
            waiting={state.points === 0}
          />,
          stage,
        )}

      {route && (
        <div className="live__bar" aria-hidden="true">
          <i style={{ width: `${share * 100}%` }} />
        </div>
      )}

      {paused && (
        <div className="live__paused" role="status">
          <Icon name="pause" size={17} />
          <div>
            <b>{paused === 'auto' ? 'Pause automatique' : 'En pause'}</b>
            <span>
              {paused === 'auto'
                ? 'Le chrono reprend tout seul dès que tu repars.'
                : 'Reprends quand tu veux, ou termine la sortie.'}
            </span>
          </div>
        </div>
      )}

      <div className={`live__clock ${paused ? 'live__clock--paused' : ''}`} role="timer" aria-label="Temps de course">
        {clock(state.elapsed)}
      </div>

      <div className="stats stats--live">
        <div>
          <b>{km(state.distance)}</b>
          <span>Distance (km)</span>
        </div>
        <div>
          <b>{bike ? speed(state.distance, state.elapsed) : pace(moving)}</b>
          <span>{bike ? 'Vitesse (km/h)' : 'Allure (/km)'}</span>
        </div>
        <div>
          <b>{remaining === null ? (bike ? pace(moving) : speed(state.distance, state.elapsed)) : km(remaining, 1)}</b>
          <span>{remaining === null ? (bike ? 'Allure (/km)' : 'Vitesse (km/h)') : 'Restant (km)'}</span>
        </div>
      </div>

      {/* Sur un parcours à tours, la question qu'on se pose en courant n'est pas
          « combien de kilomètres » mais « quel tour ». Les trois tours sont
          identiques : sans compteur, rien ne les distingue. */}
      {laps > 1 && (
        <div className="lapcount" role="status">
          Tour <b>{Math.min(laps, Math.floor(Math.max(0, planAlong) / lapLength) + 1)}</b>
          {' '}sur <b>{laps}</b>
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

      {/* Collés au bas du panneau, à portée de pouce. En course : le profil, la
          pause, le SOS. « Terminer » n'apparaît qu'en pause : un bouton d'arrêt
          touché par erreur en courant effaçait la fin de la sortie. */}
      <div className="live__controls runctl">
        {paused ? (
          <button className="runctl__side runctl__stop" onClick={finish}>
            <Icon name="stop" size={18} />
            <span>Terminer</span>
          </button>
        ) : (
          <button
            className="runctl__side"
            onClick={() => setProfileOpen(true)}
            disabled={!hasProfile}
            aria-label="Voir le dénivelé prévu"
          >
            <Icon name="mountain" size={19} />
            <span>Dénivelé</span>
          </button>
        )}
        <button
          className={`runctl__main ${paused ? 'runctl__main--paused' : ''}`}
          onClick={togglePause}
          aria-label={paused ? 'Reprendre' : 'Mettre en pause'}
          aria-pressed={Boolean(paused)}
        >
          <Icon name={paused ? 'play' : 'pause'} size={30} strokeWidth={2.4} />
        </button>
        <SosButton position={here} distance={state.distance} elapsed={state.elapsed} className="runctl__sos" />
      </div>

      {profileOpen && hasProfile && (
        <ElevationSheet route={route} along={planAlong} onClose={() => setProfileOpen(false)} />
      )}
    </div>
  )
}

/**
 * La consigne du moment, en bandeau sur la carte — c'est ce qu'on regarde en
 * courant. Le virage en pictogramme, sa distance en très grand, la rue en
 * toutes lettres.
 */
function RunBanner({ step, offRoute, rerouting, rerouteIn, onReroute, hasGuidance, waiting }) {
  if (rerouting) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__spin" aria-hidden="true" />
        <div className="runbar__text">
          <b>Nouvel itinéraire…</b>
          <em>Recherche d'un chemin pour finir la boucle</em>
        </div>
      </div>
    )
  }
  if (offRoute) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__turn">
          <Icon name="warning" size={30} strokeWidth={2.2} />
        </span>
        <div className="runbar__text">
          <b>Hors parcours</b>
          <em>
            {rerouteIn != null
              ? rerouteIn > 0
                ? `Nouvel itinéraire dans ${rerouteIn} s`
                : 'Nouvel itinéraire au prochain relevé'
              : 'Reviens sur le tracé pour reprendre le guidage'}
          </em>
        </div>
        {onReroute && (
          <button className="runbar__act" onClick={onReroute}>
            Recalculer
          </button>
        )}
      </div>
    )
  }
  if (!hasGuidance) {
    return (
      <div className="runbar runbar--idle" role="status">
        <div className="runbar__text">
          <em>Parcours enregistré sans consignes : suis le tracé sur la carte.</em>
        </div>
      </div>
    )
  }
  if (!step) {
    return (
      <div className="runbar runbar--idle" role="status">
        <div className="runbar__text">
          <em>{waiting ? 'Guidage en attente du signal GPS…' : 'Suis le tracé.'}</em>
        </div>
      </div>
    )
  }
  const distance = step.remaining > 20 ? roundedDistance(step.remaining) : 'Maintenant'
  return (
    <div className="runbar" role="status">
      <span className="runbar__turn">
        <Icon name={turnIcon(step.step.turn)} size={34} strokeWidth={2.4} />
      </span>
      <div className="runbar__text">
        <b>{distance}</b>
        <em>{step.step.text}</em>
        {step.step.caution && <small>Traversée non protégée</small>}
      </div>
    </div>
  )
}

function roundedDistance(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1).replace('.', ',')} km`
  return `${Math.round(metres / 10) * 10} m`
}

function turnIcon(turn) {
  if (turn === 'finish') return 'flag'
  if (turn === 'lap') return 'refresh'
  if (turn === 'start') return 'navigation'
  if (turn === 'uturn') return 'uturn'
  if (turn.includes('left')) return 'turnLeft'
  if (turn.includes('right')) return 'turnRight'
  return 'straight'
}

/** « 00:12:07 » : le chrono de course, comme sur une montre. */
function clock(seconds) {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

/** « 11,4 » km/h. */
function speed(metres, seconds) {
  if (metres < 50 || seconds <= 0) return '—'
  return ((metres / seconds) * 3.6).toFixed(1).replace('.', ',')
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
