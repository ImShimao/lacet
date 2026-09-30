// Envoyer ses sorties sur Strava, directement.
//
// **Pourquoi pas par Apple Santé ?** Strava ne reprend de Santé que les séances
// de l'app Exercice d'Apple : celles d'une autre app n'y passent jamais. Et un
// fichier GPX partagé ne sert à rien non plus : l'app Strava sur iPhone n'en
// importe pas, seul le site le fait. Il reste l'API de Strava — celle qu'utilisent
// les montres.
//
// **Sans serveur.** Strava demande le secret de l'application pour échanger le
// code d'autorisation contre des jetons. Il est donc dans l'app, fourni à la
// compilation (`VITE_STRAVA_CLIENT_ID`, `VITE_STRAVA_CLIENT_SECRET`, secrets du
// dépôt). C'est acceptable ici, et seulement ici : une application Strava
// fraîchement créée n'accepte qu'un seul athlète — son créateur —, et l'IPA
// n'est installée que sur son téléphone.
//
// Les jetons restent sur l'appareil, à part des autres données : la sauvegarde
// de « Mon compte » ne les emporte pas, un fichier qu'on s'envoie par mail n'a
// pas à ouvrir un compte Strava.

import { buildRunGpx } from './runGpx'

const CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || ''
const CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET || ''

// `localhost` est toujours accepté par Strava comme domaine de retour, quel que
// soit celui déclaré ; `lacet://` est le schéma de l'app (voir customize.py).
export const REDIRECT_URI = 'lacet://localhost/strava'
const AUTHORIZE = 'oauth/mobile/authorize'
const TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token'
const API = 'https://www.strava.com/api/v3'
const KEY = 'lacet-strava'
const STATE_KEY = 'lacet-strava-state'

// Un jeton qui expire dans moins de cinq minutes est renouvelé avant l'envoi :
// l'envoi et son suivi prennent quelques secondes, et un 401 au milieu
// laisserait une sortie à moitié partie.
const REFRESH_MARGIN_S = 300
// Strava traite le fichier après l'avoir reçu ; on attend son verdict un moment.
const POLL_MS = 2000
const POLL_TRIES = 15

/** L'app a-t-elle été compilée avec une application Strava ? */
export const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET)

// --- les jetons, sur l'appareil ------------------------------------------------

const listeners = new Set()
// Le dernier échec de connexion : le retour de Strava arrive hors de tout
// écran, et « Mon compte » doit pouvoir le dire en rouvrant.
let lastError = null

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function write(value) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value))
    else localStorage.removeItem(KEY)
  } catch {
    /* stockage refusé : la connexion ne survivra pas au lancement suivant */
  }
  for (const fn of listeners) fn(status())
}

/** Ce que l'écran peut montrer : connecté ou non, à quel nom, envoi automatique. */
export function status() {
  const saved = read()
  return {
    configured: configured(),
    connected: Boolean(saved?.refresh_token),
    athlete: saved?.athlete ?? null,
    auto: Boolean(saved?.auto),
    error: lastError,
  }
}

/** Prévient à chaque changement ; rend de quoi se désabonner. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Envoyer chaque sortie dès qu'elle se termine. */
export function setAuto(auto) {
  const saved = read()
  if (saved) write({ ...saved, auto: Boolean(auto) })
}

// --- la connexion ---------------------------------------------------------------

/** L'adresse d'autorisation, dans l'app Strava (`strava://`) ou sur le site. */
export function authorizeUrl(state, base = 'https://www.strava.com/') {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:write',
    state,
  })
  return `${base}${AUTHORIZE}?${query}`
}

/**
 * Part chez Strava pour autoriser l'app. L'app Strava d'abord — pas de mot de
 * passe à retaper —, le site sinon. Le retour arrive par `lacet://`, dans
 * `handleUrl`.
 */
export async function connect() {
  if (!configured()) throw new Error("Cette version de l'app n'a pas été compilée avec une application Strava.")
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  try {
    localStorage.setItem(STATE_KEY, state)
  } catch {
    /* sans stockage, le retour sera refusé faute de pouvoir le vérifier */
  }
  const { openExternal } = await import('./native')
  const opened = await openExternal(authorizeUrl(state, 'strava://')).catch(() => null)
  if (!opened?.completed) await openExternal(authorizeUrl(state))
}

/** Le retour d'autorisation, lu dans l'adresse `lacet://localhost/strava?…`. */
export function parseCallback(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'lacet:' || !parsed.pathname.startsWith('/strava')) return null
  const q = parsed.searchParams
  return { code: q.get('code'), scope: q.get('scope') || '', state: q.get('state'), error: q.get('error') }
}

/**
 * Traite une adresse ouverte par iOS. Rend `true` si elle venait de Strava.
 *
 * Le `state` doit être celui qu'on a envoyé : une adresse `lacet://` peut être
 * ouverte par n'importe quelle page, et ne doit pas pouvoir rattacher l'app à
 * un autre compte.
 */
export async function handleUrl(url, http = fetch) {
  const back = parseCallback(url)
  if (!back) return false
  let expected = null
  try {
    expected = localStorage.getItem(STATE_KEY)
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* rien à comparer : refusé ci-dessous */
  }
  if (back.error || !back.code) throw new StravaError('Connexion à Strava annulée.')
  if (!expected || back.state !== expected) throw new StravaError('Réponse de Strava inattendue : reconnecte-toi depuis « Mon compte ».')
  if (!back.scope.split(',').includes('activity:write')) {
    throw new StravaError('Il faut autoriser Lacet à « téléverser des activités » pour envoyer tes sorties.')
  }
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code: back.code }, http)
  write({ ...pick(tokens), athlete: athleteOf(tokens.athlete), auto: read()?.auto ?? true })
  return true
}

/**
 * Écoute les adresses `lacet://` que iOS ouvre — y compris celle qui a lancé
 * l'app, si elle avait été fermée pendant l'autorisation. À appeler une fois,
 * au démarrage de l'app.
 */
export async function listen() {
  const { launchUrl, onAppUrl } = await import('./native')
  // Au lancement par l'adresse, iOS la donne deux fois — comme adresse de
  // lancement et comme adresse ouverte. Le second passage trouverait le
  // `state` déjà consommé, et afficherait une erreur sur une connexion réussie.
  const seen = new Set()
  const take = async (url) => {
    if (seen.has(url)) return
    seen.add(url)
    try {
      if (await handleUrl(url)) lastError = null
    } catch (error) {
      lastError = error.message
    }
    for (const fn of listeners) fn(status())
  }
  onAppUrl(take)
  const first = await launchUrl()
  if (first) take(first)
}

/** Déconnecte l'app de Strava, là-bas et ici. */
export async function disconnect(http = fetch) {
  const saved = read()
  write(null)
  if (!saved?.access_token) return
  try {
    await http('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${saved.access_token}` },
    })
  } catch {
    /* hors ligne : l'accès restera listé chez Strava, où il se retire à la main */
  }
}

export class StravaError extends Error {
  constructor(message, { duplicate = null } = {}) {
    super(message)
    this.name = 'StravaError'
    this.duplicate = duplicate
  }
}

const pick = (t) => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at })
const athleteOf = (a) => (a ? { id: a.id, name: [a.firstname, a.lastname].filter(Boolean).join(' ') } : null)

async function tokenRequest(fields, http) {
  let response
  try {
    response = await http(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...fields }),
    })
  } catch {
    throw new StravaError('Strava ne répond pas : vérifie le réseau.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    if (response.status === 400 || response.status === 401) write(null)
    throw new StravaError(`Strava a refusé la connexion (${body.message || response.status}).`)
  }
  return body
}

/** Un jeton valable, renouvelé s'il expire bientôt. */
async function accessToken(http, now = Date.now()) {
  const saved = read()
  if (!saved?.refresh_token) throw new StravaError('Lacet n’est pas connecté à Strava.')
  if (saved.expires_at - now / 1000 > REFRESH_MARGIN_S) return saved.access_token
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh_token }, http)
  write({ ...saved, ...pick(tokens) })
  return tokens.access_token
}

// --- l'envoi ------------------------------------------------------------------------

/** L'identifiant de la sortie chez Strava, qui refuse d'en recevoir deux fois une même. */
export const externalId = (entry) => `lacet-${Date.parse(entry.ranAt) || entry.id}`

/** La phrase sous l'activité : ce que Lacet sait du parcours. */
function description(entry) {
  if (entry.free) return 'Sortie libre, enregistrée avec Lacet.'
  const grade = entry.safety?.grade ?? entry.grade
  return grade ? `Boucle Lacet, note de sécurité ${grade}.` : 'Boucle calculée par Lacet.'
}

/**
 * Envoie une sortie terminée. Rend `{ activityId }`.
 *
 * Une sortie déjà envoyée n'est pas une erreur à montrer comme telle : Strava
 * la reconnaît, et l'on rend l'activité qui existe déjà.
 */
export async function upload(entry, { http = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!(entry.track?.length > 1)) throw new StravaError('Cette sortie n’a pas de trace GPS à envoyer.')
  const token = await accessToken(http)
  const form = new FormData()
  form.append('file', new Blob([buildRunGpx(entry)], { type: 'application/gpx+xml' }), 'sortie.gpx')
  form.append('data_type', 'gpx')
  form.append('name', entry.name || 'Sortie')
  form.append('description', description(entry))
  form.append('external_id', externalId(entry))

  let response
  try {
    response = await http(`${API}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  } catch {
    throw new StravaError('Pas de réseau : la sortie partira quand tu le demanderas à nouveau.')
  }
  let upload = await response.json().catch(() => ({}))
  if (!response.ok) throw failure(upload, response.status)

  for (let i = 0; i < POLL_TRIES && !upload.activity_id && !upload.error; i += 1) {
    await wait(POLL_MS)
    const next = await http(`${API}/uploads/${upload.id_str ?? upload.id}`, { headers: { Authorization: `Bearer ${token}` } })
    upload = await next.json().catch(() => upload)
  }
  if (upload.activity_id) return { activityId: upload.activity_id }
  if (upload.error) throw failure(upload)
  throw new StravaError('Strava traite encore la sortie : elle apparaîtra dans un instant.')
}

function failure(body, status) {
  const text = String(body?.error || body?.message || '')
  const duplicate = text.match(/activities\/(\d+)/)?.[1] ?? null
  if (/duplicate/i.test(text)) return new StravaError('Cette sortie est déjà sur Strava.', { duplicate: duplicate ? Number(duplicate) : true })
  if (status === 401) return new StravaError('Strava a refusé l’accès : reconnecte-toi depuis « Mon compte ».')
  return new StravaError(`Strava a refusé la sortie${text ? ` : ${text}` : '.'}`)
}

/** L'adresse de l'activité, pour l'ouvrir dans l'app Strava ou le navigateur. */
export const activityUrl = (id) => `https://www.strava.com/activities/${id}`
