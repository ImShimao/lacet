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

// Les départs, fixés en coordonnées et non par un indice de nœud : un indice
// bouge dès que le graphe change, et le test serait parti d'ailleurs — d'autres
// boucles, d'autres consignes, sans que le guidage ait changé.
const GUILLOTIERE = [45.7502885, 4.8579479]
// Au pied des pentes de la Croix-Rousse, près du pont de Lattre de Tassigny :
// montées, escaliers, traboules, et des bouts de trottoir d'un mètre à chaque
// traversée. C'est là que le guidage disait « fais demi-tour » pour un virage à
// gauche, et « tourne à droite » puis, vingt mètres plus loin, « continue tout
// droit sur Passerelle du Collège ».
const PENTES = [45.772538, 4.8279541]
const DEPARTS = {
  'extract-beaune.json.gz': [[47.0043406, 4.8380759]],
  'extract-lyon-centre.json.gz': [GUILLOTIERE, PENTES],
}

const charger = (nom) => {
  const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL(nom, dir))).toString('utf8')))
  return buildGraph(extract, { sport: 'run' })
}

/** Les boucles de chaque départ de l'extrait, chacune avec son départ. */
async function boucles(nom, km = 5, limit = 5) {
  const graph = charger(nom)
  const out = []
  for (const depart of DEPARTS[nom]) {
    const [lat, lon] = depart
    const r = await planLoops(
      { lat, lon, distance_km: km, sport: 'run', limit },
      { loadGraph: async () => graph, fetchElevations: async () => [], wind: async () => null },
    )
    out.push(...r.routes.map((route) => ({ route, depart })))
  }
  return out
}

/** Les manœuvres seules : ni le départ, ni les tours, ni l'arrivée. */
const manoeuvres = (route) => route.instructions.filter((s) => !['start', 'finish', 'lap'].includes(s.turn))

describe('les consignes de virage', () => {
  it('ne fait plus tourner à gauche puis à droite pour une rue qui ondule', async () => {
    // La propriété : deux manœuvres opposées trop rapprochées pour être deux
    // décisions, et dont la somme ramène tout droit, n'ont rien à dire.
    for (const nom of Object.keys(DEPARTS)) {
      for (const { route, depart } of await boucles(nom)) {
        const pas = manoeuvres(route)
        for (let i = 0; i + 1 < pas.length; i += 1) {
          const proche = pas[i + 1].dist_m - pas[i].dist_m <= 25
          const oppose = pas[i].angle > 0 !== pas[i + 1].angle > 0
          const compense = Math.abs(pas[i].angle + pas[i + 1].angle) < 30
          expect(proche && oppose && compense, `${nom} ${depart} : ${pas[i].text} / ${pas[i + 1].text}`).toBe(false)
        }
      }
    }
  }, 60_000)

  it('ne coupe plus un virage en deux consignes du même côté', async () => {
    // Un « tout droit » compte : dit vingt mètres après un virage, c'est le
    // même virage, dit deux fois.
    for (const { route, depart } of await boucles('extract-lyon-centre.json.gz')) {
      const pas = manoeuvres(route)
      for (let i = 0; i + 1 < pas.length; i += 1) {
        const proche = pas[i + 1].dist_m - pas[i].dist_m <= 25
        const memeCote = pas[i].angle > 0 === pas[i + 1].angle > 0
        expect(proche && memeCote, `${depart} : ${pas[i].text} / ${pas[i + 1].text}`).toBe(false)
      }
    }
  }, 60_000)

  it('dit l’angle du chemin, jamais au-delà d’un demi-tour', async () => {
    // L'angle d'une manœuvre fusionnée est celui du chemin, pas la somme des
    // angles annoncés : celle-ci sortait de ±180° (−359,5°, passage Ménestrier).
    for (const { route, depart } of await boucles('extract-lyon-centre.json.gz')) {
      for (const s of manoeuvres(route)) {
        expect(Math.abs(s.angle), `${depart} : ${s.text} (${s.angle}°)`).toBeLessThanOrEqual(180)
      }
    }
  }, 60_000)

  it('reste assez rare pour qu’on l’écoute', async () => {
    // Une consigne tous les cent vingt-cinq mètres, c'est une voix qu'on coupe.
    // Le plafond vaut pour le centre de Lyon, c'est-à-dire pour le pire cas :
    // ailleurs, les rues sont plus longues et les consignes plus espacées.
    //
    // Les pentes de la Croix-Rousse sont pires encore, et ce n'est plus le
    // guidage : une fois les fausses manœuvres retirées, deux boucles y gardent
    // 7,98 et 7,74 consignes au kilomètre, chacune à un vrai carrefour — dans
    // les montées et les escaliers, les virages se suivent à trente ou quarante
    // mètres. La voix dit d'une seule phrase celles qui se suivent de près
    // (`guidance.js`, « puis dans 60 mètres »), si bien qu'on y entend moins de
    // phrases que de consignes.
    const routes = await boucles('extract-lyon-centre.json.gz')
    expect(routes.length).toBeGreaterThan(0)
    for (const { route, depart } of routes) {
      const plafond = depart === PENTES ? 8.5 : 7
      const parKm = manoeuvres(route).length / (route.distance_m / 1000)
      expect(parKm, `${depart} ${route.name} : ${parKm.toFixed(1)} consignes/km`).toBeLessThan(plafond)
    }
  }, 60_000)

  it('garde les vrais virages', async () => {
    // Le risque de tout ce qui précède : un guidage muet. Une boucle de cinq
    // kilomètres en ville tourne forcément, et souvent.
    for (const { route } of await boucles('extract-lyon-centre.json.gz')) {
      const vrais = manoeuvres(route).filter((s) => ['left', 'right', 'sharp_left', 'sharp_right'].includes(s.turn))
      expect(vrais.length).toBeGreaterThan(3)
    }
  }, 60_000)
})
