/**
 * Mon compte : un sommaire, et une page par sujet.
 *
 * L'écran empilait quatorze rubriques les unes sous les autres — poids,
 * cartes hors ligne, contact d'urgence, version de l'app… — et l'on
 * faisait défiler le tout pour trouver le réglage qu'on venait changer. Le
 * sommaire range ces rubriques en trois onglets : Paramètres (ce qu'on règle),
 * Profil (poids et objectifs, réglables sur place) et Données (ce que l'app
 * garde, et ce qu'il faut savoir d'elle). Une longue liste unique obligeait à
 * lire les familles pour trouver la sienne ; trois onglets n'en montrent
 * qu'une. Chaque ligne dit déjà l'essentiel — « Sécurité sûr · 5 boucles » —
 * et n'a besoin d'être ouverte que pour le changer. Les pages, elles, sont
 * toutes faites des mêmes cartes de `Prefs.jsx`, au lieu de boutons et de
 * jauges dessinés chacun à sa façon.
 *
 * Tout y est local à l'appareil — c'est le propos de l'écran, et la raison
 * pour laquelle il ne dépend de rien d'autre que du stockage de l'app.
 *
 * La page ouverte est tenue par l'app (`page`, `onPage`) : c'est son en-tête
 * qui porte le retour au sommaire, et l'onglet le referme quand on y revient.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import About from './About.jsx'
import { AVOIDABLE, COUNTS, DIRECTIONS, MAX_LAPS, MOMENTS, OPTIONAL_FILTERS, SAFETY, SPORTS, directionOf } from './FiltersSheet.jsx'
import { ActionRow, InfoRow, LinkRow, PickRow, PrefsCard, ToggleRow } from './Prefs.jsx'
import { MAX_FAVORITES, MAX_HISTORY, MAX_PLACES, dropTracks, exportAll, forgetTrim, importAll, load, save, usage } from './storage'
import { activeReports, kindLabel, removeReport } from './reports'
import { listZones, removeZone, updateZone } from './zones'
import { isNative, saveTextFile } from './platform'
import * as offline from './offlineMaps'
import { KINDS, NEAR_M } from './pois'
import { preview, voiceSettings } from './voice'
import { workoutPlan, workoutSettings } from './workout'
import WorkoutSetting from './Workout.jsx'
import { Avatar, ProfileSettings, useIdentity } from './Profile.jsx'
import { styleByKey } from './mapStyles'
import { setUnits, unitLabel, units } from './units'
import { parsePresets, presets, setPresets } from './presets'
import { ACCENTS, TEXT_SIZES, THEMES, getAppearance, setAppearance, useAppearance } from './appearance'

import { SECTIONS, SETTINGS_GROUPS } from './accountSections.js'

import { t, locale, dec, lang, useLang, setLang, LANGUAGES } from './i18n'
export { SECTIONS, sectionTitle } from './accountSections.js'

export default function Account({ page = null, onPage = () => {}, ...props }) {
  const top = useRef(null)
  // Où l'on en était dans le sommaire au moment d'ouvrir une page.
  const summaryAt = useRef(0)
  const scroller = () => top.current?.closest('.side__body') ?? null
  const known = SECTIONS.some((s) => s.key === page)

  // Une page s'ouvre en haut : sans ça, elle héritait du défilement du
  // sommaire, et « Sauvegarde » s'ouvrait sur son dernier paragraphe. Le
  // sommaire, lui, se retrouve là où on l'avait laissé : descendu jusqu'à
  // « À propos », on y revenait tout en haut, et il fallait redescendre.
  // Avant l'affichage, pour ne pas voir la page sauter.
  useLayoutEffect(() => {
    const body = scroller()
    if (body) body.scrollTop = known ? 0 : summaryAt.current
  }, [page])

  // Relevé au moment du toucher, pas après : la page ouverte, plus courte que
  // le sommaire, aurait déjà ramené le défilement vers le haut.
  const open = (key) => {
    summaryAt.current = scroller()?.scrollTop ?? 0
    onPage(key)
  }

  // Une page arrive de la droite, le sommaire revient de la gauche — comme
  // partout sur iPhone. Le sens se fige au changement de page : changé sur un
  // élément déjà là, il relancerait l'animation à chaque rendu.
  const first = useRef(true)
  const motion = useMemo(() => (known ? 'acct--in' : first.current ? '' : 'acct--back'), [page])
  useEffect(() => {
    first.current = false
  }, [])

  return (
    <div key={known ? page : 'summary'} className={`panel acct ${known ? 'acct--page' : ''} ${motion}`} ref={top}>
      {known ? <SectionPage page={page} {...props} /> : <Summary onPage={open} {...props} />}
    </div>
  )
}

/**
 * Le sommaire : qui l'on est, puis une ligne par page.
 *
 * La carte du haut est la page « Profil » : une ligne « Profil » en dessous la
 * répétait. Les sorties et les kilomètres cumulés n'y sont plus — ils se
 * lisent dans « Mes parcours », avec leur graphique.
 */
function Summary({ onPage, params, poiPrefs, onProfile, onReplayTour = null }) {
  const sport = SPORTS.find((s) => s.key === params.sport)
  const [tab, setTab] = useState(lastTab)
  // Partagé entre l'en-tête et l'onglet Profil : la photo changée dessous
  // apparaît aussitôt dans l'en-tête.
  const [me, setMe] = useIdentity()
  const pick = (key) => {
    lastTab = key
    setTab(key)
  }
  // `first` : une ligne qui n'est pas une page, posée en tête du groupe.
  const rows = (group, first = null) => (
    <div className="menu">
      {first}
      {SECTIONS.filter((s) => s.group === group).map((s) => (
        <button key={s.key} className="menu__row" onClick={() => onPage(s.key)}>
          <span className="menu__icon">
            <Icon name={s.icon} size={18} />
          </span>
          <span className="menu__text">
            <b>{t(s.title)}</b>
            <em>{summaryOf(s.key, { params, poiPrefs })}</em>
          </span>
          <Icon name="chevronRight" size={17} className="menu__chev" />
        </button>
      ))}
    </div>
  )
  return (
    <>
      {/* Qui l'on est, en une ligne : l'avatar et l'état du profil. Le toucher
          mène à l'onglet Profil, juste dessous. */}
      <button className="acct__who" onClick={() => pick('profile')}>
        <Avatar photo={me.photo} icon={sport?.icon ?? 'user'} />
        <span className="menu__text">
          <b>{me.name.trim() || t('Profil local')}</b>
          <em>{summaryOf('profile', { params, poiPrefs })}</em>
        </span>
      </button>

      {/* Trois onglets plutôt qu'une longue liste : ce qu'on règle, qui l'on
          est, ce que l'app garde. Le choix tient le temps de la session — on
          revient d'une page sur l'onglet qu'on avait quitté. */}
      <div className="seg acct__tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k.key} role="tab" aria-selected={tab === k.key} aria-pressed={tab === k.key} onClick={() => pick(k.key)}>
            {t(k.label)}
          </button>
        ))}
      </div>

      <div key={tab} className="acct__tab" role="tabpanel">
        {tab === 'settings' &&
          SETTINGS_GROUPS.map((group) => (
            <section key={group} className="acct__group" aria-label={t(group)}>
              <h3 className="acct__label">{t(group)}</h3>
              {rows(group)}
            </section>
          ))}
        {tab === 'profile' && <ProfileSettings params={params} onProfile={onProfile} me={me} setMe={setMe} />}
        {tab === 'data' && (
          <>
            {rows('Données')}
            <section className="acct__group" aria-label={t('Infos')}>
              <h3 className="acct__label">{t('Infos')}</h3>
              {rows(
                'Infos',
                // La visite guidée se rejoue sur Explorer, où sont ses bulles.
                onReplayTour && (
                  <button className="menu__row" onClick={onReplayTour}>
                    <span className="menu__icon">
                      <Icon name="play" size={18} />
                    </span>
                    <span className="menu__text">
                      <b>{t('Revoir la visite')}</b>
                      <em>{t('Les bulles sur l\'écran Explorer')}</em>
                    </span>
                    <Icon name="chevronRight" size={17} className="menu__chev" />
                  </button>
                ),
              )}
            </section>
          </>
        )}
      </div>

      <p className="muted small acct__foot">{t('Aucun compte. Favoris, sorties et réglages ne quittent pas cet appareil.')}</p>
    </>
  )
}

const TABS = [
  { key: 'settings', label: 'Paramètres' },
  { key: 'profile', label: 'Profil' },
  { key: 'data', label: 'Données' },
]
// L'onglet ouvert, gardé le temps de la session : le sommaire est recréé à
// chaque retour d'une page, et revenait sinon sur « Paramètres ».
let lastTab = 'settings'

/**
 * Ce que dit une ligne du sommaire sous son titre : l'état du moment plutôt
 * qu'une description. « 70 kg » répond à la question avant qu'on ouvre.
 */
function summaryOf(key, { params, poiPrefs }) {
  const saved = load()
  switch (key) {
    case 'profile':
      return [
        params.height_cm ? `${params.height_cm} cm` : null,
        t('Poids {v1} kg{v2}', { v1: params.weight_kg || 70, v2: params.weekly_km ? t(' · {weekly_km} km par semaine', { weekly_km: params.weekly_km }) : '' }),
      ]
        .filter(Boolean)
        .join(' · ')
    case 'search':
      return [
        t('Sécurité {v1}', { v1: t(SAFETY.find((o) => o.key === params.safety)?.label ?? 'Sûr').toLowerCase() ?? t('sûre') }),
        directionOf(params.direction) ? t('Vers le {v1}', { v1: t(directionOf(params.direction).title).toLowerCase() }) : null,
        `${params.count ?? 5} boucles`,
        params.avoid?.length ? t('{length} évitement{v2}', { length: params.avoid.length, v2: params.avoid.length > 1 ? 's' : '' }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'home': {
      const hidden = params.hiddenFilters?.length ?? 0
      return [t('Raccourcis de l\'accueil'), hidden ? t('Filtres masqués : {hidden}', { hidden }) : null]
        .filter(Boolean)
        .join(' · ')
    }
    case 'voice': {
      const { km, rate } = voiceSettings()
      return [
        km ? kmEvery().find((o) => o.key === km)?.label : t('Kilomètres tus'),
        t('Débit {v1}', { v1: t(RATES.find((o) => o.key === (rate ?? 'normal'))?.label ?? 'Normal').toLowerCase() }),
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'run':
      return [
        t('Recalcul {v1}', { v1: t(saved.autoReroute !== false ? 'auto' : 'manuel') }),
        t('Arrêt {v1} à l\'arrivée', { v1: t(saved.autoFinish !== false ? 'auto' : 'manuel') }),
      ].join(' · ')
    case 'workout':
      return workoutSettings().on ? t('Fractionné {v1}', { v1: t(workoutPlan().label) }) : t('Désactivée')
    case 'safety':
      return saved.emergencyContact
        ? t('SOS vers {emergencyContact}{v2}', { emergencyContact: saved.emergencyContact, v2: saved.notifyContact ? t(' · départ et retour annoncés') : '' })
        : t('Pas de contact d\'urgence')
    case 'zones': {
      const reports = activeReports().length
      const zones = listZones().filter((z) => z.on !== false).length
      if (!reports && !zones) return t('Aucune zone, aucun signalement')
      return [
        zones && t('{zones} zone{v2} évitée{v3}', { zones, v2: zones > 1 ? 's' : '', v3: zones > 1 ? 's' : '' }),
        reports && `${reports} signalement${reports > 1 ? 's' : ''}`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    case 'appearance': {
      const { accent, theme, text } = appearanceLabels()
      return t('{accent} · Thème {v2} · Texte {v3}', { accent, v2: theme.toLowerCase(), v3: t(text === 'large' ? 'agrandi' : 'normal') })
    }
    case 'storage': {
      const info = usage()
      if (!info) return t('Sorties, cartes et rues gardées')
      const { history, favorites } = info.counts
      return t('{v1} · {history} sortie{v3}, {favorites} favori{v5}', { v1: mo(info.bytes), history, v3: history > 1 ? 's' : '', favorites, v5: favorites > 1 ? 's' : '' })
    }
    case 'backup':
      return t('Exporter, restaurer ou tout effacer')
    case 'about':
      return t('Version, conditions, confidentialité, sources')
    default:
      return ''
  }
}

/** Une page de « Mon compte ». */
function SectionPage({ page, mapStyle, onStyles = null, params, poiPrefs, onPoiPrefs, onClearData, onProfile, onRestored, zones = [], onZones = () => {} }) {
  switch (page) {
    case 'profile':
      return <ProfileSettings params={params} onProfile={onProfile} />
    case 'search':
      return <SearchSettings params={params} onProfile={onProfile} />
    case 'home':
      return <HomeSettings params={params} onProfile={onProfile} />
    case 'voice':
      return <VoiceSetting />
    case 'run':
      return (
        <>
          <RunSettings poiPrefs={poiPrefs} onPoiPrefs={onPoiPrefs} />
          <LockScreenSetting />
        </>
      )
    case 'workout':
      return <WorkoutSetting pace={params.pace_sec_per_km} />
    case 'safety':
      return <EmergencyContact />
    case 'zones':
      return (
        <>
          <MyZones zones={zones} onZones={onZones} />
          <MyReports />
        </>
      )
    case 'appearance':
      return <AppearanceSettings mapStyle={mapStyle} onStyles={onStyles} />
    case 'storage':
      return (
        <>
          <StoredData />
          <OfflineStorage />
          <KeptStreets />
        </>
      )
    case 'backup':
      return (
        <>
          <BackupRows onRestored={onRestored} />
          <ClearData onClearData={onClearData} />
        </>
      )
    case 'about':
      return (
        <About version={<BuildStamp />} diagnostic={<LastSearch />} />
      )
    default:
      return null
  }
}

/**
 * Le numéro que le bouton SOS prépare. Enregistré à chaque frappe : il n'y a
 * pas de bouton « Valider » à oublier avant de partir courir.
 */
function EmergencyContact() {
  const [contact, setContact] = useState(() => load().emergencyContact || '')
  const [announce, setAnnounce] = useState(() => Boolean(load().notifyContact))
  return (
    <PrefsCard
      title={t('Contact d\'urgence')}
      foot={
        <>
          {t('Le bouton SOS prépare un SMS vers ce numéro avec ta position.')} <b>{t('L\'app ne l\'envoie pas')}</b>{' '}
          {t(': c\'est toi qui appuies sur envoyer.')}{' '}
          {!announce
            ? t('Au départ, Messages peut s’ouvrir avec le parcours, d’où tu pars et l’heure prévue du retour ; à l’arrivée, un bouton dit que tout va bien.')
            : contact.trim()
              ? t('Au départ, Messages s’ouvre avec la distance, le point de départ et l’heure prévue du retour : envoie, puis reviens dans Lacet pour le compte à rebours. À l’arrivée, un bouton prépare « De retour de ma sortie ».')
              : t('Donne un numéro ci-dessus : sans lui, rien ne part.')}
        </>
      }
    >
      {/* Le numéro est une ligne de la carte, pas un champ à part : on le lit
          comme un réglage, au même titre que l'interrupteur dessous. */}
      <div className="prow">
        <label className="prow__btn prow__static">
          <Icon name="sos" size={19} className="prow__icon" />
          <input
            className="prow__input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-label={t('Numéro du contact d\'urgence')}
            placeholder="06 12 34 56 78"
            value={contact}
            onChange={(e) => {
              setContact(e.target.value)
              save({ emergencyContact: e.target.value.trim() })
            }}
          />
        </label>
      </div>
      <ToggleRow
        icon="share"
        label={t('Prévenir au départ et au retour')}
        on={announce}
        onChange={(value) => {
          setAnnounce(value)
          save({ notifyContact: value })
        }}
      />
    </PrefsCard>
  )
}

/**
 * Tout effacer, en deux temps : un appui ne suffit pas à perdre des mois de
 * sorties. Les compteurs des autres pages relisent le stockage en s'ouvrant —
 * ils ne peuvent donc pas annoncer des mégaoctets disparus.
 */
function ClearData({ onClearData }) {
  const [confirm, setConfirm] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <PrefsCard
      title={t('Tout effacer')}
      foot={
        done
          ? t('Tout est effacé : l\'app repart comme au premier jour.')
          : t('Favoris, sorties, départs nommés, signalements, contact d\'urgence, réglages, cartes et rues gardées. Fais une sauvegarde avant si tu veux pouvoir revenir en arrière.')
      }
    >
      {confirm ? (
        <>
          <ActionRow icon="close" label={t('Annuler')} onClick={() => setConfirm(false)} />
          <ActionRow
            icon="ban"
            danger
            label={t('Confirmer l\'effacement')}
            onClick={async () => {
              await onClearData()
              setConfirm(false)
              setDone(true)
            }}
          />
        </>
      ) : (
        <ActionRow icon="ban" danger label={t('Effacer mes données')} onClick={() => setConfirm(true)} />
      )}
    </PrefsCard>
  )
}

/** Les libellés de l'apparence du moment, pour la ligne du sommaire. */
function appearanceLabels() {
  const look = getAppearance()
  const label = (list, key) => list.find((o) => o.key === key)?.label ?? ''
  return { accent: t(label(ACCENTS, look.accent)), theme: t(label(THEMES, look.theme)), text: look.text }
}

/**
 * L'apparence : le thème, la couleur d'accent, la taille du texte, le fond de
 * carte. Appliqués au toucher, sans bouton « Appliquer » : l'écran change sous
 * le doigt, et c'est ce qu'on vient voir.
 */
function AppearanceSettings({ mapStyle, onStyles }) {
  const look = useAppearance()
  const language = useLang()
  // Lue au rendu partout ailleurs : changer d'onglet suffit à tout réafficher.
  const [unit, setUnit] = useState(units)
  return (
    <PrefsCard
      title={t('Affichage')}
      foot={t('Le vert, le jaune et le rouge de la sécurité ne suivent pas l\'accent : ce sont des avis, pas une décoration.')}
    >
      <PickRow icon="language" label={t('Langue')} value={language} options={LANGUAGES} onChange={setLang} />
      <PickRow
        icon="appearance"
        label={t('Thème')}
        value={look.theme}
        options={THEMES}
        onChange={(theme) => setAppearance({ theme })}
      />
      <PickRow
        icon="palette"
        label={t('Couleur d\'accent')}
        value={look.accent}
        shown={ACCENTS.find((o) => o.key === look.accent)?.label}
        options={ACCENTS.map((a) => ({
          key: a.key,
          // Peinte par le jeton de l'accent lui-même : voir `styles/01-base.css`.
          label: (
            <span className="swatch-opt">
              <i data-accent={a.key} />
              {t(a.label)}
            </span>
          ),
        }))}
        onChange={(accent) => setAppearance({ accent })}
      />
      <PickRow
        icon="textSize"
        label={t('Taille du texte')}
        value={look.text}
        options={TEXT_SIZES}
        onChange={(text) => setAppearance({ text })}
      />
      <PickRow
        icon="ruler"
        label={t('Unités')}
        value={unit}
        options={UNIT_OPTIONS}
        onChange={(value) => {
          setUnits(value)
          setUnit(value)
        }}
      />
      {onStyles && <LinkRow icon="layers" label={t('Style de carte')} value={styleByKey(mapStyle).label} onClick={onStyles} />}
    </PrefsCard>
  )
}

// Ce que l'accueil propose à l'ouverture de l'app : lu par `App.jsx`.
const LAUNCH_GOALS = [
  { key: 'last', label: 'Le dernier utilisé' },
  { key: 'loop', label: 'Boucle' },
  { key: 'journey', label: 'Aller à…' },
]

function LaunchGoalRow() {
  const [value, setValue] = useState(() => load().launchGoal ?? 'last')
  return (
    <PickRow
      icon="play"
      label={t('Au lancement')}
      value={value}
      options={LAUNCH_GOALS}
      onChange={(launchGoal) => {
        setValue(launchGoal)
        save({ launchGoal })
      }}
    />
  )
}

const UNIT_OPTIONS = [
  { key: 'km', label: 'Kilomètres' },
  { key: 'mi', label: 'Miles' },
]

// Le côté de la route où l'on court — `side` dans le moteur, voir `keepSide`.
// La gauche d'abord : c'est ce que demande le code de la route.
const SIDES = [
  { key: 'left', label: 'Gauche' },
  { key: 'right', label: 'Droite' },
  { key: 'any', label: 'Indifférent' },
]

const SAFETY_OPTIONS = [
  { key: 'safe', label: 'Sûr' },
  { key: 'standard', label: 'Standard' },
]

const FORM_OPTIONS = [
  { key: 'auto', label: 'Auto' },
  { key: 'loop', label: 'Une boucle' },
  { key: 'eight', label: 'Deux boucles' },
  { key: 'laps', label: 'Des tours' },
]

const LAP_OPTIONS = Array.from({ length: MAX_LAPS - 1 }, (_, i) => ({ key: i + 2, label: `${i + 2} tours` }))

/**
 * Comment Lacet dessine les boucles : ce qu'on règle une fois pour toutes.
 *
 * La sécurité, la direction, la forme et ce qu'on évite étaient dans le
 * panneau Filtres, entre la longueur et « Rechercher » : on les faisait défiler
 * à chaque sortie sans jamais y toucher. Ici, ils valent pour toutes les
 * recherches suivantes, et le panneau ne garde que ce qui change d'une sortie
 * à l'autre.
 */
function SearchSettings({ params, onProfile }) {
  const avoid = params.avoid ?? []
  const sport = params.sport ?? 'run'
  return (
    <>
      <PrefsCard
        title={t('Itinéraire')}
        foot={t('Sûr écarte les routes rapides sans trottoir. À gauche, on court face aux voitures (R412-36).')}
      >
        <PickRow
          icon="shield"
          label={t('Sécurité')}
          value={params.safety ?? 'safe'}
          options={SAFETY_OPTIONS}
          onChange={(safety) => onProfile({ safety })}
        />
        <PickRow
          icon="compass"
          label={t('Direction')}
          value={directionOf(params.direction)?.key ?? 'auto'}
          shown={directionOf(params.direction)?.title ?? t('Auto')}
          options={DIRECTIONS.map((d) => ({ key: d.key, label: d.title ?? t('Auto') }))}
          onChange={(direction) => onProfile({ direction })}
        />
        <PickRow
          icon="repeat"
          label={t('Forme')}
          value={params.form ?? 'auto'}
          options={FORM_OPTIONS}
          onChange={(form) => onProfile({ form })}
        />
        {params.form === 'laps' && (
          <PickRow
            icon="refresh"
            label={t('Nombre de tours')}
            value={params.laps ?? 2}
            options={LAP_OPTIONS}
            onChange={(laps) => onProfile({ laps })}
          />
        )}
        <PickRow
          icon="navigation"
          label={t('Côté de la route')}
          value={params.side ?? 'left'}
          options={SIDES}
          onChange={(side) => onProfile({ side })}
        />
      </PrefsCard>

      <PrefsCard title={t('Éviter')}>
        {AVOIDABLE.filter((a) => !a.sport || a.sport === sport).map((a) => (
          <ToggleRow
            key={a.key}
            icon={{ steps: 'stairs', unlit: 'moon', known: 'history' }[a.key]}
            label={a.label}
            on={avoid.includes(a.key)}
            onChange={(on) => onProfile({ avoid: on ? [...avoid, a.key] : avoid.filter((k) => k !== a.key) })}
          />
        ))}
      </PrefsCard>

      <PrefsCard
        title={t('Recherche')}
        foot={t('La nuit, les rues éclairées passent devant. « Auto » suit le coucher du soleil.')}
      >
        <LaunchGoalRow />
        <PickRow
          icon="clock"
          label={t('Moment')}
          value={params.time_of_day ?? 'auto'}
          options={MOMENTS}
          onChange={(time_of_day) => onProfile({ time_of_day })}
        />
        <PickRow
          icon="routes"
          label={t('Propositions')}
          value={params.count ?? 5}
          shown={t('{v1} boucles', { v1: params.count ?? 5 })}
          options={COUNTS.map((c) => ({ key: c.key, label: t('{label} boucles', { label: c.label }) }))}
          onChange={(count) => onProfile({ count })}
        />
      </PrefsCard>
    </>
  )
}

/**
 * Une liste de raccourcis en puces : la croix en retire un, « + » en ajoute un.
 * Une liste tapée d'un trait (« 3 · 5 · 10 ») se lisait comme un texte, pas
 * comme des touches ; ici, on voit ce que l'accueil montrera.
 */
/** Ce que montre l'accueil : ses raccourcis de distance, et les filtres du panneau. */
function HomeSettings({ params, onProfile }) {
  const sport = params.sport ?? 'run'
  return (
    <>
      <PrefsCard
        title={t('Raccourcis de l\'accueil')}
        foot={t('Les touches sous la règle de distance, six au plus.')}
      >
        <PresetRow kind={sport === 'bike' ? 'bike' : 'run'} label={t('Distances')} icon="routes" unit={unitLabel()} />
        <PresetRow kind="duration" label={t('Durées')} icon="clock" unit="min" />
      </PrefsCard>
      <ShownFilters params={params} onProfile={onProfile} />
    </>
  )
}

function PresetRow({ kind, label, icon, unit }) {
  const [list, setList] = useState(() => presets(kind))
  const [adding, setAdding] = useState(false)
  const keep = (next) => {
    setPresets(kind, next)
    setList(next)
  }
  const add = (text) => {
    const [value] = parsePresets(text) ?? []
    if (value) keep(parsePresets([...list, value].join(' ')))
    setAdding(false)
  }
  return (
    <div className="rows__row presetrow">
      <span className="presetrow__label">
        <Icon name={icon} size={17} />
        {label}
      </span>
      <div className="presetrow__chips" role="group" aria-label={label}>
        {list.map((v) => (
          <span className="presetrow__chip" key={v}>
            {String(v).replace('.', dec())} <small>{unit}</small>
            {list.length > 1 && (
              <button onClick={() => keep(list.filter((x) => x !== v))} aria-label={t('Retirer {v} {unit}', { v, unit })}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            inputMode="decimal"
            aria-label={t('Nouvelle valeur, en {unit}', { unit })}
            placeholder={unit}
            onBlur={(e) => add(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          list.length < 6 && (
            <button className="presetrow__add" onClick={() => setAdding(true)} aria-label={t('Ajouter une valeur, en {unit}', { unit })}>
              <Icon name="plus" size={14} />
            </button>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Ce qu'on veut voir dans le panneau Filtres. Décocher remet le filtre à sa
 * valeur par défaut, et la ligne le dit : un réglage qu'on ne voit plus ne doit
 * pas continuer d'agir en douce (voir `OPTIONAL_FILTERS`).
 */
/** Les mêmes icônes que les autres réglages : une ligne sans icône paraissait d'une autre page. */
const FILTER_ICONS = { sport: 'run', terrain: 'forest', relief: 'hilly' }

function ShownFilters({ params, onProfile }) {
  const hidden = params.hiddenFilters ?? []
  const toggle = (f) =>
    onProfile(
      hidden.includes(f.key)
        ? { hiddenFilters: hidden.filter((k) => k !== f.key) }
        : { hiddenFilters: [...hidden, f.key], ...f.reset },
    )
  return (
    <PrefsCard title={t('Panneau Filtres')} foot={t('La longueur et l\'allure y restent toujours.')}>
      {OPTIONAL_FILTERS.map((f) => {
        const on = !hidden.includes(f.key)
        return (
          <ToggleRow
            key={f.key}
            icon={FILTER_ICONS[f.key]}
            label={f.label}
            sub={on ? null : t('Masqué. {fixed}', { fixed: f.fixed })}
            on={on}
            onChange={() => toggle(f)}
          />
        )
      })}
    </PrefsCard>
  )
}

/**
 * Les rues déjà sur l'appareil, et le plafond qu'elles ne dépasseront pas.
 *
 * Il n'y a rien à épingler ni à choisir : les rues d'un endroit s'enregistrent
 * toutes seules quand on y cherche une boucle, et quand le budget est atteint,
 * ce sont celles dont on ne s'est pas servi depuis le plus longtemps qui
 * partent. Le dire évite deux inquiétudes : que l'app mange le téléphone, et
 * qu'il faille préparer quoi que ce soit avant de partir en voyage.
 */
function KeptStreets() {
  const [usage, setUsage] = useState(null)

  useEffect(() => {
    let vivant = true
    import('./engine/tilestore').then(({ tileUsage }) =>
      tileUsage().then((u) => {
        if (vivant) setUsage(u)
      }),
    )
    return () => {
      vivant = false
    }
  }, [])

  return (
    <PrefsCard title={t('Rues gardées')} foot={t('Gardées toutes seules dès qu\'on cherche une boucle, pour trois mois : rien à préparer avant un voyage.')}>
      <InfoRow icon="routes" label={t('Espace occupé')} value={usage ? offline.formatBytes(usage.bytes) : '—'} />
      <InfoRow icon="gauge" label={t('Plafond')} value={usage ? offline.formatBytes(usage.budget) : '—'} />
    </PrefsCard>
  )
}

/**
 * Le poids de ce qui est gardé dans le petit stockage de l'app, et ce qu'il en reste.
 *
 * Tout le reste de cet écran mesure des choses qu'on peut retélécharger : des
 * tuiles, des rues. Celle-ci mesure la seule qu'on ne peut pas refaire — les
 * sorties courues — et elle est gardée là où la place est la plus comptée :
 * cinq mégaoctets pour toute l'app.
 *
 * Elle existe parce que le débordement était **silencieux**. Quand l'écriture
 * échouait, l'app sacrifiait la moitié des sorties les plus anciennes pour
 * faire de la place, et ne le disait que dans une console. On découvrait le
 * trou des mois plus tard, sans pouvoir le relier à rien.
 */
function StoredData() {
  const [info, setInfo] = useState(() => usage())
  const [freed, setFreed] = useState(null)
  if (!info) return <p className="muted small">{t('Le stockage de l\'app ne répond pas.')}</p>

  const part = Math.min(1, info.bytes / info.quota)
  const serre = part > 0.75
  return (
    <>
      {info.refusedAt && (
        <div className="notice notice--warn">
          <b>{t('Le stockage est plein.')}</b>{' '}{t('La dernière modification n\'a pas pu être enregistrée — ni favori, ni réglage, ni sortie terminée. Retire des traces ci-dessous, ou fais une sauvegarde puis efface, avant de repartir courir.')}</div>
      )}
      {info.trimmed && (
        <div className="notice notice--warn">
          <b>{t('De la place a dû être faite le {v1}.', { v1: dayOf(info.trimmed.at) })}</b>{' '}{t('Le stockage était plein :')}{' '}{/* Alléger d'abord, supprimer ensuite (`save`) : l'un, l'autre ou
              les deux, et chacun se dit autrement. */}{t('{v1} pour que la suite puisse s\'enregistrer. Les plus récentes, elles, sont intactes.', { v1: [
            info.trimmed.briefed > 0 &&
              `${info.trimmed.briefed} sorties ont perdu leur trace et leur parcours prévu, pas leurs chiffres`,
            info.trimmed.from > info.trimmed.to &&
              `${info.trimmed.from - info.trimmed.to} sorties parmi les plus anciennes ont été supprimées`,
          ]
            .filter(Boolean)
            .join(', et ') })}<button
            className="linkish"
            onClick={() => {
              forgetTrim()
              setInfo(usage())
            }}
          >{t('J\'ai lu')}</button>
        </div>
      )}

      <PrefsCard
        title={t('Sorties et favoris')}
        foot={
          freed !== null
            ? t('{v1} libérés. Les chiffres des sorties n\'ont pas bougé.', { v1: mo(freed) })
            : t('Une trace est le dessin de ce qu\'on a réellement couru. La retirer garde la distance, le temps, l\'allure et les tours de kilomètre : seuls le tracé sur la carte et son export s\'en vont.')
        }
      >
        <InfoRow
          icon="archive"
          label={mo(info.bytes)}
          sub={t('sur environ {v1} — {history} sortie{v3} ({v4}), {favorites} favori{v6} ({v7}).', { v1: mo(info.quota), history: info.counts.history, v3: info.counts.history > 1 ? 's' : '', v4: mo(info.parts.history), favorites: info.counts.favorites, v6: info.counts.favorites > 1 ? 's' : '', v7: mo(info.parts.favorites) })}
        >
          <div className={`gauge ${serre ? 'gauge--tight' : ''}`}>
            <i style={{ transform: `scaleX(${part})` }} />
          </div>
        </InfoRow>
        {info.counts.traces > 0 && (
          <ActionRow
            icon="routes"
            label={t('Retirer les {traces} traces gardées ({v2})', { traces: info.counts.traces, v2: mo(info.parts.traces) })}
            onClick={() => {
              const libere = dropTracks()
              setFreed(libere)
              setInfo(usage())
            }}
          />
        )}
      </PrefsCard>
    </>
  )
}

/** « 1,4 Mo », « 320 ko ». */
function mo(octets) {
  if (octets >= 1048576) return `${(octets / 1048576).toFixed(1).replace('.', dec())} Mo`
  return `${Math.round(octets / 1024)} ko`
}

/** « 28 septembre » */
const dayOf = (at) => new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'long' })

/**
 * Ce qu'on a signalé en courant, et qu'on peut retirer.
 *
 * Un signalement écarte des rues pour les six mois qui viennent : il faut
 * pouvoir le relire et le défaire. Un chantier fini, un appui de trop dans la
 * poche, et la boucle du dimanche se met à faire un crochet inexplicable —
 * cette liste est la seule façon de comprendre pourquoi, et d'y remédier.
 */
function MyReports() {
  const [items, setItems] = useState(() => activeReports())
  return (
    <PrefsCard
      title={t('Mes signalements')}
      foot={
        items.length
          ? t('{length} point{v2} écarté{v3} du routage, dans un rayon de vingt-cinq mètres chacun. Ils s\'effacent d\'eux-mêmes au bout de six mois.', { length: items.length, v2: items.length > 1 ? 's' : '', v3: items.length > 1 ? 's' : '' })
          : null
      }
    >
      {items.length ? (
        items.map((r) => (
          <InfoRow
            key={r.id}
            icon="warning"
            label={kindLabel(r.kind)}
            sub={`${new Date(r.at).toLocaleDateString(locale(), { day: 'numeric', month: 'long' })} · ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`}
            trailing={<button className="prow__act" onClick={() => setItems(removeReport(r.id))}>{t('Retirer')}</button>}
          />
        ))
      ) : (
        <InfoRow icon="warning" sub={t('Rien de signalé. En course, « Signaler un problème ici » écarte un passage fermé ou dangereux pour six mois.')} />
      )}
    </PrefsCard>
  )
}

/**
 * Les zones dessinées sur la carte, que toutes les boucles contournent.
 *
 * Comme les signalements, il faut pouvoir les relire : une zone oubliée fait
 * faire un crochet que plus personne n'explique. On la renomme pour s'y
 * retrouver, on la désactive le temps qu'elle redevienne praticable — la chasse
 * ferme en février —, et on la supprime quand elle n'a plus lieu d'être.
 */
function MyZones({ zones, onZones }) {
  return (
    <PrefsCard title={t('Mes zones à éviter')}>
      {zones.length ? (
        zones.map((z) => (
          <div className="prow" key={z.id}>
            <div className="prow__btn prow__static zonerow">
              <Icon name="zone" size={19} className="prow__icon" />
              <input
                className="prow__input"
                defaultValue={z.name}
                maxLength={60}
                aria-label={t('Nom de la zone')}
                onBlur={(e) => e.target.value !== z.name && onZones(updateZone(z.id, { name: e.target.value }))}
              />
              {/* L'interrupteur d'iOS plutôt qu'une case : évitée ou ignorée,
                  le temps qu'elle redevienne praticable. */}
              <button
                role="switch"
                aria-checked={z.on !== false}
                aria-label={z.on !== false ? t('Évitée') : t('Ignorée')}
                className={`switch ${z.on !== false ? 'switch--on' : ''}`}
                onClick={() => onZones(updateZone(z.id, { on: z.on === false }))}
              >
                <i />
              </button>
              <button className="prow__act prow__act--danger" onClick={() => onZones(removeZone(z.id))}>{t('Supprimer')}</button>
            </div>
          </div>
        ))
      ) : (
        <InfoRow icon="zone" sub={t('Aucune zone. Sur la carte, le cercle hachuré en pose une : boucles et recalculs passent autour.')} />
      )}
    </PrefsCard>
  )
}

/**
 * Ce que les cartes hors ligne occupent, et de quoi tout reprendre.
 *
 * Un chiffre plutôt qu'une promesse : ces fichiers sont les seuls de l'app à se
 * compter en mégaoctets, et un stockage qui grossit sans qu'on puisse le voir
 * finit par être vidé par iOS — au pire moment, sans prévenir.
 */
function OfflineStorage() {
  const [total, setTotal] = useState(() => offline.totalBytes())
  const [count, setCount] = useState(() => offline.storedCount())
  const [confirm, setConfirm] = useState(false)

  if (!offline.isAvailable()) {
    return (
      <PrefsCard title={t('Cartes hors ligne')}>
        <InfoRow icon="layers" sub={t('Le stockage de l\'appareil ne répond pas : les cartes ne peuvent pas être gardées. Les parcours, eux, restent accessibles.')} />
      </PrefsCard>
    )
  }

  return (
    <PrefsCard title={t('Cartes hors ligne')} foot={t('Les cinq dernières sorties gardent leur carte, au cas où le réseau tombe. Hors ligne, c\'est le fond Nuit qui sert.')}>
      <InfoRow icon="layers" label={t('Parcours avec carte')} value={String(count)} />
      <InfoRow icon="download" label={t('Espace occupé')} value={offline.formatBytes(total)} />
      {count > 0 &&
        (confirm ? (
          <>
            <ActionRow icon="close" label={t('Annuler')} onClick={() => setConfirm(false)} />
            <ActionRow
              icon="ban"
              danger
              label={t('Vider les cartes')}
              onClick={async () => {
                await offline.clear()
                setTotal(0)
                setCount(0)
                setConfirm(false)
              }}
            />
          </>
        ) : (
          <ActionRow icon="ban" danger label={t('Vider les cartes hors ligne')} onClick={() => setConfirm(true)} />
        ))}
    </PrefsCard>
  )
}

/** Un réglage booléen gardé dans le stockage, vrai par défaut. */
function useStored(key) {
  const [on, setOn] = useState(() => load()[key] !== false)
  return [
    on,
    (value) => {
      setOn(value)
      save({ [key]: value })
    },
  ]
}

/**
 * Ce que l'app fait d'elle-même pendant une sortie. Tout est actif par défaut,
 * parce que c'est ce qu'on attend d'une app de course ; chaque réglage se
 * coupe pour qui court autrement. Lus au départ d'une sortie (`LiveRun.jsx`).
 */
function RunSettings({ poiPrefs, onPoiPrefs }) {
  const [reroute, setReroute] = useStored('autoReroute')
  const [finish, setFinish] = useStored('autoFinish')
  const [pause, setPause] = useStored('autoPause')
  const [screen, setScreen] = useStored('keepScreenOn')
  return (
    <PrefsCard
      title={t('Pendant la sortie')}
      foot={t('Éteints, « Recalculer » et « Terminer » restent à portée de main.')}
    >
      <ToggleRow
        icon="refresh"
        label={t('Recalcul automatique')}
        on={reroute}
        onChange={setReroute}
      />
      <ToggleRow
        icon="flag"
        label={t('Arrêt automatique à l\'arrivée')}
        on={finish}
        onChange={setFinish}
      />
      <ToggleRow
        icon="pause"
        label={t('Pause automatique')}
        on={pause}
        onChange={setPause}
      />
      <ToggleRow
        icon="sun"
        label={t('Écran toujours allumé')}
        on={screen}
        onChange={setScreen}
      />
      {Object.entries(KINDS).map(([kind, k]) => (
        <ToggleRow
          key={kind}
          icon={k.icon}
          label={t('{label} sur le parcours', { label: t(k.label) })}
          on={Boolean(poiPrefs?.[kind])}
          onChange={(on) => onPoiPrefs({ [kind]: on })}
        />
      ))}
    </PrefsCard>
  )
}

// Au mile quand l'app est en miles : la voix compte alors ses bornes au mile.
const kmEvery = () => [
  { key: 1, label: t('Chaque {v1}', { v1: unitLabel() }) },
  { key: 2, label: t('Tous les 2 {v1}', { v1: unitLabel() }) },
  { key: 0, label: t('Jamais') },
]
const kmSays = () => [
  ['lap', t('Temps du {v1}', { v1: unitLabel() }), 'clock'],
  ['pace', t('Allure'), 'gauge'],
  ['total', t('Temps couru'), 'history'],
]
// « Anticipation des instructions » : quand la voix annonce un virage.
const LEADS = [
  { key: 'early', label: 'Tôt' },
  { key: 'normal', label: 'Moyen' },
  { key: 'late', label: 'Tard' },
]
const VOLUMES = [
  { key: 'low', label: 'Faible' },
  { key: 'medium', label: 'Moyen' },
  { key: 'high', label: 'Fort' },
]
// Ce que devient la musique le temps d'une phrase : baissée, ou en pause.
const MUSIC = [
  { key: 'duck', label: 'Baissée' },
  { key: 'pause', label: 'En pause' },
]
const timeEvery = () => [0, 5, 10, 15, 30].map((n) => ({ key: n, label: n ? t('Toutes les {n} min', { n }) : t('Jamais') }))
const RATES = [
  { key: 'slow', label: 'Lent' },
  { key: 'normal', label: 'Normal' },
  { key: 'fast', label: 'Rapide' },
]

/**
 * La voix : laquelle, à quelle vitesse, quand elle annonce, et ce qu'elle dit
 * à chaque kilomètre.
 *
 * La plainte n° 1 dans les avis des apps concurrentes, c'est la voix : trop
 * bavarde pour les uns, muette pour les autres. Seul le confort se règle : les
 * alertes de traversée, l'écart du parcours et le « maintenant » d'un virage se
 * disent toujours. Lu au départ d'une sortie (`LiveRun.jsx`).
 */
function VoiceSetting() {
  const [prefs, setPrefs] = useState(voiceSettings)
  const [voices, setVoices] = useState([])
  const language = useLang()
  const change = (patch) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    save({ voice: next })
  }

  useEffect(() => {
    if (!isNative()) return
    // Redemandée une fois si vide : iOS charge ses voix à la demande, et la
    // première réponse arrivait parfois avant elles.
    let gone = false
    const ask = (again) =>
      import('./native')
        .then((n) => n.voicesNative(lang()))
        .then((list) => {
          if (gone) return
          if (list.length || !again) setVoices(list)
          else setTimeout(() => ask(false), 1500)
        })
    ask(true)
    return () => {
      gone = true
    }
  }, [language])

  const voiceOptions = [
    { key: null, label: t('Voix du système') },
    ...voices.map((v) => ({ key: v.id, label: v.enhanced ? t('{name} (améliorée)', { name: v.name }) : v.name })),
  ]

  return (
    <>
      <PrefsCard title={t('Voix')}>
        <PickRow
          icon="volume"
          label={t('Voix utilisée')}
          value={prefs.voiceId ?? null}
          shown={voices.find((v) => v.id === prefs.voiceId)?.name ?? t('Voix du système')}
          options={voiceOptions}
          onChange={(voiceId) => change({ voiceId })}
        />
        <PickRow icon="volume" label={t('Volume de la voix')} value={prefs.volume ?? 'high'} options={VOLUMES} onChange={(volume) => change({ volume })} />
        <PickRow
          icon="volumeOff"
          label={t('Musique')}
          value={prefs.music ?? 'duck'}
          options={MUSIC}
          onChange={(music) => change({ music })}
        />
        <PickRow icon="gauge" label={t('Débit')} value={prefs.rate ?? 'normal'} options={RATES} onChange={(rate) => change({ rate })} />
        <PickRow
          icon="turnRight"
          label={t('Anticipation des instructions')}
          value={prefs.lead}
          options={LEADS}
          onChange={(lead) => change({ lead })}
        />
        <LinkRow icon="play" label={t('Écouter la voix')} onClick={() => preview()} />
      </PrefsCard>

      <PrefsCard
        title={t('Annonces')}
        foot={t('La distance est toujours dite. À vélo, tous les 5 ou 10 km.')}
      >
        <PickRow icon="flag" label={units() === 'mi' ? t('Miles') : t('Kilomètres')} value={prefs.km} options={kmEvery()} onChange={(km) => change({ km })} />
        {prefs.km !== 0 &&
          kmSays().map(([key, label, icon]) => (
            <ToggleRow key={key} icon={icon} label={label} on={prefs[key]} onChange={(on) => change({ [key]: on })} />
          ))}
        <PickRow
          icon="clock"
          label={t('Rappel du temps couru')}
          value={prefs.timeEvery ?? 0}
          options={timeEvery()}
          onChange={(timeEvery) => change({ timeEvery })}
        />
        <ToggleRow
          icon="trendUp"
          label={t('Écart à l\'allure visée')}
          on={prefs.target}
          onChange={(target) => change({ target })}
        />
      </PrefsCard>
    </>
  )
}

/**
 * L'écran de verrouillage pendant une sortie guidée.
 *
 * Quatre conditions, et il suffit qu'une manque pour que l'écran reste noir
 * sans un mot : iOS assez récent, activités autorisées dans Réglages,
 * extension embarquée **et** rattachée à l'app, et surtout **signée**. C'est
 * cette dernière qui a coûté une soirée : un installateur qui signe l'app sans
 * signer son extension donne une activité acceptée par iOS et dessinée par
 * personne. L'app les vérifie donc, et ne parle que quand ça coince.
 */
function LockScreenSetting() {
  const [status, setStatus] = useState(undefined)

  useEffect(() => {
    if (!isNative()) return
    import('./native').then((n) => n.lockScreenStatus()).then(setStatus)
  }, [])

  if (!isNative() || status === undefined) return null

  let problem = null
  if (!status) problem = t('Cette version de l\'app n\'a pas le module d\'écran verrouillé.')
  else if (!status.supported) problem = t('L\'activité en direct demande iOS 16.2 ou plus récent.')
  else if (!status.enabled) problem = t('Activités en direct coupées : Réglages › Lacet › Activités en direct.')
  else if (!status.extension) problem = t('L\'extension qui dessine l\'activité a été retirée à l\'installation.')
  else if (status.nested === false) {
    problem = t('L\'app a été installée sous un autre nom ({bundle}) : l\'extension {extensionBundle} ne lui est plus rattachée, et iOS refuse de la lancer.', { bundle: status.bundle, extensionBundle: status.extensionBundle })
  } else if (status.signedExtension === false) {
    problem =
      t('L\'extension n\'a pas reçu de signature : l\'outil d\'installation a signé l\'app et pas son extension. Réinstalle avec AltStore, qui la signe.')
  }

  return (
    <>
      <p className="muted small">
        <b>{t('Écran verrouillé.')}</b>{' '}{t('Pendant une sortie guidée, le prochain virage, sa distance, ce qui reste et l\'heure d\'arrivée s\'affichent sur l\'écran verrouillé et dans la Dynamic Island. La musique continue.')}</p>
      {problem && <div className="notice notice--warn">{problem}</div>}
    </>
  )
}

/**
 * Quelle version tourne, exactement.
 *
 * Deux numéros, parce qu'ils peuvent différer : celui du **paquet installé**,
 * lu par iOS, et celui de l'**interface** compilée dedans. Une réinstallation
 * ratée laisse le premier en arrière ; un cache tenace, le second. Sans les
 * afficher, on cherche un bogue dans du code que le téléphone n'exécute même
 * pas — c'est arrivé.
 */
function BuildStamp() {
  const web = import.meta.env.VITE_BUILD || null
  const commit = (import.meta.env.VITE_COMMIT || '').slice(0, 7)
  const [app, setApp] = useState(null)

  useEffect(() => {
    if (!isNative()) return
    import('./native').then((n) => n.appVersion()).then(setApp)
  }, [])

  const parts = [
    app ? t('app {version} (build {build})', { version: app.version, build: app.build }) : null,
    web ? `interface build ${web}` : t('interface de développement'),
    commit || null,
  ].filter(Boolean)

  return (
    <p className="muted small">
      {parts.join(' · ')}
      {app && web && app.build !== String(web) && (
        <>
          {' '}— <b>{t('les deux numéros diffèrent')}</b>{' '}{t(': l\'app affiche une interface plus ancienne que celle qu\'elle contient. Ferme-la complètement et rouvre-la ; si ça persiste, réinstalle-la.')}</>
      )}
    </p>
  )
}

/**
 * Où est passé le temps de la dernière recherche.
 *
 * Tout se calcule ici, sur l'appareil, et « c'est long » peut vouloir dire trois
 * choses très différentes : les rues qui arrivent mal, le graphe qui se
 * construit, ou les altitudes qu'un service public met des secondes à rendre.
 * Le détail tient en une ligne et se lit en bas de chez soi, réseau du moment
 * compris — c'est ce qui permet d'aller corriger le bon endroit.
 */
function LastSearch() {
  const last = load().lastSearch
  if (!last) return null
  // Deux décimales sous la seconde : c'est là que se jouent les étapes qu'on
  // cherche à raccourcir, et « 0,0 s » n'apprend rien.
  const s = (v) => `${(v ?? 0).toFixed(v >= 1 ? 1 : 2).replace('.', dec())} s`
  // Les rues préparées en fond ne coûtent rien à la recherche : le dire ainsi
  // évite de lire deux zéros comme une mesure ratée.
  const ready = !last.fetch && !last.graph
  const parts = [
    ready ? t('rues déjà prêtes') : `rues ${s(last.fetch)}`,
    ready ? null : `graphe ${s(last.graph)}`,
    t('itinéraires {v1}', { v1: s(last.routing) }),
    last.elevation ? `altitude ${s(last.elevation)}` : null,
  ].filter(Boolean)
  // D'où venaient les rues : la carte livrée, les archives en ligne, Overpass,
  // ou l'appareil. C'est la première question quand une recherche traîne.
  const venues = last.sources
    ? Object.entries(last.sources)
        .map(([quoi, n]) => `${n} ${quoi}`)
        .join(', ')
    : null

  return (
    <p className="muted small">{t('Dernier calcul : {km} km en {v2} — {v3}{v4}{v5}', { km: last.km, v2: s(last.total), v3: parts.join(' · '), v4: last.nodes ? t(' ({v1} nœuds)', { v1: last.nodes.toLocaleString(locale()) }) : '', v5: venues ? t(' · rues : {venues}', { venues }) : '' })}</p>
  )
}

/**
 * Emporter ses données, et les remettre.
 *
 * Favoris, sorties et réglages vivent dans cet appareil, et nulle part
 * ailleurs : c'est le principe de l'app, mais ça veut dire qu'une
 * réinstallation les emporte. Un fichier suffit à les retrouver — et il se
 * range où l'on veut, sans compte.
 */
function BackupRows({ onRestored }) {
  const [message, setMessage] = useState(null)

  const backup = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    await saveTextFile(`lacet-sauvegarde-${stamp}.json`, exportAll(), 'application/json')
    setMessage(t('Sauvegarde écrite. Garde-la hors du téléphone si tu comptes réinstaller l’app.'))
  }

  const restore = async (file) => {
    if (!file) return
    try {
      const { favorites, history, left } = importAll(await file.text())
      // L'écran relit tout de suite ce qui vient d'être écrit : laissé à ses
      // listes d'avant, il les aurait réécrites par-dessus à la première occasion.
      onRestored?.()
      // Ce que les plafonds ont laissé dehors se dit, au lieu de disparaître.
      const dehors = [
        left.favorites > 0 && t('{favorites} favori{v2} (plafond de {MAX_FAVORITES})', { favorites: left.favorites, v2: left.favorites > 1 ? 's' : '', MAX_FAVORITES }),
        left.history > 0 && t('{history} sortie{v2} (plafond de {MAX_HISTORY})', { history: left.history, v2: left.history > 1 ? 's' : '', MAX_HISTORY }),
        left.places > 0 && t('{places} départ{v2} nommé{v3} (plafond de {MAX_PLACES})', { places: left.places, v2: left.places > 1 ? 's' : '', v3: left.places > 1 ? 's' : '', MAX_PLACES }),
      ].filter(Boolean)
      setMessage(
        t('Restauré : {favorites} parcours en favori, {history} sorties.', { favorites, history }) +
          (dehors.length ? t(' Pas de place pour {v1}.', { v1: dehors.join(', ') }) : ''),
      )
    } catch (error) {
      setMessage(t(error.message))
    }
  }

  return (
    <PrefsCard foot={message ?? t('Un fichier qui emporte favoris, sorties et réglages — à garder ailleurs avant de supprimer l\'app, qui les effacerait.')}>
      <ActionRow icon="fileExport" label={t('Sauvegarder')} onClick={backup} />
      <ActionRow icon="fileImport" label={t('Restaurer')} accept="application/json,.json" onFile={restore} />
    </PrefsCard>
  )
}
