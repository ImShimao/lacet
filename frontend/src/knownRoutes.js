// « Je l'ai déjà courue, celle-là. »
//
// L'app propose cinq boucles et garde toutes les sorties passées, avec leur
// trace réelle. Elle avait pourtant tout oublié d'une fois sur l'autre : rien
// ne disait qu'une proposition était le chemin de dimanche dernier, et rien ne
// permettait de se comparer à soi-même.
//
// **Ce qu'on compare, ce sont des chemins, pas des chiffres.** Deux boucles de
// 10 km au même départ peuvent n'avoir aucune rue en commun ; deux tracés
// identiques peuvent différer de trois cents mètres parce qu'un jour on a
// contourné un chantier. On mesure donc le **recouvrement** : la part de la
// proposition qui passe là où l'on est déjà passé.
//
// Le calcul est fait pour tourner à chaque affichage des cartes. D'où un tri
// grossier d'abord — même longueur, même départ —, qui élimine presque tout
// sans rien mesurer, et la comparaison point à point seulement sur ce qui
// reste.

import { haversineM } from './engine/geo'

// Vingt-cinq mètres : la largeur d'une rue avec ses deux trottoirs, et l'ordre
// de grandeur de l'erreur d'un GPS urbain. En dessous, deux traces de la même
// rue passeraient pour deux chemins différents.
const NEAR_M = 25

// Les deux tiers du chemin en commun : au-dessous, c'est une autre boucle qui
// partage un bout de rue — le retour par la même avenue, typiquement.
const SAME_SHARE = 0.66

// Un point tous les cinquante mètres suffit à reconnaître un chemin, et rend la
// comparaison dix fois plus légère qu'avec tous les points du tracé.
const STEP_M = 50

// Deux boucles dont les longueurs diffèrent de plus d'un dixième ne sont pas la
// même, et deux départs distants de plus de trois cents mètres non plus. Ces
// deux tests écartent presque tout l'historique sans mesurer un seul point.
const LENGTH_TOLERANCE = 0.1
const START_M = 300

/**
 * La sortie passée qui a emprunté ce chemin, ou `null`.
 *
 * Rend la plus récente, avec la part du parcours déjà connue : c'est elle qui
 * permet de dire « déjà couru » sans mentir sur ce qu'on compare.
 */
export function alreadyRun(route, history, { near = NEAR_M, share = SAME_SHARE } = {}) {
  const points = sample(route?.geometry)
  if (points.length < 3) return null

  for (const past of history ?? []) {
    const trace = past.track?.length > 1 ? past.track : past.geometry
    if (!trace || trace.length < 2) continue
    if (!plausible(route, past, points[0], trace)) continue

    const overlap = coverage(points, sample(trace), near)
    if (overlap >= share) {
      return { run: past, share: overlap }
    }
  }
  return null
}

/**
 * Toutes les fois où l'on a couru ce chemin-là, la plus récente d'abord.
 *
 * `alreadyRun` répond « oui, dimanche dernier » — assez pour une pastille sur
 * une proposition. Relire une sortie demande autre chose : **où elle se situe
 * parmi les autres**. C'est la question qu'on se pose en rouvrant une sortie,
 * et la seule à laquelle une app de course peut répondre mieux qu'une montre
 * qu'on ne consulte plus : est-ce que je progresse sur cette boucle ?
 *
 * La sortie passée en argument est exclue du résultat : on ne se compare pas
 * à soi-même deux fois.
 */
export function sameRoute(entry, history, { near = NEAR_M, share = SAME_SHARE } = {}) {
  const points = sample(entry?.track?.length > 1 ? entry.track : entry?.geometry)
  if (points.length < 3) return []

  const out = []
  for (const past of history ?? []) {
    if (past === entry || (entry.ranAt && past.ranAt === entry.ranAt)) continue
    const trace = past.track?.length > 1 ? past.track : past.geometry
    if (!trace || trace.length < 2) continue
    if (!plausible({ distance_m: entry.actual_distance_m || entry.distance_m }, past, points[0], trace)) continue
    if (coverage(points, sample(trace), near) >= share) out.push(past)
  }
  // Une sortie de moins de cent mètres ne vaut pas d'être comparée ; une sortie
  // sans temps non plus — il n'y aurait rien à mettre en regard.
  return out
    .filter((r) => (r.actual_distance_m || 0) >= 100 && (r.actual_duration_s || 0) > 0)
    .sort((a, b) => String(b.ranAt || '').localeCompare(String(a.ranAt || '')))
}

/**
 * Où se situe une sortie parmi celles qui ont emprunté le même chemin.
 *
 * Rend `null` quand c'est la première fois : il n'y a alors rien à dire, et
 * inventer une comparaison serait pire que de se taire.
 *
 * L'allure est comparée plutôt que le temps : deux passages sur « le même
 * chemin » peuvent différer de trois cents mètres, et un temps brut ferait
 * alors passer un détour pour un jour sans.
 */
export function standing(entry, history, options) {
  const autres = sameRoute(entry, history, options)
  if (!autres.length) return null
  const allure = (r) => (r.actual_duration_s || 0) / ((r.actual_distance_m || 1) / 1000)
  const mienne = allure(entry)
  const meilleure = autres.reduce((best, r) => (allure(r) < allure(best) ? r : best), autres[0])
  const precedente = autres[0]
  return {
    count: autres.length + 1,
    others: autres,
    previous: precedente,
    best: meilleure,
    // Le record est à moi quand personne n'a fait mieux — l'égalité comprise,
    // parce qu'une seconde d'écart sur dix kilomètres ne veut rien dire.
    record: mienne <= allure(meilleure),
    // En secondes par kilomètre, négatif quand on a été plus rapide.
    vsPrevious: Math.round(mienne - allure(precedente)),
    vsBest: Math.round(mienne - allure(meilleure)),
  }
}

/** Le tri grossier : même longueur, même départ. */
function plausible(route, past, start, trace) {
  const mine = route.distance_m || 0
  const theirs = past.actual_distance_m || past.distance_m || 0
  if (!mine || !theirs) return false
  if (Math.abs(mine - theirs) > mine * LENGTH_TOLERANCE) return false
  // Le départ d'une sortie passée est le premier point de sa trace — celui où
  // l'on a appuyé sur « Démarrer », à quelques mètres près.
  return haversineM(start, trace[0]) <= START_M
}

/** Un point tous les cinquante mètres, premier et dernier compris. */
function sample(geometry, step = STEP_M) {
  if (!geometry || geometry.length < 2) return []
  const out = [geometry[0]]
  let carried = 0
  for (let i = 1; i < geometry.length; i += 1) {
    carried += haversineM(geometry[i - 1], geometry[i])
    if (carried >= step) {
      out.push(geometry[i])
      carried = 0
    }
  }
  const last = geometry[geometry.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * La part des points de `mine` qui passent à moins de `near` d'un point de
 * `theirs`.
 *
 * Les points sont rangés par case de la taille du voisinage cherché : sans
 * cela, comparer deux boucles de dix kilomètres demanderait quarante mille
 * distances, à chaque affichage et pour chaque sortie passée.
 */
function coverage(mine, theirs, near) {
  const grid = new Map()
  const key = (lon, lat) => `${Math.floor((lon * 111_320) / near)}:${Math.floor((lat * 110_540) / near)}`
  for (const [lon, lat] of theirs) {
    const k = key(lon, lat)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push([lon, lat])
  }

  let seen = 0
  for (const point of mine) {
    const [cx, cy] = key(point[0], point[1]).split(':').map(Number)
    let trouvé = false
    for (let dx = -1; dx <= 1 && !trouvé; dx += 1) {
      for (let dy = -1; dy <= 1 && !trouvé; dy += 1) {
        for (const other of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (haversineM(point, other) <= near) {
            trouvé = true
            break
          }
        }
      }
    }
    if (trouvé) seen += 1
  }
  return seen / mine.length
}
