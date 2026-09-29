// Consignes de navigation — portage fidèle de `backend/app/navigation.py`.

import { reachOf } from './door'
import { bearingDeg, haversineM } from './geo'
import { pyfloordiv, pymod, pyRound, sortByKey } from './py'

// **Sur quelle longueur on lit la direction d'une voie.**
//
// Vingt mètres, c'était la longueur du carrefour lui-même : le rayon d'un
// trottoir, le décalage d'un îlot, les deux points de forme que le cadastre a
// posés en biais. On mesurait donc la géométrie de l'intersection au lieu de la
// direction de la rue, et une rue qui continue tout droit sortait à trente-cinq
// degrés — assez pour qu'une consigne s'invente, puis une autre en sens inverse
// vingt mètres plus loin : « serre à gauche puis tout de suite à droite », là où
// il n'y a qu'à continuer.
//
// Trente-cinq mètres portent au-delà du carrefour, sur la rue elle-même.
const BEARING_SPAN_M = 35
const SLIGHT_DEG = 30
const TURN_DEG = 55
const SHARP_DEG = 115
const UTURN_DEG = 155
const MERGE_DISTANCE_M = 25
const NAME_CHANGE_MIN_M = 120
const NAME_REPEAT_M = 400
const LAP_ABSORB_M = 25
const ORDINALS = ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième']

const CARDINALS = [
  'le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest',
]

const PHRASES = new Map([
  ['slight_left', 'Serre à gauche'],
  ['left', 'Tourne à gauche'],
  ['sharp_left', 'Tourne franchement à gauche'],
  ['slight_right', 'Serre à droite'],
  ['right', 'Tourne à droite'],
  ['sharp_right', 'Tourne franchement à droite'],
  ['uturn', 'Fais demi-tour'],
  ['straight', 'Continue tout droit'],
])

const SHORT = new Map([
  ['left', 'à gauche'],
  ['right', 'à droite'],
  ['slight_left', 'à gauche'],
  ['slight_right', 'à droite'],
  ['sharp_left', 'franchement à gauche'],
  ['sharp_right', 'franchement à droite'],
  ['uturn', 'demi-tour'],
])

const instruction = (distM, turn, angle, road, text, lon, lat, caution) => ({
  dist_m: distM, turn, angle, road, text, lon, lat, caution,
})

export function buildInstructions(graph, start, cand) {
  if (!cand.edges.length) return []

  const door = doorway(graph, start, cand)
  let steps = mergeAll(rawSteps(graph, start, cand, door?.folded ? door.node : null))

  const total = cand.stats ? cand.stats.distanceM : 0
  const [lon, lat] = graph.node(start)
  const firstRoad = door ? door.road : graph.edgeName[cand.edges[0]]
  const heading = door ? door.onward : bearingFromStart(graph.coordsFrom(cand.edges[0], start))

  const out = [instruction(0, 'start', 0, firstRoad, door ? door.text : startText(heading, firstRoad), lon, lat, false)]
  const markers = lapMarkers(cand, total, door ?? { lon, lat, reach: 0 }, heading)
  if (markers.length) {
    const bounds = markers.map((m) => m.dist_m)
    steps = steps.filter((step) => bounds.every((b) => Math.abs(step.dist_m - b) > LAP_ABSORB_M))
  }

  out.push(...steps, ...markers)
  out.push(instruction(pyRound(total, 1), 'finish', 0, null, finishText(cand.laps), lon, lat, false))
  return sortByKey(out, (step) => step.dist_m)
}

/**
 * Les fins de tour. `at` dit où elles tombent : au départ, ou — quand on part
 * de chez soi — au seuil de la rue, que les tours contournent sans repasser
 * par l'allée (voir `repeatLoop`).
 */
function lapMarkers(cand, total, at, heading) {
  if (cand.laps < 2) return []
  const lap = (total - 2 * at.reach) / cand.laps
  const out = []
  for (let k = 1; k < cand.laps; k += 1) {
    const restants = cand.laps - k
    const fait = k <= ORDINALS.length ? ORDINALS[k - 1] : `${k}ᵉ`
    const reste = restants === 1 ? 'Dernier tour.' : `Encore ${restants} tours.`
    out.push(
      instruction(
        pyRound(at.reach + lap * k, 1), 'lap', 0, null,
        `Fin du ${fait} tour. ${reste} Repars vers ${headingWords(heading)}.`,
        at.lon, at.lat, false,
      ),
    )
  }
  return out
}

// === le seuil de la porte =======================================================
//
// Hors du portage Python : le départ devant la porte n'existe que dans l'app
// (voir `door.js`). La boucle commence alors par quelques mètres d'allée
// jusqu'à la rue — et « pars vers le nord », qui décrivait l'allée, ne disait
// plus rien d'utile. Ce qu'on veut savoir sur le pas de sa porte, c'est de
// quel côté partir une fois sur le trottoir.

// Jusqu'à cette longueur, rejoindre la rue et y tourner ne font qu'une
// consigne : deux phrases pour douze mètres, la seconde tomberait avant la fin
// de la première. Au-delà — une longue allée, un parc —, le virage sur la rue
// garde sa propre annonce.
const FOLD_M = 30

const PATH_LIKE = new Set(['footway', 'path', 'track', 'cycleway', 'bridleway', 'steps'])

function doorway(graph, start, cand) {
  const reach = reachOf(graph, cand.edges)
  if (!reach || cand.edges.length < 3) return null
  const node = graph.door.node
  const street = cand.edges[1]
  const road = graph.edgeName[street]
  const onward = bearingFromStart(graph.coordsFrom(street, node))
  const toStreet = bearingDeg(graph.node(start), graph.node(node))
  // Face à la rue, en sortant : de quel côté l'on part.
  const angle = pymod(onward - toStreet + 180, 360) - 180
  const side = angle <= -SLIGHT_DEG ? 'à gauche' : angle >= SLIGHT_DEG ? 'à droite' : 'tout droit'
  const way = road ?? (PATH_LIKE.has(graph.edgeSafety[street].highway) ? 'le chemin' : 'la rue')
  const folded = reach <= FOLD_M
  const text = folded
    ? `Départ — rejoins ${way} et pars ${side}.`
    : `Départ — rejoins ${way}, ${Math.round(reach / 10) * 10} mètres vers ${headingWords(toStreet)}.`
  const [lon, lat] = graph.node(node)
  return { node, reach, road, onward, folded, text, lon, lat }
}

const headingWords = (heading) => CARDINALS[Math.trunc(pyfloordiv(pymod(heading + 22.5, 360), 45))]

const finishText = (laps) =>
  laps < 2
    ? 'Tu es revenu au point de départ. Boucle terminée.'
    : `Dernier tour bouclé. Les ${laps} tours sont terminés.`

/** Clé d'égalité d'un point arrondi au millionième, comme le tuple Python. */
const pointKey = (lon, lat) => `${pyRound(lon, 6)},${pyRound(lat, 6)}`

/** `quiet` : un nœud où ne rien annoncer — le seuil, quand le départ le dit déjà. */
function rawSteps(graph, start, cand, quiet = null) {
  const unprotected = new Set()
  for (const c of cand.crossings) if (!c.protected) unprotected.add(pointKey(c.lon, c.lat))

  const steps = []
  let cursor = start
  let travelled = 0
  let outBearing = null
  let lastNamed = null
  const announced = new Map()

  for (const e of cand.edges) {
    const coords = graph.coordsFrom(e, cursor)
    const name = graph.edgeName[e]
    const length = graph.edgeLen[e]

    if (outBearing !== null && cursor !== quiet) {
      const inBearing = bearingFromStart(coords)
      const angle = pymod(inBearing - outBearing + 180, 360) - 180
      const turn = classify(angle)

      const roadChanged = name !== lastNamed
      const fresh =
        name !== null && travelled - (announced.has(name) ? announced.get(name) : -1e9) > NAME_REPEAT_M
      const namedChange = fresh && roadChanged && length >= NAME_CHANGE_MIN_M
      const magnitude = Math.abs(angle)

      // **Y avait-il un choix ?**
      //
      // C'est la question qui manquait. Un nœud de degré deux n'est pas un
      // carrefour : c'est une couture entre deux tronçons de la même voie, là
      // où OpenStreetMap a coupé — un changement de revêtement, une limite de
      // commune, le début d'un pont. On ne peut aller nulle part ailleurs, et
      // pourtant l'app y annonçait des virages, parfois deux de suite en sens
      // contraire.
      //
      // Une consigne ne sert qu'à choisir. Là où il n'y a rien à choisir, il
      // n'y a rien à dire : la rue emmène.
      const choix = graph.adjOffset[cursor + 1] - graph.adjOffset[cursor] > 2

      if ((choix && (magnitude >= TURN_DEG || (magnitude >= SLIGHT_DEG && roadChanged))) || namedChange) {
        if (name) announced.set(name, travelled)
        const [lon, lat] = coords[0]
        const rlon = pyRound(lon, 6)
        const rlat = pyRound(lat, 6)
        steps.push(
          instruction(
            pyRound(travelled, 1), turn, pyRound(angle, 1), name, phrase(turn, name),
            rlon, rlat, unprotected.has(pointKey(rlon, rlat)),
          ),
        )
      }
    }

    travelled += length
    outBearing = bearingToEnd(coords)
    if (name) lastNamed = name
    cursor = graph.other(e, cursor)
  }
  return steps
}

/**
 * Répète le rassemblement jusqu'à ce que plus rien ne bouge.
 *
 * Une passe ne suffit pas : trois manœuvres rapprochées se traitent deux par
 * deux, et la troisième restait seule ; un virage recollé pouvait ensuite se
 * compenser avec le suivant. Chaque passe qui change quelque chose raccourcit
 * la liste, donc la boucle s'arrête.
 */
function mergeAll(steps) {
  let out = steps
  for (;;) {
    const suivant = mergeClose(out)
    if (suivant.length === out.length) return suivant
    out = suivant
  }
}

/**
 * Rassemble deux manœuvres trop rapprochées.
 *
 * Trois cas, et ils ne se disent pas de la même façon :
 *
 * **La rue ondule.** Deux écarts opposés qui se compensent — trente degrés à
 * gauche, trente à droite, vingt mètres plus loin — ne sont pas deux
 * manœuvres : c'est une rue qui n'est pas droite. On ne dit rien. C'est le
 * défaut que l'on entendait le plus : « va à gauche puis à droite » alors qu'il
 * n'y a qu'à continuer.
 *
 * **Le virage est en deux temps.** Deux écarts du même côté sont un seul
 * virage, coupé en deux par un point de forme. On les additionne, et l'on
 * annonce le virage entier, une fois.
 *
 * **C'est vraiment une chicane.** Deux manœuvres opposées qui ne se compensent
 * pas — un décrochement, une place à traverser — gardent leurs deux temps.
 */
function mergeClose(steps) {
  if (steps.length < 2) return steps
  const out = []
  let i = 0
  while (i < steps.length) {
    let current = steps[i]
    const following = i + 1 < steps.length ? steps[i + 1] : null
    const proches =
      following !== null &&
      following.dist_m - current.dist_m <= MERGE_DISTANCE_M &&
      current.turn !== 'straight' &&
      following.turn !== 'straight'
    if (proches) {
      const somme = current.angle + following.angle
      const oppose = current.angle > 0 !== following.angle > 0
      if (oppose && Math.abs(somme) < SLIGHT_DEG) {
        // La rue ondule : les deux écarts disparaissent ensemble. La prudence,
        // elle, ne disparaît pas — une traversée non protégée signalée sur l'un
        // des deux points reste dite.
        if (current.caution || following.caution) {
          out.push(
            instruction(
              current.dist_m, 'straight', pyRound(somme, 1), following.road,
              phrase('straight', following.road), current.lon, current.lat, true,
            ),
          )
        }
        i += 2
        continue
      }
      if (!oppose) {
        // Un seul virage, coupé en deux par un point de forme.
        const turn = classify(somme)
        const road = following.road || current.road
        current = instruction(
          current.dist_m, turn, pyRound(somme, 1), road, phrase(turn, road),
          current.lon, current.lat, current.caution || following.caution,
        )
      } else {
        // L'angle net, et non celui du premier temps : la passe suivante doit
        // pouvoir juger l'effet de l'ensemble.
        current = instruction(
          current.dist_m, current.turn, pyRound(somme, 1), following.road,
          `${PHRASES.get(current.turn) ?? 'Continue'} puis tout de suite ${SHORT.get(following.turn) ?? 'tout droit'}${on(following.road)}`,
          current.lon, current.lat, current.caution || following.caution,
        )
      }
      i += 2
    } else {
      i += 1
    }
    out.push(current)
  }
  return out
}

function classify(angle) {
  const magnitude = Math.abs(angle)
  const side = angle > 0 ? 'right' : 'left'
  if (magnitude >= UTURN_DEG) return 'uturn'
  if (magnitude >= SHARP_DEG) return `sharp_${side}`
  if (magnitude >= TURN_DEG) return side
  if (magnitude >= SLIGHT_DEG) return `slight_${side}`
  return 'straight'
}

const phrase = (turn, road) => `${PHRASES.get(turn) ?? 'Continue'}${on(road)}`
const on = (road) => (road ? ` sur ${road}` : '')
const startText = (heading, road) => `Départ — pars vers ${headingWords(heading)}${on(road)}.`

const bearingFromStart = (coords) => bearingDeg(coords[0], advance(coords, BEARING_SPAN_M))
const bearingToEnd = (coords) => bearingDeg(advance([...coords].reverse(), BEARING_SPAN_M), coords[coords.length - 1])

function advance(coords, distanceM) {
  let travelled = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const step = haversineM(coords[i], coords[i + 1])
    if (travelled + step >= distanceM) {
      if (step <= 0) continue
      const t = (distanceM - travelled) / step
      const a = coords[i]
      const b = coords[i + 1]
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    travelled += step
  }
  return coords[coords.length - 1]
}

// === détours ==================================================================
//
// Hors du portage Python : le recalcul en course (`reroute.js`) n'existe que
// dans l'app. Il réemploie les mêmes règles — mêmes angles, mêmes phrases — pour
// que les consignes d'un détour sonnent comme celles du parcours.

/**
 * Les consignes le long d'une suite d'arêtes, distances comptées depuis `source`.
 * `quiet` : un nœud où ne rien annoncer — le seuil de la rue, quand la
 * première consigne dit déjà de quel côté la prendre.
 */
export function pathSteps(graph, source, edges, quiet = null) {
  return mergeAll(rawSteps(graph, source, { edges, crossings: [] }, quiet))
}

/** Le virage que fait un angle (degrés, positif à droite), et sa phrase. */
export function turnOf(angle, road = null) {
  const turn = classify(angle)
  return { turn, text: phrase(turn, road) }
}

/** Cap de départ et cap d'arrivée d'une géométrie, lissés sur vingt mètres. */
export const headings = (coords) => [bearingFromStart(coords), bearingToEnd(coords)]
