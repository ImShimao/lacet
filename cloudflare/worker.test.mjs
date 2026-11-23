/**
 * Ce que le relais promet à l'app : des plages d'octets exactes, rien d'autre
 * que les archives, et un vent demandé une seule fois par kilomètre carré.
 * Lancer : node --test cloudflare/worker.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from './worker.js'

const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i))

/** Un faux R2 : un seul fichier, `4_97.lct`. */
const packs = {
  async get(name, { range }) {
    if (name !== '4_97.lct') return null
    const wanted = /bytes=(\d+)-(\d+)/.exec(range.get('Range') ?? '')
    const [offset, end] = wanted ? [Number(wanted[1]), Number(wanted[2])] : [0, BYTES.length - 1]
    return {
      size: BYTES.length,
      httpEtag: '"v1"',
      range: { offset, length: end - offset + 1 },
      body: BYTES.slice(offset, end + 1),
      writeHttpMetadata: (h) => h.set('Content-Type', 'application/octet-stream'),
    }
  },
}

const memoryCache = () => {
  const store = new Map()
  return { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) }
}
const ctx = { waitUntil: () => {} }

test('rend exactement la plage demandée, en 206', async () => {
  const res = await worker.fetch(new Request('https://x/packs/4_97.lct', { headers: { Range: 'bytes=10-19' } }), { PACKS: packs }, ctx)
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('Content-Range'), 'bytes 10-19/100')
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
})

test("ne sert rien d'autre que les archives", async () => {
  for (const path of ['/packs/..%2Fsecret', '/packs/a/b.lct', '/packs/.env', '/autre']) {
    const res = await worker.fetch(new Request(`https://x${path}`), { PACKS: packs }, ctx)
    assert.equal(res.status, 404, path)
  }
})

test('le vent : km/h, direction, et une seule question à MET Norway par kilomètre', async () => {
  const calls = []
  const met = async (url, init) => {
    calls.push({ url, agent: init.headers['User-Agent'] })
    return new Response(JSON.stringify({ properties: { timeseries: [{ data: { instant: { details: { wind_speed: 5, wind_from_direction: 270 } } } }] } }), {
      headers: { Expires: new Date(Date.now() + 600_000).toUTCString() },
    })
  }
  const env = { PACKS: packs, CACHE: memoryCache(), FETCH: met }
  const first = await (await worker.fetch(new Request('https://x/wind?lat=47.9012&lon=7.2109'), env, { waitUntil: (p) => p })).json()
  assert.deepEqual(first, { speed_kmh: 18, from_deg: 270 })
  await new Promise((r) => setTimeout(r, 0))
  await worker.fetch(new Request('https://x/wind?lat=47.9049&lon=7.2061'), env, ctx)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /lat=47\.90&lon=7\.21$/)
  assert.match(calls[0].agent, /^Lacet\//)
})

test('refuse une position absurde', async () => {
  const res = await worker.fetch(new Request('https://x/wind?lat=abc&lon=7'), { PACKS: packs, CACHE: memoryCache() }, ctx)
  assert.equal(res.status, 400)
})
