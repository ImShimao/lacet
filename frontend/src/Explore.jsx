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
import { StopsList } from './Stops.jsx'
import { TERRAINS } from './FiltersSheet.jsx'
import { downloadGpx } from './api'
import { reliefMismatch, surfaceMismatch } from './explain'
import { km } from './format'

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
  onRegenerate,
  onReverse,
  reversing = false,
  onOpenFilters,
  onFavorite,
  onStart,
  onFreeRun,
  onOpenSaved,
  onScrub,
  onOpenDetail,
  stops = { stops: [], loading: false, complete: true },
  poiPrefs = null,
}) {
  const [exporting, setExporting] = useState(false)
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
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel">
        <div className="notice">{error.message}</div>
        {error.offline ? (
          <button className="btn btn--primary" onClick={onOpenSaved}>
            <Icon name="routes" size={17} />
            Voir mes parcours enregistrés
          </button>
        ) : (
          <button className="btn btn--primary" onClick={onSearch}>
            Réessayer
          </button>
        )}
      </div>
    )
  }

  if (!result) {
    return (
      <div className="panel">
        <div className="origin">
          <span className="origin__pin">
            <Icon name="pin" size={18} />
          </span>
          <div>
            <b>{startLabel || (start ? 'Point choisi' : 'Localisation…')}</b>
            <em>
              {geo.accuracy && geo.status === 'ready'
                ? `précision ± ${Math.round(geo.accuracy)} m`
                : 'départ de la boucle'}
            </em>
          </div>
        </div>
        <button className="btn btn--primary btn--big" onClick={onSearch} disabled={!start}>
          <Icon name="search" size={18} />
          Trouver ma boucle
        </button>
        {/* Côte à côte : deux gestes secondaires empilés sous le principal
            prenaient autant de place que lui, et le noyaient. */}
        <div className="row">
          <button className="btn" onClick={onOpenFilters}>
            <Icon name="sliders" size={17} />
            Filtres
          </button>
          <button className="btn btn--ghost" onClick={onFreeRun}>
            <Icon name="play" size={17} />
            Courir libre
          </button>
        </div>
        {/* Les rues se préparent en fond dès que le départ est connu : le dire
            explique pourquoi la recherche est soudain instantanée — et qu'elle
            le restera, même sans réseau. */}
        {streetsReady ? (
          <p className="ready small">
            <Icon name="check" size={14} />
            Rues du coin prêtes : la recherche sera presque instantanée.
          </p>
        ) : (
          streetsLoading && (
            <p className="ready ready--busy small">
              <Icon name="download" size={14} />
              Préparation des rues de ce coin…
            </p>
          )
        )}
        <p className="muted small">
          Fais glisser le repère, touche la carte en mode placement, ou cherche une
          adresse pour changer de départ.
        </p>
      </div>
    )
  }

  const { routes, rejected, meta } = result

  if (!routes.length) {
    return (
      <div className="panel">
        <div className="notice">{meta.message}</div>
        {rejected?.length > 0 && <RejectedList rejected={rejected} />}
        <button className="btn btn--primary" onClick={onOpenFilters}>
          Modifier les filtres
        </button>
        <button className="btn btn--ghost" onClick={onFreeRun}>
          <Icon name="play" size={17} />
          Courir sans itinéraire
        </button>
      </div>
    )
  }

  const terrain = TERRAINS[params.sport].find((t) => t.key === params.surface)
  const relief = reliefMismatch(params.elevation, routes)
  const ground = surfaceMismatch(params.surface, routes)

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
      <RouteCards
        known={known}
        routes={routes}
        selected={selected}
        onSelect={onSelect}
        onOpenDetail={onOpenDetail}
        sport={params.sport}
      />

      {/* Les avertissements viennent après les cartes : ils nuancent une
          proposition, ils ne doivent pas la pousser sous le pli. */}
      {/* Et un tracé venu du calculateur public le dit d'emblée : son absence
          de note ne se lisait que dans le détail replié, et l'on pouvait partir
          sans savoir que rien n'avait été jugé. */}
      {/* De même quand la direction demandée n'a rien donné : les boucles
          montrées partent d'ailleurs, et il faut le savoir avant d'y aller. */}
      {(meta.relaxed || meta.remote || meta.heading_missed) && (
        <div className="notice notice--warn">{meta.message}</div>
      )}
      {/* Une bordure de la zone n'est pas arrivée à temps — la carte livrée
          s'arrête à la limite de la région, et Overpass tardait. Plutôt que de
          faire attendre devant une barre figée, on a cherché avec le reste ; le
          dire évite de croire que le coin n'a rien de mieux à offrir. */}
      {meta.partial && (
        <div className="notice">
          Le bord de la zone n'est pas encore arrivé : ces boucles sont tracées sur les rues
          déjà là. Relance la recherche dans un instant pour en profiter.
        </div>
      )}
      {/* Sans altitude, le dénivelé n'est pas seulement absent de l'affichage :
          il n'a pas pu servir au classement. Demander « des côtes » et recevoir
          cinq boucles plates sans un mot serait incompréhensible. */}
      {meta.elevation_skipped && (
        <div className="notice">
          Le relief n'a pas répondu à temps : ces boucles sont classées sans lui, et leur
          dénivelé reste inconnu. Relance la recherche — les altitudes arrivées entre-temps
          sont gardées.
        </div>
      )}
      {/* Le relief, lui, a répondu — mais le coin n'a pas celui qu'on demande.
          Le dire, plutôt que de laisser croire que ces boucles sont des côtes. */}
      {relief && (
        <div className="notice">
          {relief.kind === 'hilly'
            ? `Pas de côtes à portée d'ici : la plus vallonnée ne monte que de ${relief.ascent} m. Pars plus près du relief pour en trouver.`
            : `Pas de boucle plate d'ici : la plus douce monte déjà de ${relief.ascent} m.`}
        </div>
      )}
      {/* Le même aveu pour le terrain : ces boucles passent devant parce
          qu'elles s'en approchent le plus, pas parce qu'elles le tiennent. */}
      {ground && (
        <div className="notice">
          {ground.kind === 'trail'
            ? `Peu de chemins à portée d'ici : la boucle la plus nature n'en compte que ${ground.share} %.`
            : `Pas de boucle toute goudronnée d'ici : la plus roulante a encore ${ground.share} % de chemins.`}
        </div>
      )}
      {/* Le repère a rejoint la rue, et de loin : le dire évite de chercher
          pourquoi il a bougé. Sous cinquante mètres, rien — ça ne se voit pas.
          Dans le détail seulement : sur la carte repliée, ces trois lignes
          prenaient la place du tracé, à chaque recherche depuis une adresse. */}
      {snapped && (
        <div className="notice notice--detail">
          Le départ s'est posé sur la rue, à {snapped} m du point demandé :
          c'est de là que la boucle part, et c'est là qu'elle revient.
        </div>
      )}
      {known.has(selected.id) && <AlreadyRun found={known.get(selected.id)} />}
      {meta.wind && <WindNote wind={meta.wind} />}

      {selected.laps > 1 && (
        <div className="laps">
          <Icon name="refresh" size={15} />
          <span>
            {selected.figure_eight ? (
              <>
                Deux boucles différentes, de <b>{km(selected.lap_distances_m[0], 2)}</b> puis{' '}
                <b>{km(selected.lap_distances_m[1], 2)} km</b>, enchaînées au départ
              </>
            ) : (
              <>
                Un tour de <b>{km(selected.lap_distance_m, 2)} km</b>, à parcourir{' '}
                <b>{selected.laps} fois</b>
              </>
            )}
            {/* Ne l'affirmer que quand c'est vrai : la liste peut mêler des
                boucles entières et des parcours à tours, et prétendre alors
                qu'aucune boucle entière n'existe serait démenti par la
                proposition d'à côté. */}
            {routes.some((r) => r.laps === 1)
              ? '.'
              : " — aucune boucle entière de cette longueur ne tient le contrôle par ici."}
          </span>
        </div>
      )}

      <div className="route-meta">
        {terrain?.label} · {surfaceShare(selected)}
      </div>

      <RouteStrip route={selected} onScrub={onScrub} />

      <StopsList {...stops} prefs={poiPrefs} distance={selected.distance_m} />

      <button className="disclose" onClick={onToggleDetail} aria-expanded={detail}>
        {detail ? 'Masquer le détail' : 'Voir le détail de la note'}
        <Icon name={detail ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>

      {detail && (
        <>
          {selected.safety ? (
            <SafetyPanel
              safety={selected.safety}
              surfaces={selected.surfaces}
              segments={selected.segments}
              distance={selected.distance_m}
              sport={params.sport}
            />
          ) : (
            // Pas de note : le détail n'existe pas, et un panneau vide
            // laisserait croire à une évaluation réussie. Deux raisons
            // possibles, et elles n'appellent pas le même geste — réessayer
            // plus tard, ou accepter que ce tracé-là ne sera jamais noté.
            <div className="notice">
              {selected.imported
                ? "Ce parcours vient d'un fichier, et ses points ne suivent aucune rue connue d'ici — un chemin absent de la carte, ou des rues pas encore téléchargées. Lacet ne peut donc juger ni trottoirs, ni vitesses, ni traversées, et ne dicte pas les virages. Il le suit, le mesure et prévient si tu t'en écartes."
                : "Ce tracé vient d'un calculateur d'itinéraires public, faute d'avoir les rues de ce coin : Lacet n'a pas pu juger ce qu'il longe — ni trottoirs, ni vitesses, ni traversées. Reste attentif, et relance la recherche plus tard pour une vraie note."}
            </div>
          )}
          {rejected?.length > 0 && <RejectedList rejected={rejected} />}
          <p className="disclaimer">
            Les itinéraires privilégient les voies protégées d'après OpenStreetMap. Les
            données peuvent être incomplètes ou dépassées : reste attentif sur le terrain.
          </p>
        </>
      )}

      <button className="linkish" onClick={onFreeRun}>
        ou courir librement, sans suivre de tracé
      </button>

      {/* Collée au bas du panneau : « Démarrer » reste à portée de pouce quel
          que soit l'endroit où l'on a fait défiler le détail. Elle était tout en
          bas, sous la note, et il fallait la chercher. */}
      <div className="actionbar">
        <button
          className={`btn btn--icon ${isFavorite ? 'btn--on' : ''}`}
          onClick={onFavorite}
          title={isFavorite ? 'Retirer des favoris' : 'Enregistrer en favori'}
          aria-label={isFavorite ? 'Retirer des favoris' : 'Enregistrer en favori'}
          aria-pressed={isFavorite}
        >
          {isFavorite ? <SolidIcon name="heart" size={19} /> : <Icon name="heart" size={19} />}
        </button>
        <button
          className="btn btn--icon"
          onClick={exportGpx}
          disabled={exporting}
          title="Exporter en GPX"
          aria-label="Exporter en GPX"
        >
          <Icon name="download" size={19} />
        </button>
        {/* Le sens n'est pas décoratif : il décide des côtes qu'on prend en
            montant, du vent qu'on a dans le dos à la fin, et de chaque consigne
            de virage. La même boucle à l'envers est une autre sortie. */}
        {onReverse && (
          <button
            className={`btn btn--icon ${selected.reversed ? 'btn--on' : ''}`}
            onClick={onReverse}
            disabled={reversing}
            aria-pressed={Boolean(selected.reversed)}
            title={selected.reversed ? "Revenir au sens d'origine" : "Parcourir dans l'autre sens"}
            aria-label={selected.reversed ? "Revenir au sens d'origine" : "Parcourir dans l'autre sens"}
          >
            <Icon name="uturn" size={19} />
          </button>
        )}
        <button
          className="btn btn--icon"
          onClick={onRegenerate ?? onSearch}
          title="Régénérer d'autres boucles"
          aria-label="Régénérer d'autres boucles"
        >
          <Icon name="refresh" size={19} />
        </button>
        <button className="btn btn--primary" onClick={onStart}>
          <Icon name="play" size={17} />
          Démarrer
        </button>
      </div>
    </div>
  )
}

const STAGES = {
  data: 'Téléchargement des rues',
  graph: 'Construction du réseau de voies',
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
  const fraction = stage === 'data' ? (progress?.fraction ?? 0) : null
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
        <span>{STAGES[stage] ?? 'Calcul en cours'}…</span>
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
        {long && stage === 'data'
          ? // Les archives couvrent la France et ses voisins ; ailleurs, il faut
            // interroger OpenStreetMap en direct, et c'est là que ça traîne.
            "Ce coin n'est pas dans les archives : Lacet interroge OpenStreetMap en direct, et ses serveurs sont lents en ce moment. Ça aboutit en général en moins d'une minute."
          : stage === 'data'
            ? "Les rues sont gardées sur l'appareil : la prochaine recherche ici sera immédiate, même hors ligne."
            : stage === 'elevation'
              ? // La seule étape qui attend encore quelqu'un d'autre : autant le
                // dire, plutôt que de promettre un calcul sans serveur.
                "Les altitudes viennent de l'IGN, en un seul envoi — et sont gardées pour les prochaines boucles du coin."
              : 'Le calcul se fait sur ton appareil, sans serveur.'}
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
  const quand = new Date(run.ranAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const temps = run.actual_duration_s ? minutes(run.actual_duration_s) : null
  return (
    <div className="notice">
      Déjà couru le {quand}
      {temps ? ` en ${temps}` : ''}
      {share < 0.95 ? ` — à ${Math.round(share * 100)} % le même chemin.` : '.'}
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
      if (route) onSelect(route)
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
                    ? `${km(r.lap_distances_m[0], 1)} + ${km(r.lap_distances_m[1], 1)} km`
                    : r.laps > 1
                      ? `${km(r.lap_distance_m, 1)} km × ${r.laps}`
                      : r.direction}
                </span>
                {/* Sans analyse — un tracé de secours —, pas de note : un tiret
                    dit « on ne sait pas », là où un « A » mentirait. */}
                {r.safety ? (
                  <span className={`grade grade--${r.safety.grade}`}>{r.safety.grade}</span>
                ) : (
                  <span className="grade grade--unknown" title="Sécurité non évaluée">
                    —
                  </span>
                )}
                {/* Ce chemin-là, on l'a déjà fait : c'est parfois ce qu'on
                    cherche — se comparer — et parfois ce qu'on fuit. Dans les
                    deux cas, il vaut mieux le savoir avant de partir. */}
                {known?.has(r.id) && !on && (
                  <span className="rcard__seen" title="Déjà couru">
                    <Icon name="refresh" size={13} />
                  </span>
                )}
                {on && (
                  <span className="rcard__more">
                    Détails
                    <Icon name="chevronUp" size={14} />
                  </span>
                )}
              </span>
              <span className="rcard__km">
                <b>{km(r.distance_m, 1)}</b> km
              </span>
              <span className="rcard__name">{r.name}</span>
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
                      <b>{Math.round(r.safety.protected_share * 100)} %</b> {sport === 'bike' ? 'aménagé' : 'hors chaussée'}
                    </>
                  ) : (
                    <>
                      <b>—</b> non évalué
                    </>
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
function WindNote({ wind }) {
  const from = CARDINALS[Math.round(((wind.bearing + 180) % 360) / 45) % 8]
  return (
    <div className="windnote">
      <Icon name="compass" size={16} />
      <span>
        Vent de {from}, {Math.round(wind.speed_kmh)} km/h — à qualité égale, les boucles
        qui finissent vent dans le dos sont proposées en premier.
      </span>
    </div>
  )
}

function RejectedList({ rejected }) {
  return (
    <div className="rejected">
      <span className="rejected__title">
        {rejected.length} écarté{rejected.length > 1 ? 's' : ''} par le contrôle
      </span>
      {rejected.map((r, i) => (
        <div key={i} className="rejected__row">
          <span className="mono">{km(r.distance_m, 1)} km</span>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

function surfaceShare(route) {
  const total = route.distance_m || 1
  const parts = [
    ['route', route.surfaces.paved_m],
    ['chemin', route.surfaces.gravel_m],
    ['sentier', route.surfaces.trail_m],
  ]
    .filter(([, m]) => m / total > 0.05)
    .map(([label, m]) => `${Math.round((m / total) * 100)} % ${label}`)
  return parts.join(' · ') || '—'
}
