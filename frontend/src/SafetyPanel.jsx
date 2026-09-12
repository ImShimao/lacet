import { percent } from './format'

/**
 * Le détail de la note. C'est l'écran qui porte la promesse du produit :
 * il ne suffit pas d'afficher « A », il faut montrer sur quoi elle repose.
 */
export default function SafetyPanel({ safety, surfaces, distance, sport = 'run' }) {
  const rows = [
    {
      // Ce qui protège un cycliste n'est pas ce qui protège un coureur : le
      // trottoir ne lui sert à rien, la bande cyclable si.
      label: sport === 'bike' ? 'Aménagement cyclable' : 'Trottoir ou voie propre',
      value: percent(safety.protected_share),
      // Volontairement sans couleur : c'est un renseignement, pas un verdict.
      // Un parcours à 46 % de voie dédiée mais zéro mètre d'exposition est un
      // bon parcours ; le peindre en rouge donnerait une fausse alerte.
      tone: null,
      hint: 'part du parcours séparée du trafic',
    },
    {
      label: 'Exposé au trafic rapide',
      hint:
        safety.longest_exposed_m > 0
          ? `dont ${Math.round(safety.longest_exposed_m)} m d'un seul tenant`
          : 'route à 80 km/h ou plus, sans trottoir ni accotement',
      value: `${Math.round(safety.exposed_m)} m`,
      tone: safety.exposed_m === 0 ? 'good' : safety.exposed_share <= 0.03 ? 'warn' : 'bad',
    },
    {
      label: 'Traversées non protégées',
      value: String(safety.unprotected_crossings),
      hint:
        safety.protected_crossings > 0
          ? `${safety.protected_crossings} protégée(s) par ailleurs`
          : null,
      tone: safety.unprotected_crossings === 0 ? 'good' : 'warn',
    },
  ]

  if (safety.unlit_m !== null && safety.unlit_m !== undefined) {
    rows.push({
      label: 'Non éclairé',
      value: `${Math.round(safety.unlit_m)} m`,
      tone: safety.unlit_m === 0 ? 'good' : 'warn',
    })
  }

  const surfaceRows = [
    ['paved', 'Route', surfaces.paved_m],
    ['gravel', 'Chemin', surfaces.gravel_m],
    ['trail', 'Sentier', surfaces.trail_m],
    ['unknown', 'Indéterminé', surfaces.unknown_m],
  ].filter(([, , metres]) => metres > 1)

  return (
    <div className="safety">
      <div className="safety__rows">
        {rows.map((row) => (
          <div key={row.label} className="safety__row">
            <span className="safety__label">
              {row.label}
              {row.hint && <em>{row.hint}</em>}
            </span>
            <span
              className={`safety__value ${row.tone ? `safety__value--${row.tone}` : ''}`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="bar" role="img" aria-label="Répartition des revêtements">
        {surfaceRows.map(([key, , metres]) => (
          <span
            key={key}
            className={`s--${key}`}
            style={{ width: `${(metres / distance) * 100}%` }}
          />
        ))}
      </div>
      <div className="bar__legend">
        {surfaceRows.map(([key, label, metres]) => (
          <span key={key} className="bar__key">
            <i className={`s--${key}`} />
            {label} {percent(metres / distance)}
          </span>
        ))}
      </div>

      {safety.notes.map((note, i) => (
        <p key={i} className="safety__note">
          {note}
        </p>
      ))}
    </div>
  )
}
