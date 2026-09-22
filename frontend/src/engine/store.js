// Un petit magasin clé → valeur, persistant quand c'est possible.
//
// IndexedDB dans le navigateur et dans l'app iPhone — c'est là que vivent les
// extraits OpenStreetMap et les altitudes déjà téléchargés, qui se comptent en
// dizaines de mégaoctets et doivent survivre à la fermeture de l'app. En mémoire
// ailleurs, pour que le moteur tourne tel quel dans les tests.
//
// Les cartes gardées hors ligne de l'app iPhone y vivent aussi (`maps`) : voir
// `offlineMaps.js` pour la raison.
//
// Chaque opération est protégée : un stockage refusé (navigation privée,
// quota plein) doit dégrader le cache, jamais empêcher de calculer un itinéraire.

const DB_NAME = 'lacet-engine'
const DB_VERSION = 2
const STORES = ['osm', 'elevation', 'maps']

let dbPromise = null

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
        }
      }
      request.onsuccess = () => {
        // Une version plus récente de la base demande la main (une mise à jour
        // de l'app ouverte à côté) : on la lui rend. Garder la connexion
        // bloquerait sa mise à niveau, et son cache retomberait en mémoire.
        request.result.onversionchange = () => {
          request.result.close()
          dbPromise = null
        }
        resolve(request.result)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run(db, name, mode, action) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, mode)
      const request = action(tx.objectStore(name))
      tx.oncomplete = () => resolve(request?.result)
      tx.onerror = () => resolve(undefined)
      tx.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

// Le repli en mémoire, un par magasin et non par appel : deux modules qui
// ouvrent `store('osm')` doivent voir les mêmes données, comme ils le feraient
// avec IndexedDB. Sans ça, le cache des rues et son journal vivaient chacun
// dans leur coin dès qu'IndexedDB manquait — un test, un navigateur verrouillé.
const fallbacks = new Map()

export function store(name) {
  if (!fallbacks.has(name)) fallbacks.set(name, new Map())
  const memory = fallbacks.get(name)
  return {
    async get(key) {
      const db = await openDb()
      if (!db) return memory.get(key)
      return run(db, name, 'readonly', (s) => s.get(key))
    },
    async set(key, value) {
      const db = await openDb()
      if (!db) {
        memory.set(key, value)
        return
      }
      await run(db, name, 'readwrite', (s) => s.put(value, key))
    },
    async delete(key) {
      const db = await openDb()
      if (!db) {
        memory.delete(key)
        return
      }
      await run(db, name, 'readwrite', (s) => s.delete(key))
    },
    async keys() {
      const db = await openDb()
      if (!db) return [...memory.keys()]
      return (await run(db, name, 'readonly', (s) => s.getAllKeys())) ?? []
    },
    async clear() {
      const db = await openDb()
      if (!db) {
        memory.clear()
        return
      }
      await run(db, name, 'readwrite', (s) => s.clear())
    },
  }
}
