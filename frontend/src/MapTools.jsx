import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Segmented } from './FiltersSheet.jsx'
import { ZONE_RADIUS, ZONE_REASONS } from './zones'

import { t, dec } from './i18n'
/**
 * La colonne de boutons posée sur la carte, hors course.
 *
 * Peu de boutons, chacun une question : où suis-je, comment je veux ce
 * parcours, et — une boucle choisie — à quoi elle ressemble en 3D. Tout ce qui
 * change le parcours tient dans un seul menu, comme « Personnaliser le
 * parcours » chez RunnrZ : le départ, un point de passage, une zone à éviter.
 * Le fond de carte, réglé une fois pour toutes, est parti dans « Apparence ».
 * La boussole n'apparaît que carte tournée, pour la remettre nord en haut.
 */
export function MapTools({
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
  onFreeRun = null,
}) {
  const [menu, setMenu] = useState(false)

  // Le menu se ferme au premier geste ailleurs.
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
        className={`tool ${geo.following ? 'tool--on' : ''} ${geo.status === 'locating' ? 'tool--busy' : ''}`}
        onClick={onLocate}
        aria-label={geo.following ? t('Arrêter de suivre ma position') : t('Centrer la carte sur ma position')}
        aria-pressed={geo.following}
      >
        <Icon name={geo.following ? 'navigation' : 'locate'} />
      </button>
      <div className="toolmenu">
        <button
          className={`tool tool--start ${placing || menu || drawingZone ? 'tool--on' : ''}`}
          onClick={() => {
            if (placing) onPlacing(false)
            else setMenu((v) => !v)
          }}
          aria-label={t('Personnaliser le parcours')}
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          <Icon name="pinPlus" />
        </button>
        {menu && (
          <div className="startmenu" role="menu">
            <b>{t('Point de départ')}</b>
            {places.map((place) => (
              <div className="startmenu__row" key={place.id}>
                <button role="menuitem" onClick={pick(() => onPickPlace(place))}>
                  <Icon name="heart" size={17} />
                  {place.name}
                </button>
                <button
                  className="startmenu__drop"
                  onClick={() => onDropPlace(place.id)}
                  aria-label={t('Oublier {name}', { name: place.name })}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            <button role="menuitem" onClick={pick(onFromHere)}>
              <Icon name="locate" size={17} />{t('Partir de ma position')}</button>
            <button role="menuitem" onClick={pick(() => onPlacing(true))}>
              <Icon name="pin" size={17} />{t('Choisir sur la carte')}</button>
            {onKeepStart && (
              <button role="menuitem" onClick={pick(onKeepStart)}>
                <Icon name="plus" size={17} />{t('Enregistrer ce départ')}</button>
            )}
            {(onPlacingVia || onZone) && <b>{t('Parcours')}</b>}
            {/* Le même geste qu'un appui long sur la carte, pour qui ne le
                connaît pas encore. */}
            {onPlacingVia && (
              <button role="menuitem" onClick={pick(onPlacingVia)}>
                <Icon name="flag" size={17} />{t('Passer par un point')}</button>
            )}
            {onZone && (
              <button role="menuitem" onClick={pick(onZone)}>
                <Icon name="zone" size={17} />
                {drawingZone ? t('Annuler la zone à éviter') : t('Éviter une zone')}
              </button>
            )}
          </div>
        )}
      </div>
      {/* Courir sans tracé, depuis l'accueil seulement : dans le panneau, ce
          geste rare faisait une rangée de boutons à lui seul. Une fois les
          boucles proposées, il est au bas du détail. */}
      {onFreeRun && (
        <button className="tool" onClick={onFreeRun} aria-label={t('Courir libre')} title={t('Courir libre')}>
          <Icon name="play" />
        </button>
      )}
      {/* Le survol n'a de sens qu'une boucle choisie : il n'apparaît qu'alors.
          Pendant le survol, il reste seul visible : c'est par lui qu'on
          l'arrête (voir `10-map-tools.css`). */}
      {onFlyover && (
        <button
          className={`tool tool--fly tool--3d ${flying ? 'tool--on' : ''}`}
          onClick={onFlyover}
          aria-pressed={flying}
          aria-label={flying ? t('Arrêter le survol 3D') : t('Survoler la boucle en 3D')}
        >
          {flying ? <Icon name="stop" /> : <span className="tool__text" aria-hidden="true">3D</span>}
        </button>
      )}
      <button ref={compassRef} className="tool tool--compass" onClick={onNorth} aria-label={t('Remettre le nord en haut')}>
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
  const polygon = draft.shape === 'polygon'
  const points = draft.points ?? []
  const placed = polygon ? points.length >= 3 : Number.isFinite(draft.lon)
  const km = draft.radius_m >= 1000
  // La hauteur de carte que la carte de réglage recouvre (`--zone-cover`) : le
  // « i » de l'attribution se pose juste au-dessus, comme au-dessus du panneau
  // ailleurs. Sans elle, il restait calé sur le panneau caché, très haut.
  const box = useRef(null)
  useEffect(() => {
    const el = box.current
    const shell = el?.closest('.shell')
    if (!shell) return undefined
    const update = () => shell.style.setProperty('--zone-cover', `${Math.round(shell.getBoundingClientRect().bottom - el.getBoundingClientRect().top)}px`)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()
    return () => {
      observer.disconnect()
      shell.style.removeProperty('--zone-cover')
    }
  }, [])
  return (
    <div className="zonedraft" role="dialog" aria-label={t('Zone à éviter')} ref={box}>
      <b>{t('Zone à éviter')}</b>
      {/* Changer de forme repart d'une zone vide : un centre ne fait pas un contour. */}
      <Segmented
        options={[
          { key: 'circle', label: t('Cercle') },
          { key: 'polygon', label: t('Contour') },
        ]}
        value={polygon ? 'polygon' : 'circle'}
        onChange={(shape) => onChange({ shape, radius_m: draft.radius_m, name: draft.name, reason: draft.reason })}
      />
      {/* La raison, en tuiles à icône : se reconnaît d'un coup d'œil, sur la
          carte comme dans la liste de « Mon compte ». */}
      <div className="reasons" role="group" aria-label={t('Raison')}>
        {ZONE_REASONS.map((r) => (
          <button
            key={r.key}
            className="reason"
            data-reason={r.key}
            aria-pressed={draft.reason === r.key}
            onClick={() => onChange({ ...draft, reason: draft.reason === r.key ? null : r.key })}
          >
            <Icon name={r.icon} size={20} />
            <span>{t(r.label)}</span>
          </button>
        ))}
      </div>
      {polygon ? (
        <>
          <p className="muted small">
            {points.length < 3
              ? t('Touche la carte pour poser les coins de la zone ({length} sur 3 au moins).', { length: points.length })
              : t('{length} points posés. Touche la carte pour en ajouter.', { length: points.length })}
          </p>
          {points.length > 0 && (
            <button className="linkish" onClick={() => onChange({ ...draft, points: points.slice(0, -1) })}>{t('Retirer le dernier point')}</button>
          )}
          {placed && (
            <input
              className="field"
              type="text"
              autoCapitalize="sentences"
              autoCorrect="off"
              maxLength={60}
              placeholder={t('Forêt de chasse, chantier, quartier…')}
              aria-label={t('Nom de la zone')}
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          )}
        </>
      ) : placed ? (
        <>
          <label className="zonedraft__radius">
            <span>{t('Rayon')}{' '}<em>{km ? `${(draft.radius_m / 1000).toFixed(1).replace('.', dec())} km` : `${draft.radius_m} m`}</em>
            </span>
            <input
              type="range"
              aria-label={t('Rayon de la zone')}
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
            placeholder={t('Forêt de chasse, chantier, quartier…')}
            aria-label={t('Nom de la zone')}
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
          <p className="muted small">{t('Fais glisser le rond du centre pour la déplacer.')}</p>
        </>
      ) : (
        <p className="muted small">{t('Touche la carte au centre de ce que les boucles doivent contourner.')}</p>
      )}
      <div className="row">
        <button className="btn" onClick={onCancel}>{t('Annuler')}</button>
        <button className="btn btn--primary" disabled={!placed} onClick={onKeep}>{t('Éviter cette zone')}</button>
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
      <button className="tool" onClick={onStyles} aria-label={t('Fond de carte')}>
        <Icon name="layers" />
      </button>
      <button
        className={`tool ${speaking ? '' : 'tool--muted'}`}
        onClick={onVoice}
        aria-pressed={speaking}
        aria-label={speaking ? t('Couper le guidage vocal') : t('Activer le guidage vocal')}
      >
        <Icon name={speaking ? 'volume' : 'volumeOff'} />
      </button>
      <button
        ref={compassRef}
        className="tool tool--compass"
        onClick={onRunView}
        aria-label={runView === 'north' ? t('Orienter la carte dans le sens de la course') : t('Mettre le nord en haut')}
      >
        <span className="needle" aria-hidden="true" />
        <small>{runView === 'north' ? 'N' : t('CAP')}</small>
      </button>
      {onOverview && (
        <button className="tool" onClick={onOverview} aria-label={t('Voir tout le parcours')}>
          <Icon name="expand" />
        </button>
      )}
    </div>
  )
}
