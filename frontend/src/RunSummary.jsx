import { useEffect, useMemo, useState } from 'react'
import Icon, { SolidIcon } from './Icon.jsx'
import { downloadRun, shareRunReport } from './api'
import { duration, km, pace } from './format'
import AscentNote from './AscentNote.jsx'
import { Climb, Feeling, PlanGap, SlopePace, Splits, Standing, whenLabel } from './RunDetail.jsx'
import { distanceRecords, records, standing } from './knownRoutes'
import { energy } from './Library.jsx'
import { announcing, arrivalText, contactOf, textTo } from './contact'
import { bandPaths, sketch } from './routeDraw'
import { paceBands } from './runTrace'
import ShareSheet from './ShareSheet.jsx'
import { paceLabel, speedIn, speedLabel, unitLabel, units } from './units'

import { t, locale, dec } from './i18n'
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
  const speed = seconds > 0 ? speedIn((distance / seconds) * 3.6) : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null
  const rang = useMemo(() => standing(entry, history), [entry, history])
  const best = useMemo(() => records(entry, history), [entry, history])
  const bests = useMemo(() => distanceRecords(entry, history), [entry, history])
  const splits = entry.splits?.length ? entry.splits : null
  const shown = useCountUp(distance)
  // Le temps et le D+ comptent jusqu'à leur valeur comme la distance, pour que
  // le bilan se lise d'un bloc. Le D+ absent reste « — », sans compter.
  const shownTime = useCountUp(seconds)
  const shownAscent = useCountUp(entry.actual_ascent_m ?? 0)
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
          <span className="sketch__legend" aria-hidden="true">{t('plus vite')}{' '}<i />{' '}{t('plus lent')}</span>
        )}
        <b>{entry.arrived ? t('Boucle bouclée') : t('Sortie enregistrée')}</b>
        <em>
          {entry.name} · {whenLabel(entry.ranAt)}
        </em>
        {/* Un record sur ce chemin, la carte « Ton meilleur passage » le dit
            juste en dessous : la phrase ici le répétait mot pour mot. */}
        {verdict && !rang?.record && <strong className="summary__verdict">{verdict}</strong>}
      </div>

      <div className="summary__big">
        <b>{km(shown)}</b>
        <span>{units() === 'mi' ? t('miles') : t('kilomètres')}</span>
      </div>

      {/* Des étiquettes d'un mot, l'unité à côté du chiffre : « Allure (/km) »
          et « kcal estimées » passaient sur deux lignes dans des cases étroites. */}
      <div className="stats stats--four summary__stats">
        <div>
          <b>{duration(Math.round(shownTime))}</b>
          <span>{t('Temps')}</span>
        </div>
        <div>
          <b>
            {bike ? speed.toFixed(1).replace('.', dec()) : pace(perKm)}
            <small>{bike ? speedLabel() : paceLabel()}</small>
          </b>
          <span>{bike ? t('Vitesse') : t('Allure')}</span>
        </div>
        <div>
          <b>
            {entry.actual_ascent_m != null ? Math.round(shownAscent) : '—'}
            {entry.actual_ascent_m != null && <small>m</small>}
          </b>
          <span>D+</span>
        </div>
        <div>
          <b>{kcal > 0 ? kcal.toLocaleString(locale()) : '—'}</b>
          <span title={t('Estimées d\'après ton poids')}>kcal</span>
        </div>
      </div>

      {/* Ce qui mérite d'être fêté, en premier : c'est ce qu'on regarde. */}
      {(best.list.length > 0 || bests.length > 0) && (
        <div className="summary__records">
          {best.list.includes('longest') && (
            <span>
              <Icon name="routes" size={15} />{t('Ta plus longue sortie {v1}', { v1: bike ? t('à vélo') : t('à pied') })}</span>
          )}
          {best.list.includes('fastest') && (
            <span>
              <Icon name="flag" size={15} />{t('{v1}, sur 3 km ou plus', { v1: bike ? t('Ta vitesse la plus haute') : t('Ton allure la plus rapide') })}</span>
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
          ? t('{monthCount}ᵉ sortie du mois · {v2} {v3} depuis le 1er.', { monthCount: best.monthCount, v2: km(best.monthM, 1), v3: unitLabel() })
          : t('Première sortie du mois.')}
      </p>

      {/* Les gestes secondaires, avec leur nom : cinq ronds sans libellé à
          côté de « Terminer » se devinaient mal, et le partage s'y perdait. */}
      <div className="loopacts summary__more" role="group" aria-label={t('Cette sortie')}>
        {entry.track?.length > 1 && (
          <button className="loopact" onClick={() => downloadRun(entry)} aria-label={t('Exporter la trace en GPX')}>
            <Icon name="fileExport" size={18} />
            <span>GPX</span>
          </button>
        )}
        <button className="loopact" onClick={() => shareRunReport(entry)} aria-label={t('Envoyer le rapport de la sortie')}>
          <Icon name="chart" size={18} />
          <span>{t('Rapport')}</span>
        </button>
        {onKeep && (
          <button
            className={`loopact ${kept ? 'loopact--on' : ''}`}
            onClick={onKeep}
            aria-pressed={kept}
            aria-label={kept ? t('Retirer le parcours des favoris') : t('Garder ce parcours en favori')}
          >
            {kept ? <SolidIcon name="heart" size={18} /> : <Icon name="heart" size={18} />}
            <span>{t('Favori')}</span>
          </button>
        )}
        {/* La même boucle à l'envers est une autre sortie — les côtes en
            descente, le vent dans le dos : c'est en arrivant qu'on se le dit. */}
        {onReverse && (
          <button className="loopact" onClick={onReverse} aria-label={t('Préparer ce parcours dans l\'autre sens')}>
            <Icon name="uturn" size={18} />
            <span>{t('Autre sens')}</span>
          </button>
        )}
      </div>

      {/* Comment les chiffres sont mesurés, pour qui se le demande : dit en
          clair mais replié, pour que les gestes de la fin restent à l'écran. */}
      <details className="spoken">
        <summary>{t('Comment c\'est mesuré')}</summary>
        {entry.paused_s > 0 && (
          <p className="muted small">{t('Chrono arrêté {v1} — feux, pauses : le temps ci-dessus est celui en mouvement.', { v1: duration(entry.paused_s) })}</p>
        )}
        {entry.rerouted && <p className="muted small">{t('Un nouveau chemin a été calculé en route.')}</p>}
        {entry.actual_ascent_m == null ? (
          <p className="muted small">{t('Pas de dénivelé mesuré : ni le baromètre ni le GPS du téléphone n\'ont donné l\'altitude pendant cette sortie.')}</p>
        ) : (
          <AscentNote entry={entry} />
        )}
        <p className="muted small">{t('Tout est dans « Mes parcours ». La trace reste sur l\'appareil : la sauvegarde de « Mon compte » l\'emporte avec le reste.')}</p>
      </details>

      {/* Le départ a été annoncé : le retour se dit d'un geste, ici, où l'on
          arrive. Pas tout seul — « Terminer » peut venir d'ailleurs que de
          la porte, et un « tout va bien » parti trop tôt rassurerait à tort. */}
      {announcing() && (
        <button className="btn" onClick={() => textTo(contactOf(), arrivalText(entry), t('Lacet — de retour'))}>
          <Icon name="check" size={16} />{t('Prévenir que je suis de retour')}</button>
      )}

      <div className="summary__actions">
        <button className="btn summary__share" onClick={() => setSharing(true)} aria-label={t('Partager la sortie en image')}>
          <Icon name="share" size={17} />{t('Partager')}</button>
        <button className="btn btn--primary" onClick={onClose}>{t('Terminer')}</button>
      </div>

      {/* L'arrivée s'est déclenchée d'elle-même : si c'était trop tôt, on repart
          sans rien perdre. */}
      {entry.arrived && onContinue && (
        <button className="linkish" onClick={onContinue}>{t('Pas fini ? Reprendre la sortie')}</button>
      )}
    </div>
  )
}

const bestLabel = ({ km: n, seconds }) =>
  n === 1 ? t('Ton kilomètre le plus rapide : {v1}', { v1: pace(seconds) }) : t('Ton meilleur {n} km : {v2}', { n, v2: duration(seconds) })

// L'écart au plan qui se dit comme une réussite : au-delà, c'est un détour ou
// un raccourci, et `PlanGap` le montre sans le fêter.
const ON_PLAN_M = 150

/**
 * Ce que la sortie vaut, en une phrase — ou `null` quand il n'y a rien à dire
 * de vrai. Du plus parlant au moins : se comparer à soi sur ce chemin, un
 * record, la plus longue, puis la distance tenue.
 */
export function verdictOf({ rang, bests, best, gap }) {
  if (rang?.record) return t('Ton meilleur passage ici, sur {count}', { count: rang.count })
  if (rang) {
    const s = Math.abs(rang.vsPrevious)
    if (s < 2) return t('La même allure que la dernière fois ici')
    return t('{s} s/km {v2} que la dernière fois ici', { s, v2: rang.vsPrevious < 0 ? t('plus vite') : t('plus lent') })
  }
  if (bests.length) return bestLabel(bests[bests.length - 1])
  if (best.list.includes('longest')) return t('Ta plus longue sortie')
  if (gap !== null && Math.abs(gap) <= ON_PLAN_M) return t('À {v1} m de la distance prévue', { v1: Math.abs(Math.round(gap)) })
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
