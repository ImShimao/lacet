/**
 * Séries et défis, dans « Mes parcours » : les semaines d'affilée, les jours
 * quand il y en a, et le défi du mois — le palier suivant, ce qui reste, et
 * le rythme qu'il demande. Le calcul est dans `streaks.js`.
 */
import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { monthChallenge, streaks } from './streaks'
import { km } from './format'
import { unitLabel } from './units'

import { t } from './i18n'
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

export default function Challenges({ history, sport = 'run', now = null }) {
  const s = useMemo(() => streaks(history, now ?? new Date()), [history, now])
  const c = useMemo(() => monthChallenge(history, sport, now ?? new Date()), [history, sport, now])
  if (!history?.length) return null

  // Ce que la série demande maintenant : la lancer, la tenir, ou rien — elle est tenue.
  const weekNote = !s.weeks.current
    ? t('Une sortie cette semaine lance une série.')
    : s.ranThisWeek
      ? t('Tenue cette semaine.')
      : t('Une sortie avant dimanche la garde.')
  const left = c.target ? c.target * 1000 - c.km * 1000 : 0

  return (
    <section className="challenges" aria-label={t('Séries et défis')}>
      <div className="challenges__streaks">
        <div className="challenges__streak">
          <Icon name="flame" size={18} />
          <b>{s.weeks.current}</b>
          <span>
            {s.weeks.current > 1 ? t('semaines d\'affilée') : t('semaine')}
            <em>
              {weekNote}
              {s.weeks.best > s.weeks.current && t(' Record : {best}.', { best: s.weeks.best })}
            </em>
          </span>
        </div>
        {s.days.current >= 2 && (
          <div className="challenges__streak">
            <Icon name="repeat" size={18} />
            <b>{s.days.current}</b>
            <span>{t('jours d\'affilée')}<em>{s.ranToday ? t('Aujourd’hui compte déjà.') : t('Sors aujourd’hui pour la prolonger.')}</em>
            </span>
          </div>
        )}
      </div>

      <div className="challenges__month">
        <div className="challenges__head">
          <span className="label">{t('Défi de {month}', { month: c.month })}</span>
          <em>{c.target ? `${km(c.target * 1000, 0)} ${unitLabel()}` : t('tous les paliers atteints')}</em>
        </div>
        <div
          className="challenges__bar"
          role="progressbar"
          aria-label={t('Défi de {month}', { month: c.month })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, c.share) * 100)}
        >
          <i style={{ width: `${Math.min(1, c.share) * 100}%` }} />
        </div>
        <p className="muted small">{t('{v1} {v2} en {v3}{v4}{v5}', { v1: km(c.km * 1000, 0), v2: unitLabel(), v3: plural(c.runs, 'sortie', 'sorties'), v4: c.reached && t(' · palier {v1} atteint', { v1: km(c.reached * 1000, 0) }), v5: c.target
            ? t(' · encore {v1} {v2} en {v3}, soit {v4} par jour.', { v1: km(left, 0), v2: unitLabel(), v3: plural(c.daysLeft, 'jour', 'jours'), v4: km(c.perDayKm * 1000, 1) })
            : '.' })}</p>
      </div>
    </section>
  )
}
