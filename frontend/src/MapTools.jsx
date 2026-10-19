import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

/**
 * La colonne de boutons posée sur la carte, hors course.
 *
 * Trois questions, un bouton chacune, dans l'ordre où on se les pose : à quoi
 * ressemble la carte, où suis-je, d'où je pars. La boussole n'apparaît que
 * carte tournée, pour la remettre nord en haut.
 */
export function MapTools({
  stylesOpen,
  onStyles,
  geo,
  onLocate,
  placing,
  onPlacing,
  places,
  onPickPlace,
  onDropPlace,
  onFromHere,
  onKeepStart,
  compassRef,
  onNorth,
  flying = false,
  onFlyover = null,
}) {
  const [menu, setMenu] = useState(false)

  // Le menu du départ se ferme au premier geste ailleurs.
  useEffect(() => {
    if (!menu) return undefined
    const close = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.startmenu, .tool--start')) setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  /** Chaque choix du menu le referme avant d'agir. */
  const pick = (action) => () => {
    setMenu(false)
    action()
  }

  return (
    <div className="stage__tools">
      <button
        className={`tool ${stylesOpen ? 'tool--on' : ''}`}
        onClick={onStyles}
        aria-label="Fond de carte"
        aria-haspopup="dialog"
      >
        <Icon name="layers" />
      </button>
      <span className="tools__gap" aria-hidden="true" />
      <button
        className={`tool ${geo.following ? 'tool--on' : ''} ${geo.status === 'locating' ? 'tool--busy' : ''}`}
        onClick={onLocate}
        aria-label={geo.following ? 'Arrêter de suivre ma position' : 'Centrer la carte sur ma position'}
        aria-pressed={geo.following}
      >
        <Icon name={geo.following ? 'navigation' : 'locate'} />
      </button>
      <div className="toolmenu">
        <button
          className={`tool tool--start ${placing || menu ? 'tool--on' : ''}`}
          onClick={() => {
            if (placing) onPlacing(false)
            else setMenu((v) => !v)
          }}
          aria-label="Choisir le point de départ"
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          <Icon name="pinPlus" />
        </button>
        {menu && (
          <div className="startmenu" role="menu">
            <b>Point de départ</b>
            {places.map((place) => (
              <div className="startmenu__row" key={place.id}>
                <button role="menuitem" onClick={pick(() => onPickPlace(place))}>
                  <Icon name="heart" size={17} />
                  {place.name}
                </button>
                <button
                  className="startmenu__drop"
                  onClick={() => onDropPlace(place.id)}
                  aria-label={`Oublier ${place.name}`}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            <button role="menuitem" onClick={pick(onFromHere)}>
              <Icon name="locate" size={17} />
              Partir de ma position
            </button>
            <button role="menuitem" onClick={pick(() => onPlacing(true))}>
              <Icon name="pin" size={17} />
              Choisir sur la carte
            </button>
            {onKeepStart && (
              <button role="menuitem" onClick={pick(onKeepStart)}>
                <Icon name="plus" size={17} />
                Enregistrer ce départ
              </button>
            )}
          </div>
        )}
      </div>
      {/* Le survol de la boucle choisie : seul bouton qui reste pendant qu'il
          tourne, pour l'arrêter. */}
      {onFlyover && (
        <button
          className={`tool tool--fly ${flying ? 'tool--on' : ''}`}
          onClick={onFlyover}
          aria-pressed={flying}
          aria-label={flying ? 'Arrêter le survol' : 'Survoler la boucle en 3D'}
        >
          {flying ? <Icon name="stop" /> : <b className="tool__text">3D</b>}
        </button>
      )}
      <button ref={compassRef} className="tool tool--compass" onClick={onNorth} aria-label="Remettre le nord en haut">
        <span className="needle" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * En course : ce qui sert en courant, rien qui change le parcours — le fond de
 * carte, la voix, l'orientation (dans le sens de la course, ou nord en haut) et
 * la vue d'ensemble du parcours.
 */
export function RunTools({ onStyles, speaking, onVoice, runView, onRunView, compassRef, onOverview }) {
  return (
    <div className="stage__tools stage__tools--run">
      <button className="tool" onClick={onStyles} aria-label="Fond de carte">
        <Icon name="layers" />
      </button>
      <button
        className={`tool ${speaking ? '' : 'tool--muted'}`}
        onClick={onVoice}
        aria-pressed={speaking}
        aria-label={speaking ? 'Couper le guidage vocal' : 'Activer le guidage vocal'}
      >
        <Icon name={speaking ? 'volume' : 'volumeOff'} />
      </button>
      <button
        ref={compassRef}
        className="tool tool--compass"
        onClick={onRunView}
        aria-label={runView === 'north' ? 'Orienter la carte dans le sens de la course' : 'Mettre le nord en haut'}
      >
        <span className="needle" aria-hidden="true" />
        <small>{runView === 'north' ? 'N' : 'CAP'}</small>
      </button>
      {onOverview && (
        <button className="tool" onClick={onOverview} aria-label="Voir tout le parcours">
          <Icon name="expand" />
        </button>
      )}
    </div>
  )
}
