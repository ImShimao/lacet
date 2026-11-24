import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import Icon from './Icon.jsx'
import useModal from './useModal'
import { lastCamera } from './camera'
import { MAP_STYLES, loadOptions, styleByKey } from './mapStyles'

import { t } from './i18n'
// Les vignettes déjà rendues, pour la session : rouvrir la feuille au même
// endroit ne refait pas le tour des fonds.
const thumbs = new Map()
const thumbKey = (key, [lon, lat], zoom) => `${key}@${lon.toFixed(3)},${lat.toFixed(3)},${Math.round(zoom)}`
// Un fond qui ne répond pas ne bloque pas les suivants.
const THUMB_WAIT_MS = 4000

/**
 * Rend chaque fond sur l'endroit qu'on regarde, l'un après l'autre, dans une
 * petite carte cachée, et en garde une image. Une pastille de couleur ne disait
 * pas plus qu'un nom : la vignette montre le fond lui-même.
 */
function useThumbnails(center, zoom) {
  const [images, setImages] = useState(() =>
    Object.fromEntries(MAP_STYLES.map((s) => [s.key, thumbs.get(thumbKey(s.key, center, zoom)) ?? null])),
  )
  const host = useRef(null)

  useEffect(() => {
    const todo = MAP_STYLES.filter((s) => !thumbs.has(thumbKey(s.key, center, zoom)))
    if (!todo.length || !host.current) return undefined
    let stopped = false
    const map = new maplibregl.Map({
      container: host.current,
      center,
      zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      preserveDrawingBuffer: true,
    })
    const idle = () =>
      new Promise((done) => {
        const timer = setTimeout(done, THUMB_WAIT_MS)
        map.once('idle', () => {
          clearTimeout(timer)
          done()
        })
      })
    const run = async () => {
      for (const entry of todo) {
        if (stopped) return
        map.setStyle(entry.style, loadOptions(entry))
        await idle()
        if (stopped) return
        try {
          const image = map.getCanvas().toDataURL('image/jpeg', 0.8)
          thumbs.set(thumbKey(entry.key, center, zoom), image)
          setImages((prev) => ({ ...prev, [entry.key]: image }))
        } catch {
          // Une image refusée (tuiles sans en-têtes CORS) : la couleur du fond reste.
        }
      }
    }
    run()
    return () => {
      stopped = true
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { images, host }
}

/**
 * Le choix du fond de carte, comme le sélecteur de fonds d'Apple Plans : le
 * fond choisi en grand, tous les fonds en vignettes dessous, d'un seul coup
 * d'œil, et rien ne change sur la grande carte avant « Enregistrer ».
 *
 * Des onglets en une ligne coupaient le cinquième fond au bord de l'écran :
 * on ne savait pas qu'il y en avait d'autres.
 */
export default function MapStyleSheet({ value, onSave, onClose }) {
  const [choice, setChoice] = useState(value)
  const panel = useModal(onClose)
  const preview = useRef(null)
  const map = useRef(null)
  const shown = useRef(value)
  const [camera] = useState(() => {
    const { center, zoom } = lastCamera()
    // Au moins au zoom 14, là où les noms de rues apparaissent : c'est sur eux qu'on juge.
    return { center, zoom: Math.max(14, zoom) }
  })
  const { images, host } = useThumbnails(camera.center, camera.zoom - 1)

  // Une carte figée : on la regarde, on ne s'y promène pas.
  useEffect(() => {
    const entry = styleByKey(value)
    const instance = new maplibregl.Map({
      container: preview.current,
      center: camera.center,
      zoom: camera.zoom,
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

  const current = styleByKey(choice)

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel mapsheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('Style de carte')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mapsheet__head">
          <h2>{t('Style de carte')}</h2>
          <button className="mapsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="mapsheet__preview" ref={preview} aria-hidden="true">
          <span className="mapsheet__badge">{t(current.label)}</span>
        </div>
        <p className="mapsheet__desc" aria-live="polite">
          {t(current.description)}
        </p>

        <div className="mapsheet__grid" role="radiogroup" aria-label={t('Fonds disponibles')}>
          {MAP_STYLES.map((s) => (
            <button
              key={s.key}
              role="radio"
              aria-checked={choice === s.key}
              className="mapsheet__tile"
              onClick={() => setChoice(s.key)}
              data-autofocus={choice === s.key || undefined}
            >
              <span className="mapsheet__thumb" style={{ background: s.swatch }}>
                {images[s.key] && <img src={images[s.key]} alt="" />}
                <Icon name="check" size={14} className="mapsheet__check" />
              </span>
              <span className="mapsheet__name">{t(s.label)}</span>
            </button>
          ))}
        </div>

        <button className="btn btn--primary mapsheet__save" onClick={() => onSave(choice)}>{t('Enregistrer')}</button>

        {/* La petite carte qui rend les vignettes, hors de vue. */}
        <div className="mapsheet__offscreen" ref={host} aria-hidden="true" />
      </div>
    </div>
  )
}
