import Icon from './Icon.jsx'
import { roundedDistance, turnIcon } from './runFormat'

import { t } from './i18n'
import { stepText } from './stepText'
/**
 * La consigne du moment, en bandeau sur la carte — c'est ce qu'on regarde en
 * courant. Le virage en pictogramme, sa distance en très grand, la rue en
 * toutes lettres.
 */
export default function RunBanner({ step, offRoute, turnBack, onBlocked, rerouting, rerouteIn, onReroute, hasGuidance, waiting }) {
  if (rerouting) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__spin" aria-hidden="true" />
        <div className="runbar__text">
          <b>{rerouting === 'home' ? t('Retour au départ…') : t('Nouvel itinéraire…')}</b>
          <em>{rerouting === 'home' ? t('Recherche du plus court chemin sûr jusqu’à la porte') : t('Recherche d\'un chemin pour finir la boucle')}</em>
        </div>
      </div>
    )
  }
  if (offRoute) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__turn">
          <Icon name="warning" size={30} strokeWidth={2.2} />
        </span>
        <div className="runbar__text">
          <b>{t('Hors parcours')}</b>
          <em>
            {rerouteIn != null
              ? rerouteIn > 0
                ? t('Nouvel itinéraire dans {rerouteIn} s', { rerouteIn })
                : t('Nouvel itinéraire au prochain relevé')
              : t('Reviens sur le tracé pour reprendre le guidage')}
          </em>
        </div>
        {onReroute && (
          <button className="runbar__act" onClick={onReroute}>{t('Recalculer')}</button>
        )}
      </div>
    )
  }
  if (turnBack) {
    return (
      <div className="runbar runbar--stray" role="status">
        <span className="runbar__turn">
          <Icon name="uturn" size={30} strokeWidth={2.2} />
        </span>
        <div className="runbar__text">
          <b>{t('Demi-tour')}</b>
          <em>
            {turnBack.reported
              ? t('Passage fermé signalé : il sera évité.')
              : t('Passage fermé devant ? Signale-le, et le parcours le contournera.')}
          </em>
        </div>
        {onBlocked && !turnBack.reported && (
          <button className="runbar__act" onClick={onBlocked}>{t('Passage fermé')}</button>
        )}
      </div>
    )
  }
  if (!hasGuidance) {
    return (
      <div className="runbar runbar--idle" role="status">
        <div className="runbar__text">
          <em>{t('Parcours enregistré sans consignes : suis le tracé sur la carte.')}</em>
        </div>
      </div>
    )
  }
  if (!step) {
    return (
      <div className="runbar runbar--idle" role="status">
        <div className="runbar__text">
          <em>{waiting ? t('Guidage en attente du signal GPS…') : t('Suis le tracé.')}</em>
        </div>
      </div>
    )
  }
  const distance = step.imminent ? t('Maintenant') : roundedDistance(step.remaining)
  return (
    <div className="runbar" role="status">
      <span className="runbar__turn">
        <Icon name={turnIcon(step.step.turn)} size={34} strokeWidth={2.4} />
      </span>
      <div className="runbar__text">
        <b>{distance}</b>
        <em>{stepText(step.step.text)}</em>
        {step.step.caution && <small>{t('Traversée non protégée')}</small>}
        {/* La manœuvre d'après, quand elle suit de si près qu'on ne la verrait
            qu'une fois celle-ci passée — trop tard pour se placer. */}
        {step.then && <span className="runbar__then">{step.then}</span>}
      </div>
    </div>
  )
}
