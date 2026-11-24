import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { km, profileRange } from './format'
import { unitLabel } from './units'
import useModal from './useModal'

import { t } from './i18n'
/**
 * Le dénivelé prévu, ouvert en pleine sortie.
 *
 * La question qu'on se pose en courant n'est pas « combien de dénivelé en
 * tout » — on l'a lu avant de partir — mais « est-ce que ça monte encore ? ».
 * D'où le repère de là où l'on est, et ce qui reste à grimper.
 */

const W = 340
const H = 132
const PAD = { top: 10, right: 8, bottom: 20, left: 34 }

export default function ElevationSheet({ route, along, onClose }) {
  const panel = useModal(onClose)
  const model = useMemo(() => build(route?.elevation_profile), [route])
  if (!model) return null

  const here = Math.max(0, Math.min(model.total, along ?? 0))
  const hereX = x(model, here)
  const hereEle = eleAt(model, here)
  // Ramené au dénivelé annoncé : le total, lui, se calcule sur un profil lissé,
  // et « il reste 76 m à monter » sur un parcours de 71 m ne se lirait pas.
  const whole = climbAfter(model, 0)
  const left = route.ascent_m != null && whole > 0 ? (climbAfter(model, here) * route.ascent_m) / whole : climbAfter(model, here)

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel elevsheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('Dénivelé prévu')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <button className="mapsheet__close" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="close" size={18} />
          </button>
          <h2>{t('Dénivelé prévu')}</h2>
          <span />
        </div>
        <div className="modal__body">
          <svg className="elevsheet__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Profil altimétrique')}>
            <defs>
              <linearGradient id="elev-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0.55" />
                <stop offset="100%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {model.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(model, t)} y2={y(model, t)} className="elevsheet__grid" />
                <text x={PAD.left - 5} y={y(model, t) + 3} textAnchor="end" className="elevsheet__tick">
                  {Math.round(t)}
                </text>
              </g>
            ))}
            <path d={model.area} fill="url(#elev-fill)" />
            <path d={model.line} fill="none" style={{ stroke: 'var(--accent-text)' }} strokeWidth="2" strokeLinejoin="round" />
            <line x1={hereX} x2={hereX} y1={PAD.top} y2={H - PAD.bottom} className="elevsheet__here" />
            <circle cx={hereX} cy={y(model, hereEle)} r="5" className="elevsheet__dot" />
            <text x={PAD.left} y={H - 5} className="elevsheet__tick">0</text>
            <text x={W - PAD.right} y={H - 5} textAnchor="end" className="elevsheet__tick">
              {km(model.total, 1)} {unitLabel()}
            </text>
          </svg>

          <div className="elevsheet__stats">
            <div>
              <span>{t('Positif')}</span>
              <b>{route.ascent_m != null ? `${Math.round(route.ascent_m)} m` : '—'}</b>
            </div>
            <div>
              <span>{t('Négatif')}</span>
              <b>{route.descent_m != null ? `${Math.round(route.descent_m)} m` : '—'}</b>
            </div>
            <div>
              <span>{t('Reste à monter')}</span>
              <b>{Math.round(left)} m</b>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

function build(profile) {
  if (!profile || profile.length < 2) return null
  const points = profile.map((p) => [p.dist_m, p.ele_m])
  const total = points[points.length - 1][0] || 1
  // Le même axe que la bande de parcours, avant le départ : la boucle ne doit
  // pas changer d'allure entre l'écran qui la propose et celui qui la suit.
  const [min, max] = profileRange(points.map((p) => p[1]))
  const model = { points, total, min, max }
  const coords = points.map(([d, e]) => `${x(model, d).toFixed(1)},${y(model, e).toFixed(1)}`)
  model.line = `M${coords.join('L')}`
  model.area = `${model.line}L${x(model, total).toFixed(1)},${H - PAD.bottom}L${PAD.left},${H - PAD.bottom}Z`
  model.ticks = [min, (min + max) / 2, max]
  return model
}

const x = (m, d) => PAD.left + (d / m.total) * (W - PAD.left - PAD.right)
const y = (m, e) => PAD.top + (1 - (e - m.min) / (m.max - m.min)) * (H - PAD.top - PAD.bottom)

function eleAt(model, d) {
  const pts = model.points
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i][0] >= d) {
      const [d0, e0] = pts[i - 1]
      const [d1, e1] = pts[i]
      const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0
      return e0 + (e1 - e0) * t
    }
  }
  return pts[pts.length - 1][1]
}

/** Les mètres de montée encore devant. */
function climbAfter(model, d) {
  let total = 0
  let previous = eleAt(model, d)
  for (const [dist, ele] of model.points) {
    if (dist <= d) continue
    if (ele > previous) total += ele - previous
    previous = ele
  }
  return total
}
