import { useEffect, useState } from 'react'
import useModal from './useModal'
import Icon from './Icon.jsx'
import { InfoButton } from './Explain.jsx'
import { climbBand, reliefBadge } from './explain'
import { reliefHintOnDevice } from './engine/client'
import { pace } from './format'
import { fromKm, paceLabel, speedIn, speedLabel, toKm, unitLabel, units } from './units'

import { t, dec } from './i18n'
export const SPORTS = [
  { key: 'run', label: 'Course', icon: 'run' },
  { key: 'bike', label: 'Vélo', icon: 'bike' },
]

// Le vocabulaire du terrain change avec le sport : « sentier » à pied, « VTT »
// à vélo. Le moteur, lui, reçoit la même valeur.
export const TERRAINS = {
  run: [
    { key: 'road', label: 'Route', icon: 'road', sub: 'Rues et routes goudronnées' },
    { key: 'mixed', label: 'Mixte', icon: 'forest', sub: 'Routes et chemins mêlés' },
    { key: 'trail', label: 'Sentier', icon: 'mountain', sub: 'Chemins et sentiers, loin des voitures' },
  ],
  bike: [
    { key: 'road', label: 'Route', icon: 'road', sub: 'Routes goudronnées' },
    { key: 'mixed', label: 'Mixte', icon: 'forest', sub: 'Routes et chemins roulants' },
    { key: 'trail', label: 'VTT', icon: 'mountain', sub: 'Chemins et sentiers, loin des voitures' },
  ],
}

// Les cibles de `engine/service.js`, en mètres de montée par kilomètre : ce
// que dit aussi « Comprendre le relief » (`explain.js`).
export const RELIEFS = [
  { key: 'flat', label: 'Plat', icon: 'flat', sub: 'Le moins de montée possible · vers 3 m/km' },
  { key: 'rolling', label: 'Vallonné', icon: 'rolling', sub: 'Un peu de relief · vers 10 m/km' },
  { key: 'hilly', label: 'Côtes', icon: 'hilly', sub: 'Les montées recherchées · 20 m/km et plus' },
]

export const SAFETY = [
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

// Le moteur accepte de deux à dix tours, d'au moins 1,5 km chacun
// (`MIN_LAP_M`) : en dessous, ce n'est plus une boucle mais de la piste.
export const MAX_LAPS = 10

/** La direction choisie, ou `null` pour « Auto » et une valeur inconnue. */
export const directionOf = (key) => DIRECTIONS.find((d) => d.key === key && d.deg !== undefined) ?? null

// Nombre d'itinéraires proposés. Trois, c'était trop peu pour choisir : on
// prend le premier faute d'alternative. Seize et vingt, pour qui veut tout voir
// autour de chez soi : le moteur trace alors plus de polygones (`wideSettings`).
export const COUNTS = [
  { key: 3, label: '3' },
  { key: 5, label: '5' },
  { key: 8, label: '8' },
  { key: 12, label: '12' },
  { key: 16, label: '16' },
  { key: 20, label: '20' },
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

/**
 * À vélo, les distances qu'on se donne : la sortie courte, la demi-journée, la
 * centaine. Le panneau proposait les distances de course — un « Semi » à vélo.
 * Ce ne sont pas des épreuves au mètre près : elles ne resserrent pas la
 * tolérance.
 */
export const RIDES = [25, 50, 75, 100]

/** La distance de course qui correspond, à dix mètres près. */
export const raceOf = (km) => RACES.find((r) => Math.abs(r.km - km) < 0.01) ?? null

/**
 * Les durées qu'on se donne vraiment : la demi-heure de semaine, les
 * trois quarts d'heure, l'heure, et la sortie longue. Composer 1 h 30 au pas de
 * cinq minutes demandait dix-huit appuis. À vélo, on part plus longtemps : une
 * demi-heure n'y fait pas une sortie, et trois heures demandaient douze appuis.
 */
export const DURATIONS = { run: [30, 45, 60, 90], bike: [60, 90, 120, 180] }

/**
 * Ce qu'on peut refuser de croiser.
 *
 * Deux cases, et pas dix : chacune doit répondre à une gêne qu'on a vraiment
 * eue — les cent mètres de dénivelé avalés dans un escalier, le chemin noir à
 * dix-huit heures en décembre. Les clés sont celles de `AVOIDS`, dans
 * `engine/weights.js` — sauf la dernière, « Boucles déjà courues », qui n'est
 * pas une rue : on la demandait pour changer de chemin sans changer de départ.
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
  // Pas une rue mais un souvenir : les sorties passées depuis ce départ, à
  // peu près de cette longueur, passent après les boucles neuves (`ranFrom`).
  { key: 'known', label: 'Boucles déjà courues', hint: 'Elles passent après celles jamais courues d’ici' },
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
    key: 'terrain',
    label: 'Terrain',
    hint: 'Route, mixte ou sentier, et les voies sans voitures.',
    fixed: 'Mixte, voies sans voitures d’abord.',
    reset: { surface: DEFAULTS.surface, carfree: DEFAULTS.carfree },
  },
  {
    key: 'relief',
    label: 'Relief',
    hint: 'Plat, vallonné, côtes, ou un D+ précis.',
    fixed: 'Vallonné.',
    reset: { elevation: DEFAULTS.elevation, climb_m: null },
  },
]

// Ce que « Réinitialiser » ne touche pas : ce qui se règle dans « Mon compte »,
// pas dans ce panneau. Il remettait à 5 les douze propositions choisies là-bas,
// et aurait réaffiché les filtres masqués.
const KEPT_ON_RESET = [
  'sport',
  'weight_kg',
  'weekly_km',
  'time_of_day',
  'side',
  'count',
  'hiddenFilters',
  // Réglés dans « Mon compte › Parcours » depuis qu'ils ont quitté le panneau.
  'safety',
  'direction',
  'form',
  'laps',
  'avoid',
]

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
 * proposées : l'activité, le terrain, le relief — puis la longueur et l'allure,
 * repliées en une ligne chacune, puisque l'accueil règle déjà la longueur.
 */
export default function FiltersSheet({ value, origin = null, onApply, onClose }) {
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
  // Le D+ possible autour du départ, lu sur les tuiles déjà gardées : un badge
  // par relief, avant de chercher. Sans départ ou sans tuile, pas de badge.
  const [reachable, setReachable] = useState(null)
  const originLat = origin?.lat
  const originLon = origin?.lon
  useEffect(() => {
    if (originLat == null) return undefined
    let live = true
    reliefHintOnDevice({ lat: originLat, lon: originLon, distance_km: km })
      .then((v) => live && setReachable(v))
      .catch(() => live && setReachable(null))
    return () => {
      live = false
    }
  }, [originLat, originLon, km])
  const shown = (key) => !(draft.hiddenFilters ?? []).includes(key)

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('Filtres de recherche')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <span />
          <h2>{t('Filtres')}</h2>
          <button
            className="modal__reset"
            onClick={() =>
              setDraft({ ...DEFAULTS, ...Object.fromEntries(KEPT_ON_RESET.map((k) => [k, draft[k] ?? DEFAULTS[k]])) })
            }
          >{t('Réinitialiser')}</button>
        </div>

        <div className="modal__body">
          {shown('sport') && (
            <Field label={t('Activité')} info="sport" sport={draft.sport}>
              <div className="tiles">
                {SPORTS.map((s) => (
                  <Tile
                    key={s.key}
                    label={t(s.label)}
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

          {shown('terrain') && (
            <Field label={t('Terrain')} info="terrain" sport={draft.sport}>
              <Choices label={t('Terrain')} options={TERRAINS[draft.sport]} value={draft.surface} onChange={(surface) => set({ surface })} />
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
                  <span>{t('Voies sans voitures d\'abord')}<em>{t('Pistes, chemins et allées ; la route quand il le faut')}</em>
                  </span>
                </button>
              </div>
            </Field>
          )}

          {shown('relief') && (
            <Field
              label={t('Relief')}
              info="relief"
              sport={draft.sport}
              value={climbing ? t('{climb_m} m de D+', { climb_m: draft.climb_m }) : t(RELIEFS.find((o) => o.key === draft.elevation)?.label ?? 'Auto')}
            >
              {/* « On ne peut pas demander un D+ en particulier » : la plainte
                  revient chez RunnrZ. 150 m sur 10 km tombaient entre Vallonné
                  (100 m) et Côtes (220 m). On part de 10 m par kilomètre, la
                  cible de Vallonné. */}
              <Choices
                label={t('Relief')}
                options={[...RELIEFS, { key: 'climb', label: t('Un D+ précis'), sub: t('« Environ 150 m », au mètre près'), icon: 'trendUp' }].map((o) => ({
                  ...o,
                  badge: reliefBadge(o.key, reachable, o.key === 'climb' ? draft.climb_m / km : null),
                }))}
                value={climbing ? 'climb' : draft.elevation}
                onChange={(key) =>
                  key === 'climb'
                    ? set({ climb_m: climbing ? draft.climb_m : Math.max(10, Math.round(km) * 10) })
                    : set({ elevation: key, climb_m: null })
                }
              />
              {climbing && (
                <>
                  <Stepper
                    text={t('{climb_m} m de D+', { climb_m: draft.climb_m })}
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
                    {t('Environ {v1} m par kilomètre. Les boucles entre {v2} m passent devant ; entre elles, la sécurité décide.', { v1: formatKm(Math.round((draft.climb_m / km) * 10) / 10), v2: climbBand(
                      draft.climb_m,
                      km,
                    )
                      .map(Math.round)
                      .join(' et ') })}
                  </p>
                </>
              )}
            </Field>
          )}

          {/* La longueur se règle déjà sur l'accueil, à la règle : ici elle se
              replie en une ligne, et ne s'ouvre que pour le semi au mètre près,
              la saisie au clavier ou la tolérance. Même chose pour l'allure,
              qu'on règle une fois. Ouvertes, les deux poussaient le terrain et le
              relief — ce qu'on vient vraiment changer ici — sous le pli. (L'allure
              a été rouverte depuis : voir plus bas.) Le nom suit le mode :
              « Distance · 5 km » ou « Durée · 45 min » se lisent sans détour, là
              où « Longueur » ne se disait pas d'une durée. */}
          <Field
            label={draft.mode === 'distance' ? t('Distance') : t('Durée')}
            value={
              draft.mode === 'distance'
                ? `${formatDistance(draft.distance_km)} ${unitLabel()} · ${t(draft.precise ? 'exacte' : 'souple')}`
                : formatMinutes(draft.duration_min)
            }
          >
            <Segmented
              options={[
                { key: 'duration', label: t('Durée') },
                { key: 'distance', label: t('Distance') },
              ]}
              value={draft.mode}
              onChange={(mode) => set({ mode })}
            />
            {draft.mode === 'distance' && isBike && (
              <div className="races" role="group" aria-label={t('Distances usuelles')}>
                {RIDES.map((ride) => {
                  const on = Math.abs(draft.distance_km - ride) < 0.01
                  return (
                    <button
                      key={ride}
                      className={`chip ${on ? 'chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => set({ distance_km: ride })}
                    >
                      {ride} km
                    </button>
                  )
                })}
              </div>
            )}
            {draft.mode === 'distance' && !isBike && (
              <div className="races" role="group" aria-label={t('Distances de course')}>
                {RACES.map((race) => {
                  const on = Math.abs(draft.distance_km - race.km) < 0.01
                  return (
                    <button
                      key={race.key}
                      className={`chip ${on ? 'chip--on' : ''}`}
                      aria-pressed={on}
                      disabled={race.km > maxKm}
                      onClick={() => set({ distance_km: race.km, precise: true })}
                      title={race.detail ? `${t(race.label)} — ${t(race.detail)}` : t(race.label)}
                    >
                      {t(race.label)}
                    </button>
                  )
                })}
              </div>
            )}
            {draft.mode === 'distance' ? (
              <Stepper
                text={`${formatDistance(draft.distance_km)} ${unitLabel()}`}
                editable={{
                  value: Number(fromKm(draft.distance_km).toFixed(3)),
                  suffix: unitLabel(),
                  min: MIN_KM,
                  max: maxKm,
                  // Au mètre près : c'est tout l'intérêt de taper soi-même —
                  // 21,0975 pour un semi, 8,4 pour une boucle connue.
                  onCommit: (v) => set({ distance_km: round(clamp(toKm(v), MIN_KM, maxKm), 0.001) }),
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
              <div className="races" role="group" aria-label={t('Durées courantes')}>
                {(DURATIONS[draft.sport] ?? DURATIONS.run).map((minutes) => {
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
              <Segmented
                options={[
                  { key: 'loose', label: t('Souple · ±10 %') },
                  { key: 'exact', label: t('Exacte · ±2,5 %') },
                ]}
                value={draft.precise ? 'exact' : 'loose'}
                onChange={(v) => set({ precise: v === 'exact' })}
              />
            )}
            {/* Une ligne, pas deux paragraphes : la fourchette suffit, le reste
                (pas du réglage, champ au clavier) se découvre en touchant. */}
            <p className="field__hint">
              {draft.mode === 'duration'
                ? // Une estimation à trois décimales se lirait comme une promesse.
                  t('Converti en distance selon l\'allure : environ {v1} {v2}.', { v1: formatDistance(
                    Math.round(estimateKm(draft) * 10) / 10,
                  ), v2: unitLabel() })
                : t('Entre {v1} et {v2} {v3}{v4}', { v1: formatDistance(draft.distance_km * (draft.precise ? 0.975 : 0.9)), v2: formatDistance(
                    draft.distance_km * (draft.precise ? 1.025 : 1.1),
                  ), v3: unitLabel(), v4: draft.precise ? t(' ; élargi tout seul s’il n’y a rien.') : '.' })}
            </p>

            {/* L'allure appartient à ce champ : c'est elle qui convertit une
                durée en distance, et qui donne la durée annoncée d'une boucle.
                Elle avait été rangée dans « Mon compte » ; on ne voyait plus
                l'effet de ce qu'on réglait. Ici, « 1 h à 5:30 » et « 1 h à
                6:30 » ne font pas la même sortie, et ça se lit tout de suite. */}
          </Field>

          {/* L'allure reste ouverte : min/km ou km/h et le compteur se lisent
              sans rien dérouler (demandé le 21 novembre, dd784ff). Repliée par
              le désencombrage du 24, elle a été rouverte. */}
          <Field label={isBike ? t('Vitesse') : t('Allure')}>
            <div className="field__pace">
              {!isBike && (
                <Segmented
                  options={[
                    { key: 'pace', label: `min${paceLabel()}` },
                    { key: 'speed', label: speedLabel() },
                  ]}
                  value={usesSpeed ? 'speed' : 'pace'}
                  onChange={(speedUnit) => set({ speedUnit })}
                />
              )}
              {usesSpeed ? (
                <Stepper
                  text={`${formatKm(Math.round(speedIn(draft.speed_kmh) * 10) / 10)} ${speedLabel()}`}
                  onStep={(d) => set({ speed_kmh: round(clamp(draft.speed_kmh + d * 0.5, 5, 60), 0.5) })}
                  canDown={draft.speed_kmh > 5}
                  canUp={draft.speed_kmh < 60}
                />
              ) : (
                <Stepper
                  text={`${pace(draft.pace_sec_per_km)} ${paceLabel()}`}
                  onStep={(d) => set({ pace_sec_per_km: clamp(draft.pace_sec_per_km + d * 5, 150, 1200) })}
                  canDown={draft.pace_sec_per_km > 150}
                  canUp={draft.pace_sec_per_km < 1200}
                />
              )}
              <p className="field__hint">
                {draft.mode === 'duration'
                  ? t('Convertit la durée en distance ; ne change pas le tracé.')
                  : t('Environ {v1} pour cette boucle ; ne change pas le tracé.', { v1: formatMinutes(
                      Math.round((draft.distance_km * secondsPerKm(draft)) / 60),
                    ) })}
              </p>
            </div>
          </Field>
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>{t('Annuler')}</button>
          <button className="btn btn--primary" onClick={() => onApply(draft)}>
            <Icon name="search" size={17} />{t('Rechercher')}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Des choix lisibles d'un coup d'œil : un rond, le nom, une ligne qui dit ce
 * qu'il donne, et son icône — comme les « Préférences de parcours » de RunnrZ.
 * Des tuiles muettes demandaient d'ouvrir l'aide pour savoir ce que « Mixte »
 * voulait dire.
 */
export function Choices({ label, options, value, onChange }) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.key)}
          role="radio"
          aria-checked={value === o.key}
          className={`choice ${value === o.key ? 'choice--on' : ''}`}
          onClick={() => onChange(o.key)}
        >
          <span className="choice__radio" />
          <span className="choice__text">
            <b>{t(o.label)}</b>
            {o.sub && <em>{t(o.sub)}</em>}
          </span>
          {o.badge && <span className={`choice__badge choice__badge--${o.badge === 'Probable' ? 'yes' : 'maybe'}`}>{o.badge}</span>}
          {o.icon && <Icon name={o.icon} size={22} className="choice__icon" />}
        </button>
      ))}
    </div>
  )
}

/**
 * Un réglage. Avec `value`, il se replie en une ligne — son nom, ce qui est
 * choisi, une flèche —, comme chez RunnrZ : on lit tous les filtres d'un coup
 * d'œil, et on n'ouvre que celui qu'on vient changer. Sans, il reste ouvert :
 * l'activité et la longueur, qu'on règle à chaque sortie.
 */
export function Field({ label, info, sport, value = null, children }) {
  const [open, setOpen] = useState(false)
  if (value == null) {
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
  return (
    <div className={`field field--fold ${open ? 'field--open' : ''}`}>
      <button className="field__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="field__name">{label}</span>
        <span className="field__value">{value}</span>
        <Icon name="chevronDown" size={16} className="field__chev" />
      </button>
      {open && (
        <div className="field__body">
          {info && (
            <div className="field__info">
              <InfoButton topic={info} sport={sport} />
            </div>
          )}
          {children}
        </div>
      )}
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
          aria-label={t(o.title)}
          title={t(o.title)}
          onClick={() => onChange(o.key)}
        >
          {t(o.label)}
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
          aria-label={t('Valeur')}
        />
      ) : (
        <button
          className={`stepper__value ${editable ? 'stepper__value--editable' : ''}`}
          onClick={() => editable && setTyping(String(editable.value))}
          disabled={!editable}
          title={editable ? t('Cliquer pour saisir une valeur') : undefined}
        >
          {text}
        </button>
      )}
      <div className="stepper__pad">
        <button onClick={() => onStep(-1)} disabled={!canDown} aria-label={t('Diminuer')}>
          <Icon name="minus" size={18} />
        </button>
        <button onClick={() => onStep(1)} disabled={!canUp} aria-label={t('Augmenter')}>
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
/** Une distance de la demande (en km), dans l'unité affichée : au centième en miles. */
export const formatDistance = (kmValue) =>
  formatKm(units() === 'mi' ? Math.round(fromKm(kmValue) * 100) / 100 : kmValue)

export function formatKm(v) {
  const rounded = Number(Number(v).toFixed(3))
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', dec())
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
