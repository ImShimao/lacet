import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { planLoops } from './service'

/**
 * Ce que le guidage dit, et ce qu'il ne dit plus.
 *
 * Le défaut se constatait en courant : « serre à gauche puis tout de suite à
 * droite », là où la rue continue tout droit. Il ne venait pas d'une erreur de
 * calcul mais d'une fenêtre de mesure trop courte — vingt mètres, soit la
 * longueur du carrefour lui-même —, si bien qu'on lisait la géométrie de
 * l'intersection au lieu de la direction de la rue.
 *
 * Ces épreuves vérifient des **propriétés du résultat**, pas l'implémentation :
 * elles tiendraient encore si la méthode changeait, et c'est ce qu'on veut
 * d'un garde-fou sur une chose qu'on entend dans l'oreille en courant.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const charger = (nom) => {
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL(nom, dir))).toString('utf8')))
  return buildGraph(extract, { sport: 'run' })
}

async function boucles(graph, km = 5, limit = 5) {
  const i = Math.floor(graph.nodeCount / 2)
  const r = await planLoops(
    { lat: graph.nodeLat[i], lon: graph.nodeLon[i], distance_km: km, sport: 'run', limit },
    { loadGraph: async () => graph, fetchElevations: async () => [], wind: async () => null },
  )
  return r.routes
}

/** Les manœuvres seules : ni le départ, ni les tours, ni l'arrivée. */
const manoeuvres = (route) => route.instructions.filter((s) => !['start', 'finish', 'lap'].includes(s.turn))

describe('les consignes de virage', () => {
  it('ne fait plus tourner à gauche puis à droite pour une rue qui ondule', async () => {
    // La propriété : deux manœuvres opposées trop rapprochées pour être deux
    // décisions, et dont la somme ramène tout droit, n'ont rien à dire.
    for (const nom of ['extract-beaune.json.gz', 'extract-lyon-centre.json.gz']) {
      const graph = charger(nom)
      for (const route of await boucles(graph)) {
        const pas = manoeuvres(route)
        for (let i = 0; i + 1 < pas.length; i += 1) {
          const proche = pas[i + 1].dist_m - pas[i].dist_m <= 25
          const oppose = pas[i].angle > 0 !== pas[i + 1].angle > 0
          const compense = Math.abs(pas[i].angle + pas[i + 1].angle) < 30
          expect(proche && oppose && compense, `${nom} : ${pas[i].text} / ${pas[i + 1].text}`).toBe(false)
        }
      }
    }
  }, 60_000)

  it('ne coupe plus un virage en deux consignes du même côté', async () => {
    const graph = charger('extract-lyon-centre.json.gz')
    for (const route of await boucles(graph)) {
      const pas = manoeuvres(route)
      for (let i = 0; i + 1 < pas.length; i += 1) {
        const proche = pas[i + 1].dist_m - pas[i].dist_m <= 25
        const memeCote = pas[i].angle > 0 === pas[i + 1].angle > 0
        expect(proche && memeCote, `${pas[i].text} / ${pas[i + 1].text}`).toBe(false)
      }
    }
  }, 60_000)

  it('reste assez rare pour qu’on l’écoute', async () => {
    // Une consigne tous les cent vingt-cinq mètres, c'est une voix qu'on coupe.
    // Le plafond vaut pour le centre de Lyon, c'est-à-dire pour le pire cas :
    // ailleurs, les rues sont plus longues et les consignes plus espacées.
    const graph = charger('extract-lyon-centre.json.gz')
    const routes = await boucles(graph)
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      const parKm = manoeuvres(route).length / (route.distance_m / 1000)
      expect(parKm, `${route.name} : ${parKm.toFixed(1)} consignes/km`).toBeLessThan(7)
    }
  }, 60_000)

  it('garde les vrais virages', async () => {
    // Le risque de tout ce qui précède : un guidage muet. Une boucle de cinq
    // kilomètres en ville tourne forcément, et souvent.
    const graph = charger('extract-lyon-centre.json.gz')
    for (const route of await boucles(graph)) {
      const vrais = manoeuvres(route).filter((s) => ['left', 'right', 'sharp_left', 'sharp_right'].includes(s.turn))
      expect(vrais.length).toBeGreaterThan(3)
    }
  }, 60_000)
})
