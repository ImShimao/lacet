/**
 * Mon compte : le profil local, le contact d'urgence, les cartes gardées.
 *
 * Tout y est local à l'appareil — c'est le propos de l'écran, et la raison
 * pour laquelle il ne dépend de rien d'autre que du stockage du navigateur.
 */

import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { SPORTS } from './FiltersSheet.jsx'
import { surfaceLabel } from './format'
import { load, save } from './storage'
import { isNative, readModeSetting, setModeSetting } from './platform'
import * as offline from './offlineMaps'

export default function Account({ mode = 'full', params, geo, onClearData, onProfile }) {
  const canRun = mode === 'full'
  const [confirm, setConfirm] = useState(false)
  const [contact, setContact] = useState(() => load().emergencyContact || '')
  // L'effacement vide aussi les cartes ; le compteur, lui, a lu le journal en
  // arrivant. Sans ce rappel il continuerait d'annoncer seize mégaoctets sur un
  // stockage vide — le genre de chiffre périmé qu'on croit sur parole.
  const [version, setVersion] = useState(0)
  return (
    <div className="panel">
      <div className="origin">
        <span className="origin__pin">
          <Icon name="user" size={18} />
        </span>
        <div>
          <b>Profil local</b>
          <em>tout est stocké sur cet appareil</em>
        </div>
      </div>

      <div className="rows">
        <Row label="Activité" value={SPORTS.find((s) => s.key === params.sport)?.label} />
        <Row label="Terrain" value={surfaceLabel(params.surface)} />
        <Row label="Mode sécurité" value={params.safety === 'safe' ? 'Sûr' : 'Standard'} />
        <Row
          label="Position"
          value={
            geo.status === 'ready'
              ? `± ${Math.round(geo.accuracy)} m`
              : geo.status === 'denied'
                ? 'bloquée'
                : '—'
          }
        />
      </div>

      {canRun && (
        <>
      <h4 className="section">Gabarit</h4>
      <p className="muted small">
        Sert uniquement à estimer les calories et le nombre de pas. Rien n'est envoyé.
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
        <NumberRow
          label="Taille"
          unit="cm"
          value={params.height_cm || 175}
          min={120}
          max={230}
          onChange={(height_cm) => onProfile({ height_cm })}
        />
      </div>

      <h4 className="section">Pendant la sortie</h4>
      <AutoPauseSetting />
      <LockScreenSetting />

      <h4 className="section">Contact d'urgence</h4>
      <p className="muted small">
        Le bouton SOS, pendant une sortie, prépare un SMS vers ce numéro avec ta
        position. <b>L'app ne l'envoie pas</b> — c'est toi qui appuies sur envoyer.
        Le numéro reste sur cet appareil.
      </p>
      <input
        className="field"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="06 12 34 56 78"
        value={contact}
        onChange={(e) => {
          setContact(e.target.value)
          save({ emergencyContact: e.target.value.trim() })
        }}
      />

      <h4 className="section">Cartes hors ligne</h4>
      <OfflineStorage key={version} />
        </>
      )}

      <h4 className="section">Version de l'app</h4>
      <BuildStamp />
      <ModePicker mode={mode} />

      <p className="muted">
        Aucun compte, aucune donnée envoyée ailleurs que pour calculer les itinéraires.
        Favoris, historique et réglages vivent dans le navigateur.
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
              setVersion((v) => v + 1)
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

      <p className="disclaimer">
        Données © contributeurs OpenStreetMap (ODbL) · Fonds de carte © CARTO, © Esri,
        © OpenTopoMap · Altitudes IGN RGE ALTI et OpenTopoData.
      </p>
    </div>
  )
}

/**
 * Ce que les cartes hors ligne occupent, et de quoi tout reprendre.
 *
 * Un chiffre plutôt qu'une promesse : ces fichiers sont les seuls de l'app à se
 * compter en mégaoctets, et un stockage qui grossit sans qu'on puisse le voir
 * finit par être vidé par le navigateur — au pire moment, sans prévenir.
 */
function OfflineStorage() {
  const [total, setTotal] = useState(() => offline.totalBytes())
  const [count, setCount] = useState(() => offline.storedCount())
  const [confirm, setConfirm] = useState(false)

  if (!offline.isAvailable()) {
    return (
      <p className="muted small">
        Ce navigateur ne sait pas garder de carte hors ligne. Les parcours, eux,
        restent accessibles : ils sont déjà sur l'appareil.
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
        qu'une fois, et retirer l'une n'abîme pas l'autre.
      </p>
      <p className="muted small">
        Le détail va jusqu'au zoom {offline.TILE_ZOOM}. Sur les fonds vectoriels
        — Nuit, Clair, Plan — c'est la limite du fond lui-même : au-delà la
        carte s'agrandit sans se préciser, hors ligne exactement comme en ligne.
        Relief et Satellite sont des images, qui montent bien plus haut : hors
        ligne, elles restent vides si l'on zoome plus près.
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

const MODES = [
  ['auto', 'Automatique'],
  ['full', 'Complète'],
  ['planner', 'Préparation'],
]

/**
 * Forcer la version complète ou la version de préparation.
 *
 * La détection suffit presque toujours — un téléphone a la version complète,
 * un ordinateur celle qui sert à préparer. Mais elle peut se tromper : une
 * tablette qu'on emporte, un PC à écran tactile. Le réglage reste sur
 * l'appareil, comme tout le reste.
 */
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
            aria-pressed={on === value}
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
 * L'écran de verrouillage pendant une sortie guidée : ce que l'iPhone permet,
 * et de quoi le vérifier sans partir courir.
 *
 * L'activité en direct dépend de trois choses qui ne se voient pas — la
 * version d'iOS, un réglage, et une extension que certaines installations hors
 * App Store retirent. Plutôt que de laisser l'écran vide sans explication,
 * l'app dit laquelle manque, et se rabat sur une notification silencieuse.
 */
function LockScreenSetting() {
  const [status, setStatus] = useState(undefined)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)
  const [mode, setMode] = useState(() => (load().lockScreen === 'notice' ? 'notice' : 'auto'))
  const [failure, setFailure] = useState(() => load().lockScreenError || null)

  useEffect(() => {
    if (!isNative()) return
    import('./native').then((n) => n.lockScreenStatus()).then(setStatus)
  }, [])

  if (!isNative() || status === undefined) return null

  const live = Boolean(status?.supported && status?.enabled && status?.extension)
  let text
  if (!status) text = "Cette version de l'app n'a pas le module d'écran verrouillé."
  else if (live) {
    text =
      "Activité en direct prête : pendant une sortie guidée, le prochain virage, sa distance et le temps restant s'affichent écran verrouillé et dans la Dynamic Island."
  } else if (!status.supported) {
    text = "L'activité en direct demande iOS 16.2 ou plus récent. À la place, une notification silencieuse tient la consigne à jour."
  } else if (!status.extension) {
    text =
      "L'extension qui dessine l'activité en direct manque à cette installation — l'outil d'installation l'a retirée. À la place, une notification silencieuse tient la consigne à jour."
  } else {
    text = 'Activités en direct coupées : Réglages › Lacet › Activités en direct. En attendant, une notification silencieuse tient la consigne à jour.'
  }

  // Le détail, en clair : c'est ce qu'on demande de lire quand l'écran de
  // verrouillage reste vide. Quatre conditions, et il suffit qu'une manque.
  const detail = status
    ? [
        `iOS ${status.supported ? '16.2 ou plus' : 'trop ancien'}`,
        `activités ${status.enabled ? 'autorisées' : 'coupées'}`,
        `extension ${status.extension ? 'présente' : 'absente'}`,
        `notifications ${{ granted: 'autorisées', denied: 'refusées' }[status.notifications] ?? 'jamais demandées'}`,
      ].join(' · ')
    : 'module natif injoignable'

  const test = async () => {
    const n = await import('./native')
    setResult(null)
    setTesting(true)
    const demo = {
      name: 'Essai',
      instruction: 'Tourne à droite sur Rue de la Gare',
      distance: '120 m',
      turn: 'right',
      remaining: '4,2 km',
      arrival: Date.now() + 26 * 60_000,
      progress: 0.4,
      offRoute: false,
      paused: false,
    }
    const { started, count, reason } = mode === 'notice'
      ? { started: false, count: null, reason: 'notification choisie dans ce réglage' }
      : await n.startLiveActivity(demo)
    // Gardé : la phrase disparaît dès qu'on quitte l'écran, et c'est
    // justement celle qu'il faut pouvoir relire — ou m'envoyer.
    if (!started && mode !== 'notice') {
      save({ lockScreenError: reason })
      setFailure(reason)
    }
    if (started) {
      save({ lockScreenError: null })
      setFailure(null)
      setResult(
        `Activité en direct lancée (${count ?? '?'} active). Verrouille l’écran tout de suite : elle doit s’afficher dessus. Elle s’efface dans 20 secondes.`,
      )
      // Trois secondes plus tard, ce qu'iOS en dit vraiment.
      setTimeout(async () => {
        const live = await n.liveActivities()
        if (live) {
          setResult(
            `Activité en direct lancée. iOS en compte ${live.count} (${live.states || 'aucun état'}). ` +
              (live.count > 0
                ? "Si l'écran de verrouillage reste vide, c'est l'extension qui ne la dessine pas : passe sur « Notification »."
                : "iOS l'a écartée aussitôt."),
          )
        }
      }, 3000)
      setTimeout(() => {
        n.endLiveActivity()
        setTesting(false)
      }, 20_000)
      return
    }
    if (await n.askNoticePermission()) {
      // Cinq secondes de délai : posée pendant qu'on regarde l'app, iOS ne
      // l'affiche pas. Le temps de verrouiller l'écran, elle arrive.
      await n.postRunNotice(
        {
          title: 'Tourne à droite sur Rue de la Gare',
          subtitle: 'Dans 120 m',
          body: 'Reste 4,2 km · essai de Lacet',
          icon: 'right',
        },
        5,
      )
      setResult(
        `Activité en direct impossible ici (${reason}). Une notification silencieuse arrive dans 5 secondes : verrouille ton écran maintenant pour la voir. Elle s’efface au bout de 20 secondes.`,
      )
      setTimeout(() => {
        n.clearRunNotice()
        setTesting(false)
      }, 20_000)
      return
    }
    setResult(
      `Rien n’a pu s’afficher : activité en direct impossible (${reason}), et les notifications de Lacet sont refusées — Réglages › Lacet › Notifications.`,
    )
    setTesting(false)
  }

  return (
    <>
      <p className="muted small">
        <b>Écran verrouillé.</b> {text}
      </p>
      {/* Le choix, parce que l'activité en direct peut être acceptée par iOS et
          ne s'afficher nulle part — une app installée hors App Store n'a aucune
          garantie de ce côté. « Notification » donne alors quelque chose qui
          marche : une seule notification silencieuse, remplacée à chaque
          consigne, qu'on lit en allumant l'écran. */}
      <div className="seg" role="radiogroup" aria-label="Affichage sur l'écran verrouillé">
        {[
          ['auto', 'Activité en direct'],
          ['notice', 'Notification'],
        ].map(([value, label]) => (
          <button
            key={value}
            role="radio"
            aria-checked={mode === value}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value)
              save({ lockScreen: value })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button className="btn" onClick={test} disabled={testing}>
        <Icon name="play" size={15} />
        {testing ? 'Essai en cours — verrouille ton téléphone…' : "Tester l'écran verrouillé (20 s)"}
      </button>
      {result && <p className="muted small">{result}</p>}
      <p className="muted small">Détail : {detail}.</p>
      {failure && (
        <p className="muted small">
          Dernier refus d'iOS : <b>{failure}</b>
        </p>
      )}
      {/* Tout le diagnostic en un texte à partager : plus rapide et plus sûr
          que de recopier trois lignes à la main. */}
      <button
        className="btn"
        onClick={async () => {
          const n = await import('./native')
          const app = await n.appVersion()
          const lines = [
            `Lacet ${app ? `${app.version} (build ${app.build})` : ''} · interface ${import.meta.env.VITE_BUILD || 'dev'}`,
            `Écran verrouillé : ${detail}`,
            `Réglage : ${mode === 'notice' ? 'notification' : 'activité en direct'}`,
            failure ? `Dernier refus : ${failure}` : 'Aucun refus enregistré',
            result ? `Dernier essai : ${result}` : null,
          ].filter(Boolean)
          n.shareText('Diagnostic Lacet', lines.join('\n'))
        }}
      >
        <Icon name="download" size={15} />
        Partager le diagnostic
      </button>
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

function ModePicker({ mode }) {
  const [setting, setSetting] = useState(readModeSetting)
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Version de l'app">
        {MODES.map(([key, label]) => (
          <button
            key={key}
            role="radio"
            aria-checked={setting === key}
            aria-pressed={setting === key}
            onClick={() => {
              setSetting(key)
              setModeSetting(key)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {mode === 'full'
          ? 'Version complète : préparer, lancer un parcours, suivi GPS, guidage vocal, SOS et historique.'
          : 'Version de préparation : chercher, comparer et exporter des boucles. Les fonctions de course sont réservées au téléphone.'}
      </p>
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
