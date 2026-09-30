import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REDIRECT_URI, authorizeUrl, externalId, handleUrl, parseCallback, status, upload } from './strava'

/**
 * L'envoi vers Strava, sans Strava : on joue ses réponses.
 *
 * Deux choses ne se voient pas en l'essayant une fois chez soi : qu'une adresse
 * `lacet://` venue d'ailleurs ne rattache pas l'app à un autre compte, et
 * qu'une sortie déjà envoyée ne se présente pas comme une panne.
 */

let disque
beforeEach(() => {
  disque = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (disque.has(k) ? disque.get(k) : null),
    setItem: (k, v) => disque.set(k, String(v)),
    removeItem: (k) => disque.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

/** Une réponse de Strava. */
const reponse = (corps, status = 200) => ({ ok: status < 400, status, json: async () => corps })

const JETONS = {
  access_token: 'acces',
  refresh_token: 'renouvellement',
  expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
  athlete: { id: 7, firstname: 'Camille', lastname: 'Martin' },
}

const retour = (params) => `${REDIRECT_URI}?${new URLSearchParams(params)}`

describe('la connexion', () => {
  it('demande le droit d’envoyer des activités, et revient dans l’app', () => {
    const url = new URL(authorizeUrl('abc'))
    expect(url.pathname).toBe('/oauth/mobile/authorize')
    expect(url.searchParams.get('scope')).toBe('activity:write')
    expect(url.searchParams.get('redirect_uri')).toBe('lacet://localhost/strava')
    expect(authorizeUrl('abc', 'strava://')).toMatch(/^strava:\/\/oauth\/mobile\/authorize\?/)
  })

  it('ne lit que les adresses qui reviennent de Strava', () => {
    expect(parseCallback('lacet://localhost/')).toBeNull()
    expect(parseCallback('https://exemple.fr/strava')).toBeNull()
    expect(parseCallback(retour({ code: 'c', state: 's', scope: 'read,activity:write' }))).toMatchObject({ code: 'c', state: 's' })
  })

  it('se connecte quand le retour est celui qu’on attendait', async () => {
    localStorage.setItem('lacet-strava-state', 's1')
    const http = vi.fn(async () => reponse(JETONS))
    await expect(handleUrl(retour({ code: 'c', state: 's1', scope: 'read,activity:write' }), http)).resolves.toBe(true)
    expect(http.mock.calls[0][1].body.get('grant_type')).toBe('authorization_code')
    expect(status()).toMatchObject({ connected: true, athlete: { name: 'Camille Martin' }, auto: true })
  })

  it('refuse un retour qu’on n’a pas demandé', async () => {
    localStorage.setItem('lacet-strava-state', 's1')
    const http = vi.fn()
    await expect(handleUrl(retour({ code: 'c', state: 'autre', scope: 'activity:write' }), http)).rejects.toThrow(/inattendue/)
    expect(http).not.toHaveBeenCalled()
    expect(status().connected).toBe(false)
  })

  it('dit ce qui manque quand l’envoi n’a pas été autorisé', async () => {
    localStorage.setItem('lacet-strava-state', 's1')
    await expect(handleUrl(retour({ code: 'c', state: 's1', scope: 'read' }), vi.fn())).rejects.toThrow(/téléverser/)
  })
})

describe('l’envoi', () => {
  const SORTIE = {
    name: 'Boucle nord',
    ranAt: '2026-09-30T08:00:00.000Z',
    actual_distance_m: 20,
    actual_duration_s: 10,
    track: [
      [2.3, 48.85],
      [2.3002, 48.85],
    ],
    safety: { grade: 'A' },
  }

  const connecte = (jetons = {}) =>
    localStorage.setItem('lacet-strava', JSON.stringify({ ...JETONS, athlete: { id: 7, name: 'C' }, ...jetons }))

  it('envoie le GPX, attend le verdict, et rend l’activité', async () => {
    connecte()
    const http = vi
      .fn()
      .mockResolvedValueOnce(reponse({ id_str: '99', activity_id: null, error: null }, 201))
      .mockResolvedValueOnce(reponse({ id_str: '99', activity_id: null, error: null }))
      .mockResolvedValueOnce(reponse({ id_str: '99', activity_id: 1234, error: null }))
    const wait = vi.fn(async () => {})
    await expect(upload(SORTIE, { http, wait })).resolves.toEqual({ activityId: 1234 })

    const [url, requete] = http.mock.calls[0]
    expect(url).toBe('https://www.strava.com/api/v3/uploads')
    expect(requete.headers.Authorization).toBe('Bearer acces')
    expect(requete.body.get('data_type')).toBe('gpx')
    expect(requete.body.get('external_id')).toBe(externalId(SORTIE))
    expect(requete.body.get('description')).toMatch(/note de sécurité A/)
    expect(http.mock.calls[2][0]).toBe('https://www.strava.com/api/v3/uploads/99')
  })

  it('reconnaît une sortie déjà envoyée', async () => {
    connecte()
    const http = vi.fn().mockResolvedValueOnce(
      reponse({ id_str: '5', error: 'sortie.gpx duplicate of <a href=\'/activities/777\'>Boucle nord</a>' }, 201),
    )
    await expect(upload(SORTIE, { http, wait: async () => {} })).rejects.toMatchObject({ duplicate: 777 })
  })

  it('renouvelle un jeton qui expire avant d’envoyer', async () => {
    connecte({ expires_at: Math.floor(Date.now() / 1000) + 60 })
    const http = vi
      .fn()
      .mockResolvedValueOnce(reponse({ ...JETONS, access_token: 'neuf' }))
      .mockResolvedValueOnce(reponse({ id_str: '1', activity_id: 42 }, 201))
    await upload(SORTIE, { http, wait: async () => {} })
    expect(http.mock.calls[0][1].body.get('grant_type')).toBe('refresh_token')
    expect(http.mock.calls[1][1].headers.Authorization).toBe('Bearer neuf')
  })

  it('ne tente rien sans trace', async () => {
    connecte()
    const http = vi.fn()
    await expect(upload({ ...SORTIE, track: null }, { http })).rejects.toThrow(/trace/)
    expect(http).not.toHaveBeenCalled()
  })
})
