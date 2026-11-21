import { describe, expect, it } from 'vitest'
import { reportFilename, runReport } from './runReport'

/**
 * Le rapport de sortie : la sortie entière, l'appareil et les réglages — mais
 * pas l'historique, déjà dans la sortie et trop lourd à envoyer.
 */

function storageOf(entries) {
  const keys = Object.keys(entries)
  return { length: keys.length, key: (i) => keys[i], getItem: (k) => entries[k] ?? null }
}

describe('runReport', () => {
  const entry = { name: 'Boucle du Bollenberg', ranAt: '2026-11-21T09:30:00.000Z', diag: { fixes: 12, rejected: 1 } }

  it('garde la sortie, l’appareil et les réglages, sans l’historique', () => {
    const env = {
      navigator: { userAgent: 'iPhone', language: 'fr-FR' },
      screen: { width: 390, height: 844 },
      devicePixelRatio: 3,
      localStorage: storageOf({ 'lacet.v1': '{"history":[]}', 'lacet.voice': '{"rate":"normal"}' }),
    }
    const report = JSON.parse(runReport(entry, { app: { version: '1.1.9' }, now: new Date(0), env }))
    expect(report.run.diag.fixes).toBe(12)
    expect(report.app.version).toBe('1.1.9')
    expect(report.device.screen).toEqual([390, 844])
    expect(report.settings).toEqual({ 'lacet.voice': '{"rate":"normal"}' })
  })

  it('un stockage refusé n’empêche pas le rapport', () => {
    const env = { localStorage: { get length() { throw new Error('refusé') } } }
    expect(JSON.parse(runReport(entry, { env })).settings).toEqual({})
  })

  it('nomme le fichier d’après l’heure de la sortie', () => {
    expect(reportFilename(entry)).toBe('lacet-rapport-2026-11-21T09h30.json')
  })
})
