/**
 * Mes parcours : les sorties déjà faites et les favoris.
 *
 * Séparé d'`App.jsx` parce que rien d'autre ne s'en sert : le bilan des
 * sorties, le calcul d'allure et la commande de carte hors ligne ne parlent
 * qu'à cet écran. Les garder au milieu du reste obligeait à traverser le
 * classement des itinéraires pour trouver le bouton qui télécharge une carte.
 */

import { useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { duration, km, pace } from './format'
import { offlineStyleFor } from './mapStyles'
import * as offline from './offlineMaps'
import { sketch } from './routeDraw'
import { RenameField } from './RunDetail.jsx'
import MonthReport from './MonthReport.jsx'
import Challenges from './Challenges.jsx'
import { dailyMetres, monthKey, monthLabel } from './monthSummary'
import { paceLabel, speedIn, speedLabel, unitLabel } from './units'

import { t, locale, dec } from './i18n'
import { routeName } from './stepText'
export default function Library({ saved, history, initialView, onOpen, onOpenRun, onImport, importProgress, onExplore, onRename, onForget, profile, mapStyle }) {
  // S'ouvrir sur ce qui existe : un premier favori gardé avant toute sortie
  // tombait sinon sur « Aucune sortie enregistrée », et semblait perdu. Un avis
  // qui y mène (« 40 favoris, c'est le plafond ») ouvre là où il le dit.
  const [view, setView] = useState(
    () => initialView ?? (history.length === 0 && saved.length > 0 ? 'saved' : 'history'),
  )
  // Les filtres de l'historique : quelle activité, quel mois. Les totaux
  // suivent — « combien ai-je couru en août » est la question qu'on se pose.
  const [sport, setSport] = useState('all')
  const [month, setMonth] = useState('all')
  // Le bilan d'un mois, ouvert depuis son en-tête : le mois, ou rien.
  const [report, setReport] = useState(null)
  const months = useMemo(() => [...new Set(history.map((r) => monthKey(r.ranAt)).filter(Boolean))], [history])
  const shown = history.filter(
    (r) => (sport === 'all' || (r.sport || 'run') === sport) && (month === 'all' || monthKey(r.ranAt) === month),
  )
  const all = view === 'history' ? shown : saved
  // Soixante lignes d'abord : l'historique en garde jusqu'à mille, et chacune
  // dessine sa vignette et interroge sa carte hors ligne. La suite vient au
  // bouton, en bas de liste.
  const [limit, setLimit] = useState(PAGE)
  const rows = all.slice(0, limit)
  // Comptés une fois pour toute la liste, et non refaits à chaque ligne : les
  // parcours qui partagent une carte hors ligne (`keyOf`), et les sorties de
  // chaque mois. Refaits ligne par ligne, mille sorties coûtaient un million de
  // comparaisons à chaque rendu.
  const shared = useMemo(() => {
    const counts = new Map()
    for (const r of [...saved, ...history]) counts.set(offline.keyOf(r), (counts.get(offline.keyOf(r)) ?? 0) + 1)
    return counts
  }, [saved, history])
  const byMonth = useMemo(() => {
    const groups = new Map()
    for (const r of shown) groups.set(monthKey(r.ranAt), [...(groups.get(monthKey(r.ranAt)) ?? []), r])
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, sport, month])

  if (report) {
    return (
      <MonthReport
        history={history.filter((r) => sport === 'all' || (r.sport || 'run') === sport)}
        month={report}
        onClose={() => setReport(null)}
      />
    )
  }

  return (
    <div className="panel">
      <div className="seg">
        <button aria-pressed={view === 'history'} onClick={() => setView('history')}>
          {/* « (0) » sur un compte vide n'apprend rien : le compte vient avec la première. */}{t('Sorties{v1}', { v1: history.length > 0 && ` (${history.length})` })}</button>
        <button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>{t('Favoris{v1}', { v1: saved.length > 0 && ` (${saved.length})` })}</button>
      </div>

      {/* Le bilan, la semaine et les défis côte à côte, au pouce : empilés, ils
          poussaient la liste des sorties — ce qu'on vient chercher — sous le pli. */}
      {view === 'history' && shown.length > 0 && (
        <div className="statstrip" aria-label={t('Bilan')}>
          <div className="statstrip__card">
            <Totals history={shown} profile={profile} />
          </div>
          <div className="statstrip__card">
            <WeeklyVolume history={history.filter((r) => sport === 'all' || (r.sport || 'run') === sport)} goalKm={profile?.weekly_km} />
          </div>
          {/* Les séries suivent le filtre d'activité ; le défi du mois, son sport — la course, si « Tout ». */}
          <div className="statstrip__card">
            <Challenges history={history.filter((r) => sport === 'all' || (r.sport || 'run') === sport)} sport={sport === 'bike' ? 'bike' : 'run'} />
          </div>
        </div>
      )}

      {view === 'saved' && onImport && <ImportRow onImport={onImport} progress={importProgress} />}

      {view === 'history' && history.length > 0 && (
        <div className="histfilter">
          <div className="chips" role="radiogroup" aria-label={t('Activité')}>
            {/* Sans icône : à 390 px, elles prenaient la place du nom du mois, à côté. */}
            {[
              ['all', t('Tout')],
              ['run', t('Course')],
              ['bike', t('Vélo')],
            ].map(([key, label]) => (
              <button key={key} role="radio" aria-checked={sport === key} className={`chip ${sport === key ? 'chip--on' : ''}`} onClick={() => setSport(key)}>
                {label}
              </button>
            ))}
          </div>
          <select className="histfilter__month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t('Mois')}>
            <option value="all">{t('Tous les mois')}</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name={view === 'history' ? 'routes' : 'heart'} size={22} />
          </span>
          {/* Un titre court, puis une ligne : le bouton dessous dit déjà où aller. */}
          {view === 'history' && history.length ? (
            <p>{t('Aucune sortie pour ce filtre.')}</p>
          ) : view === 'history' ? (
            <>
              <b>{t('Pas encore de sortie')}</b>
              <p>{t('Chaque sortie s\'enregistre ici, avec son temps et sa trace.')}</p>
            </>
          ) : (
            <>
              <b>{t('Aucun favori')}</b>
              <p>{t('Le cœur, sous une proposition, la garde ici.')}</p>
            </>
          )}
          {/* Un écran vide qui dit « va ailleurs » sans y mener laisse chercher
              l'onglet du regard : le bouton y emmène. Pas pour un filtre qui ne
              rend rien — il y a déjà des sorties, et l'on veut changer de filtre. */}
          {onExplore && !(view === 'history' && history.length) && (
            <button className="btn btn--primary" onClick={onExplore}>
              <Icon name="search" size={17} />{t('Trouver une boucle')}</button>
          )}
        </div>
      ) : (
        <>
          {/* Deux lignes, pas six : l'explication complète repoussait la liste
              sous le pli à chaque ouverture de l'onglet. */}
          <p className="muted small">{t('Ouverts sans réseau ; l\'icône à droite garde aussi')}{' '}<b>{t('le fond de carte')}</b>{' '}{t('(1 à 15 Mo).')}</p>
          <div className="list">
            {rows.map((r, i) => (
              // Une clé qui suit la ligne, pas sa place : retirer une ligne
              // faisait sinon hériter la suivante de sa confirmation ouverte.
              <div key={r.ranAt || offline.keyOf(r)} className="list__group">
              {view === 'history' && monthKey(r.ranAt) !== monthKey(rows[i - 1]?.ranAt) && (
                <MonthHeader
                  label={monthLabel(monthKey(r.ranAt))}
                  month={monthKey(r.ranAt)}
                  runs={byMonth.get(monthKey(r.ranAt)) ?? []}
                  onReport={monthKey(r.ranAt) ? () => setReport(monthKey(r.ranAt)) : null}
                />
              )}
              <Item
                route={r}
                run={view === 'history'}
                shared={shared.get(offline.keyOf(r)) > 1}
                mapStyle={mapStyle}
                // Une sortie ouvre son bilan — ce qu'on a fait —, un favori
                // ouvre le parcours sur la carte. Longtemps les deux menaient
                // au même écran, qui montrait le plan : relire une sortie
                // passée y était impossible.
                onOpen={() => (view === 'history' ? onOpenRun(r) : onOpen(r))}
                onRename={onRename}
                onForget={onForget}
              />
              </div>
            ))}
          </div>
          {all.length > rows.length && (
            <button className="btn" onClick={() => setLimit(limit + PAGE)}>{t('Afficher les suivantes ({v1})', { v1: all.length - rows.length })}</button>
          )}
        </>
      )}
    </div>
  )
}

const PAGE = 60

/**
 * Une ligne de la liste, qu'on glisse vers la gauche pour la renommer ou la
 * retirer.
 *
 * Un favori gardait à vie son nom automatique, et le retirer demandait de
 * l'ouvrir sur la carte pour décocher son cœur. Le geste est celui de Mail ou
 * de Rappels, et c'est le **défilement natif** qui le fait : la ligne est un
 * ruban plus large qu'elle, aimanté sur ses deux bords (`scroll-snap`). L'élan,
 * le seuil et le retour en place sont ceux d'iOS, sans une ligne pour les
 * imiter, et les deux boutons sont de vrais boutons, que VoiceOver et le
 * clavier atteignent sans glisser.
 *
 * Une sortie reçoit le même geste : la supprimer obligeait à ouvrir son bilan
 * et à descendre jusqu'en bas.
 */
function Item({ route, run, shared: partagee, mapStyle, onOpen, onRename, onForget }) {
  const [naming, setNaming] = useState(false)
  const [asking, setAsking] = useState(false)
  const ruban = useRef(null)
  // `scrollTo` manque à certains environnements (jsdom) : la ligne reste
  // alors ouverte, sans casser le geste suivant.
  const refermer = () => ruban.current?.scrollTo?.({ left: 0, behavior: 'smooth' })
  // La carte hors ligne suit la clé du parcours (`keyOf`) : un favori et les
  // sorties faites dessus la partagent. Elle ne part qu'avec la dernière
  // ligne qui la montre (`shared`, compté une fois dans `Library`).

  if (asking) {
    return (
      <Forget
        route={route}
        run={run}
        shared={partagee}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          const carte = offline.isStored(route) && !partagee
          onForget(route)
          if (carte) offline.remove(route).catch(() => {})
        }}
      />
    )
  }

  const contenu = (
    <>
      <Thumb line={run ? route.track : route.geometry} sport={run ? route.sport : null} />
      <span>
        {naming ? (
          <RenameField
            name={routeName(route.name)}
            label={run ? t('Nom de la sortie') : t('Nom du favori')}
            autoFocus
            onRename={(nom) => onRename(route, nom)}
            onDone={() => setNaming(false)}
          />
        ) : (
          routeName(route.name)
        )}
        <em>
          {run
            ? `${dayLabel(route.ranAt)} · ${km(route.actual_distance_m)} ${unitLabel()} · ${duration(route.actual_duration_s)} · ${paceOf(route)}${paceLabel()}`
            : `${km(route.distance_m)} ${unitLabel()} · D+ ${Math.round(route.ascent_m || 0)} m`}
        </em>
      </span>
      {route.grade ? (
        <span className={`grade grade--${route.grade}`}>{route.grade}</span>
      ) : (
        <span className="grade grade--free">{t('libre')}</span>
      )}
    </>
  )

  return (
    <div className="list__item" ref={ruban}>
      <div className="list__main">
        {/* Le champ ne peut pas vivre dans un bouton : un toucher pour placer
            le curseur ouvrirait le parcours. */}
        {naming ? (
          <div className="list__row list__row--naming">{contenu}</div>
        ) : (
          // Ouverte, la ligne se referme au toucher au lieu de s'ouvrir : on
          // touche à côté des boutons, pas pour partir ailleurs.
          <button className="list__row" onClick={() => (ruban.current?.scrollLeft > 4 ? refermer() : onOpen())}>
            {contenu}
          </button>
        )}
        <OfflineControl route={route} mapStyle={mapStyle} />
      </div>
      {onRename && onForget && (
        <div className="list__acts">
          <button
            className="list__act"
            onClick={() => {
              refermer()
              setNaming(true)
            }}
          >{t('Renommer')}</button>
          <button
            className="list__act list__act--warn"
            onClick={() => {
              refermer()
              setAsking(true)
            }}
          >
            {run ? t('Supprimer') : t('Retirer')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Le retrait, confirmé : un favori retiré ne se retrouve qu'en refaisant la
 * recherche qui l'avait trouvé, une sortie supprimée plus du tout.
 *
 * La carte hors ligne y est nommée. Partie sans un mot, elle manquerait le jour
 * où l'on n'a plus de réseau pour la reprendre ; restée sans un mot, elle
 * occuperait des mégaoctets qu'aucune ligne ne permet plus de libérer.
 */
function Forget({ route, run, shared, onCancel, onConfirm }) {
  const stored = offline.isStored(route)
  return (
    <div className="list__confirm" role="group" aria-label={run ? t('Supprimer la sortie') : t('Retirer le favori')}>
      <p>
        {run ? (
          <>{t('Supprimer')}{' '}<b>{routeName(route.name)}</b>{t(', la sortie du {v1} ? Ses kilomètres quittent les totaux.', { v1: dayLabel(route.ranAt) })}</>
        ) : (
          <>{t('Retirer')}{' '}<b>{routeName(route.name)}</b>{' '}{t('des favoris ?')}</>
        )}
        {stored &&
          (shared
            ? t(' Sa carte hors ligne reste : une autre ligne de Mes parcours la montre.')
            : t(' Sa carte hors ligne ({v1}) part avec.', { v1: offline.formatBytes(offline.storedBytes(route)) }))}
      </p>
      <div className="row">
        <button className="btn" onClick={onCancel}>{t('Annuler')}</button>
        <button className="btn btn--primary" onClick={onConfirm}>
          {run ? t('Supprimer') : t('Retirer')}
        </button>
      </div>
    </div>
  )
}

/**
 * Faire entrer le parcours d'un autre.
 *
 * La trace d'un ami, une course balisée, un tracé dessiné ailleurs. Ce qui
 * entre est **un tracé, rien de plus** : le fichier ne dit pas les rues, donc
 * les rues qu'il emprunte. Lacet les reconnaît (voir `engine/matcher.js`) et le
 * parcours devient alors comparable à une boucle calculée ici. Quand la
 * reconnaissance échoue — un chemin absent du réseau, un fichier de bateau —,
 * le tracé est gardé tel quel et l'app dit qu'elle n'a rien pu juger.
 */
function ImportRow({ onImport, progress = null }) {
  const [erreur, setErreur] = useState(null)
  // Pendant l'import : le nom et le dessin du fichier, dès qu'il est lu.
  const [enCours, setEnCours] = useState(null)
  const champ = useRef(null)

  const choisir = async (event) => {
    const fichier = event.target.files?.[0]
    // Le champ garde son fichier : sans ça, réimporter le même après une
    // correction ne déclencherait rien.
    event.target.value = ''
    if (!fichier) return
    setErreur(null)
    setEnCours({ name: fichier.name.replace(/\.gpx$/i, ''), line: null })
    try {
      await onImport(fichier, (line, name) => setEnCours({ name, line }))
    } catch (err) {
      setErreur(t(err.message))
    } finally {
      setEnCours(null)
    }
  }

  if (enCours) return <ImportProgress {...enCours} progress={progress} />

  return (
    <div className="import">
      <input
        ref={champ}
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        onChange={choisir}
        hidden
      />
      <button className="btn" onClick={() => champ.current?.click()}>
        <Icon name="fileImport" size={17} />{t('Importer un GPX')}</button>
      {erreur ? (
        <p className="muted small import__error">{erreur}</p>
      ) : (
        <p className="muted small">{t('Le tracé d\'un ami ou d\'une course : Lacet le note et le guide comme les siens.')}</p>
      )}
    </div>
  )
}

/** Ce que fait l'import, étape par étape : les mêmes que la recherche, dites pour un fichier. */
const IMPORT_STAGES = {
  data: 'Lecture des rues du coin',
  download: 'Téléchargement des rues',
  graph: 'Assemblage des rues',
  elevation: 'Calcul du relief',
}

/**
 * L'attente d'un import. On reste sur cet onglet pendant que les rues se
 * reconnaissent — parfois dix secondes —, et la barre de la recherche vit dans
 * Explorer : rien ne bougeait ici, et l'app semblait avoir avalé le fichier.
 * Le tracé du fichier se dessine, puis une lueur le parcourt tant que Lacet
 * cherche les rues qu'il emprunte : on voit que c'est bien le bon fichier, et
 * qu'il se passe quelque chose.
 */
function ImportProgress({ name, line, progress }) {
  const drawn = useMemo(() => sketch(line, 64, 44, 5), [line])
  const stage = progress?.stage
  const fraction = stage === 'download' ? (progress?.fraction ?? 0) : 0
  const label = !line ? t('Lecture du fichier') : t(IMPORT_STAGES[stage] ?? 'Reconnaissance des rues')
  return (
    <div className="import import--busy" role="status" aria-label={t('Import de {name} : {label}', { name, label })}>
      <span className="import__trace" aria-hidden="true">
        {drawn ? (
          <svg viewBox="0 0 64 44" width="64" height="44">
            <path d={drawn.d} className="import__line" pathLength="1" />
            <path d={drawn.d} className="import__scan" pathLength="1" />
            <circle cx={drawn.start[0]} cy={drawn.start[1]} r="2.6" className="import__start" />
          </svg>
        ) : (
          <Icon name="fileImport" size={20} />
        )}
      </span>
      <span className="import__text">
        <b>{name}</b>
        <span>
          {label}…{fraction > 0 && ` ${Math.round(fraction * 100)} %`}
        </span>
      </span>
      <div className={`progress__bar ${fraction ? '' : 'progress__bar--busy'}`}>
        <i style={fraction ? { transform: `scaleX(${Math.max(0.04, fraction)})` } : undefined} />
      </div>
    </div>
  )
}

/**
 * Rendre la carte d'un parcours disponible hors ligne, ou la retirer.
 *
 * Le téléchargement est **explicite, parcours par parcours**. Le réflexe aurait
 * été de garder automatiquement tous les favoris : c'est justement ce qu'il ne
 * faut pas faire. Quelques mégaoctets partent à chaque fois, souvent sur des
 * données mobiles, et personne n'a demandé à remplir son téléphone avec les
 * quarante boucles gardées depuis six mois. Un geste, un parcours, une taille
 * annoncée ensuite.
 *
 * Le retrait demande une confirmation, non parce que la perte serait grave —
 * tout se retélécharge — mais parce que le moment où l'on touche cette liste
 * est souvent celui où l'on n'a plus de réseau pour la reconstituer.
 */
function OfflineControl({ route, mapStyle }) {
  // Certains fonds ne se gardent pas hors ligne (OpenStreetMap l'interdit) : on
  // garde alors le fond par défaut, et la pastille le dit.
  const style = offlineStyleFor(mapStyle)
  const [entry, setEntry] = useState(() => ({
    stored: offline.isStored(route),
    bytes: offline.storedBytes(route),
    zoom: offline.storedZoom(route),
    label: offline.storedStyleLabel(route),
  }))
  const [progress, setProgress] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [failed, setFailed] = useState(null)

  const refresh = () =>
    setEntry({
      stored: offline.isStored(route),
      bytes: offline.storedBytes(route),
      zoom: offline.storedZoom(route),
      label: offline.storedStyleLabel(route),
    })

  // Une sortie libre n'a pas de tracé : il n'y a pas de carte à délimiter. Une
  // sortie ancienne réduite à son résumé n'en a plus, mais sa carte peut être
  // restée : on la montre encore, pour pouvoir la retirer.
  if (!offline.isAvailable() || (!route.geometry?.length && !entry.stored)) return null

  async function start() {
    setFailed(null)
    setProgress(0)
    try {
      await offline.download(route, style, setProgress)
      refresh()
    } catch (e) {
      setFailed(e.message || t('Le téléchargement a échoué.'))
    } finally {
      setProgress(null)
    }
  }

  if (progress !== null) {
    return (
      <span
        className="offline offline--busy"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-label={t('Téléchargement de la carte de {name}', { name: route.name })}
      >
        <b>{Math.round(progress * 100)}%</b>
        <i style={{ transform: `scaleX(${progress})` }} />
      </span>
    )
  }

  if (entry.stored) {
    // La carte a été prise avec un fond donné ; sous un autre, elle ne servira
    // pas. Le dire vaut mieux que d'afficher une pastille verte trompeuse.
    const autreFond = entry.label && entry.label !== style.label
    return confirm ? (
      <button
        className="offline offline--warn"
        onClick={async () => {
          await offline.remove(route)
          setConfirm(false)
          refresh()
        }}
        onBlur={() => setConfirm(false)}
        title={t('Confirmer le retrait')}
      >
        <Icon name="close" size={14} />{t('Retirer ?')}</button>
    ) : (
      <button
        className={`offline offline--on ${autreFond ? 'offline--other' : ''}`}
        onClick={() => setConfirm(true)}
        title={
          autreFond
            ? t('Carte gardée pour le fond « {label} » — {v2}', { label: entry.label, v2: offline.formatBytes(entry.bytes) })
            : t('Carte disponible hors ligne — {v1}, zoom {zoom}', { v1: offline.formatBytes(entry.bytes), zoom: entry.zoom })
        }
      >
        <Icon name={autreFond ? 'layers' : 'check'} size={14} />
        {offline.formatBytes(entry.bytes)}
      </button>
    )
  }

  return (
    <button
      className={`offline ${failed ? 'offline--warn' : ''}`}
      onClick={start}
      title={failed || t('Garder le fond « {label} » hors ligne pour ce parcours', { label: style.label })}
      aria-label={t('Rendre {name} disponible hors ligne', { name: route.name })}
    >
      <Icon name={failed ? 'warning' : 'download'} size={14} />
    </button>
  )
}

// Douze semaines : trois mois de préparation, ce qui tient à l'écran d'un
// téléphone sans que les barres deviennent des traits.
const WEEKS = 12

/**
 * Le volume des douze dernières semaines.
 *
 * Les totaux disaient « 22 km au total » et « 3 sorties » : des nombres justes
 * dont on ne peut rien faire. La question qu'on se pose en ouvrant cet écran
 * est autre — **est-ce que je tiens le rythme ?** —, et elle demande une forme,
 * pas un chiffre : douze barres se lisent d'un coup d'œil, et le creux de la
 * semaine où l'on était malade se voit sans être écrit.
 *
 * Une seule teinte, celle de l'app. La semaine en cours est distinguée par son
 * libellé et sa valeur affichée, jamais par une couleur à elle : une barre
 * d'une autre couleur se lirait comme une autre catégorie, et personne ne
 * devinerait laquelle.
 */
function WeeklyVolume({ history, goalKm = 0 }) {
  const semaines = useMemo(() => lastWeeks(history, WEEKS), [history])
  const goal = goalKm > 0 ? goalKm * 1000 : 0
  // L'échelle englobe l'objectif : sinon, les semaines toutes en dessous, le trait sortirait du cadre.
  const haut = Math.max(...semaines.map((s) => s.metres), goal, 1)
  if (!semaines.some((s) => s.metres > 0)) return null

  const total = semaines.reduce((m, s) => m + s.metres, 0)
  const moyenne = total / WEEKS

  return (
    <figure className="weeks">
      <figcaption className="weeks__head">
        {/* Court des deux côtés : à 390 px, « Douze dernières semaines » et
            « par semaine en moyenne » se repliaient chacun sur deux lignes. La
            période est déjà dite par l'axe, juste en dessous. */}
        <span className="label">{t('Volume par semaine')}</span>
        <em>{t('{v1} {v2} en moyenne{v3}', { v1: km(moyenne, 0), v2: unitLabel(), v3: goal > 0 && t(' · objectif {goalKm}', { goalKm }) })}</em>
      </figcaption>

      {/* Douze dates sous douze barres ne tiennent pas dans la largeur d'un
          téléphone : elles se chevauchaient. Les deux bornes suffisent à situer
          la période, et chaque barre garde sa valeur au survol et dans le
          tableau ci-dessous. */}
      <div className="weeks__plot" aria-hidden="true">
        {semaines.map((s, i) => (
          <div className="weeks__col" key={s.key} title={`${s.label} : ${km(s.metres, 1)} ${unitLabel()}`}>
            <i
              style={{ height: `${s.metres ? Math.max(3, (s.metres / haut) * 100) : 0}%` }}
              data-now={i === semaines.length - 1 || undefined}
            />
          </div>
        ))}
        {goal > 0 && <b className="weeks__goal" style={{ bottom: `${(goal / haut) * 100}%` }} />}
      </div>
      <div className="weeks__axis" aria-hidden="true">
        <span>{semaines[0].short}</span>
        <span>{t('cette semaine')}</span>
      </div>

      {/* Ce que le dessin montre, écrit : c'est la seule version lisible par
          une synthèse vocale, et la seule consultable sans souris. */}
      <table className="visually-hidden">
        <caption>{t('Distance par semaine, les douze dernières{v1}', { v1: goal > 0 && t(', pour un objectif de {goalKm} km', { goalKm }) })}</caption>
        <tbody>
          {semaines.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{km(s.metres, 1)} {unitLabel()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Le lundi de la semaine d'une date, à minuit. */
function monday(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  // `getDay()` rend 0 le dimanche : en France la semaine commence le lundi.
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

/** Les `n` dernières semaines, la plus ancienne d'abord, avec leur distance. */
function lastWeeks(history, n, now = new Date()) {
  const debut = monday(now)
  const seaux = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const lundi = new Date(debut)
    lundi.setDate(lundi.getDate() - i * 7)
    seaux.push({
      key: lundi.toISOString().slice(0, 10),
      from: lundi.getTime(),
      to: lundi.getTime() + 7 * 864e5,
      label: t('Semaine du {v1}', { v1: lundi.toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) }),
      short: lundi.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }).replace('.', ''),
      metres: 0,
    })
  }
  for (const sortie of history || []) {
    const t = new Date(sortie.ranAt).getTime()
    if (Number.isNaN(t)) continue
    const seau = seaux.find((s) => t >= s.from && t < s.to)
    if (seau) seau.metres += sortie.actual_distance_m || 0
  }
  return seaux
}

/**
 * Bilan des sorties enregistrées.
 *
 * La dépense en énergie est une **estimation**, et le dit. Sans capteur
 * cardiaque, on ne peut que multiplier une distance par un coefficient et une
 * masse : l'afficher comme une mesure serait un mensonge confortable, la cacher
 * priverait d'un repère que tout le monde utilise pour se situer. Le nombre de
 * pas, lui, est parti : il valait la distance multipliée par une constante,
 * c'est-à-dire la même information présentée comme une seconde.
 */
function Totals({ history, profile }) {
  const sums = history.reduce(
    (acc, r) => {
      acc.distance += r.actual_distance_m || 0
      acc.time += r.actual_duration_s || 0
      acc.count += 1
      return acc
    },
    { distance: 0, time: 0, count: 0 },
  )

  const week = history
    .filter((r) => Date.now() - new Date(r.ranAt).getTime() < 7 * 864e5)
    .reduce((m, r) => m + (r.actual_distance_m || 0), 0)

  // Chaque sport à sa mesure : une allure moyenne qui mêlait course et vélo
  // n'était celle d'aucune sortie — 3:40 du kilomètre pour qui court à 5:50.
  const of = (bike) =>
    history
      .filter((r) => (r.sport === 'bike') === bike)
      .reduce((acc, r) => ({ m: acc.m + (r.actual_distance_m || 0), s: acc.s + (r.actual_duration_s || 0) }), { m: 0, s: 0 })
  const [foot, wheel] = [of(false), of(true)]
  const average = [
    foot.m > 0 ? t('Allure moyenne {v1}{v2}', { v1: pace(foot.s / (foot.m / 1000)), v2: paceLabel() }) : null,
    wheel.m > 0 && wheel.s > 0 ? `${foot.m > 0 ? t('à vélo') : t('Vitesse moyenne')} ${speedIn(wheel.m / wheel.s * 3.6).toFixed(1).replace('.', dec())} ${speedLabel()}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <div className="stats stats--four">
        <div>
          <b>{km(sums.distance, 0)}</b>
          <span>{t('km au total')}</span>
        </div>
        <div>
          <b>{sums.count}</b>
          <span>{sums.count > 1 ? t('sorties') : t('sortie')}</span>
        </div>
        <div>
          <b>{timeTotal(sums.time)[0]}</b>
          <span>{timeTotal(sums.time)[1]}</span>
        </div>
        <div>
          <b>{km(week, 0)}</b>
          <span>{t('km en 7 jours')}</span>
        </div>
      </div>
      <p className="muted small">
        {[
          average,
          t('≈ {v1} kcal (estimées)', { v1: Math.round(history.reduce((sum, r) => sum + energy(r.actual_distance_m || 0, profile?.weight_kg, r.sport), 0)).toLocaleString(locale()) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  )
}

// Coût énergétique approximatif, en kcal par kilogramme et par kilomètre.
// La course coûte à peu près une kcal/kg/km quelle que soit l'allure — c'est le
// déplacement du corps qui domine. Le vélo, porté par la machine, coûte trois
// fois moins à distance égale.
const KCAL_PER_KG_PER_KM = { run: 0.95, bike: 0.30 }

/**
 * Chaque sortie au coût de son sport : le total mêlait course et vélo au tarif
 * du sport réglé dans les filtres, et cent kilomètres de vélo y pesaient comme
 * cent kilomètres courus.
 */
export function energy(distanceM, weightKg, sport = 'run') {
  const factor = KCAL_PER_KG_PER_KM[sport] ?? KCAL_PER_KG_PER_KM.run
  return (distanceM / 1000) * (weightKg || 70) * factor
}

/**
 * La vignette d'une ligne : le dessin de la sortie ou du parcours, qu'on
 * reconnaît d'un coup d'œil bien mieux qu'un nom — « Boucle sud-ouest », il y
 * en a dix. Sans trace gardée, l'icône du sport.
 */
function Thumb({ line, sport }) {
  const drawn = useMemo(() => sketch(line, 32, 32, 4), [line])
  if (!drawn) {
    return (
      <span className="list__sport" aria-hidden="true">
        <Icon name={sport === 'bike' ? 'bike' : sport ? 'run' : 'routes'} size={17} />
      </span>
    )
  }
  return (
    <span className="list__sport" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="32" height="32">
        <path d={drawn.d} />
      </svg>
    </span>
  )
}

/** « mar. 16 sept. » */
function dayLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Le temps total, et son unité. Arrondi à l'heure, il affichait « 0 heures »
 * après trois sorties de vingt minutes, et « 1 heures » après cinquante-sept.
 */
export function timeTotal(seconds) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return [minutes, minutes > 1 ? 'minutes' : 'minute']
  const hours = Math.round(minutes / 60)
  return [hours, hours > 1 ? 'heures' : 'heure']
}

/** L'en-tête d'un mois : combien de sorties, de kilomètres, d'heures, et le bilan du mois. */
function MonthHeader({ label, month, runs, onReport }) {
  const distance = runs.reduce((m, r) => m + (r.actual_distance_m || 0), 0)
  const time = runs.reduce((m, r) => m + (r.actual_duration_s || 0), 0)
  // Un jour par barre, même hauteur pour tous les mois : le jour le plus long
  // donne la pleine hauteur, et un jour sans sortie reste une case vide.
  const jours = month && runs.length ? dailyMetres(runs, month) : []
  const haut = Math.max(...jours, 1)
  return (
    <div className="monthhead">
      <b>{label}</b>
      <span>{t('{length} sortie{v2} · {v3} {v4} · {v5}', { length: runs.length, v2: runs.length > 1 ? 's' : '', v3: km(distance, 1), v4: unitLabel(), v5: duration(time) })}</span>
      {onReport && (
        <button className="monthhead__report" onClick={onReport}>{t('Bilan')}</button>
      )}
      {jours.length > 0 && (
        <div className="monthdays weeks__plot" aria-hidden="true">
          {jours.map((m, i) => (
            <div className="weeks__col" key={i} title={`${i + 1} : ${km(m, 1)} ${unitLabel()}`}>
              <i style={{ height: `${m ? Math.max(6, (m / haut) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function paceOf(entry) {
  const d = entry.actual_distance_m || 0
  if (d < 100) return '—'
  return pace((entry.actual_duration_s || 0) / (d / 1000))
}
