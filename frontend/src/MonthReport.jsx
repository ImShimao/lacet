import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { duration, km } from './format'
import { shareText } from './contact'
import { monthLabel, monthSummary } from './monthSummary'
import { shareMonthCard } from './shareCard'

/**
 * Le bilan d'un mois, ouvert depuis Mes parcours. Il lit `monthSummary`, comme la
 * carte partagée : un seul calcul pour l'écran et l'image.
 *
 * Le partage passe par la feuille d'iOS, comme l'écran de fin d'une sortie ; si
 * l'image ne se fait pas, le texte part à sa place.
 */
export default function MonthReport({ history, month, onClose }) {
  const summary = useMemo(() => monthSummary(history, month), [history, month])
  const label = monthLabel(month)
  const { active, total } = summary.weeks

  const share = async () => {
    try {
      await shareMonthCard(summary, label)
    } catch (error) {
      if (/cancel/i.test(error?.message || '')) return
      shareText(
        [
          `${label} — ${km(summary.distance_m, 1)} km en ${summary.count} sortie${summary.count > 1 ? 's' : ''}`,
          summary.ascent_m != null ? `D+ ${summary.ascent_m} m` : null,
          `${active} semaine${active > 1 ? 's' : ''} sur ${total} avec une sortie`,
        ]
          .filter(Boolean)
          .join(' · ') + ' — avec Lacet',
        'Mon bilan du mois',
      )
    }
  }

  return (
    <div className="panel summary">
      <div className="summary__hero">
        <b>{label}</b>
        <em>Bilan du mois</em>
      </div>

      {summary.count === 0 ? (
        <p className="muted">Aucune sortie ce mois-ci.</p>
      ) : (
        <>
          <div className="summary__big">
            <b>{km(summary.distance_m)}</b>
            <span>KILOMÈTRES</span>
          </div>
          <div className="stats stats--four">
            <div>
              <b>{summary.count}</b>
              <span>{summary.count > 1 ? 'sorties' : 'sortie'}</span>
            </div>
            <div>
              <b>{duration(summary.time_s)}</b>
              <span>de course</span>
            </div>
            <div>
              <b>{summary.ascent_m != null ? `${summary.ascent_m} m` : '—'}</b>
              <span>Dénivelé +</span>
            </div>
            <div>
              <b>{summary.longest ? km(summary.longest.actual_distance_m, 1) : '—'}</b>
              <span>km, plus longue</span>
            </div>
          </div>
          <p className="muted small">
            Régularité : {active} semaine{active > 1 ? 's' : ''} sur {total} avec une sortie.
          </p>
        </>
      )}

      <div className="row">
        <button className="btn" onClick={onClose}>
          Retour
        </button>
        {summary.count > 0 && (
          <button className="btn btn--primary" onClick={share}>
            <Icon name="share" size={17} />
            Partager
          </button>
        )}
      </div>
    </div>
  )
}
