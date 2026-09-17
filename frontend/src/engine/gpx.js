// Export GPX 1.1 — portage fidèle de `backend/app/gpx.py`.
//
// L'attribution OpenStreetMap est obligatoire : les données sont en ODbL, et un
// tracé qui en dérive doit la porter, y compris dans un fichier exporté.

import { haversineM } from './geo'
import { pyFixed } from './py'

const ATTRIBUTION =
  'Itinéraire dérivé des données OpenStreetMap, sous licence ODbL (openstreetmap.org/copyright).'
const ACTIVITY_TYPE = { run: 'running', bike: 'cycling' }

/** `xml.sax.saxutils.escape` : &, < et > — pas les guillemets. */
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Étale un profil échantillonné sur toute la géométrie — `_interpolate`. */
function interpolate(coords, samples) {
  if (samples.length < 2 || coords.length < 2) return coords.map(() => (samples.length ? samples[0] : 0))

  const cumulative = [0]
  for (let i = 0; i < coords.length - 1; i += 1) {
    cumulative.push(cumulative[cumulative.length - 1] + haversineM(coords[i], coords[i + 1]))
  }
  const total = cumulative[cumulative.length - 1] || 1
  const step = total / (samples.length - 1)

  return cumulative.map((distance) => {
    const position = distance / step
    const low = Math.min(Math.trunc(position), samples.length - 2)
    const fraction = position - low
    return samples[low] + (samples[low + 1] - samples[low]) * fraction
  })
}

export function buildGpx(name, coords, elevations = null, sport = 'run', now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const safeName = escape(name)
  const series = elevations ? interpolate(coords, elevations) : null

  const points = coords.map(([lon, lat], i) =>
    series
      ? `      <trkpt lat="${pyFixed(lat, 7)}" lon="${pyFixed(lon, 7)}"><ele>${pyFixed(series[i], 1)}</ele></trkpt>`
      : `      <trkpt lat="${pyFixed(lat, 7)}" lon="${pyFixed(lon, 7)}" />`,
  )

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lacet"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${safeName}</name>
    <time>${stamp}</time>
    <copyright author="OpenStreetMap contributors">
      <license>https://opendatacommons.org/licenses/odbl/</license>
    </copyright>
    <desc>${escape(ATTRIBUTION)}</desc>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <type>${ACTIVITY_TYPE[sport] ?? 'running'}</type>
    <trkseg>
${points.join('\n')}
    </trkseg>
  </trk>
</gpx>
`
}

/** Nom de fichier sûr, comme l'en-tête `Content-Disposition` du backend. */
export const gpxFilename = (name) =>
  `${[...name].map((c) => (/[\p{L}\p{N}_-]/u.test(c) ? c : '-')).join('').slice(0, 60) || 'lacet'}.gpx`
