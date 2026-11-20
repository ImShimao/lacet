import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { ZONE_RADIUS } from './zones'

/**
 * La colonne de boutons posée sur la carte, hors course.
 *
 * Trois questions, un bouton chacune, dans l'ordre où on se les pose : à quoi
 * ressemble la carte, où suis-je, d'où je pars. La boussole n'apparaît que
 * carte tournée, pour la remettre nord en haut. Le cercle hachuré dessine une
 * zone que toutes les boucles contournent — voir `zones.js`.
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
  onPlacingVia,
  compassRef,
  onNorth,
  flying = false,
  onFlyover = null,
  drawingZone = false,
  onZone = null,
}) {
  const [menu, setMenu] = useState(false)
  // Les outils moins utilisés — fond de carte, zone, 3D — tiennent dans un seul
  // bouton, comme le menu du départ : une colonne de six boutons se lisait mal.
  const [tools, setTools] = useState(false)

  // Le menu du départ se ferme au premier geste ailleurs.
  useEffect(() => {
    if (!menu) return undefined
    const close = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.startmenu, .tool--start')) setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    if (!tools) return undefined
    const close = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.toolspanel, .tool--tools')) setTools(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [tools])

  /** Chaque choix du menu le referme avant d'agir. */
  const pick = (action) => () => {
    setMenu(false)
    action()
  }

  return (
    <div className="stage__tools">
      {/* Pendant le survol, ce bloc reste seul visible : c'est par lui qu'on
          l'arrête (voir `10-map-tools.css`). */}
      <div className={`toolmenu ${flying ? 'tool--fly' : ''}`}>
        <button
          className={`tool tool--tools ${tools || stylesOpen ? 'tool--on' : ''}`}
          onClick={() => setTools((v) => !v)}
          aria-label="Outils de la carte"
          aria-haspopup="menu"
          aria-expanded={tools}
        >
          <Icon name="layers" />
        </button>
        {tools && (
          <div className="startmenu toolspanel" role="menu">
            <b>Outils</b>
            <button role="menuitem" onClick={pick(onStyles)}>
              <Icon name="layers" size={17} />
              Fond de carte
            </button>
            {onZone && (
              <button role="menuitem" onClick={pick(onZone)}>
                <Icon name="zone" size={17} />
                {drawingZone ? 'Annuler la zone à éviter' : 'Dessiner une zone à éviter'}
              </button>
            )}
            {onFlyover && (
              <button role="menuitem" onClick={pick(onFlyover)}>
                <Icon name={flying ? 'stop' : 'expand'} size={17} />
                {flying ? 'Arrêter le survol 3D' : 'Survoler la boucle en 3D'}
              </button>
            )}
          </div>
        )}
      </div>
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
            {/* Le même geste qu'un appui long sur la carte, pour qui ne le
                connaît pas encore. */}
            {onPlacingVia && (
              <button role="menuitem" onClick={pick(onPlacingVia)}>
                <Icon name="flag" size={17} />
                Passer par un point
              </button>
            )}
            {onKeepStart && (
              <button role="menuitem" onClick={pick(onKeepStart)}>
                <Icon name="plus" size={17} />
                Enregistrer ce départ
              </button>
            )}
          </div>
        )}
      </div>
      <button ref={compassRef} className="tool tool--compass" onClick={onNorth} aria-label="Remettre le nord en haut">
        <span className="needle" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Poser une zone à éviter : toucher la carte au centre, régler le rayon, la nommer.
 *
 * La carte reste libre sous la carte de réglage — on la déplace et on zoome pour
 * viser —, et chaque toucher déplace le centre, tout comme glisser sa poignée :
 * se tromper ne coûte qu'un autre geste. Pourquoi un cercle plutôt qu'un
 * contour : voir `zones.js`.
 */
export function ZoneDraft({ draft, onChange, onKeep, onCancel }) {
  const placed = Number.isFinite(draft.lon)
  const km = draft.radius_m >= 1000
  return (
    <div className="zonedraft" role="dialog" aria-label="Zone à éviter">
      <b>Zone à éviter</b>
      {placed ? (
        <>
          <label className="zonedraft__radius">
            <span>
              Rayon <em>{km ? `${(draft.radius_m / 1000).toFixed(1).replace('.', ',')} km` : `${draft.radius_m} m`}</em>
            </span>
            <input
              type="range"
              aria-label="Rayon de la zone"
              min={ZONE_RADIUS.min}
              max={ZONE_RADIUS.max}
              step={ZONE_RADIUS.step}
              value={draft.radius_m}
              onChange={(e) => onChange({ ...draft, radius_m: Number(e.target.value) })}
            />
          </label>
          <input
            className="field"
            type="text"
            autoCapitalize="sentences"
            autoCorrect="off"
            maxLength={60}
            placeholder="Forêt de chasse, chantier, quartier…"
            aria-label="Nom de la zone"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
          <p className="muted small">Fais glisser le rond du centre pour la déplacer.</p>
        </>
      ) : (
        <p className="muted small">Touche la carte au centre de ce que les boucles doivent contourner.</p>
      )}
      <div className="row">
        <button className="btn" onClick={onCancel}>
          Annuler
        </button>
        <button className="btn btn--primary" disabled={!placed} onClick={onKeep}>
          Éviter cette zone
        </button>
      </div>
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
