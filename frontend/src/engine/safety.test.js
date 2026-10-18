import { describe, expect, it } from 'vitest'
import { emptyExtract } from './extract'
import { buildGraph } from './graph'
import { isExcluded } from './safety'

/**
 * Les chemins qu'OpenStreetMap connaît mais que le terrain a perdus.
 *
 * Première plainte contre les apps de boucles : un sentier sur la carte, des
 * ronces sur le terrain. Les disparus sortent du graphe dans tous les modes ;
 * les mal tracés, hors mode Sentier seulement. Le même calcul en Python est
 * dans `exclusion.py`, avec sa mesure.
 */

const LAT = 47.9
const LON = 7.2
const DX = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
const at = (x) => [LON + x * DX, LAT]

const way = (id, tags, ids) => ({
  id,
  tags,
  nodes: ids,
  flat: Float64Array.from(ids.flatMap((n) => at(n * 100))),
})

describe('chemins disparus ou impraticables', () => {
  it('un chemin abandonné ou invisible, même en mode Sentier', () => {
    for (const tags of [
      { highway: 'track', abandoned: 'yes' },
      { highway: 'track', 'disused:highway': 'track' },
      { highway: 'path', trail_visibility: 'no' },
      { highway: 'path', trail_visibility: 'horrible' },
    ]) {
      expect(isExcluded(tags, { allowTrail: true })).not.toBeNull()
    }
  })

  it('pas l’ancienne piste devenue sentier', () => {
    expect(isExcluded({ highway: 'path', 'disused:highway': 'track' })).toBeNull()
  })

  it('un chemin mal tracé, sauf en mode Sentier', () => {
    for (const tags of [
      { highway: 'path', trail_visibility: 'bad' },
      { highway: 'path', informal: 'yes' },
      { highway: 'track', smoothness: 'impassable' },
    ]) {
      expect(isExcluded(tags)).not.toBeNull()
      expect(isExcluded(tags, { allowTrail: true })).toBeNull()
    }
  })

  it('à vélo, aucune roue ne passe là où le dit `smoothness=impassable`', () => {
    expect(isExcluded({ highway: 'track', smoothness: 'impassable' }, { allowTrail: true, sport: 'bike' })).not.toBeNull()
  })

  it('le graphe perd le sentier informel hors mode Sentier', () => {
    const extract = {
      ...emptyExtract(),
      ways: [way(1, { highway: 'residential' }, [1, 2]), way(2, { highway: 'path', informal: 'yes' }, [2, 3])],
    }
    expect(buildGraph(extract).edgeCount).toBe(1)
    expect(buildGraph(extract, { allowTrail: true }).edgeCount).toBe(2)
  })
})
