import { beforeEach, describe, expect, it } from 'vitest'
import {
  asCoordinates,
  expandNicknames,
  fromMapbox,
  fromPhoton,
  rankPlaces,
  resetProviders,
  search,
  shorten,
  similarity,
} from './geocode'

/**
 * Chercher un lieu comme on le dit : « macdo guebwiller », « one fitness ».
 *
 * Ce qu'on attend : les surnoms compris, le bruit écarté (défibrillateurs,
 * quais de gare), et, entre plusieurs lieux du même nom, le plus proche
 * d'abord.
 */

const GUEBWILLER = { lat: 47.9097, lon: 7.2106 }

// Photon boude une minute après un refus, et le cache garde ce qu'il a trouvé :
// deux états qui survivent à un test et fausseraient le suivant.
beforeEach(resetProviders)

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

describe('des coordonnées collées', () => {
  it('reconnaît les écritures courantes, latitude d’abord', () => {
    for (const texte of ['46.2578, 7.3856', '46.2578 7.3856', '46,2578 ; 7,3856', '  46.2578,7.3856  ']) {
      const point = asCoordinates(texte)
      expect(point.lat).toBeCloseTo(46.2578, 4)
      expect(point.lon).toBeCloseTo(7.3856, 4)
    }
  })

  it('ne pose pas un départ au hasard sur ce qui n’en est pas', () => {
    // Un numéro de rue, un code postal, une année : ce sont des recherches.
    expect(asCoordinates('12 rue de la gare')).toBeNull()
    expect(asCoordinates('68500')).toBeNull()
    expect(asCoordinates('12 14')).toBeNull()
    // Hors du monde.
    expect(asCoordinates('146.25, 7.38')).toBeNull()
    expect(asCoordinates('46.25, 207.38')).toBeNull()
  })

  it('n’interroge personne : le point est déjà là', async () => {
    const jamais = async () => {
      throw new Error('aucune requête ne doit partir')
    }
    const results = await search('46.2578, 7.3856', { fetchImpl: jamais })
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe('Point')
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
    // La rue voyage avec le lieu : c'est sur elle que la boucle partira.
    expect(place.street).toBe('Rue de la République')
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

/**
 * Le renfort de Mapbox : ce qu'OpenStreetMap ne connaît pas encore.
 *
 * Le One Fitness de Kingersheim a ouvert récemment et n'est pas dans
 * OpenStreetMap — celui de Colmar, plus loin, y est. Sans deuxième source, la
 * recherche répondait Colmar et rien d'autre.
 */
const mapboxFeature = (name, [lon, lat], props = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    name,
    feature_type: 'poi',
    poi_category: ['fitness_center'],
    place_formatted: '83 Rue de Guebwiller, 68260 Kingersheim, France',
    ...props,
  },
})

describe('les deux sources', () => {
  const serve = (photonFeatures, mapboxFeatures, { mapboxFails = false } = {}) => async (url) => {
    if (String(url).includes('photon')) return { ok: true, json: async () => ({ features: photonFeatures }) }
    if (mapboxFails) return { ok: false, status: 401, json: async () => ({}) }
    return { ok: true, json: async () => ({ features: mapboxFeatures }) }
  }

  it('fond les deux listes et met le plus proche devant', async () => {
    const fetchImpl = serve(
      [feature('One Fitness Club', [7.3686, 48.1003], { osm_key: 'leisure', osm_value: 'fitness_centre', city: 'Colmar' })],
      [mapboxFeature('One Fitness Club', [7.315, 47.7888])],
    )
    const results = await search('one fitness kingersheim', { near: GUEBWILLER, fetchImpl, token: 'test' })
    expect(results.map((p) => Math.round(p.distance_m / 1000))).toEqual([16, 24])
    expect(results[0].label).toBe('83 Rue de Guebwiller, 68260 Kingersheim')
    expect(results[0].kind).toBe('Salle de sport')
  })

  it('ne montre pas deux fois le même lieu connu des deux côtés', async () => {
    const fetchImpl = serve(
      [feature('One Fitness Club', [7.315, 47.7888], { osm_key: 'leisure', osm_value: 'fitness_centre' })],
      [mapboxFeature('One Fitness Club', [7.3151, 47.7889])],
    )
    expect(await search('one fitness', { near: GUEBWILLER, fetchImpl, token: 'test' })).toHaveLength(1)
  })

  it('un token refusé ne casse rien : Photon suffit', async () => {
    const fetchImpl = serve([feature("McDonald's", [7.223, 47.9017])], [], { mapboxFails: true })
    const results = await search('macdo', { near: GUEBWILLER, fetchImpl, token: 'périmé' })
    expect(results.map((p) => p.short)).toEqual(["McDonald's"])
  })

  it('lit la position et le genre d’un résultat Mapbox', () => {
    const place = fromMapbox(mapboxFeature('One Fitness Club', [7.315, 47.7888]))
    expect([place.lon, place.lat]).toEqual([7.315, 47.7888])
    expect(place.kind).toBe('Salle de sport')
  })
})

/**
 * La ressemblance : ce qui décide du classement.
 *
 * Deux sens, et c'est le second qui manquait. Ce qu'on a tapé doit se retrouver
 * dans le résultat — sinon « stade de france » répond le stade de l'Ill, à vingt
 * kilomètres. Mais le nom ne doit pas dire grand-chose de plus — sinon
 * « Ancienne Gare de Lyon-Saint-Clair » vaut « Gare de Lyon », et l'hôtel devant
 * le parc vaut le parc.
 */
describe('la ressemblance', () => {
  const lieu = (short, label = '') => ({ short, label })

  it('préfère le nom exact à celui qui en dit plus', () => {
    expect(similarity('gare de lyon', lieu('Gare de Lyon', 'Paris'))).toBeGreaterThan(
      similarity('gare de lyon', lieu('Ancienne Gare de Lyon-Saint-Clair', 'Caluire-et-Cuire')),
    )
    expect(similarity('colmar', lieu('Colmar'))).toBeGreaterThan(similarity('colmar', lieu('Colmar-Ribeauvillé')))
  })

  it('pardonne une faute, et d’autant plus que le mot est long', () => {
    expect(similarity('mulouse', lieu('Mulhouse'))).toBeGreaterThan(0.8)
    expect(similarity('guebwiler', lieu('Guebwiller'))).toBeGreaterThan(0.8)
  })

  it('reconnaît un mot commencé, sans le confondre avec un cousin', () => {
    // On tape au fil des touches : « guebwil » doit valoir Guebwiller.
    expect(similarity('guebwil', lieu('Guebwiller'))).toBeGreaterThan(0.7)
    // Mais « versaille » vaut mieux Versailles que Versailleux.
    expect(similarity('chateau de versaille', lieu('Château de Versailles'))).toBeGreaterThan(
      similarity('chateau de versaille', lieu('Château de Versailleux')),
    )
  })

  it('cherche aussi dans l’adresse, pas seulement dans le nom', () => {
    expect(similarity('rue de rivoli paris', lieu('Rue de Rivoli', '75004 Paris'))).toBeGreaterThan(0.9)
  })
})

/**
 * La seconde chance : Photon cherche par préfixe, donc une faute au milieu d'un
 * mot est fatale — « rivolli » ne trouve rien, « rivol » trouve la rue de
 * Rivoli. Amputer le mot le plus long ramène la faute hors du préfixe.
 */
describe('le mot raccourci', () => {
  it('ampute le mot le plus long de deux lettres', () => {
    expect(shorten('rue de rivolli paris')).toBe('rue de rivol paris')
    expect(shorten('chateau de versaille')).toBe('chateau de versail')
    expect(shorten('stade de franse')).toBe('stade de fran')
  })

  it('laisse tranquilles les mots trop courts pour qu’on les ampute', () => {
    expect(shorten('nice')).toBeNull()
    expect(shorten('rue de la gare')).toBeNull()
    expect(shorten('')).toBeNull()
  })
})

describe('le classement par ressemblance', () => {
  const GUEBWILLER_LOIN = { lat: 47.9097, lon: 7.2106 }

  it('met le lieu connu devant son homonyme du coin', () => {
    // « stade de france » depuis l'Alsace : le stade de l'Ill est à vingt
    // kilomètres, le Stade de France à trois cent soixante-quinze. C'est le
    // second qu'on cherchait.
    const places = [
      fromPhoton(feature('Stade de l’Ill', [7.34, 47.748], { city: 'Mulhouse' })),
      fromPhoton(feature('Stade de France', [2.36, 48.924], { city: 'Saint-Denis' })),
    ]
    const ranked = rankPlaces(places, GUEBWILLER_LOIN, 'stade de france')
    expect(ranked[0].short).toBe('Stade de France')
  })

  it('garde, à noms égaux, la plus proche devant', () => {
    const places = [
      fromPhoton(feature('Burger King', [7.34, 47.748])), // Mulhouse, 20 km
      fromPhoton(feature('Burger King', [7.161, 47.795])), // Cernay, 13 km
    ]
    const ranked = rankPlaces(places, GUEBWILLER_LOIN, 'burger king')
    expect(ranked.map((p) => Math.round(p.distance_m / 1000))).toEqual([13, 20])
  })

  it('met la ville devant le commerce qui porte son nom', () => {
    const places = [
      fromPhoton(feature('Paris', [7.583, 48.029], { osm_key: 'shop', osm_value: 'hairdresser' })),
      fromPhoton(feature('Paris', [2.348, 48.853], { osm_key: 'place', osm_value: 'city', state: 'Île-de-France' })),
    ]
    expect(rankPlaces(places, GUEBWILLER_LOIN, 'paris')[0].kind).toBe('Ville')
  })
})

describe('quand rien ne répond', () => {
  it('laisse passer la panne, au lieu de la faire passer pour un lieu introuvable', async () => {
    // Le champ doit pouvoir dire « la recherche n'a pas répondu » plutôt que
    // « aucun lieu de ce nom » : on ne retape pas la même chose dans les deux
    // cas. Tout le reste de l'app marche sans réseau ; pas ceci.
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(search('colmar', { near: GUEBWILLER, fetchImpl })).rejects.toThrow()
  })

  it('rend une liste vide quand les serveurs répondent, mais ne connaissent rien', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ features: [] }) })
    expect(await search('zzzzqxwv', { near: GUEBWILLER, fetchImpl })).toEqual([])
  })
})

/**
 * Un service gratuit qui traîne est plus fréquent qu'un service en panne, et un
 * service fâché plus fréquent encore : Photon ferme la porte quand on tape vite.
 */
describe('quand un fournisseur traîne ou se fâche', () => {
  const nominatimRépond = (url) =>
    String(url).includes('nominatim')
      ? {
          ok: true,
          json: async () => [
            { lat: '47.9097', lon: '7.2106', display_name: 'Guebwiller', name: 'Guebwiller', address: { city: 'Guebwiller' } },
          ],
        }
      : null

  it('ne laisse pas un fournisseur muet retenir le champ', async () => {
    const appels = []
    const fetchImpl = async (url, options = {}) => {
      appels.push(String(url).includes('photon') ? 'photon' : 'nominatim')
      const secours = nominatimRépond(url)
      if (secours) return secours
      // Photon ne répondra jamais : seul le délai peut en sortir.
      return new Promise((_, rejette) => {
        options.signal?.addEventListener('abort', () => rejette(new DOMException('coupé', 'AbortError')))
      })
    }
    const results = await search('guebwiller', { near: GUEBWILLER, fetchImpl, timeoutMs: 20 })
    expect(results[0].short).toBe('Guebwiller')
    expect(appels).toContain('nominatim')
  })

  it('laisse tranquille un fournisseur qui vient de refuser', async () => {
    const appels = []
    const fetchImpl = async (url) => {
      const quoi = String(url).includes('photon') ? 'photon' : 'nominatim'
      appels.push(quoi)
      if (quoi === 'photon') return { ok: false, status: 429, json: async () => ({}) }
      return nominatimRépond(url)
    }
    await search('guebwiller', { near: GUEBWILLER, fetchImpl })
    const première = appels.filter((a) => a === 'photon').length
    expect(première).toBeGreaterThan(0)

    // La frappe suivante ne retourne pas frapper à la porte fermée.
    appels.length = 0
    await search('colmar', { near: GUEBWILLER, fetchImpl })
    expect(appels.filter((a) => a === 'photon')).toHaveLength(0)
    expect(appels).toContain('nominatim')
  })

  it('retoque quand la bouderie est passée', async () => {
    const fetchImpl = async (url) =>
      String(url).includes('photon')
        ? { ok: false, status: 429, json: async () => ({}) }
        : nominatimRépond(url)
    await search('guebwiller', { near: GUEBWILLER, fetchImpl })
    resetProviders()

    const appels = []
    const ensuite = async (url) => {
      appels.push(String(url).includes('photon') ? 'photon' : 'nominatim')
      return String(url).includes('photon')
        ? { ok: true, json: async () => ({ features: [feature('Guebwiller', [7.2106, 47.9097], { osm_key: 'place', osm_value: 'town' })] }) }
        : nominatimRépond(url)
    }
    const results = await search('guebwiller', { near: GUEBWILLER, fetchImpl: ensuite })
    expect(appels).toContain('photon')
    expect(results[0].short).toBe('Guebwiller')
  })
})

describe('le second tour', () => {
  const answering = (byQuery) => {
    const asked = []
    const fetchImpl = async (url) => {
      const q = new URL(url).searchParams.get('q')
      asked.push(q)
      return { ok: true, json: async () => ({ features: byQuery[q] ?? [] }) }
    }
    return { asked, fetchImpl }
  }

  it('n’a pas lieu quand le premier tour répond juste', async () => {
    const { asked, fetchImpl } = answering({
      guebwiller: [feature('Guebwiller', [7.2106, 47.9097], { osm_key: 'place', osm_value: 'town' })],
    })
    const results = await search('guebwiller', { near: GUEBWILLER, fetchImpl })
    expect(results[0].short).toBe('Guebwiller')
    expect(asked).toEqual(['guebwiller'])
  })

  it('repart sans biais et avec le mot raccourci quand rien ne ressemble', async () => {
    const { asked, fetchImpl } = answering({
      'rue de rivolli paris': [feature('Rue de Paris', [7.25, 47.86], { city: 'Ungersheim' })],
      'rue de rivol paris': [feature('Rue de Rivoli', [2.34, 48.856], { city: 'Paris', postcode: '75004' })],
    })
    const results = await search('rue de rivolli paris', { near: GUEBWILLER, fetchImpl })
    expect(asked).toEqual(['rue de rivolli paris', 'rue de rivolli paris', 'rue de rivol paris'])
    expect(results[0].short).toBe('Rue de Rivoli')
  })

  it('repart aussi quand le seul nom exact est à l’autre bout du monde', async () => {
    // « tour eifel » : une école de Bingerville porte exactement la faute, à
    // quatre mille huit cents kilomètres. On cherche un départ de course.
    const { asked, fetchImpl } = answering({
      'tour eifel': [feature('Groupe scolaire la tour eifel', [-3.88, 5.35], { city: 'Bingerville', country: "Côte d’Ivoire" })],
      'tour eif': [feature('Tour Eiffel', [7.21, 47.92], { city: 'Buhl' })],
    })
    const results = await search('tour eifel', { near: GUEBWILLER, fetchImpl })
    expect(asked).toHaveLength(3)
    expect(results[0].short).toBe('Tour Eiffel')
  })
})
