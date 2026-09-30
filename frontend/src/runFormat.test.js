import { describe, expect, it } from 'vitest'
import { clock, minutes, plannedPerKm, roundedDistance, speed, spoken, spokenSpeed, turnIcon } from './runFormat'

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
