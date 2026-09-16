// Fonction de poids du routage — portage fidèle de `backend/app/routing/weights.py`.
//
//     poids = longueur × (1 + λ · risque) × facteur_surface × facteur_nuit

import { pyMin } from './py'
import { nightFactor } from './safety'

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

const FOOT_ONLY_FACTOR = 4
const FOOT_ONLY_HIGHWAY = new Set(['footway', 'pedestrian'])
const STEPS_FACTOR = 3
const NIGHT_MIN_FACTOR = 0.7 * 0.9

export class Profile {
  constructor({ lam, surface, night, sport = 'run' }) {
    this.lam = lam
    this.surface = surface
    this.night = night
    this.sport = sport
    this.factors = (sport === 'bike' ? SURFACE_FACTOR_BIKE : SURFACE_FACTOR)[surface]
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

export function buildProfile(surface, safety, night, sport = 'run') {
  return new Profile({ lam: LAMBDA[safety], surface, night, sport })
}
