import { useState } from 'react'
import useModal from './useModal'
import Icon from './Icon.jsx'
import { InfoButton } from './Explain.jsx'
import { climbBand } from './explain'
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
export const MOMENTS = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Jour' },
  { key: 'night', label: 'Nuit' },
]

/**
 * Le côté où partir : vers la forêt plutôt que vers la zone commerciale, dos au
 * vent du retour, du côté où l'on n'est pas allé hier. Une boucle part « vers le
 * nord » quand son centre de gravité tombe à moins de 45° du nord — la direction
 * que disent les cartes. « Auto » les répartit tout autour du départ, comme
 * avant ; `deg` est le cap envoyé au moteur (`heading`).
 */
export const DIRECTIONS = [
  { key: 'auto', label: 'Auto' },
  { key: 'N', label: 'N', title: 'Nord', toward: 'vers le nord', deg: 0 },
  { key: 'NE', label: 'NE', title: 'Nord-est', toward: 'vers le nord-est', deg: 45 },
  { key: 'E', label: 'E', title: 'Est', toward: "vers l'est", deg: 90 },
  { key: 'SE', label: 'SE', title: 'Sud-est', toward: 'vers le sud-est', deg: 135 },
  { key: 'S', label: 'S', title: 'Sud', toward: 'vers le sud', deg: 180 },
  { key: 'SO', label: 'SO', title: 'Sud-ouest', toward: 'vers le sud-ouest', deg: 225 },
  { key: 'O', label: 'O', title: 'Ouest', toward: "vers l'ouest", deg: 270 },
  { key: 'NO', label: 'NO', title: 'Nord-ouest', toward: 'vers le nord-ouest', deg: 315 },
]

/**
 * La forme de la sortie : le moteur la choisissait seul — une boucle entière, et
 * des tours ou un « 8 » faute de mieux. Une forme choisie est tenue strictement
 * (`LoopRequest.form`) : plutôt rien, et le dire, qu'une autre.
 */
export const FORMS = [
  // Nommé pour lui-même : la direction a aussi son « Auto ».
  { key: 'auto', label: 'Auto', title: 'Forme auto' },
  { key: 'loop', label: '1 boucle' },
  { key: 'eight', label: '2 boucles' },
  { key: 'laps', label: 'Tours' },
]
// Le moteur accepte de deux à dix tours, d'au moins 1,5 km chacun
// (`MIN_LAP_M`) : en dessous, ce n'est plus une boucle mais de la piste.
export const MAX_LAPS = 10
const MIN_LAP_KM = 1.5

/** La direction choisie, ou `null` pour « Auto » et une valeur inconnue. */
export const directionOf = (key) => DIRECTIONS.find((d) => d.key === key && d.deg !== undefined) ?? null

// Nombre d'itinéraires proposés. Trois, c'était trop peu pour choisir : on
// prend le premier faute d'alternative. Au-delà de huit, la liste cesse d'être
// un choix et devient un catalogue qu'on ne lit plus.
export const COUNTS = [
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

/**
 * Les distances de course, au mètre près.
 *
 * Un semi ne fait pas « environ 21 km » : il fait 21,0975 km, et préparer
 * l'épreuve demande de courir cette distance-là, pas une approximation. Les
 * choisir resserre aussi la tolérance (voir `PRECISE_TOLERANCE`) : une boucle
 * à ±10 % d'un marathon, c'est quatre kilomètres d'écart.
 */
export const RACES = [
  { key: '5k', km: 5, label: '5 km' },
  { key: '10k', km: 10, label: '10 km' },
  { key: 'semi', km: 21.0975, label: 'Semi', detail: '21,097 km' },
  { key: 'marathon', km: 42.195, label: 'Marathon', detail: '42,195 km' },
]

/** La distance de course qui correspond, à dix mètres près. */
export const raceOf = (km) => RACES.find((r) => Math.abs(r.km - km) < 0.01) ?? null

/**
 * Les durées qu'on se donne vraiment : la demi-heure de semaine, les
 * trois quarts d'heure, l'heure, et la sortie longue. Composer 1 h 30 au pas de
 * cinq minutes demandait dix-huit appuis.
 */
export const DURATIONS = [30, 45, 60, 90]

/**
 * Ce qu'on peut refuser de croiser.
 *
 * Deux cases, et pas dix : chacune doit répondre à une gêne qu'on a vraiment
 * eue — les cent mètres de dénivelé avalés dans un escalier, le chemin noir à
 * dix-huit heures en décembre. Les clés sont celles de `AVOIDS`, dans
 * `engine/weights.js`.
 *
 * Il y en avait une troisième, « Grands axes » : la départementale sans
 * trottoir. Elle disait la même chose que « Sûr », avec le même critère — une
 * route à 80 sans trottoir ni accotement —, et personne ne voyait la
 * différence entre les deux. « Sûr » l'a absorbée (voir `toRequest`).
 *
 * Ce qui manque à cette liste, et qu'aucune donnée ne donne : le portail fermé
 * et le chantier d'hier. Ceux-là ne s'évitent qu'une fois vus — c'est ce que
 * fait le bouton « Signaler » pendant la sortie.
 */
export const AVOIDABLE = [
  { key: 'steps', label: 'Escaliers', hint: 'Les volées de marches', sport: 'run' },
  { key: 'unlit', label: 'Rues non éclairées', hint: 'Seulement celles données comme telles' },
]

export const DEFAULTS = {
  sport: 'run',
  mode: 'distance',
  distance_km: 10,
  duration_min: 60,
  surface: 'mixed',
  elevation: 'rolling',
  // Un D+ visé, en mètres — « environ 150 m » —, à la place des trois tuiles.
  climb_m: null,
  safety: 'safe',
  time_of_day: 'auto',
  pace_sec_per_km: 390,
  speed_kmh: 20,
  speedUnit: 'pace',
  count: 5,
  // Ce qu'on refuse de croiser. Vide par défaut : chaque évitement rallonge
  // les boucles, et l'imposer à qui ne l'a pas demandé serait décider à sa
  // place — un escalier est parfois le raccourci qu'on cherche.
  avoid: [],
  // Pistes, chemins et allées d'abord, la route quand il le faut — voir
  // `engine/weights.js`. Coché par défaut : c'est ce qu'on cherche en sortant
  // courir, et la sécurité seule ne départageait pas une piste d'une rue à 30.
  carfree: true,
  // Distance exacte : ±2,5 % au lieu de ±10 %. Réservé à qui vise une distance
  // précise — plus c'est serré, moins il y a de boucles qui conviennent.
  precise: false,
  // Tout autour du départ : imposer un côté, c'est renoncer aux meilleures
  // boucles des trois autres.
  direction: 'auto',
  // Le moteur choisit, et le nombre de tours proposé quand on en demande.
  form: 'auto',
  laps: 2,
  // Sert seulement à estimer les calories d'une sortie (onglet compte).
  weight_kg: 70,
  // Les filtres retirés du panneau (`OPTIONAL_FILTERS`). Vide : tout s'affiche,
  // comme avant que le choix existe.
  hiddenFilters: [],
}

/**
 * Les filtres qu'on peut retirer du panneau, depuis « Mon compte › Recherche ».
 *
 * Qui court toujours sur la route, sans jamais toucher au cap, fait défiler
 * Terrain et Direction à chaque sortie pour atteindre « Rechercher ». La
 * longueur et l'allure ne sont pas dans la liste : sans elles, aucune
 * recherche n'a de sens.
 *
 * Un filtre masqué revient à sa valeur par défaut (`reset`), et la case le dit
 * (`fixed`). Le garder sur la valeur choisie avant de le masquer, c'était
 * chercher des boucles « Sentier » sans plus jamais voir le mot nulle part.
 * Seule l'activité garde la sienne : un cycliste qui masque le choix veut rester
 * à vélo, et le bouton Filtres le dit en km/h.
 */
export const OPTIONAL_FILTERS = [
  { key: 'sport', label: 'Activité', hint: 'Course ou vélo.', fixed: "L'activité du moment est gardée." },
  {
    key: 'form',
    label: 'Forme',
    hint: 'Une boucle, deux boucles ou des tours.',
    fixed: 'Auto.',
    reset: { form: DEFAULTS.form },
  },
  {
    key: 'terrain',
    label: 'Terrain',
    hint: 'Route, mixte ou sentier, et les voies sans voitures.',
    fixed: 'Mixte, voies sans voitures d’abord.',
    reset: { surface: DEFAULTS.surface, carfree: DEFAULTS.carfree },
  },
  {
    key: 'relief',
    label: 'Dénivelé',
    hint: 'Plat, vallonné, côtes, ou un D+ précis.',
    fixed: 'Vallonné.',
    reset: { elevation: DEFAULTS.elevation, climb_m: null },
  },
  {
    key: 'direction',
    label: 'Direction',
    hint: 'Le côté du départ où partir.',
    fixed: 'Auto.',
    reset: { direction: DEFAULTS.direction },
  },
  {
    key: 'safety',
    label: 'Sécurité',
    hint: 'Sûr, ou montrer aussi les boucles exposées.',
    fixed: 'Sûr.',
    reset: { safety: DEFAULTS.safety },
  },
  {
    key: 'avoid',
    label: 'Éviter',
    hint: 'Escaliers, rues non éclairées.',
    fixed: 'Rien n’est évité.',
    reset: { avoid: [] },
  },
]

// Ce que « Réinitialiser » ne touche pas : ce qui se règle dans « Mon compte »,
// pas dans ce panneau. Il remettait à 5 les douze propositions choisies là-bas,
// et aurait réaffiché les filtres masqués.
const KEPT_ON_RESET = ['sport', 'weight_kg', 'time_of_day', 'count', 'hiddenFilters']

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

// Le D+ visé : au-delà, le moteur refuse (`normalizeRequest`).
const MAX_CLIMB = 5000

/** Dix mètres en bas, cinquante en montagne : comme la distance, le pas suit la valeur. */
function climbStep(m) {
  if (m < 200) return 10
  if (m < 500) return 25
  return 50
}

/**
 * Ce qui change le tracé, et rien d'autre.
 *
 * Le panneau accueillait aussi l'allure, le moment de la journée et le nombre
 * de propositions : trois réglages qu'on touche une fois puis plus jamais, au
 * milieu de ceux qu'on ajuste à chaque sortie. Ils sont passés dans « Mon
 * compte », sous « Recherche ». Ce qui reste ici agit sur les boucles
 * proposées, dans l'ordre où on y touche : l'activité, la longueur, le terrain,
 * le dénivelé, la sécurité. La longueur est passée devant le terrain — c'est le
 * réglage qu'on vient changer, et il demandait de faire défiler.
 */
export default function FiltersSheet({ value, onApply, onClose }) {
  const [draft, setDraft] = useState(value)
  const panel = useModal(onClose)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const isBike = draft.sport === 'bike'
  // À vélo c'est la vitesse qui part au moteur, quoi qu'affiche le réglage : le
  // panneau montre donc exactement ce qui sera utilisé.
  const usesSpeed = isBike || draft.speedUnit === 'speed'
  const maxKm = MAX_KM[draft.sport]
  const km = draft.mode === 'distance' ? draft.distance_km : estimateKm(draft)
  const climbing = draft.climb_m != null
  const shown = (key) => !(draft.hiddenFilters ?? []).includes(key)

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
            onClick={() =>
              setDraft({ ...DEFAULTS, ...Object.fromEntries(KEPT_ON_RESET.map((k) => [k, draft[k] ?? DEFAULTS[k]])) })
            }
          >
            Réinitialiser
          </button>
        </div>

        <div className="modal__body">
          {shown('sport') && (
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
          )}

          <Field label="Longueur">
            <Segmented
              options={[
                { key: 'duration', label: 'Durée' },
                { key: 'distance', label: 'Distance' },
              ]}
              value={draft.mode}
              onChange={(mode) => set({ mode })}
            />
            {draft.mode === 'distance' && (
              <div className="races" role="group" aria-label="Distances de course">
                {RACES.map((race) => {
                  const on = Math.abs(draft.distance_km - race.km) < 0.01
                  return (
                    <button
                      key={race.key}
                      className={`chip ${on ? 'chip--on' : ''}`}
                      aria-pressed={on}
                      disabled={race.km > maxKm}
                      onClick={() => set({ distance_km: race.km, precise: true })}
                      title={race.detail ? `${race.label} — ${race.detail}` : race.label}
                    >
                      {race.label}
                    </button>
                  )
                })}
              </div>
            )}
            {draft.mode === 'distance' ? (
              <Stepper
                text={`${formatKm(draft.distance_km)} km`}
                editable={{
                  value: draft.distance_km,
                  suffix: 'km',
                  min: MIN_KM,
                  max: maxKm,
                  // Au mètre près : c'est tout l'intérêt de taper soi-même —
                  // 21,0975 pour un semi, 8,4 pour une boucle connue.
                  onCommit: (v) => set({ distance_km: round(clamp(v, MIN_KM, maxKm), 0.001) }),
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
              <>
              <div className="races" role="group" aria-label="Durées courantes">
                {DURATIONS.map((minutes) => {
                  const on = draft.duration_min === minutes
                  return (
                    <button
                      key={minutes}
                      className={`chip ${on ? 'chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => set({ duration_min: minutes })}
                    >
                      {formatMinutes(minutes)}
                    </button>
                  )
                })}
              </div>
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
              </>
            )}
            {draft.mode === 'distance' && (
              <>
                <Segmented
                  options={[
                    { key: 'loose', label: 'Souple · ±10 %' },
                    { key: 'exact', label: 'Exacte · ±2,5 %' },
                  ]}
                  value={draft.precise ? 'exact' : 'loose'}
                  onChange={(v) => set({ precise: v === 'exact' })}
                />
                <p className="field__hint">
                  {draft.precise
                    ? `La boucle tombera entre ${formatKm(draft.distance_km * 0.975)} et ${formatKm(
                        draft.distance_km * 1.025,
                      )} km. Moins de boucles conviennent : s'il n'y en a aucune, Lacet élargit tout seul et le dit.`
                    : `La boucle tombera entre ${formatKm(draft.distance_km * 0.9)} et ${formatKm(
                        draft.distance_km * 1.1,
                      )} km — de quoi suivre les rues plutôt que le chiffre.`}
                </p>
              </>
            )}
            <p className="field__hint">
              {draft.mode === 'duration'
                ? // Une estimation à trois décimales se lirait comme une promesse.
                  `Converti en distance selon l'allure : environ ${formatKm(
                    Math.round(estimateKm(draft) * 10) / 10,
                  )} km.`
                : `Pas de ${formatKm(distanceStep(draft.distance_km))} km · jusqu'à ${maxKm} km ${
                    isBike ? 'à vélo' : 'à pied'
                  }. Le champ est modifiable au clavier.`}
            </p>

            {/* L'allure appartient à ce champ : c'est elle qui convertit une
                durée en distance, et qui donne la durée annoncée d'une boucle.
                Elle avait été rangée dans « Mon compte » ; on ne voyait plus
                l'effet de ce qu'on réglait. Ici, « 1 h à 5:30 » et « 1 h à
                6:30 » ne font pas la même sortie, et ça se lit tout de suite. */}
            <div className="field__pace">
              <span className="label">{isBike ? 'Vitesse' : 'Allure'}</span>
              {!isBike && (
                <Segmented
                  options={[
                    { key: 'pace', label: 'min/km' },
                    { key: 'speed', label: 'km/h' },
                  ]}
                  value={usesSpeed ? 'speed' : 'pace'}
                  onChange={(speedUnit) => set({ speedUnit })}
                />
              )}
              {usesSpeed ? (
                <Stepper
                  text={`${formatKm(draft.speed_kmh)} km/h`}
                  onStep={(d) =>
                    set({ speed_kmh: round(clamp(draft.speed_kmh + d * 0.5, 5, 60), 0.5) })
                  }
                  canDown={draft.speed_kmh > 5}
                  canUp={draft.speed_kmh < 60}
                />
              ) : (
                <Stepper
                  text={`${pace(draft.pace_sec_per_km)} /km`}
                  onStep={(d) =>
                    set({ pace_sec_per_km: clamp(draft.pace_sec_per_km + d * 5, 150, 1200) })
                  }
                  canDown={draft.pace_sec_per_km > 150}
                  canUp={draft.pace_sec_per_km < 1200}
                />
              )}
              <p className="field__hint">
                {draft.mode === 'duration'
                  ? 'Ne change pas le tracé : elle convertit la durée en distance.'
                  : `Ne change pas le tracé : elle donne la durée annoncée — environ ${formatMinutes(
                      Math.round((draft.distance_km * secondsPerKm(draft)) / 60),
                    )} pour cette boucle.`}
              </p>
            </div>
          </Field>

          {shown('form') && (
            <Field label="Forme">
              <Segmented options={FORMS} value={draft.form ?? 'auto'} onChange={(form) => set({ form })} />
              {draft.form === 'laps' && (
                <Stepper
                  text={`${draft.laps} tours`}
                  onStep={(d) => set({ laps: clamp(draft.laps + d, 2, MAX_LAPS) })}
                  canDown={draft.laps > 2}
                  canUp={draft.laps < MAX_LAPS}
                />
              )}
              <p className="field__hint">{formHint(draft, km)}</p>
            </Field>
          )}

          {shown('terrain') && (
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
              {/* Absent des réglages d'avant : coché, comme par défaut. */}
              <div className="checks checks--after">
                <button
                  role="checkbox"
                  aria-checked={draft.carfree !== false}
                  className={`check ${draft.carfree !== false ? 'check--on' : ''}`}
                  onClick={() => set({ carfree: draft.carfree === false })}
                >
                  <span className="check__box">
                    <Icon name="check" size={13} />
                  </span>
                  <span>
                    Voies sans voitures d'abord
                    <em>Pistes, chemins et allées ; la route quand il le faut</em>
                  </span>
                </button>
              </div>
            </Field>
          )}

          {shown('relief') && (
            <Field label="Dénivelé" info="relief" sport={draft.sport}>
              <div className="tiles">
                {RELIEFS.map((r) => (
                  <Tile
                    key={r.key}
                    label={r.label}
                    icon={r.icon}
                    on={!climbing && draft.elevation === r.key}
                    onClick={() => set({ elevation: r.key, climb_m: null })}
                  />
                ))}
              </div>
              {/* « On ne peut pas demander un D+ en particulier » : la plainte
                  revient chez RunnrZ. 150 m sur 10 km tombaient entre Vallonné
                  (100 m) et Côtes (220 m). On part de 10 m par kilomètre, la
                  cible de Vallonné. */}
              <div className="checks checks--after">
                <button
                  role="checkbox"
                  aria-checked={climbing}
                  className={`check ${climbing ? 'check--on' : ''}`}
                  onClick={() => set({ climb_m: climbing ? null : Math.max(10, Math.round(km) * 10) })}
                >
                  <span className="check__box">
                    <Icon name="check" size={13} />
                  </span>
                  <span>
                    Un D+ précis
                    <em>« Environ 150 m », plutôt que les trois réglages</em>
                  </span>
                </button>
              </div>
              {climbing && (
                <>
                  <Stepper
                    text={`${draft.climb_m} m de D+`}
                    editable={{
                      value: draft.climb_m,
                      onCommit: (v) => set({ climb_m: Math.round(clamp(v, 0, MAX_CLIMB)) }),
                    }}
                    onStep={(d) => {
                      const step = climbStep(draft.climb_m + (d > 0 ? 0 : -0.001))
                      set({ climb_m: round(clamp(draft.climb_m + d * step, 0, MAX_CLIMB), step) })
                    }}
                    canDown={draft.climb_m > 0}
                    canUp={draft.climb_m < MAX_CLIMB}
                  />
                  <p className="field__hint">
                    {`Environ ${formatKm(Math.round((draft.climb_m / km) * 10) / 10)} m par kilomètre. Les boucles entre ${climbBand(
                      draft.climb_m,
                      km,
                    )
                      .map(Math.round)
                      .join(' et ')} m passent devant ; entre elles, la sécurité décide.`}
                  </p>
                </>
              )}
            </Field>
          )}

          {shown('direction') && (
            <Field label="Direction">
              {/* Neuf choix sur une ligne : serrés, ils tiennent à 390 px. */}
              <div className="directions">
                <Segmented
                  options={DIRECTIONS}
                  value={directionOf(draft.direction)?.key ?? 'auto'}
                  onChange={(direction) => set({ direction })}
                />
              </div>
              <p className="field__hint">
                {directionOf(draft.direction)
                  ? `Les boucles partent ${directionOf(draft.direction).toward} : leur centre tombe à moins de 45° de ce cap. S'il n'y en a aucune de sûre de ce côté, Lacet le dit et propose les autres.`
                  : // « Tout autour » promettait trop : à Guebwiller, les boucles du
                    // nord et de l'ouest montent dans les Vosges, et le dénivelé
                    // demandé les fait passer après celles de la plaine.
                    'Les boucles se répartissent autour du départ, du côté où le dénivelé demandé se trouve. Choisis un cap pour partir ailleurs.'}
              </p>
            </Field>
          )}

          {shown('safety') && (
            <Field label="Sécurité" info="safety" sport={draft.sport}>
              <Segmented
                options={SAFETY}
                value={draft.safety}
                onChange={(safety) => set({ safety })}
              />
              <p className="field__hint">
                {draft.safety === 'safe'
                  ? "Contourne chaque bout de route à 80 km/h ou plus sans trottoir ni accotement, et écarte les boucles qui en gardent ou qui la traversent sans passage protégé. Les rues à 50 et les routes à 70 restent proposées."
                  : 'Montre aussi les itinéraires exposés, avec le détail des portions concernées.'}
              </p>
            </Field>
          )}

          {shown('avoid') && (
            <Field label="Éviter" info="avoid" sport={draft.sport}>
              <div className="checks">
                {AVOIDABLE.filter((a) => !a.sport || a.sport === draft.sport).map((a) => {
                  const on = (draft.avoid || []).includes(a.key)
                  return (
                    <button
                      key={a.key}
                      role="checkbox"
                      aria-checked={on}
                      className={`check ${on ? 'check--on' : ''}`}
                      onClick={() =>
                        set({
                          avoid: on
                            ? draft.avoid.filter((k) => k !== a.key)
                            : [...(draft.avoid || []), a.key],
                        })
                      }
                    >
                      <span className="check__box">
                        <Icon name="check" size={13} />
                      </span>
                      <span>
                        {a.label}
                        <em>{a.hint}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
            </Field>
          )}

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

/** Ce que donnera la forme choisie, à cette longueur. */
function formHint(draft, km) {
  const about = (v) => formatKm(Math.round(v * 10) / 10)
  switch (draft.form) {
    case 'loop':
      return "Une seule boucle de toute la longueur, jamais de tours. S'il n'y en a pas d'ici, Lacet le dit."
    case 'eight':
      return km / 2 < MIN_LAP_KM
        ? `Deux boucles de ${about(km / 2)} km : trop courtes, Lacet n'en cherche pas sous ${formatKm(MIN_LAP_KM)} km.`
        : `Deux boucles d'environ ${about(km / 2)} km, de deux côtés du départ : la seconde repart de la porte.`
    case 'laps':
      return km / draft.laps < MIN_LAP_KM
        ? `${draft.laps} tours de ${about(km / draft.laps)} km : trop courts, Lacet n'en cherche pas sous ${formatKm(MIN_LAP_KM)} km. Choisis moins de tours.`
        : `Une boucle d'environ ${about(km / draft.laps)} km, à faire ${draft.laps} fois en repassant au départ.`
    default:
      return "Une boucle entière d'abord ; s'il en manque, Lacet complète par des tours ou deux boucles, et le dit."
  }
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

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.key)}
          aria-pressed={value === o.key}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Valeur avec incréments, et saisie directe quand elle est autorisée. */
export function Stepper({ text, onStep, canDown, canUp, editable }) {
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

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// `Math.round(42.295 / 0.1) * 0.1` rend 42.300000000000004 : la division puis
// la multiplication en binaire ne retombent pas sur le compte. Trois décimales
// — le mètre — suffisent à une distance de course, et referment la parenthèse.
export const round = (v, step) => Number((Math.round(v / step) * step).toFixed(3))

/**
 * « 10 » plutôt que « 10.0 », « 10,5 » quand la décimale compte, et
 * « 21,098 » quand on a saisi une distance au mètre près.
 */
export function formatKm(v) {
  const rounded = Number(Number(v).toFixed(3))
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function formatMinutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** Le temps au kilomètre effectivement envoyé au moteur. */
export function secondsPerKm(params) {
  return params.sport === 'bike' || params.speedUnit === 'speed'
    ? 3600 / params.speed_kmh
    : params.pace_sec_per_km
}

export function estimateKm(params) {
  return (params.duration_min * 60) / secondsPerKm(params)
}
