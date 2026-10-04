import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import ElevationSheet from './ElevationSheet.jsx'
import RunBanner from './RunBanner.jsx'
import { ReportButton, RunControls, RunStats } from './RunPanel.jsx'
import { NextStops } from './Stops.jsx'
import useLiveActivity from './useLiveActivity'
import { haversine } from './format'
import { bearing, buildTrack, headingAt, locate, nextInstruction, pointAt } from './routeTracker'
import { lockScreenState } from './lockScreen'
import { actAt, announcement, chains, followingStep, previewAt, speedOr, thenLabel } from './guidance'
import { motionTracker } from './autoPause'
import { arrivalWatcher } from './arrival'
import { REPORT_KINDS, addReport, blockedPoints } from './reports'
import { load } from './storage'
import * as voice from './voice'
import { isNative } from './platform'
import { watchPosition } from './position'
import { detourOnDevice } from './engine/client'
import { spliceRoute } from './detour'
import { simplify, trailRecorder } from './trail'
import { clearRun, saveRun } from './runState'
import { capitalize, ordinal, plannedPerKm, spoken, spokenSpeed } from './runFormat'

/** Une vibration de l'iPhone — rien dans l'aperçu de développement. */
const haptic = (kind) => {
  if (isNative()) import('./native').then((n) => n[kind]())
}

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

// Un saut de plus de cent mètres entre deux relevés est un artefact du GPS, pas
// un déplacement — **sauf si le temps écoulé l'explique**. Au sortir d'un
// tunnel, d'un passage sous voie, d'une minute sans signal dans une rue
// étroite, le relevé suivant tombe deux ou trois cents mètres plus loin : ces
// mètres-là ont été courus, et les jeter faussait toute la distance. La vitesse
// retenue est celle qu'on ne dépasse pas — un sprint à pied, une descente à
// vélo : au-delà, c'est bien un artefact.
const JUMP_M = 100
const TOP_SPEED_MS = { run: 7, bike: 22 }

// Un point d'eau ou des toilettes s'annoncent à cette distance : assez tôt pour
// ralentir et regarder, assez tard pour qu'on s'en souvienne en y arrivant.
const STOP_ALERT_M = 120
const STOP_EVERY_M = 1000

// Les bornes annoncées : chaque kilomètre à pied ; à vélo, où il en passe un
// toutes les deux minutes, tous les cinq.
const SPLIT_EVERY_KM = { run: 1, bike: 5 }

// Le cumul du baromètre est relu toutes les cinq secondes : le dernier mètre
// monté avant « Terminer » n'est pas une affaire. Et il ne fait foi qu'après
// une demi-minute de relevés — un par seconde environ.
const BARO_READ_MS = 5000
const BARO_MIN_SAMPLES = 30

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
export default function LiveRun({ route, request, sport, resuming, stage, speaking, stops = [], onPosition, onReroute, onStop }) {
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
  // Le plus loin atteint sur le tracé, et le demi-tour quand on revient sur ses
  // pas : voir `watchTurnBack`.
  const farthest = useRef(0)
  const turnedBack = useRef(null)
  const [turnBack, setTurnBack] = useState(null)
  const dueAt = useRef(null)
  const lastOnAlong = useRef(0)

  const last = useRef(null)
  // L'heure du relevé `last` : c'est elle qui dit si un saut est plausible.
  const lastAt = useRef(null)
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
  // L'écran de verrouillage — voir `useLiveActivity.js` — et la consigne qu'il montre.
  const refreshLock = useLiveActivity(route)
  const upcomingStep = useRef(null)
  // Les arrêts le long du tracé — lus dans le rappel des positions, créé une
  // fois pour toutes — et ceux déjà annoncés.
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const saidStops = useRef(new Set())
  const lastStopSaid = useRef({})
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
  if (!trace.current) trace.current = trailRecorder(resuming?.trail ?? [], resuming?.ascent ?? 0)
  // Le dénivelé au baromètre — voir `measuredAscent`. `base` : celui d'avant une
  // reprise ; `reading` : le dernier cumul rendu par le module natif.
  const baro = useRef({ base: resuming?.ascent ?? 0, reading: null })
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

  // Le baromètre mesure pendant toute la sortie ; on relit son cumul de loin
  // en loin. Le cumul vit côté natif : rien n'est perdu entre deux lectures.
  useEffect(() => {
    if (!isNative()) return undefined
    const native = import('./native')
    native.then((n) => n.startAltimeter())
    const poll = setInterval(() => {
      native
        .then((n) => n.readAltimeter())
        .then((reading) => {
          if (reading) baro.current.reading = reading
        })
    }, BARO_READ_MS)
    return () => {
      clearInterval(poll)
      native.then((n) => n.stopAltimeter())
    }
  }, [])

  // Garder l'écran allumé pendant la sortie.
  useEffect(() => {
    if (!isNative()) return undefined
    const native = import('./native')
    native.then((n) => n.keepScreenOn())
    return () => {
      native.then((n) => n.allowScreenOff())
    }
  }, [])

  useEffect(() => {
    const tick = setInterval(() => {
      setState((s) => ({ ...s, elapsed: movingSeconds() }))
      keepRun()
    }, 1000)

    // `background` : le suivi continue écran verrouillé, téléphone dans la poche.
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

        const at = position.timestamp ?? Date.now()
        if (last.current) {
          const step = haversine(last.current, point)
          // Voir `JUMP_M` : un saut n'est compté que si le temps l'explique.
          const seconds = lastAt.current ? Math.max(0, (at - lastAt.current) / 1000) : 0
          if (step < Math.max(JUMP_M, seconds * (TOP_SPEED_MS[sport] ?? TOP_SPEED_MS.run))) {
            covered.current += step
            setState((s) => ({ ...s, distance: covered.current, points: s.points + 1 }))
            announceSplit(covered.current)
          }
          const now = Date.now()
          trail.current.push({ t: now, covered: covered.current })
          while (trail.current.length && now - trail.current[0].t > 20_000) trail.current.shift()
        }
        last.current = point
        lastAt.current = at
        trace.current.push(point, position.coords.altitude ?? null, position.coords.altitudeAccuracy ?? null)
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
      ...measuredAscent(),
    })
  }

  /**
   * Le dénivelé monté jusqu'ici, et d'où il vient.
   *
   * Le baromètre d'abord : l'altitude du GPS tremble de plusieurs mètres, et le
   * dénivelé qu'on en tirait servait de juge au dénivelé annoncé — un juge plus
   * bruité que l'accusé. Le GPS ne prend le relais que si le baromètre n'a rien
   * dit : iPhone qui refuse l'accès aux mouvements, ou installation d'avant le
   * module.
   */
  function measuredAscent() {
    const reading = baro.current.reading
    if (reading?.samples >= BARO_MIN_SAMPLES && Number.isFinite(reading.ascent)) {
      return { ascent: Math.round(baro.current.base + reading.ascent), ascentSource: 'baro' }
    }
    if (trace.current.points.length > 2) return { ascent: trace.current.ascent, ascentSource: 'gps' }
    return { ascent: null, ascentSource: null }
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
      haptic('pulseHaptic')
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
    // Près d'un virage, la distance affichée doit suivre le pas : cinq secondes
    // de retard, c'est quinze mètres à pied, et le virage déjà passé à vélo.
    const minMs = upcoming && upcoming.remaining < 250 ? 1000 : 5000
    refreshLock(
      () =>
        lockScreenState({
          route: guideRef.current.route,
          step: upcoming,
          along,
          offRoute: strayCount.current >= OFF_ROUTE_FIXES,
          paused: Boolean(pausedKind.current),
          travelled: covered.current,
          elapsedS: movingSeconds(),
          share: outingShare(along),
        }),
      minMs,
    )
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

  /**
   * Chaque kilomètre franchi, relevé pour le bilan et dit à voix haute — sans
   * couper une consigne.
   *
   * La voix dit d'abord le temps **de ce kilomètre-là** : c'est ce qu'on veut
   * savoir en courant — suis-je en train de ralentir ? L'allure moyenne depuis
   * le départ, seule annoncée jusqu'ici, bouge à peine passé le cinquième
   * kilomètre et ne répond pas à la question. À vélo, un kilomètre passe toutes
   * les deux minutes : la voix ne parle que tous les cinq, et en kilomètres-heure.
   */
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
    const previous = lastSplit.current
    for (let n = lastSplit.current + 1; n <= done; n += 1) splits.current.push({ km: n, seconds: each })
    splitAt.current = elapsed
    lastSplit.current = done

    const every = SPLIT_EVERY_KM[sport] ?? 1
    if (Math.floor(done / every) <= Math.floor(previous / every)) return
    if (sport === 'bike') {
      const kmh = travelled / 1000 / (elapsed / 3600)
      voice.speak(`${done} kilomètres. Moyenne ${spokenSpeed(kmh)}.`, { priority: false })
      return
    }
    // « Troisième kilomètre », et non « ce kilomètre » : en courant, on ne
    // compte pas les annonces, et la borne dite par son rang répond d'un coup
    // aux deux questions — où en suis-je, et à quelle allure.
    const which = `${capitalize(ordinal(done))} kilomètre`
    const average = `Allure moyenne ${spoken(elapsed / (travelled / 1000))}.`
    // Deux bornes franchies d'un coup n'ont pas de temps propre à dire ; et
    // au premier, la moyenne répéterait le temps qu'on vient d'entendre.
    let said = `${which}. ${average}`
    if (gap === 1 && each > 0) said = done === 1 ? `${which} à ${spoken(each)}.` : `${which} à ${spoken(each)}. ${average}`
    voice.speak(said, { priority: false })
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
      if (!found.offRoute) announceStop(found.along)
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
   * « Point d'eau dans cent mètres. » Une fois par arrêt, sans couper une
   * consigne : c'est une information, pas une manœuvre. Et pas plus d'une fois
   * par kilomètre et par genre : à Paris, il y a une fontaine tous les deux
   * cents mètres, et la voix n'aurait plus parlé que de ça.
   */
  function announceStop(along) {
    const next = stopsRef.current.find(
      (s) => s.along > along && s.along - along <= STOP_ALERT_M && !saidStops.current.has(`${s.kind}@${s.along}`),
    )
    if (!next) return
    saidStops.current.add(`${next.kind}@${next.along}`)
    const last = lastStopSaid.current[next.kind]
    if (last != null && next.along - last < STOP_EVERY_M) return
    lastStopSaid.current[next.kind] = next.along
    const metres = Math.max(20, Math.round((next.along - along) / 10) * 10)
    voice.speak(`${next.kind === 'water' ? "Point d'eau" : 'Toilettes'} dans ${metres} mètres.`, { priority: false })
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
    haptic('warnHaptic')
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
    if (!point) return
    addReport({ lon: point[0], lat: point[1], kind })
    if (at && turnedBack.current) setTurnBack({ ...turnedBack.current, reported: true })
    haptic('pulseHaptic')
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
      haptic('pulseHaptic')
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
    // Les distances des arrêts se comptent désormais sur le nouveau tracé.
    saidStops.current = new Set()
    lastStopSaid.current = {}
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
    haptic('warnHaptic')
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
      ...measuredAscent(),
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

      <RunStats
        bike={bike}
        state={state}
        moving={moving}
        left={left}
        remaining={remaining}
        paused={paused}
        laps={laps}
        lap={Math.min(laps, Math.floor(Math.max(0, planAlong) / lapLength) + 1)}
      />

      {route && stops.length > 0 && <NextStops stops={stops} along={along} />}

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

      <ReportButton disabled={!here.current} onReport={(kind) => report(kind)} />

      <RunControls
        paused={paused}
        onFinish={finish}
        onProfile={hasProfile ? () => setProfileOpen(true) : null}
        onTogglePause={togglePause}
        here={here}
        distance={state.distance}
        elapsed={state.elapsed}
      />

      {profileOpen && hasProfile && (
        <ElevationSheet route={route} along={planAlong} onClose={() => setProfileOpen(false)} />
      )}
    </div>
  )
}
