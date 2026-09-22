// Le moteur, dans un fil à part.
//
// Construire un graphe prend quelques secondes sur une grande ville, et la
// génération est un calcul d'un seul tenant. Fait sur le fil principal, l'écran
// se figerait pendant tout ce temps — plus d'animation, plus de réponse au
// toucher, et iOS finit par croire l'app plantée.
//
// Les graphes déjà construits restent en mémoire ici, d'une recherche à
// l'autre : changer la distance ou le terrain ne refait ni le téléchargement ni
// la construction. Un graphe couvrant **au moins** le disque demandé suffit —
// raccourcir la distance réutilise celui de la recherche précédente.
//
// **Et ils se préparent d'avance.** Le téléchargement des rues faisait l'essentiel
// de l'attente d'une première recherche — vingt secondes, parfois plus, quand
// les serveurs d'OpenStreetMap sont chargés. Or l'app connaît le point de départ
// bien avant qu'on appuie sur « Trouver ma boucle » : dès l'ouverture, ou dès
// qu'on choisit une adresse. Le message `prefetch` lance alors le chargement en
// fond, pendant qu'on règle ses filtres ; la recherche qui suit le trouve prêt,
// ou le rejoint en cours de route au lieu de le recommencer.

import { buildGraph } from './graph'
import { haversineM } from './geo'
import { clearTiles, detailLevel, tilesFor } from './overpass'
import { fetchArea } from './overpass'
import { currentWind } from './environment'
import { graphRequest, planDetour, planLoops } from './service'

// Plafond de nœuds gardés en mémoire, toutes zones confondues. Mesuré : le pire
// extrait parisien compte 352 000 nœuds et occupe 260 Mo. Au-delà d'une grande
// ville, on reconstruit plutôt que de risquer qu'iOS ferme l'app.
const MAX_NODES = 400_000
const graphs = []

/**
 * Un graphe déjà construit qui couvre la zone demandée.
 *
 * Sur le **disque** couvert, et non sur les tuiles : le graphe est ramené au
 * rayon utile de sa recherche (`clipToDisk`), et deux recherches peuvent
 * demander les mêmes tuiles sans que la seconde tienne dans la première —
 * raccourcir la distance réutilise, s'éloigner du point de départ reconstruit.
 */
function findGraph(level, sport, allowTrail, { lat, lon, radiusM }) {
  const index = graphs.findIndex(
    (g) =>
      g.level === level &&
      g.sport === sport &&
      g.allowTrail === allowTrail &&
      haversineM([g.lon, g.lat], [lon, lat]) + radiusM <= g.radiusM,
  )
  if (index < 0) return null
  const [entry] = graphs.splice(index, 1)
  graphs.unshift(entry)
  return entry.graph
}

function remember(entry) {
  graphs.unshift(entry)
  let total = graphs.reduce((sum, g) => sum + g.graph.nodeCount, 0)
  while (graphs.length > 1 && total > MAX_NODES) {
    total -= graphs.pop().graph.nodeCount
  }
}

// Les chargements en cours : leur zone, et qui attend de leurs nouvelles.
const loads = []

// Le temps du dernier chargement, en deux parts : les rues, puis le graphe.
// `planLoops` ne voit qu'un `loadGraph` opaque et compte tout comme du
// téléchargement ; sans ce partage, impossible de savoir, téléphone en main, si
// une recherche lente attend le réseau ou calcule.
let lastLoad = { fetch: 0, graph: 0 }

// Vrai quand la dernière zone chargée n'a pas toutes ses tuiles : une bordure
// restée chez Overpass, qui tardait trop pour qu'on l'attende.
let lastPartial = false

async function loadGraph({ lat, lon, radiusM, targetM, sport, allowTrail }, progress) {
  const level = detailLevel(targetM)
  const area = { lat, lon, radiusM }
  const needed = tilesFor(lat, lon, radiusM).map(([ix, iy]) => `${ix}:${iy}`)
  const cached = findGraph(level, sport, allowTrail, area)
  if (cached) {
    lastLoad = { fetch: 0, graph: 0 }
    lastPartial = false
    return cached
  }

  // Un chargement déjà en cours sur ces rues — celui lancé d'avance, le plus
  // souvent : on le rejoint, et sa progression devient la nôtre. Le relancer en
  // parallèle retéléchargeait les mêmes tuiles, et doublait l'attente sur des
  // serveurs qui n'accordent que deux requêtes à la fois.
  const overlapping = loads.filter((l) => l.level === level && needed.some((k) => l.tiles.has(k)))
  if (overlapping.length) {
    progress('data', 0)
    for (const l of overlapping) l.listeners.add(progress)
    await Promise.allSettled(overlapping.map((l) => l.promise))
    for (const l of overlapping) l.listeners.delete(progress)
    const ready = findGraph(level, sport, allowTrail, area)
    if (ready) return ready
    // Pas tout à fait la même zone, ou un autre sport : on construit le nôtre,
    // mais les tuiles communes sont désormais sur l'appareil.
  }

  const entry = { level, tiles: new Set(needed), listeners: new Set([progress]), promise: null }
  const notify = (stage, fraction) => {
    for (const listener of entry.listeners) listener(stage, fraction)
  }
  entry.promise = (async () => {
    notify('data', 0)
    const startedAt = performance.now()
    const extract = await fetchArea({
      lat, lon, radiusM, targetM,
      onProgress: (fraction) => notify('data', fraction),
    })
    notify('graph', 0)
    const fetched = performance.now()
    const graph = buildGraph(extract, { allowTrail, sport })
    lastLoad = { fetch: (fetched - startedAt) / 1000, graph: (performance.now() - fetched) / 1000 }
    // Un graphe à qui il manque une bordure n'est pas gardé : les tuiles qui
    // tardaient finissent d'arriver en fond, et la recherche suivante doit en
    // profiter plutôt que de réutiliser un réseau tronqué.
    lastPartial = Boolean(extract.partial)
    if (!extract.partial) remember({ level, sport, allowTrail, ...area, graph })
    return graph
  })()
  loads.push(entry)
  try {
    return await entry.promise
  } finally {
    loads.splice(loads.indexOf(entry), 1)
  }
}

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data
  const progress = (stage, fraction) => self.postMessage({ id, type: 'progress', stage, fraction })

  if (type === 'plan') {
    try {
      lastLoad = { fetch: 0, graph: 0 }
      const result = await planLoops(payload, {
        loadGraph: (args) => loadGraph(args, progress),
        onProgress: progress,
      })
      // `planLoops` a compté tout le chargement comme du téléchargement : on lui
      // rend le détail, arrondi comme le reste de ses mesures.
      const timings = result?.meta?.timings_s
      if (timings) {
        timings.graph = Math.round(lastLoad.graph * 100) / 100
        timings.fetch = Math.max(0, Math.round((timings.fetch - timings.graph) * 100) / 100)
      }
      if (result?.meta && lastPartial) result.meta.partial = true
      self.postMessage({ id, type: 'result', result })
    } catch (error) {
      self.postMessage({ id, type: 'error', error: { name: error.name, message: error.message } })
    }
    return
  }

  // La préparation d'avance : silencieuse, et sans conséquence si elle échoue —
  // la recherche, elle, dira ce qui ne va pas.
  if (type === 'prefetch') {
    try {
      const args = graphRequest(payload)
      // Le vent aussi : une requête de rien, gardée une heure, qu'on n'aura
      // plus à attendre.
      currentWind(args.lat, args.lon).catch(() => {})
      await loadGraph(args, () => {})
      self.postMessage({ id, type: 'result', result: { ready: true } })
    } catch {
      self.postMessage({ id, type: 'result', result: { ready: false } })
    }
    return
  }

  // Le recalcul en course : le graphe de la recherche est presque toujours
  // encore en mémoire, et sinon ses rues sont sur l'appareil.
  if (type === 'detour') {
    try {
      const result = await planDetour(payload, { loadGraph: (args) => loadGraph(args, () => {}) })
      self.postMessage({ id, type: 'result', result })
    } catch (error) {
      self.postMessage({ id, type: 'error', error: { name: error.name, message: error.message } })
    }
    return
  }

  if (type === 'clear') {
    graphs.length = 0
    await clearTiles()
    self.postMessage({ id, type: 'result', result: null })
  }
}
