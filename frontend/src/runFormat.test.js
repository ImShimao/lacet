import { describe, expect, it } from 'vitest'
import { arrivalSpeech, clock, lapAt, minutes, ordinal, plannedPerKm, roundedDistance, speed, spoken, spokenDuration, spokenSpeed, targetSpeech, turnIcon } from './runFormat'

describe('ce que l’écran de course écrit', () => {
  it('écrit une durée en heures et minutes, jamais comme un chrono', () => {
    expect(minutes(42)).toBe('42 min')
    expect(minutes(65)).toBe('1 h 05')
    expect(minutes(120)).toBe('2 h')
  })

  it('écrit le chrono comme une montre', () => {
    expect(clock(727.9)).toBe('00:12:07')
    expect(clock(3 * 3600 + 5)).toBe('03:00:05')
  })

  it('arrondit la distance du prochain virage pour l’œil', () => {
    expect(roundedDistance(87)).toBe('90 m')
    expect(roundedDistance(1440)).toBe('1,4 km')
  })

  it('ne donne pas de vitesse sur cinquante mètres', () => {
    expect(speed(40, 20)).toBe('—')
    expect(speed(1000, 360)).toBe('10,0')
  })

  it('choisit le pictogramme de la manœuvre', () => {
    expect(turnIcon('slight_left')).toBe('turnLeft')
    expect(turnIcon('sharp_right')).toBe('turnRight')
    expect(turnIcon('continue')).toBe('straight')
    expect(turnIcon('finish')).toBe('flag')
  })

  it('lit l’allure demandée au moteur, à pied comme à vélo', () => {
    expect(plannedPerKm({ pace_sec_per_km: 390 }, false)).toBe(390)
    expect(plannedPerKm({ speed_kmh: 24 }, true)).toBe(150)
    expect(plannedPerKm(null, false)).toBe(0)
    // L'écart à l'allure visée : rien sous dix secondes, rien en course libre.
    expect(targetSpeech(396, 390)).toBe('')
    expect(targetSpeech(405, 390)).toBe('Trop lent de 15 secondes.')
    expect(targetSpeech(370, 390)).toBe('En avance de 20 secondes.')
    expect(targetSpeech(402, 0)).toBe('')
  })
})

describe('ce que la voix dit', () => {
  it('dit une allure en minutes et secondes, pas comme une heure', () => {
    expect(spoken(330)).toBe('5 minutes 30')
    expect(spoken(60)).toBe('1 minute')
    expect(spoken(45)).toBe('45 secondes')
  })

  it('arrondit avant de découper : jamais « 4 minutes 60 »', () => {
    expect(spoken(299.6)).toBe('5 minutes')
  })

  it('dit une vitesse en kilomètres-heure', () => {
    expect(spokenSpeed(24.46)).toBe('24,5 kilomètres-heure')
    expect(spokenSpeed(0)).toBe('inconnue')
  })
})

describe('le rang d’un kilomètre, dit à voix haute', () => {
  it('dit le rang en toutes lettres, que la voix prononce sans hésiter', () => {
    expect(ordinal(1)).toBe('premier')
    expect(ordinal(2)).toBe('deuxième')
    expect(ordinal(3)).toBe('troisième')
    expect(ordinal(5)).toBe('cinquième')
    expect(ordinal(9)).toBe('neuvième')
    expect(ordinal(11)).toBe('onzième')
    expect(ordinal(17)).toBe('dix-septième')
  })

  it('suit les règles des nombres composés', () => {
    expect(ordinal(21)).toBe('vingt et unième')
    expect(ordinal(42)).toBe('quarante-deuxième')
    expect(ordinal(71)).toBe('soixante et onzième')
    expect(ordinal(80)).toBe('quatre-vingtième')
    expect(ordinal(81)).toBe('quatre-vingt-unième')
    expect(ordinal(99)).toBe('quatre-vingt-dix-neuvième')
    expect(ordinal(100)).toBe('centième')
    expect(ordinal(200)).toBe('deux centième')
    expect(ordinal(201)).toBe('deux cent unième')
  })
})

describe('le tour en cours', () => {
  it('change à parts égales sur une boucle répétée', () => {
    const tours = { laps: 3, lap_distance_m: 2000, distance_m: 6000 }
    expect([0, 1999, 2000, 4100, 6000].map((along) => lapAt(tours, along))).toEqual([1, 1, 2, 3, 3])
  })

  it('change à la fin de la première boucle d’un « 8 »', () => {
    // 5,1 puis 4,8 km : à 5 km, on est encore dans la première.
    const huit = { laps: 2, lap_distance_m: 4950, lap_distances_m: [5100, 4800], figure_eight: true }
    expect([5000, 5100, 9900].map((along) => lapAt(huit, along))).toEqual([1, 2, 2])
  })

  it('compte une sortie gardée avant les « 8 » comme avant', () => {
    expect(lapAt({ laps: 2, lap_distance_m: 4950 }, 5000)).toBe(2)
    expect(lapAt({ distance_m: 9000 }, 8000)).toBe(1)
  })
})

describe('ce que la voix dit à l’arrivée', () => {
  it('donne la distance, le temps et l’allure, en mots que la voix lit bien', () => {
    expect(arrivalSpeech(10_240, 3500)).toBe(
      'Arrivée. Sortie terminée : 10,2 kilomètres en 58 minutes, allure moyenne 5 minutes 42.',
    )
    expect(arrivalSpeech(42_000, 6000, true)).toBe(
      'Arrivée. Sortie terminée : 42,0 kilomètres en 1 heure 40, moyenne 25,2 kilomètres-heure.',
    )
    expect(spokenDuration(7200)).toBe('2 heures')
  })

  it('se contente de l’essentiel quand il n’y a rien à dire', () => {
    expect(arrivalSpeech(40, 30)).toBe('Arrivée. Sortie terminée.')
  })
})
