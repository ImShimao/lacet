import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCompact } from './extract'
import { buildGraph } from './graph'
import { haversineM } from './geo'
import { BLOCK_RADIUS_M, blockedEdges } from './blocked'
import { buildProfile } from './weights'

/**
 * Du point signalé aux rues écartées.
 *
 * Deux exigences opposées. Trop peu : on signale une route barrée depuis le
 * trottoir d'en face, et la rue reste empruntée — le signalement n'aura servi à
 * rien. Trop : on écarte la rue perpendiculaire, qui est ouverte, et la boucle
 * fait un détour que personne ne comprend.
 */

const dir = new URL('./__fixtures__/parity/', import.meta.url)
const extract = fromCompact(JSON.parse(gunzipSync(readFileSync(new URL('extract-beaune.json.gz', dir))).toString('utf8')))
const graph = buildGraph(extract, { sport: 'run' })

/** Le milieu géométrique d'une arête : là où l'on se tiendrait en signalant. */
function milieu(e) {
  const start = graph.edgeCoordStart[e]
  const count = graph.edgeCoordCount[e]
  const i = start + Math.floor(count / 2)
  return [graph.coords[2 * i], graph.coords[2 * i + 1]]
}

/** Une arête assez longue pour que son milieu soit loin de ses voisines. */
const longue = (() => {
  let best = 0
  for (let e = 1; e < graph.edgeCount; e += 1) if (graph.edgeLen[e] > graph.edgeLen[best]) best = e
  return best
})()

describe('les rues écartées par un signalement', () => {
  it('écarte la rue sur laquelle on se tient', () => {
    const bloquees = blockedEdges(graph, [milieu(longue)])
    expect(bloquees).not.toBeNull()
    expect(bloquees.has(longue)).toBe(true)
  })

  it("n'écarte que le voisinage immédiat, pas le quartier", () => {
    const point = milieu(longue)
    const bloquees = blockedEdges(graph, [point])
    // Chaque arête retenue passe bien à portée : aucune n'est là par erreur.
    for (const e of bloquees) {
      const start = graph.edgeCoordStart[e]
      const count = graph.edgeCoordCount[e]
      let plusProche = Infinity
      for (let i = 0; i < count; i += 1) {
        plusProche = Math.min(plusProche, haversineM(point, [graph.coords[2 * (start + i)], graph.coords[2 * (start + i) + 1]]))
      }
      // Le point de forme le plus proche peut être un peu plus loin que le
      // rayon — c'est le segment qui compte, pas ses sommets — mais pas d'un
      // ordre de grandeur.
      expect(plusProche).toBeLessThan(BLOCK_RADIUS_M * 4)
    }
    // Et le quartier entier n'est pas barré pour un cône de chantier.
    expect(bloquees.size).toBeLessThan(graph.edgeCount / 20)
  })

  it('ne dit rien sans signalement, ni pour un point en plein champ', () => {
    expect(blockedEdges(graph, [])).toBeNull()
    expect(blockedEdges(graph, null)).toBeNull()
    expect(blockedEdges(graph, [[5.2, 47.4]])).toBeNull()
  })

  it('ignore les points aberrants sans écarter les autres', () => {
    const bloquees = blockedEdges(graph, [[NaN, 47], null, milieu(longue)])
    expect(bloquees?.has(longue)).toBe(true)
  })
})

describe('le poids des rues écartées', () => {
  it('rend une rue signalée prohibitive sans la supprimer', () => {
    const normal = buildProfile('mixed', 'safe', false, 'run')
    const evite = buildProfile('mixed', 'safe', false, 'run', { blocked: new Set([longue]) })
    const avant = normal.weight(graph, longue)
    const apres = evite.weight(graph, longue)
    expect(apres / avant).toBeCloseTo(400, 5)
    // Toujours un nombre fini : le réseau reste connexe, et une impasse dont
    // c'est le seul accès reste atteignable.
    expect(Number.isFinite(apres)).toBe(true)
  })

  it("ne touche à rien d'autre", () => {
    const normal = buildProfile('mixed', 'safe', false, 'run')
    const evite = buildProfile('mixed', 'safe', false, 'run', { blocked: new Set([longue]) })
    const autre = longue === 0 ? 1 : 0
    expect(evite.weight(graph, autre)).toBe(normal.weight(graph, autre))
  })
})

describe('les évitements cochés', () => {
  // Un faux graphe : le poids ne lit qu'une longueur et une évaluation de
  // tronçon, et fabriquer ici l'escalier ou la voie rapide qu'on cherche vaut
  // mieux que d'espérer en trouver un dans l'extrait de Beaune.
  const faux = (safety) => ({ edgeLen: [100], edgeSafety: [{ risk: 0, separation: 2, surface: 'paved', lit: null, highway: 'residential', ...safety }] })

  it('multiplie par vingt-cinq un escalier, quand on le refuse', () => {
    const marches = faux({ highway: 'steps' })
    const sans = buildProfile('mixed', 'safe', false, 'run')
    const avec = buildProfile('mixed', 'safe', false, 'run', { avoid: ['steps'] })
    expect(avec.weight(marches, 0) / sans.weight(marches, 0)).toBeCloseTo(25, 5)
  })

  it('laisse tranquille ce qui n’est pas coché', () => {
    const marches = faux({ highway: 'steps' })
    const sans = buildProfile('mixed', 'safe', false, 'run')
    const autre = buildProfile('mixed', 'safe', false, 'run', { avoid: ['unlit'] })
    expect(autre.weight(marches, 0)).toBe(sans.weight(marches, 0))
  })

  it('reconnaît une voie au contact du trafic, et le manque d’éclairage', () => {
    const axe = faux({ risk: 2, separation: 0 })
    const noir = faux({ lit: false })
    const sansRien = buildProfile('mixed', 'safe', false, 'run')
    const sansAxes = buildProfile('mixed', 'safe', false, 'run', { avoid: ['busy'] })
    const eclairees = buildProfile('mixed', 'safe', false, 'run', { avoid: ['unlit'] })
    expect(sansAxes.weight(axe, 0) / sansRien.weight(axe, 0)).toBeCloseTo(25, 5)
    expect(eclairees.weight(noir, 0) / sansRien.weight(noir, 0)).toBeCloseTo(25, 5)
    // Une rue dont OpenStreetMap ne dit rien n'est pas pénalisée : la moitié
    // des rues d'un village sont dans ce cas.
    const muette = faux({ lit: null })
    expect(eclairees.weight(muette, 0)).toBe(sansRien.weight(muette, 0))
  })

  it('ignore une clé inconnue plutôt que d’échouer', () => {
    const rue = faux({})
    const bizarre = buildProfile('mixed', 'safe', false, 'run', { avoid: ['licornes'] })
    expect(bizarre.weight(rue, 0)).toBe(buildProfile('mixed', 'safe', false, 'run').weight(rue, 0))
  })
})
