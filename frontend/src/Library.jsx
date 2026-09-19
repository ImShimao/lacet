/**
 * Mes parcours : les sorties déjà faites et les favoris.
 *
 * Séparé d'`App.jsx` parce que rien d'autre ne s'en sert : le bilan des
 * sorties, le calcul d'allure et la commande de carte hors ligne ne parlent
 * qu'à cet écran. Les garder au milieu du reste obligeait à traverser le
 * classement des itinéraires pour trouver le bouton qui télécharge une carte.
 */

import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { duration, km, pace } from './format'
import { offlineStyleFor } from './mapStyles'
import * as offline from './offlineMaps'

export default function Library({ mode = 'full', saved, history, onOpen, profile, mapStyle }) {
  // Sur ordinateur, pas de sorties : on n'y court pas, l'historique y serait
  // toujours vide. Seuls les favoris, qui sont ce qu'on y prépare.
  const canRun = mode === 'full'
  // S'ouvrir sur ce qui existe : un premier favori gardé avant toute sortie
  // tombait sinon sur « Aucune sortie enregistrée », et semblait perdu.
  const [chosen, setView] = useState(() =>
    history.length === 0 && saved.length > 0 ? 'saved' : 'history',
  )
  const view = canRun ? chosen : 'saved'
  // Les filtres de l'historique : quelle activité, quel mois. Les totaux
  // suivent — « combien ai-je couru en août » est la question qu'on se pose.
  const [sport, setSport] = useState('all')
  const [month, setMonth] = useState('all')
  const months = useMemo(() => [...new Set(history.map((r) => monthKey(r.ranAt)).filter(Boolean))], [history])
  const shown = history.filter(
    (r) => (sport === 'all' || (r.sport || 'run') === sport) && (month === 'all' || monthKey(r.ranAt) === month),
  )
  const rows = view === 'history' ? shown : saved

  return (
    <div className="panel">
      {view === 'history' && shown.length > 0 && (
        <Totals history={shown} profile={profile} />
      )}
      {canRun && (
        <div className="seg">
          <button aria-pressed={view === 'history'} onClick={() => setView('history')}>
            Sorties ({history.length})
          </button>
          <button aria-pressed={view === 'saved'} onClick={() => setView('saved')}>
            Favoris ({saved.length})
          </button>
        </div>
      )}

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
        </div>
      ) : (
        <>
          {canRun && <p className="muted small">
            Le tracé, les consignes et le profil sont déjà sur l'appareil : ces
            parcours s'ouvrent sans réseau. L'icône à droite ajoute <b>le fond de
            carte</b>, la seule pièce qui manque pour se repérer hors couverture —
            compter un à deux mégaoctets à la campagne, une quinzaine en plein
            centre-ville, où chaque tuile porte les bâtiments et les commerces.
          </p>}
          {!canRun && (
            <p className="muted small">
              Ouvre un favori pour revoir son détail ou l'exporter en GPX — vers une
              montre, Strava, ou le téléphone avec lequel tu courras.
            </p>
          )}
          <div className="list">
            {rows.map((r, i) => (
              <div key={i} className="list__group">
              {view === 'history' && monthKey(r.ranAt) !== monthKey(rows[i - 1]?.ranAt) && (
                <MonthHeader label={monthLabel(monthKey(r.ranAt))} runs={rows.filter((x) => monthKey(x.ranAt) === monthKey(r.ranAt))} />
              )}
              <div className="list__item">
                <button className="list__row" onClick={() => onOpen(r)}>
                  {view === 'history' && (
                    <span className="list__sport" aria-hidden="true">
                      <Icon name={r.sport === 'bike' ? 'bike' : 'run'} size={17} />
                    </span>
                  )}
                  <span>
                    {r.name}
                    <em>
                      {view === 'history'
                        ? `${dayLabel(r.ranAt)} · ${km(r.actual_distance_m)} km · ${duration(r.actual_duration_s)} · ${paceOf(r)}/km`
                        : `${km(r.distance_m)} km · D+ ${Math.round(r.ascent_m || 0)} m`}
                    </em>
                  </span>
                  {r.grade ? (
                    <span className={`grade grade--${r.grade}`}>{r.grade}</span>
                  ) : (
                    <span className="grade grade--free">libre</span>
                  )}
                </button>
                {canRun && <OfflineControl route={r} mapStyle={mapStyle} />}
              </div>
              </div>
            ))}
          </div>
        </>
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

  // Une sortie libre n'a pas de tracé : il n'y a pas de carte à délimiter.
  if (!offline.isAvailable() || !route.geometry?.length) return null

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

/**
 * Bilan des sorties enregistrées.
 *
 * Les dépenses en énergie et le nombre de pas sont des **estimations**, et le
 * disent. Aucune app n'a accès à autre chose : sans capteur cardiaque ni
 * accéléromètre, on ne peut que multiplier une distance par un coefficient et
 * une masse. Les afficher comme des mesures serait un mensonge confortable ;
 * les cacher priverait d'un repère que tout le monde utilise pour se situer.
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

  const averagePace = sums.distance > 0 ? sums.time / (sums.distance / 1000) : 0

  return (
    <>
      <div className="stats stats--four">
        <div>
          <b>{km(sums.distance, 0)}</b>
          <span>km au total</span>
        </div>
        <div>
          <b>{sums.count}</b>
          <span>sorties</span>
        </div>
        <div>
          <b>{Math.round(sums.time / 3600)}</b>
          <span>heures</span>
        </div>
        <div>
          <b>{km(week, 0)}</b>
          <span>km · 7 j</span>
        </div>
      </div>
      <p className="muted small">
        Allure moyenne {pace(averagePace)}/km · environ{' '}
        {Math.round(energy(sums.distance, profile)).toLocaleString('fr-FR')} kcal et{' '}
        {Math.round(steps(sums.distance, profile)).toLocaleString('fr-FR')} pas —
        estimés à partir de ta taille et de ton poids, pas mesurés.
      </p>
    </>
  )
}

// Coût énergétique approximatif, en kcal par kilogramme et par kilomètre.
// La course coûte à peu près une kcal/kg/km quelle que soit l'allure — c'est le
// déplacement du corps qui domine. Le vélo, porté par la machine, coûte trois
// fois moins à distance égale.
const KCAL_PER_KG_PER_KM = { run: 0.95, bike: 0.30 }

// Longueur de foulée, en fraction de la taille. 0,65 correspond à une foulée de
// course à allure modérée ; la marche serait plus proche de 0,45.
const STRIDE_RATIO = 0.65

function energy(distanceM, profile) {
  const factor = KCAL_PER_KG_PER_KM[profile?.sport] ?? KCAL_PER_KG_PER_KM.run
  return (distanceM / 1000) * (profile?.weight_kg || 70) * factor
}

function steps(distanceM, profile) {
  if (profile?.sport === 'bike') return 0
  const stride = ((profile?.height_cm || 175) / 100) * STRIDE_RATIO
  return distanceM / stride
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

/** L'en-tête d'un mois : combien de sorties, de kilomètres, d'heures. */
function MonthHeader({ label, runs }) {
  const distance = runs.reduce((m, r) => m + (r.actual_distance_m || 0), 0)
  const time = runs.reduce((m, r) => m + (r.actual_duration_s || 0), 0)
  return (
    <div className="monthhead">
      <b>{label}</b>
      <span>
        {runs.length} sortie{runs.length > 1 ? 's' : ''} · {km(distance, 1).replace('.', ',')} km · {duration(time)}
      </span>
    </div>
  )
}

function paceOf(entry) {
  const d = entry.actual_distance_m || 0
  if (d < 100) return '—'
  return pace((entry.actual_duration_s || 0) / (d / 1000))
}
