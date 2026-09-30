import { describe, expect, it } from 'vitest'
import { buildRunGpx, runTimes } from './runGpx'

/**
 * Les heures d'une sortie, retrouvées par ses tours de kilomètre.
 *
 * Strava refuse un GPX sans heures, et une heure fausse y fausse l'allure de
 * chaque kilomètre — la première chose qu'on y lit.
 */

// Une ligne droite de 2,5 km vers l'est, un point tous les 10 m environ.
const pas = 10 / (111_320 * Math.cos((48.85 * Math.PI) / 180))
const TRACE = Array.from({ length: 251 }, (_, i) => [2.3 + i * pas, 48.85])

const SORTIE = {
  name: 'Boucle <test> & co',
  sport: 'run',
  ranAt: '2026-09-30T08:00:00.000Z',
  actual_distance_m: 2500,
  actual_duration_s: 900,
  paused_s: 60,
  splits: [
    { km: 1, seconds: 330 },
    { km: 2, seconds: 390 },
  ],
  track: TRACE,
}

const secondes = (ms, debut) => Math.round((ms - debut) / 1000)

describe('les heures d’une sortie', () => {
  const temps = runTimes(TRACE, SORTIE)
  const debut = Date.parse(SORTIE.ranAt) - (900 + 60) * 1000

  it('part à l’heure du départ, pauses comprises', () => {
    expect(temps[0]).toBe(debut)
  })

  it('avance toujours', () => {
    expect(temps.every((t, i) => i === 0 || t >= temps[i - 1])).toBe(true)
  })

  it('donne à chaque kilomètre le temps qu’il a pris', () => {
    expect(secondes(temps[100], debut)).toBe(330)
    expect(secondes(temps[200], debut)).toBe(720)
  })

  it('finit au bout du temps en mouvement', () => {
    expect(secondes(temps[250], debut)).toBe(900)
  })

  it('se passe de tours, à allure régulière', () => {
    const sans = runTimes(TRACE, { ...SORTIE, splits: null })
    expect(secondes(sans[125], debut)).toBe(450)
  })
})

describe('le fichier', () => {
  const gpx = buildRunGpx(SORTIE)

  it('porte une heure sur chaque point', () => {
    expect(gpx.match(/<trkpt /g)).toHaveLength(TRACE.length)
    expect(gpx.match(/<time>/g)).toHaveLength(TRACE.length + 1)
  })

  it('dit le sport, et échappe le nom', () => {
    expect(gpx).toContain('<type>running</type>')
    expect(gpx).toContain('Boucle &lt;test&gt; &amp; co')
  })

  it('garde l’attribution OpenStreetMap', () => {
    expect(gpx).toContain('openstreetmap.org/copyright')
  })
})
