import { describe, expect, it } from 'vitest'
import { appDeltaY, localRatio, turnFor } from './orientation'

describe('turnFor', () => {
  it('ne tourne rien hors téléphone couché', () => {
    expect(turnFor(90, false)).toBe(0)
    expect(turnFor(0, true)).toBe(0)
    expect(turnFor(180, true)).toBe(0)
  })

  it('compense un quart de tour dans chaque sens', () => {
    expect(turnFor(90, true)).toBe(-90)
    expect(turnFor(270, true)).toBe(90)
  })

  it('comprend −90, la façon dont les vieux Safari écrivent 270', () => {
    expect(turnFor(-90, true)).toBe(90)
  })
})

describe('localRatio', () => {
  // Un élément de 100 × 20 dans le repère de l'app : une fois l'app tournée, il
  // occupe à l'écran une boîte de 20 × 100.
  const upright = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }
  const turned = { left: 0, top: 0, right: 20, bottom: 100, width: 20, height: 100 }

  it("lit l'axe horizontal de l'écran quand rien ne tourne", () => {
    expect(localRatio(upright, 0, 25, 10)).toEqual({ x: 0.25, y: 0.5 })
  })

  it("app tournée d'un quart antihoraire : le début de l'élément est en bas de l'écran", () => {
    expect(localRatio(turned, -90, 5, 100)).toEqual({ x: 0, y: 0.25 })
    expect(localRatio(turned, -90, 5, 25)).toEqual({ x: 0.75, y: 0.25 })
  })

  it("app tournée d'un quart horaire : le début de l'élément est en haut de l'écran", () => {
    expect(localRatio(turned, 90, 15, 0)).toEqual({ x: 0, y: 0.25 })
    expect(localRatio(turned, 90, 15, 75)).toEqual({ x: 0.75, y: 0.25 })
  })
})

describe('appDeltaY', () => {
  it("rend le geste vertical de l'app, quel que soit le sens de l'écran", () => {
    expect(appDeltaY(0, 5, -40)).toBe(-40)
    expect(appDeltaY(-90, 30, 2)).toBe(30)
    expect(appDeltaY(90, 30, 2)).toBe(-30)
  })
})
