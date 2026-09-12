import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * Le service worker, éprouvé hors du navigateur.
 *
 * C'est le seul morceau de l'app qu'on ne peut pas voir échouer en le
 * regardant. Il ne s'installe qu'en production, ses décisions se prennent
 * pendant une coupure — donc précisément quand il n'y a ni console ouverte ni
 * outil réseau pour observer — et les requêtes qu'il intercepte le plus, celles
 * des tuiles, partent d'un worker de MapLibre qu'aucun journal de la page ne
 * montre. Un bug ici ne se découvre qu'en forêt, sans réseau, au moment où la
 * carte devait servir.
 *
 * On le charge donc tel quel, dans un faux `self`, et on le met en situation.
 */

const CODE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')

/** Une réponse minimale, reconnaissable à son étiquette. */
const reponse = (etiquette, { ok = true, status = 200 } = {}) => ({
  etiquette,
  ok,
  status,
  clone: () => reponse(etiquette, { ok, status }),
})

const ORIGINE = 'https://lacet.app'

/**
 * Un cache nommé, avec ce qu'il contient déjà.
 *
 * Les clés sont résolues contre l'origine, comme le fait le vrai `Cache` : le
 * service worker cherche la coquille sous `'/'`, une adresse relative, là où
 * elle a été rangée sous son adresse complète. Un faux cache qui comparerait
 * les chaînes telles quelles ferait échouer un code pourtant juste.
 */
function faireCache(contenu = {}) {
  const cle = (k) => new URL(typeof k === 'string' ? k : k.url, ORIGINE).href
  const store = new Map(Object.entries(contenu).map(([k, v]) => [cle(k), v]))
  return {
    store,
    match: async (k) => store.get(cle(k)),
    put: async (k, v) => store.set(cle(k), v),
    add: async (k) => store.set(cle(k), reponse(`shell:${k}`)),
    delete: async (k) => store.delete(cle(k)),
  }
}

/**
 * Monte le service worker dans un environnement simulé et rend de quoi le
 * piloter : ses écouteurs, ses caches, et le réseau qu'on lui donne.
 */
function monter({ caches: initiaux = {}, reseau } = {}) {
  const caches = {}
  for (const [nom, contenu] of Object.entries(initiaux)) caches[nom] = faireCache(contenu)

  const ecouteurs = {}
  const self = {
    addEventListener: (type, fn) => {
      ecouteurs[type] = fn
    },
    location: { origin: ORIGINE },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }

  const api = {
    open: async (nom) => (caches[nom] = caches[nom] || faireCache()),
    keys: async () => Object.keys(caches),
    delete: async (nom) => delete caches[nom],
  }

  const fetch = reseau || (async () => reponse('réseau'))
  const Response = { error: () => reponse('erreur-réseau', { ok: false, status: 0 }) }

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', CODE)(
    self,
    api,
    fetch,
    Response,
    URL,
  )

  return { ecouteurs, caches, api }
}

/** Fait passer une requête par l'écouteur `fetch` et rend ce qui en sort. */
async function demander(sw, request) {
  let promesse = null
  sw.ecouteurs.fetch({ request, respondWith: (p) => (promesse = p) })
  return promesse === null ? null : promesse
}

const requete = (url, extra = {}) => ({ url, method: 'GET', mode: 'cors', ...extra })

const TUILE = 'https://tiles.basemaps.cartocdn.com/vector/v1/14/8296/5626.mvt'
const TUILE_C = 'https://tiles-c.basemaps.cartocdn.com/vector/v1/14/8296/5626.mvt'

const coupure = async () => {
  throw new TypeError('Failed to fetch')
}

let sw

describe('les cartes mises de côté', () => {
  beforeEach(() => {
    sw = monter({
      caches: { 'lacet-maps-v1': { [TUILE]: reponse('tuile-gardée') } },
      reseau: coupure,
    })
  })

  it('servent quand le réseau est coupé', async () => {
    const r = await demander(sw, requete(TUILE))
    expect(r.etiquette).toBe('tuile-gardée')
  })

  it('servent quel que soit le sous-domaine demandé', async () => {
    // Les quatre sous-domaines sont équivalents et MapLibre en tire un au sort
    // par tuile. Sans normalisation, trois tuiles sur quatre seraient
    // introuvables — une carte en damier, et personne pour comprendre pourquoi.
    const r = await demander(sw, requete(TUILE_C))
    expect(r.etiquette).toBe('tuile-gardée')
  })

  it('ne prétendent pas avoir ce qu’elles n’ont pas', async () => {
    const r = await demander(sw, requete('https://tiles.basemaps.cartocdn.com/autre.mvt'))
    expect(r.ok).toBe(false)
  })
})

describe('quand la couverture faiblit sans couper', () => {
  it('préfère la copie gardée à une erreur de passerelle', async () => {
    // Un relais saturé ou un portail wifi ne coupe pas franchement : il répond
    // 502. Ne se rabattre que sur le rejet laissait des trous dans une carte
    // pourtant entièrement présente sur l'appareil.
    sw = monter({
      caches: { 'lacet-maps-v1': { [TUILE]: reponse('tuile-gardée') } },
      reseau: async () => reponse('502', { ok: false, status: 502 }),
    })
    const r = await demander(sw, requete(TUILE_C))
    expect(r.etiquette).toBe('tuile-gardée')
  })

  it('laisse passer l’erreur s’il n’y a rien en réserve', async () => {
    sw = monter({
      caches: { 'lacet-maps-v1': {} },
      reseau: async () => reponse('404', { ok: false, status: 404 }),
    })
    const r = await demander(sw, requete(TUILE))
    expect(r.status).toBe(404)
  })
})

describe('le réseau reste prioritaire', () => {
  it('sert la réponse en ligne plutôt que la copie', async () => {
    // Une app de cartographie qui sert du vieux contenu est pire qu'une app qui
    // ne se charge pas : on ne veut pas d'un itinéraire calculé avec une
    // version périmée du moteur.
    sw = monter({
      caches: { 'lacet-maps-v1': { [TUILE]: reponse('tuile-gardée') } },
      reseau: async () => reponse('tuile-fraîche'),
    })
    const r = await demander(sw, requete(TUILE))
    expect(r.etiquette).toBe('tuile-fraîche')
  })
})

describe('ce que le service worker ne touche pas', () => {
  beforeEach(() => {
    sw = monter({ reseau: coupure })
  })

  it('laisse l’API tranquille', async () => {
    // Rejouer un itinéraire depuis un cache donnerait une réponse fausse sans
    // le dire : elle dépend de données OpenStreetMap et d'un point de départ.
    expect(await demander(sw, requete('https://lacet.app/api/loops'))).toBe(null)
  })

  it('laisse passer ce qui n’est pas une lecture', async () => {
    expect(await demander(sw, requete('https://lacet.app/x', { method: 'POST' }))).toBe(null)
  })
})

describe('l’app elle-même', () => {
  it('s’ouvre hors ligne depuis la coquille', async () => {
    sw = monter({
      caches: { 'lacet-shell-v2': { 'https://lacet.app/': reponse('coquille') } },
      reseau: coupure,
    })
    const r = await demander(sw, requete('https://lacet.app/', { mode: 'navigate' }))
    expect(r.etiquette).toBe('coquille')
  })

  it('ramène une route inconnue vers la page unique', async () => {
    // L'app est une page unique : toutes les routes mènent à la même. Sans ce
    // repli, rouvrir un onglet sur /parcours donnait une page blanche.
    sw = monter({
      caches: { 'lacet-shell-v2': { 'https://lacet.app/': reponse('coquille') } },
      reseau: coupure,
    })
    const r = await demander(sw, requete('https://lacet.app/parcours', { mode: 'navigate' }))
    expect(r.etiquette).toBe('coquille')
  })

  it('explique la coupure plutôt que de laisser l’écran du navigateur', async () => {
    // Dernier recours : une page qui parle de réseau, et non de DNS à quelqu'un
    // parti courir.
    sw = monter({
      caches: { 'lacet-shell-v2': { 'https://lacet.app/offline.html': reponse('page-hors-ligne') } },
      reseau: coupure,
    })
    const r = await demander(sw, requete('https://lacet.app/parcours', { mode: 'navigate' }))
    expect(r.etiquette).toBe('page-hors-ligne')
  })
})

describe('les mises à jour de l’app', () => {
  it('ne balayent jamais les cartes téléchargées', async () => {
    // Elles se comptent en dizaines de mégaoctets. Les reprendre à chaque mise
    // à jour tomberait précisément au moment où l'on n'a pas de réseau.
    sw = monter({
      caches: {
        'lacet-shell-v1': { a: reponse('vieux') },
        'lacet-shell-v2': {},
        'lacet-maps-v1': { [TUILE]: reponse('tuile-gardée') },
      },
    })
    const attendus = []
    sw.ecouteurs.activate({ waitUntil: (p) => attendus.push(p) })
    await Promise.all(attendus)

    expect(await sw.api.keys()).toEqual(
      expect.arrayContaining(['lacet-shell-v2', 'lacet-maps-v1']),
    )
    expect(await sw.api.keys()).not.toContain('lacet-shell-v1')
  })

  it('met la page de repli en réserve dès l’installation', async () => {
    // Elle ne sert que hors ligne : si on attendait de la rencontrer pour la
    // garder, elle ne serait jamais là au moment utile.
    sw = monter({ caches: {} })
    const attendus = []
    sw.ecouteurs.install({ waitUntil: (p) => attendus.push(p) })
    await Promise.all(attendus)

    const coquille = await sw.api.open('lacet-shell-v2')
    expect(await coquille.match('/offline.html')).toBeTruthy()
    expect(await coquille.match('/')).toBeTruthy()
  })
})

describe('la page de repli', () => {
  const PAGE = readFileSync(
    fileURLToPath(new URL('../public/offline.html', import.meta.url)),
    'utf8',
  )

  it('ne dépend d’aucun fichier extérieur', () => {
    // Elle s'affiche précisément quand plus rien ne peut être téléchargé : une
    // feuille de style, une police ou un logo référencés la laisseraient nue.
    expect(PAGE).not.toMatch(/<link[^>]+href=|<script[^>]+src=|<img/i)
  })

  it('porte le même logo que l’app', () => {
    // Le logo est recopié dans la page plutôt que lié, pour la même raison. Le
    // prix de cette copie est qu'elle peut se périmer sans bruit : le jour où
    // l'icône change, la page de secours garderait l'ancienne — et c'est la
    // seule page où personne ne va vérifier.
    const icone = readFileSync(
      fileURLToPath(new URL('../public/icon.svg', import.meta.url)),
      'utf8',
    )
    for (const forme of icone.match(/<(rect|circle)[^>]*>/g) || []) {
      const attributs = forme.match(/(fill|stroke|r|cx|cy)="[^"]*"/g) || []
      for (const a of attributs) expect(PAGE).toContain(a)
    }
  })
})
