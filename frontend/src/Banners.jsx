import Icon from './Icon.jsx'
import { km } from './format'

/**
 * La sortie interrompue, retrouvée au lancement : l'app a été fermée en plein
 * effort — par iOS, par une batterie vide. On la reprend, on la garde telle
 * quelle, ou on l'oublie.
 */
export function ResumeBanner({ pending, onResume, onKeep, onDrop }) {
  return (
    <div className="banner banner--resume">
      <Icon name="refresh" size={16} />
      <span>
        <b>Sortie interrompue.</b>{' '}
        <span>
          {km(pending.covered, 1).replace('.', ',')} km en {Math.round(pending.elapsed / 60)} min,{' '}
          {Math.round((Date.now() - pending.at) / 60000)} min plus tôt.
        </span>
      </span>
      <button className="banner__act" onClick={onResume}>
        Reprendre
      </button>
      <button className="banner__act" onClick={onKeep}>
        Enregistrer
      </button>
      <button className="banner__close" onClick={onDrop} aria-label="Oublier">
        <Icon name="close" size={15} />
      </button>
    </div>
  )
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
        <b>Position indisponible.</b>
      </span>
      {onPlace && (
        <button className="banner__act" onClick={onPlace}>
          Placer
        </button>
      )}
      <button className="banner__close" onClick={onClose} aria-label="Masquer">
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
