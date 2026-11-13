import { useState } from 'react'
import { describeSeance, normalizeSeance } from './seanceSpec'

/**
 * Le réglage de la séance, sur l'accueil : combien de répétitions, et chaque effort
 * et chaque récupération en mètres, en minutes ou en secondes. Les champs restent
 * à 16 px ou plus : sous cette taille, iOS zoome toute l'app au toucher.
 */

const UNITS = [
  ['m', 'mètres'],
  ['min', 'minutes'],
  ['s', 'secondes'],
]

// Dans le formulaire, une durée s'affiche en minutes quand elle tombe rond.
const toForm = ({ unit, value }) => {
  if (unit === 'm') return { u: 'm', v: value }
  if (value >= 60 && value % 60 === 0) return { u: 'min', v: value / 60 }
  return { u: 's', v: value }
}

// Le champ garde le texte saisi : converti en nombre à chaque frappe, un champ
// vidé affichait « 0 », et taper « 5 » donnait « 05 ». `normalizeSeance` borne.
const fromForm = ({ u, v }) => (u === 'min' ? { unit: 's', value: Math.round(Number(v) * 60) } : { unit: u, value: v })

function Amount({ label, value, onChange }) {
  return (
    <div className="seance-field">
      <span>{label}</span>
      <div className="seance-field__row">
        <input
          type="number"
          inputMode="decimal"
          min={1}
          value={value.v}
          onChange={(e) => onChange({ ...value, v: e.target.value })}
          aria-label={`${label}, valeur`}
        />
        <select value={value.u} onChange={(e) => onChange({ ...value, u: e.target.value })} aria-label={`${label}, unité`}>
          {UNITS.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default function SeancePanel({ spec, onStart }) {
  const [reps, setReps] = useState(spec.reps)
  const [effort, setEffort] = useState(() => toForm(spec.effort))
  const [rest, setRest] = useState(() => toForm(spec.rest))
  const current = () => normalizeSeance({ reps, effort: fromForm(effort), rest: fromForm(rest) })

  return (
    <div className="seance-panel">
      <label className="seance-field">
        <span>Répétitions</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          value={reps}
          onChange={(e) => setReps(e.target.value)}
        />
      </label>
      <Amount label="Effort" value={effort} onChange={setEffort} />
      <Amount label="Récupération" value={rest} onChange={setRest} />
      <p className="seance-panel__hint">{describeSeance(current())}</p>
      <button className="btn btn--primary btn--big" onClick={() => onStart(current())}>
        Lancer le fractionné
      </button>
    </div>
  )
}
