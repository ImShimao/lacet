import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import MapView from './MapView.jsx'
import FiltersSheet, { DEFAULTS, SPORTS, estimateKm, formatKm, raceOf } from './FiltersSheet.jsx'
import SearchBar from './SearchBar.jsx'
import LiveRun from './LiveRun.jsx'
import RunSummary from './RunSummary.jsx'
import PlaceSheet from './PlaceSheet.jsx'
import Explore from './Explore.jsx'
import Library from './Library.jsx'
import Account from './Account.jsx'
import MapStyleSheet from './MapStyleSheet.jsx'
import useGeolocation from './useGeolocation'
import { DEFAULT_STYLE, styleByKey } from './mapStyles'
import { describePlace, generateLoops } from './api'
import { km, pace } from './format'
import { load, recentPlaces, save, slim } from './storage'
import { clearRun, loadRun } from './runState'
import * as offline from './offlineMaps'
import { clearEngineData, prefetchOnDevice } from './engine/client'
import { haversineM } from './engine/geo'
import { appDeltaY, currentTurn } from './orientation'
import * as voice from './voice'

const PARIS = { lat: 48.8566, lon: 2.3522 }

// « Distance exacte » : l'écart toléré entre la boucle et la distance visée.
const PRECISE_TOLERANCE = 0.025

// Le temps de laisser finir un repère qu'on fait glisser, ou une adresse qu'on
// choisit, avant de préparer les rues : on ne prépare que là où l'on s'arrête.
// Une demi-seconde suffit à ça, et c'est une demi-seconde de moins à rattraper
// pour qui ouvre l'app et lance sa recherche dans la foulée — le cas d'un coin
// jamais visité, justement celui où les rues sont longues à venir.
const PREFETCH_DELAY_MS = 600

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

  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  // L'étape en cours et son avancement. Le calcul se fait sur l'appareil et
  // commence par télécharger les rues : sans indication, une première recherche
  // dans une grande ville ressemblerait à une app bloquée.
  const [progress, setProgress] = useState(null)
  const searchToken = useRef(0)
  // Numéro de « Régénérer » depuis la dernière recherche ordinaire.
  const variation = useRef(0)
  const [error, setError] = useState(null)
  const [scrub, setScrub] = useState(null)
  const [focus, setFocus] = useState(null)

  const [running, setRunning] = useState(false)
  // Course libre : on enregistre sans itinéraire. C'est ce que fait la moitié
  // des sorties — on part sans savoir où l'on va — et le refuser obligeait à
  // choisir une boucle pour pouvoir simplement démarrer le chronomètre.
  const [freeRun, setFreeRun] = useState(false)
  // Une sortie interrompue retrouvée au lancement, et celle qu'on reprend.
  const [pending, setPending] = useState(() => loadRun())
  const [resume, setResume] = useState(null)
  // La sortie qui vient de se terminer : ses chiffres, et sa trace sur la carte.
  const [summary, setSummary] = useState(null)
  const [livePosition, setLivePosition] = useState(null)
  // La direction de course, pour la carte orientée comme un GPS de voiture.
  const [liveHeading, setLiveHeading] = useState(null)
  // Le tracé suivi en course, quand un recalcul a remplacé celui du départ.
  const [liveRoute, setLiveRoute] = useState(null)
  const [geoNoticeOpen, setGeoNoticeOpen] = useState(true)

  // Les commandes de la carte en course : la voix, l'orientation — dans le sens
  // de la course, ou nord en haut — et la vue d'ensemble du parcours.
  const [speaking, setSpeaking] = useState(() => voice.available)
  const [runView, setRunView] = useState(stored.runView === 'north' ? 'north' : 'heading')
  const [overviewAt, setOverviewAt] = useState(0)
  const [northAt, setNorthAt] = useState(0)
  const [startMenu, setStartMenu] = useState(false)
  // Les départs qu'on garde : chez soi, le bureau, le club.
  const [places, setPlaces] = useState(stored.places || [])
  const [naming, setNaming] = useState(false)
  const stageRef = useRef(null)
  const compassRef = useRef(null)

  const [saved, setSaved] = useState(stored.favorites)
  const [history, setHistory] = useState(stored.history)

  const geo = useGeolocation()

  // --- point de départ ------------------------------------------------------
  // `recenter` distingue les deux gestes : choisir un lieu amène la carte
  // dessus, déplacer le repère la laisse où elle est.
  const applyStart = useCallback(async (point, label, recenter = false) => {
    setStart((previous) => {
      // Les boucles proposées partent toutes du point précédent : dès qu'il
      // bouge, elles ne répondent plus à la question posée. Elles restaient
      // pourtant à l'écran — on choisissait Grimisuat et la carte montrait le
      // Valais sous une carte intitulée « Boucle sud-ouest · avenue des
      // Gobelins ». Dix mètres de tolérance pour le doigt qui replace le
      // repère sans vraiment le déplacer.
      if (previous && haversineM([previous.lon, previous.lat], [point.lon, point.lat]) > 10) {
        setResult(null)
        setSelected(null)
        setScrub(null)
      }
      return point
    })
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
      if (dernier) applyStart({ lat: dernier.lat, lon: dernier.lon }, dernier.label, true)
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
    const next = [{ id: `p${Date.now()}`, name, lat: start.lat, lon: start.lon }, ...places].slice(0, 8)
    setPlaces(next)
    save({ places: next })
    setNaming(false)
  }

  const dropPlace = (id) => {
    const next = places.filter((p) => p.id !== id)
    setPlaces(next)
    save({ places: next })
  }

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

      setBusy(true)
      setProgress(null)
      setError(null)
      setResult(null)
      setSelected(null)
      setScrub(null)
      setTab('explore')
      setSheet('peek')

      // Une recherche lancée pendant qu'une autre calcule la remplace : seule la
      // dernière a le droit d'afficher son résultat. Sans ce jeton, la plus
      // lente des deux gagnait, et l'écran montrait des boucles pour un
      // réglage qu'on venait de changer.
      const token = ++searchToken.current
      try {
        const request = { ...toRequest(active, start), variation: variation.current, avoid_bearings: avoid }
        const onStage = (stage, fraction) => {
          if (token === searchToken.current) setProgress({ stage, fraction })
        }
        let payload = await generateLoops(request, onStage)
        // Rien à ±2,5 % ? Plutôt qu'un écran vide, on élargit et on le dit : le
        // réseau de rues ne se plie pas toujours au mètre près, et une boucle
        // de 20,4 km vaut mieux que pas de sortie.
        if (!payload.routes.length && request.tolerance) {
          const { tolerance, ...wider } = request
          const relaxed = await generateLoops(wider, onStage)
          if (relaxed.routes.length) {
            payload = {
              ...relaxed,
              meta: {
                ...relaxed.meta,
                relaxed: true,
                message: `Aucune boucle à ±2,5 % de ${formatKm(active.distance_km)} km depuis ce départ : voici les plus proches, à ±10 %.`,
              },
            }
          }
        }
        if (token !== searchToken.current) return
        // Le détail du temps passé, gardé pour « Mon compte ». Mesurer sur le
        // téléphone est le seul moyen de savoir ce qui traîne vraiment : un PC
        // de bureau construit un graphe trois fois plus vite qu'un iPhone, et
        // une recherche lente en 4G n'a rien à voir avec une recherche lente
        // dans un village sans réseau.
        if (payload.meta?.timings_s) {
          save({
            lastSearch: {
              at: Date.now(),
              km: active.distance_km,
              total: payload.meta.elapsed_s,
              ...payload.meta.timings_s,
              nodes: payload.meta.graph_nodes,
              sources: payload.meta.sources ?? null,
            },
          })
        }
        // La demande reste attachée au résultat : c'est avec elle qu'un chemin
        // de retour se calcule, en course, si l'on s'écarte du parcours.
        setResult({ ...payload, request })
        setSelected(payload.routes[0] || null)
      } catch (err) {
        if (token !== searchToken.current) return
        // On garde l'erreur entière : hors ligne, « réessayer » ne sert à rien
        // et il vaut mieux renvoyer vers les parcours déjà enregistrés.
        setError({ message: err.message, offline: Boolean(err.offline) })
      } finally {
        if (token === searchToken.current) {
          setBusy(false)
          setProgress(null)
        }
      }
    },
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
  const [prepared, setPrepared] = useState(null)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!prefetchKey || running) return undefined
    const network = typeof navigator !== 'undefined' ? navigator : {}
    if (network.onLine === false || network.connection?.saveData) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      // Le dire pendant que ça se fait : dans un coin jamais visité, la
      // préparation dure quelques secondes, et une app qui s'active sans rien
      // annoncer inquiète plus qu'elle ne rassure.
      setPreparing(true)
      const ready = await prefetchOnDevice(JSON.parse(prefetchKey))
      if (cancelled) return
      setPreparing(false)
      if (ready) setPrepared(prefetchKey)
    }, PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      setPreparing(false)
      clearTimeout(timer)
    }
  }, [prefetchKey, running])

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
  const keyOf = offline.keyOf
  const isFavorite = selected && saved.some((r) => keyOf(r) === keyOf(selected))

  function toggleFavorite() {
    if (!selected) return
    const key = keyOf(selected)
    const next = saved.some((r) => keyOf(r) === key)
      ? saved.filter((r) => keyOf(r) !== key)
      : [slim(selected), ...saved].slice(0, 40)
    setSaved(next)
    save({ favorites: next })
  }

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
  function remember(entry) {
    const next = [entry, ...history].map((run, i) => (i < 25 ? run : { ...run, track: null }))
    const kept = next.slice(0, 200)
    setHistory(kept)
    save({ history: kept })
    return entry
  }

  function finishRun(stats) {
    // Une sortie de moins de cent mètres est un démarrage par erreur, pas une
    // sortie : l'enregistrer polluerait les statistiques et l'historique.
    if (stats.distance >= 100) {
      setSummary(remember(runEntry(stats, { route: selected, free: freeRun, sport: params.sport })))
    }
    clearRun()
    setResume(null)
    setRunning(false)
    setFreeRun(false)
    setLivePosition(null)
    setLiveHeading(null)
    setLiveRoute(null)
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
  const sheetMode = running ? 'live' : summary || tab !== 'explore' ? 'page' : sheet
  const sheetGesture = useSheetDrag(sheetMode, setSheet, shellRef)

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
      <div className="stage" ref={stageRef}>
        <MapView
          styleKey={mapStyle}
          start={start}
          route={
            summary?.track
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
              onPick={(p) => applyStart({ lat: p.lat, lon: p.lon }, p.label, true)}
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
                          applyStart({ lat: place.lat, lon: place.lon }, place.name, true)
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
      </div>

      <aside className="side">
        {/* En course, pas d'en-tête : l'activité et ses réglages ne se changent
            plus, et chaque ligne rendue à la carte compte. */}
        {!running && (
        <header className="side__head" {...sheetGesture()}>
          <SheetGrabber open={sheetMode === 'full'} onSet={setSheet} />
          <div className="brand">
            Lacet<span>.</span>
          </div>
          {!running && tab !== 'explore' && (
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
                onClick={() => {
                  const route = pending.route
                  if (route) {
                    setSelected(route)
                    setResult({ routes: [route], rejected: [], meta: {} })
                  }
                  setFreeRun(!route)
                  setResume(pending)
                  setPending(null)
                  setRunning(true)
                }}
              >
                Reprendre
              </button>
              <button
                className="banner__act"
                onClick={() => {
                  // Reprise impossible ou pas voulue : on garde au moins ce qui
                  // a été couru, plutôt que de le jeter.
                  setSummary(
                    remember(
                      runEntry(
                        { distance: pending.covered, elapsed: pending.elapsed, trail: pending.trail },
                        { route: pending.route, free: !pending.route, sport: pending.sport || params.sport },
                      ),
                    ),
                  )
                  clearRun()
                  setPending(null)
                }}
              >
                Enregistrer
              </button>
              <button
                className="banner__close"
                onClick={() => {
                  clearRun()
                  setPending(null)
                }}
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
          {summary ? (
            <RunSummary entry={summary} onClose={() => setSummary(null)} />
          ) : running ? (
            <LiveRun
              route={freeRun ? null : selected}
              request={freeRun ? null : detourRequest}
              sport={params.sport}
              resuming={resume}
              stage={stageRef.current}
              speaking={speaking}
              onPosition={(point, heading) => {
                setLivePosition(point)
                setLiveHeading(heading ?? null)
              }}
              onReroute={setLiveRoute}
              onStop={finishRun}
            />
          ) : tab === 'routes' ? (
            <Library
              saved={saved}
              history={history}
              profile={params}
              mapStyle={mapStyle}
              onOpen={(r) => {
                setSelected(r)
                setResult({ routes: [r], rejected: [], meta: {} })
                setTab('explore')
                setSheet('peek')
                setDetail(true)
              }}
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
                save({ favorites: [], history: [] })
                setSaved([])
                setHistory([])
              }}
            />
          ) : (
            <Explore
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
              onOpenFilters={() => setFiltersOpen(true)}
              onFavorite={toggleFavorite}
              onStart={() => setRunning(true)}
              onFreeRun={() => {
                setFreeRun(true)
                setRunning(true)
              }}
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

function toRequest(p, start) {
  const body = {
    lat: start.lat,
    lon: start.lon,
    sport: p.sport,
    surface: p.surface,
    elevation: p.elevation,
    safety: p.safety,
    time_of_day: p.time_of_day,
    limit: p.count || 5,
  }
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
