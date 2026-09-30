import { useCallback, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Countdown from './Countdown.jsx'
import MapView from './MapView.jsx'
import FiltersSheet, { DEFAULTS, SPORTS } from './FiltersSheet.jsx'
import SearchBar from './SearchBar.jsx'
import LiveRun from './LiveRun.jsx'
import RunSummary from './RunSummary.jsx'
import PlaceSheet from './PlaceSheet.jsx'
import Explore from './Explore.jsx'
import Library from './Library.jsx'
import RunDetail from './RunDetail.jsx'
import Account from './Account.jsx'
import MapStyleSheet from './MapStyleSheet.jsx'
import TabBar from './TabBar.jsx'
import { MapTools, RunTools } from './MapTools.jsx'
import { GeoBanner, ResumeBanner } from './Banners.jsx'
import { SheetGrabber, useSheetCover, useSheetDrag } from './Sheet.jsx'
import useLibrary from './useLibrary'
import useRunSession from './useRunSession'
import useSearch, { usePrefetch } from './useSearch'
import useGeolocation from './useGeolocation'
import useStart, { PARIS } from './useStart'
import usePois from './usePois'
import { askedOf, placeOf, requestFor, runEntry, summarise, toRequest } from './request'
import { blockedPoints } from './reports'
import { DEFAULT_STYLE, styleByKey } from './mapStyles'
import { km } from './format'
import { load, save } from './storage'
import * as offline from './offlineMaps'
import { clearEngineData, matchOnDevice, reverseOnDevice } from './engine/client'
import * as strava from './strava'

export default function App() {
  const stored = useMemo(() => load(), [])

  const [params, setParams] = useState({ ...DEFAULTS, ...(stored.params || {}) })
  const [mapStyle, setMapStyle] = useState(stored.mapStyle || DEFAULT_STYLE)
  // Les points d'eau et toilettes à montrer le long des boucles — voir `pois.js`.
  const [poiPrefs, setPoiPrefs] = useState(stored.pois || { water: false, toilets: false })

  const [tab, setTab] = useState('explore')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [stylesOpen, setStylesOpen] = useState(false)
  const [detail, setDetail] = useState(true)
  // Le panneau des propositions a deux hauteurs. Repliée, la carte occupe
  // l'écran et seules les cartes de parcours flottent dessus ; dépliée, le
  // détail du parcours choisi prend la place.
  const [sheet, setSheet] = useState('peek')
  const shellRef = useRef(null)
  useSheetCover(shellRef)

  // La recherche et ce qu'elle produit : jeton, élargissement, repère qui
  // rejoint la rue — voir `useSearch.js`.
  const found = useSearch()
  const { result, selected, busy, progress, error, snapped, scrub } = found
  const setSelected = found.setSelected
  const setScrub = found.setScrub
  // Numéro de « Régénérer » depuis la dernière recherche ordinaire.
  const variation = useRef(0)

  // Le départ, et la position qui le pose — voir `useStart.js`.
  const geo = useGeolocation()
  const { start, startLabel, placing, setPlacing, focus, applyStart, ...here } = useStart(geo, {
    onMoved: () => found.forget(),
  })

  // Les favoris, les sorties et les départs nommés : trois listes qui partagent
  // une contrainte de place, et les plafonds qui en découlent — voir
  // `useLibrary.js`.
  const library = useLibrary(stored)
  const { saved, history, places } = library

  // La sortie, du premier appui au bilan : une machine, et non neuf états
  // indépendants — voir `useRunSession.js`. Les noms locaux restent ceux que
  // tout l'écran emploie.
  const run = useRunSession({
    toEntry: (stats, how) => runEntry(stats, how, params),
    remember: (e) => library.remember(e),
  })
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
  const [speaking, setSpeaking] = useState(true)
  const [runView, setRunView] = useState(stored.runView === 'north' ? 'north' : 'heading')
  const [overviewAt, setOverviewAt] = useState(0)
  const [northAt, setNorthAt] = useState(0)
  const [naming, setNaming] = useState(false)
  const stageRef = useRef(null)
  const compassRef = useRef(null)

  const keepPlace = (name) => {
    if (!start) return
    // Le point choisi, et non le seuil de la rue où le repère s'est posé : c'est
    // de lui que se déduit, à chaque recherche, le côté par où sortir.
    const { lat, lon, street } = askedOf(start)
    library.keepPlace({ id: `p${Date.now()}`, name, lat, lon, ...(street ? { street } : {}) })
    setNaming(false)
  }

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
          onStart: (point) => here.setPoint({ ...point, asked }),
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

  // --- favoris et historique --------------------------------------------------
  // La même clé que celle des cartes hors ligne, et pour cause : c'est elle
  // qui relie un favori à sa carte. En recopier la formule ici marchait tant
  // que les deux restaient identiques — le jour où l'une aurait bougé,
  // l'app aurait affiché « carte disponible » sur un parcours dont la carte
  // serait devenue introuvable, sans rien signaler.
  const isFavorite = library.isFavorite(selected)

  /** Rouvre un parcours gardé — un favori, ou celui d'une sortie à refaire. */
  function openRoute(r) {
    found.show(r)
    setTab('explore')
    setSheet('peek')
    setDetail(true)
  }

  // La demande d'où vient le parcours suivi : c'est avec elle qu'un détour se
  // calcule en course.
  const detourRequest = useMemo(() => requestFor(selected, result, params), [selected, result, params])

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

  const toggleRunView = () => {
    const next = runView === 'north' ? 'heading' : 'north'
    setRunView(next)
    save({ runView: next })
  }

  // Le parcours qu'on regarde ou qu'on court, et ce qu'on croise en chemin.
  const shownRoute = running ? (freeRun ? null : liveRoute ?? selected) : viewing || summary ? null : selected
  const stops = usePois(shownRoute, poiPrefs)

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
        {/* Le titre de l'app, pour VoiceOver : c'est le premier repère annoncé
            en arrivant, et il est dans la région principale. */}
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
          stops={stops.stops}
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
          onUserMove={here.release}
          onPickRoute={(id) => {
            const match = result?.routes.find((r) => r.id === id)
            if (match) setSelected(match)
          }}
        />

        {/* Par-dessus la carte, et par-dessus tout le reste : pendant ces trois
            secondes, il n'y a rien d'autre à faire que partir. */}
        {starting && <Countdown onCancel={() => run.cancelCountdown()} onDone={() => run.begin()} />}

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
          <RunTools
            onStyles={() => setStylesOpen(true)}
            speaking={speaking}
            onVoice={() => setSpeaking((v) => !v)}
            runView={runView}
            onRunView={toggleRunView}
            compassRef={compassRef}
            onOverview={freeRun ? null : () => setOverviewAt(Date.now())}
          />
        ) : (
          <MapTools
            stylesOpen={stylesOpen}
            onStyles={() => setStylesOpen(true)}
            geo={geo}
            onLocate={here.centerOnMe}
            placing={placing}
            onPlacing={setPlacing}
            places={places}
            onPickPlace={(place) => applyStart(placeOf(place), place.name, true)}
            onDropPlace={(id) => library.dropPlace(id)}
            onFromHere={here.startFromHere}
            onKeepStart={start ? () => setNaming(true) : null}
            compassRef={compassRef}
            onNorth={() => setNorthAt(Date.now())}
          />
        )}

        {/* Seule une consigne transitoire flotte sur la carte. Un message
            permanent y masquerait le tracé — il appartient au panneau. */}
        {placing && (
          <div className="stage__hint">
            Touche la carte pour poser le départ — ou fais glisser le repère.
          </div>
        )}
      </main>

      <aside className="side">
        {/* En course, pas d'en-tête : l'activité et ses réglages ne se changent
            plus, et chaque ligne rendue à la carte compte. */}
        {!running && (
          <header className="side__head" {...sheetGesture()}>
            <SheetGrabber open={sheetMode === 'full'} onSet={setSheet} />
            {!viewing && tab !== 'explore' && (
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
            <ResumeBanner
              pending={pending}
              onResume={() => run.resumePending((route) => found.show(route))}
              onKeep={() => run.keepPending(params.sport)}
              onDrop={() => run.dropPending()}
            />
          )}
          {geoNoticeOpen && geo.status === 'denied' && (running || tab === 'explore') && (
            <GeoBanner
              onPlace={
                running
                  ? null
                  : () => {
                      setPlacing(true)
                      setGeoNoticeOpen(false)
                    }
              }
              onClose={() => setGeoNoticeOpen(false)}
            />
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
              onStrava={(r, id) => {
                const sent = { id, at: new Date().toISOString() }
                library.patch(r, { strava: sent })
                setViewing({ ...r, strava: sent })
              }}
            />
          ) : summary ? (
            <RunSummary
              entry={summary}
              onClose={() => run.closeSummary()}
              onStrava={(id) => library.patch(summary, { strava: { id, at: new Date().toISOString() } })}
            />
          ) : running ? (
            <LiveRun
              route={freeRun ? null : selected}
              request={freeRun ? null : detourRequest}
              sport={params.sport}
              resuming={resume}
              stage={stageRef.current}
              speaking={speaking}
              stops={stops.stops}
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
              poiPrefs={poiPrefs}
              onPoiPrefs={(patch) =>
                setPoiPrefs((prev) => {
                  const next = { ...prev, ...patch }
                  save({ pois: next })
                  return next
                })
              }
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
                // Et l'accès à Strava : effacer, c'est que l'app oublie tout.
                await strava.disconnect()
                library.clear()
              }}
              onRestored={() => {
                library.reload()
                const restored = load().params
                if (restored) setParams({ ...DEFAULTS, ...restored })
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
              // Le moteur ne retourne que ce qu'il vient de calculer : un favori
              // rouvert, un fichier importé ou un tracé du calculateur public
              // aboutissaient à « cette boucle n'est plus en mémoire ».
              onReverse={
                selected && !selected.remote && result?.meta?.engine === 'local' && result.routes.some((r) => r.id === selected.id)
                  ? reverseSelected
                  : null
              }
              onOpenFilters={() => setFiltersOpen(true)}
              onFavorite={() => library.toggleFavorite(selected)}
              onStart={() => beginRun('route')}
              onFreeRun={() => beginRun('free')}
              onOpenSaved={() => setTab('routes')}
              onScrub={setScrub}
              onOpenDetail={() => setSheet('full')}
              stops={stops}
              poiPrefs={poiPrefs}
            />
          )}
        </div>

        {!running && (
          <TabBar
            tab={tab}
            sportIcon={sport?.icon}
            onChange={(key) => {
              // La sortie qu'on relit et le bilan qu'on vient de terminer
              // prennent le panneau entier : sans les refermer, les onglets
              // changeaient bien d'onglet derrière, mais rien ne bougeait à
              // l'écran. On croyait trois boutons morts.
              setViewing(null)
              run.closeSummary()
              setTab(key)
              if (key === 'explore') setSheet('peek')
            }}
          />
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
