// Une sortie courue, en GPX horodaté.
//
// Strava refuse un GPX sans heures : sans elles, il n'y a ni allure ni durée,
// seulement un dessin. L'export d'un *parcours* n'en a pas besoin — c'est un
// plan —, celui d'une *sortie*, si.
//
// Une sortie récente garde l'heure de chaque point (`track_t`, voir `trail.js`),
// et il n'y a rien à reconstituer. Les plus anciennes n'ont que la trace, un
// point tous les huit mètres, sans rien d'autre. Leurs heures se retrouvent
// par les tours de kilomètre, relevés pendant la sortie : chaque kilomètre prend
// exactement le temps qu'il a pris, et l'intérieur d'un kilomètre est couru à
// allure régulière. L'allure au kilomètre, qu'on lit sur Strava, est donc la
// vraie ; seul ce qui se passe entre deux bornes est lissé.

import { haversineM } from './engine/geo'
import { t } from './i18n'
import { pyFixed } from './engine/py'

const ATTRIBUTION =
  'Itinéraire dérivé des données OpenStreetMap, sous licence ODbL (openstreetmap.org/copyright).'
const ACTIVITY_TYPE = { run: 'running', bike: 'cycling' }

const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * L'heure de chaque point de la trace, en millisecondes.
 *
 * La sortie se termine à `ranAt` ; le temps en mouvement la précède, pauses
 * comprises à la fin (on ne sait plus où elles ont eu lieu). La longueur de la
 * trace allégée diffère un peu de la distance mesurée : on ramène l'une à
 * l'autre, pour que le kilomètre n de la trace soit le kilomètre n couru.
 */
export function runTimes(track, entry) {
  const moving = Math.max(1, entry.actual_duration_s || 0)
  const end = Date.parse(entry.ranAt) || Date.now()

  // Les sorties récentes ont l'heure de chaque point, relevée en courant
  // (`trail.js`) : rien à reconstituer, et les pauses tombent où elles ont eu
  // lieu. Elle ne recule jamais — une pause automatique revient huit secondes
  // en arrière sur le chrono, pas sur la montre.
  const known = entry.track_t
  if (known?.length === track.length && known.every(Number.isFinite)) {
    let latest = 0
    const seconds = known.map((t) => (latest = Math.max(latest, t)))
    return seconds.map((t) => end - (latest - t) * 1000)
  }

  const start = end - (moving + (entry.paused_s || 0)) * 1000

  const along = [0]
  for (let i = 1; i < track.length; i += 1) along.push(along[i - 1] + haversineM(track[i - 1], track[i]))
  const length = along[along.length - 1] || 1
  const scale = (entry.actual_distance_m || length) / length

  // Le temps écoulé au passage de chaque borne, et ce qui reste après la dernière.
  const splits = (entry.splits || []).map((s) => s.seconds)
  const marks = [0]
  for (const s of splits) marks.push(marks[marks.length - 1] + s)
  const lastKm = splits.length
  const tailM = Math.max(1, (entry.actual_distance_m || length) - lastKm * 1000)
  const tailS = Math.max(0, moving - marks[marks.length - 1])

  return along.map((d) => {
    const metres = d * scale
    const km = Math.floor(metres / 1000)
    let seconds
    if (km < lastKm) seconds = marks[km] + ((metres - km * 1000) / 1000) * splits[km]
    else seconds = marks[lastKm] + Math.min(1, (metres - lastKm * 1000) / tailM) * tailS
    return start + Math.min(moving, seconds) * 1000
  })
}

/** Le GPX d'une sortie terminée : sa trace réelle, avec l'heure de chaque point. */
export function buildRunGpx(entry) {
  const track = entry.track?.length > 1 ? entry.track : entry.geometry || []
  const times = runTimes(track, entry)
  const name = escape(entry.name || t('Sortie'))
  const alts = entry.track_alt?.length === track.length ? entry.track_alt : []
  const points = track.map(
    ([lon, lat], i) =>
      `      <trkpt lat="${pyFixed(lat, 7)}" lon="${pyFixed(lon, 7)}">${Number.isFinite(alts[i]) ? `<ele>${alts[i]}</ele>` : ''}<time>${iso(times[i])}</time></trkpt>`,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lacet"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <time>${iso(times[0] ?? Date.now())}</time>
    <copyright author="OpenStreetMap contributors">
      <license>https://opendatacommons.org/licenses/odbl/</license>
    </copyright>
    <desc>${escape(ATTRIBUTION)}</desc>
  </metadata>
  <trk>
    <name>${name}</name>
    <type>${ACTIVITY_TYPE[entry.sport] ?? 'running'}</type>
    <trkseg>
${points.join('\n')}
    </trkseg>
  </trk>
</gpx>
`
}
