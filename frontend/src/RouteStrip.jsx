import { useMemo, useRef, useState } from 'react'
import { haversine, km, profileRange, surfaceLabel } from './format'

/**
 * La bande de parcours : le profil altimétrique et le niveau de sécurité sur un
 * même axe, celui de la distance.
 *
 * Les deux informations se lisent ensemble ou pas du tout — savoir qu'il y a
 * 200 m d'exposition ne sert à rien tant qu'on ignore *où*. En parcourant la
 * bande, le point correspondant s'allume sur la carte.
 */

const SURFACE_COLORS = {
  paved: '#4A9EFF',
  gravel: '#FFD426',
  trail: '#C58B4A',
  unknown: '#6B747D',
}
const LEVEL_COLORS = { safe: '#32D74B', caution: '#FFD426', risk: '#FF6A45', unknown: '#9B7BF0' }
const LEVEL_LABELS = {
  safe: 'voie protégée',
  caution: 'vigilance',
  risk: 'exposé au trafic',
  unknown: 'non évalué',
}

const W = 660
const H_ELEV = 92
const H_BAND = 11
const H = H_ELEV + H_BAND + 16
// La marge de gauche porte les altitudes : quatre chiffres à la taille de
// `.strip__tick`, un col des Alpes compris.
const PAD = { top: 8, right: 6, left: 52 }

export default function RouteStrip({ route, onScrub }) {
  const [cursor, setCursor] = useState(null)
  const svgRef = useRef(null)

  const model = useMemo(() => build(route), [route])

  if (!model) return null

  const locate = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const dist = ratio * model.total
    setCursor(dist)
    onScrub?.(coordAt(model, dist))
  }

  const clear = () => {
    setCursor(null)
    onScrub?.(null)
  }

  const readout = cursor === null ? null : describe(model, cursor)

  return (
    <div className="strip">
      <div className="strip__head">
        <span className="strip__title">Parcours</span>
        <span className="mono strip__read">
          {readout
            ? `${km(readout.dist, 2)} km · ${Math.round(readout.ele)} m · ${
                LEVEL_LABELS[readout.level]
              }`
            : model.hasElevation
              ? `D+ ${Math.round(route.ascent_m || 0)} m · D− ${Math.round(
                  route.descent_m || 0,
                )} m`
              : 'altitude indisponible'}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="strip__svg"
        onTouchStart={(e) => locate(e.touches[0].clientX)}
        onTouchMove={(e) => locate(e.touches[0].clientX)}
        onTouchEnd={clear}
        role="img"
        aria-label={`Profil du parcours sur ${km(model.total, 1)} kilomètres`}
      >
        {model.hasElevation && (
          <>
            {model.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={model.y(t)}
                  y2={model.y(t)}
                  className="strip__grid"
                />
                <text x={PAD.left - 6} y={model.y(t) + 6} className="strip__tick">
                  {Math.round(t)}
                </text>
              </g>
            ))}

            {model.areas.map((area, i) => (
              <path
                key={i}
                d={area.d}
                fill={SURFACE_COLORS[area.surface] || SURFACE_COLORS.unknown}
                opacity="0.2"
              />
            ))}
            <path d={`M${model.line}`} className="strip__line" />
          </>
        )}

        {/* Bande de sécurité : la lecture qui justifie la note. */}
        {model.bands.map((band, i) => (
          <rect
            key={i}
            x={band.x0}
            y={H_ELEV + 8}
            width={Math.max(1, band.x1 - band.x0)}
            height={H_BAND}
            fill={LEVEL_COLORS[band.level]}
            rx="1.5"
          />
        ))}

        {model.crossings.map((c, i) => (
          <g key={`c${i}`}>
            <line
              x1={c.x}
              x2={c.x}
              y1={H_ELEV + 4}
              y2={H_ELEV + 8 + H_BAND + 4}
              stroke={c.protected ? LEVEL_COLORS.caution : LEVEL_COLORS.risk}
              strokeWidth="2"
            />
          </g>
        ))}

        {cursor !== null && (
          <line
            x1={model.x(cursor)}
            x2={model.x(cursor)}
            y1={PAD.top}
            y2={H_ELEV + 8 + H_BAND}
            className="strip__cursor"
          />
        )}
      </svg>

      <div className="strip__legend">
        {model.levels.map((level) => (
          <span key={level} className="strip__key">
            <i style={{ background: LEVEL_COLORS[level] }} />
            {LEVEL_LABELS[level]}
          </span>
        ))}
        {model.surfaces.map((s) => (
          <span key={s} className="strip__key">
            <i style={{ background: SURFACE_COLORS[s], opacity: 0.55 }} />
            {surfaceLabel(s)}
          </span>
        ))}
      </div>
    </div>
  )
}

// --- modèle ----------------------------------------------------------------

function build(route) {
  if (!route?.geometry?.length) return null

  // Distance cumulée le long de la géométrie : c'est elle qui relie une
  // position sur la bande à un point sur la carte.
  const cum = [0]
  for (let i = 1; i < route.geometry.length; i += 1) {
    cum.push(cum[i - 1] + haversine(route.geometry[i - 1], route.geometry[i]))
  }
  const total = cum[cum.length - 1] || route.distance_m || 1
  const x = (d) => PAD.left + (d / total) * (W - PAD.left - PAD.right)

  // Bande de sécurité, à partir des tronçons homogènes.
  const bands = []
  let cursor = 0
  for (const seg of route.segments || []) {
    bands.push({ x0: x(cursor), x1: x(cursor + seg.length_m), level: seg.level })
    cursor += seg.length_m
  }

  const crossings = (route.crossings || []).map((c) => ({
    x: x(nearestDistance(route.geometry, cum, [c.lon, c.lat])),
    protected: c.protected,
  }))

  const points = route.elevation_profile
  const hasElevation = Boolean(points?.length)

  let y = () => 0
  let areas = []
  let line = ''
  let ticks = []

  if (hasElevation) {
    const [lo, hi] = profileRange(points.map((p) => p.ele_m))
    y =(e) => PAD.top + (1 - (e - lo) / (hi - lo)) * (H_ELEV - PAD.top)
    ticks = [lo, (lo + hi) / 2, hi]
    line = points.map((p) => `${x(p.dist_m)},${y(p.ele_m)}`).join(' L')

    const groups = []
    let group = null
    points.forEach((p, i) => {
      if (!group || group.surface !== p.surface) {
        group = { surface: p.surface, start: Math.max(0, i - 1), end: i }
        groups.push(group)
      } else {
        group.end = i
      }
    })
    areas = groups
      .map((g) => {
        const slice = points.slice(g.start, g.end + 1)
        if (slice.length < 2) return null
        const top = slice.map((p) => `${x(p.dist_m)},${y(p.ele_m)}`).join(' L')
        return {
          surface: g.surface,
          d: `M${x(slice[0].dist_m)},${H_ELEV} L${top} L${x(
            slice[slice.length - 1].dist_m,
          )},${H_ELEV} Z`,
        }
      })
      .filter(Boolean)
  }

  return {
    total,
    cum,
    geometry: route.geometry,
    points,
    hasElevation,
    x,
    y,
    ticks,
    areas,
    line,
    bands,
    crossings,
    levels: [...new Set((route.segments || []).map((s) => s.level))],
    surfaces: [...new Set((points || []).map((p) => p.surface))],
  }
}

function coordAt(model, dist) {
  const { cum, geometry } = model
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < dist) lo = mid + 1
    else hi = mid
  }
  return geometry[Math.max(0, Math.min(geometry.length - 1, lo))]
}

function describe(model, dist) {
  let ele = 0
  if (model.hasElevation) {
    const closest = model.points.reduce((best, p) =>
      Math.abs(p.dist_m - dist) < Math.abs(best.dist_m - dist) ? p : best,
    )
    ele = closest.ele_m
  }
  const px = model.x(dist)
  const band = model.bands.find((b) => px >= b.x0 && px <= b.x1)
  return { dist, ele, level: band?.level || 'safe' }
}

/** Distance le long du tracé du point de la géométrie le plus proche. */
function nearestDistance(geometry, cum, target) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < geometry.length; i += 1) {
    const d = haversine(geometry[i], target)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return cum[best]
}
