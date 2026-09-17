// Le moteur, dans un fil à part.
//
// Construire un graphe prend quelques secondes sur une grande ville, et la
// génération est un calcul d'un seul tenant. Fait sur le fil principal, l'écran
// se figerait pendant tout ce temps — plus d'animation, plus de réponse au
// toucher, et iOS finit par croire l'app plantée.
//
// Les graphes déjà construits restent en mémoire ici, d'une recherche à
// l'autre : changer la distance ou le terrain ne refait ni le téléchargement ni
// la construction. Un graphe couvrant **au moins** les tuiles demandées suffit —
// raccourcir la distance réutilise celui de la recherche précédente.

import { buildGraph } from './graph'
import { clearTiles, detailLevel, tilesFor } from './overpass'
import { fetchArea } from './overpass'
import { planLoops } from './service'

// Plafond de nœuds gardés en mémoire, toutes zones confondues. Mesuré : le pire
// extrait parisien compte 352 000 nœuds et occupe 260 Mo. Au-delà d'une grande
// ville, on reconstruit plutôt que de risquer qu'iOS ferme l'app.
const MAX_NODES = 400_000
const graphs = []

function findGraph(level, sport, allowTrail, needed) {
  const index = graphs.findIndex(
    (g) => g.level === level && g.sport === sport && g.allowTrail === allowTrail && needed.every((k) => g.tiles.has(k)),
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

async function loadGraph({ lat, lon, radiusM, targetM, sport, allowTrail }, progress) {
  const level = detailLevel(targetM)
  const needed = tilesFor(lat, lon, radiusM).map(([ix, iy]) => `${ix}:${iy}`)
  const cached = findGraph(level, sport, allowTrail, needed)
  if (cached) return cached

  progress('data', 0)
  const extract = await fetchArea({
    lat, lon, radiusM, targetM,
    onProgress: (fraction) => progress('data', fraction),
  })
  progress('graph', 0)
  const graph = buildGraph(extract, { allowTrail, sport })
  remember({ level, sport, allowTrail, tiles: new Set(needed), graph })
  return graph
}

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data
  const progress = (stage, fraction) => self.postMessage({ id, type: 'progress', stage, fraction })

  if (type === 'plan') {
    try {
      const result = await planLoops(payload, {
        loadGraph: (args) => loadGraph(args, progress),
        onProgress: progress,
      })
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
