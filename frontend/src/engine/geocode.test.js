import { describe, expect, it } from 'vitest'
import { expandNicknames, fromPhoton, rankPlaces, search } from './geocode'

/**
 * Chercher un lieu comme on le dit : « macdo guebwiller », « one fitness ».
 *
 * Ce qu'on attend : les surnoms compris, le bruit écarté (défibrillateurs,
 * quais de gare), et, entre plusieurs lieux du même nom, le plus proche
 * d'abord.
 */

const GUEBWILLER = { lat: 47.9097, lon: 7.2106 }

/** Un résultat de Photon, tel qu'il arrive. */
const feature = (name, [lon, lat], props = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name, osm_key: 'amenity', osm_value: 'fast_food', city: 'Ville', postcode: '68000', country: 'France', ...props },
})

describe('les surnoms', () => {
  it('traduit « macdo » et ses variantes', () => {
    for (const q of ['macdo guebwiller', 'McDo Guebwiller', 'mac do guebwiller', 'mcdonalds guebwiller']) {
      expect(expandNicknames(q)).toBe("McDonald's guebwiller")
    }
  })

  it('ne touche qu’aux mots entiers', () => {
    expect(expandNicknames('Rue Macdonaldo')).toBe('Rue Macdonaldo')
    expect(expandNicknames('bk colmar')).toBe('Burger King colmar')
  })

  it('laisse une saisie ordinaire telle quelle, accents compris', () => {
    expect(expandNicknames('12 rue de la  République')).toBe('12 rue de la République')
  })
})

describe('les résultats de Photon', () => {
  it('écarte ce qui n’est pas un lieu de rendez-vous', () => {
    expect(fromPhoton(feature('Fitness One', [8.3, 47.0], { osm_key: 'emergency', osm_value: 'defibrillator' }))).toBeNull()
    expect(fromPhoton(feature('Piscine', [7.2, 47.9], { osm_key: 'highway', osm_value: 'bus_stop' }))).toBeNull()
  })

  it('nomme une adresse par son numéro et sa rue', () => {
    const place = fromPhoton(feature(undefined, [7.215, 47.907], {
      type: 'house', osm_key: 'place', osm_value: 'house', street: 'Rue de la République', housenumber: '12', city: 'Guebwiller', postcode: '68500',
    }))
    expect(place.short).toBe('12 Rue de la République')
    expect(place.label).toBe('68500 Guebwiller')
  })

  it('dit le genre du lieu en mots de tous les jours', () => {
    const gym = fromPhoton(feature('One Fitness Club', [7.37, 48.1], { osm_key: 'leisure', osm_value: 'fitness_centre', street: 'Rue André Kiener', housenumber: '11', city: 'Colmar' }))
    expect(gym.kind).toBe('Salle de sport')
    expect(gym.label).toBe('11 Rue André Kiener, 68000 Colmar')
  })
})

describe('le classement', () => {
  it('met la plus proche d’une même enseigne devant', () => {
    const places = [
      fromPhoton(feature('Burger King', [7.34, 47.748])), // Mulhouse, 20 km
      fromPhoton(feature('Burger King', [7.161, 47.795])), // Cernay, 13 km
    ]
    const ranked = rankPlaces(places, GUEBWILLER)
    expect(ranked.map((p) => Math.round(p.distance_m / 1000))).toEqual([13, 20])
  })

  it('ne compare pas une ville et un commerce qui portent son nom', () => {
    const places = [
      fromPhoton(feature('Paris', [2.348, 48.853], { type: 'city', osm_key: 'place', osm_value: 'city' })),
      fromPhoton(feature('Paris', [7.583, 48.029], { osm_key: 'shop', osm_value: 'hairdresser' })),
    ]
    expect(rankPlaces(places, GUEBWILLER)[0].kind).toBe('Ville')
  })

  it('fusionne les doublons : même nom, à quelques mètres', () => {
    const places = [
      fromPhoton(feature('Gare de Colmar', [7.347, 48.0725], { osm_key: 'railway', osm_value: 'station' })),
      fromPhoton(feature('Gare de Colmar', [7.3472, 48.0726], { osm_key: 'building', osm_value: 'train_station' })),
    ]
    expect(rankPlaces(places, GUEBWILLER)).toHaveLength(1)
  })
})

describe('la recherche', () => {
  it('interroge Photon près de la position, avec le surnom traduit', async () => {
    const urls = []
    const fetchImpl = async (url) => {
      urls.push(new URL(url))
      return { ok: true, json: async () => ({ features: [feature("McDonald's", [7.223, 47.9017])] }) }
    }
    const results = await search('macdo guebwiller', { near: GUEBWILLER, fetchImpl })
    expect(urls[0].searchParams.get('q')).toBe("McDonald's guebwiller")
    expect(Number(urls[0].searchParams.get('lat'))).toBeCloseTo(GUEBWILLER.lat, 4)
    expect(results[0].short).toBe("McDonald's")
    expect(results[0].distance_m).toBeGreaterThan(500)
    expect(results[0].distance_m).toBeLessThan(2000)
  })
})
