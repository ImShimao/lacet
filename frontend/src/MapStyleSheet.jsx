import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import useModal from './useModal'
import { lastCamera } from './camera'
import { MAP_STYLES, loadOptions, styleByKey } from './mapStyles'

/**
 * Le choix du fond de carte, avec un aperçu.
 *
 * Une liste de noms — « Plan », « Clair », « Fjord » — ne disait rien de ce
 * qu'on allait voir : on changeait de fond pour découvrir, puis on revenait.
 * L'aperçu montre le fond sur l'endroit qu'on regarde, une phrase dit à quoi il
 * sert, et rien ne change sur la grande carte avant « Enregistrer ».
 */
export default function MapStyleSheet({ value, onSave, onClose }) {
  const [choice, setChoice] = useState(value)
  const panel = useModal(onClose)
  const preview = useRef(null)
  const map = useRef(null)
  const shown = useRef(value)
  const tabs = useRef(null)

  // L'onglet choisi reste en vue : huit fonds ne tiennent pas sur une ligne.
  useEffect(() => {
    tabs.current?.querySelector('[aria-checked="true"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [choice])

  // Une carte figée : on la regarde, on ne s'y promène pas. Au moins au
  // zoom 14, là où les noms de rues apparaissent — c'est sur eux qu'on juge.
  useEffect(() => {
    const { center, zoom } = lastCamera()
    const entry = styleByKey(value)
    const instance = new maplibregl.Map({
      container: preview.current,
      center,
      zoom: Math.max(14, zoom),
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    })
    instance.setStyle(entry.style, loadOptions(entry))
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!map.current || shown.current === choice) return
    shown.current = choice
    const entry = styleByKey(choice)
    map.current.setStyle(entry.style, loadOptions(entry))
  }, [choice])

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel mapsheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Fond de carte"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Comme la feuille de RunnrZ : fermer en haut à gauche, le fond en grand,
            les fonds en onglets dessous, une phrase, et « Enregistrer ». */}
        <button className="mapsheet__close" onClick={onClose} aria-label="Fermer">
          <Icon name="close" size={18} />
        </button>

        <div className="mapsheet__preview" ref={preview} aria-hidden="true" />

        <div className="mapsheet__tabs" role="radiogroup" aria-label="Fonds disponibles" ref={tabs}>
          {MAP_STYLES.map((s) => (
            <button
              key={s.key}
              role="radio"
              aria-checked={choice === s.key}
              className="mapsheet__tab"
              onClick={() => setChoice(s.key)}
              data-autofocus={choice === s.key || undefined}
            >
              <i style={{ background: s.swatch }} aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>

        <p className="mapsheet__desc" aria-live="polite">
          {styleByKey(choice).description}
        </p>

        <button className="btn btn--primary mapsheet__save" onClick={() => onSave(choice)}>
          Enregistrer
        </button>
      </div>
    </div>
  )
}
