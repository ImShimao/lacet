import { useEffect, useMemo, useState } from 'react'
import Icon, { SolidIcon } from './Icon.jsx'
import { downloadRun } from './api'
import { duration, km, pace } from './format'
import AscentNote from './AscentNote.jsx'
import { Climb, Feeling, PlanGap, SlopePace, Splits, Standing, whenLabel } from './RunDetail.jsx'
import { distanceRecords, records, standing } from './knownRoutes'
import { energy } from './Library.jsx'
import { announcing, arrivalText, contactOf, textTo } from './contact'
import { bandPaths, sketch } from './routeDraw'
import { paceBands } from './runTrace'
import ShareSheet from './ShareSheet.jsx'

/**
 * Ce qu'on vient de faire, dit une fois la sortie terminée.
 *
 * Avant, « Terminer » renvoyait à la carte de recherche : la sortie était
 * enregistrée, et rien ne la montrait. C'est pourtant le seul moment où l'on
 * regarde ses chiffres — et où l'on veut emporter sa trace ailleurs.
 *
 * **L'ordre est celui du regard, essoufflé.** La trace d'abord, en grand et
 * coloriée par allure — la page couvre la carte, et un croquis de timbre-poste
 * ne montrait rien. Puis une phrase qui dit ce que la sortie vaut, les chiffres,
 * ce qui se fête, et le détail pour qui descend : les kilomètres, le profil
 * monté, l'écart au plan. Ce qui explique les mesures est replié en bas : trois
 * paragraphes gris poussaient « Terminer » hors de l'écran.
 *
 * La trace affichée est **celle qu'on a réellement suivie**, pas le plan, et
 * l'export GPX la donne telle quelle, horodatée, pour une montre ou un autre
 * service — Strava compris, qui l'importe depuis son site.
 *
 * `onContinue` : l'arrivée s'est déclenchée d'elle-même, et l'on n'avait pas
 * fini — un tour de plus, un retour au calme. `onKeep` : garder le parcours en
 * favori, quand la sortie en suivait un. `onReverse` : le préparer dans l'autre
 * sens pour la prochaine fois. `onAnnotate` : noter le ressenti.
 */
export default function RunSummary({
  entry,
  history = [],
  weightKg = 70,
  onClose,
  onContinue,
  onKeep,
  kept = false,
  onReverse,
  onAnnotate,
}) {
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  const perKm = distance > 100 ? seconds / (distance / 1000) : 0
  const speed = seconds > 0 ? (distance / seconds) * 3.6 : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null
  const rang = useMemo(() => standing(entry, history), [entry, history])
  const best = useMemo(() => records(entry, history), [entry, history])
  const bests = useMemo(() => distanceRecords(entry, history), [entry, history])
  const splits = entry.splits?.length ? entry.splits : null
  const shown = useCountUp(distance)
  const kcal = Math.round(energy(distance, weightKg, entry.sport))
  // La trace courue, en grand, et ses tronçons par allure quand elle a ses
  // heures — une sortie d'avant, ou reprise sans elles, reste d'un seul trait.
  const drawn = useMemo(() => {
    const line = sketch(entry.track, 320, 190, 12)
    const bands = line && paceBands(entry.track, entry.track_t)
    return line && { ...line, parts: bands ? bandPaths(line.points, bands) : [] }
  }, [entry.track, entry.track_t])
  const verdict = verdictOf({ rang, bests, best, gap })

  const [sharing, setSharing] = useState(false)

  return (
    <div className="panel summary">
      {sharing && <ShareSheet entry={entry} verdict={verdict} onClose={() => setSharing(false)} />}
      <div className="summary__hero">
        {drawn ? (
          <svg className="sketch" viewBox="0 0 320 190" aria-hidden="true">
            <path className="sketch__line" d={drawn.d} pathLength="1" />
            {drawn.parts.map((part) => (
              <path key={part.end} className="sketch__pace" data-band={part.band} d={part.d} />
            ))}
            <circle cx={drawn.start[0]} cy={drawn.start[1]} r="5" />
          </svg>
        ) : (
          <span className="origin__pin origin__pin--done summary__badge" aria-hidden="true">
            <Icon name={entry.arrived ? 'flag' : 'check'} size={22} />
          </span>
        )}
        {drawn?.parts.length > 0 && (
          <span className="sketch__legend" aria-hidden="true">
            plus vite <i /> plus lent
          </span>
        )}
        <b>{entry.arrived ? 'Boucle bouclée' : 'Sortie enregistrée'}</b>
        <em>
          {entry.name} · {whenLabel(entry.ranAt)}
        </em>
        {verdict && <strong className="summary__verdict">{verdict}</strong>}
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
      {(best.list.length > 0 || bests.length > 0) && (
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
          {bests.map((b) => (
            <span key={b.km}>
              <Icon name="flag" size={15} />
              {bestLabel(b)}
            </span>
          ))}
        </div>
      )}

      {rang && <Standing rang={rang} bike={bike} />}

      {splits && <Splits splits={splits} bike={bike} entry={entry} />}

      <SlopePace entry={entry} bike={bike} />

      <Climb entry={entry} />

      {gap !== null && <PlanGap entry={entry} planned={planned} gap={gap} />}

      {onAnnotate && <Feeling entry={entry} onChange={onAnnotate} />}

      <p className="muted small">
        {best.monthCount > 1
          ? `${best.monthCount}ᵉ sortie du mois · ${km(best.monthM, 1)} km depuis le 1er.`
          : 'Première sortie du mois.'}
      </p>

      {/* Comment les chiffres sont mesurés, pour qui se le demande : dit en
          clair mais replié, pour que les gestes de la fin restent à l'écran. */}
      <details className="spoken">
        <summary>Comment c'est mesuré</summary>
        {entry.paused_s > 0 && (
          <p className="muted small">
            Chrono arrêté {duration(entry.paused_s)} — feux, pauses : le temps ci-dessus est celui en mouvement.
          </p>
        )}
        {entry.rerouted && <p className="muted small">Un nouveau chemin a été calculé en route.</p>}
        {entry.actual_ascent_m == null ? (
          <p className="muted small">
            Pas de dénivelé mesuré : ni le baromètre ni le GPS du téléphone n'ont donné
            l'altitude pendant cette sortie.
          </p>
        ) : (
          <AscentNote entry={entry} />
        )}
        <p className="muted small">
          Tout est dans « Mes parcours ». La trace reste sur l'appareil : la
          sauvegarde de « Mon compte » l'emporte avec le reste.
        </p>
      </details>

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
        <button className="btn btn--icon" onClick={() => setSharing(true)} aria-label="Partager la sortie en image" title="Partager">
          <Icon name="share" size={18} />
        </button>
        {entry.track?.length > 1 && (
          <button
            className="btn btn--icon"
            onClick={() => downloadRun(entry)}
            aria-label="Exporter la trace en GPX"
            title="Exporter en GPX"
          >
            <Icon name="fileExport" size={18} />
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
        {/* La même boucle à l'envers est une autre sortie — les côtes en
            descente, le vent dans le dos : c'est en arrivant qu'on se le dit. */}
        {onReverse && (
          <button
            className="btn btn--icon"
            onClick={onReverse}
            aria-label="Préparer ce parcours dans l'autre sens"
            title="La prochaine fois, dans l'autre sens"
          >
            <Icon name="uturn" size={18} />
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
    </div>
  )
}

const bestLabel = ({ km: n, seconds }) =>
  n === 1 ? `Ton kilomètre le plus rapide : ${pace(seconds)}` : `Ton meilleur ${n} km : ${duration(seconds)}`

// L'écart au plan qui se dit comme une réussite : au-delà, c'est un détour ou
// un raccourci, et `PlanGap` le montre sans le fêter.
const ON_PLAN_M = 150

/**
 * Ce que la sortie vaut, en une phrase — ou `null` quand il n'y a rien à dire
 * de vrai. Du plus parlant au moins : se comparer à soi sur ce chemin, un
 * record, la plus longue, puis la distance tenue.
 */
export function verdictOf({ rang, bests, best, gap }) {
  if (rang?.record) return `Ton meilleur passage ici, sur ${rang.count}`
  if (rang) {
    const s = Math.abs(rang.vsPrevious)
    if (s < 2) return 'La même allure que la dernière fois ici'
    return `${s} s/km ${rang.vsPrevious < 0 ? 'plus vite' : 'plus lent'} que la dernière fois ici`
  }
  if (bests.length) return bestLabel(bests[bests.length - 1])
  if (best.list.includes('longest')) return 'Ta plus longue sortie'
  if (gap !== null && Math.abs(gap) <= ON_PLAN_M) return `À ${Math.abs(Math.round(gap))} m de la distance prévue`
  return null
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
