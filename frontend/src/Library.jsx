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

export default function Library({ saved, history, initialView, onOpen, onOpenRun, onImport, onExplore, onRename, onForget, profile, mapStyle }) {
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

  return (
    <div className="panel">
      {view === 'history' && shown.length > 0 && (
        <>
          <Totals history={shown} profile={profile} />
          <WeeklyVolume history={history.filter((r) => sport === 'all' || (r.sport || 'run') === sport)} />
        </>
      )}
      <div className="seg">
        <button aria-pressed={view === 'history'} onClick={() => setView('history')}>
          Sorties ({history.length})
        </button>
        <button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>
          Favoris ({saved.length})
        </button>
      </div>

      {view === 'saved' && onImport && <ImportRow onImport={onImport} />}

      {view === 'history' && history.length > 0 && (
        <div className="histfilter">
          <div className="chips" role="radiogroup" aria-label="Activité">
            {[
              ['all', null, 'Tout'],
              ['run', 'run', 'Course'],
              ['bike', 'bike', 'Vélo'],
            ].map(([key, icon, label]) => (
              <button key={key} role="radio" aria-checked={sport === key} className={`chip ${sport === key ? 'chip--on' : ''}`} onClick={() => setSport(key)}>
                {icon && <Icon name={icon} size={15} />}
                {label}
              </button>
            ))}
          </div>
          <select className="histfilter__month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois">
            <option value="all">Tous les mois</option>
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
          <p>
            {view === 'history'
              ? history.length
                ? 'Aucune sortie pour ce filtre.'
                : "Aucune sortie enregistrée. Lance-en une depuis l'onglet Explorer."
              : 'Aucun parcours en favori. Le cœur, sous une proposition, la garde ici.'}
          </p>
          {/* Un écran vide qui dit « va ailleurs » sans y mener laisse chercher
              l'onglet du regard : le bouton y emmène. Pas pour un filtre qui ne
              rend rien — il y a déjà des sorties, et l'on veut changer de filtre. */}
          {onExplore && !(view === 'history' && history.length) && (
            <button className="btn btn--primary" onClick={onExplore}>
              <Icon name="search" size={17} />
              Trouver une boucle
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Deux lignes, pas six : l'explication complète repoussait la liste
              sous le pli à chaque ouverture de l'onglet. */}
          <p className="muted small">
            Ces parcours s'ouvrent sans réseau. L'icône à droite ajoute <b>le fond de carte</b> :
            1 à 2 Mo à la campagne, une quinzaine en ville.
          </p>
          <div className="list">
            {rows.map((r, i) => (
              // Une clé qui suit la ligne, pas sa place : retirer une ligne
              // faisait sinon hériter la suivante de sa confirmation ouverte.
              <div key={r.ranAt || offline.keyOf(r)} className="list__group">
              {view === 'history' && monthKey(r.ranAt) !== monthKey(rows[i - 1]?.ranAt) && (
                <MonthHeader label={monthLabel(monthKey(r.ranAt))} runs={byMonth.get(monthKey(r.ranAt)) ?? []} />
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
            <button className="btn" onClick={() => setLimit(limit + PAGE)}>
              Afficher les suivantes ({all.length - rows.length})
            </button>
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
            name={route.name}
            label={run ? 'Nom de la sortie' : 'Nom du favori'}
            autoFocus
            onRename={(nom) => onRename(route, nom)}
            onDone={() => setNaming(false)}
          />
        ) : (
          route.name
        )}
        <em>
          {run
            ? `${dayLabel(route.ranAt)} · ${km(route.actual_distance_m)} km · ${duration(route.actual_duration_s)} · ${paceOf(route)}/km`
            : `${km(route.distance_m)} km · D+ ${Math.round(route.ascent_m || 0)} m`}
        </em>
      </span>
      {route.grade ? (
        <span className={`grade grade--${route.grade}`}>{route.grade}</span>
      ) : (
        <span className="grade grade--free">libre</span>
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
          >
            Renommer
          </button>
          <button
            className="list__act list__act--warn"
            onClick={() => {
              refermer()
              setAsking(true)
            }}
          >
            {run ? 'Supprimer' : 'Retirer'}
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
    <div className="list__confirm" role="group" aria-label={run ? 'Supprimer la sortie' : 'Retirer le favori'}>
      <p>
        {run ? (
          <>
            Supprimer <b>{route.name}</b>, la sortie du {dayLabel(route.ranAt)} ? Ses kilomètres quittent les totaux.
          </>
        ) : (
          <>
            Retirer <b>{route.name}</b> des favoris ?
          </>
        )}
        {stored &&
          (shared
            ? ' Sa carte hors ligne reste : une autre ligne de Mes parcours la montre.'
            : ` Sa carte hors ligne (${offline.formatBytes(offline.storedBytes(route))}) part avec.`)}
      </p>
      <div className="row">
        <button className="btn" onClick={onCancel}>
          Annuler
        </button>
        <button className="btn btn--primary" onClick={onConfirm}>
          {run ? 'Supprimer' : 'Retirer'}
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
function ImportRow({ onImport }) {
  const [erreur, setErreur] = useState(null)
  const champ = useRef(null)

  const choisir = async (event) => {
    const fichier = event.target.files?.[0]
    // Le champ garde son fichier : sans ça, réimporter le même après une
    // correction ne déclencherait rien.
    event.target.value = ''
    if (!fichier) return
    setErreur(null)
    try {
      await onImport(fichier)
    } catch (err) {
      setErreur(err.message)
    }
  }

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
        <Icon name="fileImport" size={17} />
        Importer un GPX
      </button>
      {erreur ? (
        <p className="muted small import__error">{erreur}</p>
      ) : (
        <p className="muted small">
          Le tracé d'un ami, une course balisée. Lacet reconnaît les rues qu'il emprunte —
          il faut télécharger celles du coin, quelques secondes — et le traite ensuite comme
          une boucle calculée ici : noms de rues, traversées, note de sécurité et consignes
          de virage. Quand la trace ne suit aucune rue connue, elle est gardée telle quelle,
          sans note.
        </p>
      )}
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
      setFailed(e.message || 'Le téléchargement a échoué.')
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
        aria-label={`Téléchargement de la carte de ${route.name}`}
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
        title="Confirmer le retrait"
      >
        <Icon name="close" size={14} />
        Retirer ?
      </button>
    ) : (
      <button
        className={`offline offline--on ${autreFond ? 'offline--other' : ''}`}
        onClick={() => setConfirm(true)}
        title={
          autreFond
            ? `Carte gardée pour le fond « ${entry.label} » — ${offline.formatBytes(entry.bytes)}`
            : `Carte disponible hors ligne — ${offline.formatBytes(entry.bytes)}, zoom ${entry.zoom}`
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
      title={failed || `Garder le fond « ${style.label} » hors ligne pour ce parcours`}
      aria-label={`Rendre ${route.name} disponible hors ligne`}
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
function WeeklyVolume({ history }) {
  const semaines = useMemo(() => lastWeeks(history, WEEKS), [history])
  const haut = Math.max(...semaines.map((s) => s.metres), 1)
  if (!semaines.some((s) => s.metres > 0)) return null

  const total = semaines.reduce((m, s) => m + s.metres, 0)
  const moyenne = total / WEEKS

  return (
    <figure className="weeks">
      <figcaption className="weeks__head">
        {/* Court des deux côtés : à 390 px, « Douze dernières semaines » et
            « par semaine en moyenne » se repliaient chacun sur deux lignes. La
            période est déjà dite par l'axe, juste en dessous. */}
        <span className="label">Volume par semaine</span>
        <em>{km(moyenne, 0)} km en moyenne</em>
      </figcaption>

      {/* Douze dates sous douze barres ne tiennent pas dans la largeur d'un
          téléphone : elles se chevauchaient. Les deux bornes suffisent à situer
          la période, et chaque barre garde sa valeur au survol et dans le
          tableau ci-dessous. */}
      <div className="weeks__plot" aria-hidden="true">
        {semaines.map((s, i) => (
          <div className="weeks__col" key={s.key} title={`${s.label} : ${km(s.metres, 1)} km`}>
            <i
              style={{ height: `${s.metres ? Math.max(3, (s.metres / haut) * 100) : 0}%` }}
              data-now={i === semaines.length - 1 || undefined}
            />
          </div>
        ))}
      </div>
      <div className="weeks__axis" aria-hidden="true">
        <span>{semaines[0].short}</span>
        <span>cette semaine</span>
      </div>

      {/* Ce que le dessin montre, écrit : c'est la seule version lisible par
          une synthèse vocale, et la seule consultable sans souris. */}
      <table className="visually-hidden">
        <caption>Distance par semaine, les douze dernières</caption>
        <tbody>
          {semaines.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{km(s.metres, 1)} km</td>
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
      label: `Semaine du ${lundi.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`,
      short: lundi.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', ''),
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
    foot.m > 0 ? `Allure moyenne ${pace(foot.s / (foot.m / 1000))}/km` : null,
    wheel.m > 0 && wheel.s > 0 ? `${foot.m > 0 ? 'à vélo' : 'Vitesse moyenne'} ${(wheel.m / wheel.s * 3.6).toFixed(1).replace('.', ',')} km/h` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <div className="stats stats--four">
        <div>
          <b>{km(sums.distance, 0)}</b>
          <span>km au total</span>
        </div>
        <div>
          <b>{sums.count}</b>
          <span>{sums.count > 1 ? 'sorties' : 'sortie'}</span>
        </div>
        <div>
          <b>{timeTotal(sums.time)[0]}</b>
          <span>{timeTotal(sums.time)[1]}</span>
        </div>
        <div>
          <b>{km(week, 0)}</b>
          <span>km · 7 j</span>
        </div>
      </div>
      <p className="muted small">
        {average} · environ{' '}
        {Math.round(history.reduce((sum, r) => sum + energy(r.actual_distance_m || 0, profile?.weight_kg, r.sport), 0)).toLocaleString('fr-FR')}{' '}
        kcal, estimées à partir de ton poids — pas mesurées.
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

/** Le mois d'une sortie : « 2026-09 ». */
function monthKey(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** « Septembre 2026 ». */
function monthLabel(key) {
  if (!key) return 'Sans date'
  const [y, m] = key.split('-').map(Number)
  const text = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** « mar. 16 sept. » */
function dayLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
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

/** L'en-tête d'un mois : combien de sorties, de kilomètres, d'heures. */
function MonthHeader({ label, runs }) {
  const distance = runs.reduce((m, r) => m + (r.actual_distance_m || 0), 0)
  const time = runs.reduce((m, r) => m + (r.actual_duration_s || 0), 0)
  return (
    <div className="monthhead">
      <b>{label}</b>
      <span>
        {runs.length} sortie{runs.length > 1 ? 's' : ''} · {km(distance, 1)} km · {duration(time)}
      </span>
    </div>
  )
}

function paceOf(entry) {
  const d = entry.actual_distance_m || 0
  if (d < 100) return '—'
  return pace((entry.actual_duration_s || 0) / (d / 1000))
}
