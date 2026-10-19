import { useEffect, useMemo, useState } from 'react'
import Icon, { SolidIcon } from './Icon.jsx'
import { downloadRun } from './api'
import { duration, km, pace } from './format'
import AscentNote from './AscentNote.jsx'
import { PlanGap, Splits, Standing, whenLabel } from './RunDetail.jsx'
import { records, standing } from './knownRoutes'
import { energy } from './Library.jsx'
import { announcing, arrivalText, contactOf, shareText, textTo } from './contact'
import { sketch } from './routeDraw'

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
 *
 * `onContinue` : l'arrivée s'est déclenchée d'elle-même, et l'on n'avait pas
 * fini — un tour de plus, un retour au calme. `onKeep` : garder le parcours en
 * favori, quand la sortie en suivait un.
 */
export default function RunSummary({ entry, history = [], weightKg = 70, onClose, onContinue, onKeep, kept = false }) {
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  const perKm = distance > 100 ? seconds / (distance / 1000) : 0
  const speed = seconds > 0 ? (distance / seconds) * 3.6 : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null
  const rang = useMemo(() => standing(entry, history), [entry, history])
  const best = useMemo(() => records(entry, history), [entry, history])
  const splits = entry.splits?.length ? entry.splits : null
  const shown = useCountUp(distance)
  const kcal = Math.round(energy(distance, weightKg, entry.sport))
  // La trace courue, en croquis : la page couvre la carte, et c'est pourtant le
  // dessin de sa sortie qu'on veut voir en arrivant.
  const drawn = useMemo(() => sketch(entry.track, 160, 96), [entry.track])

  const share = () =>
    shareText(
      [
        `${entry.name} — ${km(distance, 1)} km en ${duration(seconds)}`,
        bike ? `${speed.toFixed(1).replace('.', ',')} km/h de moyenne` : `${pace(perKm)}/km`,
        entry.actual_ascent_m != null ? `D+ ${entry.actual_ascent_m} m` : null,
      ]
        .filter(Boolean)
        .join(' · ') + ' — avec Lacet',
      'Ma sortie',
    )

  return (
    <div className="panel summary">
      <div className="summary__hero">
        {drawn ? (
          <svg className="sketch" viewBox="0 0 160 96" aria-hidden="true">
            <path d={drawn.d} pathLength="1" />
            <circle cx={drawn.start[0]} cy={drawn.start[1]} r="4" />
          </svg>
        ) : (
          <span className="origin__pin origin__pin--done summary__badge" aria-hidden="true">
            <Icon name={entry.arrived ? 'flag' : 'check'} size={22} />
          </span>
        )}
        <b>{entry.arrived ? 'Boucle bouclée' : 'Sortie enregistrée'}</b>
        <em>
          {entry.name} · {whenLabel(entry.ranAt)}
        </em>
      </div>

      <div className="summary__big">
        <b>{km(shown)}</b>
        <span>KILOMÈTRES</span>
      </div>

      <div className="stats stats--four">
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
        <div>
          <b>{kcal > 0 ? kcal.toLocaleString('fr-FR') : '—'}</b>
          <span>kcal estimées</span>
        </div>
      </div>

      {/* Ce qui mérite d'être fêté, en premier : c'est ce qu'on regarde. */}
      {best.list.length > 0 && (
        <div className="summary__records">
          {best.list.includes('longest') && (
            <span>
              <Icon name="routes" size={15} />
              Ta plus longue sortie {bike ? 'à vélo' : 'à pied'}
            </span>
          )}
          {best.list.includes('fastest') && (
            <span>
              <Icon name="flag" size={15} />
              {bike ? 'Ta vitesse la plus haute' : 'Ton allure la plus rapide'}, sur 3 km ou plus
            </span>
          )}
        </div>
      )}

      {rang && <Standing rang={rang} bike={bike} />}

      {splits && <Splits splits={splits} bike={bike} />}

      {gap !== null && <PlanGap entry={entry} planned={planned} gap={gap} />}

      <p className="muted small">
        {best.monthCount > 1
          ? `${best.monthCount}ᵉ sortie du mois · ${km(best.monthM, 1)} km depuis le 1er.`
          : 'Première sortie du mois.'}
        {entry.paused_s > 0
          ? ` Chrono arrêté ${duration(entry.paused_s)} — feux, pauses : le temps ci-dessus est celui en mouvement.`
          : ''}
        {entry.rerouted ? ' Un nouveau chemin a été calculé en route.' : ''}
      </p>

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

      <div className="summary__actions">
        <button className="btn btn--icon" onClick={share} aria-label="Partager la sortie" title="Partager">
          <Icon name="upload" size={18} />
        </button>
        {entry.track?.length > 1 && (
          <button
            className="btn btn--icon"
            onClick={() => downloadRun(entry)}
            aria-label="Exporter la trace en GPX"
            title="Exporter en GPX"
          >
            <Icon name="download" size={18} />
          </button>
        )}
        {onKeep && (
          <button
            className={`btn btn--icon ${kept ? 'btn--on' : ''}`}
            onClick={onKeep}
            aria-pressed={kept}
            aria-label={kept ? 'Retirer le parcours des favoris' : 'Garder ce parcours en favori'}
            title={kept ? 'Retirer des favoris' : 'Garder en favori'}
          >
            {kept ? <SolidIcon name="heart" size={18} /> : <Icon name="heart" size={18} />}
          </button>
        )}
        <button className="btn btn--primary" onClick={onClose}>
          Terminer
        </button>
      </div>

      {/* L'arrivée s'est déclenchée d'elle-même : si c'était trop tôt, on repart
          sans rien perdre. */}
      {entry.arrived && onContinue && (
        <button className="linkish" onClick={onContinue}>
          Pas fini ? Reprendre la sortie
        </button>
      )}

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
