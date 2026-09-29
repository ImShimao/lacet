import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { downloadGpx } from './api'
import { duration, km, pace } from './format'
import { standing } from './knownRoutes'

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
export default function RunDetail({ entry, history = [], onReplay, onRename, onDelete, onClose }) {
  const [confirm, setConfirm] = useState(false)
  // Le nom en cours d'édition, ou `null` quand on ne le modifie pas.
  const [nom, setNom] = useState(null)
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
            <input
              value={nom ?? entry.name}
              aria-label="Nom de la sortie"
              maxLength={60}
              onChange={(e) => setNom(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                if (nom !== null) onRename(entry, nom)
                setNom(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setNom(null)
                  e.currentTarget.blur()
                }
              }}
            />
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
        <b>{km(distance).replace('.', ',')}</b>
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

      {splits && <Splits splits={splits} bike={bike} />}

      {gap !== null && (
        <div className="rundet__plan">
          <div>
            <span>Prévu</span>
            <b>{km(planned, 1).replace('.', ',')} km</b>
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
      )}

      {entry.rerouted && (
        <p className="muted small">
          Un nouveau chemin a été calculé pendant cette sortie : l'écart avec le prévu vient
          en partie de là.
        </p>
      )}
      {entry.actual_ascent_m == null && (
        <p className="muted small">
          Pas de dénivelé mesuré : le GPS du téléphone n'a pas donné l'altitude pendant cette
          sortie.
        </p>
      )}
      {!entry.track?.length && (
        <p className="muted small">
          La trace de cette sortie n'est plus gardée — seules les vingt-cinq dernières le sont,
          pour laisser de la place. Les chiffres, eux, restent.
        </p>
      )}

      <div className="row">
        {entry.track?.length > 1 && (
          <button
            className="btn"
            onClick={() => downloadGpx(`${entry.name} — trace`, entry.track, null, entry.sport)}
          >
            <Icon name="download" size={16} />
            Exporter la trace
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
function Standing({ rang, bike }) {
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
 */
function Splits({ splits, bike }) {
  const worst = Math.max(...splits.map((s) => s.seconds))
  const best = Math.min(...splits.map((s) => s.seconds))
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
            style={{ width: `${Math.max(8, (s.seconds / worst) * 100)}%` }}
            data-best={s.seconds === best || undefined}
          />
          <b>{pace(s.seconds)}</b>
        </div>
      ))}
    </div>
  )
}

/** « Mardi 16 septembre, 18 h 42 » */
function whenLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date inconnue'
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)}, ${heure}`
}
