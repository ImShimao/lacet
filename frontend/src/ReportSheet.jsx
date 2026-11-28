/**
 * Un signalement montré sur la carte, avant de décider s'il reste.
 *
 * La liste de Mon compte ne donnait que la date et des coordonnées : « 47.9097,
 * 7.2105 » ne dit à personne si c'est le chantier de la rue du Marché ou un
 * appui de trop dans la poche. La carte montre l'endroit, et le cercle ce que
 * le routage évite vraiment autour — vingt-cinq mètres.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import { ActionRow, PrefsCard } from './Prefs.jsx'
import useModal from './useModal'
import { loadOptions, mapToken, styleByKey } from './mapStyles'
import { circlePolygon } from './circle'
import { BLOCK_RADIUS_M } from './engine/blocked'
import { kindLabel } from './reports'
import { t, locale } from './i18n'

// Assez près pour lire les noms de rues autour du point.
const ZOOM = 16.5

export default function ReportSheet({ report, mapStyle, onRemove, onClose }) {
  const panel = useModal(onClose)
  const host = useRef(null)

  useEffect(() => {
    const at = [report.lon, report.lat]
    const entry = styleByKey(mapStyle)
    const map = new maplibregl.Map({ container: host.current, center: at, zoom: ZOOM, attributionControl: false, fadeDuration: 0 })
    map.setStyle(entry.style, loadOptions(entry))
    // Remis à chaque style chargé : un changement de style efface les calques ajoutés.
    map.on('style.load', () => {
      const risk = mapToken('--risk') || '#e5484d'
      map.addSource('report', { type: 'geojson', data: { type: 'Feature', geometry: circlePolygon(at, BLOCK_RADIUS_M), properties: {} } })
      map.addLayer({ id: 'report-fill', type: 'fill', source: 'report', paint: { 'fill-color': risk, 'fill-opacity': 0.18 } })
      map.addLayer({ id: 'report-line', type: 'line', source: 'report', paint: { 'line-color': risk, 'line-width': 2 } })
    })
    const pin = document.createElement('div')
    pin.className = 'reportpin'
    new maplibregl.Marker({ element: pin }).setLngLat(at).addTo(map)
    return () => map.remove()
  }, [report, mapStyle])

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel mapsheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={kindLabel(report.kind)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mapsheet__head">
          <div>
            <h2>{kindLabel(report.kind)}</h2>
            <p className="muted small">{t('Signalé le {day}', { day: new Date(report.at).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
          </div>
          <button className="mapsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mapsheet__preview reportsheet__map" ref={host} />
        <p className="muted small">{t('Le cercle rouge est évité par les boucles et les recalculs.')}</p>
        <PrefsCard>
          <ActionRow icon="close" label={t('Retirer ce signalement')} danger onClick={onRemove} />
        </PrefsCard>
      </div>
    </div>,
    // Hors du panneau de Mon compte : dedans, la barre d'onglets passait par-dessus.
    document.getElementById('root') ?? document.body,
  )
}
