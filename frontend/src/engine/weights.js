// Fonction de poids du routage — portage fidèle de `backend/app/routing/weights.py`.
//
//     poids = longueur × (1 + λ · risque) × facteur_surface × facteur_nuit

import { pyMin } from './py'
import { EXPOSED_RISK, nightFactor } from './safety'

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

const FOOT_ONLY_FACTOR = 4
const FOOT_ONLY_HIGHWAY = new Set(['footway', 'pedestrian'])
const STEPS_FACTOR = 3
const NIGHT_MIN_FACTOR = 0.7 * 0.9

export class Profile {
  constructor({ lam, surface, night, sport = 'run', avoid = [], blocked = null }) {
    this.lam = lam
    this.surface = surface
    this.night = night
    this.sport = sport
    this.factors = (sport === 'bike' ? SURFACE_FACTOR_BIKE : SURFACE_FACTOR)[surface]
    this.avoid = avoid.filter((key) => key in AVOIDS).map((key) => AVOIDS[key])
    this.blocked = blocked
  }

  weight(graph, e) {
    const s = graph.edgeSafety[e]
    let w = graph.edgeLen[e] * (1 + this.lam * s.risk)
    w *= this.factors.has(s.surface) ? this.factors.get(s.surface) : 1
    if (this.sport === 'bike') {
      if (FOOT_ONLY_HIGHWAY.has(s.highway) && !(s.separation >= 2)) w *= FOOT_ONLY_FACTOR
    } else if (s.highway === 'steps') {
      w *= STEPS_FACTOR
    }
    if (this.night) w *= nightFactor(s)
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
    return factor
  }
}

export function buildProfile(surface, safety, night, sport = 'run', { avoid = [], blocked = null } = {}) {
  return new Profile({ lam: LAMBDA[safety], surface, night, sport, avoid, blocked })
}
