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

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

export default function Challenges({ history, sport = 'run', now = null }) {
  const s = useMemo(() => streaks(history, now ?? new Date()), [history, now])
  const c = useMemo(() => monthChallenge(history, sport, now ?? new Date()), [history, sport, now])
  if (!history?.length) return null

  // Ce que la série demande maintenant : la lancer, la tenir, ou rien — elle est tenue.
  const weekNote = !s.weeks.current
    ? 'Une sortie cette semaine lance une série.'
    : s.ranThisWeek
      ? 'Tenue cette semaine.'
      : 'Une sortie avant dimanche la garde.'
  const left = c.target ? c.target * 1000 - c.km * 1000 : 0

  return (
    <section className="challenges" aria-label="Séries et défis">
      <div className="challenges__streaks">
        <div className="challenges__streak">
          <Icon name="flame" size={18} />
          <b>{s.weeks.current}</b>
          <span>
            {s.weeks.current > 1 ? "semaines d'affilée" : 'semaine'}
            <em>
              {weekNote}
              {s.weeks.best > s.weeks.current && ` Record : ${s.weeks.best}.`}
            </em>
          </span>
        </div>
        {s.days.current >= 2 && (
          <div className="challenges__streak">
            <Icon name="repeat" size={18} />
            <b>{s.days.current}</b>
            <span>
              jours d'affilée
              <em>{s.ranToday ? 'Aujourd’hui compte déjà.' : 'Sors aujourd’hui pour la prolonger.'}</em>
            </span>
          </div>
        )}
      </div>

      <div className="challenges__month">
        <div className="challenges__head">
          <span className="label">Défi de {c.month}</span>
          <em>{c.target ? `${km(c.target * 1000, 0)} ${unitLabel()}` : 'tous les paliers atteints'}</em>
        </div>
        <div
          className="challenges__bar"
          role="progressbar"
          aria-label={`Défi de ${c.month}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, c.share) * 100)}
        >
          <i style={{ width: `${Math.min(1, c.share) * 100}%` }} />
        </div>
        <p className="muted small">
          {km(c.km * 1000, 0)} {unitLabel()} en {plural(c.runs, 'sortie', 'sorties')}
          {c.reached && ` · palier ${km(c.reached * 1000, 0)} atteint`}
          {c.target
            ? ` · encore ${km(left, 0)} ${unitLabel()} en ${plural(c.daysLeft, 'jour', 'jours')}, soit ${km(c.perDayKm * 1000, 1)} par jour.`
            : '.'}
        </p>
      </div>
    </section>
  )
}
