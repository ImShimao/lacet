/**
 * Explorer : le cœur de l'app — lancer une recherche, comparer les
 * propositions, en choisir une et partir.
 *
 * Séparé d'`App.jsx` pour une raison simple : `App` ne fait que tenir l'état et
 * distribuer les écrans, tandis que tout ce qui suit décide de ce qu'on montre
 * d'un itinéraire. Les mélanger obligeait à traverser huit cents lignes de
 * présentation pour retrouver la gestion du point de départ.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon, { SolidIcon } from './Icon.jsx'
import RouteStrip from './RouteStrip.jsx'
import { alreadyRun } from './knownRoutes'
import SafetyPanel from './SafetyPanel.jsx'
import SendSheet from './SendSheet.jsx'
import Compare from './Compare.jsx'
import { StopsList } from './Stops.jsx'
import { Segmented, formatKm } from './FiltersSheet.jsx'
import { downloadGpx } from './api'
import { climbMismatch, nightfall, reliefMismatch, surfaceMismatch, weatherAdvice } from './explain'
import { km } from './format'
import { haptic } from './platform'
import { filtersLine } from './request'
import { clockTime, turnIcon } from './runFormat'
import { fromKm, speedIn, speedLabel, toKm, unitLabel, units } from './units'
import { presets } from './presets'

import { t, locale, dec } from './i18n'
import { stepText, routeName, compass, engineText } from './stepText'
// Ce que règle la règle de l'accueil, selon le sport et le mode : bornes, pas,
// et une grande graduation tous les `major` pas.
const QUICK = {
  run: { min: 1, max: 42, step: 0.5, major: 10 },
  bike: { min: 5, max: 200, step: 5, major: 5 },
  duration: { min: 10, max: 300, step: 5, major: 6 },
}
// L'écart entre deux graduations, en pixels.
const TICK = 12

/**
 * La question de l'accueil : combien aujourd'hui. Le chiffre en grand, et sous
 * lui une règle graduée qu'on fait défiler au pouce, l'aiguille fixe au milieu.
 * Un curseur d'un bout à l'autre de l'écran ne laissait que 7 px par kilomètre :
 * la règle en donne 24, et chaque cran se sent.
 */
function QuickLength({ params, onQuickParams }) {
  const duration = params.mode === 'duration'
  const key = duration ? 'duration_min' : 'distance_km'
  const cfg = duration ? QUICK.duration : params.sport === 'bike' ? QUICK.bike : QUICK.run
  const value = params[key]
  const unit = duration ? 'min' : unitLabel()
  // shortcut: en miles, la règle garde ses crans d'un demi-kilomètre ; seul le chiffre est converti.
  const shown = duration ? value : units() === 'mi' ? formatKm(Math.round(fromKm(value) * 10) / 10) : formatKm(value)
  const ref = useRef(null)

  const clampStep = (v) => Math.min(cfg.max, Math.max(cfg.min, cfg.min + Math.round((v - cfg.min) / cfg.step) * cfg.step))
  const set = (v) => {
    const next = Math.round(clampStep(v) * 1000) / 1000
    if (next === value) return
    haptic('tickHaptic')
    onQuickParams({ [key]: next, mode: duration ? 'duration' : 'distance' })
  }

  // La règle suit la valeur quand elle change d'ailleurs (filtres, sport,
  // changement de mode). Un défilement au doigt ne la contredit pas : il
  // tombe déjà à moins d'un demi-cran de la valeur qu'il vient de poser.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = ((clampStep(value) - cfg.min) / cfg.step) * TICK
    if (Math.abs(el.scrollLeft - target) > TICK / 2) el.scrollLeft = target
  })

  return (
    <div className="dist">
      <Segmented
        options={[
          { key: 'distance', label: t('Distance') },
          { key: 'duration', label: t('Durée') },
        ]}
        value={params.mode}
        onChange={(mode) => onQuickParams({ mode })}
      />
      <div className="dist__value" aria-hidden="true">
        {/* La clé relance le petit battement à chaque cran. */}
        <b key={value}>{shown}</b>
        <small>{unit}</small>
      </div>
      <div className="ruler">
        <div
          ref={ref}
          className="ruler__track"
          role="slider"
          tabIndex={0}
          aria-label={duration ? t('Durée de la sortie') : t('Distance de la boucle')}
          aria-valuemin={cfg.min}
          aria-valuemax={cfg.max}
          aria-valuenow={value}
          aria-valuetext={`${shown} ${unit}`}
          onScroll={(e) => set(cfg.min + Math.round(e.currentTarget.scrollLeft / TICK) * cfg.step)}
          // Au doigt, la bande défile d'elle-même. À la souris (l'aperçu sur
          // ordinateur), il faut la tirer, ou tourner la molette.
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') return
            const el = e.currentTarget
            const x0 = e.clientX
            const s0 = el.scrollLeft
            const move = (ev) => (el.scrollLeft = s0 - (ev.clientX - x0))
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
          onKeyDown={(e) => {
            const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
            if (!d) return
            e.preventDefault()
            set(value + d * cfg.step)
          }}
        >
          <span className="ruler__pad" />
          <span
            className="ruler__ticks"
            style={{
              width: ((cfg.max - cfg.min) / cfg.step) * TICK + 1,
              '--major': `${cfg.major * TICK}px`,
              // Les grandes graduations tombent sur les nombres ronds (5, 10, 15 km).
              '--offset': `${((Math.ceil(cfg.min / (cfg.major * cfg.step)) * cfg.major * cfg.step - cfg.min) / cfg.step) * TICK}px`,
            }}
          />
          <span className="ruler__pad" />
        </div>
        <span className="ruler__needle" aria-hidden="true" />
      </div>
      <div className="presets">
        {presets(duration ? 'duration' : params.sport === 'bike' ? 'bike' : 'run').map((p) => {
          const target = duration ? p : toKm(p)
          return (
            <button
              key={p}
              className={Math.abs(target - value) < 0.01 ? 'chip chip--on' : 'chip'}
              onClick={() => {
                haptic('tickHaptic')
                onQuickParams({ [key]: Math.round(target * 1000) / 1000, mode: duration ? 'duration' : 'distance' })
              }}
            >
              {String(p).replace('.', dec())} {unit}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * L'arrivée d'un trajet : cherchée en haut de l'écran, posée d'un toucher sur
 * la carte, ou glissée. Tant qu'elle manque, la carte dit quoi faire.
 */
function Destination({ destination, placing, onPlace, onClear }) {
  return (
    <div className="origin origin--dest">
      <span className="origin__pin">
        <Icon name="flag" size={18} />
      </span>
      <div>
        <b>{destination ? destination.label || t('Point d\'arrivée') : t('Où vas-tu ?')}</b>
        <em>
          {destination
            ? t('arrivée — glisse-la sur la carte')
            : placing
              ? t('touche la carte là où tu veux arriver')
              : t('cherche une adresse en haut, ou pose-la sur la carte')}
        </em>
      </div>
      {destination ? (
        <button className="origin__act" onClick={onClear} aria-label={t('Effacer l\'arrivée')}>
          <Icon name="close" size={15} />
        </button>
      ) : (
        onPlace && (
          <button className={`origin__act ${placing ? 'origin__act--on' : ''}`} onClick={onPlace} aria-pressed={placing}>
            <Icon name="pin" size={15} />{t('Carte')}</button>
        )
      )}
    </div>
  )
}

/**
 * Un avertissement, et la recherche qui y répond à portée de pouce : dire
 * « rien de plat d'ici » sans proposer « Vallonné » obligeait à rouvrir les
 * filtres pour faire le seul geste évident (RunnrZ le propose en un toucher).
 */
function Notice({ warn = false, action = null, onAct = null, children }) {
  return (
    <div className={warn ? 'notice notice--warn' : 'notice'}>
      {children}
      {action && onAct && (
        <button className="notice__act" onClick={onAct}>
          {t(action)}
        </button>
      )}
    </div>
  )
}

// Mêmes libellés que le backend, pour que l'app parle d'une seule voix.
const CARDINALS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

export default function Explore({
  progress = null,
  snapped = null,
  history = [],
  start,
  startLabel,
  geo,
  busy,
  error,
  result,
  selected,
  detail,
  params,
  streetsReady = false,
  streetsLoading = false,
  isFavorite,
  onSelect,
  onToggleDetail,
  onSearch,
  onSearchWith = null,
  onCancel = null,
  onRegenerate,
  onReverse,
  reversing = false,
  onOpenFilters,
  onQuickParams = null,
  onFavorite,
  onStart,
  onFreeRun,
  onOpenSaved,
  onScrub,
  onShowStep,
  onOpenDetail,
  onBack = null,
  freshImport = false,
  stops = { stops: [], loading: false, complete: true },
  poiPrefs = null,
  journey = false,
  onGoal = null,
  destination = null,
  placingDest = false,
  onPlaceDestination = null,
  onClearDestination = null,
  onReturnTrip = null,
  tripKind = 'oneway',
  onTripKind = null,
  onSwapEnds = null,
}) {
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [comparing, setComparing] = useState(false)
  // Ce qu'on reconnaît de l'historique, calculé une fois par liste de
  // propositions : le tri grossier écarte presque tout sans rien mesurer, mais
  // le refaire à chaque rendu serait gratuit pour personne.
  const known = useMemo(() => {
    const out = new Map()
    for (const r of result?.routes ?? []) {
      const found = alreadyRun(r, history)
      if (found) out.set(r.id, found)
    }
    return out
  }, [result, history])
  // Sur ordinateur, on prépare : rien de ce qui sert pendant la course.

  if (busy) {
    return (
      <div className="panel">
        <div className="skeleton skeleton--card" />
        <div className="skeleton skeleton--line" />
        <SearchProgress progress={progress} />
        {/* Hors des archives, l'écran annonce lui-même jusqu'à une minute
            d'attente : il faut pouvoir en sortir sans fermer l'app. */}
        {onCancel && (
          <button className="btn btn--ghost" onClick={onCancel}>{t('Annuler')}</button>
        )}
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel">
        <div className="notice notice--error">{t(error.message)}</div>
        {error.offline ? (
          <button className="btn btn--primary" onClick={onOpenSaved}>
            <Icon name="routes" size={17} />{t('Voir mes parcours enregistrés')}</button>
        ) : (
          <button className="btn btn--primary" onClick={onSearch}>{t('Réessayer')}</button>
        )}
      </div>
    )
  }

  if (!result && journey && placingDest) {
    // Poser l'arrivée se fait sur la carte : le panneau entier la couvrait, et
    // l'on touchait la feuille au lieu de la rue. Il ne reste que la consigne.
    return (
      <div className="panel panel--placing">
        <Destination destination={destination} placing={placingDest} onPlace={onPlaceDestination} onClear={onClearDestination} />
      </div>
    )
  }

  // Un trajet sans arrivée n'a qu'une question : où aller. La longueur, les
  // filtres et la course libre attendent qu'elle soit posée.
  const bare = journey && !destination

  if (!result) {
    return (
      <div className="panel">
        {/* Revenir à sa porte, ou aller quelque part : la première question, en
            tête. Le trajet garde tout le reste — note, voix, relief. */}
        {onGoal && (
          <Segmented
            options={[
              { key: 'loop', label: t('Boucle') },
              { key: 'journey', label: t('Aller à…') },
            ]}
            value={journey ? 'journey' : 'loop'}
            onChange={onGoal}
          />
        )}
        {/* Départ et arrivée d'un même bloc, reliés comme sur un plan : séparés
            par le choix Boucle / Aller à…, ils ne se lisaient pas comme un trajet. */}
        <div className={journey ? 'itinerary' : undefined}>
          <div className="origin">
            <span className="origin__pin">
              <Icon name="pin" size={18} />
            </span>
            <div>
              <b>{startLabel || (start ? t('Point choisi') : t('Localisation…'))}</b>
              <em>
                {geo.accuracy && geo.status === 'ready'
                  ? t('précision ± {v1} m', { v1: Math.round(geo.accuracy) })
                  : journey
                    ? t('départ du trajet')
                    : t('départ de la boucle')}
              </em>
            </div>
          </div>
          {journey && (
            <Destination destination={destination} placing={placingDest} onPlace={onPlaceDestination} onClear={onClearDestination} />
          )}
          {journey && destination && start && onSwapEnds && (
            <button className="itinerary__swap" onClick={onSwapEnds} aria-label={t('Inverser départ et arrivée')} title={t('Inverser départ et arrivée')}>
              <Icon name="updown" size={16} />
            </button>
          )}
        </div>
        {journey ? (
          <>
            {/* Une précision du trajet, pas une seconde grande question : des
                pastilles, pas un deuxième sélecteur pleine largeur. */}
            {onTripKind && (
              <div className="chips chips--trip" role="radiogroup" aria-label={t('Type de trajet')}>
                {[
                  ['oneway', t('Au plus court')],
                  ['stretch', t('Plus long')],
                  ['round', t('Aller-retour')],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={tripKind === key}
                    className={`chip ${tripKind === key ? 'chip--on' : ''}`}
                    onClick={() => onTripKind(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {tripKind === 'stretch' && !bare && onQuickParams && <QuickLength params={params} onQuickParams={onQuickParams} />}
          </>
        ) : (
          onQuickParams && <QuickLength params={params} onQuickParams={onQuickParams} />
        )}
        <button className="btn btn--primary btn--big" onClick={onSearch} disabled={!start}>
          <Icon name="search" size={18} />
          {journey ? (destination ? t('Trouver mon trajet') : t('Choisir l\'arrivée')) : t('Trouver ma boucle')}
        </button>
        {/* Côte à côte : deux gestes secondaires empilés sous le principal
            prenaient autant de place que lui, et le noyaient. */}
        {!bare && (
        <div className="row">
          {/* Ce que les filtres règlent, dit avant de les ouvrir — sans la
              distance, déjà écrite en grand juste au-dessus. */}
          <button className="btn btn--stack" onClick={onOpenFilters}>
            <Icon name="sliders" size={17} />
            <span>{t('Filtres')}<em>{filtersLine(params)}</em>
            </span>
          </button>
          <button className="btn btn--ghost" onClick={onFreeRun}>
            <Icon name="play" size={17} />{t('Courir libre')}</button>
        </div>
        )}
        {/* Les rues se préparent en fond dès que le départ est connu : le dire
            explique pourquoi la recherche est soudain instantanée — et qu'elle
            le restera, même sans réseau. */}
        {streetsReady ? (
          <p className="ready small">
            <Icon name="check" size={14} />{t('Rues du coin prêtes, même sans réseau.')}</p>
        ) : (
          streetsLoading && (
            <p className="ready ready--busy small">
              <Icon name="spinner" size={14} />{t('Préparation des rues de ce coin…')}</p>
          )
        )}
      </div>
    )
  }

  const { routes, meta } = result

  if (!routes.length) {
    return (
      <div className="panel">
        <div className="notice notice--warn">{t(meta.message)}</div>
        <button className="btn btn--primary" onClick={onOpenFilters}>{t('Modifier les filtres')}</button>
        <button className="btn btn--ghost" onClick={onFreeRun}>
          <Icon name="play" size={17} />{t('Courir sans itinéraire')}</button>
      </div>
    )
  }

  // Un trajet ne cherche ni relief ni terrain : il va où l'on va. Les aveux
  // « pas de boucle plate d'ici » n'y auraient pas de sens.
  const isJourney = Boolean(meta.journey)
  const relief = isJourney
    ? null
    : params.climb_m != null
      ? climbMismatch(params.climb_m, routes)
      : reliefMismatch(params.elevation, routes)
  const ground = isJourney ? null : surfaceMismatch(params.surface, routes)
  const weather = weatherAdvice(meta.weather)
  // Partie maintenant, la boucle finit-elle de nuit ? C'est le moment où une
  // rue sans éclairage ni trottoir devient dangereuse : le dire avant de partir.
  const [startLon, startLat] = selected.geometry?.[0] ?? []
  const dusk = startLat != null && selected.duration_s ? nightfall(startLat, startLon, selected.duration_s) : null

  const exportGpx = async () => {
    setExporting(true)
    try {
      await downloadGpx(
        selected.name,
        selected.geometry,
        selected.elevation_profile?.map((p) => p.ele_m) || null,
        params.sport,
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="panel panel--results">
      {/* Le fichier vient d'entrer : la coche bondit, le temps de dire ce que
          Lacet en a tiré — et qu'il ne s'est pas contenté de l'afficher. */}
      {freshImport && (
        <div className="notice notice--import" role="status">
          <span className="notice__check">
            <Icon name="check" size={16} />
          </span>
          {selected.matched
            ? t('Boucle importée et analysée : note, voies, traversées et dénivelé.')
            : t('Boucle importée. Ses points ne suivent aucune rue connue : elle reste sans note.')}
        </div>
      )}
      <RouteCards
        known={known}
        routes={routes}
        selected={selected}
        onSelect={onSelect}
        onOpenDetail={onOpenDetail}
        sport={params.sport}
      />
      {/* Sous les cartes, là où l'on hésite : au fond du détail, « Comparer »
          ne se trouvait qu'une fois le choix déjà fait. */}
      {routes.length > 1 && !comparing && (
        <button className="comparelink" onClick={() => setComparing(true)} aria-expanded={false}>
          <Icon name="chart" size={15} />{t('Comparer les {length} propositions', { length: routes.length })}</button>
      )}
      {comparing && routes.length > 1 && (
        <Compare routes={routes} selected={selected} onSelect={onSelect} onClose={() => setComparing(false)} />
      )}

      {/* Les avertissements viennent après les cartes : ils nuancent une
          proposition, ils ne doivent pas la pousser sous le pli. */}
      {/* Et quand la direction demandée n'a rien donné : les boucles
          montrées partent d'ailleurs, et il faut le savoir avant d'y aller. */}
      {(meta.relaxed || meta.heading_missed) && (
        <div className="notice notice--warn">{t(meta.message)}</div>
      )}
      {/* Une bordure de la zone n'est pas arrivée à temps — la carte livrée
          s'arrête à la limite de la région, et Overpass tardait. Plutôt que de
          faire attendre devant une barre figée, on a cherché avec le reste ; le
          dire évite de croire que le coin n'a rien de mieux à offrir. */}
      {meta.partial && (
        <Notice action="Relancer" onAct={onSearch}>{t('Le bord de la zone n\'est pas encore arrivé : ces boucles n\'utilisent que les rues déjà là.')}</Notice>
      )}
      {/* Sans altitude, le dénivelé n'est pas seulement absent de l'affichage :
          il n'a pas pu servir au classement. Demander « des côtes » et recevoir
          cinq boucles plates sans un mot serait incompréhensible. */}
      {meta.elevation_skipped && (
        <Notice action="Relancer" onAct={onSearch}>{t('Le relief n\'a pas répondu à temps : dénivelé inconnu, classement sans lui.')}</Notice>
      )}
      {/* Le relief, lui, a répondu — mais le coin n'a pas celui qu'on demande.
          Le dire, plutôt que de laisser croire que ces boucles sont des côtes. */}
      {relief && (
        <Notice
          action={relief.kind === 'climb' ? t('Viser {ascent} m', { ascent: relief.ascent }) : t('Chercher en Vallonné')}
          onAct={
            onSearchWith &&
            (() =>
              onSearchWith(
                relief.kind === 'climb' ? { climb_m: relief.ascent } : { elevation: 'rolling', climb_m: null },
              ))
          }
        >
          {relief.kind === 'climb'
            ? t('Rien autour de {climb_m} m d\'ici : la boucle la plus proche monte de {ascent} m.', { climb_m: params.climb_m, ascent: relief.ascent })
            : relief.kind === 'hilly'
              ? t('Pas de côtes à portée d\'ici : la plus vallonnée ne monte que de {ascent} m. Pars plus près du relief pour en trouver.', { ascent: relief.ascent })
              : t('Pas de boucle plate d\'ici : la plus douce monte déjà de {ascent} m.', { ascent: relief.ascent })}
        </Notice>
      )}
      {/* Le même aveu pour le terrain : ces boucles passent devant parce
          qu'elles s'en approchent le plus, pas parce qu'elles le tiennent. */}
      {ground && (
        <Notice action="Passer en Mixte" onAct={onSearchWith && (() => onSearchWith({ surface: 'mixed' }))}>
          {ground.kind === 'trail'
            ? t('Peu de chemins à portée d\'ici : la boucle la plus nature n\'en compte que {share} %.', { share: ground.share })
            : t('Pas de boucle toute goudronnée d\'ici : la plus roulante a encore {share} % de chemins.', { share: ground.share })}
        </Notice>
      )}
      {dusk && (
        <div className="notice notice--warn">{t('La nuit tombe vers {v1}, avant ta fin estimée ({v2}) : frontale et gilet réfléchissant.', { v1: clockTime(dusk), v2: clockTime(Date.now() + selected.duration_s * 1000) })}</div>
      )}
      {/* Le repère a rejoint la rue, et de loin : le dire évite de chercher
          pourquoi il a bougé. Sous cinquante mètres, rien — ça ne se voit pas.
          Dans le détail seulement : sur la carte repliée, ces trois lignes
          prenaient la place du tracé, à chaque recherche depuis une adresse. */}
      {snapped && (
        <div className="notice notice--detail">{t('Le départ s\'est posé sur la rue, à {snapped} m du point demandé : la boucle part et revient là.', { snapped })}</div>
      )}
      {known.has(selected.id) && <AlreadyRun found={known.get(selected.id)} />}
      {/* Retour, météo, vent : trois cadres pleine largeur poussaient le tracé
          et la note sous le pli. Une rangée de pastilles les dit d'un coup
          d'œil ; seul un conseil qui change la tenue garde sa phrase. */}
      <Facts
        back={!dusk && selected.duration_s > 0 ? clockTime(Date.now() + selected.duration_s * 1000) : null}
        weather={weather}
        wind={meta.wind}
      />

      {selected.laps > 1 && (
        <div className="laps">
          <Icon name="repeat" size={15} />
          <span>
            {selected.figure_eight ? (
              <>{t('Deux boucles différentes, de')}{' '}<b>{km(selected.lap_distances_m[0], 2)}</b>{' '}{t('puis')}{' '}<b>{km(selected.lap_distances_m[1], 2)} {unitLabel()}</b>{t(', enchaînées au départ')}</>
            ) : (
              <>{t('Un tour de')}{' '}<b>{km(selected.lap_distance_m, 2)} {unitLabel()}</b>{t(', à parcourir')}{' '}<b>{t('{laps} fois', { laps: selected.laps })}</b>
              </>
            )}
            {/* Ne l'affirmer que quand c'est vrai : la liste peut mêler des
                boucles entières et des parcours à tours, et prétendre alors
                qu'aucune boucle entière n'existe serait démenti par la
                proposition d'à côté. */}
            {/* Ni quand on a demandé des tours : c'est la forme choisie. */}
            {routes.some((r) => r.laps === 1) || (params.form ?? 'auto') !== 'auto'
              ? '.'
              : t(' — aucune boucle entière de cette longueur ne tient le contrôle par ici.')}
          </span>
        </div>
      )}

      {/* Le détail, en sections : le relief, la sécurité, les surfaces, puis
          ce qu'on croise et la feuille de route. Les deux lignes de texte qui
          résumaient terrain et traversées au-dessus répétaient les tuiles. */}
      <RouteStrip route={selected} onScrub={onScrub} weightKg={params.weight_kg} sport={params.sport} />

      {selected.safety ? (
        <SafetyPanel
          safety={selected.safety}
          surfaces={selected.surfaces}
          segments={selected.segments}
          distance={selected.distance_m}
          sport={params.sport}
          open={detail}
        />
      ) : (
        detail && (
          // Pas de note : le détail n'existe pas, et un panneau vide
          // laisserait croire à une évaluation réussie. Deux raisons
          // possibles, et elles n'appellent pas le même geste — réessayer
          // plus tard, ou accepter que ce tracé-là ne sera jamais noté.
          <div className="notice">
            {selected.imported
              ? t('Ce parcours ne suit aucune rue connue d\'ici : pas de note ni de virages dictés. Lacet le suit, le mesure et prévient si tu t\'en écartes.')
              : t('Tracé par un calculateur public, faute des rues de ce coin : pas de note. Relance plus tard pour en avoir une.')}
          </div>
        )
      )}

      <button className="disclose" onClick={onToggleDetail} aria-expanded={detail}>
        {detail ? t('Moins de détails') : t('Pourquoi cette note ?')}
        <Icon name={detail ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>

      {detail && (
        <>
            <p className="disclaimer">{t('Note tirée d\'OpenStreetMap, parfois incomplet ou dépassé : reste attentif sur le terrain.')}</p>
        </>
      )}

      {/* Ce qu'on fait de la boucle, avec leur nom, dans le détail : sous les
          cartes, trois ronds sans libellé se devinaient mal. */}
      <div className="loopacts" role="group" aria-label={t('Cette boucle')}>
        {/* Le sens n'est pas décoratif : il décide des côtes qu'on prend
            en montant, du vent qu'on a dans le dos à la fin, et de chaque
            consigne de virage. La même boucle à l'envers est une autre sortie. */}
        {onReverse && (
          <button
            className={`loopact ${selected.reversed ? 'loopact--on' : ''}`}
            onClick={onReverse}
            disabled={reversing}
            aria-pressed={Boolean(selected.reversed)}
            title={selected.reversed ? t('Revenir au sens d\'origine') : t('Parcourir dans l\'autre sens')}
            aria-label={selected.reversed ? t('Revenir au sens d\'origine') : t('Parcourir dans l\'autre sens')}
          >
            <Icon name="uturn" size={18} />
            <span>{t('Autre sens')}</span>
          </button>
        )}
        {/* Un GPX, par la feuille de partage : un ami qui a Lacet l'ouvre avec
            l'app, qui le note et le décrit comme ses propres boucles ; les
            autres le prennent dans leur montre ou leur app de course. */}
        <button
          className={`loopact ${sharing ? 'loopact--on' : ''}`}
          onClick={() => setSharing((s) => !s)}
          aria-expanded={sharing}
          title={t('Envoyer cette boucle')}
          aria-label={t('Envoyer cette boucle')}
        >
          <Icon name="share" size={18} />
          <span>{t('Partager')}</span>
        </button>
        {/* Un trajet ne se régénère pas — ses trois chemins sont déjà là —,
            mais il a un retour : de B vers A, avec ses propres sens uniques,
            ses propres traversées, et parfois une autre note. */}
        {isJourney ? (
          onReturnTrip && (
            <button className="loopact" onClick={onReturnTrip} title={t('Calculer le trajet retour')} aria-label={t('Calculer le trajet retour')}>
              <Icon name="uturn" size={18} />
              <span>{t('Trajet retour')}</span>
            </button>
          )
        ) : (
          <button
            className="loopact"
            onClick={onRegenerate ?? onSearch}
            title={t('Régénérer d\'autres boucles')}
            aria-label={t('Régénérer d\'autres boucles')}
          >
            <Icon name="shuffle" size={18} />
            <span>{t('Autres boucles')}</span>
          </button>
        )}
      </div>
      {sharing && <SendSheet onSend={exportGpx} busy={exporting} onClose={() => setSharing(false)} />}
      <StopsList {...stops} prefs={poiPrefs} distance={selected.distance_m} />

      {selected.instructions?.length > 2 && <RouteSteps steps={selected.instructions} onShow={onShowStep} />}

      <button className="linkish" onClick={onFreeRun}>{t('ou courir librement, sans suivre de tracé')}</button>

      {/* Collée au bas du panneau : « Démarrer » reste à portée de pouce quel
          que soit l'endroit où l'on a fait défiler le détail. À côté, le seul
          autre geste qu'on fait avant de partir : garder la boucle. */}
      <div className="actionbar">
        {/* Retour à l'accueil et à « Trouver ma boucle » : une boucle importée
            ou un favori rouvert n'avaient pas d'autre sortie qu'une nouvelle
            recherche lancée depuis la barre du haut. */}
        {onBack && (
          <button className="btn btn--icon" onClick={onBack} title={t('Revenir au générateur')} aria-label={t('Revenir au générateur')}>
            <Icon name="close" size={19} />
          </button>
        )}
        <button
          className={`btn btn--icon ${isFavorite ? 'btn--on' : ''}`}
          onClick={onFavorite}
          title={isFavorite ? t('Retirer des favoris') : t('Enregistrer en favori')}
          aria-label={isFavorite ? t('Retirer des favoris') : t('Enregistrer en favori')}
          aria-pressed={isFavorite}
        >
          {isFavorite ? <SolidIcon name="heart" size={19} /> : <Icon name="heart" size={19} />}
        </button>
        <button className="btn btn--primary" onClick={onStart}>
          <Icon name="play" size={17} />{t('Démarrer')}</button>
      </div>
    </div>
  )
}

const STAGES = {
  // Les rues déjà sur l'appareil — livrées avec l'app, ou gardées d'une
  // recherche précédente. Le moteur ne passe à `download` que s'il lui faut le
  // réseau : chez soi, l'écran annonçait à tort un téléchargement.
  data: 'Lecture des rues',
  download: 'Téléchargement des rues',
  graph: 'Assemblage des rues',
  routing: 'Recherche des boucles',
  elevation: 'Calcul du relief',
}

/**
 * Où en est le calcul.
 *
 * Tout se passe sur l'appareil, et la première recherche dans une zone commence
 * par télécharger ses rues — quelques secondes dans une petite ville, bien
 * plus en plein Paris. Une animation muette laissait croire à une app figée ;
 * nommer l'étape dit ce qui prend du temps, et pourquoi la suivante sera rapide.
 */
// Au-delà de ce délai sans que la barre bouge, on le dit. Les serveurs
// d'OpenStreetMap sont publics et gratuits, et une requête y prend parfois vingt
// secondes : une barre figée à 17 % pendant ce temps donne une app plantée, et
// on la ferme juste avant qu'elle aboutisse.
const PATIENCE_MS = 12_000

function SearchProgress({ progress }) {
  const stage = progress?.stage ?? 'data'
  // Le pourcentage suit les tuiles téléchargées ; lues sur l'appareil, elles
  // arrivent toutes d'un coup.
  const fraction = stage === 'download' ? (progress?.fraction ?? 0) : null
  const [long, setLong] = useState(false)

  // Le compteur repart à chaque avancée réelle : c'est l'absence de mouvement
  // qui inquiète, pas la durée totale.
  useEffect(() => {
    setLong(false)
    const timer = setTimeout(() => setLong(true), PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [stage, fraction])

  return (
    <div className="progress" role="status">
      <div className="progress__label">
        <span>{t(STAGES[stage] ?? 'Calcul en cours')}…</span>
        {fraction !== null && fraction > 0 && <b>{Math.round(fraction * 100)} %</b>}
      </div>
      {/* Tant qu'aucune tuile n'est arrivée, la barre défile au lieu de rester à
          zéro : une petite zone part en une seule requête, et vingt secondes de
          barre immobile se lisent comme une app figée — on la ferme juste avant
          qu'elle aboutisse. */}
      <div className={`progress__bar ${fraction ? '' : 'progress__bar--busy'}`}>
        <i style={fraction ? { transform: `scaleX(${Math.max(0.04, fraction)})` } : undefined} />
      </div>
      <p className="muted small">
        {long && stage === 'download'
          ? // Les archives couvrent la France et ses voisins ; ailleurs, il faut
            // interroger OpenStreetMap en direct, et c'est là que ça traîne.
            t('Hors des archives : OpenStreetMap répond lentement, moins d\'une minute en général.')
          : stage === 'download'
            ? t('Gardées sur l\'appareil : la prochaine fois, ce sera immédiat.')
            : stage === 'elevation'
              ? // La seule étape qui attend encore quelqu'un d'autre : autant le
                // dire, plutôt que de promettre un calcul sans serveur.
                t('Altitudes de l\'IGN, gardées pour les prochaines boucles.')
              : t('Calculé sur ton téléphone, sans serveur.')}
      </p>
    </div>
  )
}

/**
 * « Tu l'as déjà courue. »
 *
 * L'app gardait les sorties passées sans jamais les rapprocher de ce qu'elle
 * propose. Le rapprochement sert deux fois : éviter de refaire la même boucle
 * trois dimanches de suite, et se comparer à soi-même quand c'est justement ce
 * qu'on cherche.
 */
function AlreadyRun({ found }) {
  const { run, share } = found
  const quand = new Date(run.ranAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long' })
  const temps = run.actual_duration_s ? minutes(run.actual_duration_s) : null
  return (
    <div className="notice">{t('Déjà couru le {quand}{v2}', { quand, v2: temps ? t(' en {temps}', { temps }) : '' })}{share < 0.95 ? t(' — à {v1} % le même chemin.', { v1: Math.round(share * 100) }) : '.'}
    </div>
  )
}

/**
 * Les propositions, en cartes qu'on fait défiler du pouce.
 *
 * Elles remplacent une grille de pastilles qui passait sur deux rangées dès
 * cinq propositions, et repoussait le parcours lui-même sous le pli. Une carte
 * par proposition, les voisines dépassant sur les bords : on voit qu'il y en a
 * d'autres sans qu'elles prennent la place de celle qu'on regarde.
 *
 * Le lien marche dans les deux sens. Faire défiler choisit : la carte qui
 * s'arrête au centre devient le tracé affiché. Et une proposition choisie
 * ailleurs — touchée sur la carte, ou la première au chargement — vient se
 * placer au centre.
 */
function RouteCards({ routes, selected, onSelect, onOpenDetail, known, sport }) {
  const track = useRef(null)
  const settle = useRef(null)
  const first = useRef(true)
  // Lu au moment où le défilement se pose, pas à celui où il a commencé.
  const current = useRef(selected?.id)
  current.current = selected?.id

  const cardOf = (id) => track.current?.querySelector(`[data-id="${CSS.escape(String(id))}"]`)

  useEffect(() => {
    const t = track.current
    const card = cardOf(selected?.id)
    if (!t || !card) return
    // Calculé à la main plutôt que `scrollIntoView` : celui-ci ferait aussi
    // défiler le panneau verticalement pour montrer la carte, et arracherait
    // le détail qu'on était en train de lire.
    const left = card.offsetLeft - (t.clientWidth - card.offsetWidth) / 2
    const still = first.current || matchMedia('(prefers-reduced-motion: reduce)').matches
    t.scrollTo({ left, behavior: still ? 'auto' : 'smooth' })
    first.current = false
  }, [selected?.id])

  useEffect(() => () => clearTimeout(settle.current), [])

  // Attendre que le défilement se pose. Choisir à chaque pixel redessinerait
  // le tracé cinq fois pendant un seul geste.
  const onScroll = () => {
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const t = track.current
      if (!t) return
      const middle = t.scrollLeft + t.clientWidth / 2
      let best = null
      for (const el of t.querySelectorAll('.rcard')) {
        const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - middle)
        if (!best || gap < best.gap) best = { el, gap }
      }
      const id = best?.el.dataset.id
      if (!id || id === String(current.current)) return
      const route = routes.find((r) => String(r.id) === id)
      if (!route) return
      // Un tapotement quand la carte se pose : le pouce sent qu'une autre
      // boucle est choisie, sans quitter la carte des yeux.
      haptic('tickHaptic')
      onSelect(route)
    }, 110)
  }

  const onKeyDown = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const next = routes[routes.findIndex((r) => r.id === selected?.id) + step]
    if (!next) return
    e.preventDefault()
    onSelect(next)
    cardOf(next.id)?.focus({ preventScroll: true })
  }

  return (
    <div className="cards">
      <div className="cards__track" ref={track} onScroll={onScroll} onKeyDown={onKeyDown}>
        {/* Des cales plutôt qu'un rembourrage : Safari ignore le rembourrage de
            fin d'un conteneur qui défile, et la dernière carte ne pourrait
            alors jamais se centrer — donc jamais être choisie au pouce. */}
        <span className="cards__pad" aria-hidden="true" />
        {routes.map((r, i) => {
          const on = r.id === selected?.id
          return (
            <button
              key={r.id}
              data-id={r.id}
              className={`rcard ${on ? 'rcard--on' : ''}`}
              aria-pressed={on}
              // Toucher la carte déjà choisie ouvre son détail : c'est le geste
              // qu'on tente naturellement, et sur téléphone, feuille repliée,
              // le seul chemin vers le profil et la note.
              onClick={() => (on ? onOpenDetail?.() : onSelect(r))}
            >
              <span className="rcard__top">
                {routes.length > 1 && <span className="rcard__n">{i + 1}</span>}
                {/* La direction est ce qui distingue vraiment deux propositions :
                    à distance égale, c'est elle qu'on choisit. Sauf pour un
                    parcours à tours, où c'est le fait même d'en faire plusieurs —
                    et pour un « 8 », ses deux boucles. */}
                <span className="rcard__dir">
                  {r.figure_eight
                    ? `${km(r.lap_distances_m[0], 1)} + ${km(r.lap_distances_m[1], 1)} ${unitLabel()}`
                    : r.laps > 1
                      ? `${km(r.lap_distance_m, 1)} ${unitLabel()} × ${r.laps}`
                      : // « Boucle sud-est » le dit déjà dessous : pas deux fois.
                        r.name?.toLowerCase().includes(r.direction?.toLowerCase()) ? '' : compass(r.direction)}
                </span>
                {/* Sans analyse — un tracé de secours —, pas de note : un tiret
                    dit « on ne sait pas », là où un « A » mentirait. */}
                {r.safety ? (
                  <span className={`grade grade--${r.safety.grade}`}>{r.safety.grade}</span>
                ) : (
                  <span className="grade grade--unknown" title={t('Sécurité non évaluée')}>
                    —
                  </span>
                )}
                {/* Ce chemin-là, on l'a déjà fait : c'est parfois ce qu'on
                    cherche — se comparer — et parfois ce qu'on fuit. Dans les
                    deux cas, il vaut mieux le savoir avant de partir. */}
                {known?.has(r.id) && !on && (
                  <span className="rcard__seen" title={t('Déjà couru')}>
                    <Icon name="history" size={14} />
                  </span>
                )}
                {on && (
                  <span className="rcard__more">{t('Détails')}<Icon name="chevronUp" size={14} />
                  </span>
                )}
              </span>
              <span className="rcard__km">
                <b>{km(r.distance_m, 1)}</b> {unitLabel()}
                <Spark points={r.elevation_profile} />
              </span>
              <span className="rcard__name">{routeName(r.name)}</span>
              <span className="rcard__stats">
                <span>
                  <b>{minutes(r.duration_s)}</b>
                </span>
                <span>
                  D+ <b>{r.ascent_m === null ? '—' : `${Math.round(r.ascent_m)} m`}</b>
                </span>
                <span>
                  {r.safety ? (
                    <>
                      {/* « protégé » se lisait comme un verdict sur le reste : une
                          rue calme dont le trottoir n'est pas noté sur la carte
                          n'y compte pas, et paraissait livrée aux voitures. */}
                      <b>{Math.round(r.safety.protected_share * 100)} %</b> {sport === 'bike' ? t('aménagé') : t('hors chaussée')}
                    </>
                  ) : (
                    <>
                      <b>—</b>{' '}{t('non évalué')}</>
                  )}
                </span>
              </span>
            </button>
          )
        })}
        <span className="cards__pad" aria-hidden="true" />
      </div>
      {routes.length > 1 && (
        <div className="cards__dots" aria-hidden="true">
          {routes.map((r) => (
            <i key={r.id} className={r.id === selected?.id ? 'on' : ''} />
          ))}
        </div>
      )}
    </div>
  )
}

/** « 58 min », « 1 h 12 » : une durée estimée n'a pas de secondes à afficher. */
/**
 * Le relief d'une proposition en miniature, comme sur les cartes de Komoot :
 * on compare les boucles d'un coup d'œil, sans ouvrir le détail. L'échelle
 * verticale vaut au moins 40 m, sans quoi une boucle plate aux 3 m de bosses
 * se dessinerait en montagnes russes.
 */
export function Spark({ points }) {
  if (!points || points.length < 2) return null
  const W = 72
  const H = 22
  // Une quarantaine de points suffisent à 72 px de large.
  const step = Math.max(1, Math.floor(points.length / 40))
  const ele = points.filter((_, i) => i % step === 0).map((p) => p.ele_m)
  const low = Math.min(...ele)
  const span = Math.max(40, Math.max(...ele) - low)
  const xy = ele.map((e, i) => `${((i / (ele.length - 1)) * W).toFixed(1)},${(H - 1 - ((e - low) / span) * (H - 2)).toFixed(1)}`)
  return (
    <svg className="rcard__spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path className="rcard__spark-fill" d={`M0,${H} L${xy.join(' L')} L${W},${H}Z`} />
      <path className="rcard__spark-line" d={`M${xy.join(' L')}`} />
    </svg>
  )
}

function minutes(seconds) {
  const m = Math.round((seconds || 0) / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/**
 * Le vent, quand il compte.
 *
 * Il n'apparaît que s'il dépasse le seuil où on le sent en courant : afficher
 * « vent 4 km/h » n'apprendrait rien et donnerait à croire que le classement en
 * dépend. Le cap annoncé est celui d'où le vent vient — c'est la convention de
 * tout le monde, et l'inverse de celui que le moteur manipule.
 */
function Facts({ back, weather, wind }) {
  if (!back && !weather && !wind) return null
  const from = wind && CARDINALS[Math.round(((wind.bearing + 180) % 360) / 45) % 8]
  return (
    <>
      <ul className="facts" aria-label={t('Avant de partir')}>
        {back && (
          <li>
            <Icon name="clock" size={14} />{t('Retour vers {back}', { back })}</li>
        )}
        {weather && (
          <li className={weather.advice ? 'facts--warn' : undefined}>
            <Icon name={weather.icon} size={14} />
            {weather.short}
          </li>
        )}
        {wind && (
          // Le classement en tient compte : à qualité égale, l'arrivée vent dans le dos passe devant.
          <li title={t('À qualité égale, les boucles qui finissent vent dans le dos passent devant.')}>
            <Icon name="compass" size={14} />{t('Vent {v1} · {v2} {v3}', { v1: /^[aeiou]/.test(from) ? `d’${from}` : t('de {from}', { from }), v2: Math.round(speedIn(wind.speed_kmh)), v3: speedLabel() })}</li>
        )}
      </ul>
      {weather?.advice && <p className="facts__advice small">{weather.text}</p>}
    </>
  )
}

/**
 * La feuille de route : chaque consigne, à son kilomètre. On la lit avant de
 * partir — repérer le virage qui piège, la rue qu'on ne connaît pas — et un
 * toucher montre l'endroit sur la carte (`App` replie la feuille pour ça).
 * Repliée : la voix la dira en courant.
 */
function RouteSteps({ steps, onShow }) {
  return (
    <details className="steps">
      <summary>{t('Feuille de route · {length} consignes', { length: steps.length })}<Icon name="chevronDown" size={16} />
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <button
              onClick={() => s.lon != null && onShow?.([s.lon, s.lat])}
              aria-label={t('{text}, à {v2} {v3} — montrer sur la carte', { text: stepText(s.text), v2: km(s.dist_m, 1), v3: unitLabel() })}
            >
              <Icon name={turnIcon(s.turn)} size={17} />
              <em>{km(s.dist_m, 1)}</em>
              <span>{stepText(s.text)}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  )
}

