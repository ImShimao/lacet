import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { duration, km } from './format'
import { shareText } from './contact'
import { monthLabel, monthSummary } from './monthSummary'
import { shareMonthCard } from './shareCard'
import { unitLabel } from './units'

import { t } from './i18n'
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
          t('{label} — {v2} {v3} en {count} sortie{v5}', { label, v2: km(summary.distance_m, 1), v3: unitLabel(), count: summary.count, v5: summary.count > 1 ? 's' : '' }),
          summary.ascent_m != null ? `D+ ${summary.ascent_m} m` : null,
          t('{active} semaine{v2} sur {total} avec une sortie', { active, v2: active > 1 ? 's' : '', total }),
        ]
          .filter(Boolean)
          .join(' · ') + t(' — avec Lacet'),
        t('Mon bilan du mois'),
      )
    }
  }

  return (
    <div className="panel summary">
      <div className="summary__hero">
        <b>{label}</b>
        <em>{t('Bilan du mois')}</em>
      </div>

      {summary.count === 0 ? (
        <p className="muted">{t('Aucune sortie ce mois-ci.')}</p>
      ) : (
        <>
          <div className="summary__big">
            <b>{km(summary.distance_m)}</b>
            <span>{t('KILOMÈTRES')}</span>
          </div>
          <div className="stats stats--four">
            <div>
              <b>{summary.count}</b>
              <span>{summary.count > 1 ? t('sorties') : t('sortie')}</span>
            </div>
            <div>
              <b>{duration(summary.time_s)}</b>
              <span>{t('de course')}</span>
            </div>
            <div>
              <b>{summary.ascent_m != null ? `${summary.ascent_m} m` : '—'}</b>
              <span>{t('Dénivelé +')}</span>
            </div>
            <div>
              <b>{summary.longest ? km(summary.longest.actual_distance_m, 1) : '—'}</b>
              <span>{t('km, plus longue')}</span>
            </div>
          </div>
          <p className="muted small">{t('Régularité : {active} semaine{v2} sur {total} avec une sortie.', { active, v2: active > 1 ? 's' : '', total })}</p>
        </>
      )}

      <div className="row">
        <button className="btn" onClick={onClose}>{t('Retour')}</button>
        {summary.count > 0 && (
          <button className="btn btn--primary" onClick={share}>
            <Icon name="share" size={17} />{t('Partager')}</button>
        )}
      </div>
    </div>
  )
}
