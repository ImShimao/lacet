/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { GpxError, lengthOf, parseGpx, toRoute } from './gpxImport'

/**
 * Lire le parcours d'un autre.
 *
 * Les fichiers du monde réel sont sales : espaces de noms fantaisistes,
 * segments multiples, points sans altitude, montre à l'arrêt qui écrit cent
 * fois le même point. Ce qu'on attend de la lecture, c'est qu'elle rende un
 * tracé **juste ou rien** — un parcours à moitié lu se suivrait jusqu'au
 * moment où il s'arrête, au milieu de nulle part.
 */

const gpx = (corps, attrs = 'xmlns="http://www.topografix.com/GPX/1/1"') =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" ${attrs}>${corps}</gpx>`

const trace = (points) =>
  gpx(
    `<trk><name>Tour du lac</name><trkseg>${points
      .map(([lon, lat, ele]) => `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`)
      .join('')}</trkseg></trk>`,
  )

describe('la lecture d’un GPX', () => {
  it('rend les points, le nom et les altitudes', () => {
    const out = parseGpx(trace([[7.2, 47.9, 250], [7.21, 47.91, 262], [7.22, 47.92, 255]]))
    expect(out.name).toBe('Tour du lac')
    expect(out.coords).toHaveLength(3)
    expect(out.coords[0]).toEqual([7.2, 47.9])
    expect(out.elevations).toEqual([250, 262, 255])
  })

  it('met bout à bout les segments d’une même trace', () => {
    // Une pause longue coupe un segment sans couper le parcours.
    const deux = gpx(
      '<trk><trkseg><trkpt lat="47.9" lon="7.2"/><trkpt lat="47.91" lon="7.21"/></trkseg>' +
        '<trkseg><trkpt lat="47.92" lon="7.22"/></trkseg></trk>',
    )
    expect(parseGpx(deux).coords).toHaveLength(3)
  })

  it('accepte un itinéraire dessiné, pas seulement une trace enregistrée', () => {
    const rte = gpx('<rte><name>Semi</name><rtept lat="47.9" lon="7.2"/><rtept lat="47.91" lon="7.21"/></rte>')
    expect(parseGpx(rte).coords).toHaveLength(2)
  })

  it('jette les points répétés d’une montre à l’arrêt', () => {
    const immobile = trace([
      [7.2, 47.9],
      [7.2, 47.9],
      [7.2000001, 47.9],
      [7.21, 47.91],
    ])
    expect(parseGpx(immobile).coords).toHaveLength(2)
  })

  it('renonce au profil dès qu’un point n’a pas d’altitude', () => {
    // Un profil à trous se lirait comme une descente en falaise.
    const troué = trace([[7.2, 47.9, 250], [7.21, 47.91], [7.22, 47.92, 255]])
    expect(parseGpx(troué).elevations).toBeNull()
  })

  it('refuse clairement ce qui n’est pas lisible', () => {
    expect(() => parseGpx('ceci n’est pas du XML <<<')).toThrow(GpxError)
    expect(() => parseGpx(gpx('<metadata><name>vide</name></metadata>'))).toThrow(/aucun tracé/)
    expect(() => parseGpx(trace([[7.2, 47.9]]))).toThrow(/pas assez de points/)
    // Des coordonnées hors du monde ne font pas un parcours.
    expect(() => parseGpx(trace([[7.2, 947.9], [7.21, 47.91]]))).toThrow(/pas assez de points/)
  })
})

describe('le parcours importé', () => {
  const lu = () => parseGpx(trace([[7.2, 47.9, 250], [7.21, 47.9, 262], [7.22, 47.9, 251]]))

  it('mesure sa longueur et son dénivelé', () => {
    const route = toRoute(lu())
    expect(route.distance_m).toBeCloseTo(lengthOf(lu().coords), 1)
    // Douze mètres montés, onze redescendus, au-dessus du seuil de deux.
    expect(route.ascent_m).toBeCloseTo(12, 1)
    expect(route.descent_m).toBeCloseTo(11, 1)
  })

  it('n’invente ni note de sécurité ni consignes', () => {
    // Le fichier ne dit pas les rues : ni trottoirs, ni traversées, ni virages
    // nommés. Une note inventée ferait passer pour sûr un tracé jamais examiné.
    const route = toRoute(lu())
    expect(route.safety).toBeNull()
    expect(route.grade).toBeUndefined()
    expect(route.instructions).toEqual([])
    expect(route.segments[0].level).toBe('unknown')
    expect(route.imported).toBe(true)
  })
})
