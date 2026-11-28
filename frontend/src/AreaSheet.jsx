/**
 * Un signalement ou une zone montré sur la carte, avant de décider s'il reste.
 *
 * La liste de Mon compte ne donnait qu'un nom ou une date : « Zone dangereuse »
 * ou « 28 novembre » ne disent à personne si c'est le chantier de la rue du
 * Marché ou un appui de trop dans la poche. La carte montre l'endroit, et la
 * forme ce que le routage évite vraiment autour.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import { ActionRow, PrefsCard } from './Prefs.jsx'
import useModal from './useModal'
import { loadOptions, mapToken, styleByKey } from './mapStyles'
import { t } from './i18n'

// Assez près pour lire les noms de rues autour d'un point, sans dépasser pour une grande zone.
const MAX_ZOOM = 16.5

/** Le rectangle qui contient la forme, pour que toute la zone tienne à l'écran. */
function boundsOf(geometry) {
  const ring = geometry.coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}

export default function AreaSheet({ title, sub, geometry, point, note, removeLabel, mapStyle, onRemove, onClose }) {
  const panel = useModal(onClose)
  const host = useRef(null)

  useEffect(() => {
    const entry = styleByKey(mapStyle)
    const map = new maplibregl.Map({
      container: host.current,
      bounds: boundsOf(geometry),
      fitBoundsOptions: { padding: 40, maxZoom: MAX_ZOOM },
      attributionControl: false,
      fadeDuration: 0,
    })
    map.setStyle(entry.style, loadOptions(entry))
    // Remis à chaque style chargé : un changement de style efface les calques ajoutés.
    map.on('style.load', () => {
      const risk = mapToken('--risk') || '#e5484d'
      map.addSource('area', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } })
      map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': risk, 'fill-opacity': 0.18 } })
      map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': risk, 'line-width': 2 } })
    })
    if (point) {
      const pin = document.createElement('div')
      pin.className = 'reportpin'
      new maplibregl.Marker({ element: pin }).setLngLat(point).addTo(map)
    }
    return () => map.remove()
  }, [geometry, point, mapStyle])

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel mapsheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mapsheet__head">
          <div>
            <h2>{title}</h2>
            {sub && <p className="muted small">{sub}</p>}
          </div>
          <button className="mapsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mapsheet__preview reportsheet__map" ref={host} />
        <p className="muted small">{note}</p>
        <PrefsCard>
          <ActionRow icon="close" label={removeLabel} danger onClick={onRemove} />
        </PrefsCard>
      </div>
    </div>,
    // Hors du panneau de Mon compte : dedans, la barre d'onglets passait par-dessus.
    document.getElementById('root') ?? document.body,
  )
}
