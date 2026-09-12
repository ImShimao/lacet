import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import MapView from './MapView.jsx'
import FiltersSheet, { DEFAULTS, SPORTS, estimateKm } from './FiltersSheet.jsx'
import SearchBar from './SearchBar.jsx'
import LiveRun from './LiveRun.jsx'
import Explore from './Explore.jsx'
import Library from './Library.jsx'
import Account from './Account.jsx'
import useGeolocation from './useGeolocation'
import { MAP_STYLES, DEFAULT_STYLE, styleByKey } from './mapStyles'
import { describePlace, generateLoops } from './api'
import { km, pace } from './format'
import { load, save, slim } from './storage'
import * as offline from './offlineMaps'
import { appDeltaY, currentTurn } from './orientation'

const PARIS = { lat: 48.8566, lon: 2.3522 }

/**
 * La poignée de la feuille, sur téléphone : elle replie le détail d'un
 * parcours pour rendre la carte, ou le déplie.
 *
 * Deux positions plutôt qu'un réglage continu. Glisser au pixel près
 * demandait de viser, et aucune hauteur intermédiaire n'était la bonne : on
 * veut soit la carte, soit le détail. Un geste vers le haut ou vers le bas
 * choisit, une simple touche bascule.
 *
 * La CSS ne la montre que feuille dépliée : repliée, c'est la carte de
 * parcours elle-même qui ouvre le détail.
 */
function SheetGrabber({ open, onSet }) {
  const drag = useRef(null)

  const begin = (e) => {
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const end = (e) => {
    if (drag.current === null) return
    // Mesuré dans le sens de l'app : téléphone couché, son « vers le haut »
    // court le long de l'écran.
    const dy = appDeltaY(currentTurn(), e.clientX - drag.current.x, e.clientY - drag.current.y)
    drag.current = null
    if (dy < -30) onSet('full')
    else if (dy > 30) onSet('peek')
    else onSet(open ? 'peek' : 'full')
  }

  return (
    <button
      type="button"
      className="grabber"
      aria-label={open ? 'Replier le détail' : 'Déplier le détail'}
      aria-expanded={open}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={() => (drag.current = null)}
      // Le clavier passe par `click` (`detail` vaut 0) ; au doigt et à la
      // souris, `pointerup` a déjà tranché — le compter deux fois annulerait
      // le geste.
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


export default function App() {
  const stored = useMemo(() => load(), [])

  const [params, setParams] = useState({ ...DEFAULTS, ...(stored.params || {}) })
  const [mapStyle, setMapStyle] = useState(stored.mapStyle || DEFAULT_STYLE)
  const [start, setStart] = useState(null)
  const [startLabel, setStartLabel] = useState(null)
  const [placing, setPlacing] = useState(false)

  const [tab, setTab] = useState('explore')
  const [filtersOpen, setFiltersOpen] = useState(false)
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
  const [error, setError] = useState(null)
  const [scrub, setScrub] = useState(null)
  const [focus, setFocus] = useState(null)

  const [running, setRunning] = useState(false)
  // Course libre : on enregistre sans itinéraire. C'est ce que fait la moitié
  // des sorties — on part sans savoir où l'on va — et le refuser obligeait à
  // choisir une boucle pour pouvoir simplement démarrer le chronomètre.
  const [freeRun, setFreeRun] = useState(false)
  const [livePosition, setLivePosition] = useState(null)
  const [geoNoticeOpen, setGeoNoticeOpen] = useState(true)

  const [saved, setSaved] = useState(stored.favorites)
  const [history, setHistory] = useState(stored.history)

  const geo = useGeolocation()

  // --- point de départ ------------------------------------------------------
  // `recenter` distingue les deux gestes : choisir un lieu amène la carte
  // dessus, déplacer le repère la laisse où elle est.
  const applyStart = useCallback(async (point, label, recenter = false) => {
    setStart(point)
    setStartLabel(label ?? null)
    setPlacing(false)
    if (recenter) setFocus({ ...point, at: Date.now() })
    if (label === undefined) setStartLabel(await describePlace(point.lat, point.lon))
  }, [])

  // Au premier chargement on tente la position ; le refus n'est pas un échec,
  // c'est un cas normal — on retombe sur Paris et la carte reste utilisable.
  useEffect(() => {
    geo.locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (geo.status === 'ready' && geo.position && !start) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    }
    if ((geo.status === 'denied' || geo.status === 'error') && !start) {
      applyStart(PARIS, 'Paris', true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.position])

  // Le bouton de position doit *toujours* amener la carte sur place — c'est
  // toute la raison de le presser. Si la position est déjà connue on y va
  // immédiatement, et on relance une mesure en parallèle pour l'affiner.
  const pendingLocate = useRef(false)
  const goToMyPosition = () => {
    if (geo.position) {
      applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    }
    pendingLocate.current = true
    geo.locate()
  }

  // Résultat d'une demande explicite : on recadre, même si la position n'avait
  // pas changé de valeur.
  useEffect(() => {
    if (!pendingLocate.current || geo.status !== 'ready' || !geo.position) return
    pendingLocate.current = false
    applyStart({ lat: geo.position[1], lon: geo.position[0] }, undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status, geo.at])

  // --- génération -----------------------------------------------------------
  const search = useCallback(
    async (next) => {
      const active = next || params
      if (next) {
        setParams(next)
        save({ params: next })
      }
      setFiltersOpen(false)
      if (!start) return

      setBusy(true)
      setError(null)
      setResult(null)
      setSelected(null)
      setScrub(null)
      setTab('explore')
      setSheet('peek')

      try {
        const payload = await generateLoops(toRequest(active, start))
        setResult(payload)
        setSelected(payload.routes[0] || null)
      } catch (err) {
        // On garde l'erreur entière : hors ligne, « réessayer » ne sert à rien
        // et il vaut mieux renvoyer vers les parcours déjà enregistrés.
        setError({ message: err.message, offline: Boolean(err.offline) })
      } finally {
        setBusy(false)
      }
    },
    [params, start],
  )

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
        setSheet('peek')
      }
      if (e.key === 'Enter' && !filtersOpen && !running) search()
      if (e.key === 'f') setFiltersOpen((v) => !v)
      if (e.key === 'l') goToMyPosition()
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

  function finishRun(stats) {
    // Une sortie de moins de cent mètres est un démarrage par erreur, pas une
    // sortie : l'enregistrer polluerait les statistiques et l'historique.
    if (stats.distance >= 100) {
      const base = freeRun ? freeRunEntry(params) : slim(selected)
      const entry = {
        ...base,
        ranAt: new Date().toISOString(),
        actual_distance_m: Math.round(stats.distance),
        actual_duration_s: Math.round(stats.elapsed),
        sport: params.sport,
      }
      const next = [entry, ...history].slice(0, 200)
      setHistory(next)
      save({ history: next })
    }
    setRunning(false)
    setFreeRun(false)
    setLivePosition(null)
  }

  const sport = SPORTS.find((s) => s.key === params.sport)
  const theme = styleByKey(mapStyle).contrast
  // L'état que lit la CSS : la sortie et les pages de liste imposent le leur.
  const sheetMode = running ? 'live' : tab !== 'explore' ? 'page' : sheet

  const announcement = busy
    ? 'Recherche des itinéraires en cours.'
    : error
      ? `Échec de la recherche. ${error.message}`
      : result
        ? result.routes.length
          ? `${result.routes.length} itinéraire${result.routes.length > 1 ? 's' : ''} ` +
            `proposé${result.routes.length > 1 ? 's' : ''}. ` +
            `Le premier : ${result.routes[0].name}, ${km(result.routes[0].distance_m, 1)} ` +
            `kilomètres, note ${result.routes[0].safety.grade}.`
          : 'Aucun itinéraire ne convient depuis ce point.'
        : ''  

  return (
    <div className="shell" data-map={theme} data-sheet={sheetMode} ref={shellRef}>
      <div className="stage">
        <MapView
          styleKey={mapStyle}
          start={start}
          route={running && freeRun ? null : selected}
          ghost={!running ? result?.routes : null}
          position={running ? livePosition : geo.position}
          accuracy={geo.accuracy}
          cursor={scrub}
          focus={focus}
          follow={running || geo.following}
          placing={placing}
          onPlace={(p) => applyStart(p)}
          onPickRoute={(id) => {
            const match = result?.routes.find((r) => r.id === id)
            if (match) setSelected(match)
          }}
        />

        {!running && (
          <div className="stage__top">
            <SearchBar
              onPick={(p) => applyStart({ lat: p.lat, lon: p.lon }, p.label, true)}
            />
          </div>
        )}

        <div className="stage__tools">
          <button
            className={`tool ${geo.status === 'locating' ? 'tool--busy' : ''}`}
            onClick={goToMyPosition}
            title="Aller à ma position (L)"
            aria-label="Aller à ma position"
          >
            <Icon name="locate" />
          </button>
          <button
            className={`tool ${geo.following ? 'tool--on' : ''}`}
            onClick={() => geo.setFollowing(!geo.following)}
            title="Suivre mes déplacements"
            aria-label="Suivre mes déplacements"
            aria-pressed={geo.following}
          >
            <Icon name="navigation" />
          </button>
          <button
            className={`tool ${placing ? 'tool--on' : ''}`}
            onClick={() => setPlacing((v) => !v)}
            title="Placer le départ sur la carte (P)"
            aria-label="Placer le départ sur la carte"
            aria-pressed={placing}
          >
            <Icon name="pin" />
          </button>
          <StylePicker value={mapStyle} onChange={(k) => { setMapStyle(k); save({ mapStyle: k }) }} />
        </div>

        {/* Seule une consigne transitoire flotte sur la carte. Un message
            permanent y masquerait le tracé — il appartient au panneau. */}
        {placing && (
          <div className="stage__hint">
            Clique sur la carte pour poser le départ — ou fais glisser le repère.
          </div>
        )}
      </div>

      <aside className="side">
        <header className="side__head">
          <SheetGrabber open={sheetMode === 'full'} onSet={setSheet} />
          <div className="brand">
            Lacet<span>.</span>
          </div>
          {!running && tab !== 'explore' && (
            <h2 className="side__title">{tab === 'routes' ? 'Mes parcours' : 'Mon compte'}</h2>
          )}
          <button className="sportpill" onClick={() => setFiltersOpen(true)}>
            <Icon name={sport?.icon} size={19} />
            <b>{sport?.label}</b>
            <span className="sportpill__spec">{summarise(params)}</span>
            <Icon name="sliders" size={17} className="sportpill__gear" />
          </button>
        </header>

        {/* Ce qui vient de se passer, dit à voix haute par un lecteur d'écran.
            Le reste de l'interface change en silence : la carte se redessine et
            la liste se remplit, mais rien ne l'annonce, et une personne qui
            n'en voit rien reste devant un écran qu'elle croit figé. */}
        <div className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>

        <div className="side__body">
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
          {running ? (
            <LiveRun
              route={freeRun ? null : selected}
              onPosition={setLivePosition}
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
                save({ favorites: [], history: [] })
                setSaved([])
                setHistory([])
              }}
            />
          ) : (
            <Explore
              start={start}
              startLabel={startLabel}
              geo={geo}
              busy={busy}
              error={error}
              result={result}
              selected={selected}
              detail={detail}
              params={params}
              isFavorite={isFavorite}
              onSelect={setSelected}
              onToggleDetail={() => setDetail((d) => !d)}
              onSearch={() => search()}
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
    </div>
  )
}

// --- sélecteur de fond de carte ---------------------------------------------

function StylePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)

  // Un menu qui ne se referme qu'en rappuyant sur son bouton finit toujours par
  // rester ouvert au-dessus de la carte. Clic à l'extérieur et Échap le ferment.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="styler" ref={root}>
      <button
        className={`tool ${open ? 'tool--on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Fond de carte"
        aria-label="Fond de carte"
        aria-expanded={open}
      >
        <Icon name="layers" />
      </button>
      {open && (
        <div className="styler__menu">
          {MAP_STYLES.map((s) => (
            <button
              key={s.key}
              className={`styler__row ${s.key === value ? 'styler__row--on' : ''}`}
              onClick={() => {
                onChange(s.key)
                setOpen(false)
              }}
            >
              <i style={{ background: s.swatch }} />
              {s.label}
            </button>
          ))}
        </div>
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
  if (p.sport === 'bike' || p.speedUnit === 'speed') body.speed_kmh = p.speed_kmh
  else body.pace_sec_per_km = p.pace_sec_per_km
  return body
}

function summarise(p) {
  const dist =
    p.mode === 'distance' ? `${p.distance_km} km` : `≈${Math.round(estimateKm(p))} km`
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
