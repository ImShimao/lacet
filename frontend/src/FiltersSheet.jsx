import { useState } from 'react'
import useModal from './useModal'
import Icon from './Icon.jsx'
import { InfoButton } from './Explain.jsx'
import { pace } from './format'

export const SPORTS = [
  { key: 'run', label: 'Course', icon: 'run' },
  { key: 'bike', label: 'Vélo', icon: 'bike' },
]

// Le vocabulaire du terrain change avec le sport : « sentier » à pied, « VTT »
// à vélo. Le moteur, lui, reçoit la même valeur.
export const TERRAINS = {
  run: [
    { key: 'road', label: 'Route', icon: 'road' },
    { key: 'mixed', label: 'Mixte', icon: 'forest' },
    { key: 'trail', label: 'Sentier', icon: 'mountain' },
  ],
  bike: [
    { key: 'road', label: 'Route', icon: 'road' },
    { key: 'mixed', label: 'Mixte', icon: 'forest' },
    { key: 'trail', label: 'VTT', icon: 'mountain' },
  ],
}

const RELIEFS = [
  { key: 'flat', label: 'Plat', icon: 'flat' },
  { key: 'rolling', label: 'Vallonné', icon: 'rolling' },
  { key: 'hilly', label: 'Côtes', icon: 'hilly' },
]
const SAFETY = [
  { key: 'safe', label: 'Sûr' },
  { key: 'standard', label: 'Standard' },
]
const MOMENTS = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Jour' },
  { key: 'night', label: 'Nuit' },
]

// Nombre d'itinéraires proposés. Trois, c'était trop peu pour choisir : on
// prend le premier faute d'alternative. Au-delà de huit, la liste cesse d'être
// un choix et devient un catalogue qu'on ne lit plus.
const COUNTS = [
  { key: 3, label: '3' },
  { key: 5, label: '5' },
  { key: 8, label: '8' },
  { key: 12, label: '12' },
]

// Plafonds par sport — au-delà, l'extrait de carte à télécharger devient
// démesuré. Le backend applique les mêmes limites.
const MAX_KM = { run: 60, bike: 250 }
const MIN_KM = 0.5
const MAX_MIN = 900
const MIN_MIN = 10

export const DEFAULTS = {
  sport: 'run',
  mode: 'distance',
  distance_km: 10,
  duration_min: 60,
  surface: 'mixed',
  elevation: 'rolling',
  safety: 'safe',
  time_of_day: 'auto',
  paceCustom: false,
  pace_sec_per_km: 390,
  speed_kmh: 20,
  speedUnit: 'pace',
  count: 5,
  // Servent seulement aux estimations de calories et de pas (onglet compte).
  weight_kg: 70,
  height_cm: 175,
}

/**
 * Pas d'incrément de la distance.
 *
 * Un pas fixe d'un kilomètre est trop grossier en bas de gamme — entre 3 et
 * 4 km il y a un monde — et ridicule en haut : personne ne règle une sortie
 * vélo de 180 km au kilomètre près. Le pas suit donc l'ordre de grandeur.
 */
function distanceStep(km) {
  if (km < 5) return 0.25
  if (km < 15) return 0.5
  if (km < 40) return 1
  return 5
}

function durationStep(min) {
  return min < 120 ? 5 : 15
}

export default function FiltersSheet({ value, onApply, onClose }) {
  const [draft, setDraft] = useState(value)
  const panel = useModal(onClose)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const isBike = draft.sport === 'bike'
  const maxKm = MAX_KM[draft.sport]

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Filtres de recherche"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <span />
          <h2>Filtres</h2>
          <button
            className="modal__reset"
            onClick={() => setDraft({ ...DEFAULTS, sport: draft.sport })}
          >
            Réinitialiser
          </button>
        </div>

        <div className="modal__body">
          <Field label="Activité" info="sport" sport={draft.sport}>
            <div className="tiles">
              {SPORTS.map((s) => (
                <Tile
                  key={s.key}
                  label={s.label}
                  icon={s.icon}
                  on={draft.sport === s.key}
                  // Le focus d'ouverture tombe sur l'activité choisie, pas sur
                  // « Réinitialiser », premier bouton dans l'ordre du document.
                  focusFirst={draft.sport === s.key}
                  onClick={() =>
                    set({
                      sport: s.key,
                      speedUnit: s.key === 'bike' ? 'speed' : 'pace',
                      distance_km: Math.min(draft.distance_km, MAX_KM[s.key]),
                    })
                  }
                />
              ))}
            </div>
          </Field>

          <Field label="Terrain" info="terrain" sport={draft.sport}>
            <div className="tiles">
              {TERRAINS[draft.sport].map((t) => (
                <Tile
                  key={t.key}
                  label={t.label}
                  icon={t.icon}
                  on={draft.surface === t.key}
                  onClick={() => set({ surface: t.key })}
                />
              ))}
            </div>
          </Field>

          <Field label="Paramètres">
            <Segmented
              options={[
                { key: 'duration', label: 'Durée' },
                { key: 'distance', label: 'Distance' },
              ]}
              value={draft.mode}
              onChange={(mode) => set({ mode })}
            />
            {draft.mode === 'distance' ? (
              <Stepper
                text={`${formatKm(draft.distance_km)} km`}
                editable={{
                  value: draft.distance_km,
                  suffix: 'km',
                  min: MIN_KM,
                  max: maxKm,
                  onCommit: (v) => set({ distance_km: round(clamp(v, MIN_KM, maxKm), 0.05) }),
                }}
                onStep={(d) => {
                  const step = distanceStep(draft.distance_km + (d > 0 ? 0 : -0.001))
                  set({
                    distance_km: round(clamp(draft.distance_km + d * step, MIN_KM, maxKm), step),
                  })
                }}
                canDown={draft.distance_km > MIN_KM}
                canUp={draft.distance_km < maxKm}
              />
            ) : (
              <Stepper
                text={formatMinutes(draft.duration_min)}
                onStep={(d) =>
                  set({
                    duration_min: clamp(
                      draft.duration_min + d * durationStep(draft.duration_min),
                      MIN_MIN,
                      MAX_MIN,
                    ),
                  })
                }
                canDown={draft.duration_min > MIN_MIN}
                canUp={draft.duration_min < MAX_MIN}
              />
            )}
            <p className="field__hint">
              {draft.mode === 'duration'
                ? `Converti en distance selon l'allure : environ ${formatKm(
                    estimateKm(draft),
                  )} km.`
                : `Pas de ${formatKm(distanceStep(draft.distance_km))} km · jusqu'à ${maxKm} km ${
                    isBike ? 'à vélo' : 'à pied'
                  }. Le champ est modifiable au clavier.`}
            </p>
          </Field>

          <Field label={isBike ? 'Vitesse' : 'Allure'}>
            <Segmented
              options={[
                { key: false, label: 'Par défaut' },
                { key: true, label: 'Personnalisée' },
              ]}
              value={draft.paceCustom}
              onChange={(paceCustom) => set({ paceCustom })}
            />
            {draft.paceCustom && (
              <>
                <div className="radios">
                  <button
                    aria-pressed={draft.speedUnit === 'pace'}
                    onClick={() => set({ speedUnit: 'pace' })}
                  >
                    <span />
                    min/km
                  </button>
                  <button
                    aria-pressed={draft.speedUnit === 'speed'}
                    onClick={() => set({ speedUnit: 'speed' })}
                  >
                    <span />
                    km/h
                  </button>
                </div>
                {draft.speedUnit === 'pace' ? (
                  <Stepper
                    text={`${pace(draft.pace_sec_per_km)} /km`}
                    onStep={(d) =>
                      set({ pace_sec_per_km: clamp(draft.pace_sec_per_km + d * 5, 150, 1200) })
                    }
                    canDown={draft.pace_sec_per_km > 150}
                    canUp={draft.pace_sec_per_km < 1200}
                  />
                ) : (
                  <Stepper
                    text={`${formatKm(draft.speed_kmh)} km/h`}
                    onStep={(d) => set({ speed_kmh: round(clamp(draft.speed_kmh + d * 0.5, 5, 60), 0.5) })}
                    canDown={draft.speed_kmh > 5}
                    canUp={draft.speed_kmh < 60}
                  />
                )}
              </>
            )}
            <p className="field__hint">
              {draft.mode === 'duration'
                ? 'Convertit la durée en distance, et sert à estimer le temps de sortie.'
                : 'Ne change pas le tracé — sert à estimer la durée de la sortie.'}
            </p>
          </Field>

          <Field label="Dénivelé" info="relief" sport={draft.sport}>
            <div className="tiles">
              {RELIEFS.map((r) => (
                <Tile
                  key={r.key}
                  label={r.label}
                  icon={r.icon}
                  on={draft.elevation === r.key}
                  onClick={() => set({ elevation: r.key })}
                />
              ))}
            </div>
          </Field>

          <Field label="Sécurité" info="safety" sport={draft.sport}>
            <Segmented
              options={SAFETY}
              value={draft.safety}
              onChange={(safety) => set({ safety })}
            />
            <p className="field__hint">
              {draft.safety === 'safe'
                ? "Écarte les itinéraires qui longent une route à 80 km/h ou plus sans trottoir ni accotement, ou qui la traversent sans passage protégé. Les rues à 50 et les routes à 70 restent proposées."
                : 'Montre aussi les itinéraires exposés, avec le détail des portions concernées.'}
            </p>
          </Field>

          <Field label="Moment" info="moment" sport={draft.sport}>
            <Segmented
              options={MOMENTS}
              value={draft.time_of_day}
              onChange={(time_of_day) => set({ time_of_day })}
            />
            <p className="field__hint">
              La nuit, priorité aux rues éclairées et fréquentées plutôt qu'aux chemins isolés.
            </p>
          </Field>

          <Field label="Propositions">
            <Segmented
              options={COUNTS}
              value={draft.count}
              onChange={(count) => set({ count })}
            />
            <p className="field__hint">
              L'app génère une trentaine de boucles, écarte celles qui échouent au
              contrôle, puis retient les meilleures — en veillant à ce qu'elles partent
              dans des directions différentes. En demander plus allonge un peu le calcul.
            </p>
          </Field>
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" onClick={() => onApply(draft)}>
            <Icon name="search" size={17} />
            Rechercher
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, info, sport, children }) {
  return (
    <div className="field">
      <div className="field__head">
        <span className="label">{label}</span>
        {info && <InfoButton topic={info} sport={sport} />}
      </div>
      {children}
    </div>
  )
}

function Tile({ label, icon, on, onClick, focusFirst = false }) {
  return (
    <button
      className={`tile ${on ? 'tile--on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
      data-autofocus={focusFirst || undefined}
    >
      <Icon name={icon} size={24} />
      {label}
    </button>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.key)} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Valeur avec incréments, et saisie directe quand elle est autorisée. */
function Stepper({ text, onStep, canDown, canUp, editable }) {
  const [typing, setTyping] = useState(null)

  const commit = () => {
    const parsed = parseFloat(String(typing).replace(',', '.'))
    if (Number.isFinite(parsed)) editable.onCommit(parsed)
    setTyping(null)
  }

  return (
    <div className="stepper">
      {editable && typing !== null ? (
        <input
          className="stepper__value stepper__input"
          value={typing}
          autoFocus
          inputMode="decimal"
          onChange={(e) => setTyping(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setTyping(null)
          }}
          aria-label="Valeur"
        />
      ) : (
        <button
          className={`stepper__value ${editable ? 'stepper__value--editable' : ''}`}
          onClick={() => editable && setTyping(String(editable.value))}
          disabled={!editable}
          title={editable ? 'Cliquer pour saisir une valeur' : undefined}
        >
          {text}
        </button>
      )}
      <div className="stepper__pad">
        <button onClick={() => onStep(-1)} disabled={!canDown} aria-label="Diminuer">
          <Icon name="minus" size={18} />
        </button>
        <button onClick={() => onStep(1)} disabled={!canUp} aria-label="Augmenter">
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  )
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v, step) => Math.round(v / step) * step

/** « 10 » plutôt que « 10.0 », mais « 10,5 » quand la décimale compte. */
function formatKm(v) {
  const rounded = Math.round(v * 100) / 100
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace('.', ',')
}

function formatMinutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export function estimateKm(params) {
  const secondsPerKm =
    params.sport === 'bike' || params.speedUnit === 'speed'
      ? 3600 / params.speed_kmh
      : params.pace_sec_per_km
  return (params.duration_min * 60) / secondsPerKm
}
