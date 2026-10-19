import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { downloadRun } from './api'
import { duration, km, pace } from './format'
import AscentNote from './AscentNote.jsx'
import { Splits, Standing } from './RunDetail.jsx'
import { standing } from './knownRoutes'
import { announcing, arrivalText, contactOf, textTo } from './contact'

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
 *
 * Les temps au kilomètre et la comparaison aux passages d'avant sont ceux de
 * `RunDetail.jsx` : ils n'apparaissaient qu'en rouvrant la sortie depuis
 * l'historique, alors que c'est en arrivant, essoufflé, qu'on veut savoir si
 * l'on a battu dimanche dernier.
 */
export default function RunSummary({ entry, history = [], onClose }) {
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  const perKm = distance > 100 ? seconds / (distance / 1000) : 0
  const speed = seconds > 0 ? (distance / seconds) * 3.6 : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null
  const rang = useMemo(() => standing(entry, history), [entry, history])
  const splits = entry.splits?.length ? entry.splits : null
  const shown = useCountUp(distance)

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
        <b>{km(shown)}</b>
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

      {entry.paused_s > 0 && (
        <p className="muted small">
          Chrono arrêté {duration(entry.paused_s)} — feux, pauses, attentes : le temps ci-dessus
          est celui en mouvement.
        </p>
      )}

      {rang && <Standing rang={rang} bike={bike} />}

      {splits && <Splits splits={splits} bike={bike} />}

      {gap !== null && (
        <p className="muted small">
          Prévu {km(planned, 1)} km — tu as fait <b>{Math.abs(Math.round(gap))} m</b>{' '}
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

      {/* Le départ a été annoncé : le retour se dit d'un geste, ici, où l'on
          arrive. Pas tout seul — « Terminer » peut venir d'ailleurs que de
          la porte, et un « tout va bien » parti trop tôt rassurerait à tort. */}
      {announcing() && (
        <button className="btn" onClick={() => textTo(contactOf(), arrivalText(entry), 'Lacet — de retour')}>
          <Icon name="check" size={16} />
          Prévenir que je suis de retour
        </button>
      )}

      <div className="row">
        {entry.track?.length > 1 && (
          <button className="btn btn--fit" onClick={() => downloadRun(entry)} aria-label="Exporter la trace en GPX">
            <Icon name="download" size={16} />
            Exporter
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

/**
 * Les kilomètres comptent jusqu'au total, une seconde à peine : l'arrivée se
 * fête, et l'œil va droit au chiffre. Sans animation quand le système en
 * demande moins.
 */
function useCountUp(target, ms = 900) {
  const still = typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches
  const [value, setValue] = useState(still ? target : 0)
  useEffect(() => {
    if (still) {
      setValue(target)
      return undefined
    }
    let raf = 0
    const t0 = performance.now()
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      setValue(target * (1 - (1 - t) ** 3))
      if (t < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  return value
}
