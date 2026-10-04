/**
 * Mon compte : un sommaire, et une page par sujet.
 *
 * L'écran empilait quatorze rubriques les unes sous les autres — poids,
 * Strava, cartes hors ligne, contact d'urgence, version de l'app… — et l'on
 * faisait défiler le tout pour trouver le réglage qu'on venait changer. Le
 * sommaire range ces rubriques en trois familles, comme les Réglages de
 * l'iPhone : ce qu'on règle, ce que l'app garde, et ce qu'il faut savoir
 * d'elle. Chaque ligne dit déjà l'essentiel — « 70 kg », « Connecté » — et
 * n'a besoin d'être ouverte que pour le changer.
 *
 * Tout y est local à l'appareil — c'est le propos de l'écran, et la raison
 * pour laquelle il ne dépend de rien d'autre que du stockage de l'app.
 *
 * La page ouverte est tenue par l'app (`page`, `onPage`) : c'est son en-tête
 * qui porte le retour au sommaire, et l'onglet le referme quand on y revient.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { COUNTS, MOMENTS, SPORTS, Segmented } from './FiltersSheet.jsx'
import { surfaceLabel } from './format'
import { dropTracks, exportAll, forgetTrim, importAll, load, save, usage } from './storage'
import { activeReports, kindLabel, removeReport } from './reports'
import { isNative, saveTextFile } from './platform'
import * as offline from './offlineMaps'
import * as strava from './strava'
import { StravaSetting } from './Strava.jsx'
import { StopsSetting } from './Stops.jsx'
import { KINDS } from './pois'

/** Les familles du sommaire, dans leur ordre. */
const GROUPS = ['Paramètres', 'Données', 'Infos']

/**
 * Les pages de « Mon compte ». `tone` teinte la pastille : on retrouve une
 * ligne à sa couleur bien avant de l'avoir lue.
 */
export const SECTIONS = [
  { key: 'profile', group: 'Paramètres', icon: 'user', title: 'Profil' },
  { key: 'search', group: 'Paramètres', icon: 'sliders', title: 'Recherche' },
  { key: 'run', group: 'Paramètres', icon: 'play', title: 'Pendant la sortie' },
  { key: 'safety', group: 'Paramètres', icon: 'sos', title: 'Sécurité', tone: 'risk' },
  { key: 'strava', group: 'Paramètres', icon: 'upload', title: 'Strava', tone: 'strava' },
  { key: 'storage', group: 'Données', icon: 'layers', title: 'Stockage' },
  { key: 'backup', group: 'Données', icon: 'download', title: 'Sauvegarde' },
  { key: 'about', group: 'Infos', icon: 'info', title: 'À propos' },
]

/** Le titre d'une page, pour l'en-tête de l'app. */
export const sectionTitle = (key) => SECTIONS.find((s) => s.key === key)?.title ?? 'Mon compte'

export default function Account({ page = null, onPage = () => {}, ...props }) {
  const top = useRef(null)
  // Une page s'ouvre en haut : sans ça, elle héritait du défilement du
  // sommaire, et « Sauvegarde » s'ouvrait sur son dernier paragraphe.
  useLayoutEffect(() => {
    top.current?.closest('.side__body')?.scrollTo?.(0, 0)
  }, [page])

  const known = SECTIONS.some((s) => s.key === page)
  return (
    <div className={`panel acct ${known ? 'acct--page' : ''}`} ref={top}>
      {known ? <SectionPage page={page} {...props} /> : <Summary onPage={onPage} {...props} />}
    </div>
  )
}

/** Le sommaire : qui l'on est, puis une ligne par page. */
function Summary({ onPage, params, geo, history = [], poiPrefs }) {
  const runs = history.filter((h) => h.actual_distance_m > 0)
  const totalKm = runs.reduce((sum, h) => sum + h.actual_distance_m, 0) / 1000
  const sport = SPORTS.find((s) => s.key === params.sport)
  const position =
    geo.status === 'ready' ? `± ${Math.round(geo.accuracy)} m` : geo.status === 'denied' ? 'bloquée' : '—'

  return (
    <>
      <div className="acct__card">
        <div className="acct__who">
          <span className="acct__avatar">
            <Icon name={sport?.icon ?? 'user'} size={24} />
          </span>
          <div>
            <b>Profil local</b>
            <em>
              {[sport?.label, surfaceLabel(params.surface), params.safety === 'safe' ? 'Sûr' : 'Standard']
                .filter(Boolean)
                .join(' · ')}
            </em>
          </div>
        </div>
        <div className="acct__stats">
          <div>
            <b>{runs.length}</b>
            <span>sortie{runs.length > 1 ? 's' : ''}</span>
          </div>
          <div>
            <b>{String(totalKm >= 100 ? Math.round(totalKm) : Math.round(totalKm * 10) / 10).replace('.', ',')}</b>
            <span>kilomètres</span>
          </div>
          <div>
            <b>{position}</b>
            <span>GPS</span>
          </div>
        </div>
      </div>

      {GROUPS.map((group) => (
        <section className="acct__group" key={group} aria-label={group}>
          <h3 className="acct__label">{group}</h3>
          <div className="menu">
            {SECTIONS.filter((s) => s.group === group).map((s) => (
              <button key={s.key} className="menu__row" onClick={() => onPage(s.key)}>
                <span className={`menu__icon ${s.tone ? `menu__icon--${s.tone}` : ''}`}>
                  <Icon name={s.icon} size={18} />
                </span>
                <span className="menu__text">
                  <b>{s.title}</b>
                  <em>{summaryOf(s.key, { params, poiPrefs })}</em>
                </span>
                <Icon name="chevronRight" size={17} className="menu__chev" />
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="muted small acct__foot">
        Aucun compte. Favoris, sorties et réglages ne quittent pas cet appareil.
      </p>
    </>
  )
}

/**
 * Ce que dit une ligne du sommaire sous son titre : l'état du moment plutôt
 * qu'une description. « 70 kg » répond à la question avant qu'on ouvre.
 */
function summaryOf(key, { params, poiPrefs }) {
  const saved = load()
  switch (key) {
    case 'profile':
      return `Poids ${params.weight_kg || 70} kg`
    case 'search': {
      const moment = MOMENTS.find((m) => m.key === (params.time_of_day ?? 'auto'))?.label ?? 'Auto'
      return `Moment ${moment.toLowerCase()} · ${params.count ?? 5} boucles proposées`
    }
    case 'run': {
      const stops = Object.entries(KINDS)
        .filter(([kind]) => poiPrefs?.[kind])
        .map(([, k]) => k.label.toLowerCase())
      return [`Pause auto ${saved.autoPause !== false ? 'activée' : 'coupée'}`, ...stops].join(' · ')
    }
    case 'safety': {
      const reports = activeReports().length
      const contact = saved.emergencyContact ? `SOS vers ${saved.emergencyContact}` : "Pas de contact d'urgence"
      return reports ? `${contact} · ${reports} signalement${reports > 1 ? 's' : ''}` : contact
    }
    case 'strava': {
      const s = strava.status()
      if (!s.configured) return 'Pas disponible dans cette version'
      if (!s.connected) return 'Non connecté'
      const name = [s.athlete?.firstname, s.athlete?.lastname].filter(Boolean).join(' ')
      return [name ? `Connecté · ${name}` : 'Connecté', s.auto ? 'envoi automatique' : null].filter(Boolean).join(' · ')
    }
    case 'storage': {
      const info = usage()
      if (!info) return 'Sorties, cartes et rues gardées'
      const { history, favorites } = info.counts
      return `${mo(info.bytes)} · ${history} sortie${history > 1 ? 's' : ''}, ${favorites} favori${favorites > 1 ? 's' : ''}`
    }
    case 'backup':
      return 'Exporter, restaurer ou tout effacer'
    case 'about':
      return 'Version, confidentialité, sources'
    default:
      return ''
  }
}

/** Une page de « Mon compte ». */
function SectionPage({ page, params, poiPrefs, onPoiPrefs, onClearData, onProfile, onRestored }) {
  switch (page) {
    case 'profile':
      return (
        <>
          <p className="muted small">
            Le poids sert à estimer les calories d'une sortie, et rien d'autre. Rien n'est envoyé.
          </p>
          <div className="rows">
            <NumberRow
              label="Poids"
              unit="kg"
              value={params.weight_kg || 70}
              min={30}
              max={200}
              onChange={(weight_kg) => onProfile({ weight_kg })}
            />
          </div>
          <p className="muted small">
            L'activité, le terrain et le niveau de sécurité se règlent dans les filtres, au moment
            de chercher une boucle : ils changent d'une sortie à l'autre.
          </p>
        </>
      )
    case 'search':
      return <SearchSettings params={params} onProfile={onProfile} />
    case 'run':
      return (
        <>
          <h3 className="section">Pause automatique</h3>
          <AutoPauseSetting />
          <LockScreenSetting />
          <h3 className="section">Le long du parcours</h3>
          <StopsSetting prefs={poiPrefs} onChange={onPoiPrefs} />
        </>
      )
    case 'safety':
      return (
        <>
          <h3 className="section">Contact d'urgence</h3>
          <EmergencyContact />
          <h3 className="section">Mes signalements</h3>
          <MyReports />
        </>
      )
    case 'strava':
      return <StravaSetting />
    case 'storage':
      return (
        <>
          <h3 className="section">Sorties et favoris</h3>
          <StoredData />
          <h3 className="section">Cartes hors ligne</h3>
          <OfflineStorage />
          <h3 className="section">Rues gardées</h3>
          <KeptStreets />
        </>
      )
    case 'backup':
      return (
        <>
          <BackupRows onRestored={onRestored} />
          <h3 className="section">Tout effacer</h3>
          <ClearData onClearData={onClearData} />
        </>
      )
    case 'about':
      return (
        <>
          <h3 className="section">Version</h3>
          <BuildStamp />
          <LastSearch />
          <h3 className="section">Confidentialité</h3>
          <p className="muted small">
            Aucun compte. Favoris, sorties et réglages ne quittent pas cet appareil. Seuls partent
            sur le réseau : les rues et les altitudes autour du départ, le lieu qu'on cherche par
            son nom, et — si tu l'as connecté — ce que tu envoies à Strava.
          </p>
          <h3 className="section">Sources</h3>
          <p className="disclaimer">
            Données © contributeurs OpenStreetMap (ODbL) · Fonds de carte © CARTO, © OpenFreeMap,
            © Esri, © OpenTopoMap · Altitudes IGN RGE ALTI et Valhalla (FOSSGIS) · Recherche de
            lieux Photon (Komoot) et Nominatim · Vent Open-Meteo.
          </p>
        </>
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
  return (
    <>
      <p className="muted small">
        Le bouton SOS prépare un SMS vers ce numéro avec ta position.{' '}
        <b>L'app ne l'envoie pas</b> : c'est toi qui appuies sur envoyer.
      </p>
      <input
        className="field"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-label="Numéro du contact d'urgence"
        placeholder="06 12 34 56 78"
        value={contact}
        onChange={(e) => {
          setContact(e.target.value)
          save({ emergencyContact: e.target.value.trim() })
        }}
      />
    </>
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
    <>
      <p className="muted small">
        Favoris, sorties, réglages, cartes et rues gardées, et l'accès à Strava. Fais une
        sauvegarde avant si tu veux pouvoir revenir en arrière.
      </p>
      {confirm ? (
        <div className="row">
          <button className="btn" onClick={() => setConfirm(false)}>
            Annuler
          </button>
          <button
            className="btn btn--primary"
            onClick={async () => {
              await onClearData()
              setConfirm(false)
              setDone(true)
            }}
          >
            Confirmer l'effacement
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirm(true)}>
          Effacer mes données
        </button>
      )}
      {done && <p className="muted small">Tout est effacé : l'app repart comme au premier jour.</p>}
    </>
  )
}

/**
 * Les deux réglages de recherche qu'on choisit une fois.
 *
 * Le moment de la sortie et le nombre de propositions ne changent pas d'un jour
 * à l'autre : au milieu des filtres, ils encombraient le geste quotidien. Ici,
 * ils s'appliquent tout de suite, sans bouton « Appliquer » — on vient les
 * régler, pas les essayer.
 *
 * L'allure, elle, est repartie dans les filtres, sous la longueur : c'est elle
 * qui convertit une durée en distance, et on veut voir l'effet du réglage au
 * moment où on le touche.
 */
function SearchSettings({ params, onProfile }) {
  return (
    <div className="fields">
      <div className="field">
        <span className="label">Moment</span>
        <Segmented
          options={MOMENTS}
          value={params.time_of_day ?? 'auto'}
          onChange={(time_of_day) => onProfile({ time_of_day })}
        />
        <p className="field__hint">
          La nuit, les rues éclairées et passantes passent devant les chemins isolés, même
          quand ils raccourcissent. « Auto » compare l'heure du calcul au coucher du
          soleil, calculé pour le point de départ et pour aujourd'hui.
        </p>
      </div>

      <div className="field">
        <span className="label">Propositions</span>
        <Segmented
          options={COUNTS}
          value={params.count ?? 5}
          onChange={(count) => onProfile({ count })}
        />
        <p className="field__hint">
          Nombre de boucles proposées après une recherche. En demander plus allonge un peu
          le calcul, et les dernières se ressemblent davantage.
        </p>
      </div>
    </div>
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
    <>
      <div className="rows">
        <Row label="Espace occupé" value={usage ? offline.formatBytes(usage.bytes) : '—'} />
        <Row label="Plafond" value={usage ? offline.formatBytes(usage.budget) : '—'} />
      </div>
      <p className="muted small">
        Les rues d'un coin se gardent toutes seules dès qu'on y cherche une boucle, et y
        restent trois mois. Au plafond, les plus anciennement utilisées laissent la place —
        rien à préparer avant un voyage, rien à effacer au retour.
      </p>
    </>
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
  if (!info) return <p className="muted small">Le stockage de l'app ne répond pas.</p>

  const part = Math.min(1, info.bytes / info.quota)
  const serre = part > 0.75
  return (
    <>
      {info.refusedAt && (
        <div className="notice notice--warn">
          <b>Le stockage est plein.</b> La dernière modification n'a pas pu être enregistrée — ni
          favori, ni réglage, ni sortie terminée. Retire des traces ci-dessous, ou fais une
          sauvegarde puis efface, avant de repartir courir.
        </div>
      )}
      {info.trimmed && (
        <div className="notice notice--warn">
          <b>De la place a dû être faite le {dayOf(info.trimmed.at)}.</b> Le stockage était plein :{' '}
          {info.trimmed.from - info.trimmed.to} sorties parmi les plus anciennes ont été supprimées pour
          que la suite puisse s'enregistrer. Les plus récentes, elles, sont intactes.
          <button
            className="linkish"
            onClick={() => {
              forgetTrim()
              setInfo(usage())
            }}
          >
            J'ai lu
          </button>
        </div>
      )}

      <div className={`gauge ${serre ? 'gauge--tight' : ''}`}>
        <i style={{ transform: `scaleX(${part})` }} />
      </div>
      <p className="muted small">
        <b>{mo(info.bytes)}</b> sur environ {mo(info.quota)} — {info.counts.history} sortie
        {info.counts.history > 1 ? 's' : ''} ({mo(info.parts.history)}), {info.counts.favorites} favori
        {info.counts.favorites > 1 ? 's' : ''} ({mo(info.parts.favorites)}). La limite est celle du
        moteur web de l'app, pas du téléphone : elle vaut pour toute l'app, et chaque caractère y compte double.
      </p>

      {info.counts.traces > 0 && (
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const libere = dropTracks()
              setFreed(libere)
              setInfo(usage())
            }}
          >
            Retirer les {info.counts.traces} traces gardées ({mo(info.parts.traces)})
          </button>
        </div>
      )}
      <p className="muted small">
        {freed !== null
          ? `${mo(freed)} libérés. Les chiffres des sorties n'ont pas bougé.`
          : "Une trace est le dessin de ce qu'on a réellement couru. La retirer garde la distance, le temps, l'allure et les tours de kilomètre : seuls le tracé sur la carte et son export s'en vont."}
      </p>
    </>
  )
}

/** « 1,4 Mo », « 320 ko ». */
function mo(octets) {
  if (octets >= 1048576) return `${(octets / 1048576).toFixed(1).replace('.', ',')} Mo`
  return `${Math.round(octets / 1024)} ko`
}

/** « 28 septembre » */
const dayOf = (at) => new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

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
  if (!items.length) {
    return (
      <p className="muted small">
        Rien de signalé. Pendant une sortie, le bouton « Signaler un problème ici » note des
        travaux, un passage fermé ou un danger à l'endroit où tu te trouves : les boucles
        suivantes passeront ailleurs, et la sortie en cours se recalcule aussitôt. Ces points
        restent sur l'appareil — personne d'autre ne les voit — et s'effacent au bout de six mois.
      </p>
    )
  }
  return (
    <>
      <p className="muted small">
        {items.length} point{items.length > 1 ? 's' : ''} écarté{items.length > 1 ? 's' : ''} du
        routage, dans un rayon de vingt-cinq mètres chacun. Ils s'effacent d'eux-mêmes au bout de
        six mois.
      </p>
      <div className="rows">
        {items.map((r) => (
          <div className="rows__row" key={r.id}>
            <span>
              {kindLabel(r.kind)}
              <em className="muted small">
                {' '}
                · {new Date(r.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} ·{' '}
                {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
              </em>
            </span>
            <button className="linkish" onClick={() => setItems(removeReport(r.id))}>
              Retirer
            </button>
          </div>
        ))}
      </div>
    </>
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
      <p className="muted small">
        Le stockage de l'appareil ne répond pas : les cartes ne peuvent pas être
        gardées. Les parcours, eux, restent accessibles.
      </p>
    )
  }

  return (
    <>
      <div className="rows">
        <Row label="Parcours avec carte" value={count} />
        <Row label="Espace occupé" value={offline.formatBytes(total)} />
      </div>
      <p className="muted small">
        Les tuiles sont partagées : deux boucles de la même ville ne se paient
        qu'une fois. Le détail va jusqu'au zoom {offline.TILE_ZOOM} — au-delà,
        Relief et Satellite restent vides hors ligne.
      </p>
      {count > 0 &&
        (confirm ? (
          <div className="row">
            <button className="btn" onClick={() => setConfirm(false)}>
              Annuler
            </button>
            <button
              className="btn btn--primary"
              onClick={async () => {
                await offline.clear()
                setTotal(0)
                setCount(0)
                setConfirm(false)
              }}
            >
              Vider les cartes
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>
            Vider les cartes hors ligne
          </button>
        ))}
    </>
  )
}

/**
 * La pause automatique : on la laisse active par défaut, parce que c'est ce
 * que tout le monde attend d'une app de course. On peut la couper — pour une
 * sortie fractionnée où l'on veut compter aussi les récupérations debout.
 */
function AutoPauseSetting() {
  const [on, setOn] = useState(() => load().autoPause !== false)
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Pause automatique">
        {[
          [true, 'Pause auto activée'],
          [false, 'Désactivée'],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            role="radio"
            aria-checked={on === value}
            onClick={() => {
              setOn(value)
              save({ autoPause: value })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {on
          ? "Le chrono et la distance s'arrêtent quand tu t'arrêtes — à un feu, pour boire — et repartent dès que tu repars. Marcher, même lentement en côte, ne met pas en pause."
          : "Le chrono tourne sans interruption. Le bouton pause, pendant la sortie, reste disponible."}
      </p>
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
  if (!status) problem = "Cette version de l'app n'a pas le module d'écran verrouillé."
  else if (!status.supported) problem = "L'activité en direct demande iOS 16.2 ou plus récent."
  else if (!status.enabled) problem = 'Activités en direct coupées : Réglages › Lacet › Activités en direct.'
  else if (!status.extension) problem = "L'extension qui dessine l'activité a été retirée à l'installation."
  else if (status.nested === false) {
    problem = `L'app a été installée sous un autre nom (${status.bundle}) : l'extension ${status.extensionBundle} ne lui est plus rattachée, et iOS refuse de la lancer.`
  } else if (status.signedExtension === false) {
    problem =
      "L'extension n'a pas reçu de signature : l'outil d'installation a signé l'app et pas son extension. Réinstalle avec AltStore, qui la signe."
  }

  return (
    <>
      <p className="muted small">
        <b>Écran verrouillé.</b> Pendant une sortie guidée, le prochain virage, sa
        distance, ce qui reste et l'heure d'arrivée s'affichent sur l'écran
        verrouillé et dans la Dynamic Island. La musique continue.
      </p>
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
    app ? `app ${app.version} (build ${app.build})` : null,
    web ? `interface build ${web}` : 'interface de développement',
    commit || null,
  ].filter(Boolean)

  return (
    <p className="muted small">
      {parts.join(' · ')}
      {app && web && app.build !== String(web) && (
        <>
          {' '}— <b>les deux numéros diffèrent</b> : l'app affiche une interface
          plus ancienne que celle qu'elle contient. Ferme-la complètement et
          rouvre-la ; si ça persiste, réinstalle-la.
        </>
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
  const s = (v) => `${(v ?? 0).toFixed(v >= 1 ? 1 : 2).replace('.', ',')} s`
  // Les rues préparées en fond ne coûtent rien à la recherche : le dire ainsi
  // évite de lire deux zéros comme une mesure ratée.
  const ready = !last.fetch && !last.graph
  const parts = [
    ready ? 'rues déjà prêtes' : `rues ${s(last.fetch)}`,
    ready ? null : `graphe ${s(last.graph)}`,
    `itinéraires ${s(last.routing)}`,
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
    <p className="muted small">
      Dernier calcul : {last.km} km en {s(last.total)} — {parts.join(' · ')}
      {last.nodes ? ` (${last.nodes.toLocaleString('fr-FR')} nœuds)` : ''}
      {venues ? ` · rues : ${venues}` : ''}
    </p>
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
    setMessage('Sauvegarde écrite. Garde-la hors du téléphone si tu comptes réinstaller l’app.')
  }

  const restore = async (file) => {
    if (!file) return
    try {
      const { favorites, history } = importAll(await file.text())
      // L'écran relit tout de suite ce qui vient d'être écrit : laissé à ses
      // listes d'avant, il les aurait réécrites par-dessus à la première occasion.
      onRestored?.()
      setMessage(`Restauré : ${favorites} parcours en favori, ${history} sorties.`)
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <>
      <p className="muted small">
        Un fichier qui emporte favoris, sorties et réglages — à garder ailleurs
        avant de supprimer l'app, qui les effacerait.
      </p>
      <div className="row">
        <button className="btn" onClick={backup}>
          <Icon name="download" size={15} />
          Sauvegarder
        </button>
        <label className="btn">
          <Icon name="refresh" size={15} />
          Restaurer
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => restore(e.target.files?.[0])}
          />
        </label>
      </div>
      {message && <p className="muted small">{message}</p>}
    </>
  )
}

/**
 * Un appui maintenu répète le pas, de plus en plus vite.
 *
 * Passer de 70 à 82 kg demandait douze appuis, et de 175 à 194 cm dix-neuf.
 * La valeur est lue dans une référence à chaque répétition : la lire dans la
 * fermeture figerait le premier chiffre, et tous les pas suivants
 * réécriraient la même valeur.
 */
function useHold(step, delays = { first: 420, min: 55 }) {
  const timer = useRef(null)
  const action = useRef(step)
  action.current = step

  const stop = () => {
    clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const start = (event) => {
    // Un seul doigt, et pas de sélection ni de zoom déclenchés par l'appui long.
    event.preventDefault()
    action.current()
    let delay = delays.first
    const tick = () => {
      action.current()
      delay = Math.max(delays.min, delay * 0.72)
      timer.current = setTimeout(tick, delay)
    }
    timer.current = setTimeout(tick, delay)
  }

  // `detail` vaut zéro quand le clic vient du clavier (Entrée ou Espace sur le
  // bouton) : là, aucun événement de pointeur n'est émis, et le pas ne se ferait
  // jamais. À la souris ou au doigt, l'appui l'a déjà fait.
  const onClick = (event) => {
    if (event.detail === 0) action.current()
  }

  return { onClick, onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop }
}

/**
 * Une valeur chiffrée : au doigt par les deux boutons, au clavier en touchant
 * le nombre.
 *
 * Le nombre est un champ, et pas seulement un affichage : douze appuis pour
 * corriger un poids est le genre de détail qui fait renoncer à régler quoi que
 * ce soit. Ce qui est saisi n'est pris qu'à la validation, et ramené dans les
 * bornes — un champ vidé le temps de retaper ne doit pas valoir « 0 kg ».
 */
function NumberRow({ label, unit, value, min, max, onChange }) {
  const [draft, setDraft] = useState(null)
  const moins = useHold(() => onChange(Math.max(min, value - 1)))
  const plus = useHold(() => onChange(Math.min(max, value + 1)))

  const commit = () => {
    const saisi = Number(draft)
    setDraft(null)
    if (draft !== null && draft !== '' && Number.isFinite(saisi)) {
      onChange(Math.min(max, Math.max(min, Math.round(saisi))))
    }
  }

  return (
    <div className="rows__row">
      <span>{label}</span>
      <span className="rows__num">
        <button {...moins} aria-label={`Diminuer ${label.toLowerCase()}`}>
          <Icon name="minus" size={15} />
        </button>
        <label className="rows__field">
          <input
            type="text"
            inputMode="numeric"
            enterKeyHint="done"
            aria-label={`${label} en ${unit === 'kg' ? 'kilogrammes' : 'centimètres'}`}
            value={draft ?? value}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onFocus={(e) => e.target.select()}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          />
          <b>{unit}</b>
        </label>
        <button {...plus} aria-label={`Augmenter ${label.toLowerCase()}`}>
          <Icon name="plus" size={15} />
        </button>
      </span>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="rows__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
