import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Countdown from './Countdown.jsx'
import MapView from './MapView.jsx'
import FiltersSheet, { DEFAULTS, SPORTS, estimateKm, formatKm, raceOf } from './FiltersSheet.jsx'
import SearchBar from './SearchBar.jsx'
import LiveRun from './LiveRun.jsx'
import RunSummary from './RunSummary.jsx'
import PlaceSheet from './PlaceSheet.jsx'
import Explore from './Explore.jsx'
import Library from './Library.jsx'
import RunDetail from './RunDetail.jsx'
import useLibrary from './useLibrary'
import useRunSession from './useRunSession'
import useSearch, { usePrefetch } from './useSearch'
import { blockedPoints } from './reports'
import Account from './Account.jsx'
import MapStyleSheet from './MapStyleSheet.jsx'
import useGeolocation from './useGeolocation'
import { DEFAULT_STYLE, styleByKey } from './mapStyles'
import { describePlace } from './api'
import { km, pace } from './format'
import { load, recentPlaces, save, slim } from './storage'
import * as offline from './offlineMaps'
import { clearEngineData, matchOnDevice, reverseOnDevice } from './engine/client'
import { haversineM } from './engine/geo'
import { appDeltaY, currentTurn } from './orientation'
import * as voice from './voice'

const PARIS = { lat: 48.8566, lon: 2.3522 }

// « Distance exacte » : l'écart toléré entre la boucle et la distance visée.
const PRECISE_TOLERANCE = 0.025

/**
 * La poignée de la feuille, sur téléphone.
 *
 * Elle ne porte que le repère visuel et le clavier : le geste, lui, est écouté
 * par **tout l'en-tête** de la feuille (voir `useSheetDrag`). Viser une barre
 * de quarante pixels en courant, ou d'une main dans le métro, ne marchait pas ;
 * on tire maintenant n'importe où dans le bandeau du haut, et la feuille suit
 * le doigt avant de se refermer.
 */
function SheetGrabber({ open, onSet }) {
  return (
    <button
      type="button"
      className="grabber"
      aria-label={open ? 'Replier le détail' : 'Déplier le détail'}
      aria-expanded={open}
      // Le doigt et la souris passent par l'en-tête ; ici, seul le clavier
      // (`detail` vaut 0) — sinon le geste serait compté deux fois.
      onClick={(e) => e.detail === 0 && onSet(open ? 'peek' : 'full')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onSet('full')
        else if (e.key === 'ArrowDown') onSet('peek')
        else return
        e.preventDefault()
      }}
    />
  )
}

/**
 * Tirer la feuille de détail vers le bas pour la refermer.
 *
 * Quatre choses en font un vrai geste plutôt qu'un raccourci : la feuille suit
 * le doigt pendant qu'on tire, elle ne se referme qu'au-delà d'un seuil — sinon
 * elle revient en place —, elle **glisse vers le bas** en se refermant au lieu
 * de disparaître d'un coup, et le geste part de **n'importe où** : de l'en-tête,
 * ou du contenu lui-même quand il est déjà en haut de sa course. C'est ce que
 * fait n'importe quelle feuille d'iOS, et c'est ce qu'on essaie sans y penser.
 *
 * Les distances sont mesurées **dans le sens de l'app** : téléphone couché,
 * elle a pivoté d'un quart de tour, et « vers le bas » n'est plus le bas de
 * l'écran (voir `orientation.js`).
 */
function useSheetDrag(mode, setSheet, shellRef) {
  const drag = useRef(null)
  const CLOSE_M = 64
  // Au-delà de ce glissement, on sait que le doigt descend : avant, ce peut
  // être un défilement qui commence.
  const COMMIT_M = 12

  const shift = (px, closing = false) => {
    const shell = shellRef.current
    if (!shell) return
    if (px === null) {
      shell.style.removeProperty('--sheet-drag')
      delete shell.dataset.dragging
      delete shell.dataset.closing
      return
    }
    shell.style.setProperty('--sheet-drag', `${px}px`)
    if (closing) shell.dataset.closing = 'yes'
    else shell.dataset.dragging = 'yes'
  }

  const travel = (e) =>
    appDeltaY(currentTurn(), e.clientX - drag.current.x, e.clientY - drag.current.y)

  /**
   * `fromBody` : le geste part du contenu, qui défile. On ne prend la main
   * qu'une fois sûr qu'il descend **et** que la liste est déjà en haut ;
   * autrement on laisserait la feuille partir pendant qu'on lit.
   */
  const handlers = (fromBody = false) => ({
    onPointerDown: (e) => {
      if (mode !== 'full') return
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      const scroller = fromBody ? e.currentTarget : null
      if (scroller && scroller.scrollTop > 0) return
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        scroller,
        live: !fromBody,
        grip: e.target instanceof Element && Boolean(e.target.closest('.grabber')),
      }
      if (!fromBody) e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      if (!drag.current) return
      const dy = travel(e)
      if (!drag.current.live) {
        if (dy < COMMIT_M || drag.current.scroller?.scrollTop > 0) return
        drag.current.live = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      // Vers le haut, rien ne bouge : la feuille est déjà en butée.
      shift(Math.max(0, dy))
    },
    onPointerUp: (e) => {
      if (!drag.current) return
      const dy = travel(e)
      const { grip, live } = drag.current
      drag.current = null
      if ((live && dy > CLOSE_M) || (grip && Math.abs(dy) < 8)) {
        // La feuille finit sa course avant de rendre la place : fermée d'un
        // coup, on ne comprend pas ce qui vient de se passer.
        shift(Math.max(dy, CLOSE_M) + 260, true)
        setTimeout(() => {
          setSheet('peek')
          shift(null)
        }, 180)
        return
      }
      shift(null)
    },
    onPointerCancel: () => {
      drag.current = null
      shift(null)
    },
  })

  return handlers
}

export default function App() {
  const stored = useMemo(() => load(), [])

  const [params, setParams] = useState({ ...DEFAULTS, ...(stored.params || {}) })
  const [mapStyle, setMapStyle] = useState(stored.mapStyle || DEFAULT_STYLE)
  const [start, setStart] = useState(null)
  // `applyStart` ne dépend de rien pour rester stable d'un rendu à l'autre ;
  // elle a pourtant besoin du départ courant, et le lit donc ici.
  const startRef = useRef(null)
  startRef.current = start
  const [startLabel, setStartLabel] = useState(null)
  const [placing, setPlacing] = useState(false)

  const [tab, setTab] = useState('explore')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [stylesOpen, setStylesOpen] = useState(false)
  const [detail, setDetail] = useState(true)
  // Sur téléphone, le panneau des propositions a deux hauteurs. Repliée, la
  // carte occupe l'écran et seules les cartes de parcours flottent dessus ;
  // dépliée, le détail du parcours choisi prend la place. Sans effet sur grand
  // écran, où tout tient côte à côte.
  const [sheet, setSheet] = useState('peek')
  const shellRef = useRef(null)

  // La recherche et ce qu'elle produit : jeton, élargissement, repère qui
  // rejoint la rue — voir `useSearch.js`.
  const found = useSearch()
  const { result, selected, busy, progress, error, snapped, scrub } = found
  const setSelected = found.setSelected
  const setScrub = found.setScrub
  // Numéro de « Régénérer » depuis la dernière recherche ordinaire.
  const variation = useRef(0)
  const [focus, setFocus] = useState(null)

  // Les favoris, les sorties et les départs nommés : trois listes qui partagent
  // une contrainte de place, et les plafonds qui en découlent — voir
  // `useLibrary.js`.
  const library = useLibrary(stored)
  const { saved, history, places } = library

  // La sortie, du premier appui au bilan : une machine, et non neuf états
  // indépendants — voir `useRunSession.js`. Les noms locaux restent ceux que
  // tout l'écran emploie.
  const run = useRunSession({ toEntry: runEntry, remember: (e) => library.remember(e) })
  const {
    running,
    starting,
    freeRun,
    pending,
    resume,
    summary,
    position: livePosition,
    heading: liveHeading,
    route: liveRoute,
  } = run
  // La sortie passée qu'on regarde, ouverte depuis l'historique. Distincte de
  // `summary` — celle qu'on vient de terminer — parce qu'on n'y fait pas les
  // mêmes gestes : l'une se referme, l'autre se rejoue ou se supprime.
  const [viewing, setViewing] = useState(null)
  const [geoNoticeOpen, setGeoNoticeOpen] = useState(true)

  // Les commandes de la carte en course : la voix, l'orientation — dans le sens
  // de la course, ou nord en haut — et la vue d'ensemble du parcours.
  const [speaking, setSpeaking] = useState(() => voice.available)
  const [runView, setRunView] = useState(stored.runView === 'north' ? 'north' : 'heading')
  const [overviewAt, setOverviewAt] = useState(0)
  const [northAt, setNorthAt] = useState(0)
  const [startMenu, setStartMenu] = useState(false)
  const [naming, setNaming] = useState(false)
  const stageRef = useRef(null)
  const compassRef = useRef(null)


  const geo = useGeolocation()

  // --- point de départ ------------------------------------------------------
  // `recenter` distingue les deux gestes : choisir un lieu amène la carte
  // dessus, déplacer le repère la laisse où elle est.
  const applyStart = useCallback(async (point, label, recenter = false) => {
    // Les boucles proposées partent toutes du point précédent : dès qu'il
    // bouge, elles ne répondent plus à la question posée. Elles restaient
    // pourtant à l'écran — on choisissait un village suisse et la carte montrait
    // le Valais sous une carte intitulée « Boucle sud-ouest · avenue des
    // Gobelins ». Dix mètres de tolérance pour le doigt qui replace le repère
    // sans vraiment le déplacer.
    const previous = startRef.current && askedOf(startRef.current)
    if (previous && haversineM([previous.lon, previous.lat], [point.lon, point.lat]) > 10) {
      found.forget()
    }
    setStart(point)
    setStartLabel(label ?? null)
    setPlacing(false)
    if (recenter) setFocus({ ...point, at: Date.now() })
    if (label === undefined) setStartLabel(await describePlace(point.lat, point.lon))
  }, [])

  // Au premier chargement on tente la position ; le refus n'est pas un échec,
  // c'est un cas normal — on retombe sur le dernier départ choisi, et la carte
  // reste utilisable.
  useEffect(() => {
    geo.locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (geo.status === 'ready' && geo.position && !start) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    }
    if ((geo.status === 'denied' || geo.status === 'error') && !start) {
      // Sans position, le dernier départ choisi vaut mieux que Paris : c'est
      // presque toujours chez soi, ses rues sont déjà sur l'appareil, et c'est
      // le seul repère dont on dispose. Paris ne reste que pour une première
      // ouverture, quand il n'y a encore rien à se rappeler.
      const dernier = recentPlaces()[0]
      if (dernier) applyStart(placeOf(dernier), dernier.label, true)
      else applyStart(PARIS, 'Paris', true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.position])

  // Le bouton de position ne fait qu'une chose : amener la carte sur place.
  // Il déplaçait aussi le départ, ce qui mêlait deux questions — « où suis-je »
  // et « d'où je pars » ; le départ a désormais son propre bouton.
  //
  // Comme sur les cartes d'un téléphone : une touche recentre, une seconde,
  // sans avoir bougé la carte entre-temps, la fait suivre nos déplacements ;
  // une troisième arrête. Si la position est déjà connue on y va tout de suite,
  // et on relance une mesure en parallèle pour l'affiner.
  const pendingLocate = useRef(false)
  const pendingStart = useRef(false)
  const centered = useRef(false)
  const centerOnMe = () => {
    if (geo.following) {
      geo.setFollowing(false)
      centered.current = false
      return
    }
    if (centered.current && geo.position) {
      geo.setFollowing(true)
      return
    }
    if (geo.position) {
      setFocus({ lat: geo.position[1], lon: geo.position[0], at: Date.now() })
      centered.current = true
    }
    pendingLocate.current = true
    geo.locate()
  }

  const keepPlace = (name) => {
    if (!start) return
    // Le point choisi, et non le seuil de la rue où le repère s'est posé : c'est
    // de lui que se déduit, à chaque recherche, le côté par où sortir.
    const { lat, lon, street } = askedOf(start)
    library.keepPlace({ id: `p${Date.now()}`, name, lat, lon, ...(street ? { street } : {}) })
    setNaming(false)
  }

  const dropPlace = (id) => library.dropPlace(id)

  const startFromHere = () => {
    setStartMenu(false)
    if (geo.position) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    } else {
      pendingStart.current = true
      geo.locate()
    }
  }

  // Résultat d'une demande explicite : on recadre — ou on pose le départ —
  // même si la position n'avait pas changé de valeur.
  useEffect(() => {
    if (geo.status !== 'ready' || !geo.position) return
    const point = { lat: geo.position[1], lon: geo.position[0] }
    if (pendingStart.current) {
      pendingStart.current = false
      applyStart(point, undefined, true)
    } else if (pendingLocate.current) {
      pendingLocate.current = false
      setFocus({ ...point, at: Date.now() })
      centered.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.at])

  // Le menu du départ se ferme au premier geste ailleurs.
  useEffect(() => {
    if (!startMenu) return undefined
    const close = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.startmenu, .tool--start')) setStartMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [startMenu])

  // --- génération -----------------------------------------------------------
  // Ce qui reste ici : traduire les réglages en demande, et ce que l'écran doit
  // faire autour — ranger les filtres, revenir à l'onglet, replier la feuille.
  // Le calcul, son jeton et son élargissement sont dans `useSearch.js`.
  const search = useCallback(
    async (next, { regenerate = false } = {}) => {
      const active = next || params
      // Une recherche ordinaire repart de zéro ; « Régénérer » tourne les polygones
      // d'un cran de plus et s'écarte des directions qu'on vient de montrer.
      variation.current = regenerate ? variation.current + 1 : 0
      const avoid = regenerate ? (result?.routes ?? []).map((r) => r.bearing) : []
      if (next) {
        setParams(next)
        save({ params: next })
      }
      setFiltersOpen(false)
      if (!start) return

      setTab('explore')
      setSheet('peek')
      // Les signalements sont lus au moment du départ de la recherche, pas
      // gardés en mémoire : celui qu'on vient de faire en courant doit compter
      // dès la boucle suivante.
      //
      // Le repère se pose ensuite sur la rue, là où la boucle commence ; la
      // demande, elle, repart toujours du point choisi — la maison, pas le
      // trottoir —, pour que chaque recherche sorte du même côté.
      const asked = askedOf(start)
      await found.run(
        {
          ...toRequest(active, start),
          variation: variation.current,
          avoid_bearings: avoid,
          blocked: blockedPoints(),
        },
        {
          from: asked,
          onStart: (point) => {
            const next = { ...point, asked }
            startRef.current = next
            setStart(next)
          },
        },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, start, result],
  )

  // --- préparation en fond -----------------------------------------------------
  // Dès que le départ et les réglages sont connus, les rues de la zone se
  // téléchargent en fond, et leur graphe se construit : la recherche qui suit
  // les trouve prêts — voir `engine/worker.js`. Rien pour Paris par défaut,
  // qui n'est qu'un repli quand la position est refusée ; rien sans réseau, ni
  // quand le téléphone demande d'économiser les données.
  const prefetchKey = useMemo(() => {
    if (!start || start === PARIS) return null
    return JSON.stringify(toRequest(params, start))
  }, [start, params])
  const { prepared, preparing } = usePrefetch(prefetchKey, running)

  // --- raccourcis clavier ----------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      // La cible d'un événement clavier n'est pas toujours un élément — et même
      // quand elle l'est, taper « f » dans un champ ne doit pas ouvrir les
      // filtres. `closest` couvre aussi les champs contenus dans un composant.
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, [contenteditable]')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        setFiltersOpen(false)
        setPlacing(false)
        setStartMenu(false)
        setSheet('peek')
      }
      // En course, plus rien ne change le parcours ni les réglages.
      if (running) return
      if (e.key === 'Enter' && !filtersOpen) search()
      if (e.key === 'f') setFiltersOpen((v) => !v)
      if (e.key === 'l') centerOnMe()
      if (e.key === 'p') setPlacing((v) => !v)
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && result?.routes[n - 1]) setSelected(result.routes[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filtersOpen, running, result])

  // Hauteur de carte recouverte par le panneau, en variable CSS : l'attribution
  // et la consigne de placement se posent juste au-dessus, au lieu de passer
  // sous les cartes de parcours. Mesurée plutôt que calculée — elle dépend du
  // contenu, de l'onglet, et de la feuille repliée ou non.
  useEffect(() => {
    const shell = shellRef.current
    const side = shell?.querySelector('.side')
    if (!side) return undefined
    const update = () => {
      // En coordonnées de mise en page, pas d'écran : téléphone couché, l'app
      // entière a pivoté, et son bas n'est plus celui de l'écran.
      const cover = shell.clientHeight - side.offsetTop
      shell.style.setProperty('--sheet-cover', `${Math.max(0, Math.round(cover))}px`)
    }
    const observer = new ResizeObserver(update)
    observer.observe(side)
    observer.observe(shell)
    update()
    return () => observer.disconnect()
  }, [])

  // --- favoris et historique --------------------------------------------------
  // La même clé que celle des cartes hors ligne, et pour cause : c'est elle
  // qui relie un favori à sa carte. En recopier la formule ici marchait tant
  // que les deux restaient identiques — le jour où l'une aurait bougé,
  // l'app aurait affiché « carte disponible » sur un parcours dont la carte
  // serait devenue introuvable, sans rien signaler.
  const isFavorite = library.isFavorite(selected)

  /** Construit l'entrée d'historique d'une sortie terminée. */
  function runEntry(stats, { route, free, sport: ranWith }) {
    const base = free ? freeRunEntry({ ...params, sport: ranWith }) : slim(route)
    return {
      ...base,
      ranAt: new Date().toISOString(),
      actual_distance_m: Math.round(stats.distance),
      actual_duration_s: Math.round(stats.elapsed),
      actual_ascent_m: stats.ascent ?? null,
      // Ce qu'on a réellement couru, allégé — voir `trail.js`.
      track: stats.trail?.length > 1 ? stats.trail : null,
      // Le temps de chaque kilomètre, et le temps passé à l'arrêt : relevés
      // pendant la sortie, impossibles à retrouver après coup.
      splits: stats.splits?.length ? stats.splits : null,
      paused_s: stats.pausedS || 0,
      rerouted: Boolean(stats.rerouted),
      free: Boolean(free),
      sport: ranWith,
    }
  }

  /**
   * Range une sortie dans l'historique.
   *
   * Les traces ne sont gardées que pour les sorties récentes : une trace pèse
   * quelques dizaines de kilooctets, et le stockage du navigateur finirait par
   * refuser d'écrire — en emportant un favori plutôt qu'une vieille trace.
   */
  const remember = (entry) => library.remember(entry)

  /** Rouvre un parcours gardé — un favori, ou celui d'une sortie à refaire. */
  function openRoute(r) {
    found.show(r)
    setTab('explore')
    setSheet('peek')
    setDetail(true)
  }

  // La demande d'où vient le parcours suivi. Celle de la recherche s'il en
  // sort ; pour un parcours rouvert depuis les favoris, on la reconstitue :
  // son départ, sa longueur, les réglages du moment.
  const detourRequest = useMemo(() => {
    if (!selected?.geometry?.length) return null
    if (result?.request && result.routes?.some((r) => r.id === selected.id)) return result.request
    const [lon, lat] = selected.geometry[0]
    const distanceKm = Math.max(0.5, Math.round((selected.distance_m || 0) / 100) / 10)
    return toRequest({ ...params, mode: 'distance', distance_km: distanceKm }, { lat, lon })
  }, [selected, result, params])

  const beginRun = (kind) => run.countdown(kind)

  // --- l'autre sens ------------------------------------------------------------
  // La même boucle retournée : mêmes rues, même note, mais les côtes dans
  // l'autre sens, le vent à la fin, et toutes les consignes refaites. Le moteur
  // la recalcule à partir du candidat qu'il a gardé ; si le graphe a été
  // remplacé entre-temps, il le dit, et on ne prétend pas savoir.
  const [reversing, setReversing] = useState(false)
  const reverseSelected = async () => {
    if (!selected || reversing) return
    setReversing(true)
    try {
      const { route } = await reverseOnDevice(selected.id)
      found.swap(selected.id, route)
    } catch (err) {
      found.fail(err.message)
    } finally {
      setReversing(false)
    }
  }

  // --- un parcours venu d'ailleurs ---------------------------------------------
  // Le fichier entre comme favori : c'est là qu'on va chercher un parcours
  // qu'on n'a pas calculé, et de là qu'on le lance. Rien n'y est noté ni guidé
  // — voir `engine/gpxImport.js`.
  const importGpx = async (file) => {
    const { parseGpx, toRoute } = await import('./engine/gpxImport')
    const lu = parseGpx(await file.text(), { name: file.name.replace(/\.gpx$/i, '') })
    const brut = toRoute(lu, {
      sport: params.sport,
      secondsPerKm:
        params.sport === 'bike' || params.speedUnit === 'speed'
          ? 3600 / params.speed_kmh
          : params.pace_sec_per_km,
    })

    // **Reconnaître les rues.** Un fichier ne donne que des points ; accroché au
    // réseau, il rend un parcours comme les autres — noms de rues, traversées,
    // note, consignes. Le téléchargement des rues peut prendre quelques
    // secondes, d'où la barre de progression ; si rien n'est reconnu, on garde
    // le tracé tel quel plutôt que de prétendre.
    let route = brut
    await found.working(async (etape) => {
      try {
        const out = await matchOnDevice({ trace: lu.coords, sport: params.sport, name: brut.name }, etape)
        if (out?.route) route = { ...out.route, id: brut.id, duration_s: brut.duration_s }
      } catch {
        /* pas de réseau, ou rues introuvables : le tracé brut fera l'affaire */
      }
    })

    library.keepRoute(route)
    // On l'ouvre tout de suite sur la carte : importer sans voir ce qui est
    // entré laisserait douter que le bon fichier ait été choisi.
    found.show(route)
    setTab('explore')
    setSheet('peek')
  }

  const toggleVoice = () => {
    voice.unlock()
    setSpeaking((v) => !v)
  }
  const toggleRunView = () => {
    const next = runView === 'north' ? 'heading' : 'north'
    setRunView(next)
    save({ runView: next })
  }

  const sport = SPORTS.find((s) => s.key === params.sport)
  const theme = styleByKey(mapStyle).contrast
  // L'état que lit la CSS : la sortie et les pages de liste imposent le leur.
  const sheetMode = running
    ? 'live'
    : viewing
      ? 'full'
      : summary || tab !== 'explore'
        ? 'page'
        : sheet
  // Tirer la feuille vers le bas la referme — y compris celle d'une sortie
  // relue, qui n'est pas un état de `sheet` mais une sortie ouverte : sans
  // ça, le geste laissait la feuille en place, apparemment bloquée.
  const sheetGesture = useSheetDrag(
    sheetMode,
    (next) => {
      if (next === 'peek' && viewing) setViewing(null)
      setSheet(next)
    },
    shellRef,
  )

  const announcement = busy
    ? 'Recherche des itinéraires en cours.'
    : error
      ? `Échec de la recherche. ${error.message}`
      : result
        ? result.routes.length
          ? `${result.routes.length} itinéraire${result.routes.length > 1 ? 's' : ''} ` +
            `proposé${result.routes.length > 1 ? 's' : ''}. ` +
            `Le premier : ${result.routes[0].name}, ${km(result.routes[0].distance_m, 1)} ` +
            (result.routes[0].safety
              ? `kilomètres, note ${result.routes[0].safety.grade}.`
              : 'kilomètres, sécurité non évaluée.')
          : 'Aucun itinéraire ne convient depuis ce point.'
        : ''  

  return (
    <div className="shell" data-map={theme} data-sheet={sheetMode} ref={shellRef}>
      {/* `main` plutôt que `div` : la carte, la recherche de lieu et les
          commandes qui flottent dessus sont le contenu principal de l'app. Sans
          ce repère, un lecteur d'écran ne propose aucun moyen d'y sauter, et le
          champ de recherche se retrouvait hors de toute région annoncée. */}
      <main className="stage" ref={stageRef}>
        {/* Le titre de la page. Le logo visible ferait l'affaire, mais il vit
            dans un en-tête que la feuille repliée réduit à rien : il
            disparaîtrait de la structure au moment même où l'on ouvre l'app.
            Celui-ci ne se voit pas et ne bouge jamais — c'est le premier repère
            annoncé en arrivant, et il est dans la région principale. */}
        <h1 className="visually-hidden">Lacet — boucles de course et de vélo</h1>
        <MapView
          styleKey={mapStyle}
          start={start}
          route={
            viewing
              ? { ...viewing, geometry: viewing.track ?? viewing.geometry ?? [], segments: [], crossings: [] }
              : summary?.track
              ? { ...summary, geometry: summary.track, segments: [], crossings: [] }
              : running && freeRun
                ? null
                : running
                  ? liveRoute ?? selected
                  : selected
          }
          ghost={!running ? result?.routes : null}
          position={running ? livePosition : geo.position}
          accuracy={geo.accuracy}
          cursor={scrub}
          focus={focus}
          follow={running || geo.following}
          navigate={running}
          heading={running ? liveHeading : null}
          orientation={runView}
          overview={overviewAt}
          northAt={northAt}
          compassRef={compassRef}
          placing={placing}
          onPlace={(p) => applyStart(p)}
          onUserMove={() => {
            centered.current = false
            if (geo.following) geo.setFollowing(false)
          }}
          onPickRoute={(id) => {
            const match = result?.routes.find((r) => r.id === id)
            if (match) setSelected(match)
          }}
        />

        {/* Par-dessus la carte, et par-dessus tout le reste : pendant ces trois
            secondes, il n'y a rien d'autre à faire que partir. */}
        {starting && (
          <Countdown
            onCancel={() => run.cancelCountdown()}
            onDone={() => {
              run.begin()
            }}
          />
        )}

        {!running && (
          <div className="stage__top">
            <SearchBar
              near={
                geo.position
                  ? { lat: geo.position[1], lon: geo.position[0] }
                  : start && start !== PARIS
                    ? start
                    : null
              }
              onPick={(p) => applyStart(placeOf(p), p.label, true)}
            />
          </div>
        )}

        {running ? (
          // En course : ce qui sert en courant, rien qui change le parcours.
          <div className="stage__tools stage__tools--run">
            <button className="tool" onClick={() => setStylesOpen(true)} aria-label="Fond de carte" title="Fond de carte">
              <Icon name="layers" />
            </button>
            {voice.available && (
              <button
                className={`tool ${speaking ? '' : 'tool--muted'}`}
                onClick={toggleVoice}
                aria-pressed={speaking}
                aria-label={speaking ? 'Couper le guidage vocal' : 'Activer le guidage vocal'}
                title={speaking ? 'Couper le guidage vocal' : 'Activer le guidage vocal'}
              >
                <Icon name={speaking ? 'volume' : 'volumeOff'} />
              </button>
            )}
            <button
              ref={compassRef}
              className="tool tool--compass"
              onClick={toggleRunView}
              aria-label={runView === 'north' ? 'Orienter la carte dans le sens de la course' : 'Mettre le nord en haut'}
              title={runView === 'north' ? 'Nord en haut — touche pour suivre ton cap' : 'Dans ton sens — touche pour mettre le nord en haut'}
            >
              <span className="needle" aria-hidden="true" />
              <small>{runView === 'north' ? 'N' : 'CAP'}</small>
            </button>
            {!freeRun && (
              <button className="tool" onClick={() => setOverviewAt(Date.now())} aria-label="Voir tout le parcours" title="Voir tout le parcours">
                <Icon name="expand" />
              </button>
            )}
          </div>
        ) : (
          // Trois questions, un bouton chacune, dans l'ordre où on se les pose :
          // à quoi ressemble la carte, où suis-je, d'où je pars. La boussole
          // n'apparaît que carte tournée, pour la remettre nord en haut.
          <div className="stage__tools">
            <button
              className={`tool ${stylesOpen ? 'tool--on' : ''}`}
              onClick={() => setStylesOpen(true)}
              title="Fond de carte"
              aria-label="Fond de carte"
              aria-haspopup="dialog"
            >
              <Icon name="layers" />
            </button>
            <span className="tools__gap" aria-hidden="true" />
            <button
              className={`tool ${geo.following ? 'tool--on' : ''} ${geo.status === 'locating' ? 'tool--busy' : ''}`}
              onClick={centerOnMe}
              title={geo.following ? 'Arrêter de me suivre' : 'Ma position (L) — touche deux fois pour me suivre'}
              aria-label={geo.following ? 'Arrêter de suivre ma position' : 'Centrer la carte sur ma position'}
              aria-pressed={geo.following}
            >
              <Icon name={geo.following ? 'navigation' : 'locate'} />
            </button>
            <div className="toolmenu">
              <button
                className={`tool tool--start ${placing || startMenu ? 'tool--on' : ''}`}
                onClick={() => {
                  if (placing) setPlacing(false)
                  else setStartMenu((v) => !v)
                }}
                title="Point de départ (P)"
                aria-label="Choisir le point de départ"
                aria-haspopup="menu"
                aria-expanded={startMenu}
              >
                <Icon name="pinPlus" />
              </button>
              {startMenu && (
                <div className="startmenu" role="menu">
                  <b>Point de départ</b>
                  {places.map((place) => (
                    <div className="startmenu__row" key={place.id}>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setStartMenu(false)
                          applyStart(placeOf(place), place.name, true)
                        }}
                      >
                        <Icon name="heart" size={17} />
                        {place.name}
                      </button>
                      <button
                        className="startmenu__drop"
                        onClick={() => dropPlace(place.id)}
                        aria-label={`Oublier ${place.name}`}
                        title="Oublier"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ))}
                  <button role="menuitem" onClick={startFromHere}>
                    <Icon name="locate" size={17} />
                    Partir de ma position
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setStartMenu(false)
                      setPlacing(true)
                    }}
                  >
                    <Icon name="pin" size={17} />
                    Choisir sur la carte
                  </button>
                  {start && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setStartMenu(false)
                        setNaming(true)
                      }}
                    >
                      <Icon name="plus" size={17} />
                      Enregistrer ce départ
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              ref={compassRef}
              className="tool tool--compass"
              onClick={() => setNorthAt(Date.now())}
              title="Remettre le nord en haut"
              aria-label="Remettre le nord en haut"
            >
              <span className="needle" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Seule une consigne transitoire flotte sur la carte. Un message
            permanent y masquerait le tracé — il appartient au panneau. */}
        {placing && (
          <div className="stage__hint">
            Clique sur la carte pour poser le départ — ou fais glisser le repère.
          </div>
        )}
      </main>

      <aside className="side">
        {/* En course, pas d'en-tête : l'activité et ses réglages ne se changent
            plus, et chaque ligne rendue à la carte compte. */}
        {!running && (
        <header className="side__head" {...sheetGesture()}>
          <SheetGrabber open={sheetMode === 'full'} onSet={setSheet} />
          <div className="brand">
            Lacet<span>.</span>
          </div>
          {!running && !viewing && tab !== 'explore' && (
            <h2 className="side__title">{tab === 'routes' ? 'Mes parcours' : 'Mon compte'}</h2>
          )}
          {/* La pastille n'est pas un titre : c'est le seul accès aux filtres
              une fois les boucles affichées — le panneau ne montre plus alors
              que le favori, l'export, la regénération et « Démarrer ». Avant la
              recherche, le bouton « Filtres » est juste là, sous les yeux, et
              deux entrées pour le même réglage encombraient le haut de l'écran
              pour rien. Elle revient donc avec les propositions. */}
          {tab === 'explore' && result && (
            <button className="sportpill" onClick={() => setFiltersOpen(true)}>
              <Icon name={sport?.icon} size={19} />
              <b>{sport?.label}</b>
              <span className="sportpill__spec">{summarise(params)}</span>
              <Icon name="sliders" size={17} className="sportpill__gear" />
            </button>
          )}
        </header>
        )}

        {/* Ce qui vient de se passer, dit à voix haute par un lecteur d'écran.
            Le reste de l'interface change en silence : la carte se redessine et
            la liste se remplit, mais rien ne l'annonce, et une personne qui
            n'en voit rien reste devant un écran qu'elle croit figé. */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>

        <div className="side__body" {...sheetGesture(true)}>
          {pending && !running && !summary && tab === 'explore' && (
            <div className="banner banner--resume">
              <Icon name="refresh" size={16} />
              <span>
                <b>Sortie interrompue.</b>{' '}
                <span className="banner__more">
                  {km(pending.covered, 1).replace('.', ',')} km en {Math.round(pending.elapsed / 60)} min,
                  {' '}
                  {Math.round((Date.now() - pending.at) / 60000)} min plus tôt.
                </span>
              </span>
              <button
                className="banner__act"
                onClick={() =>
                  run.resumePending((route) => found.show(route))
                }
              >
                Reprendre
              </button>
              <button
                className="banner__act"
                onClick={() => run.keepPending(params.sport)}
              >
                Enregistrer
              </button>
              <button
                className="banner__close"
                onClick={() => run.dropPending()}
                aria-label="Oublier"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {geoNoticeOpen && geo.status === 'denied' && (running || tab === 'explore') && (
            <div className="banner">
              <Icon name="warning" size={16} />
              {/* Sur téléphone, le titre seul : l'explication complète prenait
                  cinq lignes et repoussait les propositions hors de l'écran. Le
                  bouton « Placer » d'à côté porte la solution qui compte. */}
              <span>
                <b>Position indisponible.</b>{' '}
                <span className="banner__more">{geo.message}</span>
              </span>
              {/* Le message dit « place le départ à la main » : le bouton le fait,
                  plutôt que de laisser chercher lequel des boutons de la carte. */}
              {!running && (
                <button
                  className="banner__act"
                  onClick={() => {
                    setPlacing(true)
                    setGeoNoticeOpen(false)
                  }}
                >
                  Placer
                </button>
              )}
              <button
                className="banner__close"
                onClick={() => setGeoNoticeOpen(false)}
                aria-label="Masquer"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {viewing ? (
            <RunDetail
              entry={viewing}
              history={history}
              onRename={(r, nom) => {
                library.rename(r, nom)
                setViewing({ ...r, name: nom.trim().slice(0, 60) })
              }}
              onClose={() => setViewing(null)}
              onReplay={(r) => {
                setViewing(null)
                openRoute(r)
              }}
              onDelete={(r) => {
                library.forget(r)
                setViewing(null)
              }}
            />
          ) : summary ? (
            <RunSummary entry={summary} onClose={() => run.closeSummary()} />
          ) : running ? (
            <LiveRun
              route={freeRun ? null : selected}
              request={freeRun ? null : detourRequest}
              sport={params.sport}
              resuming={resume}
              stage={stageRef.current}
              speaking={speaking}
              onPosition={(point, heading) => run.track(point, heading)}
              onReroute={(next) => run.reroute(next)}
              onStop={(stats) => run.finish(stats, { route: selected, sport: params.sport })}
            />
          ) : tab === 'routes' ? (
            <Library
              onImport={importGpx}
              saved={saved}
              history={history}
              profile={params}
              mapStyle={mapStyle}
              onOpen={openRoute}
              onOpenRun={setViewing}
            />
          ) : tab === 'account' ? (
            <Account
              params={params}
              geo={geo}
              onProfile={(patch) => {
                const next = { ...params, ...patch }
                setParams(next)
                save({ params: next })
              }}
              onClearData={async () => {
                // Les cartes gardées partent avec le reste : ce sont des données
                // comme les autres, et ce sont de loin les plus volumineuses.
                // Les laisser derrière ferait mentir le bouton.
                //
                // On l'attend : effacer un cache prend un instant, et l'écran qui
                // annonce le résultat lit le journal juste après.
                await offline.clear()
                // Les rues et altitudes gardées pour calculer hors ligne aussi.
                await clearEngineData()
                library.clear()
              }}
            />
          ) : (
            <Explore
              snapped={snapped}
              history={history}
              progress={progress}
              start={start}
              startLabel={startLabel}
              geo={geo}
              busy={busy}
              error={error}
              result={result}
              selected={selected}
              detail={detail}
              params={params}
              streetsReady={prefetchKey !== null && prepared === prefetchKey}
              streetsLoading={preparing && prepared !== prefetchKey}
              isFavorite={isFavorite}
              onSelect={setSelected}
              onToggleDetail={() => setDetail((d) => !d)}
              onSearch={() => search()}
              onRegenerate={() => search(undefined, { regenerate: true })}
              reversing={reversing}
              onReverse={selected && !selected.remote ? reverseSelected : null}
              onOpenFilters={() => setFiltersOpen(true)}
              onFavorite={() => library.toggleFavorite(selected)}
              onStart={() => beginRun('route')}
              onFreeRun={() => beginRun('free')}
              onOpenSaved={() => setTab('routes')}
              onScrub={setScrub}
              onOpenDetail={() => setSheet('full')}
            />
          )}
        </div>

        {!running && (
          <nav className="side__tabs">
            {[
              ['routes', 'routes', 'Mes parcours'],
              ['explore', sport?.icon, 'Explorer'],
              ['account', 'user', 'Mon compte'],
            ].map(([key, icon, label]) => (
              <button
                key={key}
                className={`tab ${tab === key ? 'tab--on' : ''}`}
                onClick={() => {
                  // La sortie qu'on relit et le bilan qu'on vient de terminer
                  // prennent le panneau entier : sans les refermer, les onglets
                  // changeaient bien d'onglet derrière, mais rien ne bougeait à
                  // l'écran. On croyait trois boutons morts.
                  setViewing(null)
                  run.closeSummary()
                  setTab(key)
                  if (key === 'explore') setSheet('peek')
                }}
              >
                <Icon name={icon} size={19} />
                {label}
              </button>
            ))}
          </nav>
        )}
      </aside>

      {filtersOpen && (
        <FiltersSheet value={params} onApply={search} onClose={() => setFiltersOpen(false)} />
      )}
      {naming && (
        <PlaceSheet suggestion={startLabel || ''} onSave={keepPlace} onClose={() => setNaming(false)} />
      )}
      {stylesOpen && (
        <MapStyleSheet
          value={mapStyle}
          onSave={(key) => {
            setMapStyle(key)
            save({ mapStyle: key })
            setStylesOpen(false)
          }}
          onClose={() => setStylesOpen(false)}
        />
      )}
    </div>
  )
}

// --- traduction des réglages vers l'API ---------------------------------------

/**
 * Le point demandé. Après une recherche, le repère rejoint la rue, là où la
 * boucle commence (voir `engine/door.js`) ; `asked` garde le point choisi —
 * la maison, et la rue de son adresse — d'où les recherches suivantes partent.
 */
const askedOf = (start) => start.asked ?? start

/** Un lieu choisi (recherche, départ enregistré) comme départ : sa position, et sa rue. */
const placeOf = (place) => ({ lat: place.lat, lon: place.lon, ...(place.street ? { street: place.street } : {}) })

function toRequest(p, start) {
  const point = askedOf(start)
  const body = {
    lat: point.lat,
    lon: point.lon,
    sport: p.sport,
    surface: p.surface,
    elevation: p.elevation,
    safety: p.safety,
    time_of_day: p.time_of_day,
    limit: p.count || 5,
  }
  // Vide le plus souvent : n'envoyer la clé que lorsqu'elle sert garde la
  // demande identique à celle du moteur Python tant qu'on ne coche rien.
  if (p.avoid?.length) body.avoid = p.avoid
  if (point.street) body.street = point.street
  if (p.mode === 'distance') body.distance_km = p.distance_km
  else body.duration_min = p.duration_min
  // Viser un semi à ±10 %, c'est viser à deux kilomètres près.
  if (p.mode === 'distance' && p.precise) body.tolerance = PRECISE_TOLERANCE
  if (p.sport === 'bike' || p.speedUnit === 'speed') body.speed_kmh = p.speed_kmh
  else body.pace_sec_per_km = p.pace_sec_per_km
  return body
}

function summarise(p) {
  const race = p.mode === 'distance' ? raceOf(p.distance_km) : null
  const dist = race
    ? race.label
    : p.mode === 'distance'
      ? `${formatKm(p.distance_km)} km`
      : `≈${Math.round(estimateKm(p))} km`
  const speed =
    p.sport === 'bike' || p.speedUnit === 'speed'
      ? `${p.speed_kmh} km/h`
      : `${pace(p.pace_sec_per_km)}/km`
  return `${dist} · ${speed}`
}

/** Entrée d'historique d'une sortie sans itinéraire. */
function freeRunEntry(params) {
  return {
    id: `free-${Date.now()}`,
    name: params.sport === 'bike' ? 'Sortie libre à vélo' : 'Sortie libre',
    free: true,
    distance_m: 0,
    duration_s: 0,
    ascent_m: null,
    grade: null,
    safety: null,
    surfaces: null,
    segments: [],
    geometry: [],
  }
}
