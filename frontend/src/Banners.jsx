import Icon from './Icon.jsx'
import { km } from './format'
import { unitLabel } from './units'

import { t } from './i18n'
/**
 * La sortie interrompue, retrouvée au lancement : l'app a été fermée en plein
 * effort — par iOS, par une batterie vide. On la reprend, on la garde telle
 * quelle, ou on l'oublie.
 */
export function ResumeBanner({ pending, onResume, onKeep, onDrop }) {
  return (
    <div className="banner banner--resume">
      <Icon name="pause" size={16} />
      <span>
        <b>{t('Sortie interrompue')}</b>{' '}{t('· {v1} {v2} en {v3} min, {v4}.', { v1: km(pending.covered, 1), v2: unitLabel(), v3: Math.round(pending.elapsed / 60), v4: ago(Date.now() - pending.at) })}</span>
      <button className="banner__close" onClick={onDrop} aria-label={t('Oublier')}>
        <Icon name="close" size={15} />
      </button>
      {/* Sous le texte, pas à côté : sur une ligne, la phrase se cassait en
          quatre morceaux entre l'icône et deux boutons. */}
      <div className="banner__acts">
        <button className="banner__act" onClick={onResume}>{t('Reprendre')}</button>
        <button className="banner__act banner__act--soft" onClick={onKeep}>{t('Enregistrer')}</button>
      </div>
    </div>
  )
}

/**
 * « à l'instant », « il y a 25 min », « il y a 3 h ». Une sortie reste
 * proposée douze heures : le bandeau disait « 0 min plus tôt » au relancement
 * immédiat, et « 540 min plus tôt » le lendemain matin.
 */
export function ago(ms) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return t('à l\'instant')
  if (minutes < 60) return t('il y a {minutes} min', { minutes })
  return t('il y a {v1} h', { v1: Math.round(minutes / 60) })
}

/**
 * La position refusée. Le titre seul : l'explication complète prenait cinq
 * lignes et repoussait les propositions hors de l'écran. Le message dit
 * « place le départ à la main » : le bouton « Placer » le fait, plutôt que de
 * laisser chercher lequel des boutons de la carte. En course, rien à placer.
 */
export function GeoBanner({ onPlace, onClose }) {
  return (
    <div className="banner">
      <Icon name="warning" size={16} />
      <span>
        <b>{t('Position indisponible.')}</b>
      </span>
      {onPlace && (
        <button className="banner__act" onClick={onPlace}>{t('Placer')}</button>
      )}
      <button className="banner__close" onClick={onClose} aria-label={t('Masquer')}>
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

/**
 * Ce qu'un plafond de « Mes parcours » vient de refuser ou de retirer — voir
 * `useLibrary`. Le favori le plus ancien, le départ nommé de trop, la sortie
 * la plus ancienne partaient sans un mot : on ne l'apprenait qu'en les
 * cherchant. `onAct` mène là où l'on fait de la place, quand il y en a un.
 */
export function LibraryNotice({ notice, onAct, onClose }) {
  return (
    <div className="banner banner--notice" role="status">
      <Icon name="warning" size={16} />
      <span>{notice.text}</span>
      <button className="banner__close" onClick={onClose} aria-label={t('Masquer')}>
        <Icon name="close" size={15} />
      </button>
      {onAct && (
        <div className="banner__acts">
          <button className="banner__act" onClick={onAct}>{t('Mes favoris')}</button>
        </div>
      )}
    </div>
  )
}
