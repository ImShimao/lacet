// Fonction de poids du routage — portage fidèle de `backend/app/routing/weights.py`.
//
//     poids = longueur × (1 + λ · risque) × facteur_surface × facteur_nuit

import { pyMin } from './py'
import { CYCLE_FACILITY, EXPOSED_RISK, nightFactor } from './safety'

// La préférence « nature » — voir `GREEN_BONUS` en Python : un bonus borné pour
// ce qui longe un parc, un bois ou l'eau, et pour les sentiers balisés, jamais
// pour une voie exposée.
const GREEN_BONUS = 0.25
const MARKED_BONUS = 0.15

const LAMBDA = { safe: 4, standard: 1.5 }

// L'ordre des clés compte : `min(self._factors.values())` les lit dans cet ordre.
const table = (paved, gravel, trail, unknown) =>
  new Map([['paved', paved], ['gravel', gravel], ['trail', trail], ['unknown', unknown]])

const SURFACE_FACTOR = {
  road: table(1, 1.55, 2.3, 1.2),
  mixed: table(1, 0.95, 1.15, 1),
  trail: table(1.6, 0.85, 0.7, 1.1),
}
const SURFACE_FACTOR_BIKE = {
  road: table(1, 2.2, 3.5, 1.3),
  mixed: table(1, 1, 1.6, 1.05),
  trail: table(1.5, 0.8, 0.85, 1.1),
}

// === évitements ==============================================================
//
// Ce que l'on ne veut pas croiser, coché dans les filtres, et ce qu'on a
// signalé soi-même pendant une sortie. Les deux se règlent au même endroit,
// parce qu'ils posent la même question au routage : « passe ailleurs ».
//
// **Un évitement n'est pas une interdiction.** Multiplier le poids plutôt que
// retirer l'arête garde le réseau connexe : quand un escalier est le seul
// accès à la rive, la boucle passe quand même, et l'on n'affiche pas « aucun
// itinéraire » pour une marche de six marches. Vingt-cinq, c'est vingt-cinq
// fois la longueur : un escalier de trente mètres coûte comme sept cent
// cinquante — tout détour raisonnable le bat.
const AVOID_FACTOR = 25

// Un signalement, lui, pèse bien plus lourd : une route barrée n'est pas une
// préférence, c'est un mur. Quatre cents fois la longueur, c'est un tronçon de
// cinquante mètres qui en coûte vingt mille — il ne reste que le cas où il n'y
// a vraiment pas d'autre chemin, et où prévenir vaut mieux qu'échouer.
export const BLOCKED_FACTOR = 400

/** Ce qu'un évitement reconnaît, arête par arête. */
const AVOIDS = {
  steps: (s) => s.highway === 'steps',
  // Le vrai critère du coureur : la voiture qui passe à cinquante centimètres.
  // C'est celui que la note de sécurité appelle « exposé ».
  busy: (s) => s.risk >= EXPOSED_RISK,
  // `lit` est à `null` quand OpenStreetMap ne dit rien : dans le doute, on ne
  // pénalise pas — la moitié des rues d'un village n'ont simplement pas le tag.
  unlit: (s) => s.lit === false,
}

export const AVOID_KEYS = Object.keys(AVOIDS)

// === sans voitures ===========================================================
//
// Propre à l'app, comme les évitements : la case « Voies sans voitures
// d'abord » des filtres, cochée par défaut. Une piste, un chemin, une allée
// coûtent alors moins qu'une rue — même calme, même à 30 : la sécurité seule ne
// les départage pas, et le moteur prenait la plus courte. Mesuré à Guebwiller,
// le long de la zone commerciale : il fallait descendre sous 0,68 pour que la
// piste cyclable batte les voies de service et la pénétrante voisines. À 0,6,
// la route ne sert plus que là où il n'y a pas d'autre passage — ou pour
// varier les boucles.
const CAR_FREE_FACTOR = 0.6
// Le bonus ne va qu'aux surfaces que le terrain choisi accepte : un chemin de
// terre sans voitures n'est pas une piste pour un vélo de route. Sans cette
// borne, il rendait la terre moins chère que l'asphalte — mesuré à Meursault,
// 31 % de chemins sur une boucle vélo de 30 km réglée sur « Route ».
const CAR_FREE_SURFACE_MAX = 1.2

const FOOT_ONLY_FACTOR = 4
const FOOT_ONLY_HIGHWAY = new Set(['footway', 'pedestrian'])
const STEPS_FACTOR = 3
const NIGHT_MIN_FACTOR = 0.7 * 0.9
// En plat, une pente de 4 % coûte deux fois sa longueur — voir `CLIMB_WEIGHT`
// en Python. Jamais sous 1 : l'heuristique d'A* reste admissible.
const CLIMB_WEIGHT = 25

export class Profile {
  constructor({
    lam,
    surface,
    night,
    sport = 'run',
    avoid = [],
    blocked = null,
    carfree = false,
    terrain = null,
    nature = true,
  }) {
    this.lam = lam
    this.surface = surface
    this.night = night
    this.sport = sport
    this.carfree = carfree
    this.nature = nature
    this.factors = (sport === 'bike' ? SURFACE_FACTOR_BIKE : SURFACE_FACTOR)[surface]
    this.avoid = avoid.filter((key) => key in AVOIDS).map((key) => AVOIDS[key])
    this.blocked = blocked
    // Le relief de la zone, seulement quand on demande du plat.
    this.terrain = terrain
  }

  weight(graph, e) {
    const s = graph.edgeSafety[e]
    let w = graph.edgeLen[e] * (1 + this.lam * s.risk)
    const surface = this.factors.has(s.surface) ? this.factors.get(s.surface) : 1
    w *= surface
    if (this.sport === 'bike') {
      // Seule une voie ouverte aux vélos y échappe — voir `FOOT_ONLY_FACTOR` en Python.
      if (FOOT_ONLY_HIGHWAY.has(s.highway) && s.reason !== CYCLE_FACILITY) w *= FOOT_ONLY_FACTOR
    } else if (s.highway === 'steps') {
      w *= STEPS_FACTOR
    }
    if (this.night) w *= nightFactor(s)
    if (this.terrain !== null) {
      w *= 1 + (CLIMB_WEIGHT * this.terrain.climb(graph.coordsFrom(e, graph.edgeA[e]))) / Math.max(graph.edgeLen[e], 1)
    }
    if (this.nature && s.risk < EXPOSED_RISK) {
      w *= 1 - GREEN_BONUS * graph.edgeGreen[e] - (graph.edgeMarked[e] ? MARKED_BONUS : 0)
    }
    if (this.carfree && s.carFree && surface <= CAR_FREE_SURFACE_MAX) w *= CAR_FREE_FACTOR
    for (const test of this.avoid) if (test(s)) w *= AVOID_FACTOR
    if (this.blocked?.has(e)) w *= BLOCKED_FACTOR
    // Un portail fermé connu d'OpenStreetMap pèse comme un signalement : c'est
    // un mur, sauf s'il n'y a vraiment pas d'autre chemin.
    if (graph.gatedEdges?.has(e)) w *= BLOCKED_FACTOR
    return w
  }

  /** Poids de toutes les arêtes, une fois pour toutes. */
  precompute(graph) {
    const out = new Float64Array(graph.edgeCount)
    for (let e = 0; e < out.length; e += 1) out[e] = this.weight(graph, e)
    return out
  }

  get minFactor() {
    let factor = pyMin(this.factors.values())
    if (this.night) factor *= NIGHT_MIN_FACTOR
    if (this.nature) factor *= 1 - GREEN_BONUS - MARKED_BONUS
    // L'heuristique d'A* reste admissible : une voie sans voitures descend sous
    // le facteur de surface.
    if (this.carfree) factor *= CAR_FREE_FACTOR
    return factor
  }
}

export function buildProfile(
  surface,
  safety,
  night,
  sport = 'run',
  { avoid = [], blocked = null, carfree = false, terrain = null, nature = true } = {},
) {
  return new Profile({ lam: LAMBDA[safety], surface, night, sport, avoid, blocked, carfree, terrain, nature })
}
