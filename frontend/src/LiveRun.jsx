import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import ElevationSheet from './ElevationSheet.jsx'
import { haversine, km, pace } from './format'
import { bearing, buildTrack, headingAt, locate, nextInstruction, pointAt } from './routeTracker'
import { lockScreenState, shouldRefresh } from './lockScreen'
import { actAt, announcement, chains, followingStep, previewAt, speedOr, thenLabel } from './guidance'
import { motionTracker } from './autoPause'
import { arrivalWatcher } from './arrival'
import { REPORT_KINDS, addReport, blockedPoints } from './reports'
import { load } from './storage'
import * as voice from './voice'
import SosButton from './SosButton.jsx'
import { isNative } from './platform'
import { watchPosition } from './position'
import { detourOnDevice } from './engine/client'
import { spliceRoute } from './detour'
import { simplify, trailRecorder } from './trail'
import { clearRun, saveRun } from './runState'

// Distance à laquelle on prévient d'une traversée à venir.
const CROSSING_ALERT_M = 120

// En dessous de cette précision GPS, le point est trop douteux pour compter.
const ACCURACY_LIMIT_M = 35

// Les deux temps du guidage — l'annonce, puis « maintenant » — se règlent sur
// la vitesse du moment : voir `guidance.js`.

// La vitesse se lit sur les dernières secondes de course : assez pour lisser le
// tremblement du GPS, assez peu pour suivre une accélération en descente.
const SPEED_WINDOW_MS = 15_000
const SPEED_MIN_MS = 4_000
// En pause, l'allure d'une marche.
const WALKING_SPEED = 1.3

// Le recul sur le tracé à partir duquel on parle de demi-tour : bien au-delà
// du tremblement d'un GPS à l'arrêt, bien en deçà de ce qu'on remonte avant de
// chercher un autre chemin.
const TURN_BACK_M = 50

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
// `resuming` et non `resume` : une fonction interne porte déjà ce nom, et en
// JavaScript une déclaration de fonction écrase le paramètre de même nom — la
// sortie reprise repartait alors de zéro, sans une erreur.
export default function LiveRun({ route, request, sport, resuming, stage, speaking, onPosition, onReroute, onStop }) {
  const [state, setState] = useState({ distance: 0, elapsed: 0, points: 0 })
  const [error, setError] = useState(null)
  const [alert, setAlert] = useState(null)
  const [progress, setProgress] = useState(null)
  const [current, setCurrent] = useState(null)
  const [offRoute, setOffRoute] = useState(false)
  // null en course ; 'auto' arrêté à un feu ; 'manual' mis en pause au bouton.
  const [paused, setPaused] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  // Le choix du signalement, ouvert par le bouton : « travaux », « passage
  // fermé », « danger ».
  const [reporting, setReporting] = useState(false)

  // Le tracé suivi : le parcours choisi, puis, après un recalcul, le raccord et
  // la fin de la boucle. Tenu aussi en référence : les relevés GPS arrivent
  // dans un rappel créé une fois pour toutes, qui doit lire le tracé du moment.
  const [guide, setGuide] = useState(() => guideOf(route))
  const guideRef = useRef(guide)
  const [rerouting, setRerouting] = useState(false)
  const [rerouteDue, setRerouteDue] = useState(null)
  const detouring = useRef(false)
  // Le plus loin atteint sur le tracé, et le demi-tour quand on revient sur ses
  // pas : voir `watchTurnBack`.
  const farthest = useRef(0)
  const turnedBack = useRef(null)
  const [turnBack, setTurnBack] = useState(null)
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
  // L'approche de l'arrivée — voir `arrival.js`. Tenue en référence pour la
  // même raison que le reste : elle est lue dans le rappel des positions.
  const arrival = useRef(null)
  if (!arrival.current) arrival.current = arrivalWatcher()
  const finishing = useRef(false)
  // Le temps de chaque kilomètre, relevé au passage. Sans lui, une sortie
  // relue plus tard n'a qu'une allure moyenne — voir `RunDetail.jsx`.
  const splits = useRef([])
  // Le chrono au dernier passage de borne : c'est lui qui donne le temps du
  // kilomètre suivant. Une somme des tours ne conviendrait pas — une sortie
  // reprise après une coupure n'a plus les tours d'avant, et le premier
  // kilomètre d'après aurait hérité de toute la durée écoulée.
  const splitAt = useRef(0)
  // La distance des dernières secondes, relevé par relevé : l'arrêt n'est sûr
  // qu'au bout de huit secondes, et le tremblement du GPS pendant ce temps —
  // une dizaine de mètres mesurés — doit être retiré, pas compté.
  const trail = useRef([])
  const autoPause = useRef(load().autoPause !== false)
  // La trace réellement suivie, et le dénivelé qu'elle a coûté (voir `trail.js`).
  const trace = useRef(null)
  if (!trace.current) trace.current = trailRecorder(resuming?.trail ?? [])
  // Une sortie reprise après une coupure repart de ses propres chiffres.
  const resumed = useRef(false)
  if (!resumed.current) {
    resumed.current = true
    if (resuming) {
      covered.current = resuming.covered ?? 0
      pausedMs.current = 0
      startedAt.current = Date.now() - (resuming.elapsed ?? 0) * 1000
      lastSplit.current = Math.floor(covered.current / 1000)
      splits.current = resuming.splits ?? []
      splitAt.current = resuming.elapsed ?? 0
    }
  }
  // La sortie est écrite sur le disque de loin en loin : fermée par iOS ou par
  // une batterie vide, elle se retrouve au lancement suivant.
  const savedAt = useRef(0)

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
      keepRun()
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

        // En pause, rien ne compte — ni la distance ni le chrono. Mais le
        // guidage continue : on repart souvent en marchant, sous le seuil de la
        // pause automatique, et c'est là qu'arrive le carrefour. Figé, le
        // bandeau restait sur « 40 m » et la voix se taisait jusqu'à ce qu'on
        // se remette à courir.
        if (pausedKind.current) {
          setState((s) => (s.points ? s : { ...s, points: 1 }))
          if (route) {
            // Arrêté à la main, on a le droit d'aller remplir sa gourde en face :
            // l'écran suit, mais rien ne se dit ni ne se recalcule.
            const quiet = pausedKind.current === 'manual'
            followRoute(point, { quiet })
            if (!quiet) warnCrossing(point)
          }
          heading.current = runHeading(point) ?? heading.current
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
        trace.current.push(point, position.coords.altitude ?? null)
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

  /**
   * Écrit la sortie sur le disque, toutes les dix secondes.
   *
   * Assez souvent pour ne rien perdre d'utile, assez rare pour que l'écriture —
   * qui sérialise aussi l'historique et les favoris — ne se sente pas.
   */
  function keepRun(force = false) {
    const now = Date.now()
    if (!force && now - savedAt.current < 10_000) return
    savedAt.current = now
    saveRun({
      route: route ? { ...route, segments: [] } : null,
      free: !route,
      sport,
      covered: covered.current,
      elapsed: movingSeconds(now),
      trail: trace.current.points,
      splits: splits.current,
    })
  }

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
    // Près d'un virage, la distance affichée doit suivre le pas : cinq secondes
    // de retard, c'est quinze mètres à pied, et le virage déjà passé à vélo.
    const minMs = upcoming && upcoming.remaining < 250 ? 1000 : 5000
    if (!shouldRefresh(shown.current, next, now - shownAt.current, minMs)) return
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
    const elapsed = movingSeconds()
    // Le temps de ce kilomètre-là, pas celui du début : c'est ce qu'on cherche
    // en relisant une sortie — où l'on a accéléré, où l'on a coulé.
    // Un saut de GPS peut franchir deux bornes d'un coup : le temps écoulé est
    // alors réparti entre elles, faute de mieux — inventer deux temps distincts
    // serait pire que d'annoncer les deux kilomètres au même rythme.
    const gap = done - lastSplit.current
    const each = Math.round((elapsed - splitAt.current) / gap)
    for (let n = lastSplit.current + 1; n <= done; n += 1) splits.current.push({ km: n, seconds: each })
    splitAt.current = elapsed
    lastSplit.current = done
    const perKm = elapsed / (travelled / 1000)
    voice.speak(
      `${done} kilomètre${done > 1 ? 's' : ''}. Allure ${spoken(perKm)} au kilomètre.`,
      { priority: false },
    )
  }

  /**
   * Position sur le tracé, consigne à venir, et détection du hors-parcours.
   *
   * `quiet` : en pause mise à la main. Le bandeau et l'écran de verrouillage
   * suivent, mais rien ne se dit et rien ne se recalcule.
   */
  function followRoute(point, { quiet = false } = {}) {
    const { track, route: guided } = guideRef.current
    const instructions = guided?.instructions || []
    const found = locate(track, point, fix.current)
    if (!found) return
    // À la fontaine d'en face, pendant une pause : rien à guider.
    if (quiet && found.offRoute) return
    fix.current = found
    setProgress(found)

    if (quiet) {
      // Rien : ni alerte de sortie du tracé, ni arrivée, ni demi-tour.
    } else if (found.offRoute) {
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

    if (!quiet) {
      watchArrival(point, found)
      watchTurnBack(found)
    }

    const speed = runSpeed()
    const next = nextInstruction(instructions, found.along, announced.current)
    const following = next ? followingStep(instructions, next.index) : null
    // Ce que lisent le bandeau et l'écran de verrouillage : « Maintenant » au
    // même moment que la voix, et la manœuvre d'après quand elle suit de près.
    const upcoming = next
      ? { ...next, imminent: next.remaining <= actAt(speed), then: thenLabel(following, speed) }
      : null
    setCurrent(upcoming)
    upcomingStep.current = upcoming
    refreshLockScreen(upcoming, found.along)
    // Revenu sur ses pas, la prochaine consigne est derrière soi : la dire
    // n'aurait aucun sens — voir `watchTurnBack`.
    if (!upcoming || found.offRoute || quiet || turnedBack.current) return

    const { index, step, remaining } = upcoming
    if (upcoming.imminent && !acted.current.has(index)) {
      acted.current.add(index)
      announced.current.add(index)
      // La suivante est dite dans la même phrase : son annonce, un relevé plus
      // tard, aurait coupé celle-ci au milieu.
      if (chains(following, speed)) previewed.current.add(following.index)
      say(announcement(step, remaining, { stage: 'act', following, speed }))
    } else if (remaining <= previewAt(speed) && !previewed.current.has(index)) {
      previewed.current.add(index)
      say(announcement(step, remaining, { stage: 'preview', following, speed }))
    }
  }

  const say = (text) => {
    if (text) voice.speak(text)
  }

  /**
   * Revenir sur ses pas le long du tracé.
   *
   * Ce n'est pas « hors parcours » — on est dessus —, et pourtant quelque chose
   * bloque devant, le plus souvent : un portail fermé, une rue en travaux, dont
   * on s'aperçoit sur place. L'app continuait d'annoncer le virage d'après,
   * derrière soi, de plus en plus loin, et ne proposait rien : il fallait
   * trouver un autre chemin tout seul.
   *
   * Passé cinquante mètres de recul — bien au-delà du tremblement du GPS à
   * l'arrêt —, on le dit, on propose de signaler le passage fermé là où l'on a
   * fait demi-tour, et tout nouveau chemin calculé l'évitera.
   */
  function watchTurnBack(found) {
    if (found.offRoute) return
    if (found.along > farthest.current) {
      farthest.current = found.along
      if (turnedBack.current) {
        // Reparti dans le bon sens, au-delà du point de demi-tour.
        turnedBack.current = null
        setTurnBack(null)
      }
      return
    }
    if (turnedBack.current || farthest.current - found.along < TURN_BACK_M) return
    turnedBack.current = { along: farthest.current, point: pointAt(guideRef.current.track, farthest.current) }
    setTurnBack(turnedBack.current)
    voice.speak(
      canDetour
        ? 'Tu reviens sur tes pas. Si le passage est fermé, touche « Passage fermé » : je t’en trouve un autre.'
        : 'Tu reviens sur tes pas. Si le passage est fermé, touche « Passage fermé » pour qu’il soit évité la prochaine fois.',
    )
  }

  /**
   * La vitesse du moment, en m/s : la distance des quinze dernières secondes.
   * Avant d'en avoir quatre, l'allure prévue — ou celle du sport.
   */
  function runSpeed() {
    // En pause, on marche — ou l'on ne bouge pas : les distances d'annonce les
    // plus courtes.
    if (pausedKind.current) return WALKING_SPEED
    const points = trail.current
    const last = points[points.length - 1]
    const first = last && points.find((p) => last.t - p.t <= SPEED_WINDOW_MS)
    const measured =
      first && last.t - first.t >= SPEED_MIN_MS ? (last.covered - first.covered) / ((last.t - first.t) / 1000) : null
    const planned = plannedPerKm(request, sport === 'bike')
    return speedOr(measured ?? (planned > 0 ? 1000 / planned : null), sport)
  }

  /**
   * L'arrivée : la boucle revient à son départ, et la sortie s'arrête d'elle-même.
   *
   * La décision est prise dans `arrival.js`, à part, parce qu'elle mérite
   * d'être éprouvée relevé par relevé. Ici, on lui donne ce qu'elle demande et
   * l'on obéit : un mot, une vibration, et le bilan.
   */
  function watchArrival(point, found) {
    const guided = guideRef.current.route
    const fin = guided?.geometry?.[guided.geometry.length - 1]
    if (!fin || finishing.current) return
    const verdict = arrival.current.push({
      toFinish: haversine(point, fin),
      remaining: Math.max(0, (guided.distance_m || 0) - found.along),
      covered: covered.current,
      planned: plannedM || null,
      now: Date.now(),
    })
    if (verdict !== 'arrived') return
    finishing.current = true
    voice.speak('Arrivée. Sortie terminée.')
    if (isNative()) import('./native').then((n) => n.warnHaptic())
    else if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 220])
    finish()
  }

  /**
   * Signaler ce que la carte ne dit pas : des travaux, un passage fermé.
   *
   * Le point est celui où l'on est — voir `reports.js` —, ou, après un
   * demi-tour, celui où l'on a rebroussé chemin : on a déjà remonté cinquante
   * mètres, et c'est l'obstacle qu'on signale, pas l'endroit où l'on se trouve.
   * Sur un parcours, le recalcul part dans la foulée, depuis là où l'on est.
   */
  function report(kind, at = null) {
    const point = at ?? here.current
    setReporting(false)
    if (!point) return
    addReport({ lon: point[0], lat: point[1], kind })
    if (at && turnedBack.current) setTurnBack({ ...turnedBack.current, reported: true })
    if (isNative()) import('./native').then((n) => n.pulseHaptic())
    const said = REPORT_KINDS.find((k) => k.key === kind)?.spoken ?? 'Signalement enregistré.'
    voice.speak(canDetour ? `${said} Je cherche un autre chemin.` : `${said} J'en tiendrai compte.`)
    if (canDetour) detour(here.current ?? point, { forced: true })
  }

  /**
   * Un nouveau chemin, depuis là où l'on est, pour finir la boucle — voir
   * `engine/reroute.js`. Calculé sur l'appareil, avec les rues de la
   * recherche : hors réseau aussi.
   */
  async function detour(point = here.current, { forced = false } = {}) {
    if (!canDetour || detouring.current || !point) return
    detouring.current = true
    dueAt.current = null
    setRerouting(true)
    const { route: guided, track } = guideRef.current
    try {
      const found = await detourOnDevice({
        // Les signalements sont relus ici, et non gardés avec la demande : le
        // plus utile des trois est celui qu'on vient de faire, il y a une
        // seconde, et c'est lui qui doit écarter la rue barrée.
        // Et le point où l'on a fait demi-tour, le temps de cette sortie : ce
        // qui nous a fait rebrousser chemin est encore là.
        request: { ...request, blocked: [...blockedPoints(), ...(turnedBack.current ? [turnedBack.current.point] : [])] },
        position: point,
        heading: heading.current,
        geometry: guided.geometry,
        fromAlong: lastOnAlong.current,
        travelledM: covered.current,
        plannedM,
      })
      if (!found) throw new Error('Aucun chemin')
      // Revenu sur le tracé pendant le calcul : rien à changer. Sauf quand
      // c'est nous qui avons demandé le détour — là, le tracé n'est pas en
      // cause, c'est la rue devant qui est barrée.
      if (!forced && strayCount.current < OFF_ROUTE_FIXES) return
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
      if (forced) {
        voice.speak("Je n'ai pas trouvé d'autre chemin d'ici. Le signalement est gardé pour les prochaines sorties.")
      } else if (strayCount.current >= OFF_ROUTE_FIXES) {
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
    // Le tracé a changé, et son arrivée avec : une approche en cours n'a plus
    // de sens.
    arrival.current = arrivalWatcher()
    farthest.current = 0
    turnedBack.current = null
    setTurnBack(null)
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

  /**
   * Le bilan de la sortie.
   *
   * Tout est lu dans les références, rien dans l'état affiché : l'arrivée
   * automatique part du rappel des positions, créé une fois pour toutes, où
   * `state` est resté celui du premier rendu — une sortie enregistrée à zéro
   * kilomètre. Le bouton, lui, aurait lu la bonne valeur ; la différence entre
   * les deux chemins est exactement le genre de piège que ce fichier évite
   * partout ailleurs avec des références.
   */
  const finish = () => {
    clearRun()
    onStop({
      distance: covered.current,
      elapsed: movingSeconds(),
      // Allégée au dernier moment : pendant la sortie, la trace sert aussi à
      // reprendre, et un point tous les huit mètres y suffit.
      trail: simplify(trace.current.points),
      ascent: trace.current.points.length > 2 ? trace.current.ascent : null,
      rerouted: Boolean(guideRef.current.route?.rerouted),
      splits: splits.current.slice(),
      pausedS: Math.round(pausedMs.current / 1000),
    })
  }

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

  // Le temps qu'il reste : à l'allure tenue depuis le départ tant qu'elle est
  // mesurée, à celle demandée au moteur avant. Sans l'une ni l'autre, rien —
  // une estimation tirée de cinquante mètres de course serait une invention.
  const perKm = moving > 0 ? moving : plannedPerKm(request, bike)
  const left = remaining !== null && perKm > 0 ? (remaining / 1000) * perKm : null

  return (
    <div className="live">
      {stage && route &&
        createPortal(
          <RunBanner
            step={current}
            offRoute={offRoute}
            turnBack={turnBack}
            onBlocked={turnBack ? () => report('closed', turnBack.point) : null}
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

      {/* « Combien il reste » se lit en kilomètres dans les chiffres ; en
          courant, la question est plutôt « j'en ai pour combien de temps », et
          « je rentre à quelle heure ». Les deux se déduisent de l'allure du
          moment — celle qu'on tient vraiment, pas celle qu'on avait prévue. */}
      {left !== null && (
        <p className="live__eta">
          Reste environ <b>{minutes(Math.round(left / 60))}</b> · fin vers{' '}
          <b>{clockTime(Date.now() + left * 1000)}</b>
        </p>
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

      {/* Ce que la carte ne sait pas, dit en passant devant.
          Deux appuis, sans rien à viser : on est devant l'obstacle, c'est la
          position qui fait le signalement. Le second appui relance aussitôt le
          calcul d'un autre chemin — voir `report`. */}
      {reporting ? (
        <div className="signal signal--open" role="group" aria-label="Signaler un problème">
          {REPORT_KINDS.map((k) => (
            <button key={k.key} className="signal__kind" onClick={() => report(k.key)}>
              <Icon name={k.icon} size={19} />
              {k.label}
            </button>
          ))}
          <button className="signal__cancel" onClick={() => setReporting(false)} aria-label="Annuler">
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : (
        <button className="signal" onClick={() => setReporting(true)} disabled={!here.current}>
          <Icon name="cone" size={17} />
          Signaler un problème ici
        </button>
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
function RunBanner({ step, offRoute, turnBack, onBlocked, rerouting, rerouteIn, onReroute, hasGuidance, waiting }) {
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
  if (turnBack) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__turn">
          <Icon name="uturn" size={30} strokeWidth={2.2} />
        </span>
        <div className="runbar__text">
          <b>Demi-tour</b>
          <em>
            {turnBack.reported
              ? 'Passage fermé signalé : il sera évité.'
              : 'Passage fermé devant ? Signale-le, et le parcours le contournera.'}
          </em>
        </div>
        {onBlocked && !turnBack.reported && (
          <button className="runbar__act" onClick={onBlocked}>
            Passage fermé
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
  const distance = step.imminent ? 'Maintenant' : roundedDistance(step.remaining)
  return (
    <div className="runbar" role="status">
      <span className="runbar__turn">
        <Icon name={turnIcon(step.step.turn)} size={34} strokeWidth={2.4} />
      </span>
      <div className="runbar__text">
        <b>{distance}</b>
        <em>{step.step.text}</em>
        {step.step.caution && <small>Traversée non protégée</small>}
        {/* La manœuvre d'après, quand elle suit de si près qu'on ne la verrait
            qu'une fois celle-ci passée — trop tard pour se placer. */}
        {step.then && <span className="runbar__then">{step.then}</span>}
      </div>
    </div>
  )
}

/** L'allure demandée au moteur, en secondes par kilomètre. */
function plannedPerKm(request, bike) {
  if (!request) return 0
  if (bike || request.speed_kmh) return request.speed_kmh ? 3600 / request.speed_kmh : 0
  return request.pace_sec_per_km || 0
}

/** « 42 min », « 1 h 05 » — jamais « 1:05:00 », qu'on lit comme un chrono. */
function minutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** L'heure qu'il sera, dans l'écriture du téléphone. */
const clockTime = (at) =>
  new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

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
