import { useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { downloadRun } from './api'
import AscentNote from './AscentNote.jsx'
import { duration, km, pace } from './format'
import { standing } from './knownRoutes'
import { climbProfile } from './runTrace'
import ShareSheet from './ShareSheet.jsx'

/**
 * Une sortie déjà faite, rouverte.
 *
 * L'historique ne montrait qu'une ligne — date, distance, allure moyenne — et
 * ouvrir une sortie affichait le parcours *prévu*, avec sa note de sécurité et
 * son profil théorique. Ce qu'on avait réellement couru n'apparaissait nulle
 * part.
 *
 * Cet écran inverse l'ordre : **ce qu'on a fait d'abord**, le plan ensuite, et
 * seulement pour dire l'écart. La carte, derrière, dessine la trace
 * enregistrée — pas le tracé calculé.
 *
 * Les temps au kilomètre viennent des passages relevés pendant la sortie (voir
 * `LiveRun.jsx`). Les sorties d'avant ne les ont pas : on ne les invente pas à
 * partir de la trace, dont les points n'ont pas d'heure.
 */
export default function RunDetail({ entry, history = [], onReplay, onRename, onAnnotate, onDelete, onClose }) {
  const [confirm, setConfirm] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Où cette sortie se situe parmi celles qui ont emprunté le même chemin.
  // Calculé à l'ouverture d'une sortie, pas à chaque rendu : c'est une
  // comparaison de tracés point à point sur tout l'historique.
  const rang = useMemo(() => standing(entry, history), [entry, history])
  const distance = entry.actual_distance_m || 0
  const seconds = entry.actual_duration_s || 0
  const bike = entry.sport === 'bike'
  const perKm = distance > 100 ? seconds / (distance / 1000) : 0
  const speed = seconds > 0 ? (distance / seconds) * 3.6 : 0
  const planned = entry.free ? null : entry.distance_m || null
  const gap = planned ? distance - planned : null
  const splits = entry.splits?.length ? entry.splits : null

  return (
    <div className="panel rundet">
      <div className="rundet__head">
        <button className="rundet__back" onClick={onClose} aria-label="Retour aux sorties">
          <Icon name="chevronDown" size={18} />
        </button>
        <div className="rundet__name">
          {/* Un champ, pas un bouton « renommer » : le nom se corrige là où on
              le lit. Il reprend sa forme de titre dès qu'on le quitte. */}
          {onRename ? (
            <RenameField name={entry.name} label="Nom de la sortie" onRename={(nom) => onRename(entry, nom)} />
          ) : (
            <b>{entry.name}</b>
          )}
          <em>{whenLabel(entry.ranAt)}</em>
        </div>
        <span className="rundet__sport" aria-hidden="true">
          <Icon name={bike ? 'bike' : 'run'} size={18} />
        </span>
      </div>

      <div className="rundet__big">
        <b>{km(distance)}</b>
        <span>KILOMÈTRES PARCOURUS</span>
      </div>

      <div className="stats stats--four rundet__stats">
        <div>
          <b>{duration(seconds)}</b>
          <span>Temps</span>
        </div>
        <div>
          <b>{bike ? speed.toFixed(1).replace('.', ',') : pace(perKm)}</b>
          <span>{bike ? 'Vitesse (km/h)' : 'Allure (/km)'}</span>
        </div>
        <div>
          <b>{bike ? pace(perKm) : speed.toFixed(1).replace('.', ',')}</b>
          <span>{bike ? 'Allure (/km)' : 'Vitesse (km/h)'}</span>
        </div>
        <div>
          <b>{entry.actual_ascent_m != null ? `${entry.actual_ascent_m} m` : '—'}</b>
          <span>Dénivelé +</span>
        </div>
      </div>

      {/* Le temps, en clair : celui qui compte pour l'allure est le temps en
          mouvement. Une sortie avec vingt minutes d'arrêts n'a pas duré une
          heure, et l'allure affichée ne s'explique pas sans le dire. */}
      {entry.paused_s > 0 && (
        <p className="muted small">
          Chrono arrêté {duration(entry.paused_s)} — feux, pauses, attentes. Le temps ci-dessus
          est le temps en mouvement, et c'est lui qui donne l'allure.
        </p>
      )}

      {rang && <Standing rang={rang} bike={bike} />}

      {splits && <Splits splits={splits} bike={bike} entry={entry} />}

      <Climb entry={entry} />

      {onAnnotate && <Feeling key={entry.ranAt} entry={entry} onChange={onAnnotate} />}

      {entry.spoken?.length > 0 && <Spoken spoken={entry.spoken} />}

      {gap !== null && <PlanGap entry={entry} planned={planned} gap={gap} />}

      {entry.rerouted && (
        <p className="muted small">
          Un nouveau chemin a été calculé pendant cette sortie : l'écart avec le prévu vient
          en partie de là.
        </p>
      )}
      {entry.actual_ascent_m == null ? (
        <p className="muted small">
          Pas de dénivelé mesuré : ni le baromètre ni le GPS du téléphone n'ont donné
          l'altitude pendant cette sortie.
        </p>
      ) : (
        <AscentNote entry={entry} />
      )}
      {!entry.track?.length && (
        <p className="muted small">
          La trace de cette sortie n'est plus gardée — seules les vingt-cinq dernières le sont,
          avec leur parcours prévu, pour laisser de la place. Les chiffres, eux, restent.
        </p>
      )}

      {sharing && <ShareSheet entry={entry} onClose={() => setSharing(false)} />}
      <div className="row">
        <button className="btn btn--fit" onClick={() => setSharing(true)} aria-label="Partager la sortie en image">
          <Icon name="share" size={16} />
          Partager
        </button>
        {entry.track?.length > 1 && (
          <button className="btn btn--fit" onClick={() => downloadRun(entry)} aria-label="Exporter la trace en GPX">
            <Icon name="fileExport" size={16} />
            Exporter
          </button>
        )}
        {!entry.free && entry.geometry?.length > 1 && (
          <button className="btn btn--primary" onClick={() => onReplay(entry)}>
            <Icon name="refresh" size={16} />
            Refaire ce parcours
          </button>
        )}
      </div>

      {/* Une sortie de test, un départ déclenché dans la poche : sans ça, le
          seul moyen de s'en débarrasser était d'effacer tout l'historique. */}
      <div className="rundet__remove">
        {confirm ? (
          <div className="row">
            <button className="btn" onClick={() => setConfirm(false)}>
              Annuler
            </button>
            <button className="btn btn--primary" onClick={() => onDelete(entry)}>
              Supprimer définitivement
            </button>
          </div>
        ) : (
          <button className="linkish" onClick={() => setConfirm(true)}>
            Supprimer cette sortie
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Un nom qu'on corrige là où on le lit : ici, et dans la liste de « Mes
 * parcours ». Entrée valide, Échap renonce, quitter le champ garde.
 *
 * Échap gardait pourtant le nom tapé : le champ, quitté aussitôt, enregistrait
 * avec l'état d'avant l'annulation — React n'avait pas encore rendu le `null`.
 * Le renoncement passe donc par une référence, lue sur-le-champ.
 */
export function RenameField({ name, label, onRename, onDone, autoFocus = false }) {
  // Le nom en cours d'édition, ou `null` quand on ne le modifie pas.
  const [nom, setNom] = useState(null)
  const renonce = useRef(false)
  return (
    <input
      value={nom ?? name}
      aria-label={label}
      maxLength={60}
      autoFocus={autoFocus}
      onChange={(e) => setNom(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        if (nom !== null && !renonce.current) onRename(nom)
        renonce.current = false
        setNom(null)
        onDone?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          renonce.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** Le prévu en regard du fait : distance, écart, D+ annoncé, note de sécurité. */
export function PlanGap({ entry, planned, gap }) {
  return (
    <div className="rundet__plan">
      <div>
        <span>Prévu</span>
        <b>{km(planned, 1)} km</b>
      </div>
      <div>
        <span>Écart</span>
        <b className={Math.abs(gap) > 300 ? 'rundet__off' : ''}>
          {gap >= 0 ? '+' : '−'}
          {Math.abs(Math.round(gap))} m
        </b>
      </div>
      {entry.ascent_m != null && (
        <div>
          <span>D+ prévu</span>
          <b>{Math.round(entry.ascent_m)} m</b>
        </div>
      )}
      {entry.grade && (
        <div>
          <span>Sécurité</span>
          <b className={`grade grade--${entry.grade}`}>{entry.grade}</b>
        </div>
      )}
    </div>
  )
}

/**
 * Se comparer à soi-même, sur le même chemin.
 *
 * C'est la seule comparaison qui veut dire quelque chose : ni un classement
 * contre des inconnus, ni un temps sur une distance ronde, mais **cette
 * boucle-là**, celle qu'on refait le dimanche, avec ses côtes et ses feux.
 *
 * L'allure est comparée plutôt que le temps brut : deux passages sur le même
 * chemin diffèrent de quelques centaines de mètres, et un temps brut ferait
 * passer un détour par la boulangerie pour un jour sans.
 */
export function Standing({ rang, bike }) {
  const ecart = (s) => `${s <= 0 ? '−' : '+'}${pace(Math.abs(s))}`
  return (
    <div className={`standing ${rang.record ? 'standing--record' : ''}`}>
      <div className="standing__head">
        <b>
          {rang.record ? 'Ton meilleur passage' : `${rang.count}ᵉ fois sur ce chemin`}
        </b>
        <em>
          {rang.record
            ? `Le plus rapide de tes ${rang.count} passages ici.`
            : `au mieux ${pace(paceOf(rang.best))}${bike ? '' : '/km'}, le ${jour(rang.best.ranAt)}`}
        </em>
      </div>
      {!rang.record && (
        <div className="standing__gaps">
          <div>
            <span>contre la dernière</span>
            <b className={rang.vsPrevious <= 0 ? 'standing__up' : ''}>{ecart(rang.vsPrevious)}</b>
          </div>
          <div>
            <span>contre la meilleure</span>
            <b className={rang.vsBest <= 0 ? 'standing__up' : ''}>{ecart(rang.vsBest)}</b>
          </div>
        </div>
      )}
    </div>
  )
}

const paceOf = (r) => (r.actual_duration_s || 0) / ((r.actual_distance_m || 1) / 1000)
const jour = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })

/**
 * Les tours de kilomètre, en barres.
 *
 * C'est la question qu'on se pose en relisant une sortie : où ai-je accéléré,
 * où ai-je coulé ? Une colonne de chiffres y répond mal ; la longueur des
 * barres se lit d'un coup d'œil. La plus longue est le kilomètre le plus lent —
 * c'est le temps qui est mis en regard, pas la vitesse.
 *
 * Les barres partent de quatre cinquièmes du kilomètre le plus rapide, pas de
 * zéro : depuis zéro, 5:01 et 5:31 — trente secondes, un vrai coup de mou —
 * faisaient des barres presque égales. Deux secondes d'écart, elles, restent à
 * peine visibles, comme il se doit.
 */
export function Splits({ splits, bike, entry = null }) {
  const worst = Math.max(...splits.map((s) => s.seconds))
  const best = Math.min(...splits.map((s) => s.seconds))
  const end = entry ? lastStretch(entry, splits) : null
  const floor = Math.min(best, end?.perKm ?? best) * 0.8
  const top = Math.max(worst, end?.perKm ?? worst)
  const width = (seconds) => Math.max(8, ((seconds - floor) / Math.max(1, top - floor)) * 100)
  // L'allure visée, celle du parcours prévu : sans elle, huit barres ne disent
  // pas si l'on a tenu ce qu'on s'était fixé.
  const target = entry && !bike && !entry.free && entry.duration_s > 0 && entry.distance_m > 0
    ? entry.duration_s / (entry.distance_m / 1000)
    : null
  const under = target ? splits.filter((s) => s.seconds <= target).length : 0
  return (
    <div className="splits">
      <div className="splits__head">
        <span className="label">{bike ? 'Par kilomètre' : 'Allure au kilomètre'}</span>
        <em>
          au plus vite {pace(best)} · au plus lent {pace(worst)}
        </em>
      </div>
      {splits.map((s) => (
        <div key={s.km} className="splits__row">
          <span>{s.km}</span>
          <i
            style={{ width: `${width(s.seconds)}%` }}
            data-best={s.seconds === best || undefined}
          />
          <b>{pace(s.seconds)}</b>
        </div>
      ))}
      {/* Ce qui reste après la dernière borne : sur 8,35 km, les 350 derniers
          mètres n'apparaissaient nulle part. À son allure, pas à son temps —
          la barre se compare aux autres. */}
      {end && (
        <div className="splits__row splits__row--end">
          <span>fin</span>
          <i style={{ width: `${width(end.perKm)}%` }} />
          <b title={`${Math.round(end.metres)} m`}>{pace(end.perKm)}</b>
        </div>
      )}
      {target && (
        <p className="muted small">
          Allure visée {pace(target)}/km : {under} kilomètre{under > 1 ? 's' : ''} sur {splits.length} dans les temps.
        </p>
      )}
    </div>
  )
}

// En dessous, la fin d'une sortie est trop courte pour avoir une allure : le
// temps de s'arrêter y pèse plus que la course.
const END_MIN_M = 150

/** Les derniers mètres, après la dernière borne : leur longueur et leur allure. */
function lastStretch(entry, splits) {
  const metres = (entry.actual_distance_m || 0) - splits[splits.length - 1].km * 1000
  const seconds = (entry.actual_duration_s || 0) - splits.reduce((sum, s) => sum + s.seconds, 0)
  // Un kilomètre ou plus sans borne : les tours sont incomplets — une sortie
  // d'avant, ou reprise sans eux —, et le reste n'est pas « la fin ».
  if (metres < END_MIN_M || metres >= 1000 || seconds <= 0) return null
  return { metres, perKm: seconds / (metres / 1000) }
}

/**
 * Ce qu'on a réellement monté, en profil. Le chiffre de D+ dit combien ; le
 * profil dit où — la côte du troisième kilomètre, celle qui explique sa barre.
 */
export function Climb({ entry }) {
  const drawn = useMemo(() => climbProfile(entry.track, entry.track_alt, 320, 64), [entry.track, entry.track_alt])
  if (!drawn) return null
  return (
    <div className="climb">
      <div className="splits__head">
        <span className="label">Profil monté</span>
        <em>
          sommet au km {km(drawn.topM, 1)} · {drawn.gain >= 0 ? '+' : '−'}
          {Math.abs(Math.round(drawn.gain))} m sur le départ
        </em>
      </div>
      <svg viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true">
        <path className="climb__area" d={drawn.area} />
        <path className="climb__line" d={drawn.d} />
      </svg>
    </div>
  )
}

const FEELINGS = ['Facile', 'Bien', 'Moyen', 'Dur', 'Très dur']

/**
 * Comment c'était : cinq mots et une ligne libre. Les chiffres disent ce qu'on
 * a fait, pas ce que ça a coûté — et c'est en relisant « Dur » trois dimanches
 * de suite qu'on comprend une allure qui baisse. Noté à chaud sur l'écran de
 * fin, corrigé dans le détail de la sortie.
 */
export function Feeling({ entry, onChange }) {
  const [feeling, setFeeling] = useState(entry.feeling ?? null)
  const [note, setNote] = useState(entry.note ?? '')
  return (
    <div className="feeling">
      <span className="label">Ressenti</span>
      <div className="chips" role="radiogroup" aria-label="Ressenti">
        {FEELINGS.map((label, i) => (
          <button
            key={label}
            role="radio"
            aria-checked={feeling === i + 1}
            className={`chip ${feeling === i + 1 ? 'chip--on' : ''}`}
            onClick={() => {
              // Retoucher le mot choisi l'efface : on n'est pas tenu d'en avoir un.
              const next = feeling === i + 1 ? null : i + 1
              setFeeling(next)
              onChange({ feeling: next })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={note}
        aria-label="Note sur la sortie"
        placeholder="Une note : la météo, les jambes, les chaussures…"
        maxLength={140}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== (entry.note ?? '') && onChange({ note: note.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </div>
  )
}

/**
 * Ce que la voix a dit, phrase par phrase : l'heure, où l'on en était, les mots.
 *
 * C'est la plainte n° 1 contre les apps de course : une voix qui se tait au
 * bout de quelques virages, écran verrouillé, ou qui annonce un virage déjà
 * passé. `LiveRun.voice.test.jsx` le vérifie sur des sorties simulées ; ce
 * journal le vérifie sur une vraie, téléphone dans la poche — ce qu'on y a
 * entendu ne laissait sinon aucune trace. Replié : on ne l'ouvre que pour ça.
 * La position y est la distance courue ; les coordonnées sont gardées avec.
 */
export function Spoken({ spoken }) {
  return (
    <details className="spoken">
      <summary>
        Ce que la voix a dit · {spoken.length} phrase{spoken.length > 1 ? 's' : ''}
      </summary>
      <ol>
        {spoken.map((s, i) => (
          <li key={i}>
            <time>{heure(s.t)}</time>
            <em>{km(s.m, 2)} km</em>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** « Mardi 16 septembre, 18 h 42 » */
export function whenLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date inconnue'
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)}, ${heure}`
}
