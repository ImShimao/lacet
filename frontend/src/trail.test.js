import { describe, expect, it } from 'vitest'
import { haversineM } from './engine/geo'
import { simplify, trailRecorder } from './trail'

const trailLength = (points) => points.slice(1).reduce((total, p, i) => total + haversineM(points[i], p), 0)

/**
 * La trace d'une sortie : ce qu'on garde, et ce qu'on jette.
 *
 * Deux pièges, tous deux constatés sur un vrai GPS de téléphone : une trace
 * complète sature le stockage, et l'altitude brute invente du dénivelé.
 */

const LAT = 47.9
const LON = 7.2
const M_LON = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const M_LAT = 1 / 110_540
const est = (m) => [LON + m * M_LON, LAT]
const nord = (m) => [LON, LAT + m * M_LAT]

describe('l’enregistrement', () => {
  it('ne garde pas deux points à trois mètres l’un de l’autre', () => {
    const trace = trailRecorder()
    expect(trace.push(est(0))).toBe(true)
    expect(trace.push(est(3))).toBe(false)
    expect(trace.push(est(9))).toBe(true)
    expect(trace.points).toHaveLength(2)
  })

  it('compte le dénivelé sur une altitude lissée, pas sur le bruit', () => {
    const trace = trailRecorder()
    // Cinquante mètres à plat, avec un GPS qui saute de ±4 m.
    for (let i = 0; i < 50; i += 1) trace.push(est(i * 10), 200 + (i % 2 ? 4 : -4))
    expect(trace.ascent).toBeLessThan(10)
  })

  it('compte une vraie montée', () => {
    const trace = trailRecorder()
    for (let i = 0; i < 50; i += 1) trace.push(est(i * 10), 200 + i * 2)
    expect(trace.ascent).toBeGreaterThan(80)
    expect(trace.ascent).toBeLessThan(105)
  })

  it('repart d’une trace déjà commencée — une sortie reprise après coupure', () => {
    const trace = trailRecorder([est(0), est(20)])
    trace.push(est(40))
    expect(trace.points).toHaveLength(3)
  })
})

describe('l’allègement', () => {
  it('efface les points alignés et garde les virages', () => {
    const ligne = Array.from({ length: 60 }, (_, i) => est(i * 5))
    const virage = Array.from({ length: 60 }, (_, i) => [est(295)[0], LAT + i * 5 * M_LAT])
    const allege = simplify([...ligne, ...virage])
    // Trois points suffisent à décrire deux droites perpendiculaires.
    expect(allege.length).toBeLessThanOrEqual(4)
    expect(allege.length).toBeGreaterThanOrEqual(3)
  })

  it('ne déforme pas la distance', () => {
    const points = Array.from({ length: 200 }, (_, i) => (i % 2 ? est(i * 2) : nord(i * 2)))
    const avant = trailLength(points)
    const apres = trailLength(simplify(points, 2))
    expect(Math.abs(avant - apres) / avant).toBeLessThan(0.1)
  })

  it('arrondit au mètre : le reste est du bruit', () => {
    const [point] = simplify([[7.123456789, 47.987654321], est(100), est(200)])
    expect(point).toEqual([7.12346, 47.98765])
  })
})
