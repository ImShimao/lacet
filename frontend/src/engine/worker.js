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
import { haversineM, resample } from './geo'
import { matchTrace } from './matcher'
import { clearTiles, detailLevel, fetchArea, tilesFor } from './overpass'
import { ELEVATION_STEP_M, currentWind, fetchMany, shapeRelief } from './environment'
import { graphRequest, matchedRoute, normalizeRequest, planDetour, planLoops, pointKey, reverseRoute } from './service'
import { planRemote } from './remote'

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

// Les chargements en cours : leur zone, qui attend de leurs nouvelles, et ce
// qu'ils ont mesuré.
const loads = []

/**
 * Ce qu'un chargement dit de lui-même, rempli dans `info` :
 *
 * - `fetch`, `graph` : son temps, en deux parts — les rues, puis le graphe.
 *   `planLoops` ne voit qu'un `loadGraph` opaque et compte tout comme du
 *   téléchargement ; sans ce partage, impossible de savoir, téléphone en main, si
 *   une recherche lente attend le réseau ou calcule ;
 * - `partial` : une bordure manque, restée chez Overpass, qui tardait trop pour
 *   qu'on l'attende — l'écran le dit ;
 * - `sources` : d'où venaient les rues — « livrée », « archives », « Overpass »,
 *   « appareil ».
 *
 * Propre à chaque demande, et non gardé « pour le dernier chargement » : une
 * préparation d'avance qui finissait pendant une recherche lui prêtait sa
 * bordure manquante, et l'écran annonçait des rues absentes qui étaient là.
 */
async function loadGraph({ lat, lon, radiusM, targetM, sport, allowTrail }, progress, info = {}) {
  const level = detailLevel(targetM)
  const area = { lat, lon, radiusM }
  const needed = tilesFor(lat, lon, radiusM).map(([ix, iy]) => `${ix}:${iy}`)
  const cached = findGraph(level, sport, allowTrail, area)
  if (cached) return cached

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
    if (ready) {
      // Le chargement rejoint est le nôtre : ses mesures aussi.
      Object.assign(info, ...overlapping.map((l) => l.info))
      return ready
    }
    // Pas tout à fait la même zone, ou un autre sport : on construit le nôtre,
    // mais les tuiles communes sont désormais sur l'appareil.
  }

  const entry = { level, tiles: new Set(needed), listeners: new Set([progress]), promise: null, info: {} }
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
    entry.info = {
      fetch: (fetched - startedAt) / 1000,
      graph: (performance.now() - fetched) / 1000,
      partial: Boolean(extract.partial),
      sources: extract.sources ?? null,
    }
    // Un graphe à qui il manque une bordure n'est pas gardé : les tuiles qui
    // tardaient finissent d'arriver en fond, et la recherche suivante doit en
    // profiter plutôt que de réutiliser un réseau tronqué.
    if (!extract.partial) remember({ level, sport, allowTrail, ...area, graph })
    return graph
  })()
  loads.push(entry)
  try {
    const graph = await entry.promise
    Object.assign(info, entry.info)
    return graph
  } finally {
    loads.splice(loads.indexOf(entry), 1)
  }
}

// De quoi retourner la boucle qu'on vient de proposer : le graphe est déjà
// gardé pour la recherche suivante, on lui adjoint les candidats et leur
// relief. Remplacé à chaque recherche — on ne retourne que ce qui est à
// l'écran, et une boucle d'hier n'a plus de graphe sous elle.
let lastReversible = null

// Les boucles montrées depuis la dernière recherche ordinaire, en ensembles de
// points : « Régénérer » les fait passer après les neuves (`freshFirst`). Trois
// écrans au plus — au-delà, mieux vaut revoir une boucle qu'en manquer.
const MAX_SHOWN = 15
let shown = []
// Le numéro de la dernière recherche lancée : seule elle garde ses boucles.
let latestPlan = 0

// Une boucle, pas `Math.min(...trace)` : une trace importée compte jusqu'à
// soixante mille points, et WebKit refuse un appel à plus de 65 536 arguments —
// bien avant, parfois, faute de pile dans un worker.
function bbox(trace) {
  const min = [Infinity, Infinity]
  const max = [-Infinity, -Infinity]
  for (const [lon, lat] of trace) {
    if (lon < min[0]) min[0] = lon
    if (lat < min[1]) min[1] = lat
    if (lon > max[0]) max[0] = lon
    if (lat > max[1]) max[1] = lat
  }
  return { min, max }
}

const traceLength = (trace) => {
  let total = 0
  for (let i = 1; i < trace.length; i += 1) total += haversineM(trace[i - 1], trace[i])
  return total
}

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data
  const progress = (stage, fraction) => self.postMessage({ id, type: 'progress', stage, fraction })

  if (type === 'plan') {
    // Le filet : quand les rues ne sont pas là et qu'aucun miroir ne répond, un
    // calculateur public rend un tracé plutôt que rien. Annoncé pour ce qu'il
    // est — voir `remote.js`.
    const secours = async () => {
      progress('routing', 0)
      try {
        return await planRemote(normalizeRequest(payload))
      } catch {
        return null
      }
    }

    try {
      const load = { fetch: 0, graph: 0, partial: false, sources: null }
      // Ce qu'on gardait pour retourner les boucles d'avant tient un graphe
      // dérivé — celui du départ devant la porte (`door.js`). Lâché dès
      // maintenant, il ne coexiste pas avec celui de la recherche qui commence.
      lastReversible = null
      if (!payload.variation) shown = []
      const mine = ++latestPlan
      let reversible = null
      const result = await planLoops(payload, {
        loadGraph: (args) => loadGraph(args, progress, load),
        onProgress: progress,
        onReversible: (r) => {
          reversible = r
        },
        shown,
      })
      // Une recherche remplacée en cours de calcul — les filtres changés entre-
      // temps — peut finir après celle qui l'a remplacée. Ce qu'elle garderait
      // ne serait pas ce qui est à l'écran : « autre sens » échouait alors sur
      // les boucles affichées.
      if (mine === latestPlan && reversible) {
        lastReversible = reversible
        for (const kept of reversible.routes) shown.push(new Set(kept.cand.geometry.map(pointKey)))
        shown = shown.slice(-MAX_SHOWN)
      }
      // `planLoops` a compté tout le chargement comme du téléchargement : on lui
      // rend le détail, arrondi comme le reste de ses mesures.
      const timings = result?.meta?.timings_s
      if (timings) {
        timings.graph = Math.round(load.graph * 100) / 100
        timings.fetch = Math.max(0, Math.round((timings.fetch - timings.graph) * 100) / 100)
      }
      if (result?.meta && load.partial) result.meta.partial = true
      if (result?.meta && load.sources) result.meta.sources = load.sources
      // À vélo, une boucle qui emprunte un sens unique ne se parcourt que dans
      // son sens : retournée, elle le remonterait. L'écran n'offre alors pas
      // l'autre sens — voir `reverse`. Ajouté ici, hors de `planLoops`, dont la
      // réponse reste celle du moteur Python.
      const sens = reversible?.graph.edgeOneway
      if (sens && result?.routes) {
        for (const kept of reversible.routes) {
          if (!kept.cand.edges.some((e) => sens[e])) continue
          const route = result.routes.find((r) => r.id === kept.id)
          if (route) route.oneway = true
        }
      }

      // Le moteur a tourné mais n'a rien trouvé : le réseau du coin est peut-être
      // trop maigre dans ce qu'on a pu en charger. On essaie le secours avant de
      // rendre un écran vide.
      if (!result?.routes?.length) {
        const replacement = await secours()
        if (replacement?.routes?.length) {
          self.postMessage({ id, type: 'result', result: replacement })
          return
        }
      }
      self.postMessage({ id, type: 'result', result })
    } catch (error) {
      const replacement = await secours()
      if (replacement?.routes?.length) {
        self.postMessage({ id, type: 'result', result: replacement })
        return
      }
      self.postMessage({ id, type: 'error', error: { name: error.name, message: error.message } })
    }
    return
  }

  // Reconnaître les rues d'un parcours importé. Sans ça, un GPX n'est qu'une
  // suite de points : ni nom de rue, ni traversée, ni note, ni consigne.
  if (type === 'match') {
    try {
      const { trace, sport, name } = payload
      const box = bbox(trace)
      const rayon = Math.max(1200, haversineM(box.min, box.max) / 2 + 400)
      const longueur = traceLength(trace)
      const graph = await loadGraph(
        {
          lat: (box.min[1] + box.max[1]) / 2,
          lon: (box.min[0] + box.max[0]) / 2,
          radiusM: rayon,
          targetM: longueur,
          sport: sport ?? 'run',
          allowTrail: true,
        },
        progress,
      )
      progress('routing', 0)
      const matched = matchTrace(graph, trace)
      if (!matched) {
        self.postMessage({ id, type: 'result', result: { route: null } })
        return
      }
      const start = matched.nodes[0]
      // Le relief du chemin reconnu, pas celui du fichier : la géométrie a
      // changé en rejoignant les rues, et mélanger les deux mentirait.
      progress('elevation', 0)
      const geometry = []
      let cur = start
      for (const e of matched.edges) {
        const coords = graph.coordsFrom(e, cur)
        for (const c of geometry.length ? coords.slice(1) : coords) geometry.push(c)
        cur = graph.other(e, cur)
      }
      let elev = null
      try {
        const sampleM = ELEVATION_STEP_M
        const points = resample(geometry, sampleM).map(([, c]) => c)
        const [relief] = await fetchMany([points])
        if (relief?.values?.length) {
          const { values, threshold } = shapeRelief(relief, sampleM)
          elev = [values, null, threshold, sampleM]
        }
      } catch {
        /* sans relief : le parcours reste juste */
      }
      const route = matchedRoute(graph, start, matched, {
        req: normalizeRequest({ lat: geometry[0][1], lon: geometry[0][0], sport: sport ?? 'run', distance_km: longueur / 1000 }),
        name,
        elev,
      })
      self.postMessage({ id, type: 'result', result: { route, share: matched.share } })
    } catch (error) {
      self.postMessage({ id, type: 'error', error: { name: error.name, message: error.message } })
    }
    return
  }

  // La même boucle, dans l'autre sens. Pas une nouvelle recherche : le même
  // chemin, les mêmes rues, la même note — d'autres côtes et d'autres virages.
  if (type === 'reverse') {
    const gardé = lastReversible?.routes?.find((r) => r.id === payload.id)
    if (!gardé) {
      // Le graphe a été remplacé depuis : il faudrait tout retélécharger pour
      // retourner une boucle, ce qui n'en vaut pas la peine. L'écran le dira.
      self.postMessage({ id, type: 'error', error: { name: 'StaleRoute', message: 'À refaire : cette boucle n’est plus en mémoire.' } })
      return
    }
    if (gardé.cand.edges.some((e) => lastReversible.graph.edgeOneway?.[e])) {
      self.postMessage({ id, type: 'error', error: { name: 'OneWay', message: 'Cette boucle emprunte des sens uniques : à vélo, elle ne se parcourt que dans ce sens.' } })
      return
    }
    try {
      const { route, cand } = reverseRoute(lastReversible.graph, lastReversible.start, gardé.cand, {
        req: lastReversible.req,
        elev: gardé.elev,
        score: gardé.score,
        rank: gardé.rank,
        night: lastReversible.night,
      })
      // Le sens retenu devient celui qu'on garde : presser une seconde fois
      // ramène au sens d'origine, au lieu de refaire le même demi-tour.
      gardé.cand = cand
      if (gardé.elev) gardé.elev = [[...gardé.elev[0]].reverse(), gardé.elev[1], gardé.elev[2], gardé.elev[3]]
      self.postMessage({ id, type: 'result', result: { route } })
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
