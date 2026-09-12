/* Service worker de Lacet — pour que l'app s'ouvre sans réseau.
 *
 * C'est une app qu'on utilise dehors, souvent en périphérie, parfois en forêt.
 * Sans ce fichier, rouvrir l'onglet à mi-parcours dans une zone sans couverture
 * donne une page blanche : la sortie en cours est perdue, le tracé aussi. Or
 * tout ce dont le suivi a besoin — le GPS, le chronomètre, les consignes déjà
 * téléchargées — fonctionne parfaitement hors ligne.
 *
 * Trois règles, et leurs raisons :
 *
 * **Réseau d'abord, cache en secours.** Une app de cartographie qui sert du
 * vieux contenu est pire qu'une app qui ne se charge pas : on ne veut pas d'un
 * itinéraire calculé avec une version périmée du moteur. Tant qu'il y a du
 * réseau, c'est lui qui gagne, et la réponse remplace la copie gardée.
 *
 * **Rien de ce qui vient de l'API n'est gardé.** Un itinéraire dépend de
 * données OpenStreetMap et d'un point de départ ; le rejouer depuis un cache
 * donnerait une réponse fausse sans le dire. Les parcours qu'on veut retrouver
 * hors ligne sont déjà dans les favoris, en stockage local.
 *
 * **Les cartes ne sont gardées que sur demande.** Mettre en cache toutes les
 * tuiles vues remplirait des centaines de mégaoctets à l'insu de tout le monde.
 * C'est donc l'app qui remplit `MAPS`, parcours par parcours, quand on le lui
 * demande ; le service worker se contente d'y puiser quand le réseau manque.
 */

const SHELL_CACHE = 'lacet-shell-v2'

// Les cartes mises de côté vivent dans leur propre cache : elles se comptent en
// mégaoctets et ne doivent surtout pas être balayées à chaque mise à jour de
// l'app, contrairement à la coquille.
const MAPS_CACHE = 'lacet-maps-v1'

// Le strict nécessaire pour que l'app démarre. Le reste — les fichiers JS et
// CSS, dont le nom porte une empreinte — se met en cache tout seul au premier
// passage, ce qui évite d'avoir à tenir une liste que le build fait varier.
const SHELL = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `addAll` échoue en bloc si un seul fichier manque : on préfère mettre en
      // cache ce qui existe plutôt que de laisser l'installation échouer entière.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Seules les anciennes coquilles sont balayées. Effacer les cartes
            // téléchargées à chaque mise à jour de l'app obligerait à tout
            // reprendre — parfois plusieurs dizaines de mégaoctets, et
            // justement au moment où l'on n'a pas de réseau.
            .filter((k) => k.startsWith('lacet-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/**
 * Les tuiles vectorielles sont servies par quatre sous-domaines équivalents
 * (`tiles-a` à `tiles-d`), et le moteur de rendu en choisit un par tuile. Une
 * tuile enregistrée depuis l'un serait introuvable si le rendu demande l'autre.
 * On range et on cherche donc toujours sous le même nom.
 */
function mapKey(url) {
  return url.replace(/\/\/tiles-[a-d]\./, '//tiles.')
}

/** La copie gardeée d'une ressource de carte, s'il y en a une. */
async function fromMaps(request) {
  const maps = await caches.open(MAPS_CACHE)
  return maps.match(mapKey(request.url))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    // Hors de notre origine : fond de carte, polices, altitudes. On ne garde
    // rien de neuf, mais on sert ce que l'app a explicitement mis de côté.
    //
    // Le repli vaut aussi pour une réponse en **erreur**, pas seulement pour un
    // échec de connexion. Une couverture qui faiblit ne coupe pas franchement :
    // elle donne des 502 et des 504, par un portail wifi ou un relais saturé. Ne
    // se rabattre que sur le rejet laissait alors des trous dans une carte
    // pourtant entièrement présente sur l'appareil.
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) return response
          const hit = await fromMaps(request)
          return hit || response
        })
        .catch(async () => (await fromMaps(request)) || Response.error()),
    )
    return
  }

  if (url.pathname.startsWith('/api')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Seules les réponses complètes et valables sont gardées. Une réponse
        // partielle (206) ou une erreur mise en cache condamnerait l'app à
        // servir cette erreur hors ligne.
        if (response.ok && response.status === 200) {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cache = await caches.open(SHELL_CACHE)
        const hit = await cache.match(request)
        if (hit) return hit

        // Une navigation sans correspondance exacte — l'app est une page unique,
        // toutes les routes mènent à la même.
        if (request.mode === 'navigate') {
          const shell = await cache.match('/')
          if (shell) return shell
          // Dernier recours : une page qui explique, plutôt que l'écran d'erreur
          // du navigateur, qui parle de DNS à quelqu'un parti courir.
          const fallback = await cache.match('/offline.html')
          if (fallback) return fallback
        }
        return Response.error()
      }),
  )
})
