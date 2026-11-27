/**
 * La page « Séance fractionnée » de Mon compte : la séance se voit avant de se
 * régler.
 *
 * La page n'était qu'une colonne de huit menus — « Répétitions 2 »,
 * « Effort 400 m »… — et rien ne montrait ce que tout cela donnait une fois
 * mis bout à bout. La séance se dessine maintenant en tête, à l'échelle du
 * temps : l'échauffement, chaque effort, chaque récupération, le retour au
 * calme, avec la durée et la distance qu'elle prendra à ton allure. Dessous,
 * des séries qu'on ajoute ou qu'on retire — « 6 × 400 m, puis 3 × 1 km » —, ce
 * qu'une seule série ne savait pas dire.
 */

import { useState } from 'react'
import { ActionRow, PickRow, PrefsCard, ToggleRow } from './Prefs.jsx'
import { save } from './storage'
import { km } from './format'
import { unitLabel } from './units'
import { t } from './i18n'
import { CUSTOM_DEFAULTS, MAX_SERIES, SERIES_DEFAULTS, WORKOUT_PRESETS, customFromPreset, customSeries, estimate, shortAmount, workoutSettings } from './workout'

const WARMUPS = [0, 5, 10, 15, 20].map((n) => ({ key: n, label: n ? `${n} min` : t('Aucun') }))
const COOLDOWNS = [0, 5, 10].map((n) => ({ key: n, label: n ? `${n} min` : t('Aucun') }))

// Les réglages d'une série : des pas qu'un coach donnerait, de la côte courte
// au long fractionné.
const REPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => ({ key: n, label: `${n}` }))
const WORK_M = [100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 3000].map((m) => ({ key: m, label: shortAmount({ m }) }))
const WORK_S = [15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 480, 600].map((s) => ({ key: s, label: shortAmount({ s }) }))
const RESTS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((s) => ({ key: s, label: shortAmount({ s }) }))
const SET_RESTS = [0, ...RESTS.map((r) => r.key).filter((s) => s >= 60), 360, 480].map((s) => ({
  key: s,
  label: s ? shortAmount({ s }) : t('Comme les autres'),
}))

/** « 46 min », « 1 h 05 » : la durée d'une séance, à la minute. */
function minutes(seconds) {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/**
 * La séance fractionnée de la prochaine sortie : la voix dit chaque bloc, le
 * bandeau le bloc en cours (`workout.js`). Gardée allumée d'une sortie à
 * l'autre — c'est la semaine de piste —, à couper une fois la séance faite.
 */
export default function WorkoutSetting({ pace = 390 }) {
  const [prefs, setPrefs] = useState(workoutSettings)
  const change = (patch) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    save({ workout: next })
  }
  const custom = { ...CUSTOM_DEFAULTS, ...prefs.custom, series: customSeries(prefs.custom) }
  const setCustom = (patch) => change({ custom: { ...custom, ...patch } })
  const setSeries = (i, patch) => setCustom({ series: custom.series.map((x, k) => (k === i ? { ...x, ...patch } : x)) })

  return (
    <>
      <PrefsCard foot={t('Chaque bloc annoncé, prévenu avant sa fin, et chaque répétition chronométrée.')}>
        <ToggleRow icon="repeat" label={t('Guider une séance')} on={prefs.on} onChange={(on) => change({ on })} />
      </PrefsCard>

      {prefs.on && (
        <>
          <Timeline prefs={prefs} pace={pace} />

          <PrefsCard title={t('Séance')}>
            <PickRow
              icon="flame"
              label={t('Séance')}
              value={prefs.preset}
              options={[...WORKOUT_PRESETS.map((p) => ({ key: p.key, label: t(p.label) })), { key: 'custom', label: t('Personnalisée') }]}
              onChange={(preset) => change({ preset })}
            />
            {prefs.preset !== 'custom' && (
              <ActionRow
                icon="sliders"
                label={t('Modifier cette séance')}
                sub={t('Repartir de ce classique pour le retoucher')}
                onClick={() => change({ preset: 'custom', custom: customFromPreset(prefs.preset) })}
              />
            )}
          </PrefsCard>

          {prefs.preset === 'custom' && (
            <>
              {custom.series.map((x, i) => (
                <SeriesCard
                  key={i}
                  n={i + 1}
                  series={x}
                  onChange={(patch) => setSeries(i, patch)}
                  onRemove={custom.series.length > 1 ? () => setCustom({ series: custom.series.filter((_, k) => k !== i) }) : null}
                />
              ))}
              <PrefsCard>
                {custom.series.length < MAX_SERIES && (
                  <ActionRow
                    icon="plus"
                    label={t('Ajouter une série')}
                    // La nouvelle série reprend la dernière : on retouche un chiffre
                    // au lieu de tout régler de nouveau.
                    onClick={() => setCustom({ series: [...custom.series, { ...(custom.series.at(-1) ?? SERIES_DEFAULTS) }] })}
                  />
                )}
                {custom.series.length > 1 && (
                  <PickRow
                    icon="pause"
                    label={t('Entre deux séries')}
                    value={custom.set_rest_s ?? 0}
                    options={SET_RESTS}
                    onChange={(set_rest_s) => setCustom({ set_rest_s })}
                  />
                )}
              </PrefsCard>
            </>
          )}

          <PrefsCard title={t('Avant et après')}>
            <PickRow icon="clock" label={t('Échauffement')} value={prefs.warmup_min} options={WARMUPS} onChange={(warmup_min) => change({ warmup_min })} />
            <PickRow icon="clock" label={t('Retour au calme')} value={prefs.cooldown_min} options={COOLDOWNS} onChange={(cooldown_min) => change({ cooldown_min })} />
          </PrefsCard>
        </>
      )}
    </>
  )
}

/** Une série : combien de fois, quel effort, quelle récupération. */
function SeriesCard({ n, series, onChange, onRemove }) {
  const bySeconds = series.unit === 's'
  return (
    <PrefsCard title={t('Série {n}', { n })}>
      <PickRow icon="repeat" label={t('Répétitions')} value={series.reps} options={REPS} onChange={(reps) => onChange({ reps })} />
      <PickRow
        icon="gauge"
        label={t('Effort mesuré en')}
        value={series.unit}
        options={[
          { key: 'm', label: t('Distance') },
          { key: 's', label: t('Durée') },
        ]}
        onChange={(unit) => onChange({ unit })}
      />
      {bySeconds ? (
        <PickRow icon="flame" label={t('Effort')} value={series.work_s} options={WORK_S} onChange={(work_s) => onChange({ work_s })} />
      ) : (
        <PickRow icon="flame" label={t('Effort')} value={series.work_m} options={WORK_M} onChange={(work_m) => onChange({ work_m })} />
      )}
      <PickRow icon="clock" label={t('Récupération')} value={series.rest_s} options={RESTS} onChange={(rest_s) => onChange({ rest_s })} />
      {onRemove && <ActionRow icon="close" label={t('Retirer cette série')} danger onClick={onRemove} />}
    </PrefsCard>
  )
}

const LEGEND = [
  ['warmup', 'Échauffement'],
  ['work', 'Effort'],
  ['rest', 'Récupération'],
  ['cooldown', 'Retour au calme'],
]

/**
 * La séance à l'échelle du temps : un bloc par effort ou récupération, large
 * de ce qu'il dure. On voit d'un coup d'œil un échauffement trop court ou des
 * récupérations plus longues que l'effort.
 */
function Timeline({ prefs, pace }) {
  const e = estimate(prefs, pace)
  const kinds = new Set(e.blocks.map((b) => b.kind))
  return (
    <section className="wtl" aria-label={t('Aperçu de la séance')}>
      <div className="wtl__head">
        <b>≈ {minutes(e.seconds)}</b>
        <span>
          {t('≈ {v1} {v2} · {reps} répétition{v4}', { v1: km(e.metres, 1), v2: unitLabel(), reps: e.reps, v4: e.reps > 1 ? 's' : '' })}
        </span>
      </div>
      <div className="wtl__bar" aria-hidden="true">
        {e.blocks.map((b, i) => (
          <i key={i} className={`wtl__b wtl__b--${b.kind}`} style={{ flexGrow: b.secs }} />
        ))}
      </div>
      <ul className="wtl__legend">
        {LEGEND.filter(([k]) => kinds.has(k)).map(([k, label]) => (
          <li key={k}>
            <i className={`wtl__dot wtl__b--${k}`} />
            {t(label)}
          </li>
        ))}
      </ul>
    </section>
  )
}
