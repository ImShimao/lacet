import Icon from './Icon.jsx'
import { downloadRun } from './api'
import { duration, km, pace } from './format'
import AscentNote from './AscentNote.jsx'

/**
 * Ce qu'on vient de faire, dit une fois la sortie terminée.
 *
 * Avant, « Terminer » renvoyait à la carte de recherche : la sortie était
 * enregistrée, et rien ne la montrait. C'est pourtant le seul moment où l'on
 * regarde ses chiffres — et où l'on veut emporter sa trace ailleurs.
 *
 * La trace affichée est **celle qu'on a réellement suivie**, pas le plan : la
 * carte la dessine derrière ce panneau, et l'export GPX la donne telle quelle,
 * horodatée, pour une montre ou un autre service — Strava compris, qui
 * l'importe depuis son site.
 */
export default function RunSummary({ entry, onClose }) {
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  const perKm = distance > 100 ? seconds / (distance / 1000) : 0
  const speed = seconds > 0 ? (distance / seconds) * 3.6 : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null

  return (
    <div className="panel summary">
      <div className="origin">
        <span className="origin__pin origin__pin--done">
          <Icon name="check" size={18} />
        </span>
        <div>
          <b>Sortie enregistrée</b>
          <em>{entry.name}</em>
        </div>
      </div>

      <div className="summary__big">
        <b>{km(distance)}</b>
        <span>KILOMÈTRES</span>
      </div>

      <div className="stats stats--live">
        <div>
          <b>{duration(seconds)}</b>
          <span>Temps</span>
        </div>
        <div>
          <b>{bike ? speed.toFixed(1).replace('.', ',') : pace(perKm)}</b>
          <span>{bike ? 'Vitesse (km/h)' : 'Allure (/km)'}</span>
        </div>
        <div>
          <b>{entry.actual_ascent_m != null ? `${entry.actual_ascent_m} m` : '—'}</b>
          <span>Dénivelé +</span>
        </div>
      </div>

      {gap !== null && (
        <p className="muted small">
          Prévu {km(planned, 1).replace('.', ',')} km — tu as fait{' '}
          <b>
            {gap >= 0 ? '+' : '−'}
            {Math.abs(Math.round(gap))} m
          </b>{' '}
          {gap >= 0 ? 'de plus' : 'de moins'}.
          {entry.rerouted ? ' Un nouveau chemin a été calculé en route.' : ''}
        </p>
      )}
      {entry.actual_ascent_m == null ? (
        <p className="muted small">
          Pas de dénivelé mesuré : ni le baromètre ni le GPS du téléphone n'ont donné
          l'altitude pendant cette sortie.
        </p>
      ) : (
        <AscentNote entry={entry} />
      )}

      <div className="row">
        {entry.track?.length > 1 && (
          <button className="btn" onClick={() => downloadRun(entry)}>
            <Icon name="download" size={16} />
            Exporter ma trace
          </button>
        )}
        <button className="btn btn--primary" onClick={onClose}>
          Terminer
        </button>
      </div>

      <p className="muted small">
        Tout est dans « Mes parcours ». La trace reste sur l'appareil : la
        sauvegarde de « Mon compte » l'emporte avec le reste.
      </p>
    </div>
  )
}
