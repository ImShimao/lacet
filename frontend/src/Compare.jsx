/**
 * Deux propositions face à face. Ouvrir l'une, retenir ses chiffres, revenir,
 * ouvrir l'autre : on comparait de tête. Ici, la proposition affichée contre
 * une autre au choix, les lignes qui les départagent — la meilleure valeur en
 * avant — et une phrase qui dit ce que chacune gagne. Sur la carte, l'autre
 * reste en fantôme à côté du tracé affiché.
 */
import { useState } from 'react'
import Icon from './Icon'
import { compareRoutes } from './explain'

export default function Compare({ routes, selected, onSelect, onClose }) {
  const others = routes.filter((r) => r.id !== selected.id)
  const [otherId, setOtherId] = useState(others[0]?.id)
  const other = others.find((r) => r.id === otherId) ?? others[0]
  if (!other) return null
  const n = (r) => routes.indexOf(r) + 1
  const { rows, verdict } = compareRoutes(selected, other, { nameA: `la ${n(selected)}`, nameB: `la ${n(other)}` })

  return (
    <section className="sendsheet compare" aria-label="Comparer deux propositions">
      <header className="sendsheet__head">
        <span>
          <em>Comparer</em>
          <b>
            La {n(selected)} contre la {n(other)}
          </b>
        </span>
        <button className="sendsheet__close" onClick={onClose} aria-label="Fermer la comparaison">
          <Icon name="close" size={16} />
        </button>
      </header>
      {others.length > 1 && (
        <div className="compare__pick" role="group" aria-label="Comparer avec">
          {others.map((r) => (
            <button key={r.id} aria-pressed={r.id === other.id} onClick={() => setOtherId(r.id)}>
              {n(r)}
            </button>
          ))}
        </div>
      )}
      <table className="compare__table">
        <thead>
          <tr>
            <td />
            <th scope="col">La {n(selected)}</th>
            <th scope="col">La {n(other)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className={r.best === 'a' ? 'compare__best' : undefined}>{r.a}</td>
              <td className={r.best === 'b' ? 'compare__best' : undefined}>{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="compare__verdict">{verdict}</p>
      <button className="btn btn--ghost" onClick={() => onSelect(other)}>
        Voir la {n(other)}
      </button>
    </section>
  )
}
