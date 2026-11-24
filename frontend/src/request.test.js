import { describe, expect, it } from 'vitest'
import { DEFAULTS } from './FiltersSheet.jsx'
import { filtersLine, freeRunName, runEntry, summarise, toRequest } from './request'

const start = { lat: 47.9, lon: 7.2 }

describe('la demande au moteur', () => {
  it('« Sûr » contourne de lui-même les grands axes', () => {
    // L'ancienne case « Grands axes » disait la même chose que « Sûr » : elle
    // a disparu, et « Sûr » en porte l'effet.
    const body = toRequest({ ...DEFAULTS, safety: 'safe', avoid: [] }, start)
    expect(body.avoid).toEqual(['busy'])
  })

  it('« Standard » ne contourne rien qu’on n’ait coché', () => {
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: [] }, start).avoid).toBeUndefined()
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: ['steps'] }, start).avoid).toEqual(['steps'])
  })

  it('oublie une case « Grands axes » restée cochée dans d’anciens réglages', () => {
    // Elle n'a plus d'interrupteur pour la décocher : en « Standard », elle
    // pèserait sans qu'on puisse savoir pourquoi.
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: ['busy', 'unlit'] }, start).avoid).toEqual(['unlit'])
    expect(toRequest({ ...DEFAULTS, safety: 'safe', avoid: ['busy', 'steps'] }, start).avoid).toEqual(['steps', 'busy'])
  })

  it('court à gauche par défaut, face aux voitures, et ne dit que l’autre choix', () => {
    expect(toRequest(DEFAULTS, start)).not.toHaveProperty('side')
    expect(toRequest({ ...DEFAULTS, side: 'left' }, start)).not.toHaveProperty('side')
    expect(toRequest({ ...DEFAULTS, side: 'right' }, start).side).toBe('right')
    expect(toRequest({ ...DEFAULTS, side: 'any' }, start).side).toBe('any')
  })

  it('envoie le cap de la direction choisie, et rien en « Auto »', () => {
    // Sans cap, le moteur fait la recherche d'avant, à l'identique.
    expect(toRequest(DEFAULTS, start)).not.toHaveProperty('heading')
    expect(toRequest({ ...DEFAULTS, direction: 'SO' }, start).heading).toBe(225)
    // Une valeur inconnue — une sauvegarde d'une autre version — vaut « Auto ».
    expect(toRequest({ ...DEFAULTS, direction: 'ailleurs' }, start)).not.toHaveProperty('heading')
  })

  it('envoie le D+ précis, et rien sans lui', () => {
    expect(toRequest(DEFAULTS, start)).not.toHaveProperty('climb_m')
    expect(toRequest({ ...DEFAULTS, climb_m: 150 }, start).climb_m).toBe(150)
    // Zéro est une demande : « le moins possible ».
    expect(toRequest({ ...DEFAULTS, climb_m: 0 }, start).climb_m).toBe(0)
  })

  it('traduit en allure la vitesse d’un coureur qui compte en km/h', () => {
    // Le moteur ne lit la vitesse qu'à vélo : envoyée seule, elle était
    // ignorée, et une heure à 12 km/h se calculait à 6:30 du kilomètre.
    const course = { ...DEFAULTS, sport: 'run', speedUnit: 'speed', speed_kmh: 12, mode: 'duration', duration_min: 60 }
    const body = toRequest(course, start)
    expect(body.pace_sec_per_km).toBe(300)
    expect(body.speed_kmh).toBeUndefined()
    // Au-delà de ce que le moteur accepte, l'allure s'arrête à sa borne.
    expect(toRequest({ ...course, speed_kmh: 40 }, start).pace_sec_per_km).toBe(150)
    expect(toRequest({ ...DEFAULTS, sport: 'bike', speed_kmh: 22 }, start).speed_kmh).toBe(22)
  })

  it('envoie la forme choisie, et rien en « Auto »', () => {
    expect(toRequest(DEFAULTS, start)).not.toHaveProperty('form')
    expect(toRequest({ ...DEFAULTS, form: 'eight', laps: 4 }, start)).toMatchObject({ form: 'eight' })
    expect(toRequest({ ...DEFAULTS, form: 'eight', laps: 4 }, start)).not.toHaveProperty('laps')
    expect(toRequest({ ...DEFAULTS, form: 'laps', laps: 4 }, start)).toMatchObject({ form: 'laps', laps: 4 })
  })
})

describe('la pastille d’activité', () => {
  it('dit la forme choisie, et rien en « Auto »', () => {
    expect(summarise({ ...DEFAULTS, mode: 'distance', distance_km: 10 })).toBe('10 km · 6:30/km')
    expect(summarise({ ...DEFAULTS, mode: 'distance', distance_km: 10, form: 'laps', laps: 3 })).toBe('10 km · 3 tours · 6:30/km')
    expect(summarise({ ...DEFAULTS, mode: 'duration', duration_min: 60, form: 'eight' })).toBe('≈9 km · deux boucles · 6:30/km')
    expect(summarise({ ...DEFAULTS, form: 'loop' })).toContain('une boucle')
  })

  it('dit « inédites » quand on écarte les boucles déjà courues', () => {
    expect(summarise({ ...DEFAULTS, mode: 'distance', distance_km: 10, avoid: ['known'] })).toBe('10 km · inédites · 6:30/km')
    // Ce ne sont pas des rues : elles ne partent pas en évitement au moteur.
    expect(toRequest({ ...DEFAULTS, safety: 'standard', avoid: ['known', 'steps'] }, start).avoid).toEqual(['steps'])
  })

  it('ne parle pas de « Semi » à vélo', () => {
    expect(summarise({ ...DEFAULTS, sport: 'bike', mode: 'distance', distance_km: 21.0975 })).toBe('21,098 km · 20 km/h')
  })
})

describe('la ligne des filtres', () => {
  it('dit le terrain et le relief, pas la longueur ni l’allure', () => {
    expect(filtersLine(DEFAULTS)).toBe('Mixte · Vallonné')
    expect(filtersLine({ ...DEFAULTS, sport: 'bike', surface: 'trail', climb_m: 300, form: 'laps', laps: 3 })).toBe('VTT · D+ 300 m · 3 tours')
  })
})

describe('l’entrée d’historique', () => {
  const route = { id: 'r', name: 'Boucle', distance_m: 5000, geometry: [[7.2, 47.9], [7.21, 47.9]], segments: [] }

  it('garde d’où vient le dénivelé mesuré', () => {
    const entry = runEntry({ distance: 5000, elapsed: 1500, ascent: 62, ascentSource: 'baro' }, { route, sport: 'run' }, DEFAULTS)
    expect(entry.actual_ascent_m).toBe(62)
    expect(entry.actual_ascent_source).toBe('baro')
  })

  it('garde ce que la voix a dit, et rien quand elle s’est tue', () => {
    const phrase = { t: 1_760_000_000_000, lon: 7.2, lat: 47.9, m: 120, text: 'Maintenant, tourne à gauche.' }
    expect(runEntry({ distance: 5000, elapsed: 1500, spoken: [phrase] }, { route, sport: 'run' }, DEFAULTS).spoken).toEqual([phrase])
    expect(runEntry({ distance: 5000, elapsed: 1500, spoken: [] }, { route, sport: 'run' }, DEFAULTS).spoken).toBeNull()
  })

  it('ne donne pas de source à un dénivelé absent', () => {
    const entry = runEntry({ distance: 5000, elapsed: 1500, ascent: null }, { route, sport: 'run' }, DEFAULTS)
    expect(entry.actual_ascent_m).toBeNull()
    expect(entry.actual_ascent_source).toBeNull()
  })
})

describe('le nom d’une sortie libre', () => {
  it('dit le sport et le moment du départ', () => {
    expect(freeRunName('run', new Date(2026, 9, 19, 7, 30).getTime())).toBe('Course du matin')
    expect(freeRunName('run', new Date(2026, 9, 19, 19, 5).getTime())).toBe('Course du soir')
    expect(freeRunName('bike', new Date(2026, 9, 19, 15, 0).getTime())).toBe("Vélo de l'après-midi")
    expect(freeRunName('run', new Date(2026, 9, 19, 23, 40).getTime())).toBe('Course de nuit')
  })
})

describe('une sortie interrompue, rangée après coup', () => {
  const stats = { distance: 5000, elapsed: 1500, trail: [[7.2, 47.9], [7.21, 47.9]] }

  it('garde l’heure où elle s’est arrêtée, pas celle où on la range', () => {
    const hier = Date.parse('2026-11-09T19:12:00.000Z')
    const entry = runEntry({ ...stats, endedAt: hier }, { free: true, sport: 'run' }, DEFAULTS)
    expect(entry.ranAt).toBe('2026-11-09T19:12:00.000Z')
  })

  it('ne garde l’heure des points que rang pour rang avec la trace', () => {
    const entry = (trailT) => runEntry({ ...stats, trailT }, { free: true, sport: 'run' }, DEFAULTS)
    expect(entry([0, 300]).track_t).toEqual([0, 300])
    expect(entry([0, 150, 300]).track_t).toBeNull()
    expect(entry([null, null]).track_t).toBeNull()
  })
})
